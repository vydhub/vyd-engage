import { Router } from 'express';
import { z } from 'zod';
import { DemandaCenario } from '@prisma/client';
import { authenticate } from '../middleware/auth.js';
import { tenantScope } from '../middleware/tenant.js';
import { createError } from '../middleware/errorHandler.js';
import { visibilityScope } from '../services/permissionService.js';
import { obterIndicadores, opcoesDosFiltros } from '../services/captura/indicadoresService.js';

/**
 * Relatório "Captura" (spec captura-demandas, E-21 a E-23). Sessão de usuário e leitura;
 * segue a mesma visibilidade sobre Negócios das demais telas comerciais.
 */
const router = Router();

router.use(authenticate);
router.use(tenantScope);

const dataCivil = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const consultaSchema = z.object({
  de: dataCivil.optional(),
  ate: dataCivil.optional(),
  cenario: z.nativeEnum(DemandaCenario).optional(),
  clienteId: z.string().uuid().optional(),
  contratoId: z.string().uuid().optional(),
  agrupar: z.enum(['cenario', 'cliente', 'contrato', 'mes']).optional(),
});

router.get('/indicadores', async (req, res, next) => {
  try {
    if (!req.user) return next(createError('Authentication required', 401));
    const filtros = consultaSchema.parse(req.query);
    const escopoDono = await visibilityScope(req.user, 'deals');
    const data = await obterIndicadores(req.user.tenantId, { ...filtros, escopoDono });
    res.json({ status: 200, data });
  } catch (erro) {
    if (erro instanceof z.ZodError) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', erro.errors));
    }
    next(erro);
  }
});

router.get('/filtros', async (req, res, next) => {
  try {
    if (!req.user) return next(createError('Authentication required', 401));
    const escopoDono = await visibilityScope(req.user, 'deals');
    res.json({ status: 200, data: await opcoesDosFiltros(req.user.tenantId, escopoDono) });
  } catch (erro) {
    next(erro);
  }
});

export default router;
