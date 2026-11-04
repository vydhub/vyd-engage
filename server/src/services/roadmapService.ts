import prisma from '../config/database.js';
import {
  Prisma,
  CommercialRoadmapStatus,
  StakeholderRole,
  StakeholderPosture,
  DealStage,
  TaskStatus,
  CommercialFunction,
} from '@prisma/client';
import { createError } from '../middleware/errorHandler.js';
import { taskService } from './taskService.js';
import { dealService } from './dealService.js';
import { googleCalendarService } from './googleCalendarService.js';
import { normalizeName } from './atestados/normalize.js';
import { parseStakeholderTable, type StakeholderRow } from './deepResearch/reportTables.js';

/** Linha do cap. 7 da pesquisa, já cruzada com os contatos da empresa. */
export interface StakeholderPreviewRow extends StakeholderRow {
  existingLeadId?: string;
  alreadyStakeholder: boolean;
}

/** Linha confirmada/editada pelo gestor para importar. */
export interface ImportStakeholderRow {
  name: string;
  position?: string;
  email?: string;
  /** Classificação original da pesquisa (decide/influencia/veta) — vai na proveniência. */
  classification?: string;
  notes?: string;
  roleInDecision: StakeholderRole;
  posture?: StakeholderPosture;
  /** Contato já existente na empresa: só vincula, não cria Lead. */
  existingLeadId?: string;
}

export const IMPORT_MAX_ROWS = 50;

export interface CreateRoadmapData {
  title: string;
  companyId: string;
  empreendimentoId?: string;
  dealId?: string;
  deepResearchId?: string;
  playbookTemplateId?: string;
  status?: CommercialRoadmapStatus;
  targetProposalDate?: string;
  notes?: string;
  // Mapeamento função comercial → usuário (do tenant) escolhido ao aplicar o playbook.
  roleAssignments?: { function: CommercialFunction; userId: string }[];
}

export interface UpdateRoadmapData {
  title?: string;
  empreendimentoId?: string | null;
  dealId?: string | null;
  status?: CommercialRoadmapStatus;
  targetProposalDate?: string | null;
  notes?: string;
}

async function assertCompany(tenantId: string, companyId: string) {
  const c = await prisma.company.findFirst({
    where: { id: companyId, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!c) throw createError('Empresa não encontrada.', 400, 'COMPANY_NOT_FOUND');
}

async function assertEmpreendimento(tenantId: string, id: string) {
  const e = await prisma.empreendimento.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!e) throw createError('Empreendimento não encontrado.', 400, 'EMPREENDIMENTO_NOT_FOUND');
}

const detailInclude = {
  company: { select: { id: true, name: true } },
  empreendimento: { select: { id: true, name: true } },
  deal: { select: { id: true, name: true, stage: true } },
  deepResearch: { select: { id: true, title: true } },
  playbookTemplate: { select: { id: true, name: true } },
  stakeholders: {
    include: {
      lead: { select: { id: true, name: true, email: true, position: true, reportsToId: true } },
    },
  },
  tasks: {
    where: { deletedAt: null },
    orderBy: { dueDate: 'asc' as const },
    include: { lead: { select: { id: true, name: true } } },
  },
} as const;

/**
 * Gera uma Task por passo do playbook (modo "Playbook + manual"). As ações
 * nascem via taskService.create → entram na agenda e nos lembretes. O contato-alvo
 * (leadId) fica a definir; o usuário atribui depois ao montar a hierarquia.
 */
async function generateActionsFromPlaybook(
  tenantId: string,
  roadmap: {
    id: string;
    companyId: string;
    empreendimentoId: string | null;
    playbookTemplateId: string | null;
  },
  ownerId?: string,
  roleAssignments?: Map<CommercialFunction, string>
) {
  if (!roadmap.playbookTemplateId) return;
  const tpl = await prisma.playbookTemplate.findFirst({
    where: { id: roadmap.playbookTemplateId, tenantId },
    include: { steps: { orderBy: { order: 'asc' } } },
  });
  if (!tpl) return;
  const start = new Date();
  for (const step of tpl.steps) {
    const due = new Date(start);
    due.setDate(due.getDate() + step.offsetDays);
    // Atribui ao usuário mapeado para a função do passo; passo sem função ou
    // função não mapeada → cai no criador do desdobramento (comportamento atual).
    const assignedTo =
      (step.responsibleFunction && roleAssignments?.get(step.responsibleFunction)) || ownerId;
    const task = await taskService.create(tenantId, {
      title: step.title,
      description: step.description ?? undefined,
      priority: step.priority,
      type: step.actionType,
      assignedTo,
      companyId: roadmap.companyId,
      empreendimentoId: roadmap.empreendimentoId ?? undefined,
      roadmapId: roadmap.id,
      dueDate: due,
    });
    // A ação entra na agenda do RESPONSÁVEL e sincroniza com o Google Calendar
    // quando ele estiver conectado (fire-and-forget; nunca quebra a geração).
    if (assignedTo) {
      googleCalendarService.syncTaskForUser(assignedTo, tenantId, task).catch(() => {});
    }
  }
}

/** Desdobramento comercial (roadmap): hierarquia + ações de acesso até a proposta. */
export const roadmapService = {
  async create(tenantId: string, createdById: string | undefined, data: CreateRoadmapData) {
    await assertCompany(tenantId, data.companyId);
    if (data.empreendimentoId) await assertEmpreendimento(tenantId, data.empreendimentoId);

    const roadmap = await prisma.commercialRoadmap.create({
      data: {
        tenantId,
        createdById: createdById || null,
        title: data.title,
        companyId: data.companyId,
        empreendimentoId: data.empreendimentoId || null,
        dealId: data.dealId || null,
        deepResearchId: data.deepResearchId || null,
        playbookTemplateId: data.playbookTemplateId || null,
        status: data.status || CommercialRoadmapStatus.PLANEJAMENTO,
        targetProposalDate: data.targetProposalDate ? new Date(data.targetProposalDate) : null,
        notes: data.notes || null,
      },
    });

    // Mapa função→usuário validado: só usuários DO TENANT entram (multi-tenant —
    // nunca atribui a usuário de outro tenant); ids inválidos são ignorados e o
    // passo daquela função cai no criador.
    let roleAssignments: Map<CommercialFunction, string> | undefined;
    if (data.roleAssignments?.length) {
      const ids = [...new Set(data.roleAssignments.map((a) => a.userId))];
      const validUsers = await prisma.user.findMany({
        where: { id: { in: ids }, tenantId },
        select: { id: true },
      });
      const validIds = new Set(validUsers.map((u) => u.id));
      roleAssignments = new Map(
        data.roleAssignments.filter((a) => validIds.has(a.userId)).map((a) => [a.function, a.userId])
      );
    }

    await generateActionsFromPlaybook(tenantId, roadmap, createdById, roleAssignments);
    return this.findById(tenantId, roadmap.id);
  },

  async findAll(
    tenantId: string,
    filters?: {
      companyId?: string;
      empreendimentoId?: string;
      status?: CommercialRoadmapStatus;
      search?: string;
      page?: number;
      limit?: number;
    }
  ) {
    const page = filters?.page || 1;
    const limit = filters?.limit || 50;
    const where: Prisma.CommercialRoadmapWhereInput = { tenantId, deletedAt: null };
    if (filters?.companyId) where.companyId = filters.companyId;
    if (filters?.empreendimentoId) where.empreendimentoId = filters.empreendimentoId;
    if (filters?.status) where.status = filters.status;
    if (filters?.search) where.title = { contains: filters.search, mode: 'insensitive' };

    const [items, total] = await Promise.all([
      prisma.commercialRoadmap.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          company: { select: { id: true, name: true } },
          empreendimento: { select: { id: true, name: true } },
          _count: { select: { tasks: true, stakeholders: true } },
        },
      }),
      prisma.commercialRoadmap.count({ where }),
    ]);
    return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  },

  async findById(tenantId: string, id: string) {
    const item = await prisma.commercialRoadmap.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: detailInclude,
    });
    if (!item) throw createError('Desdobramento não encontrado', 404, 'ROADMAP_NOT_FOUND');
    return item;
  },

  async update(tenantId: string, id: string, data: UpdateRoadmapData) {
    await this.findById(tenantId, id);
    if (data.empreendimentoId) await assertEmpreendimento(tenantId, data.empreendimentoId);

    const updateData: Prisma.CommercialRoadmapUpdateInput = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.notes !== undefined) updateData.notes = data.notes || null;
    if (data.targetProposalDate !== undefined)
      updateData.targetProposalDate = data.targetProposalDate
        ? new Date(data.targetProposalDate)
        : null;
    if (data.empreendimentoId !== undefined)
      updateData.empreendimento = data.empreendimentoId
        ? { connect: { id: data.empreendimentoId } }
        : { disconnect: true };
    if (data.dealId !== undefined)
      updateData.deal = data.dealId ? { connect: { id: data.dealId } } : { disconnect: true };

    await prisma.commercialRoadmap.update({ where: { id }, data: updateData });
    return this.findById(tenantId, id);
  },

  async delete(tenantId: string, id: string) {
    await this.findById(tenantId, id);
    await prisma.commercialRoadmap.update({ where: { id }, data: { deletedAt: new Date() } });
  },

  /** Adiciona/atualiza um stakeholder (decisor/influenciador) do desdobramento. */
  async upsertStakeholder(
    tenantId: string,
    roadmapId: string,
    data: {
      leadId: string;
      roleInDecision?: StakeholderRole;
      posture?: StakeholderPosture;
      notes?: string;
    }
  ) {
    await this.findById(tenantId, roadmapId);
    const lead = await prisma.lead.findFirst({
      where: { id: data.leadId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!lead) throw createError('Contato não encontrado.', 400, 'LEAD_NOT_FOUND');

    return prisma.roadmapStakeholder.upsert({
      where: { roadmapId_leadId: { roadmapId, leadId: data.leadId } },
      create: {
        roadmapId,
        leadId: data.leadId,
        roleInDecision: data.roleInDecision ?? StakeholderRole.USUARIO,
        posture: data.posture ?? StakeholderPosture.DESCONHECIDO,
        notes: data.notes ?? null,
      },
      update: {
        roleInDecision: data.roleInDecision,
        posture: data.posture,
        notes: data.notes ?? null,
      },
      include: { lead: { select: { id: true, name: true, email: true, position: true } } },
    });
  },

  async removeStakeholder(tenantId: string, roadmapId: string, leadId: string) {
    await this.findById(tenantId, roadmapId);
    await prisma.roadmapStakeholder.deleteMany({ where: { roadmapId, leadId } });
  },

  /**
   * Pré-visualização dos decisores do cap. 7 (Mapa de Stakeholders) da pesquisa
   * de Empresa, cruzados com os contatos da empresa do roadmap (por e-mail ou
   * nome normalizado). Nada é gravado: o gestor confirma linha a linha — os
   * nomes vêm de fontes públicas pesquisadas pelo motor e podem estar errados.
   */
  async previewStakeholdersFromResearch(tenantId: string, roadmapId: string, deepResearchId?: string) {
    const roadmap = await this.findById(tenantId, roadmapId);
    const researchId = deepResearchId || roadmap.deepResearchId;
    if (!researchId) {
      throw createError(
        'Este desdobramento não tem pesquisa de origem. Informe a pesquisa.',
        400,
        'RESEARCH_REQUIRED'
      );
    }
    const research = await prisma.deepResearch.findFirst({
      where: { id: researchId, tenantId },
      select: { id: true, title: true, reportMarkdown: true },
    });
    if (!research) throw createError('Pesquisa não encontrada.', 404, 'DEEP_RESEARCH_NOT_FOUND');

    const rows = parseStakeholderTable(research.reportMarkdown || '');
    const leads = await prisma.lead.findMany({
      where: { tenantId, companyId: roadmap.companyId, deletedAt: null },
      select: { id: true, name: true, email: true },
    });
    const porNome = new Map(leads.map((l) => [normalizeName(l.name), l.id]));
    const porEmail = new Map(
      leads.filter((l) => l.email).map((l) => [l.email!.trim().toLowerCase(), l.id])
    );
    const jaStakeholder = new Set(roadmap.stakeholders.map((s) => s.leadId));

    const preview: StakeholderPreviewRow[] = rows.map((r) => {
      const existingLeadId =
        (r.email && porEmail.get(r.email)) || porNome.get(normalizeName(r.name)) || undefined;
      return {
        ...r,
        existingLeadId,
        alreadyStakeholder: !!existingLeadId && jaStakeholder.has(existingLeadId),
      };
    });
    return { research: { id: research.id, title: research.title }, rows: preview };
  },

  /**
   * Importa as linhas confirmadas: cria Lead (isContact, na empresa do roadmap,
   * com proveniência nas notas) para quem não existe, vincula quem existe, e
   * registra cada um como stakeholder com o papel/postura escolhidos.
   */
  async importStakeholdersFromResearch(
    tenantId: string,
    roadmapId: string,
    data: { deepResearchId: string; rows: ImportStakeholderRow[] }
  ) {
    if (data.rows.length > IMPORT_MAX_ROWS) {
      throw createError(`No máximo ${IMPORT_MAX_ROWS} contatos por importação.`, 400, 'TOO_MANY_ROWS');
    }
    const roadmap = await this.findById(tenantId, roadmapId);
    const research = await prisma.deepResearch.findFirst({
      where: { id: data.deepResearchId, tenantId },
      select: { id: true, title: true },
    });
    if (!research) throw createError('Pesquisa não encontrada.', 404, 'DEEP_RESEARCH_NOT_FOUND');

    const quando = new Date().toLocaleDateString('pt-BR');
    let created = 0;
    let linked = 0;
    const createdLeads: Prisma.LeadGetPayload<Record<string, never>>[] = [];
    const stakeholders: Awaited<ReturnType<typeof this.upsertStakeholder>>[] = [];

    for (const row of data.rows) {
      let leadId = row.existingLeadId;
      if (leadId) {
        linked++;
      } else {
        const lead = await prisma.lead.create({
          data: {
            tenantId,
            name: row.name.trim(),
            position: row.position?.trim() || null,
            email: row.email?.trim().toLowerCase() || null,
            companyId: roadmap.companyId,
            isContact: true,
            convertedAt: new Date(),
            notes:
              `Importado da pesquisa «${research.title}» em ${quando}` +
              (row.classification ? ` — classificação: ${row.classification}` : ''),
          },
        });
        leadId = lead.id;
        created++;
        createdLeads.push(lead);
      }
      stakeholders.push(
        await this.upsertStakeholder(tenantId, roadmapId, {
          leadId,
          roleInDecision: row.roleInDecision,
          posture: row.posture,
          notes: row.notes,
        })
      );
    }
    return { created, linked, createdLeads, stakeholders };
  },

  /**
   * Avança o desdobramento para "pedido de proposta": reusa o Deal aberto da
   * empresa/empreendimento (ou cria um novo) na etapa PROPOSAL, vincula-o ao
   * roadmap e reflete o status (req 17). Nunca duplica um Deal aberto.
   */
  async advanceToProposal(tenantId: string, roadmapId: string, ownerId?: string) {
    const roadmap = await this.findById(tenantId, roadmapId);
    const openStages = { notIn: [DealStage.WON, DealStage.LOST] };

    // 1. Deal aberto já vinculado tem prioridade; senão, um Deal aberto da
    //    empresa (e empreendimento, quando houver).
    let deal = roadmap.dealId
      ? await prisma.deal.findFirst({
          where: { id: roadmap.dealId, tenantId, deletedAt: null, stage: openStages },
        })
      : null;
    if (!deal) {
      deal = await prisma.deal.findFirst({
        where: {
          tenantId,
          deletedAt: null,
          companyId: roadmap.companyId,
          ...(roadmap.empreendimentoId ? { empreendimentoId: roadmap.empreendimentoId } : {}),
          stage: openStages,
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    // 2. Reusar (mover para PROPOSAL) ou criar um novo Deal em PROPOSAL.
    if (deal) {
      // Negócio da Captura só anda pelo Flow (E-16): vincula ao roadmap sem mover a etapa.
      const controlado = await prisma.demanda.findFirst({
        where: { tenantId, dealId: deal.id },
        select: { id: true },
      });
      if (deal.stage !== DealStage.PROPOSAL && !controlado) {
        deal = await dealService.update(tenantId, { id: deal.id, stage: DealStage.PROPOSAL });
      }
    } else {
      const estimated = roadmap.empreendimentoId
        ? (
            await prisma.empreendimento.findUnique({
              where: { id: roadmap.empreendimentoId },
              select: { estimatedValue: true },
            })
          )?.estimatedValue
        : null;
      deal = await dealService.create(tenantId, {
        name: `Proposta — ${roadmap.company.name}${
          roadmap.empreendimento ? ' / ' + roadmap.empreendimento.name : ''
        }`,
        value: estimated != null ? Number(estimated) : 0,
        stage: DealStage.PROPOSAL,
        companyId: roadmap.companyId,
        empreendimentoId: roadmap.empreendimentoId ?? undefined,
        assignedTo: ownerId,
      });
    }

    // 3. Vincular o Deal e refletir o status do roadmap.
    await prisma.commercialRoadmap.update({
      where: { id: roadmapId },
      data: { dealId: deal.id, status: CommercialRoadmapStatus.PROPOSTA },
    });
    return this.findById(tenantId, roadmapId);
  },

  /**
   * Painel "não deixar passar": próximas ações, ações atrasadas e roadmaps em
   * risco (sem ação concluída há `riskDays` dias). Segmentável por vendedor.
   */
  async getPanel(tenantId: string, filters?: { assignedTo?: string; riskDays?: number }) {
    const now = new Date();
    const riskDays = filters?.riskDays ?? 7;
    const riskCutoff = new Date(now);
    riskCutoff.setDate(riskCutoff.getDate() - riskDays);

    const taskWhere: Prisma.TaskWhereInput = {
      tenantId,
      deletedAt: null,
      roadmapId: { not: null },
      status: { notIn: [TaskStatus.COMPLETED, TaskStatus.CANCELLED] },
    };
    if (filters?.assignedTo) taskWhere.assignedTo = filters.assignedTo;

    const taskInclude = {
      lead: { select: { id: true, name: true } },
      roadmap: { select: { id: true, title: true } },
    } as const;

    const [overdue, upcoming, activeRoadmaps] = await Promise.all([
      prisma.task.findMany({
        where: { ...taskWhere, dueDate: { lt: now } },
        orderBy: { dueDate: 'asc' },
        take: 100,
        include: taskInclude,
      }),
      prisma.task.findMany({
        where: { ...taskWhere, dueDate: { gte: now } },
        orderBy: { dueDate: 'asc' },
        take: 100,
        include: taskInclude,
      }),
      prisma.commercialRoadmap.findMany({
        where: {
          tenantId,
          deletedAt: null,
          status: {
            in: [
              CommercialRoadmapStatus.PLANEJAMENTO,
              CommercialRoadmapStatus.EM_ANDAMENTO,
              CommercialRoadmapStatus.PROPOSTA,
            ],
          },
          ...(filters?.assignedTo
            ? { tasks: { some: { assignedTo: filters.assignedTo, deletedAt: null } } }
            : {}),
        },
        include: {
          company: { select: { id: true, name: true } },
          empreendimento: { select: { id: true, name: true } },
          tasks: {
            where: { deletedAt: null },
            select: { status: true, completedAt: true, dueDate: true },
          },
        },
      }),
    ]);

    // Em risco: nenhuma ação concluída desde o corte (ou nunca concluiu nada) —
    // sinaliza estagnação no roadmap.
    const atRisk = activeRoadmaps
      .map((r) => {
        const completed = r.tasks.filter((t) => t.completedAt).map((t) => t.completedAt!.getTime());
        const lastActivityAt = completed.length ? new Date(Math.max(...completed)) : null;
        const overdueCount = r.tasks.filter(
          (t) =>
            t.status !== TaskStatus.COMPLETED &&
            t.status !== TaskStatus.CANCELLED &&
            t.dueDate &&
            t.dueDate < now
        ).length;
        return {
          id: r.id,
          title: r.title,
          status: r.status,
          company: r.company,
          empreendimento: r.empreendimento,
          lastActivityAt,
          overdueCount,
        };
      })
      .filter((r) => !r.lastActivityAt || r.lastActivityAt < riskCutoff)
      .sort((a, b) => b.overdueCount - a.overdueCount);

    return { upcoming, overdue, atRisk, riskDays };
  },
};
