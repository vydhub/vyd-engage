// Gestão de Parceiros Comerciais (PRM) — lado INTERNO (gestor).
// Gate de módulo: capability `accessParceiros` (fail-closed p/ USER/VIEWER).
// Gestão (aprovar, conflitos, comissões, documentos, config, cadastros): `manageParceiros`.
// Conflito EXTERNO_INTERNO: resolvível apenas pelo usuário designado (config) ou ADMIN.

import { Router, type Request } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { tenantScope } from '../middleware/tenant.js';
import { createError } from '../middleware/errorHandler.js';
import prisma from '../config/database.js';
import { consultorService } from '../services/parceiros/consultorService.js';
import { registroService } from '../services/parceiros/registroService.js';
import { comissaoService } from '../services/parceiros/comissaoService.js';
import { planoAcaoService } from '../services/parceiros/planoAcaoService.js';
import { reuniaoService } from '../services/parceiros/reuniaoService.js';
import { metaService } from '../services/parceiros/metaService.js';
import { documentoService } from '../services/parceiros/documentoService.js';
import { parceiroConfigService } from '../services/parceiros/configService.js';
import { scoreService } from '../services/parceiros/scoreService.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const router = Router();
router.use(authenticate);
router.use(tenantScope);
router.use(requirePermission('accessParceiros'));
const manage = requirePermission('manageParceiros');

function tenant(req: Request): string {
  return req.user!.tenantId;
}
function getFile(req: Request): { buffer: Buffer; mimetype: string; originalname: string } | undefined {
  return (req as unknown as { file?: { buffer: Buffer; mimetype: string; originalname: string } }).file;
}
function zodNext(error: unknown, next: (e?: unknown) => void) {
  if (error instanceof z.ZodError) {
    return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
  }
  next(error);
}

// ── Schemas ──────────────────────────────────────────────────────────────────
const consultorSchema = z.object({
  nome: z.string().min(1),
  email: z.string().email(),
  telefone: z.string().nullable().optional(),
  cpfCnpj: z.string().nullable().optional(),
  empresa: z.string().nullable().optional(),
  nivel: z.string().nullable().optional(),
  comissaoBase: z.number().min(0).max(100).optional(),
  status: z.enum(['ATIVO', 'SUSPENSO', 'INATIVO']).optional(),
  inicioParceria: z.coerce.date().nullable().optional(),
  cadenciaReuniaoDias: z.number().int().min(1).max(365).nullable().optional(),
});
const registroSchema = z.object({
  clienteNome: z.string().min(1),
  clienteCnpj: z.string().nullable().optional(),
  clienteContato: z.string().nullable().optional(),
  descricao: z.string().min(1),
  valorEstimado: z.number().nullable().optional(),
  observacoes: z.string().nullable().optional(),
});

// ── Painel (req 38) ──────────────────────────────────────────────────────────
router.get('/painel', async (req, res, next) => {
  try {
    const tenantId = tenant(req);
    const consultores = await consultorService.list(tenantId);
    const config = await parceiroConfigService.get(tenantId);
    const agora = new Date();
    const mesAtual = agora.getMonth() + 1;
    const anoAtual = agora.getFullYear();
    const painelConsultores = await Promise.all(
      consultores.map(async (c) => {
        const [ativos, pipeline, ganho, progresso, planoConcluidas, planoPendentes] = await Promise.all([
          prisma.registroOportunidade.count({
            where: { tenantId, consultorId: c.id, deletedAt: null, status: { in: ['SUBMETIDO', 'EM_ANALISE', 'APROVADO'] } },
          }),
          prisma.registroOportunidade.aggregate({
            where: { tenantId, consultorId: c.id, deletedAt: null, status: 'APROVADO' },
            _sum: { valorEstimado: true },
          }),
          prisma.registroOportunidade.aggregate({
            where: { tenantId, consultorId: c.id, deletedAt: null, status: 'GANHO' },
            _sum: { valorContrato: true },
          }),
          // Meta vs. realizado do mês corrente (req 38) — null se sem meta.
          metaService.progress(tenantId, c.id, mesAtual, anoAtual).catch(() => null),
          // Taxa de cumprimento do plano de ação (req 21): concluídas ÷ não-canceladas.
          prisma.planoAcaoItem.count({ where: { tenantId, status: 'CONCLUIDA', registro: { consultorId: c.id, deletedAt: null } } }),
          prisma.planoAcaoItem.count({ where: { tenantId, status: 'PENDENTE', registro: { consultorId: c.id, deletedAt: null } } }),
        ]);
        const diasSemAtividade = c.ultimaAtividadeEm
          ? Math.floor((agora.getTime() - new Date(c.ultimaAtividadeEm).getTime()) / (24 * 60 * 60 * 1000))
          : null;
        const totalPlano = planoConcluidas + planoPendentes;
        return {
          ...c,
          diasSemAtividade,
          registrosAtivos: ativos,
          pipeline: Number(pipeline._sum.valorEstimado ?? 0),
          ganho: Number(ganho._sum.valorContrato ?? 0),
          metaPct: progresso?.pct ?? null,
          taxaCumprimento: totalPlano === 0 ? null : Math.round((planoConcluidas / totalPlano) * 100),
        };
      })
    );

    const janelaAviso = new Date(agora.getTime() + config.avisoExpiracaoDias * 24 * 60 * 60 * 1000);
    const [aguardando, conflitos, expirando, dormentes, comissoes, pipelineTotal, expirados, comWindow, tempos] =
      await Promise.all([
        prisma.registroOportunidade.count({ where: { tenantId, deletedAt: null, status: 'SUBMETIDO' } }),
        prisma.conflitoCandidato.count({ where: { tenantId, status: 'ABERTO' } }),
        prisma.registroOportunidade.count({
          where: { tenantId, deletedAt: null, status: 'APROVADO', protecaoFim: { gt: agora, lte: janelaAviso } },
        }),
        prisma.consultor.count({
          where: { tenantId, deletedAt: null, status: 'ATIVO', scoreFaixa: { in: ['ESFRIANDO', 'FRIO'] } },
        }),
        prisma.comissaoParcela.aggregate({ where: { tenantId, status: 'A_PAGAR' }, _sum: { valor: true } }),
        // Pipeline originado por parceiros (agregado, req 38)
        prisma.registroOportunidade.aggregate({
          where: { tenantId, deletedAt: null, status: 'APROVADO' },
          _sum: { valorEstimado: true },
        }),
        // Taxa de expiração (req 38): EXPIRADO ÷ registros que já tiveram janela
        prisma.registroOportunidade.count({ where: { tenantId, deletedAt: null, status: 'EXPIRADO' } }),
        prisma.registroOportunidade.count({
          where: { tenantId, deletedAt: null, status: { in: ['APROVADO', 'GANHO', 'PERDIDO', 'EXPIRADO'] } },
        }),
        // Tempo médio de aprovação (req 38): média de (decididoEm − createdAt) dos decididos
        prisma.registroOportunidade.findMany({
          where: { tenantId, deletedAt: null, decididoEm: { not: null }, status: { in: ['APROVADO', 'REJEITADO', 'GANHO', 'PERDIDO', 'EXPIRADO'] } },
          select: { createdAt: true, decididoEm: true },
        }),
      ]);

    const tempoMedioAprovacaoDias =
      tempos.length === 0
        ? null
        : Math.round(
            (tempos.reduce((acc, r) => acc + (new Date(r.decididoEm as Date).getTime() - new Date(r.createdAt).getTime()), 0) /
              tempos.length /
              (24 * 60 * 60 * 1000)) *
              10
          ) / 10;

    res.json({
      status: 200,
      data: {
        consultores: painelConsultores,
        indicadores: {
          consultoresAtivos: consultores.filter((c) => c.status === 'ATIVO').length,
          consultoresDormentes: dormentes,
          registrosAguardando: aguardando,
          conflitosAbertos: conflitos,
          registrosExpirando: expirando,
          avisoExpiracaoDias: config.avisoExpiracaoDias,
          comissoesAPagar: Number(comissoes._sum.valor ?? 0),
          pipelineParceiros: Number(pipelineTotal._sum.valorEstimado ?? 0),
          taxaExpiracao: comWindow === 0 ? 0 : Math.round((expirados / comWindow) * 1000) / 10,
          tempoMedioAprovacaoDias,
        },
      },
    });
  } catch (e) { next(e); }
});

// ── Consultores ──────────────────────────────────────────────────────────────
router.get('/consultores', async (req, res, next) => {
  try {
    res.json({ status: 200, data: await consultorService.list(tenant(req), { search: req.query.search as string | undefined, status: req.query.status as never }) });
  } catch (e) { next(e); }
});
router.get('/consultores/:id', async (req, res, next) => {
  try { res.json({ status: 200, data: await consultorService.get(tenant(req), req.params.id) }); }
  catch (e) { next(e); }
});
router.get('/consultores/:id/score-history', async (req, res, next) => {
  try { res.json({ status: 200, data: await scoreService.history(tenant(req), req.params.id) }); }
  catch (e) { next(e); }
});
router.post('/consultores', manage, async (req, res, next) => {
  try {
    const data = consultorSchema.extend({ senhaInicial: z.string().min(8) }).parse(req.body);
    res.status(201).json({ status: 201, data: await consultorService.create(tenant(req), data) });
  } catch (e) { zodNext(e, next); }
});
router.put('/consultores/:id', manage, async (req, res, next) => {
  try {
    const data = consultorSchema.partial().parse(req.body);
    res.json({ status: 200, data: await consultorService.update(tenant(req), req.params.id, data, req.user!.userId) });
  } catch (e) { zodNext(e, next); }
});
router.delete('/consultores/:id', manage, async (req, res, next) => {
  try { res.json({ status: 200, data: await consultorService.remove(tenant(req), req.params.id) }); }
  catch (e) { next(e); }
});

// NDA: enviar p/ assinatura eletrônica (ZapSign, gated) — o arquivo é o PDF do NDA.
router.post('/consultores/:id/nda/enviar', manage, upload.single('file'), async (req, res, next) => {
  try {
    const file = getFile(req);
    if (!file) return next(createError('Arquivo do NDA obrigatório', 400, 'FILE_REQUIRED'));
    const { storageService } = await import('../services/storageService.js');
    const { sanitizeFileName } = await import('../services/attachmentService.js');
    const attachment = await storageService.put(tenant(req), {
      name: sanitizeFileName(file.originalname || 'nda.pdf'),
      mimeType: file.mimetype,
      buffer: file.buffer,
      source: 'PARCEIRO_NDA',
      uploadedById: req.user!.userId,
    });
    res.json({ status: 200, data: await consultorService.sendNda(tenant(req), req.params.id, attachment.id) });
  } catch (e) { next(e); }
});
// NDA: fallback manual (sem ZapSign) — upload do NDA já assinado libera o portal.
router.post('/consultores/:id/nda/manual', manage, upload.single('file'), async (req, res, next) => {
  try {
    const file = getFile(req);
    if (!file) return next(createError('Arquivo do NDA assinado obrigatório', 400, 'FILE_REQUIRED'));
    res.json({
      status: 200,
      data: await consultorService.uploadNdaAssinado(
        tenant(req),
        req.params.id,
        { buffer: file.buffer, mimeType: file.mimetype, fileName: file.originalname },
        req.user!.userId
      ),
    });
  } catch (e) { next(e); }
});

// ── Registros (deal registration) ────────────────────────────────────────────
router.get('/registros', async (req, res, next) => {
  try {
    res.json({
      status: 200,
      data: await registroService.list(tenant(req), {
        status: req.query.status as never,
        consultorId: req.query.consultorId as string | undefined,
        search: req.query.search as string | undefined,
      }),
    });
  } catch (e) { next(e); }
});
router.get('/registros/:id', async (req, res, next) => {
  try { res.json({ status: 200, data: await registroService.get(tenant(req), req.params.id) }); }
  catch (e) { next(e); }
});
// Interno abre EM NOME de um consultor (req 7).
router.post('/registros', manage, async (req, res, next) => {
  try {
    const data = registroSchema.extend({ consultorId: z.string().uuid() }).parse(req.body);
    const { consultorId, ...registroData } = data;
    res.status(201).json({
      status: 201,
      data: await registroService.create(tenant(req), consultorId, registroData, { criadoPorId: req.user!.userId }),
    });
  } catch (e) { zodNext(e, next); }
});
// Ajuste/correção do cliente (permite preencher CNPJ depois → re-detecta conflito
// superveniente, req 16/caso extremo). Manage.
router.put('/registros/:id', manage, async (req, res, next) => {
  try {
    const data = z.object({
      clienteNome: z.string().min(1).optional(),
      clienteCnpj: z.string().nullable().optional(),
      clienteContato: z.string().nullable().optional(),
    }).parse(req.body);
    res.json({ status: 200, data: await registroService.updateCliente(tenant(req), req.params.id, req.user!.userId, data) });
  } catch (e) { zodNext(e, next); }
});
// Ajuste da janela de proteção APÓS a aprovação (req 11 — "ou depois"). Manage.
router.patch('/registros/:id/protecao', manage, async (req, res, next) => {
  try {
    const data = z.object({
      dias: z.number().int().min(1).max(1095).optional(),
      novoFim: z.coerce.date().optional(),
      motivo: z.string().min(3),
    }).parse(req.body);
    res.json({ status: 200, data: await registroService.ajustarProtecao(tenant(req), req.params.id, req.user!.userId, data) });
  } catch (e) { zodNext(e, next); }
});
// Reativa um registro EXPIRADO (req 15 — gestor decide caso a caso). Manage.
router.post('/registros/:id/reativar', manage, async (req, res, next) => {
  try {
    const data = z.object({ protecaoDias: z.number().int().min(1).max(1095).optional(), motivo: z.string().optional() }).parse(req.body ?? {});
    res.json({ status: 200, data: await registroService.reativar(tenant(req), req.params.id, req.user!.userId, data) });
  } catch (e) { zodNext(e, next); }
});
router.post('/registros/:id/aprovar', manage, async (req, res, next) => {
  try {
    const body = z.object({ protecaoDias: z.number().int().min(1).max(1095).optional(), motivo: z.string().optional() }).parse(req.body ?? {});
    res.json({ status: 200, data: await registroService.approve(tenant(req), req.params.id, req.user!.userId, body) });
  } catch (e) { zodNext(e, next); }
});
router.post('/registros/:id/rejeitar', manage, async (req, res, next) => {
  try {
    const { motivo } = z.object({ motivo: z.string().min(3) }).parse(req.body);
    res.json({ status: 200, data: await registroService.reject(tenant(req), req.params.id, req.user!.userId, motivo) });
  } catch (e) { zodNext(e, next); }
});
router.post('/registros/:id/ganho', manage, async (req, res, next) => {
  try {
    const { valorContrato } = z.object({ valorContrato: z.number().positive() }).parse(req.body);
    res.json({ status: 200, data: await registroService.marcarGanho(tenant(req), req.params.id, req.user!.userId, valorContrato) });
  } catch (e) { zodNext(e, next); }
});
router.post('/registros/:id/perdido', manage, async (req, res, next) => {
  try {
    const { motivo } = z.object({ motivo: z.string().optional() }).parse(req.body ?? {});
    res.json({ status: 200, data: await registroService.marcarPerdido(tenant(req), req.params.id, req.user!.userId, motivo) });
  } catch (e) { zodNext(e, next); }
});
router.post('/registros/:id/updates', async (req, res, next) => {
  try {
    const { texto } = z.object({ texto: z.string().min(1) }).parse(req.body);
    res.status(201).json({ status: 201, data: await registroService.addUpdate(tenant(req), req.params.id, req.user!.userId, texto) });
  } catch (e) { zodNext(e, next); }
});

// Plano de ação bilateral (req 20-21) — uso operacional, aberto a quem tem acesso.
router.get('/registros/:id/plano', async (req, res, next) => {
  try { res.json({ status: 200, data: await planoAcaoService.list(tenant(req), req.params.id) }); }
  catch (e) { next(e); }
});
router.post('/registros/:id/plano', async (req, res, next) => {
  try {
    const data = z.object({
      descricao: z.string().min(1),
      responsavelConsultor: z.boolean(),
      responsavelUserId: z.string().uuid().nullable().optional(),
      dueDate: z.coerce.date().nullable().optional(),
    }).parse(req.body);
    res.status(201).json({ status: 201, data: await planoAcaoService.create(tenant(req), req.params.id, data) });
  } catch (e) { zodNext(e, next); }
});
router.put('/plano/:id', async (req, res, next) => {
  try {
    const data = z.object({
      descricao: z.string().min(1).optional(),
      responsavelConsultor: z.boolean().optional(),
      responsavelUserId: z.string().uuid().nullable().optional(),
      dueDate: z.coerce.date().nullable().optional(),
      status: z.enum(['PENDENTE', 'CONCLUIDA', 'CANCELADA']).optional(),
    }).parse(req.body);
    res.json({ status: 200, data: await planoAcaoService.update(tenant(req), req.params.id, data) });
  } catch (e) { zodNext(e, next); }
});
router.delete('/plano/:id', async (req, res, next) => {
  try { res.json({ status: 200, data: await planoAcaoService.remove(tenant(req), req.params.id) }); }
  catch (e) { next(e); }
});

// Extensões (req 14)
router.get('/extensoes', async (req, res, next) => {
  try {
    const status = (req.query.status as string) || 'PENDENTE';
    res.json({
      status: 200,
      data: await prisma.registroExtensao.findMany({
        where: { tenantId: tenant(req), status: status as never },
        include: { registro: { select: { id: true, clienteNome: true, protecaoFim: true, consultor: { select: { nome: true } } } } },
        orderBy: { createdAt: 'desc' },
      }),
    });
  } catch (e) { next(e); }
});
router.post('/extensoes/:id/decidir', manage, async (req, res, next) => {
  try {
    const body = z.object({ aprovar: z.boolean(), dias: z.number().int().min(1).max(1095).optional(), motivo: z.string().optional() }).parse(req.body);
    res.json({ status: 200, data: await registroService.decideExtensao(tenant(req), req.params.id, req.user!.userId, body) });
  } catch (e) { zodNext(e, next); }
});

// ── Conflitos (reqs 16-19) ───────────────────────────────────────────────────
router.get('/conflitos', async (req, res, next) => {
  try {
    const status = ((req.query.status as string) || 'ABERTO') as 'ABERTO' | 'RESOLVIDO';
    res.json({ status: 200, data: await registroService.listConflitos(tenant(req), status) });
  } catch (e) { next(e); }
});
router.get('/sobreposicao', async (req, res, next) => {
  try { res.json({ status: 200, data: await registroService.overlapMatrix(tenant(req)) }); }
  catch (e) { next(e); }
});
router.post('/conflitos/:id/resolver', manage, async (req, res, next) => {
  try {
    const body = z.object({ decisao: z.enum(['MANTER', 'REJEITAR', 'INDEPENDENTE']), rationale: z.string().min(3) }).parse(req.body);
    // Conflito com o pipeline INTERNO: só o usuário designado (config) ou ADMIN.
    const conflito = await prisma.conflitoCandidato.findFirst({ where: { id: req.params.id, tenantId: tenant(req) } });
    if (!conflito) return next(createError('Conflito não encontrado', 404, 'CONFLITO_NOT_FOUND'));
    if (conflito.tipo === 'EXTERNO_INTERNO') {
      const config = await parceiroConfigService.get(tenant(req));
      const designado = config.conflitoInternoUserId;
      const souAdmin = req.user!.role === 'ADMIN' || req.user!.isPlatformAdmin;
      if (designado && req.user!.userId !== designado && !souAdmin) {
        return next(createError('Conflitos com o pipeline interno são tratados pelo usuário designado', 403, 'CONFLITO_INTERNO_DESIGNADO'));
      }
    }
    res.json({ status: 200, data: await registroService.resolveConflito(tenant(req), req.params.id, req.user!.userId, body) });
  } catch (e) { zodNext(e, next); }
});

// ── Comissão (reqs 29-32) ────────────────────────────────────────────────────
router.get('/comissoes/extrato', async (req, res, next) => {
  try {
    res.json({
      status: 200,
      data: await comissaoService.extrato(tenant(req), {
        consultorId: req.query.consultorId as string | undefined,
        status: req.query.status as never,
      }),
    });
  } catch (e) { next(e); }
});
router.post('/registros/:id/atribuicoes', manage, async (req, res, next) => {
  try {
    const data = z.object({
      consultorId: z.string().uuid(),
      papel: z.enum(['ORIGINADOR', 'DESENVOLVEDOR']),
      percentualOverride: z.number().min(0).max(100).nullable().optional(),
    }).parse(req.body);
    res.json({ status: 200, data: await comissaoService.setAtribuicao(tenant(req), req.params.id, req.user!.userId, data) });
  } catch (e) { zodNext(e, next); }
});
router.delete('/atribuicoes/:id', manage, async (req, res, next) => {
  try { res.json({ status: 200, data: await comissaoService.removeAtribuicao(tenant(req), req.params.id, req.user!.userId) }); }
  catch (e) { next(e); }
});
router.put('/registros/:id/split', manage, async (req, res, next) => {
  try {
    const { splitOriginador } = z.object({ splitOriginador: z.number().int().min(0).max(100) }).parse(req.body);
    res.json({ status: 200, data: await comissaoService.setSplit(tenant(req), req.params.id, req.user!.userId, splitOriginador) });
  } catch (e) { zodNext(e, next); }
});
router.post('/registros/:id/recebimentos', manage, async (req, res, next) => {
  try {
    const data = z.object({ data: z.coerce.date(), valor: z.number().positive(), referencia: z.string().nullable().optional() }).parse(req.body);
    res.status(201).json({ status: 201, data: await comissaoService.addRecebimento(tenant(req), req.params.id, req.user!.userId, data) });
  } catch (e) { zodNext(e, next); }
});
router.delete('/recebimentos/:id', manage, async (req, res, next) => {
  try { res.json({ status: 200, data: await comissaoService.removeRecebimento(tenant(req), req.params.id, req.user!.userId) }); }
  catch (e) { next(e); }
});
router.post('/comissoes/parcelas/:id/pagar', manage, async (req, res, next) => {
  try {
    const { paga } = z.object({ paga: z.boolean() }).parse(req.body);
    res.json({ status: 200, data: await comissaoService.marcarPaga(tenant(req), req.params.id, req.user!.userId, paga) });
  } catch (e) { zodNext(e, next); }
});

// ── Reuniões (reqs 27-28) ────────────────────────────────────────────────────
router.get('/reunioes', async (req, res, next) => {
  try {
    res.json({
      status: 200,
      data: await reuniaoService.list(tenant(req), {
        consultorId: req.query.consultorId as string | undefined,
        status: req.query.status as never,
      }),
    });
  } catch (e) { next(e); }
});
router.post('/reunioes', manage, async (req, res, next) => {
  try {
    const data = z.object({
      consultorId: z.string().uuid(),
      dataHora: z.coerce.date(),
      pauta: z.string().nullable().optional(),
      participantes: z.array(z.string()).nullable().optional(),
    }).parse(req.body);
    res.status(201).json({ status: 201, data: await reuniaoService.create(tenant(req), { ...data, criadoPorId: req.user!.userId }) });
  } catch (e) { zodNext(e, next); }
});
router.put('/reunioes/:id', manage, async (req, res, next) => {
  try {
    const data = z.object({
      dataHora: z.coerce.date().optional(),
      pauta: z.string().nullable().optional(),
      participantes: z.array(z.string()).nullable().optional(),
      observacoes: z.string().nullable().optional(),
      status: z.enum(['AGENDADA', 'REALIZADA', 'CANCELADA']).optional(),
      presenca: z.enum(['PRESENTE', 'FALTOU']).optional(),
    }).parse(req.body);
    res.json({ status: 200, data: await reuniaoService.update(tenant(req), req.params.id, data) });
  } catch (e) { zodNext(e, next); }
});
router.post('/reunioes/:id/presenca', manage, async (req, res, next) => {
  try {
    const { presenca, observacoes } = z.object({ presenca: z.enum(['PRESENTE', 'FALTOU']), observacoes: z.string().optional() }).parse(req.body);
    res.json({ status: 200, data: await reuniaoService.registrarPresenca(tenant(req), req.params.id, presenca, observacoes) });
  } catch (e) { zodNext(e, next); }
});
router.delete('/reunioes/:id', manage, async (req, res, next) => {
  try { res.json({ status: 200, data: await reuniaoService.remove(tenant(req), req.params.id) }); }
  catch (e) { next(e); }
});

// ── Metas (req 33) ───────────────────────────────────────────────────────────
router.get('/metas', async (req, res, next) => {
  try { res.json({ status: 200, data: await metaService.list(tenant(req), req.query.consultorId as string | undefined) }); }
  catch (e) { next(e); }
});
router.get('/metas/progress', async (req, res, next) => {
  try {
    const q = z.object({ consultorId: z.string().uuid(), month: z.coerce.number().int().min(1).max(12), year: z.coerce.number().int() }).parse(req.query);
    res.json({ status: 200, data: await metaService.progress(tenant(req), q.consultorId, q.month, q.year) });
  } catch (e) { zodNext(e, next); }
});
router.post('/metas', manage, async (req, res, next) => {
  try {
    const data = z.object({
      consultorId: z.string().uuid(),
      month: z.number().int().min(1).max(12),
      year: z.number().int(),
      alvoRegistros: z.number().int().min(0).optional(),
      alvoPipeline: z.number().min(0).optional(),
      alvoGanho: z.number().min(0).optional(),
    }).parse(req.body);
    res.json({ status: 200, data: await metaService.upsert(tenant(req), data) });
  } catch (e) { zodNext(e, next); }
});
router.delete('/metas/:id', manage, async (req, res, next) => {
  try { res.json({ status: 200, data: await metaService.remove(tenant(req), req.params.id) }); }
  catch (e) { next(e); }
});

// ── Documentos (req 35) ──────────────────────────────────────────────────────
router.get('/documentos', async (req, res, next) => {
  try { res.json({ status: 200, data: await documentoService.list(tenant(req)) }); }
  catch (e) { next(e); }
});
router.post('/documentos', manage, upload.single('file'), async (req, res, next) => {
  try {
    const file = getFile(req);
    if (!file) return next(createError('Arquivo obrigatório', 400, 'FILE_REQUIRED'));
    const { titulo } = z.object({ titulo: z.string().min(1) }).parse(req.body);
    res.status(201).json({
      status: 201,
      data: await documentoService.upload(tenant(req), {
        titulo,
        buffer: file.buffer,
        mimeType: file.mimetype,
        fileName: file.originalname,
        criadoPorId: req.user!.userId,
      }),
    });
  } catch (e) { zodNext(e, next); }
});
router.put('/documentos/:id', manage, async (req, res, next) => {
  try {
    const data = z.object({ titulo: z.string().min(1).optional(), ativo: z.boolean().optional() }).parse(req.body);
    res.json({ status: 200, data: await documentoService.update(tenant(req), req.params.id, data) });
  } catch (e) { zodNext(e, next); }
});
router.delete('/documentos/:id', manage, async (req, res, next) => {
  try { res.json({ status: 200, data: await documentoService.remove(tenant(req), req.params.id) }); }
  catch (e) { next(e); }
});
router.get('/documentos/:id/download', async (req, res, next) => {
  try {
    const { attachment, buffer } = await documentoService.download(tenant(req), req.params.id);
    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.name)}"`);
    res.send(buffer);
  } catch (e) { next(e); }
});

// ── Config (restrição: configurável por tenant, nunca hard-coded) ────────────
router.get('/config', async (req, res, next) => {
  try { res.json({ status: 200, data: await parceiroConfigService.get(tenant(req)) }); }
  catch (e) { next(e); }
});
router.put('/config', manage, async (req, res, next) => {
  try {
    const data = z.object({
      protecaoDiasPadrao: z.number().int().min(1).max(1095).optional(),
      updateCadenciaDias: z.number().int().min(1).max(365).optional(),
      avisoExpiracaoDias: z.number().int().min(1).max(90).optional(),
      splitOriginadorPadrao: z.number().int().min(0).max(100).optional(),
      reuniaoCadenciaDias: z.number().int().min(1).max(365).optional(),
      scorePesos: z.object({
        novasOportunidades: z.number().min(0),
        updatesCumpridos: z.number().min(0),
        presencaReunioes: z.number().min(0),
        progressaoPipeline: z.number().min(0),
      }).optional(),
      scoreLimiares: z.object({ saudavel: z.number(), atencao: z.number(), esfriando: z.number() }).optional(),
      decaimentoPontosPorDia: z.number().min(0).max(10).optional(),
      decaimentoMaxPontos: z.number().int().min(0).max(100).optional(),
      // Req 26: a queda que dispara o alerta de tendência é configurável.
      quedaLimiarPontos: z.number().int().min(1).max(100).optional(),
      conflitoInternoUserId: z.string().uuid().nullable().optional(),
    }).parse(req.body);
    res.json({ status: 200, data: await parceiroConfigService.update(tenant(req), data) });
  } catch (e) { zodNext(e, next); }
});

// ── Relatório executivo em PDF (req 39) ──────────────────────────────────────
router.post('/relatorio', async (req, res, next) => {
  try {
    const tenantId = tenant(req);
    const diaIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD');
    const { periodo, inicio, fim } = z
      .object({ periodo: z.string().optional(), inicio: diaIso.optional(), fim: diaIso.optional() })
      .parse(req.body ?? {});
    const [tenantRow, consultores] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
      consultorService.list(tenantId),
    ]);
    const agora = new Date();

    // Janela do relatório (req 39: "visão do programa por período"). `fim` é
    // inclusivo para quem chama e vira o instante seguinte aqui dentro —
    // intervalo semiaberto [inicio, fim), mesma convenção de metaService.progress.
    // Sem datas explícitas o padrão é o mês corrente, que é o rótulo impresso.
    const janelaInicio = inicio
      ? new Date(`${inicio}T00:00:00`)
      : new Date(agora.getFullYear(), agora.getMonth(), 1);
    const janelaFim = fim
      ? new Date(new Date(`${fim}T00:00:00`).getTime() + 24 * 60 * 60 * 1000)
      : new Date(agora.getFullYear(), agora.getMonth() + 1, 1);
    if (janelaFim <= janelaInicio) {
      return next(createError('O fim do período deve ser posterior ao início.', 400, 'PERIODO_INVALIDO'));
    }
    const naJanela = { gte: janelaInicio, lt: janelaFim };
    // Metas são mensais: a referência é o mês em que a janela termina.
    const refMeta = new Date(janelaFim.getTime() - 1);
    const rotuloPeriodo =
      periodo ||
      (inicio || fim
        ? `${janelaInicio.toLocaleDateString('pt-BR')} a ${new Date(janelaFim.getTime() - 1).toLocaleDateString('pt-BR')}`
        : agora.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }));
    const linhas = await Promise.all(
      consultores.map(async (c) => {
        const [ativos, pipeline, ganho] = await Promise.all([
          prisma.registroOportunidade.count({ where: { tenantId, consultorId: c.id, deletedAt: null, status: { in: ['SUBMETIDO', 'EM_ANALISE', 'APROVADO'] } } }),
          prisma.registroOportunidade.aggregate({ where: { tenantId, consultorId: c.id, deletedAt: null, status: 'APROVADO' }, _sum: { valorEstimado: true } }),
          prisma.registroOportunidade.aggregate({ where: { tenantId, consultorId: c.id, deletedAt: null, status: 'GANHO', ganhoEm: naJanela }, _sum: { valorContrato: true } }),
        ]);
        const progress = await metaService
          .progress(tenantId, c.id, refMeta.getMonth() + 1, refMeta.getFullYear())
          .catch(() => null);
        return {
          nome: c.nome,
          faixa: c.scoreFaixa,
          score: c.score,
          diasSemAtividade: c.ultimaAtividadeEm
            ? Math.floor((agora.getTime() - new Date(c.ultimaAtividadeEm).getTime()) / (24 * 60 * 60 * 1000))
            : null,
          registrosAtivos: ativos,
          pipeline: Number(pipeline._sum.valorEstimado ?? 0),
          ganho: Number(ganho._sum.valorContrato ?? 0),
          metaPct: progress?.pct.ganho ?? null,
        };
      })
    );
    const [aguardando, conflitos, conflitosResolvidos, comissoes, pipelineTotal, ganhoTotal, dormentes, expirados, comWindow, tempos] =
      await Promise.all([
        prisma.registroOportunidade.count({ where: { tenantId, deletedAt: null, status: 'SUBMETIDO' } }),
        prisma.conflitoCandidato.count({ where: { tenantId, status: 'ABERTO' } }),
        prisma.conflitoCandidato.count({ where: { tenantId, status: 'RESOLVIDO', resolvidoEm: naJanela } }),
        // "Liberada" = a parcela nasce quando o cliente paga (recebimento), então
        // a janela recorta por createdAt — não pelo pagamento ao consultor.
        prisma.comissaoParcela.aggregate({ where: { tenantId, createdAt: naJanela }, _sum: { valor: true } }),
        prisma.registroOportunidade.aggregate({ where: { tenantId, deletedAt: null, status: 'APROVADO' }, _sum: { valorEstimado: true } }),
        prisma.registroOportunidade.aggregate({ where: { tenantId, deletedAt: null, status: 'GANHO', ganhoEm: naJanela }, _sum: { valorContrato: true } }),
        prisma.consultor.count({ where: { tenantId, deletedAt: null, status: 'ATIVO', scoreFaixa: { in: ['ESFRIANDO', 'FRIO'] } } }),
        prisma.registroOportunidade.count({ where: { tenantId, deletedAt: null, status: 'EXPIRADO' } }),
        prisma.registroOportunidade.count({ where: { tenantId, deletedAt: null, status: { in: ['APROVADO', 'GANHO', 'PERDIDO', 'EXPIRADO'] } } }),
        // Tempo médio das decisões TOMADAS na janela. EXPIRADO não grava
        // decididoEm, então já fica naturalmente fora deste cálculo.
        prisma.registroOportunidade.findMany({
          where: { tenantId, deletedAt: null, decididoEm: naJanela, status: { in: ['APROVADO', 'REJEITADO', 'GANHO', 'PERDIDO', 'EXPIRADO'] } },
          select: { createdAt: true, decididoEm: true },
        }),
      ]);
    const tempoMedioAprovacaoDias =
      tempos.length === 0
        ? undefined
        : Math.round(
            (tempos.reduce((acc, r) => acc + (new Date(r.decididoEm as Date).getTime() - new Date(r.createdAt).getTime()), 0) /
              tempos.length /
              (24 * 60 * 60 * 1000)) *
              10
          ) / 10;

    const { renderParceiroReportPdf } = await import('../services/pdfService.js');
    const pdf = await renderParceiroReportPdf({
      tenantName: tenantRow?.name ?? '',
      periodo: rotuloPeriodo,
      dataGeracao: agora.toLocaleDateString('pt-BR'),
      indicadores: {
        consultoresAtivos: consultores.filter((c) => c.status === 'ATIVO').length,
        consultoresDormentes: dormentes,
        pipelineParceiros: Number(pipelineTotal._sum.valorEstimado ?? 0),
        ganhoPeriodo: Number(ganhoTotal._sum.valorContrato ?? 0),
        conflitosAbertos: conflitos,
        conflitosResolvidos,
        registrosPendentes: aguardando,
        comissoesLiberadas: Number(comissoes._sum.valor ?? 0),
        taxaExpiracao: comWindow === 0 ? 0 : Math.round((expirados / comWindow) * 1000) / 10,
        tempoMedioAprovacaoDias,
      },
      consultores: linhas,
    });

    const { storageService } = await import('../services/storageService.js');
    const { sanitizeFileName } = await import('../services/attachmentService.js');
    const attachment = await storageService.put(tenantId, {
      name: sanitizeFileName(`relatorio-parceiros-${agora.toISOString().slice(0, 10)}.pdf`),
      mimeType: 'application/pdf',
      buffer: pdf,
      source: 'PARCEIRO_REPORT',
      uploadedById: req.user!.userId,
    });
    res.status(201).json({ status: 201, data: { attachmentId: attachment.id } });
  } catch (e) { zodNext(e, next); }
});

export default router;
