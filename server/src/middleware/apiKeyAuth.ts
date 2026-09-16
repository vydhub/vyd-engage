import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import prisma from '../config/database.js';
import { createError } from './errorHandler.js';
import { authenticate, isConsultorAllowed } from './auth.js';

/**
 * API Key authentication + scope authorization (API-2.1).
 *
 * Authenticates requests via the `X-API-Key` header, resolves the owning tenant,
 * and attaches `req.apiKey` (id, tenantId, scopes). Scope enforcement is done by
 * the separate `requireScope()` middleware, which MUST run before any route
 * handler (restriction: scope check before handler logic).
 */

// Canonical scope set (API-2.1 req 18). Any scope on a key outside this set is
// rejected (edge case: unknown scope → 400).
export const API_SCOPES = [
  'leads:read',
  'leads:write',
  'deals:read',
  'deals:write',
  'tasks:read',
  'tasks:write',
  'contacts:read',
  'reports:read',
  'webhooks:manage',
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

const API_SCOPE_SET = new Set<string>(API_SCOPES);

export interface AuthenticatedApiKey {
  id: string;
  tenantId: string;
  scopes: string[];
  /** Usuario real ao qual a chave esta vinculada (API-2.2). Nulo = chave legada. */
  userId: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- augmentação de tipos do Express exige namespace
  namespace Express {
    interface Request {
      apiKey?: AuthenticatedApiKey;
    }
  }
}

/**
 * Per-key rate limit: 1000 req/min (restriction). Keyed by API key id when
 * authenticated, else by IP. Runs after `apiKeyAuth` so `req.apiKey` is set.
 */
export const apiKeyRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.API_KEY_RATE_LIMIT || '1000', 10),
  message: { status: 429, error: 'API key rate limit exceeded (1000 req/min).' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.apiKey?.id || req.ip || 'anonymous',
});

/**
 * Authenticate via `X-API-Key`. Resolves tenant + scopes; updates lastUsedAt.
 * Fails 401 when missing/invalid/expired.
 */
export async function apiKeyAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const provided = (req.headers['x-api-key'] as string | undefined)?.trim();
    if (!provided) {
      return next(createError('API key required', 401, 'API_KEY_REQUIRED'));
    }

    // Keys are stored hashed (bcrypt). We must compare against each active key.
    const activeKeys = await prisma.apiKey.findMany({
      where: { active: true },
      select: {
        id: true,
        tenantId: true,
        keyHash: true,
        scopes: true,
        expiresAt: true,
        userId: true,
      },
    });

    let matched: (typeof activeKeys)[number] | null = null;
    for (const key of activeKeys) {
      if (await bcrypt.compare(provided, key.keyHash)) {
        matched = key;
        break;
      }
    }

    if (!matched) {
      return next(createError('Invalid API key', 401, 'API_KEY_INVALID'));
    }

    if (matched.expiresAt && matched.expiresAt.getTime() < Date.now()) {
      return next(createError('API key expired', 401, 'API_KEY_EXPIRED'));
    }

    req.apiKey = {
      id: matched.id,
      tenantId: matched.tenantId,
      scopes: matched.scopes ?? [],
      userId: matched.userId ?? null,
    };

    // Best-effort lastUsedAt update — never block the request.
    prisma.apiKey
      .update({ where: { id: matched.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Require a specific scope on the authenticated API key. MUST run after
 * `apiKeyAuth` and before the route handler.
 *
 *  - Empty scopes  → full access (req 20, backward compat for legacy keys).
 *  - Unknown scope on the key → 400 (edge case).
 *  - Key has scopes but not the required one → 403.
 */
export function requireScope(scope: ApiScope) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.apiKey) {
      return next(createError('API key authentication required', 401, 'API_KEY_REQUIRED'));
    }

    const scopes = req.apiKey.scopes;

    // Legacy keys (no scopes) keep full access.
    if (scopes.length === 0) return next();

    // Reject keys carrying a scope the system doesn't recognize (edge case → 400).
    const unknown = scopes.find((s) => !API_SCOPE_SET.has(s));
    if (unknown) {
      return next(
        createError(`Unknown scope on API key: ${unknown}`, 400, 'API_KEY_UNKNOWN_SCOPE')
      );
    }

    if (!scopes.includes(scope)) {
      return next(
        createError(`API key missing required scope: ${scope}`, 403, 'API_KEY_INSUFFICIENT_SCOPE')
      );
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// API-2.2 - Chave de API como credencial de um usuario REAL
// ---------------------------------------------------------------------------

/**
 * Leitura por API Key nas rotas que dependem de `req.user`.
 *
 * As rotas comerciais (deals/leads/tasks/reports) resolvem tenant, visibilidade e
 * perfil de permissao a partir de `req.user` - uma API Key sozinha nao e um
 * principal. Por isso a chave precisa estar VINCULADA a um usuario real
 * (`ApiKey.userId`), e este middleware carrega esse usuario com exatamente as
 * mesmas checagens do `authenticate` (existe, ACTIVE, gate do CONSULTOR).
 * Nenhuma identidade e fabricada.
 *
 * FAIL-CLOSED em camadas:
 *  1. sem header `X-API-Key` -> delega ao `authenticate` de sempre (nada muda);
 *  2. `ENABLE_API_KEY_READ` != 'true' -> 401 (desligado por padrao, inclusive em producao);
 *  3. metodo != GET/HEAD -> 403 (por esta porta a chave e SOMENTE LEITURA);
 *  4. chave sem `userId` (legado) -> 403;
 *  5. escopo ausente -> 403 (`requireScope`);
 *  6. usuario inexistente/inativo, ou de tenant diferente do da chave -> 401/403.
 */
export function apiKeyReadEnabled(): boolean {
  return process.env.ENABLE_API_KEY_READ === 'true';
}

async function attachApiKeyUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const boundUserId = req.apiKey?.userId;
    if (!boundUserId) {
      return next(createError('API key is not bound to a user', 403, 'API_KEY_NOT_BOUND'));
    }

    const user = await prisma.user.findUnique({
      where: { id: boundUserId },
      select: {
        id: true,
        email: true,
        status: true,
        tenantId: true,
        role: true,
        isPlatformAdmin: true,
      },
    });

    if (!user) {
      return next(createError('User not found', 401, 'USER_NOT_FOUND'));
    }
    if (user.status !== 'ACTIVE') {
      return next(createError('User account is not active', 403, 'USER_INACTIVE'));
    }
    // Defesa em profundidade: a FK nao impede vincular por engano um usuario de
    // outro tenant. O tenant da chave e o do usuario TEM que ser o mesmo.
    if (user.tenantId !== req.apiKey?.tenantId) {
      return next(createError('API key/user tenant mismatch', 403, 'API_KEY_TENANT_MISMATCH'));
    }

    req.user = {
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
      isPlatformAdmin: user.isPlatformAdmin,
    };

    // Mesmo gate fail-closed do `authenticate`.
    if (user.role === 'CONSULTOR' && !isConsultorAllowed(req.originalUrl)) {
      return next(createError('Acesso restrito ao Portal do Parceiro', 403, 'PORTAL_ONLY'));
    }

    next();
  } catch (error) {
    next(error);
  }
}

export function authenticateOrApiKey(scope: ApiScope) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const provided = (req.headers['x-api-key'] as string | undefined)?.trim();

    // Sem chave: caminho de sempre (sessao JWT), byte a byte o comportamento atual.
    if (!provided) {
      void authenticate(req, res, next);
      return;
    }

    if (!apiKeyReadEnabled()) {
      return next(createError('API key access is disabled', 401, 'API_KEY_DISABLED'));
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return next(createError('API keys are read-only here', 403, 'API_KEY_READ_ONLY'));
    }

    void apiKeyAuth(req, res, (authErr?: unknown) => {
      if (authErr) return next(authErr);
      apiKeyRateLimiter(req, res, (limitErr?: unknown) => {
        if (limitErr) return next(limitErr);
        requireScope(scope)(req, res, (scopeErr?: unknown) => {
          if (scopeErr) return next(scopeErr);
          void attachApiKeyUser(req, res, next);
        });
      });
    });
  };
}
