import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { tenantScope } from '../middleware/tenant.js';
import { createError } from '../middleware/errorHandler.js';
import { API_SCOPES } from '../middleware/apiKeyAuth.js';
import prisma from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

// Scope enum for validation (API-2.1 req 18/21).
const apiScopeEnum = z.enum(API_SCOPES as unknown as [string, ...string[]]);

const router = Router();

router.use(authenticate);
router.use(tenantScope);
// API keys são integração — item exclusivo de ADMIN (req 13, defesa em profundidade).
router.use(requireRole('ADMIN'));

// GET /api/api-keys - List all API keys
router.get('/', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const apiKeys = await prisma.apiKey.findMany({
      where: { tenantId: req.user.tenantId },
      select: {
        id: true,
        name: true,
        key: true, // Already masked (stored as fcrm_****last8)
        scopes: true, // req 21 — UI lists scopes per key
        userId: true, // API-2.2 — usuario ao qual a chave esta vinculada
        lastUsedAt: true,
        expiresAt: true,
        active: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(apiKeys);
  } catch (error) {
    next(error);
  }
});

// POST /api/api-keys - Create new API key
router.post('/', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const { name, expiresAt, scopes, userId } = z
      .object({
        name: z.string().min(1),
        expiresAt: z.coerce.date().optional(),
        // req 17/18 — optional list of scopes; empty/omitted = full access (req 20).
        scopes: z.array(apiScopeEnum).optional(),
        // API-2.2 — vincula a chave a um usuario REAL do tenant (ex.: usuario de
        // servico de um agente). Sem vinculo, a chave nao alcanca as rotas que
        // dependem de req.user (deals/leads/tasks/reports).
        userId: z.string().uuid().optional(),
      })
      .parse(req.body);

    // O usuario vinculado TEM que ser do mesmo tenant de quem cria a chave.
    if (userId) {
      const target = await prisma.user.findFirst({
        where: { id: userId, tenantId: req.user.tenantId },
        select: { id: true },
      });
      if (!target) {
        return next(createError('User not found in this tenant', 404, 'USER_NOT_FOUND'));
      }
    }

    // Generate API key — store only hash + masked suffix in DB
    const apiKey = `fcrm_${uuidv4().replace(/-/g, '')}`;
    const keyHash = await bcrypt.hash(apiKey, 10);
    const keySuffix = `fcrm_****${apiKey.slice(-8)}`; // Masked version for display

    const created = await prisma.apiKey.create({
      data: {
        tenantId: req.user.tenantId,
        name,
        key: keySuffix, // Store only masked version, never plaintext
        keyHash,
        scopes: scopes ?? [],
        userId: userId ?? null,
        expiresAt,
        active: true,
      },
    });

    // Return full key only once (user must save it)
    res.status(201).json({
      id: created.id,
      name: created.name,
      key: apiKey, // Full key shown only on creation — never stored
      scopes: created.scopes, // req 21
      userId: created.userId, // API-2.2
      expiresAt: created.expiresAt,
      active: created.active,
      createdAt: created.createdAt,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
    }
    next(error);
  }
});

// DELETE /api/api-keys/:id - Revoke API key
router.delete('/:id', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const apiKey = await prisma.apiKey.findFirst({
      where: {
        id: req.params.id,
        tenantId: req.user.tenantId,
      },
    });

    if (!apiKey) {
      return next(createError('API key not found', 404));
    }

    await prisma.apiKey.update({
      where: { id: req.params.id },
      data: { active: false },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
