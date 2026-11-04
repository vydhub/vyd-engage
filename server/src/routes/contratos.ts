import { type NextFunction, type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { apiKeyAuth, apiKeyRateLimiter, requireExplicitScope } from '../middleware/apiKeyAuth.js';
import type { AppError } from '../middleware/errorHandler.js';
import { contratoService } from '../services/contratoService.js';
import { logger } from '../utils/logger.js';

/**
 * GET /api/v1/contratos?atualizado_desde=&cursor=&limite= (spec captura-demandas, E-19).
 *
 * Só por chave com o escopo explícito `contracts:read`. Devolve também os excluídos
 * logicamente, para a Captura e o Flow saberem o que saiu. A tela usa /gestao-contratos.
 */
const router = Router();

const consultaSchema = z.object({
  atualizado_desde: z
    .string()
    .datetime({ offset: true })
    .transform((valor) => new Date(valor))
    .optional(),
  cursor: z.string().min(1).optional(),
  limite: z.coerce.number().int().min(1).max(200).optional(),
});

router.get(
  '/',
  apiKeyAuth,
  apiKeyRateLimiter,
  requireExplicitScope('contracts:read'),
  async (req, res, next) => {
    try {
      const consulta = consultaSchema.safeParse(req.query);
      if (!consulta.success) {
        const primeiro = consulta.error.errors[0];
        return res.status(422).json({
          codigo: 'DADOS_INVALIDOS',
          mensagem: primeiro?.message ?? 'Dados inválidos',
          campo: primeiro?.path.join('.') || null,
        });
      }
      res.json(
        await contratoService.listarParaApi(req.apiKey!.tenantId, {
          atualizadoDesde: consulta.data.atualizado_desde,
          cursor: consulta.data.cursor,
          limite: consulta.data.limite,
        })
      );
    } catch (erro) {
      next(erro);
    }
  }
);

router.use((erro: AppError, req: Request, res: Response, _next: NextFunction) => {
  const status = erro.statusCode || 500;
  if (status >= 500) {
    logger.error('Erro na rota de contratos', erro, { path: req.path, method: req.method });
  }
  res.status(status).json({
    codigo: erro.code || 'ERRO_INTERNO',
    mensagem: status >= 500 ? 'Erro interno' : erro.message,
  });
});

export default router;
