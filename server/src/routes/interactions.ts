import { Router } from 'express';
import { z } from 'zod';
import prisma from '../config/database.js';
import { interactionService } from '../services/interactionService.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { tenantScope } from '../middleware/tenant.js';
import { createError } from '../middleware/errorHandler.js';
import { InteractionType, InteractionDirection, MeetingModality, CallReason } from '@prisma/client';
import { visibilityScope } from '../services/permissionService.js';

const router = Router();

router.use(authenticate);
router.use(tenantScope);

const createInteractionSchema = z
  .object({
    leadId: z.string().uuid().optional(),
    dealId: z.string().uuid().optional(),
    // Upgrade RD P3 (req 23): permite vincular a interação à empresa (ex.: fallback
    // register-only do WhatsAppSendPanel montado em CompanyDetail). Sem isto, o Zod
    // descartaria o companyId e a mensagem não apareceria na timeline da empresa.
    companyId: z.string().uuid().optional(),
    type: z.nativeEnum(InteractionType),
    direction: z.nativeEnum(InteractionDirection),
    subject: z.string().optional(),
    content: z.string().min(1),
    // Mantido por COMPATIBILIDADE (WhatsApp/e-mail gravam ids de mensagem etc.).
    // Os campos estruturados de Reunião/Ligação NÃO passam mais por aqui (req 38).
    metadata: z.any().optional(),
    automationId: z.string().uuid().optional(),
    userId: z.string().uuid().optional(),
    // Campos estruturados das atividades de lead (spec reqs 36-38) — validação
    // tipada em vez de metadata livre; regras por tipo no superRefine abaixo.
    location: z.string().min(1).max(500).optional(),
    modality: z.nativeEnum(MeetingModality).optional(),
    callReason: z.nativeEnum(CallReason).optional(),
    occurredAt: z.string().datetime({ offset: true }).optional(),
    participantIds: z.array(z.string().uuid()).max(50).optional(),
  })
  .superRefine((data, ctx) => {
    // Regras por tipo (reqs 36-37): MEETING aceita location/modality/participantes;
    // CALL aceita callReason/participantes (location/modality proibidos); os demais
    // tipos rejeitam todos os campos estruturados. Violação → 400 VALIDATION_ERROR.
    const forbid = (field: 'location' | 'modality' | 'callReason' | 'participantIds') => {
      if (data[field] !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `Campo "${field}" não é permitido para atividades do tipo ${data.type}`,
        });
      }
    };
    if (data.type === InteractionType.MEETING) {
      forbid('callReason');
    } else if (data.type === InteractionType.CALL) {
      forbid('location');
      forbid('modality');
    } else {
      forbid('location');
      forbid('modality');
      forbid('callReason');
      forbid('participantIds');
    }
  });

const querySchema = z.object({
  leadId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
  // Simetria com o POST (que já aceita companyId): habilita a timeline da empresa.
  companyId: z.string().uuid().optional(),
  type: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

router.get('/', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const filters = querySchema.parse(req.query);
    // Visibilidade viva (req 14): interações seguem 'deals'. BYTE-A-BYTE == HOJE:
    // USER builtin PROPRIA→userId; GESTOR/ADMIN GERAL→undefined (sem filtro).
    const result = await interactionService.findAll(
      req.user.tenantId,
      filters,
      await visibilityScope(req.user, 'deals')
    );
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
    }
    next(error);
  }
});

// GET /api/interactions/inbox - Unified inbox (must be before /:id)
router.get('/inbox', async (req, res, next) => {
  try {
    if (!req.user) return next(createError('Authentication required', 401));

    const channel = req.query.channel as string | undefined;
    const search = req.query.search as string | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 30;

    const conversations = await interactionService.getInboxConversations(
      req.user.tenantId,
      { channel, search, page, limit },
      await visibilityScope(req.user, 'deals')
    );

    res.json({ status: 200, data: conversations });
  } catch (error) {
    next(error);
  }
});

router.get('/leads/:leadId', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const interactions = await interactionService.findByLeadId(
      req.user.tenantId,
      req.params.leadId,
      await visibilityScope(req.user, 'deals')
    );
    res.json(interactions);
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const data = createInteractionSchema.parse({
      ...req.body,
      userId: req.body.userId || req.user.userId,
    });

    // Posse por tenant (Upgrade RD P3): valida cada entidade vinculada contra o
    // tenant do usuário ANTES de gravar. Sem isto, o body poderia apontar
    // leadId/dealId/companyId de OUTRO tenant e — via include do lead no service —
    // vazar PII cross-tenant. É o caminho do fallback register-only do WhatsApp.
    const tenantId = req.user.tenantId;
    // companyId do lead da atividade — usado na checagem de empresa dos participantes.
    let leadCompanyId: string | null = null;
    if (data.leadId) {
      const lead = await prisma.lead.findFirst({
        where: { id: data.leadId, tenantId, deletedAt: null },
        select: { id: true, companyId: true },
      });
      if (!lead) return next(createError('Lead não encontrado', 404, 'LEAD_NOT_FOUND'));
      leadCompanyId = lead.companyId;
    }
    if (data.dealId) {
      // Visibilidade viva (P1): além da posse por tenant, o deal-alvo DEVE estar
      // DENTRO do escopo de visibilidade efetivo do usuário — espelha /whatsapp/send
      // e enforceDealOwnership. Sem isto, um analista USER (deals=PROPRIA) gravaria
      // na timeline de um deal de OUTRO dono no mesmo tenant. scope undefined (GERAL)
      // → sem filtro por dono; string (PROPRIA) / { in } (EQUIPE) → filtra por dono;
      // fora do escopo → 404 (não vaza existência).
      const scope = await visibilityScope(req.user, 'deals');
      const deal = await prisma.deal.findFirst({
        where: {
          id: data.dealId,
          tenantId,
          deletedAt: null,
          ...(scope === undefined ? {} : { assignedTo: scope }),
        },
        select: { id: true },
      });
      if (!deal) return next(createError('Negócio não encontrado', 404, 'DEAL_NOT_FOUND'));
    }
    if (data.companyId) {
      // Visibilidade viva (P1): análogo ao deal. No default do analista USER a
      // visibilidade de companies é GERAL → scope undefined → valida só a posse por
      // tenant (sem regredir hoje); um perfil custom que restrinja a PROPRIA/EQUIPE
      // passa a filtrar por dono.
      const scope = await visibilityScope(req.user, 'companies');
      const company = await prisma.company.findFirst({
        where: {
          id: data.companyId,
          tenantId,
          deletedAt: null,
          ...(scope === undefined ? {} : { assignedTo: scope }),
        },
        select: { id: true },
      });
      if (!company) return next(createError('Empresa não encontrada', 404, 'COMPANY_NOT_FOUND'));
    }

    // Participantes (reqs 36-37): cada id deve ser um CONTATO (Lead isContact=true)
    // do tenant. Quando o lead da atividade tem empresa vinculada, o contato deve
    // pertencer à MESMA empresa; leads legados sem companyId aceitam qualquer
    // contato do tenant (caso extremo 1 da spec).
    let participantIds: string[] | undefined;
    if (data.participantIds && data.participantIds.length > 0) {
      participantIds = [...new Set(data.participantIds)];
      const contacts = await prisma.lead.findMany({
        where: { id: { in: participantIds }, tenantId, isContact: true, deletedAt: null },
        select: { id: true, companyId: true },
      });
      if (contacts.length !== participantIds.length) {
        return next(
          createError(
            'Participante inválido: informe apenas contatos existentes do seu tenant.',
            400,
            'PARTICIPANT_NOT_FOUND'
          )
        );
      }
      if (leadCompanyId) {
        const mismatched = contacts.some((c) => c.companyId !== leadCompanyId);
        if (mismatched) {
          return next(
            createError(
              'Os participantes devem ser contatos da empresa vinculada ao lead.',
              400,
              'PARTICIPANT_COMPANY_MISMATCH'
            )
          );
        }
      }
    }

    const interaction = await interactionService.create(tenantId, {
      ...data,
      // ISO string → Date (o schema valida o formato; a coluna é DateTime).
      occurredAt: data.occurredAt ? new Date(data.occurredAt) : undefined,
      participantIds,
    });
    res.status(201).json(interaction);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
    }
    next(error);
  }
});

// Gate de autorização (spec req 41): mesmo padrão do DELETE /attachments — exige a
// capability `deleteRecords`. Builtins têm deleteRecords=true → sem regressão; só um
// perfil custom que desligou a capability recebe 403 (fail-closed via requirePermission).
// O hard delete existente é mantido (interações são append-only; correção = nova atividade).
router.delete('/:id', requirePermission('deleteRecords'), async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    await interactionService.deleteInteraction(req.user.tenantId, req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
