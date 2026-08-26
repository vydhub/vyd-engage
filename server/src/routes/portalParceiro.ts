// Portal do Parceiro — API exclusiva do CONSULTOR externo (reqs 2-8, 14, 21, 32-35).
// Isolamento: além do gate global no authenticate (papel CONSULTOR só alcança
// /portal-parceiro), TODA rota resolve o Consultor pelo vínculo 1:1 (userId) e
// filtra por tenantId + consultorId — nunca aceita consultorId do cliente.
// NDA gate: sem NDA ASSINADO, só /perfil responde (o resto: 403 NDA_PENDENTE).

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { tenantScope } from '../middleware/tenant.js';
import { createError } from '../middleware/errorHandler.js';
import prisma from '../config/database.js';
import { consultorService } from '../services/parceiros/consultorService.js';
import { registroService } from '../services/parceiros/registroService.js';
import { comissaoService } from '../services/parceiros/comissaoService.js';
import { planoAcaoService } from '../services/parceiros/planoAcaoService.js';
import { metaService } from '../services/parceiros/metaService.js';
import { documentoService } from '../services/parceiros/documentoService.js';

const router = Router();
router.use(authenticate);
router.use(tenantScope);

// Resolve o consultor do usuário autenticado (fail-closed: sem vínculo → 403).
interface ConsultorInfo {
  id: string;
  nome: string;
  ndaStatus: string;
  status: string;
}
declare module 'express-serve-static-core' {
  interface Locals {
    consultor?: ConsultorInfo;
  }
}
router.use(async (req: Request, res: Response, next: NextFunction) => {
  try {
    const consultor = await consultorService.getByUserId(req.user!.tenantId, req.user!.userId);
    if (consultor.status !== 'ATIVO') {
      return next(createError('Acesso suspenso — fale com o gestor da parceria', 403, 'CONSULTOR_NOT_ACTIVE'));
    }
    res.locals.consultor = {
      id: consultor.id,
      nome: consultor.nome,
      ndaStatus: consultor.ndaStatus,
      status: consultor.status,
    };
    next();
  } catch (error) {
    next(error);
  }
});

// NDA gate (req 3): sem NDA assinado, apenas /perfil (que mostra a pendência).
router.use((req: Request, res: Response, next: NextFunction) => {
  if (res.locals.consultor?.ndaStatus !== 'ASSINADO' && req.path !== '/perfil') {
    return next(
      createError('Assine o NDA para acessar o portal — fale com o gestor da parceria', 403, 'NDA_PENDENTE')
    );
  }
  next();
});

function ctx(res: Response): ConsultorInfo {
  return res.locals.consultor as ConsultorInfo;
}
function zodNext(error: unknown, next: (e?: unknown) => void) {
  if (error instanceof z.ZodError) {
    return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
  }
  next(error);
}

// ── Perfil ───────────────────────────────────────────────────────────────────
router.get('/perfil', async (req, res, next) => {
  try {
    const consultor = await prisma.consultor.findFirst({
      where: { id: ctx(res).id, tenantId: req.user!.tenantId },
      select: {
        id: true,
        nome: true,
        email: true,
        telefone: true,
        empresa: true,
        nivel: true,
        status: true,
        ndaStatus: true,
        score: true,
        scoreFaixa: true,
        inicioParceria: true,
      },
    });
    res.json({ status: 200, data: consultor });
  } catch (e) { next(e); }
});

// ── Minhas oportunidades (reqs 4-6, 12, 14, 22) ─────────────────────────────
router.get('/registros', async (req, res, next) => {
  try {
    res.json({ status: 200, data: await registroService.listDoConsultor(req.user!.tenantId, ctx(res).id) });
  } catch (e) { next(e); }
});
router.get('/registros/:id', async (req, res, next) => {
  try {
    res.json({ status: 200, data: await registroService.getDoConsultor(req.user!.tenantId, ctx(res).id, req.params.id) });
  } catch (e) { next(e); }
});
router.post('/registros', async (req, res, next) => {
  try {
    const data = z.object({
      clienteNome: z.string().min(1),
      clienteCnpj: z.string().nullable().optional(),
      clienteContato: z.string().nullable().optional(),
      descricao: z.string().min(1),
      valorEstimado: z.number().nullable().optional(),
      observacoes: z.string().nullable().optional(),
    }).parse(req.body);
    const created = await registroService.create(req.user!.tenantId, ctx(res).id, data);
    // Retorna a visão do PORTAL (sem conflitos/identidades) + aviso de duplicata
    // do próprio consultor (req 17/caso extremo — "avisa e sugere unificar").
    const view = await registroService.getDoConsultor(req.user!.tenantId, ctx(res).id, created.id);
    res.status(201).json({
      status: 201,
      data: { ...view, possivelDuplicata: created.possivelDuplicata ?? [] },
    });
  } catch (e) { zodNext(e, next); }
});
router.post('/registros/:id/updates', async (req, res, next) => {
  try {
    const { texto } = z.object({ texto: z.string().min(1) }).parse(req.body);
    // Posse: o registro precisa ser DESTE consultor.
    await registroService.getDoConsultor(req.user!.tenantId, ctx(res).id, req.params.id);
    res.status(201).json({
      status: 201,
      data: await registroService.addUpdate(req.user!.tenantId, req.params.id, req.user!.userId, texto),
    });
  } catch (e) { zodNext(e, next); }
});
router.post('/registros/:id/extensao', async (req, res, next) => {
  try {
    const data = z.object({ justificativa: z.string().min(3), diasSolicitados: z.number().int().min(1).max(365).optional() }).parse(req.body);
    res.status(201).json({
      status: 201,
      data: await registroService.requestExtensao(req.user!.tenantId, ctx(res).id, req.params.id, data),
    });
  } catch (e) { zodNext(e, next); }
});

// ── Minhas ações do plano (req 21) ───────────────────────────────────────────
router.post('/acoes/:id/concluir', async (req, res, next) => {
  try {
    res.json({ status: 200, data: await planoAcaoService.concluirDoConsultor(req.user!.tenantId, ctx(res).id, req.params.id) });
  } catch (e) { next(e); }
});

// ── Comissões (extrato — req 32) ─────────────────────────────────────────────
router.get('/comissoes', async (req, res, next) => {
  try {
    res.json({ status: 200, data: await comissaoService.extrato(req.user!.tenantId, { consultorId: ctx(res).id }) });
  } catch (e) { next(e); }
});

// ── Metas (req 33) ───────────────────────────────────────────────────────────
router.get('/metas', async (req, res, next) => {
  try {
    const agora = new Date();
    const [metas, progress] = await Promise.all([
      metaService.list(req.user!.tenantId, ctx(res).id),
      metaService.progress(req.user!.tenantId, ctx(res).id, agora.getMonth() + 1, agora.getFullYear()).catch(() => null),
    ]);
    res.json({ status: 200, data: { metas, progressoAtual: progress } });
  } catch (e) { next(e); }
});

// ── Reuniões (req 27) ────────────────────────────────────────────────────────
router.get('/reunioes', async (req, res, next) => {
  try {
    const reunioes = await prisma.consultorReuniao.findMany({
      where: { tenantId: req.user!.tenantId, consultorId: ctx(res).id },
      orderBy: { dataHora: 'desc' },
      take: 50,
    });
    res.json({ status: 200, data: reunioes });
  } catch (e) { next(e); }
});

// ── Documentos/templates (req 35) ────────────────────────────────────────────
router.get('/documentos', async (req, res, next) => {
  try {
    res.json({ status: 200, data: await documentoService.list(req.user!.tenantId, { ativosOnly: true }) });
  } catch (e) { next(e); }
});
router.get('/documentos/:id/download', async (req, res, next) => {
  try {
    const { attachment, buffer } = await documentoService.download(req.user!.tenantId, req.params.id, { ativosOnly: true });
    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.name)}"`);
    res.send(buffer);
  } catch (e) { next(e); }
});

export default router;
