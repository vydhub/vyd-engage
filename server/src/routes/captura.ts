import express, { type NextFunction, type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { DemandaCenario, DemandaEstado } from '@prisma/client';
import {
  apiKeyAuth,
  apiKeyRateLimiter,
  attachApiKeyUser,
  requireExplicitScope,
} from '../middleware/apiKeyAuth.js';
import type { AppError } from '../middleware/errorHandler.js';
import { obterCalendario, salvarCalendario } from '../services/captura/calendarioService.js';
import {
  aplicarEvento,
  atualizarDemanda,
  buscarClientes,
  criarDemanda,
} from '../services/captura/demandaService.js';
import { logger } from '../utils/logger.js';
import { conferirAssinaturaVyd } from '../utils/vydHmac.js';

/**
 * Rotas de máquina da Captura (spec captura-demandas, E-13, E-14, E-15, E-18, E-19).
 *
 * Fora do CSRF: quem chama é serviço, autenticado por chave (`X-API-Key`) ou por HMAC.
 * Erros em JSON, com `codigo` e `mensagem` (contrato 06, §6). A chave precisa do escopo
 * explícito: chave legada, com `scopes` vazio, é recusada aqui.
 */
const router = Router();

/**
 * Lê os eventos como bytes, antes do `express.json` global: corpo malformado sem assinatura
 * recebe 401, e não 400, e o texto recebido não vai para o log do parser (contrato 06, §1).
 */
export const corpoCruDosEventos = [
  express.raw({ type: () => true, limit: '1mb' }),
  (req: Request, _res: Response, next: NextFunction) => {
    if (Buffer.isBuffer(req.body)) {
      (req as Request & { rawBody?: string }).rawBody = req.body.toString('utf8');
    }
    next();
  },
];

const dataIso = z
  .string()
  .datetime({ offset: true })
  .transform((valor) => new Date(valor));
const uuid = z.string().uuid();
const emailMinusculo = z
  .string()
  .trim()
  .email()
  .transform((valor) => valor.toLowerCase());
// Teto de Deal.value, Decimal(12, 2): o valor do evento é gravado também lá (E-15). O valor
// estimado vem de extração por IA, e um número mal lido precisa dar 422, e não 500 sem fim.
const dinheiro = z.number().finite().nonnegative().max(9_999_999_999.99);
const TETO_INT = 2_147_483_647;

const semNul = (valor: string) => !valor.includes('\u0000');
const CARACTERE_INVALIDO = 'Caractere inválido';
const tirarNul = (valor: string) => valor.split('\u0000').join('');
const chaveDedup = z.string().trim().min(1).max(998).refine(semNul, CARACTERE_INVALIDO);
// O link vira `href` na tela do Negócio: `javascript:` passa no .url() e não pode entrar.
const linkOriginal = z
  .string()
  .url()
  .refine(semNul, CARACTERE_INVALIDO)
  .refine((valor) => /^https?:\/\//i.test(valor), 'Use um link http ou https');
// W-39 (filha 08): a situação do item no portal do cliente. Só informa: não muda etapa nem estado.
const situacaoOrigem = z.string().trim().max(200).refine(semNul, CARACTERE_INVALIDO);

const criarSchema = z.object({
  chave_dedup: chaveDedup,
  id_captura: uuid,
  cenario: z.nativeEnum(DemandaCenario),
  fonte: z.string().trim().min(1).max(320).refine(semNul, CARACTERE_INVALIDO),
  nivel: z.number().int().min(0).max(TETO_INT),
  recebido_em_origem: dataIso,
  capturado_em: dataIso,
  cliente_id: uuid,
  contrato_id: uuid.nullable().optional(),
  objeto: z.string().trim().min(1).refine(semNul, CARACTERE_INVALIDO),
  valor_estimado: dinheiro.nullable().optional(),
  flow_card_id: uuid.nullable().optional(),
  link_original: linkOriginal.nullable().optional(),
  responsavel_email: emailMinusculo.nullable().optional(),
  situacao_origem: situacaoOrigem.nullable().optional(),
  situacao_origem_em: dataIso.nullable().optional(),
});

const atualizarSchema = z.object({
  flow_card_id: uuid.nullable().optional(),
  link_original: linkOriginal.nullable().optional(),
  cliente_id: uuid.optional(),
  cenario: z.nativeEnum(DemandaCenario).optional(),
  contrato_id: uuid.nullable().optional(),
  responsavel_email: emailMinusculo.nullable().optional(),
  situacao_origem: situacaoOrigem.nullable().optional(),
  situacao_origem_em: dataIso.nullable().optional(),
  adendo: z
    .object({
      texto: z.string().transform(tirarNul).pipe(z.string().trim().min(1)),
      em: dataIso.nullable().optional(),
    })
    .optional(),
});

const eventoSchema = z.object({
  evento_id: uuid,
  chave_dedup: chaveDedup,
  flow_card_id: uuid.nullable().optional(),
  estado: z.nativeEnum(DemandaEstado),
  ocorrido_em: dataIso,
  valor_enviado: dinheiro.nullable().optional(),
  valor_aprovado: dinheiro.nullable().optional(),
  // Campos acessórios não seguram o evento: um 422 aqui faria o Flow reenviar para sempre, e
  // o estado do Negócio não andaria por causa de um texto malformado.
  motivo: z
    .string()
    .nullable()
    .optional()
    .transform((valor) => (valor ? tirarNul(valor).trim() : null) || null),
  autor_email: z
    .string()
    .nullable()
    .optional()
    .transform((valor) => (valor ? tirarNul(valor).trim().toLowerCase() : null) || null),
});

const textoDeBusca = z.string().transform(tirarNul).pipe(z.string().trim().min(1)).optional();
const buscaSchema = z
  .object({
    cnpj: textoDeBusca,
    dominio: textoDeBusca,
    nome: textoDeBusca,
  })
  .refine((busca) => busca.cnpj || busca.dominio || busca.nome, {
    message: 'Informe cnpj, dominio ou nome',
    path: ['nome'],
  });

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATA_CIVIL = /^\d{4}-\d{2}-\d{2}$/;

function fusoValido(fuso: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: fuso });
    return true;
  } catch {
    return false;
  }
}

function dataCivilValida(valor: string): boolean {
  if (!DATA_CIVIL.test(valor)) return false;
  const data = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(data.getTime()) && data.toISOString().slice(0, 10) === valor;
}

// Todos os campos são obrigatórios: o PUT troca o calendário inteiro (adendo 06, E-23).
const calendarioSchema = z
  .object({
    dias_uteis: z
      .array(z.number().int().min(0).max(6))
      .min(1, 'Informe ao menos um dia útil')
      .refine((dias) => new Set(dias).size === dias.length, 'Dia repetido'),
    inicio: z.string().regex(HORA, 'Use o formato HH:MM'),
    fim: z.string().regex(HORA, 'Use o formato HH:MM'),
    fuso: z.string().refine(fusoValido, 'Fuso desconhecido'),
    excluir_feriados_nacionais: z.boolean(),
    feriados_extras: z.array(z.string().refine(dataCivilValida, 'Use o formato AAAA-MM-DD')),
  })
  .refine((c) => c.fim > c.inicio, { message: 'O fim deve ser depois do início', path: ['fim'] });

function responderInvalido(res: Response, erro: z.ZodError) {
  const primeiro = erro.errors[0];
  return res.status(422).json({
    codigo: 'DADOS_INVALIDOS',
    mensagem: primeiro?.message ?? 'Dados inválidos',
    campo: primeiro?.path.join('.') || null,
    erros: erro.errors.map((e) => ({ campo: e.path.join('.'), mensagem: e.message })),
  });
}

const chaveDeEscrita = [
  apiKeyAuth,
  apiKeyRateLimiter,
  requireExplicitScope('captura:write'),
  attachApiKeyUser,
];
const chaveDeLeitura = [apiKeyAuth, apiKeyRateLimiter, requireExplicitScope('contracts:read')];

// POST /api/v1/captura/demandas — idempotente por chave_dedup (E-13)
router.post('/demandas', ...chaveDeEscrita, async (req, res, next) => {
  try {
    const corpo = criarSchema.safeParse(req.body);
    if (!corpo.success) return responderInvalido(res, corpo.error);
    const resposta = await criarDemanda(req.apiKey!.tenantId, corpo.data);
    res.status(resposta.repetido ? 200 : 201).json(resposta);
  } catch (erro) {
    next(erro);
  }
});

// PATCH /api/v1/captura/demandas/:engage_id — vínculos, adendos e reclassificação (E-14)
router.patch('/demandas/:engage_id', ...chaveDeEscrita, async (req, res, next) => {
  try {
    const id = uuid.safeParse(req.params.engage_id);
    if (!id.success) {
      return res
        .status(404)
        .json({ codigo: 'DEMANDA_NAO_ENCONTRADA', mensagem: 'Demanda não encontrada' });
    }
    const corpo = atualizarSchema.safeParse(req.body);
    if (!corpo.success) return responderInvalido(res, corpo.error);
    res.json(await atualizarDemanda(req.apiKey!.tenantId, id.data, corpo.data, req.user!.userId));
  } catch (erro) {
    next(erro);
  }
});

// GET /api/v1/captura/clientes?cnpj=&dominio=&nome= — busca de cliente (E-19)
router.get('/clientes', ...chaveDeLeitura, async (req, res, next) => {
  try {
    const busca = buscaSchema.safeParse(req.query);
    if (!busca.success) return responderInvalido(res, busca.error);
    res.json(await buscarClientes(req.apiKey!.tenantId, busca.data));
  } catch (erro) {
    next(erro);
  }
});

// GET /api/v1/captura/calendario — o Engage é a fonte, e a Captura copia (E-23, adendo 06)
router.get('/calendario', ...chaveDeLeitura, async (req, res, next) => {
  try {
    res.json(await obterCalendario(req.apiKey!.tenantId));
  } catch (erro) {
    next(erro);
  }
});

// PUT /api/v1/captura/calendario — o console altera por aqui, por meio da Captura
router.put('/calendario', ...chaveDeEscrita, async (req, res, next) => {
  try {
    const corpo = calendarioSchema.safeParse(req.body);
    if (!corpo.success) return responderInvalido(res, corpo.error);
    res.json(await salvarCalendario(req.apiKey!.tenantId, req.user!.userId, corpo.data));
  } catch (erro) {
    next(erro);
  }
});

// POST /api/v1/captura/eventos — estado e valores vindos do Flow, com HMAC (E-15)
router.post('/eventos', async (req, res, next) => {
  try {
    const segredo = process.env.CAPTURA_EVENTOS_HMAC;
    const tenantId = process.env.CAPTURA_TENANT_ID;
    if (!segredo || !tenantId) {
      return res.status(503).json({
        codigo: 'CAPTURA_NAO_CONFIGURADA',
        mensagem: 'Eventos do Radar não configurados neste servidor',
      });
    }

    // O corpo cru é o que foi assinado (`corpoCruDosEventos`, montado antes do parser global).
    const corpoCru = (req as Request & { rawBody?: string }).rawBody ?? '';
    const recusa = conferirAssinaturaVyd({
      segredo,
      timestamp: req.get('x-vyd-timestamp'),
      assinatura: req.get('x-vyd-assinatura'),
      corpoCru,
    });
    if (recusa) {
      return res.status(401).json({ codigo: recusa, mensagem: 'Assinatura recusada' });
    }

    // Só depois da assinatura o corpo é interpretado.
    let bruto: unknown;
    try {
      bruto = JSON.parse(corpoCru);
    } catch {
      return res.status(400).json({ codigo: 'JSON_INVALIDO', mensagem: 'Corpo não é JSON válido' });
    }
    const corpo = eventoSchema.safeParse(bruto);
    if (!corpo.success) return responderInvalido(res, corpo.error);

    const resultado = await aplicarEvento(tenantId, corpo.data);
    if (!resultado) {
      return res.status(409).json({
        codigo: 'DEMANDA_INEXISTENTE',
        mensagem: 'Demanda ainda não existe no Engage. O Flow deve reenviar.',
      });
    }
    res.json({ aplicado: resultado.aplicado });
  } catch (erro) {
    next(erro);
  }
});

// Erros desta porta saem no formato do contrato, com `codigo` e `mensagem`.
router.use((erro: AppError, req: Request, res: Response, _next: NextFunction) => {
  const status = erro.statusCode || 500;
  const detalhes = (erro as AppError & { details?: { campo?: string } }).details;
  if (status >= 500) {
    logger.error('Erro nas rotas da Captura', erro, { path: req.path, method: req.method });
  }
  res.status(status).json({
    codigo: erro.code || 'ERRO_INTERNO',
    mensagem: status >= 500 ? 'Erro interno' : erro.message,
    ...(detalhes?.campo ? { campo: detalhes.campo } : {}),
  });
});

export default router;
