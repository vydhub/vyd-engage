import { Router } from 'express';
import { z } from 'zod';
import { ContratoMovimentoTipo, ContratoTipo } from '@prisma/client';
import { authenticate, requireRole } from '../middleware/auth.js';
import { tenantScope } from '../middleware/tenant.js';
import { createError } from '../middleware/errorHandler.js';
import { contratoService, normalizarNumero } from '../services/contratoService.js';

/**
 * Tela de contratos (spec captura-demandas, E-07). Sessão e CSRF, como as demais rotas de
 * tela. Qualquer usuário do tenant lê; ADMIN e GESTOR editam.
 */
const router = Router();

router.use(authenticate);
router.use(tenantScope);

const podeEditar = requireRole('ADMIN', 'GESTOR');

// Teto das colunas Decimal(14, 2) e Int: fora da faixa é erro de dado, não 500.
const TETO_DINHEIRO = 999_999_999_999.99;
const TETO_INT = 2_147_483_647;

const dataCivil = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD');
const emailOpcional = z
  .string()
  .trim()
  .email()
  .nullable()
  .optional()
  .or(z.literal('').transform(() => null));
const textoOpcional = z.string().nullable().optional();

// O número chega como veio (o Flow tem códigos com espaços e tabulação nas pontas) e a
// conferência de unicidade é sobre o valor já normalizado.
const numeroContrato = z
  .string()
  .transform(normalizarNumero)
  .refine((valor) => valor.length > 0, 'Informe o número do contrato');

const camposDoContrato = z.object({
  companyId: z.string().uuid(),
  numero: numeroContrato,
  numeroCliente: textoOpcional,
  tipo: z.nativeEnum(ContratoTipo).optional(),
  objeto: textoOpcional,
  escopo: textoOpcional,
  vigenciaInicio: dataCivil.nullable().optional(),
  vigenciaFim: dataCivil.nullable().optional(),
  valorContratado: z.number().finite().nonnegative().max(TETO_DINHEIRO).nullable().optional(),
  slaRespostaHoras: z.number().int().positive().max(TETO_INT).nullable().optional(),
  gerenteNome: textoOpcional,
  gerenteEmail: emailOpcional,
  planejadorNome: textoOpcional,
  planejadorEmail: emailOpcional,
});

const vigenciaCoerente = (dados: { vigenciaInicio?: string | null; vigenciaFim?: string | null }) =>
  !dados.vigenciaInicio || !dados.vigenciaFim || dados.vigenciaFim >= dados.vigenciaInicio;
const erroDeVigencia = {
  message: 'O fim da vigência deve ser igual ou posterior ao início',
  path: ['vigenciaFim'],
};

const criarSchema = camposDoContrato.refine(vigenciaCoerente, erroDeVigencia);
const atualizarSchema = camposDoContrato.partial().refine(vigenciaCoerente, erroDeVigencia);

const solicitanteSchema = z.object({
  nome: textoOpcional,
  email: z.string().trim().email(),
});
const itemSchema = z.object({
  descricao: z.string().trim().min(1),
  disciplina: textoOpcional,
});
const movimentoSchema = z.object({
  tipo: z.nativeEnum(ContratoMovimentoTipo),
  valor: z.number().finite().min(-TETO_DINHEIRO).max(TETO_DINHEIRO),
  motivo: textoOpcional,
});

const listaSchema = z.object({
  busca: z.string().optional(),
  companyId: z.string().uuid().optional(),
  lacuna: z.enum(['sem_solicitantes', 'sem_sla', 'sem_valor', 'sem_gerente']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

type Tratador = (req: import('express').Request) => Promise<{ status?: number; data: unknown }>;

/** Padrão das rotas daqui: validação vira 400 e `numero` repetido responde com o existente. */
function rota(tratador: Tratador) {
  return async (
    req: import('express').Request,
    res: import('express').Response,
    next: import('express').NextFunction
  ) => {
    try {
      const { status = 200, data } = await tratador(req);
      res.status(status).json({ status, data });
    } catch (erro) {
      if (erro instanceof z.ZodError) {
        return next(createError('Validation error', 400, 'VALIDATION_ERROR', erro.errors));
      }
      const comExistente = erro as { code?: string; message?: string; existente?: unknown };
      if (comExistente.code === 'CONTRATO_NUMERO_REPETIDO') {
        return res.status(409).json({
          status: 409,
          error: comExistente.message,
          code: comExistente.code,
          existente: comExistente.existente,
        });
      }
      next(erro);
    }
  };
}

router.get(
  '/',
  rota(async (req) => ({
    data: await contratoService.listar(req.user!.tenantId, listaSchema.parse(req.query)),
  }))
);

router.get(
  '/:id',
  rota(async (req) => ({ data: await contratoService.obter(req.user!.tenantId, req.params.id) }))
);

router.post(
  '/',
  podeEditar,
  rota(async (req) => ({
    status: 201,
    data: await contratoService.criar(
      req.user!.tenantId,
      criarSchema.parse(req.body),
      req.user!.userId
    ),
  }))
);

router.put(
  '/:id',
  podeEditar,
  rota(async (req) => ({
    data: await contratoService.atualizar(
      req.user!.tenantId,
      req.params.id,
      atualizarSchema.parse(req.body),
      req.user!.userId
    ),
  }))
);

router.delete(
  '/:id',
  podeEditar,
  rota(async (req) => ({
    data: await contratoService.excluir(req.user!.tenantId, req.params.id, req.user!.userId),
  }))
);

router.post(
  '/:id/solicitantes',
  podeEditar,
  rota(async (req) => ({
    status: 201,
    data: await contratoService.adicionarSolicitante(
      req.user!.tenantId,
      req.params.id,
      solicitanteSchema.parse(req.body)
    ),
  }))
);

router.put(
  '/:id/solicitantes/:solicitanteId',
  podeEditar,
  rota(async (req) => ({
    data: await contratoService.atualizarSolicitante(
      req.user!.tenantId,
      req.params.id,
      req.params.solicitanteId,
      solicitanteSchema.partial().parse(req.body)
    ),
  }))
);

router.delete(
  '/:id/solicitantes/:solicitanteId',
  podeEditar,
  rota(async (req) => ({
    data: await contratoService.removerSolicitante(
      req.user!.tenantId,
      req.params.id,
      req.params.solicitanteId
    ),
  }))
);

router.post(
  '/:id/itens',
  podeEditar,
  rota(async (req) => ({
    status: 201,
    data: await contratoService.adicionarItem(
      req.user!.tenantId,
      req.params.id,
      itemSchema.parse(req.body)
    ),
  }))
);

router.put(
  '/:id/itens/:itemId',
  podeEditar,
  rota(async (req) => ({
    data: await contratoService.atualizarItem(
      req.user!.tenantId,
      req.params.id,
      req.params.itemId,
      itemSchema.partial().parse(req.body)
    ),
  }))
);

router.delete(
  '/:id/itens/:itemId',
  podeEditar,
  rota(async (req) => ({
    data: await contratoService.removerItem(req.user!.tenantId, req.params.id, req.params.itemId),
  }))
);

// Movimento só se cria: não há rota de edição nem de exclusão (E-05).
router.post(
  '/:id/movimentos',
  podeEditar,
  rota(async (req) => ({
    status: 201,
    data: await contratoService.registrarMovimento(
      req.user!.tenantId,
      req.params.id,
      movimentoSchema.parse(req.body),
      req.user!.userId
    ),
  }))
);

export default router;
