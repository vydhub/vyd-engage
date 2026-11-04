import prisma from '../config/database.js';
import { ClientStatus, CompanySize, ContractHolder, Prisma, TaskStatus } from '@prisma/client';
import { createError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { contratoService } from './contratoService.js';
import { SEM_DEMANDA_DESCARTADA } from './captura/estados.js';

// Prefixo que identifica a tarefa de follow-up criada pelo job — usado tanto no
// dedup do job quanto no filtro "follow-up pendente" da lista de Empresas.
export const FOLLOWUP_TASK_TITLE_PREFIX = 'Follow-up';

// Fragmento de where p/ "tarefa de follow-up em aberto" de uma empresa.
export const openFollowUpTaskWhere: Prisma.TaskWhereInput = {
  title: { startsWith: FOLLOWUP_TASK_TITLE_PREFIX },
  status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] },
  deletedAt: null,
};

export type ContractFilter = 'expiring' | 'expired' | 'competitor' | 'ours' | 'none';

export interface CreateCompanyData {
  name: string;
  // Upgrade RD P2 (req 20) — preenchíveis pelo enriquecimento por CNPJ.
  fantasyName?: string | null;
  cnpj?: string | null;
  domain?: string | null;
  industry?: string | null;
  size?: CompanySize | null;
  phone?: string | null;
  address?: string | null;
  website?: string | null;
  notes?: string | null;
  clientStatus?: ClientStatus;
  // Upgrade RD P0 (req 6) — segmento configurável do tenant (CompanySegment).
  segmentId?: string | null;
  assignedTo?: string | null;
  followUpIntervalDays?: number | null;
  contractHolder?: ContractHolder;
  contractCompetitor?: string | null;
  contractStartDate?: Date | null;
  contractEndDate?: Date | null;
  contractValue?: number | null;
  contractScope?: string | null;
}

export interface UpdateCompanyData extends Partial<CreateCompanyData> {
  id: string;
}

// Início do dia civil em UTC — datas de contrato são date-only persistidas como
// meia-noite UTC, então a aritmética de dias usa o dia UTC para não oscilar com
// o fuso do host (restrição "cálculo por data, não hora").
export function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

const companyInclude = {
  assignedUser: { select: { id: true, name: true } },
  segment: { select: { id: true, name: true } },
  // Demanda descartada sai dos números comerciais (E-17); Negócio comum conta como antes.
  _count: { select: { leads: true, deals: { where: SEM_DEMANDA_DESCARTADA } } },
};

// Segmento deve pertencer ao tenant (multi-tenant: nunca aceitar id de fora).
async function assertSegmentInTenant(tenantId: string, segmentId?: string | null) {
  if (!segmentId) return;
  const segment = await prisma.companySegment.findFirst({
    where: { id: segmentId, tenantId },
    select: { id: true },
  });
  if (!segment) {
    throw createError('Segmento inválido', 400, 'INVALID_SEGMENT');
  }
}

export const companyService = {
  async create(tenantId: string, data: CreateCompanyData) {
    await assertSegmentInTenant(tenantId, data.segmentId);
    const company = await prisma.company.create({
      data: {
        tenantId,
        name: data.name,
        fantasyName: data.fantasyName || null,
        cnpj: data.cnpj || null,
        domain: data.domain || null,
        industry: data.industry || null,
        size: data.size || null,
        phone: data.phone || null,
        address: data.address || null,
        website: data.website || null,
        notes: data.notes || null,
        clientStatus: data.clientStatus ?? undefined,
        segmentId: data.segmentId || null,
        assignedTo: data.assignedTo || null,
        followUpIntervalDays: data.followUpIntervalDays ?? null,
        contractHolder: data.contractHolder ?? undefined,
        contractCompetitor: data.contractCompetitor || null,
        contractStartDate: data.contractStartDate ?? null,
        contractEndDate: data.contractEndDate ?? null,
        contractValue: data.contractValue ?? null,
        contractScope: data.contractScope || null,
      },
      include: companyInclude,
    });

    return company;
  },

  async findById(tenantId: string, id: string, ownerId?: string | { in: string[] }) {
    // Analista (USER): a empresa só mostra os leads/deals/interações do próprio (req 4).
    const company = await prisma.company.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        assignedUser: { select: { id: true, name: true } },
        segment: { select: { id: true, name: true } },
        leads: {
          where: ownerId ? { assignedTo: ownerId } : {},
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            status: true,
            source: true,
            score: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        deals: {
          // Demanda descartada sai das telas comerciais (E-17); Negócio comum fica como antes.
          where: { ...SEM_DEMANDA_DESCARTADA, ...(ownerId ? { assignedTo: ownerId } : {}) },
          select: {
            id: true,
            name: true,
            value: true,
            stage: true,
            probability: true,
            expectedCloseDate: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        interactions: {
          where: ownerId
            ? {
                OR: [
                  { userId: ownerId },
                  { lead: { assignedTo: ownerId } },
                  { deal: { assignedTo: ownerId } },
                ],
              }
            : {},
          select: {
            id: true,
            type: true,
            direction: true,
            subject: true,
            content: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
        _count: {
          select: { leads: true, deals: { where: SEM_DEMANDA_DESCARTADA }, interactions: true },
        },
      },
    });

    if (!company) {
      throw createError('Company not found', 404, 'COMPANY_NOT_FOUND');
    }

    return company;
  },

  async findAll(
    tenantId: string,
    filters?: {
      search?: string;
      industry?: string;
      size?: CompanySize;
      clientStatus?: ClientStatus;
      segmentId?: string;
      followUpPending?: boolean;
      contract?: ContractFilter;
      contractExpiringDays?: number;
      page?: number;
      limit?: number;
      sort?: string;
      order?: 'asc' | 'desc';
    },
    // Escopo de visibilidade por dono (req 14). DEFAULT == HOJE: undefined → SEM
    // filtro por dono (companies GERAL para todos os builtins). Só quando o admin
    // configura PROPRIA/EQUIPE o filtro por `assignedTo` aparece (string | {in}).
    ownerScope?: string | { in: string[] }
  ) {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;
    const sortField = filters?.sort || 'createdAt';
    const sortOrder = filters?.order || 'desc';

    const where: Prisma.CompanyWhereInput = { tenantId, deletedAt: null };

    if (ownerScope !== undefined) {
      where.assignedTo = ownerScope;
    }

    if (filters?.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { domain: { contains: filters.search, mode: 'insensitive' } },
        { industry: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    if (filters?.industry) {
      where.industry = { contains: filters.industry, mode: 'insensitive' };
    }

    if (filters?.size) {
      where.size = filters.size;
    }

    if (filters?.clientStatus) {
      where.clientStatus = filters.clientStatus;
    }

    if (filters?.segmentId) {
      where.segmentId = filters.segmentId;
    }

    // "Clientes para follow-up": clientes ativos com tarefa de follow-up em aberto.
    if (filters?.followUpPending) {
      where.clientStatus = ClientStatus.CLIENTE_ATIVO;
      where.tasks = { some: openFollowUpTaskWhere };
    }

    // Situação de contrato (req 15): vence em até N dias / vencido / detentor.
    if (filters?.contract) {
      const today = startOfToday();
      switch (filters.contract) {
        case 'expiring': {
          const days = filters.contractExpiringDays ?? 90;
          const until = new Date(today.getTime() + days * 24 * 60 * 60 * 1000);
          where.contractHolder = { not: ContractHolder.NENHUM };
          where.contractEndDate = { gte: today, lte: until };
          break;
        }
        case 'expired':
          where.contractHolder = { not: ContractHolder.NENHUM };
          where.contractEndDate = { lt: today };
          break;
        case 'competitor':
          where.contractHolder = ContractHolder.CONCORRENTE;
          break;
        case 'ours':
          where.contractHolder = ContractHolder.NOS;
          break;
        case 'none':
          where.contractHolder = ContractHolder.NENHUM;
          break;
      }
    }

    const [companies, total] = await Promise.all([
      prisma.company.findMany({
        where,
        include: companyInclude,
        orderBy: { [sortField]: sortOrder },
        skip,
        take: limit,
      }),
      prisma.company.count({ where }),
    ]);

    return {
      companies,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  // Widget "Contratos a vencer": próximas empresas com contrato vencendo,
  // ordenadas por vencimento asc; janela = maior limiar configurado no tenant.
  async findExpiringContracts(tenantId: string) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { contractAlertDays: true },
    });
    const thresholds = parseContractAlertDays(tenant?.contractAlertDays);
    const windowDays = thresholds.length > 0 ? Math.max(...thresholds) : 90;

    const today = startOfToday();
    const until = new Date(today.getTime() + windowDays * 24 * 60 * 60 * 1000);

    const companies = await prisma.company.findMany({
      where: {
        tenantId,
        deletedAt: null,
        contractHolder: { not: ContractHolder.NENHUM },
        contractEndDate: { gte: today, lte: until },
      },
      select: {
        id: true,
        name: true,
        contractHolder: true,
        contractCompetitor: true,
        contractEndDate: true,
        assignedUser: { select: { id: true, name: true } },
      },
      orderBy: { contractEndDate: 'asc' },
    });

    // E-08: contratos da entidade nova entram na lista. A empresa NOS cujo contrato já tem
    // vencimento aparece só por ele, sem repetir o mesmo aviso pelos campos antigos.
    const [contratos, comVencimento] = await Promise.all([
      prisma.contrato.findMany({
        where: {
          tenantId,
          deletedAt: null,
          vigenciaFim: { gte: today, lte: until },
          company: { deletedAt: null },
        },
        select: {
          id: true,
          numero: true,
          vigenciaFim: true,
          company: {
            select: { id: true, name: true, assignedUser: { select: { id: true, name: true } } },
          },
        },
      }),
      contratoService.empresasComVencimentoProprio(tenantId),
    ]);

    const linhas = [
      ...companies
        .filter((c) => !(c.contractHolder === ContractHolder.NOS && comVencimento.has(c.id)))
        .map((c) => ({ ...c, contrato: null as { id: string; numero: string } | null })),
      ...contratos.map((c) => ({
        id: c.company.id,
        name: c.company.name,
        contractHolder: ContractHolder.NOS,
        contractCompetitor: null,
        contractEndDate: c.vigenciaFim,
        assignedUser: c.company.assignedUser,
        contrato: { id: c.id, numero: c.numero },
      })),
    ].sort((a, b) => (a.contractEndDate?.getTime() ?? 0) - (b.contractEndDate?.getTime() ?? 0));

    return { companies: linhas, windowDays };
  },

  async update(tenantId: string, data: UpdateCompanyData) {
    // Verify ownership
    const existing = await prisma.company.findFirst({
      where: { id: data.id, tenantId, deletedAt: null },
    });
    if (!existing) {
      throw createError('Company not found', 404, 'COMPANY_NOT_FOUND');
    }

    if (data.segmentId !== undefined) {
      await assertSegmentInTenant(tenantId, data.segmentId);
    }

    const updateData: any = {
      name: data.name,
      fantasyName: data.fantasyName,
      cnpj: data.cnpj,
      domain: data.domain,
      industry: data.industry,
      size: data.size,
      phone: data.phone,
      address: data.address,
      website: data.website,
      notes: data.notes,
      clientStatus: data.clientStatus,
      segmentId: data.segmentId,
      assignedTo: data.assignedTo,
      followUpIntervalDays: data.followUpIntervalDays,
      contractHolder: data.contractHolder,
      contractCompetitor: data.contractCompetitor,
      contractStartDate: data.contractStartDate,
      contractEndDate: data.contractEndDate,
      contractValue: data.contractValue,
      contractScope: data.contractScope,
    };

    // Remove undefined values
    Object.keys(updateData).forEach((key) => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });

    const company = await prisma.company.update({
      where: { id: data.id },
      data: updateData,
      include: companyInclude,
    });

    // Os contratos levam dados do cliente (E-10, E-19). Nunca segura a edição.
    const mudouNome = company.name !== existing.name;
    if (mudouNome || company.cnpj !== existing.cnpj || company.domain !== existing.domain) {
      void Promise.resolve()
        .then(() => contratoService.empresaAlterada(tenantId, data.id, { espelhar: mudouNome }))
        .catch((err) => logger.error('Falha ao propagar dados da empresa aos contratos', err));
    }

    return company;
  },

  // Deal GANHO promove a empresa a CLIENTE_ATIVO (no-op se já for) — req 6.
  // A edição manual do status continua sempre possível.
  async promoteToActiveClient(tenantId: string, companyId: string) {
    try {
      await prisma.company.updateMany({
        where: {
          id: companyId,
          tenantId,
          deletedAt: null,
          clientStatus: { not: ClientStatus.CLIENTE_ATIVO },
        },
        data: { clientStatus: ClientStatus.CLIENTE_ATIVO },
      });
    } catch (err) {
      logger.error('Failed to promote company to CLIENTE_ATIVO after deal won', err, {
        tenantId,
        companyId,
      });
    }
  },

  async delete(tenantId: string, id: string) {
    const company = await prisma.company.findFirst({ where: { id, tenantId, deletedAt: null } });
    if (!company) {
      throw createError('Company not found', 404, 'COMPANY_NOT_FOUND');
    }

    // Check for linked leads/deals
    const linkedCount = await prisma.company.findFirst({
      where: { id, tenantId },
      include: {
        _count: {
          select: { leads: true, deals: true, contratos: { where: { deletedAt: null } } },
        },
      },
    });

    if ((linkedCount?._count.contratos ?? 0) > 0) {
      throw createError(
        'Não é possível excluir empresa com contratos. Exclua os contratos primeiro.',
        400,
        'COMPANY_HAS_RELATIONS'
      );
    }

    if (linkedCount && (linkedCount._count.leads > 0 || linkedCount._count.deals > 0)) {
      throw createError(
        `Cannot delete company with ${linkedCount._count.leads} lead(s) and ${linkedCount._count.deals} deal(s) linked. Unlink them first.`,
        400,
        'COMPANY_HAS_RELATIONS'
      );
    }

    await prisma.company.update({ where: { id }, data: { deletedAt: new Date() } });
  },

  async count(tenantId: string) {
    return prisma.company.count({ where: { tenantId, deletedAt: null } });
  },
};

// Normaliza Tenant.contractAlertDays (Json): lista de inteiros > 0, sem duplicatas,
// ordem decrescente. Valores inválidos são descartados; vazio => [] (caller decide default).
export function parseContractAlertDays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [90, 60, 30];
  const days = raw
    .map((v) => (typeof v === 'number' ? Math.trunc(v) : NaN))
    .filter((v) => Number.isFinite(v) && v > 0);
  return [...new Set(days)].sort((a, b) => b - a);
}
