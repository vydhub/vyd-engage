import { Router } from 'express';
import { z } from 'zod';
import { leadService } from '../services/leadService.js';
import { getLeadNextActionWithReasoning } from '../services/nextActionService.js';
import { aiAssistantService } from '../services/aiAssistantService.js';
import { requirePermission } from '../middleware/auth.js';
import { authenticateOrApiKey } from '../middleware/apiKeyAuth.js';
import { tenantScope } from '../middleware/tenant.js';
import { aiLimiter } from '../middleware/rateLimit.js';
import { createError } from '../middleware/errorHandler.js';
import { LeadStatus, LeadSource, LeadStatusReason, NotificationType, ApprovalType } from '@prisma/client';
import { normalizeLeadStatus, normalizeLeadSource } from '../utils/leadLegacy.js';
import {
  TERMINAL_LEAD_STATUSES,
  LEAD_STATUS_REASON_LABELS,
  LEAD_STATUS_LABELS,
  assertStatusReason,
} from '../services/leadService.js';
import { parseBrNumber, normalizeName, normalizeCnpj } from '../services/importService.js';
import { notificationService } from '../services/notificationService.js';
import prisma from '../config/database.js';
import { createAuditLog } from '../utils/auditLogger.js';
import { getEffective, visibilityScope } from '../services/permissionService.js';
import { approvalService } from '../services/approvalService.js';
import { emitToTenant } from '../services/socketService.js';

const router = Router();

// All routes require authentication and tenant scope
router.use(authenticateOrApiKey('leads:read'));
router.use(tenantScope);

/**
 * Campo opcional cujo valor vazio vindo da UI significa "não informado".
 *
 * Um `<input>` não preenchido manda `''`, e `.optional()` do Zod só aceita
 * `undefined` — então `z.string().email().optional()` REPROVA a string vazia.
 * Era isso que devolvia 400 "Validation error" ao salvar um lead sem e-mail
 * (campo que a tela trata como opcional). Vale igual para `assignedTo`, onde
 * `''` reprovaria no `.uuid()`.
 */
const vazioComoAusente = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema);

// Exportado para o teste de contrato (createLeadPayload.test.ts) validar o
// schema REAL da rota — uma cópia divergiria em silêncio.
export const createLeadSchema = z.object({
  name: z.string().min(1),
  email: vazioComoAusente(z.string().email().optional()),
  phone: z.string().optional(),
  company: z.string().optional(),
  position: z.string().optional(),
  // Vínculo OBRIGATÓRIO na criação manual (req. 1); a coerência (tenant,
  // isContact, mesma empresa) é validada no leadService.
  companyId: z.string().uuid({ message: 'Empresa é obrigatória' }),
  contactId: z.string().uuid({ message: 'Contato é obrigatório' }),
  status: z.nativeEnum(LeadStatus).optional(),
  source: z.nativeEnum(LeadSource).optional(),
  statusReason: z.nativeEnum(LeadStatusReason).optional(),
  statusReasonNote: z.string().max(2000).optional(),
  estimatedValue: z.number().nonnegative().optional(),
  estimatedTimeline: z.string().max(500).optional(),
  probabilityGoGet: z
    .number()
    .int({ message: 'Probabilidade Go×Get deve ser um número inteiro entre 0 e 100' })
    .min(0, { message: 'Probabilidade Go×Get deve ser um número inteiro entre 0 e 100' })
    .max(100, { message: 'Probabilidade Go×Get deve ser um número inteiro entre 0 e 100' })
    .optional(),
  score: z.number().int().min(0).max(100).optional(),
  customFields: z.record(z.any()).optional(),
  notes: z.string().optional(),
  assignedTo: vazioComoAusente(z.string().uuid().optional()),
  tagIds: z.array(z.string().uuid()).optional(),
});

// Edição não força os vínculos (leads legados continuam editáveis — caso 1);
// quando enviados, o serviço valida a coerência do par final. Os campos de
// oportunidade aceitam NULL explícito para permitir LIMPAR o valor na edição
// (req. 9 — sem isso, apagar um campo salvava silenciosamente o valor antigo).
export const updateLeadSchema = createLeadSchema.partial().extend({
  id: z.string().uuid(),
  notes: z.string().nullable().optional(),
  estimatedValue: z.number().nonnegative().nullable().optional(),
  estimatedTimeline: z.string().max(500).nullable().optional(),
  probabilityGoGet: z
    .number()
    .int({ message: 'Probabilidade Go×Get deve ser um número inteiro entre 0 e 100' })
    .min(0, { message: 'Probabilidade Go×Get deve ser um número inteiro entre 0 e 100' })
    .max(100, { message: 'Probabilidade Go×Get deve ser um número inteiro entre 0 e 100' })
    .nullable()
    .optional(),
  assignedTo: vazioComoAusente(z.string().uuid().nullable().optional()),
});

const querySchema = z.object({
  // Aceita também os valores LEGADOS de status/origem (SavedViews antigas) e
  // os traduz para a régua nova — ver utils/leadLegacy.ts.
  status: z.preprocess(normalizeLeadStatus, z.nativeEnum(LeadStatus).optional()),
  source: z.preprocess(normalizeLeadSource, z.nativeEnum(LeadSource).optional()),
  search: z.string().optional(),
  tagId: z.string().uuid().optional(),
  assignedTo: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  // z.coerce.boolean() é uma armadilha: Boolean('false') === true. Mapeamos
  // explicitamente a string 'true'/'false' para evitar a aba Leads filtrar
  // isContact=true por engano.
  isContact: z.preprocess(
    (v) => (v === 'true' ? true : v === 'false' ? false : undefined),
    z.boolean().optional()
  ),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  sort: z.enum(['createdAt', 'updatedAt', 'name', 'status', 'score']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

// GET /api/leads - List all leads
router.get('/', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const filters = querySchema.parse(req.query);
    // Visibilidade viva (req 14): contatos/leads. DEFAULT == HOJE: builtins têm
    // contacts=GERAL → escopo undefined → SEM filtro por dono (idêntico a hoje,
    // pois a lista de leads não escopava por dono). Perfil custom PROPRIA/EQUIPE
    // aplica o filtro por `assignedTo`.
    const scope = await visibilityScope(req.user, 'contacts', filters.assignedTo);
    const result = await leadService.findAll(req.user.tenantId, filters, scope);
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
    }
    next(error);
  }
});

// PATCH /api/leads/bulk — Bulk operations on leads
// Enforcement de capability (req 13): ações em massa exigem `bulkActions`.
// FAIL-CLOSED — sem perfil custom, USER/GESTOR/ADMIN têm bulkActions=true (== hoje).
router.patch('/bulk', requirePermission('bulkActions'), async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const bulkSchema = z.object({
      ids: z.array(z.string().uuid()).min(1).max(500),
      action: z.enum(['change_status', 'add_tag', 'remove_tag', 'assign_user', 'delete']),
      payload: z.any().optional(),
    });

    const { ids, action, payload } = bulkSchema.parse(req.body);
    const tenantId = req.user.tenantId;

    // Verify all leads belong to tenant
    const count = await prisma.lead.count({
      where: { id: { in: ids }, tenantId, deletedAt: null },
    });
    if (count !== ids.length) {
      return next(createError('Some leads not found', 404));
    }

    // Gate de aprovação (req 15): se o perfil exige aprovação p/ ações em massa,
    // cria a solicitação (não aplica) e responde 202. Sem perfil custom,
    // requireApprovalFor.bulk=false → aplica normalmente (== hoje).
    const effective = await getEffective({
      userId: req.user.userId,
      tenantId,
      role: req.user.role,
      isPlatformAdmin: req.user.isPlatformAdmin,
    });
    if (effective.requireApprovalFor.bulk) {
      const { approvalId, pending } = await approvalService.createApproval({
        tenantId,
        requestedById: req.user.userId,
        type: ApprovalType.BULK,
        payload: { entity: 'leads', ids, action, params: payload ?? undefined },
        summary: `Ação em massa "${action}" em ${ids.length} lead(s)`,
      });
      return res.status(202).json({ status: 202, data: { approvalId, pending } });
    }

    let affected = 0;

    switch (action) {
      case 'change_status': {
        const statusValue = z.nativeEnum(LeadStatus).parse(payload?.status);
        // Motivo obrigatório também no bulk (req. 14 + caso extremo 7):
        // um único motivo é aplicado ao lote inteiro.
        const statusReason = payload?.statusReason
          ? z.nativeEnum(LeadStatusReason).parse(payload.statusReason)
          : undefined;
        const statusReasonNote = payload?.statusReasonNote
          ? z.string().max(2000).parse(payload.statusReasonNote)
          : undefined;
        const isTerminal = TERMINAL_LEAD_STATUSES.includes(statusValue);
        if (isTerminal) {
          assertStatusReason(statusValue, statusReason, statusReasonNote);
        }
        // Status atual de cada lead ANTES do update — a timeline registra a
        // transição real (anterior → novo, req. 15) e leads já no status de
        // destino não ganham interaction redundante.
        const currentLeads = await prisma.lead.findMany({
          where: { id: { in: ids }, tenantId },
          select: { id: true, status: true },
        });
        await prisma.lead.updateMany({
          where: { id: { in: ids }, tenantId },
          data: isTerminal
            ? { status: statusValue, statusReason, statusReasonNote: statusReasonNote ?? null }
            : { status: statusValue, statusReason: null, statusReasonNote: null },
        });
        // Timeline por lead (req. 15) — lote já é limitado a 500 ids.
        const reasonLabel = statusReason ? LEAD_STATUS_REASON_LABELS[statusReason] : null;
        const changedLeads = currentLeads.filter((l) => l.status !== statusValue);
        await prisma.interaction
          .createMany({
            data: changedLeads.map((l) => ({
              tenantId,
              leadId: l.id,
              type: 'STATUS_CHANGE' as const,
              direction: 'OUTBOUND' as const,
              subject: 'Mudança de status (em massa)',
              content: `Status alterado de "${LEAD_STATUS_LABELS[l.status]}" para "${LEAD_STATUS_LABELS[statusValue]}"${reasonLabel ? `. Motivo: ${reasonLabel}` : ''}${statusReasonNote ? `. Nota: ${statusReasonNote}` : ''}`,
              userId: req.user!.userId,
              metadata: {
                previousStatus: l.status,
                newStatus: statusValue,
                statusReason: statusReason ?? null,
                statusReasonNote: statusReasonNote ?? null,
                bulk: true,
              },
            })),
          })
          .catch(() => {});
        affected = ids.length;
        break;
      }
      case 'add_tag': {
        const tagId = z.string().uuid().parse(payload?.tagId);
        for (const leadId of ids) {
          await prisma.leadTag
            .create({
              data: { leadId, tagId },
            })
            .catch(() => {}); // Skip if already connected (unique constraint)
        }
        affected = ids.length;
        break;
      }
      case 'remove_tag': {
        const tagId = z.string().uuid().parse(payload?.tagId);
        await prisma.leadTag.deleteMany({
          where: { leadId: { in: ids }, tagId },
        });
        affected = ids.length;
        break;
      }
      case 'assign_user': {
        const userId = payload?.userId ? z.string().uuid().parse(payload.userId) : null;
        // transferOwner (req 13): a reatribuição em massa só é BLOQUEADA quando um
        // perfil CUSTOM desliga transferOwner explicitamente — nunca por omissão.
        // FAIL-CLOSED / BYTE-A-BYTE == HOJE: sem perfil custom (profileHasCustom
        // === false) os builtins reatribuem em massa exatamente como hoje
        // (USER/GESTOR/ADMIN via bulkActions), sem regressão.
        if (effective.hasCustomProfile && effective.capabilities.transferOwner !== true) {
          return next(createError('Insufficient permissions', 403, 'INSUFFICIENT_PERMISSIONS'));
        }
        await prisma.lead.updateMany({
          where: { id: { in: ids }, tenantId },
          data: { assignedTo: userId },
        });
        affected = ids.length;
        break;
      }
      case 'delete': {
        // Soft-delete (req 16): vai para a Lixeira (deletedAt), NÃO hard-delete.
        // Um AuditLog 'delete' por lead registra quem/quando (autor = solicitante).
        const now = new Date();
        await prisma.lead.updateMany({
          where: { id: { in: ids }, tenantId },
          data: { deletedAt: now },
        });
        for (const leadId of ids) {
          await approvalService.writeDeleteAudit(tenantId, 'leads', leadId, req.user.userId);
        }
        affected = ids.length;
        // Invalidate plan limits cache
        const { planLimitsService } = await import('../services/planLimitsService.js');
        planLimitsService.invalidateUsage(tenantId).catch(() => {});
        break;
      }
    }

    res.json({ status: 200, data: { affected, action } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
    }
    next(error);
  }
});

// GET /api/leads/duplicates — Find duplicate lead groups
router.get('/duplicates', async (req, res, next) => {
  try {
    if (!req.user) return next(createError('Authentication required', 401));
    const tenantId = req.user.tenantId;

    // Find duplicate emails
    const emailDupes = (await prisma.$queryRaw`
      SELECT email, array_agg(id) as lead_ids, count(*) as cnt
      FROM "Lead"
      WHERE "tenantId" = ${tenantId} AND email IS NOT NULL AND email != ''
      GROUP BY email
      HAVING count(*) > 1
      ORDER BY count(*) DESC
      LIMIT 100
    `) as any[];

    // Find duplicate phones (only where email is null, to avoid double-counting)
    const phoneDupes = (await prisma.$queryRaw`
      SELECT phone, array_agg(id) as lead_ids, count(*) as cnt
      FROM "Lead"
      WHERE "tenantId" = ${tenantId} AND phone IS NOT NULL AND phone != ''
      AND email IS NULL
      GROUP BY phone
      HAVING count(*) > 1
      ORDER BY count(*) DESC
      LIMIT 100
    `) as any[];

    // Collect all lead IDs
    const allIds = new Set<string>();
    for (const g of [...emailDupes, ...phoneDupes]) {
      for (const id of g.lead_ids) allIds.add(id);
    }

    // Fetch full lead data
    const leads =
      allIds.size > 0
        ? await prisma.lead.findMany({
            where: { id: { in: Array.from(allIds) }, deletedAt: null },
            include: { tags: { include: { tag: true } } },
          })
        : [];

    const leadMap = new Map(leads.map((l) => [l.id, l]));

    const groups = [
      ...emailDupes.map((g) => ({
        matchField: 'email' as const,
        matchValue: g.email,
        leads: (g.lead_ids as string[]).map((id) => leadMap.get(id)).filter(Boolean),
      })),
      ...phoneDupes.map((g) => ({
        matchField: 'phone' as const,
        matchValue: g.phone,
        leads: (g.lead_ids as string[]).map((id) => leadMap.get(id)).filter(Boolean),
      })),
    ];

    res.json({ status: 200, data: { groups, totalGroups: groups.length } });
  } catch (error) {
    next(error);
  }
});

// POST /api/leads/merge — Merge duplicate leads into primary
router.post('/merge', async (req, res, next) => {
  try {
    if (!req.user) return next(createError('Authentication required', 401));
    const tenantId = req.user.tenantId;

    const schema = z.object({
      primaryId: z.string().uuid(),
      duplicateIds: z.array(z.string().uuid()).min(1).max(50),
    });
    const { primaryId, duplicateIds } = schema.parse(req.body);

    // Verify all leads belong to tenant
    const allIds = [primaryId, ...duplicateIds];
    const count = await prisma.lead.count({
      where: { id: { in: allIds }, tenantId, deletedAt: null },
    });
    if (count !== allIds.length) return next(createError('Some leads not found', 404));

    // Use transaction for atomicity
    await prisma.$transaction(async (tx) => {
      // Move interactions to primary
      await tx.interaction.updateMany({
        where: { leadId: { in: duplicateIds } },
        data: { leadId: primaryId },
      });

      // Move tasks to primary
      await tx.task.updateMany({
        where: { leadId: { in: duplicateIds } },
        data: { leadId: primaryId },
      });

      // Move automation logs to primary
      await tx.automationLog.updateMany({
        where: { leadId: { in: duplicateIds } },
        data: { leadId: primaryId },
      });

      // Delete duplicates (cascade will remove LeadTag entries)
      await tx.lead.deleteMany({
        where: { id: { in: duplicateIds } },
      });
    });

    const primary = await prisma.lead.findUnique({
      where: { id: primaryId },
      include: { tags: { include: { tag: true } } },
    });

    res.json({ status: 200, data: { primary, mergedCount: duplicateIds.length } });
  } catch (error) {
    if (error instanceof z.ZodError)
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
    next(error);
  }
});

// GET /api/leads/export — Export leads (supports format=json|csv|xlsx)
router.get('/export', async (req, res, next) => {
  try {
    if (!req.user) return next(createError('Authentication required', 401));

    const { exportLeads } = await import('../services/exportService.js');
    const format = (
      ['csv', 'xlsx', 'json'].includes(String(req.query.format || '').toLowerCase())
        ? String(req.query.format).toLowerCase()
        : 'json'
    ) as 'json' | 'csv' | 'xlsx';

    const filters = {
      status: req.query.status as string | undefined,
      source: req.query.source as string | undefined,
      search: req.query.search as string | undefined,
      tagId: req.query.tagId as string | undefined,
      assignedTo: req.query.assignedTo as string | undefined,
    };

    await exportLeads(req.user.tenantId, filters, format, res);
  } catch (error) {
    next(error);
  }
});

// GET /api/leads/stats/count - Get lead count (MUST be before /:id)
router.get('/stats/count', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const count = await leadService.count(req.user.tenantId);
    res.json({ count });
  } catch (error) {
    next(error);
  }
});

// GET /api/leads/:id/next-action - Suggested next action with AI reasoning (reqs 10, 13, 15)
router.get('/:id/next-action', aiLimiter, async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const action = await getLeadNextActionWithReasoning(req.user.tenantId, req.params.id);
    res.json({ status: 200, data: action });
  } catch (error) {
    next(error);
  }
});

// GET /api/leads/:id/ai-summary - Contextual AI summary of the lead (req 8)
router.get('/:id/ai-summary', aiLimiter, async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const summary = await aiAssistantService.generateLeadSummary(req.user.tenantId, req.params.id);
    res.json({ status: 200, data: summary });
  } catch (error) {
    next(error);
  }
});

// POST /api/leads/:id/ai-chat - Contextual AI chat, streamed as raw text (req 30)
const aiChatSchema = z.object({
  message: z.string().min(1).max(4000),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      })
    )
    .optional()
    .default([]),
});

router.post('/:id/ai-chat', aiLimiter, async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const data = aiChatSchema.parse(req.body);

    const result = await aiAssistantService.streamLeadChat(
      req.user.tenantId,
      req.params.id,
      data.message,
      data.history
    );

    // Stream tokens as a raw text/plain stream so the frontend can read it via
    // ReadableStream without the `ai` package.
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');

    try {
      for await (const chunk of result.textStream) {
        res.write(chunk);
      }
      res.end();
    } catch {
      // Provider dropped mid-stream — flush what we have and close (edge case).
      if (!res.writableEnded) res.end();
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
    }
    next(error);
  }
});

// POST /api/leads/:id/convert-to-opportunity — Converter em oportunidade
// (specs/leads-oportunidade req. 17-18): cria o Deal com os dados copiados e
// encerra o lead com motivo CONVERTIDO_EM_OPORTUNIDADE. Exige capability de
// criação de deals (é um deal que nasce aqui).
router.post('/:id/convert-to-opportunity', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const eff = await getEffective({
      userId: req.user.userId,
      tenantId: req.user.tenantId,
      role: req.user.role,
      isPlatformAdmin: req.user.isPlatformAdmin,
    });
    if (!eff.entities.deals.create) {
      return next(createError('Insufficient permissions', 403, 'INSUFFICIENT_PERMISSIONS'));
    }

    const result = await leadService.convertToOpportunity(
      req.user.tenantId,
      req.params.id,
      req.user.userId
    );
    res.status(result.alreadyConverted ? 200 : 201).json({ status: 200, data: result });
  } catch (error) {
    next(error);
  }
});

// POST /api/leads/:id/convert - Convert lead to contact
router.post('/:id/convert', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const lead = await leadService.convertToContact(req.params.id, req.user.tenantId);
    res.json({ status: 200, data: lead });
  } catch (error) {
    next(error);
  }
});

// POST /api/leads/:id/revert - Revert contact to lead
router.post('/:id/revert', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const lead = await leadService.revertToLead(req.params.id, req.user.tenantId);
    res.json({ status: 200, data: lead });
  } catch (error) {
    next(error);
  }
});

// POST /api/leads/:id/send-email - E-mail 1:1 pelo lead/contato (Upgrade RD P0,
// req 11): modelo do tenant OU assunto/corpo avulsos; variáveis {{nome}}
// {{empresa}} (negociacao/valor vazios sem deal) {{responsavel}}; exige
// EmailConfig verificada (400 claro se ausente); registra Interaction EMAIL
// OUTBOUND com leadId e SEM dealId.
const sendLeadEmailSchema = z
  .object({
    templateId: z.string().uuid().optional(),
    subject: z.string().min(1).max(500).optional(),
    html: z.string().min(1).optional(),
  })
  .refine((body) => body.templateId || (body.subject && body.html), {
    message: 'Informe um modelo de e-mail (templateId) ou assunto e corpo (subject + html).',
  });

router.post('/:id/send-email', async (req, res, next) => {
  try {
    if (!req.user) return next(createError('Authentication required', 401));
    const body = sendLeadEmailSchema.parse(req.body);
    const { sendLeadEmail } = await import('../services/emailOneToOneService.js');
    const result = await sendLeadEmail(req.user.tenantId, req.user.userId, req.params.id, body);
    res.json({ status: 200, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
    }
    next(error);
  }
});

// GET /api/leads/:id/audit - Get audit trail for a lead
router.get('/:id/audit', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }
    const { id } = req.params;
    const { tenantId } = req.user;
    const logs = await prisma.auditLog.findMany({
      where: { entityType: 'lead', entityId: id, tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { user: { select: { name: true, email: true } } },
    });
    res.json({ status: 200, data: { logs } });
  } catch (err) {
    next(err);
  }
});

// GET /api/leads/:id - Get lead by ID
router.get('/:id', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const lead = await leadService.findById(req.user.tenantId, req.params.id);
    res.json(lead);
  } catch (error) {
    next(error);
  }
});

// POST /api/leads/contacts — Cadastro rápido de CONTATO (pessoa do cliente)
// vinculado a uma empresa (specs/leads-oportunidade reqs. 4 e 36). Contato é um
// Lead com isContact=true; usado pelos quick-creates inline (form de lead e
// participantes de atividade).
const createContactSchema = z.object({
  name: z.string().min(1),
  companyId: z.string().uuid({ message: 'Empresa é obrigatória' }),
  position: z.string().optional(),
  email: vazioComoAusente(z.string().email().optional()),
  phone: z.string().optional(),
});

router.post('/contacts', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const eff = await getEffective({
      userId: req.user.userId,
      tenantId: req.user.tenantId,
      role: req.user.role,
      isPlatformAdmin: req.user.isPlatformAdmin,
    });
    if (!eff.entities.leads.create) {
      return next(createError('Insufficient permissions', 403, 'INSUFFICIENT_PERMISSIONS'));
    }

    // Contato conta como Lead no limite do plano (caso extremo 6)
    const { planLimitsService } = await import('../services/planLimitsService.js');
    await planLimitsService.enforceLimit(req.user.tenantId, 'leads');

    const data = createContactSchema.parse(req.body);

    const company = await prisma.company.findFirst({
      where: { id: data.companyId, tenantId: req.user.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!company) {
      return next(createError('Empresa não encontrada', 404, 'COMPANY_NOT_FOUND'));
    }

    const contact = await prisma.lead.create({
      data: {
        tenantId: req.user.tenantId,
        name: data.name,
        position: data.position,
        email: data.email,
        phone: data.phone,
        companyId: data.companyId,
        isContact: true,
        convertedAt: new Date(),
      },
    });

    planLimitsService.invalidateUsage(req.user.tenantId).catch(() => {});
    emitToTenant(req.user.tenantId, 'lead:created', { lead: contact });

    res.status(201).json({ status: 201, data: contact });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
    }
    next(error);
  }
});

// POST /api/leads - Create new lead
router.post('/', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    // Capability por-entidade (req 13): criar leads exige entities.leads.create.
    const eff = await getEffective({
      userId: req.user.userId,
      tenantId: req.user.tenantId,
      role: req.user.role,
      isPlatformAdmin: req.user.isPlatformAdmin,
    });
    if (!eff.entities.leads.create) {
      return next(createError('Insufficient permissions', 403, 'INSUFFICIENT_PERMISSIONS'));
    }

    // Check plan limits
    const { planLimitsService } = await import('../services/planLimitsService.js');
    await planLimitsService.enforceLimit(req.user.tenantId, 'leads');

    const data = createLeadSchema.parse(req.body);
    const lead = await leadService.create(req.user.tenantId, data);

    // Notify the creator that the lead was created
    notificationService
      .create(req.user.tenantId, {
        userId: req.user.userId,
        type: NotificationType.LEAD_ASSIGNED,
        title: 'Novo lead criado',
        message: `Lead "${lead.name}" foi criado com sucesso.`,
        link: `/app/leads/${lead.id}`,
        metadata: { leadId: lead.id, leadName: lead.name },
      })
      .catch(() => {});

    res.status(201).json(lead);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
    }
    next(error);
  }
});

// PUT /api/leads/:id - Update lead
router.put('/:id', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    // Capability por-entidade (req 13): editar leads exige entities.leads.edit.
    // FAIL-CLOSED / == HOJE: builtins têm entities.leads.edit=true → sem mudança.
    const eff = await getEffective({
      userId: req.user.userId,
      tenantId: req.user.tenantId,
      role: req.user.role,
      isPlatformAdmin: req.user.isPlatformAdmin,
    });
    if (!eff.entities.leads.edit) {
      return next(createError('Insufficient permissions', 403, 'INSUFFICIENT_PERMISSIONS'));
    }

    const data = updateLeadSchema.parse({
      ...req.body,
      id: req.params.id,
    });

    // Fetch existing lead for audit diff
    const existing = await prisma.lead.findUnique({
      where: { id: req.params.id, tenantId: req.user.tenantId },
    });

    const lead = await leadService.update(req.user.tenantId, data, req.user.userId);

    // Fire audit log asynchronously — must not block the response
    if (existing) {
      createAuditLog({
        tenantId: req.user.tenantId,
        entityType: 'lead',
        entityId: req.params.id,
        userId: req.user.userId,
        action: 'update',
        oldData: existing as Record<string, unknown>,
        newData: lead as Record<string, unknown>,
      }).catch(() => {});
    }

    res.json(lead);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
    }
    next(error);
  }
});

// DELETE /api/leads/:id - Delete lead
router.delete('/:id', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    // Gate de exclusão (req 16): sem permissão de exclusão OU perfil exige
    // aprovação → cria solicitação (não deleta) + 202. Sem perfil custom, USER
    // deleta direto (== hoje). Snapshot de auditoria é gravado dentro do gate.
    const gate = await approvalService.deleteGate(
      {
        userId: req.user.userId,
        tenantId: req.user.tenantId,
        role: req.user.role,
        isPlatformAdmin: req.user.isPlatformAdmin,
      },
      'leads',
      req.params.id,
      'lead'
    );
    if (gate.queued) {
      return res.status(202).json({ status: 202, data: { approvalId: gate.approvalId, pending: true } });
    }

    // Cancel any pending automation steps waiting for this lead
    await prisma.automationLog.updateMany({
      where: { leadId: req.params.id, status: 'WAITING' },
      data: { status: 'CANCELLED' },
    });

    await leadService.delete(req.user.tenantId, req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// POST /api/leads/import - Bulk import leads from CSV data

/** Rótulos de tela da origem (iguais a LEAD_SOURCE_LABELS de src/types/index.ts). */
const LEAD_SOURCE_LABELS_IMPORT: Record<LeadSource, string> = {
  PROSPECCAO_ATIVA: 'Prospecção ativa',
  PORTAL_NOTICIAS_LINKEDIN: 'Portal de Notícias/LinkedIn',
  EVENTO_FEIRA_SETORIAL: 'Evento/Feira setorial',
  NETWORKING_PESSOAL: 'Networking pessoal',
  CLIENTE_RECORRENTE: 'Cliente recorrente',
  INDICACAO_PARCEIROS: 'Indicação de parceiros',
  OUTROS: 'Outros',
};

/** Sem acento, sem caixa, só letras e dígitos: "Em Andamento" == "EM_ANDAMENTO". */
const dobrarCelula = (v: string) =>
  v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/**
 * Célula de enum da planilha: aceita o rótulo da tela, o código interno e o
 * código LEGADO (normalizeLeadStatus/normalizeLeadSource — o modelo antigo
 * trazia WEBSITE/NEW). Vazia = ausente (a rota assume o padrão); preenchida e
 * não reconhecida = erro, que recusa SÓ a linha (ver rota abaixo).
 */
function celulaEnum<T extends string>(
  coluna: string,
  valores: Record<string, T>,
  rotulos: Record<string, string>,
  legado?: (v: unknown) => unknown
) {
  const mapa = new Map<string, T>();
  for (const codigo of Object.values(valores)) {
    mapa.set(dobrarCelula(codigo), codigo);
    mapa.set(dobrarCelula(rotulos[codigo]), codigo);
  }
  return z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.string().optional()
    )
    .transform((v, ctx): T | undefined => {
      if (v === undefined) return undefined;
      const direto = mapa.get(dobrarCelula(v));
      if (direto) return direto;
      if (legado) {
        const traduzido = legado(v.trim().toUpperCase().replace(/\s+/g, '_'));
        if (typeof traduzido === 'string' && mapa.has(dobrarCelula(traduzido))) {
          return mapa.get(dobrarCelula(traduzido));
        }
      }
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${coluna}: valor "${v}" não reconhecido`,
      });
      return z.NEVER;
    });
}

const celulaTexto = (max?: number) =>
  z
    .string()
    .optional()
    .or(z.literal(''))
    .transform((v) => v?.trim() || undefined)
    .pipe(max ? z.string().max(max).optional() : z.string().optional());

/** Célula numérica opcional: vazia = ausente; `converter` decide o resto. */
const celulaNumero = (converter: (texto: string, ctx: z.RefinementCtx) => number | undefined) =>
  z
    .preprocess(
      (v) => (typeof v === 'number' ? String(v) : v),
      z.string().optional().or(z.literal(''))
    )
    .transform((v, ctx): number | undefined => {
      if (!v || !v.trim()) return undefined;
      return converter(v.trim(), ctx);
    });

// Exportado para o teste de contrato (importLeadPayload.test.ts) validar o
// schema REAL da rota. As chaves novas seguem os títulos do modelo de planilha.
export const importLeadSchema = z.object({
  name: z.string().min(1),
  email: z
    .string()
    .email()
    .optional()
    .or(z.literal(''))
    .transform((v) => v || undefined),
  phone: celulaTexto(),
  company: celulaTexto(),
  position: celulaTexto(),
  status: celulaEnum('status', LeadStatus, LEAD_STATUS_LABELS, normalizeLeadStatus),
  source: celulaEnum('source', LeadSource, LEAD_SOURCE_LABELS_IMPORT, normalizeLeadSource),
  notes: celulaTexto(),
  company_cnpj: celulaTexto(),
  contact_email: celulaTexto(),
  contact_name: celulaTexto(),
  status_reason: celulaEnum('status_reason', LeadStatusReason, LEAD_STATUS_REASON_LABELS),
  status_reason_note: celulaTexto(2000),
  estimated_value: celulaNumero((texto, ctx) => {
    const n = parseBrNumber(texto);
    if (n === undefined) {
      // Só símbolo/espaço sobrou depois da limpeza = ausente; havendo dígito
      // que não virou número, o valor está errado e a linha é recusada.
      if (/\d/.test(texto)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `estimated_value: valor "${texto}" inválido`,
        });
        return z.NEVER;
      }
      return undefined;
    }
    if (n < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'estimated_value: não pode ser negativo',
      });
      return z.NEVER;
    }
    return n;
  }),
  estimated_timeline: celulaTexto(500),
  probability_go_get: celulaNumero((texto, ctx) => {
    const n = /^\d{1,3}$/.test(texto) ? Number(texto) : NaN;
    if (!(n >= 0 && n <= 100)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'probability_go_get: use um número inteiro de 0 a 100, sem "%"',
      });
      return z.NEVER;
    }
    return n;
  }),
  assigned_to_email: celulaTexto(),
});

// Cada linha é validada POR SI na rota: uma célula ruim recusa a linha, nunca
// o arquivo (o array inteiro no Zod derrubava tudo com um 400).
const importSchema = z.object({
  leads: z.array(z.unknown()).min(1).max(1000),
  skipDuplicateEmails: z.boolean().optional().default(true),
});

type ImportRow = z.infer<typeof importLeadSchema>;

/** Primeira mensagem útil de um ZodError de linha. */
function mensagemDaLinha(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Linha inválida';
  const coluna = issue.path.join('.');
  if (issue.code === z.ZodIssueCode.custom || !coluna) return issue.message;
  if (coluna === 'name') return 'name: o nome é obrigatório';
  if (coluna === 'email') return 'email: e-mail inválido';
  return `${coluna}: ${issue.message}`;
}

/** Recusa de UMA linha por causa do conteúdo dela (não é o limite do plano). */
class LinhaRecusada extends Error {}

interface EmpresaResolvida {
  id: string;
  name: string;
  fantasyName: string | null;
  cnpj: string | null;
}

/** Resolve a empresa da linha. Devolve a empresa ou lança LinhaRecusada com o motivo. */
function resolverEmpresa(row: ImportRow, empresas: EmpresaResolvida[]): EmpresaResolvida {
  const cnpj = normalizeCnpj(row.company_cnpj);
  const nome = row.company ? normalizeName(row.company) : undefined;
  if (!cnpj && !nome) {
    throw new LinhaRecusada('Empresa obrigatória: preencha company ou company_cnpj');
  }
  const porNome = nome
    ? empresas.filter(
        (e) =>
          normalizeName(e.name) === nome || (e.fantasyName && normalizeName(e.fantasyName) === nome)
      )
    : [];
  if (cnpj) {
    const porCnpj = empresas.filter((e) => normalizeCnpj(e.cnpj) === cnpj);
    if (porCnpj.length === 0) {
      throw new LinhaRecusada(`Empresa não encontrada para o CNPJ ${row.company_cnpj}`);
    }
    if (porCnpj.length > 1) {
      throw new LinhaRecusada(`O CNPJ ${row.company_cnpj} casa mais de uma empresa cadastrada`);
    }
    if (porNome.length > 0 && !porNome.some((e) => e.id === porCnpj[0].id)) {
      throw new LinhaRecusada(
        `company_cnpj (${row.company_cnpj}) e company ("${row.company}") apontam para empresas diferentes`
      );
    }
    return porCnpj[0];
  }
  if (porNome.length === 0) throw new LinhaRecusada(`Empresa não encontrada: ${row.company}`);
  if (porNome.length > 1) {
    throw new LinhaRecusada(
      `O nome "${row.company}" casa mais de uma empresa cadastrada; informe o CNPJ em company_cnpj`
    );
  }
  return porNome[0];
}

interface ContatoResolvido {
  id: string;
  name: string;
  email: string | null;
  companyId: string | null;
}

function resolverContato(
  row: ImportRow,
  empresa: EmpresaResolvida,
  contatos: ContatoResolvido[]
): ContatoResolvido {
  const email = row.contact_email?.toLowerCase();
  const nome = row.contact_name ? normalizeName(row.contact_name) : undefined;
  if (!email && !nome) {
    throw new LinhaRecusada('Contato obrigatório: preencha contact_email ou contact_name');
  }
  const daEmpresa = contatos.filter((c) => c.companyId === empresa.id);
  const achados = email
    ? daEmpresa.filter((c) => c.email?.toLowerCase() === email)
    : daEmpresa.filter((c) => normalizeName(c.name) === nome);
  const chave = email ? `o e-mail ${row.contact_email}` : `o nome "${row.contact_name}"`;
  if (achados.length === 0) {
    throw new LinhaRecusada(
      `Contato não encontrado: ${chave} não é de um contato da empresa ${empresa.name}`
    );
  }
  if (achados.length > 1) {
    throw new LinhaRecusada(
      email
        ? `${chave} casa mais de um contato da empresa ${empresa.name}`
        : `${chave} casa mais de um contato da empresa ${empresa.name}; informe o e-mail em contact_email`
    );
  }
  return achados[0];
}

// Enforcement de capability (req 13): importar exige `importData`. FAIL-CLOSED /
// == HOJE: sem perfil custom, ADMIN/GESTOR/USER têm importData=true (a rota não
// tinha guarda de papel); só um perfil custom que desligue importData nega (403).
router.post('/import', requirePermission('importData'), async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const { leads: linhas, skipDuplicateEmails } = importSchema.parse(req.body);
    const tenantId = req.user.tenantId;

    // Check plan limits
    const { planLimitsService } = await import('../services/planLimitsService.js');

    let imported = 0;
    let skipped = 0;
    const errors: Array<{ row: number; error: string }> = [];

    // Validação POR LINHA: a linha ruim vai para `errors`, as outras seguem.
    const validas: Array<{ i: number; data: ImportRow }> = [];
    linhas.forEach((linha, i) => {
      const parsed = importLeadSchema.safeParse(linha);
      if (parsed.success) validas.push({ i, data: parsed.data });
      else errors.push({ row: i + 1, error: mensagemDaLinha(parsed.error) });
    });

    // Get existing emails for dedup
    let existingEmails = new Set<string>();
    if (skipDuplicateEmails) {
      const existing = await prisma.lead.findMany({
        where: { tenantId, email: { not: null }, deletedAt: null },
        select: { email: true },
      });
      existingEmails = new Set(
        existing.map((l: { email: string | null }) => l.email!.toLowerCase())
      );
    }
    const ehDuplicada = (d: ImportRow) =>
      skipDuplicateEmails && !!d.email && existingEmails.has(d.email.toLowerCase());

    // Vínculos em LOTE (uma consulta por tipo, não uma por linha). Só o que as
    // linhas válidas realmente pedem é consultado.
    const empresas: EmpresaResolvida[] = validas.some((v) => v.data.company || v.data.company_cnpj)
      ? await prisma.company.findMany({
          where: { tenantId, deletedAt: null },
          select: { id: true, name: true, fantasyName: true, cnpj: true },
        })
      : [];
    const emailsResponsavel = validas.some((v) => v.data.assigned_to_email);
    const responsaveis = emailsResponsavel
      ? await prisma.user.findMany({ where: { tenantId }, select: { id: true, email: true } })
      : [];
    const idPorEmail = new Map(responsaveis.map((u) => [u.email.toLowerCase(), u.id]));
    // Contatos só das empresas que alguma linha (não duplicada) resolve — uma consulta.
    const idsEmpresa = new Set<string>();
    for (const { data } of validas) {
      if (ehDuplicada(data)) continue;
      try {
        idsEmpresa.add(resolverEmpresa(data, empresas).id);
      } catch {
        // a recusa dessa linha é registrada no laço abaixo
      }
    }
    const contatos: ContatoResolvido[] = idsEmpresa.size
      ? await prisma.lead.findMany({
          where: {
            tenantId,
            isContact: true,
            deletedAt: null,
            companyId: { in: Array.from(idsEmpresa) },
          },
          select: { id: true, name: true, email: true, companyId: true },
        })
      : [];

    for (const { i, data: leadData } of validas) {
      try {
        // Duplicata é decidida ANTES da resolução de vínculos: linha pulada não gasta busca.
        if (ehDuplicada(leadData)) {
          skipped++;
          continue;
        }

        const empresa = resolverEmpresa(leadData, empresas);
        const contato = resolverContato(leadData, empresa, contatos);
        let assignedTo: string | undefined;
        if (leadData.assigned_to_email) {
          assignedTo = idPorEmail.get(leadData.assigned_to_email.toLowerCase());
          if (!assignedTo) {
            throw new LinhaRecusada(
              `Responsável não encontrado: ${leadData.assigned_to_email} não é usuário desta conta`
            );
          }
        }

        await planLimitsService.enforceLimit(tenantId, 'leads');
        await leadService.create(tenantId, {
          name: leadData.name,
          email: leadData.email,
          phone: leadData.phone,
          company: leadData.company,
          position: leadData.position,
          companyId: empresa.id,
          contactId: contato.id,
          status: leadData.status,
          source: leadData.source,
          statusReason: leadData.status_reason,
          statusReasonNote: leadData.status_reason_note,
          estimatedValue: leadData.estimated_value,
          estimatedTimeline: leadData.estimated_timeline,
          probabilityGoGet: leadData.probability_go_get,
          notes: leadData.notes,
          assignedTo,
        });

        if (leadData.email) existingEmails.add(leadData.email.toLowerCase());
        imported++;
      } catch (error: any) {
        if (!(error instanceof LinhaRecusada) && error.message?.includes('limit')) {
          errors.push({ row: i + 1, error: 'Limite do plano atingido' });
          break;
        }
        errors.push({ row: i + 1, error: error.message || 'Erro desconhecido' });
      }
    }
    errors.sort((a, b) => a.row - b.row);

    res.json({
      status: 200,
      data: { imported, skipped, failed: errors.length, errors: errors.slice(0, 20) },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
    }
    next(error);
  }
});

export default router;
