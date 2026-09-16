import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { dealService } from '../services/dealService.js';
import { forecastService } from '../services/forecastService.js';
import { getDealNextAction, getActionSummary } from '../services/nextActionService.js';
import { dealScoringService } from '../services/dealScoringService.js';
import { meetingService } from '../services/meetingService.js';
import { authenticateOrApiKey } from '../middleware/apiKeyAuth.js';
import { tenantScope } from '../middleware/tenant.js';
import { aiLimiter } from '../middleware/rateLimit.js';
import { createError } from '../middleware/errorHandler.js';
import { visibilityScope, getEffective } from '../services/permissionService.js';
import { DealStage } from '@prisma/client';
import prisma from '../config/database.js';
import { createAuditLog } from '../utils/auditLogger.js';
import { dispatchTrigger } from '../jobs/automationEngine.js';
import { approvalService } from '../services/approvalService.js';
import { proposalService } from '../services/proposalService.js';

// IA de reuniões (Upgrade RD P3, req 26): upload de áudio em memória (multipart,
// campo "audio"). Limite de 25 MB coerente com os anexos (P2). O áudio, quando
// presente, é transcrito (Whisper) e persistido como Attachment(source=MEETING).
const MEETING_AUDIO_MAX_BYTES = 25 * 1024 * 1024;
const meetingUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MEETING_AUDIO_MAX_BYTES },
});
function handleMeetingAudioUpload(req: Request, res: Response, next: NextFunction) {
  const mw = meetingUpload.single('audio');
  mw(req, res, (err: unknown) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return next(createError('Áudio excede o tamanho máximo de 25 MB.', 413, 'FILE_TOO_LARGE'));
      }
      return next(createError('Falha no upload do áudio.', 400, 'UPLOAD_FAILED'));
    }
    next();
  });
}

const router = Router();

router.use(authenticateOrApiKey('deals:read'));
router.use(tenantScope);

const createDealSchema = z.object({
  name: z.string().min(1),
  value: z.number().min(0),
  stage: z.nativeEnum(DealStage).optional(),
  probability: z.number().int().min(0).max(100).optional(),
  expectedCloseDate: z.string().optional(),
  leadId: z.string().uuid().optional().nullable(),
  assignedTo: z.string().uuid().optional().nullable(),
  notes: z.string().optional(),
  customFields: z.record(z.any()).optional(),
  lostReason: z.string().optional(),
  funnelId: z.string().uuid().optional().nullable(),
  funnelColumnId: z.string().uuid().optional().nullable(),
  // Gestão de Negócios (RD parity) — P0
  qualification: z.number().int().min(1).max(5).optional().nullable(),
  sourceId: z.string().uuid().optional().nullable(),
  originCampaignId: z.string().uuid().optional().nullable(),
  oneTimeValue: z.number().min(0).optional().nullable(),
  recurringValue: z.number().min(0).optional().nullable(),
});

const updateDealSchema = createDealSchema.partial().extend({
  id: z.string().uuid(),
});

const querySchema = z.object({
  stage: z.nativeEnum(DealStage).optional(),
  assignedTo: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  funnelId: z.string().uuid().optional(),
  search: z.string().optional(),
  minValue: z.coerce.number().optional(),
  maxValue: z.coerce.number().optional(),
  // Filtros de Gestão de Negócios (RD parity) — server-side na lista/kanban.
  qualification: z.coerce.number().int().min(1).max(5).optional(),
  sourceId: z.string().uuid().optional(),
  originCampaignId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  sort: z
    .enum(['createdAt', 'updatedAt', 'name', 'value', 'stage', 'expectedCloseDate'])
    .optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

// GET /api/deals/forecast - Monthly revenue forecast (MUST be before /:id)
router.get('/forecast', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const months = req.query.months ? Number(req.query.months) : 6;
    const assignedTo = req.query.assignedTo as string | undefined;
    const stage = req.query.stage as DealStage | undefined;

    if (stage && !Object.values(DealStage).includes(stage)) {
      return next(createError('Invalid stage', 400, 'VALIDATION_ERROR'));
    }

    const forecast = await forecastService.getForecast(req.user.tenantId, {
      months,
      assignedTo: await visibilityScope(req.user, 'deals', assignedTo),
      stage,
    });
    res.json({ status: 200, data: forecast });
  } catch (error) {
    next(error);
  }
});

// GET /api/deals/trend - Won vs Lost trend (MUST be before /:id)
router.get('/trend', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const months = req.query.months ? Number(req.query.months) : 6;
    const trend = await forecastService.getTrend(
      req.user.tenantId,
      months,
      await visibilityScope(req.user, 'deals')
    );
    res.json({ status: 200, data: trend });
  } catch (error) {
    next(error);
  }
});

// GET /api/deals/stats - Aggregated metrics (MUST be before /:id)
router.get('/stats', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const stats = await dealService.getStats(
      req.user.tenantId,
      await visibilityScope(req.user, 'deals')
    );
    res.json({ status: 200, data: stats });
  } catch (error) {
    next(error);
  }
});

// GET /api/deals/action-summary - Top urgent actions across leads and deals
router.get('/action-summary', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const limit = req.query.limit ? Number(req.query.limit) : 5;
    const actions = await getActionSummary(
      req.user.tenantId,
      limit,
      await visibilityScope(req.user, 'deals')
    );
    res.json({ status: 200, data: actions });
  } catch (error) {
    next(error);
  }
});

// GET /api/deals/:id/next-action - Get suggested next action for a deal
// NOTE: This must be registered before /:id to avoid conflict, but Express
// handles sub-paths like /:id/next-action correctly since they have more segments.

// ── Upgrade RD parity — P0 ──
// GET /api/deals/celebration-stats - Vendas GANHAS do usuário no mês corrente
// (comemoração de venda, spec req 11). MUST be before o guard /:id.
router.get('/celebration-stats', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const stats = await prisma.deal.aggregate({
      where: {
        tenantId: req.user.tenantId,
        deletedAt: null,
        status: 'WON',
        assignedTo: req.user.userId,
        wonAt: { gte: monthStart },
      },
      _count: { id: true },
      _sum: { value: true },
    });

    res.json({
      status: 200,
      data: {
        monthWonCount: stats._count.id,
        monthWonValue: Math.round(Number(stats._sum.value ?? 0) * 100) / 100,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/deals/without-tasks - Negociações abertas do usuário sem tarefa
// pendente vinculada (spec req 9). MUST be before o guard /:id.
router.get('/without-tasks', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    // Painel pessoal: padrão = o próprio usuário; gestor pode pedir outro
    // responsável via ?assignedTo=. A visibilidade efetiva (req 14) resolve o
    // escopo — analista PROPRIA (userId), EQUIPE ({in}), GERAL (requested).
    const requested = (req.query.assignedTo as string | undefined) || req.user.userId;
    const owner = await visibilityScope(req.user, 'deals', requested);

    const deals = await prisma.deal.findMany({
      where: {
        tenantId: req.user.tenantId,
        deletedAt: null,
        status: 'OPEN',
        ...(owner ? { assignedTo: owner } : {}),
        tasks: {
          none: {
            status: { in: ['PENDING', 'IN_PROGRESS'] },
            deletedAt: null,
          },
        },
      },
      select: {
        id: true,
        name: true,
        value: true,
        funnelColumnId: true,
        funnelColumn: { select: { id: true, title: true } },
        company: { select: { id: true, name: true } },
        lead: { select: { id: true, name: true } },
        updatedAt: true,
      },
      orderBy: { updatedAt: 'asc' },
      take: 50,
    });

    res.json({ status: 200, data: deals });
  } catch (error) {
    next(error);
  }
});

// GET /api/deals - List deals with filters/pagination
router.get('/', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const filters = querySchema.parse(req.query);
    // Visibilidade viva (req 14): analista→PROPRIA (userId), EQUIPE→{in},
    // GERAL→requested. Sem perfil custom, idêntico ao ownerScope de hoje.
    const scopedFilters = {
      ...filters,
      assignedTo: await visibilityScope(req.user, 'deals', filters.assignedTo),
    };
    const result = await dealService.findAll(req.user.tenantId, scopedFilters);
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
    }
    next(error);
  }
});

// Guard de posse (reqs 6,7 + visibilidade viva req 14): o acesso a /:id* é
// permitido quando o dono do negócio está DENTRO do escopo de visibilidade
// efetivo do usuário — próprio (PROPRIA), membros da equipe (EQUIPE) ou qualquer
// do tenant (GERAL). Fora do escopo → 404 (sem vazar existência).
//
// FAIL-CLOSED / == HOJE: sem perfil custom, USER builtin tem deals=PROPRIA →
// escopo = próprio userId → 404 idêntico ao de hoje; GESTOR/ADMIN têm GERAL →
// passam direto (também idêntico).
async function enforceDealOwnership(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) return next(createError('Authentication required', 401));
    const scope = await visibilityScope(req.user, 'deals');
    // GERAL → escopo devolve undefined (sem filtro por dono): acesso irrestrito
    // ao tenant, como o manager de hoje.
    if (scope === undefined) return next();

    // PROPRIA (string) ou EQUIPE ({in}) → só passa se o dono ∈ escopo.
    const owned = await prisma.deal.findFirst({
      where: {
        id: req.params.id,
        tenantId: req.user.tenantId,
        deletedAt: null,
        assignedTo: scope,
      },
      select: { id: true },
    });
    if (!owned) return next(createError('Deal not found', 404, 'DEAL_NOT_FOUND'));
    return next();
  } catch (err) {
    next(err);
  }
}

// ── IA de reuniões — detalhe por id da interação (req 26) ──
// GET /api/deals/meetings/:iid — DEVE ficar ANTES de `router.use('/:id', …)`, senão
// o prefixo `/:id` capturaria `/meetings/...` (id="meetings") e rodaria o guard de
// posse com um id inválido. Escopado por tenant no service (não expõe outros tenants).
//
// ATENÇÃO (visibilidade P1): por estar ANTES de `router.use('/:id', enforceDealOwnership)`,
// esta rota NÃO herda o guard de posse. Sem o escopo abaixo, um analista USER
// (deals=PROPRIA) que adivinhe o UUID de uma Interaction MEETING leria transcrição,
// valor e notas de deal de OUTRO dono no mesmo tenant. Por isso aplicamos aqui, à mão,
// o MESMO escopo de visibilidade de `enforceDealOwnership`, ancorado no dealId da reunião.
router.get('/meetings/:iid', async (req, res, next) => {
  try {
    if (!req.user) return next(createError('Authentication required', 401));
    meetingService.assertAIEnabled();
    const meeting = await meetingService.getMeeting(req.user.tenantId, req.params.iid);

    // Visibilidade viva (req 14): resolve o escopo de "responsável" de deals e confirma
    // que o dono da negociação da reunião está DENTRO do escopo do usuário.
    //   - GERAL   → scope=undefined → sem filtro por dono (manager/admin de hoje).
    //   - PROPRIA → scope=string (o próprio userId).
    //   - EQUIPE  → scope={ in: [...] }.
    // O padrão `assignedTo: scope` cobre string e { in }; undefined omite o filtro.
    const scope = await visibilityScope(
      {
        userId: req.user.userId,
        tenantId: req.user.tenantId,
        role: req.user.role,
        isPlatformAdmin: req.user.isPlatformAdmin,
      },
      'deals'
    );
    const owned = await prisma.deal.findFirst({
      where: {
        id: meeting.dealId,
        tenantId: req.user.tenantId,
        deletedAt: null,
        ...(scope === undefined ? {} : { assignedTo: scope }),
      },
      select: { id: true },
    });
    // Fora do escopo → 404 (não vaza a existência da reunião nem do deal).
    if (!owned) return next(createError('Reunião não encontrada', 404, 'MEETING_NOT_FOUND'));

    res.json({ status: 200, data: meeting });
  } catch (error) {
    next(error);
  }
});

router.use('/:id', enforceDealOwnership);

// GET /api/deals/:id/audit - Get audit trail for a deal
router.get('/:id/audit', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }
    const { id } = req.params;
    const { tenantId } = req.user;
    const logs = await prisma.auditLog.findMany({
      where: { entityType: 'deal', entityId: id, tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { user: { select: { name: true, email: true } } },
    });
    res.json({ status: 200, data: { logs } });
  } catch (err) {
    next(err);
  }
});

// GET /api/deals/:id/stage-history - Histórico de etapas (tempo em cada etapa) — req 24
router.get('/:id/stage-history', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }
    const { id } = req.params;
    const { tenantId } = req.user;
    // Tenant-safety: garante que o deal pertence ao tenant antes de expor o histórico.
    const owned = await prisma.deal.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!owned) {
      return next(createError('Deal not found', 404, 'DEAL_NOT_FOUND'));
    }
    const history = await prisma.dealStageHistory.findMany({
      where: { dealId: id },
      orderBy: { enteredAt: 'asc' },
    });
    res.json({ status: 200, data: history });
  } catch (err) {
    next(err);
  }
});

// GET /api/deals/:id - Get deal by ID
router.get('/:id', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const deal = await dealService.findById(req.user.tenantId, req.params.id);
    res.json(deal);
  } catch (error) {
    next(error);
  }
});

// GET /api/deals/:id/proposal.pdf - Export deal as PDF proposal
router.get('/:id/proposal.pdf', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }
    const { generateProposalPDF } = await import('../services/pdfService.js');
    const pdf = await generateProposalPDF(req.params.id, req.user.tenantId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="proposta-${req.params.id}.pdf"`);
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});

// POST /api/deals/:id/proposals - Gera uma nova proposta (nova versão) a partir
// de um modelo (opcional) → PDF anexado (Attachment source=PROPOSAL) → Proposal
// → Interaction. Regenerar cria nova versão. (Upgrade RD P2, req 18)
const generateProposalSchema = z.object({
  templateId: z.string().uuid().optional(),
});
router.post('/:id/proposals', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }
    const { templateId } = generateProposalSchema.parse(req.body ?? {});
    const proposal = await proposalService.generate(req.user.tenantId, req.params.id, {
      templateId,
      userId: req.user.userId,
    });
    res.status(201).json({ status: 201, data: proposal });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
    }
    next(error);
  }
});

// GET /api/deals/:id/proposals - Histórico de versões de proposta do deal.
router.get('/:id/proposals', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }
    const proposals = await proposalService.listForDeal(req.user.tenantId, req.params.id);
    res.json({ status: 200, data: proposals });
  } catch (error) {
    next(error);
  }
});

// GET /api/deals/:id/next-action - Get suggested next action for a deal
router.get('/:id/next-action', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const action = await getDealNextAction(req.user.tenantId, req.params.id);
    res.json({ status: 200, data: action });
  } catch (error) {
    next(error);
  }
});

// GET /api/deals/:id/ai-score - AI close-propensity score + top-3 factors (req 22).
// Pass ?recalc=true to force an on-demand recalculation (req 21).
router.get('/:id/ai-score', aiLimiter, async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const forceRecalc = req.query.recalc === 'true' || req.query.recalc === '1';
    const result = forceRecalc
      ? await dealScoringService.computeAndStore(req.user.tenantId, req.params.id)
      : await dealScoringService.getOrCompute(req.user.tenantId, req.params.id);

    res.json({ status: 200, data: result });
  } catch (error) {
    next(error);
  }
});

// ── IA de reuniões no deal (Upgrade RD P3, req 26) ──
// Estas rotas herdam `enforceDealOwnership` (posse/visibilidade P1) por estarem sob
// `/:id`. Gating: sem IA → 503 AI_NOT_CONFIGURED (nunca 500). Aceita ÁUDIO (multipart,
// campo "audio", exige Whisper/OpenAI) OU transcrição colada ({ transcript }).

// POST /api/deals/:id/meetings — cria reunião (áudio OU transcrição colada) → resumo
// + tarefas/campos sugeridos.
// Teto de caracteres da transcrição colada: evita prompt arbitrariamente grande ao LLM
// (coerente com o limite de 25 MB do áudio).
const MEETING_TRANSCRIPT_MAX_CHARS = 100000;
const createMeetingSchema = z.object({
  transcript: z.string().max(MEETING_TRANSCRIPT_MAX_CHARS).optional(),
});
router.post('/:id/meetings', aiLimiter, handleMeetingAudioUpload, async (req, res, next) => {
  try {
    if (!req.user) return next(createError('Authentication required', 401));
    meetingService.assertAIEnabled();

    // Confirma que o deal existe/pertence ao tenant (o guard de posse já passou).
    const deal = await prisma.deal.findFirst({
      where: { id: req.params.id, tenantId: req.user.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!deal) return next(createError('Deal not found', 404, 'DEAL_NOT_FOUND'));

    const parsed = createMeetingSchema.parse({ transcript: req.body?.transcript });

    const file = (req as unknown as { file?: { originalname: string; mimetype: string; buffer: Buffer } })
      .file;
    const transcript = parsed.transcript;

    if (!file && !transcript?.trim()) {
      return next(
        createError(
          'Envie um áudio da reunião (campo "audio") ou cole a transcrição.',
          400,
          'MEETING_INPUT_REQUIRED'
        )
      );
    }

    const meeting = await meetingService.createMeeting(req.user.tenantId, req.params.id, {
      audio: file
        ? { buffer: file.buffer, mimeType: file.mimetype, filename: file.originalname }
        : null,
      transcript: transcript ?? null,
      userId: req.user.userId,
    });
    res.status(201).json({ status: 201, data: meeting });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
    }
    next(error);
  }
});

// GET /api/deals/:id/meetings — lista as reuniões (Interaction MEETING) do deal.
router.get('/:id/meetings', async (req, res, next) => {
  try {
    if (!req.user) return next(createError('Authentication required', 401));
    meetingService.assertAIEnabled();
    const meetings = await meetingService.listMeetings(req.user.tenantId, req.params.id);
    res.json({ status: 200, data: meetings });
  } catch (error) {
    next(error);
  }
});

// POST /api/deals/:id/meetings/:iid/apply — aplica só as sugestões ACEITAS.
const applyMeetingSchema = z.object({
  taskIds: z.array(z.string()).default([]),
  fieldUpdates: z
    .object({
      value: z.string().optional(),
      stage: z.string().optional(),
      notes: z.string().optional(),
    })
    .default({}),
});
router.post('/:id/meetings/:iid/apply', aiLimiter, async (req, res, next) => {
  try {
    if (!req.user) return next(createError('Authentication required', 401));
    meetingService.assertAIEnabled();
    const body = applyMeetingSchema.parse(req.body ?? {});

    // Capability por-entidade (req 13): o apply muta o deal e/ou cria tarefas — precisa
    // dos MESMOS gates de PUT /deals/:id (deals.edit) e POST /tasks (tasks.create).
    // Um perfil custom com deals.edit=false / tasks.create=false não pode contornar via apply.
    const eff = await getEffective({
      userId: req.user.userId,
      tenantId: req.user.tenantId,
      role: req.user.role,
      isPlatformAdmin: req.user.isPlatformAdmin,
    });
    if (body.taskIds.length > 0 && !eff.entities.tasks.create) {
      return next(createError('Insufficient permissions', 403, 'INSUFFICIENT_PERMISSIONS'));
    }
    if (Object.keys(body.fieldUpdates).length > 0 && !eff.entities.deals.edit) {
      return next(createError('Insufficient permissions', 403, 'INSUFFICIENT_PERMISSIONS'));
    }

    const result = await meetingService.applyMeeting(
      req.user.tenantId,
      req.params.id,
      req.params.iid,
      body,
      req.user.userId
    );
    res.json({ status: 200, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
    }
    next(error);
  }
});

// POST /api/deals - Create deal
router.post('/', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    // Capability por-entidade (req 13): criar negociações exige entities.deals.create.
    // Sem perfil custom, ADMIN/GESTOR/USER têm true (== hoje); só nega se restrito.
    const eff = await getEffective({
      userId: req.user.userId,
      tenantId: req.user.tenantId,
      role: req.user.role,
      isPlatformAdmin: req.user.isPlatformAdmin,
    });
    if (!eff.entities.deals.create) {
      return next(createError('Insufficient permissions', 403, 'INSUFFICIENT_PERMISSIONS'));
    }

    const data = createDealSchema.parse(req.body);
    // transferOwner (req 13): atribuir a OUTRA pessoa exige a capability, ancorada no
    // PERFIL. Sem transferOwner o dono é forçado a si mesmo — o piso do analista de
    // hoje. Sem perfil custom: USER transferOwner=false → forçado (== hoje);
    // ADMIN/GESTOR transferOwner=true → livre (== hoje).
    if (eff.capabilities.transferOwner !== true) {
      data.assignedTo = req.user.userId;
    }
    const deal = await dealService.create(req.user.tenantId, data);

    dispatchTrigger(
      req.user.tenantId,
      'deal_created',
      deal.leadId ?? undefined,
      { dealId: deal.id, dealName: deal.name, stage: deal.stage },
      deal.id
    ).catch(() => {});

    res.status(201).json(deal);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
    }
    next(error);
  }
});

// PUT /api/deals/:id - Update deal
router.put('/:id', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const body = req.body;
    if (body.stage === 'LOST' && !body.lostReason) {
      return res
        .status(400)
        .json({ error: 'Informe o motivo da perda (lostReason) ao marcar um deal como perdido.' });
    }

    // Capability por-entidade (req 13): editar negociações exige entities.deals.edit.
    const eff = await getEffective({
      userId: req.user.userId,
      tenantId: req.user.tenantId,
      role: req.user.role,
      isPlatformAdmin: req.user.isPlatformAdmin,
    });
    if (!eff.entities.deals.edit) {
      return next(createError('Insufficient permissions', 403, 'INSUFFICIENT_PERMISSIONS'));
    }

    const data = updateDealSchema.parse({
      ...body,
      id: req.params.id,
    });
    // transferOwner (req 13): reatribuir exige a capability (ancorada no perfil).
    // Sem ela, o campo assignedTo é ignorado no update — piso do analista de hoje.
    // Sem perfil custom: USER transferOwner=false → strip (== hoje); ADMIN/GESTOR livre.
    if (eff.capabilities.transferOwner !== true) delete data.assignedTo;

    // Fetch existing deal for audit diff
    const existing = await prisma.deal.findUnique({
      where: { id: req.params.id, tenantId: req.user.tenantId },
    });

    const deal = await dealService.update(req.user.tenantId, data);

    // Fire audit log asynchronously — must not block the response
    if (existing) {
      createAuditLog({
        tenantId: req.user.tenantId,
        entityType: 'deal',
        entityId: req.params.id,
        userId: req.user.userId,
        action: 'update',
        oldData: existing as Record<string, unknown>,
        newData: deal as Record<string, unknown>,
      }).catch(() => {});

      if (existing.stage !== deal.stage) {
        dispatchTrigger(
          req.user.tenantId,
          'deal_stage_changed',
          deal.leadId ?? undefined,
          { dealId: deal.id, dealName: deal.name, fromStage: existing.stage, toStage: deal.stage },
          deal.id
        ).catch(() => {});
      }
    }

    res.json(deal);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
    }
    next(error);
  }
});

// POST /api/deals/:id/win - Marcar venda (ganho) — req 20
router.post('/:id/win', async (req, res, next) => {
  try {
    if (!req.user) return next(createError('Authentication required', 401));
    const deal = await dealService.markWon(req.user.tenantId, req.params.id);
    res.json({ status: 200, data: deal });
  } catch (error) {
    next(error);
  }
});

// POST /api/deals/:id/lose - Marcar perda (exige motivo da lista configurável) — reqs 21/22
const loseSchema = z.object({ lostReasonId: z.string().uuid() });
router.post('/:id/lose', async (req, res, next) => {
  try {
    if (!req.user) return next(createError('Authentication required', 401));
    const { lostReasonId } = loseSchema.parse(req.body);
    const deal = await dealService.markLost(req.user.tenantId, req.params.id, lostReasonId);
    res.json({ status: 200, data: deal });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(
        createError(
          'Informe o motivo da perda (lostReasonId).',
          400,
          'VALIDATION_ERROR',
          error.errors
        )
      );
    }
    next(error);
  }
});

// POST /api/deals/:id/send-email - E-mail 1:1 pelo deal (Upgrade RD P0, req 10):
// modelo do tenant OU assunto/corpo avulsos; variáveis {{nome}} {{empresa}}
// {{negociacao}} {{valor}} {{responsavel}}; exige EmailConfig verificada (400
// claro se ausente); registra Interaction EMAIL OUTBOUND na timeline do deal.
const sendDealEmailSchema = z
  .object({
    templateId: z.string().uuid().optional(),
    subject: z.string().min(1).max(500).optional(),
    html: z.string().min(1).optional(),
    leadId: z.string().uuid().optional(),
  })
  .refine((body) => body.templateId || (body.subject && body.html), {
    message: 'Informe um modelo de e-mail (templateId) ou assunto e corpo (subject + html).',
  });

router.post('/:id/send-email', async (req, res, next) => {
  try {
    if (!req.user) return next(createError('Authentication required', 401));
    const body = sendDealEmailSchema.parse(req.body);
    const { sendDealEmail } = await import('../services/emailOneToOneService.js');
    const result = await sendDealEmail(req.user.tenantId, req.user.userId, req.params.id, body);
    res.json({ status: 200, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
    }
    next(error);
  }
});

// POST /api/deals/:id/pause - Pausar negociação — req 23
router.post('/:id/pause', async (req, res, next) => {
  try {
    if (!req.user) return next(createError('Authentication required', 401));
    const deal = await dealService.pause(req.user.tenantId, req.params.id);
    res.json({ status: 200, data: deal });
  } catch (error) {
    next(error);
  }
});

// POST /api/deals/:id/resume - Retomar negociação — req 23
router.post('/:id/resume', async (req, res, next) => {
  try {
    if (!req.user) return next(createError('Authentication required', 401));
    const deal = await dealService.resume(req.user.tenantId, req.params.id);
    res.json({ status: 200, data: deal });
  } catch (error) {
    next(error);
  }
});

// ── Múltiplos contatos da negociação (req 16) ──
// GET /api/deals/:id/contacts
router.get('/:id/contacts', async (req, res, next) => {
  try {
    if (!req.user) return next(createError('Authentication required', 401));
    const data = await dealService.listContacts(req.user.tenantId, req.params.id);
    res.json({ status: 200, data });
  } catch (error) {
    next(error);
  }
});

const addContactSchema = z.object({
  leadId: z.string().uuid(),
  roleInDeal: z.string().max(120).optional().nullable(),
});

// POST /api/deals/:id/contacts
router.post('/:id/contacts', async (req, res, next) => {
  try {
    if (!req.user) return next(createError('Authentication required', 401));
    const body = addContactSchema.parse(req.body);
    const data = await dealService.addContact(
      req.user.tenantId,
      req.params.id,
      body.leadId,
      body.roleInDeal
    );
    res.status(201).json({ status: 201, data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
    }
    next(error);
  }
});

// DELETE /api/deals/:id/contacts/:contactId
router.delete('/:id/contacts/:contactId', async (req, res, next) => {
  try {
    if (!req.user) return next(createError('Authentication required', 401));
    const data = await dealService.removeContact(
      req.user.tenantId,
      req.params.id,
      req.params.contactId
    );
    res.json({ status: 200, data });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/deals/:id - Delete deal
router.delete('/:id', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    // Gate de exclusão (req 16): sem permissão OU perfil exige aprovação → cria
    // solicitação (não deleta) + 202. Sem perfil custom → deleta direto (== hoje).
    const gate = await approvalService.deleteGate(
      {
        userId: req.user.userId,
        tenantId: req.user.tenantId,
        role: req.user.role,
        isPlatformAdmin: req.user.isPlatformAdmin,
      },
      'deals',
      req.params.id,
      'negociação'
    );
    if (gate.queued) {
      return res.status(202).json({ status: 202, data: { approvalId: gate.approvalId, pending: true } });
    }

    // Cancel any pending automation steps waiting for this deal's lead
    const deal = await prisma.deal.findFirst({
      where: { id: req.params.id, tenantId: req.user.tenantId, deletedAt: null },
      select: { leadId: true },
    });
    if (deal?.leadId) {
      await prisma.automationLog.updateMany({
        where: { leadId: deal.leadId, status: 'WAITING' },
        data: { status: 'CANCELLED' },
      });
    }

    await dealService.delete(req.user.tenantId, req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// GET /api/deals/:id/products - List deal line items with product info
router.get('/:id/products', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }
    const { id: dealId } = req.params;
    const { tenantId } = req.user;

    // Verify deal belongs to tenant
    const deal = await prisma.deal.findFirst({ where: { id: dealId, tenantId, deletedAt: null } });
    if (!deal) return next(createError('Deal not found', 404));

    const items = await prisma.dealProduct.findMany({
      where: { dealId },
      include: { product: true },
    });
    res.json({ status: 200, data: items });
  } catch (error) {
    next(error);
  }
});

// POST /api/deals/:id/products - Add a product to deal
router.post('/:id/products', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }
    const { id: dealId } = req.params;
    const { tenantId } = req.user;

    const schema = z.object({
      productId: z.string().uuid(),
      quantity: z.number().min(0),
      unitPrice: z.number().min(0),
      discount: z.number().min(0).max(100).default(0),
    });
    const body = schema.parse(req.body);

    // Verify deal belongs to tenant
    const deal = await prisma.deal.findFirst({ where: { id: dealId, tenantId, deletedAt: null } });
    if (!deal) return next(createError('Deal not found', 404));

    const item = await prisma.dealProduct.create({
      data: {
        dealId,
        productId: body.productId,
        quantity: body.quantity,
        unitPrice: body.unitPrice,
        discount: body.discount,
      },
      include: { product: true },
    });

    // Recalculate deal.value as sum of all line items
    const allItems = await prisma.dealProduct.findMany({ where: { dealId } });
    const newValue = allItems.reduce((sum, i) => {
      return sum + Number(i.quantity) * Number(i.unitPrice) * (1 - Number(i.discount) / 100);
    }, 0);
    await prisma.deal.update({
      where: { id: dealId },
      data: { value: Math.round(newValue * 100) / 100 },
    });

    res.status(201).json({ status: 201, data: item });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
    }
    next(error);
  }
});

// DELETE /api/deals/:id/products/:dealProductId - Remove a line item and recalculate deal value
router.delete('/:id/products/:dealProductId', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }
    const { id: dealId, dealProductId } = req.params;
    const { tenantId } = req.user;

    // Verify deal belongs to tenant
    const deal = await prisma.deal.findFirst({ where: { id: dealId, tenantId, deletedAt: null } });
    if (!deal) return next(createError('Deal not found', 404));

    const existing = await prisma.dealProduct.findFirst({ where: { id: dealProductId, dealId } });
    if (!existing) return next(createError('Line item not found', 404));

    await prisma.dealProduct.delete({ where: { id: dealProductId } });

    // Recalculate deal.value
    const remaining = await prisma.dealProduct.findMany({ where: { dealId } });
    const newValue = remaining.reduce((sum, i) => {
      return sum + Number(i.quantity) * Number(i.unitPrice) * (1 - Number(i.discount) / 100);
    }, 0);
    await prisma.deal.update({
      where: { id: dealId },
      data: { value: Math.round(newValue * 100) / 100 },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
