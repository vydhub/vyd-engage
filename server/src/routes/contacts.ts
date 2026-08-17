import { Router } from 'express';
import { z } from 'zod';
import { InteractionType, InteractionDirection, LeadSource } from '@prisma/client';
import prisma from '../config/database.js';
import { apiKeyAuth, apiKeyRateLimiter, requireScope } from '../middleware/apiKeyAuth.js';
import { createError } from '../middleware/errorHandler.js';
import { leadService } from '../services/leadService.js';
import { taskService } from '../services/taskService.js';
import { interactionService } from '../services/interactionService.js';

/**
 * Contatos — resolução por telefone para a extensão Chrome (Upgrade RD P3, req 24).
 *
 * Autenticação por `X-API-Key` (apiKeyAuth + escopo `contacts:read`), NÃO por
 * sessão/cookie — portanto FORA do CSRF (o CSRF é por whitelist em index.ts e
 * este grupo não é incluído). O CORS libera o header `x-api-key` para a extensão.
 *
 * Contrato de `GET /contacts/resolve?phone=`:
 *   { lead?, company?, deals[], lastInteractions[] } — tudo tenant-scoped pelo
 *   tenant do apiKey. Ações rápidas da extensão (criar lead/tarefa/nota) reusam
 *   os endpoints existentes com escopos próprios (leads:write, tasks:write).
 */

const router = Router();

// Todo o grupo autentica por API key + rate-limit por chave (1000/min).
router.use(apiKeyAuth);
router.use(apiKeyRateLimiter);

/**
 * GET /api/v1/contacts/health-stub
 * Sonda leve do grupo (confirma auth por API key). Não expõe dados do tenant:
 * a resposta é apenas `{ ok: true }`, sem tenantId nem qualquer dado da chave.
 */
router.get('/health-stub', (req, res, next) => {
  if (!req.apiKey) return next(createError('API key authentication required', 401));
  res.json({ status: 200, data: { ok: true } });
});

/** Normaliza o telefone para busca: mantém apenas dígitos. */
export function normalizePhoneDigits(raw: string): string {
  return raw.replace(/\D+/g, '');
}

// ── Match de telefone por DÍGITOS COMPLETOS (réplica da semântica de
//    copilotService/whatsappMessagingService) ────────────────────────────────
// O `$queryRaw` abaixo busca CANDIDATOS por um sufixo curto de dígitos (barato e
// tolerante a máscara/DDI no banco), mas a DECISÃO de match é feita aqui em JS
// pelos dígitos COMPLETOS — tolerando apenas a presença/ausência do DDI 55 de UM
// dos lados. Isso evita o bug de dois números com o mesmo sufixo (DDDs diferentes)
// resolverem o contato errado.

/** Mantém apenas dígitos de um telefone. */
function digitsOnly(raw: string): string {
  return (raw || '').replace(/\D+/g, '');
}

/**
 * Normaliza um telefone para comparação: retorna o número em dígitos e a variante
 * sem o prefixo de DDI 55 (quando presente). Dois números casam se os dígitos
 * COMPLETOS batem, ou se batem depois de remover o '55' inicial de UM dos lados —
 * assim toleramos apenas a presença/ausência do DDI brasileiro, sem colidir por
 * sufixo (o bug: mesmos dígitos finais em DDDs diferentes casaria o contato errado).
 */
function phoneVariants(raw: string): string[] {
  const d = digitsOnly(raw);
  if (!d) return [];
  const variants = new Set<string>([d]);
  if (d.startsWith('55') && d.length > 2) variants.add(d.slice(2));
  return [...variants];
}

/** Dois telefones casam se compartilham alguma variante normalizada (com/sem DDI 55). */
function phonesMatch(a: string, b: string): boolean {
  const va = phoneVariants(a);
  const vb = phoneVariants(b);
  if (va.length === 0 || vb.length === 0) return false;
  return va.some((x) => vb.includes(x));
}

const resolveQuerySchema = z.object({
  phone: z.string().min(4, 'Telefone inválido'),
});

/**
 * GET /api/v1/contacts/resolve?phone=
 * Resolve um número de telefone no CRM (tenant do apiKey) → lead/empresa/deals/
 * últimas interações. Requer escopo `contacts:read` (chaves legadas sem escopo
 * têm acesso total). Busca por sufixo de dígitos para tolerar máscara/DDI.
 */
router.get('/resolve', requireScope('contacts:read'), async (req, res, next) => {
  try {
    if (!req.apiKey) return next(createError('API key authentication required', 401));
    const tenantId = req.apiKey.tenantId;

    const parsed = resolveQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', parsed.error.errors));
    }

    const digits = normalizePhoneDigits(parsed.data.phone);
    if (digits.length < 4) {
      return next(createError('Telefone inválido', 400, 'VALIDATION_ERROR'));
    }
    // Sufixo de até 9 dígitos (número local BR sem DDI) para tolerar variações
    // de máscara/DDI entre WhatsApp e o cadastro.
    const suffix = digits.slice(-9);

    // Leads cujo telefone, comparado SÓ pelos dígitos, termina no mesmo sufixo.
    // O `contains` do Prisma casa a coluna crua, então telefones gravados COM
    // máscara ("(11) 99999-0000") não bateriam. Normalizamos os dígitos no banco
    // via regexp_replace do Postgres e buscamos CANDIDATOS por sufixo. Query
    // PARAMETRIZADA (tenantId e sufixo NUNCA concatenados) — imune a SQL injection.
    // Filtro por tenant e soft-delete sempre aplicados. Tabela real: "Lead" (sem
    // @@map). O sufixo é só um pré-filtro barato; a decisão de match é por DÍGITOS
    // COMPLETOS em JS (phonesMatch), evitando que dois números com o mesmo sufixo
    // (DDDs diferentes) resolvam o lead errado. Trazemos vários candidatos.
    const leadCandidates = await prisma.$queryRaw<{ id: string; phone: string | null }[]>`
      SELECT "id", "phone" FROM "Lead"
      WHERE "tenantId" = ${tenantId}
        AND "deletedAt" IS NULL
        AND regexp_replace(COALESCE("phone", ''), '[^0-9]', '', 'g') LIKE ${'%' + suffix}
      ORDER BY "createdAt" DESC
      LIMIT 20`;

    // Filtra por dígitos COMPLETOS (tolerando só o DDI 55). Só sobra o candidato
    // cujos dígitos realmente casam com o telefone consultado — sem colisão por
    // sufixo. Se nenhum casar completo → sem lead.
    const leadMatch = leadCandidates.find((c) => phonesMatch(c.phone || '', parsed.data.phone));

    // Rehidrata o lead pelo id (mantém o select tipado atual + tenant-scope).
    const lead = leadMatch
      ? await prisma.lead.findFirst({
          where: { id: leadMatch.id, tenantId, deletedAt: null },
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            company: true,
            companyId: true,
          },
        })
      : null;

    // Resolução da empresa (tenant-scoped), lead-first ESTRITO:
    //  - Se HÁ lead, a empresa vem EXCLUSIVAMENTE do lead.companyId. Sem companyId
    //    (ou empresa indisponível/soft-deleted) → company=null. NUNCA caímos no
    //    fallback por telefone quando há lead, para não exibir uma empresa "órfã"
    //    sem relação com o lead (o vínculo do lead é a verdade da associação).
    //  - O fallback de empresa por sufixo de telefone fica só para o caso SEM lead.
    let company: { id: string; name: string; phone: string | null } | null = null;
    if (lead) {
      if (lead.companyId) {
        company = await prisma.company.findFirst({
          where: { id: lead.companyId, tenantId, deletedAt: null },
          select: { id: true, name: true, phone: true },
        });
        // Lead tem companyId porém empresa indisponível → company=null (sem fallback).
      }
      // Lead sem companyId → company=null (sem fallback por telefone).
    } else {
      // Fallback por telefone (SÓ quando não há lead): mesma normalização por
      // dígitos no banco, para casar empresas cujo telefone foi gravado com
      // máscara. Query PARAMETRIZADA. Tabela real: "Company" (sem @@map). Igual ao
      // lead: sufixo é só pré-filtro; a decisão é por DÍGITOS COMPLETOS (phonesMatch),
      // evitando colisão por sufixo entre DDDs diferentes.
      const companyCandidates = await prisma.$queryRaw<{ id: string; phone: string | null }[]>`
        SELECT "id", "phone" FROM "Company"
        WHERE "tenantId" = ${tenantId}
          AND "deletedAt" IS NULL
          AND regexp_replace(COALESCE("phone", ''), '[^0-9]', '', 'g') LIKE ${'%' + suffix}
        ORDER BY "createdAt" DESC
        LIMIT 20`;
      const companyMatch = companyCandidates.find((c) =>
        phonesMatch(c.phone || '', parsed.data.phone)
      );
      company = companyMatch
        ? await prisma.company.findFirst({
            where: { id: companyMatch.id, tenantId, deletedAt: null },
            select: { id: true, name: true, phone: true },
          })
        : null;
    }

    // Deals e interações:
    //  - Com lead → ligados ao lead.
    //  - Sem lead, porém com empresa resolvida → ligados diretamente à empresa
    //    (companyId), tenant-scoped, para que a extensão veja o histórico da
    //    empresa mesmo quando o telefone não bate em nenhum lead.
    let deals: Array<{
      id: string;
      name: string;
      stage: unknown;
      status: unknown;
      value: unknown;
    }> = [];
    let lastInteractions: Array<{
      id: string;
      type: unknown;
      direction: unknown;
      content: string;
      createdAt: Date;
    }> = [];

    if (lead) {
      deals = await prisma.deal.findMany({
        where: { tenantId, deletedAt: null, leadId: lead.id },
        select: { id: true, name: true, stage: true, status: true, value: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      lastInteractions = await prisma.interaction.findMany({
        where: { tenantId, leadId: lead.id, deletedAt: null },
        select: { id: true, type: true, direction: true, content: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });
    } else if (company) {
      deals = await prisma.deal.findMany({
        where: { tenantId, deletedAt: null, companyId: company.id },
        select: { id: true, name: true, stage: true, status: true, value: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      lastInteractions = await prisma.interaction.findMany({
        where: { tenantId, companyId: company.id, deletedAt: null },
        select: { id: true, type: true, direction: true, content: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });
    }

    res.json({
      status: 200,
      data: {
        lead: lead
          ? {
              id: lead.id,
              name: lead.name,
              email: lead.email,
              phone: lead.phone,
              company: lead.company,
            }
          : null,
        company,
        deals,
        lastInteractions,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ── Ações rápidas da extensão (Upgrade RD P3, req 24) ──────────────────────────
// A extensão Chrome autentica por `X-API-Key`; as rotas de escrita padrão
// (/leads, /tasks, /interactions) exigem sessão JWT e NÃO aceitam API key. Estas
// rotas espelham essas ações no grupo `/contacts` (apiKeyAuth + escopo próprio +
// CSRF-exempt), sem enfraquecer nenhuma rota JWT existente. Tenant vem do apiKey.

/** POST /api/v1/contacts/leads — cria um lead (extensão). Escopo `leads:write`. */
const createLeadSchema = z.object({
  name: z.string().min(1, 'Nome obrigatório'),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  company: z.string().optional(),
});
router.post('/leads', requireScope('leads:write'), async (req, res, next) => {
  try {
    if (!req.apiKey) return next(createError('API key authentication required', 401));
    const parsed = createLeadSchema.safeParse(req.body);
    if (!parsed.success) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', parsed.error.errors));
    }
    // Impõe a cota do plano do tenant (mesmo padrão da rota JWT POST /leads):
    // a criação pela extensão NÃO pode furar o limite de leads do plano.
    const { planLimitsService } = await import('../services/planLimitsService.js');
    await planLimitsService.enforceLimit(req.apiKey.tenantId, 'leads');
    const lead = await leadService.create(req.apiKey.tenantId, {
      ...parsed.data,
      // Origem fixa: veio pela extensão do WhatsApp. WHATSAPP não é um LeadSource
      // válido; usamos OTHER (o enum não tem canal de mensageria dedicado).
      source: LeadSource.OUTROS,
    });
    res.status(201).json({ status: 201, data: lead });
  } catch (error) {
    next(error);
  }
});

/** POST /api/v1/contacts/tasks — cria uma tarefa (extensão). Escopo `tasks:write`. */
const createTaskSchema = z.object({
  title: z.string().min(1, 'Título obrigatório'),
  description: z.string().optional(),
  leadId: z.string().optional(),
  // Uma tarefa da extensão pode nascer de um contato resolvido SÓ por empresa
  // (sem lead). Aceita companyId opcional para não deixar a tarefa órfã.
  companyId: z.string().optional(),
  dueDate: z.string().optional(),
});
router.post('/tasks', requireScope('tasks:write'), async (req, res, next) => {
  try {
    if (!req.apiKey) return next(createError('API key authentication required', 401));
    const parsed = createTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', parsed.error.errors));
    }
    // Se veio leadId, garante que pertence ao tenant do apiKey (não vaza cross-tenant).
    if (parsed.data.leadId) {
      const lead = await prisma.lead.findFirst({
        where: { id: parsed.data.leadId, tenantId: req.apiKey.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!lead) return next(createError('Lead não encontrado', 404, 'LEAD_NOT_FOUND'));
    }
    // Valida a empresa cross-tenant (não vaza empresa de outro tenant).
    if (parsed.data.companyId) {
      const company = await prisma.company.findFirst({
        where: { id: parsed.data.companyId, tenantId: req.apiKey.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!company) return next(createError('Empresa não encontrada', 404, 'COMPANY_NOT_FOUND'));
    }
    const task = await taskService.create(req.apiKey.tenantId, {
      title: parsed.data.title,
      description: parsed.data.description,
      leadId: parsed.data.leadId,
      companyId: parsed.data.companyId,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : undefined,
    });
    res.status(201).json({ status: 201, data: task });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/contacts/notes — registra uma nota/interação (extensão). Reusa o
 * escopo `contacts:read` NÃO seria correto p/ escrita — usamos `leads:write` por
 * ser a permissão de escrita sobre o contato vinculado.
 */
const createNoteSchema = z
  .object({
    content: z.string().min(1, 'Conteúdo obrigatório'),
    leadId: z.string().optional(),
    // Uma nota da extensão pode ser vinculada a um contato resolvido SÓ por
    // empresa (sem lead). Aceita companyId opcional para não deixar a nota órfã.
    companyId: z.string().optional(),
  })
  // Exige ao menos um alvo — do contrário a nota ficaria sem vínculo.
  .refine((d) => Boolean(d.leadId || d.companyId), {
    message: 'Informe leadId ou companyId',
    path: ['leadId'],
  });
router.post('/notes', requireScope('leads:write'), async (req, res, next) => {
  try {
    if (!req.apiKey) return next(createError('API key authentication required', 401));
    const parsed = createNoteSchema.safeParse(req.body);
    if (!parsed.success) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', parsed.error.errors));
    }
    if (parsed.data.leadId) {
      const lead = await prisma.lead.findFirst({
        where: { id: parsed.data.leadId, tenantId: req.apiKey.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!lead) return next(createError('Lead não encontrado', 404, 'LEAD_NOT_FOUND'));
    }
    // Valida a empresa cross-tenant (não vaza empresa de outro tenant).
    if (parsed.data.companyId) {
      const company = await prisma.company.findFirst({
        where: { id: parsed.data.companyId, tenantId: req.apiKey.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!company) return next(createError('Empresa não encontrada', 404, 'COMPANY_NOT_FOUND'));
    }
    const interaction = await interactionService.create(req.apiKey.tenantId, {
      type: InteractionType.NOTE,
      direction: InteractionDirection.OUTBOUND,
      content: parsed.data.content,
      leadId: parsed.data.leadId,
      companyId: parsed.data.companyId,
    });
    res.status(201).json({ status: 201, data: interaction });
  } catch (error) {
    next(error);
  }
});

export default router;
