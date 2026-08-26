import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, TokenPayload } from '../utils/jwt.js';
import { createError } from './errorHandler.js';
import prisma from '../config/database.js';
import { can, getEffective, type Capability } from '../services/permissionService.js';

// Extend Express Request to include user (+ flag de super-admin da plataforma)
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- augmentação de tipos do Express exige namespace
  namespace Express {
    interface Request {
      user?: TokenPayload & { isPlatformAdmin?: boolean };
    }
  }
}

// ── Gate do Portal do Parceiro (papel CONSULTOR) ─────────────────────────────
// FAIL-CLOSED (spec gestao-parceiros-comerciais, req 2): o consultor externo só
// alcança o Portal do Parceiro. Este é o ÚNICO choke point de todas as rotas
// autenticadas (não há authenticate global no v1Router — cada router o aplica),
// então o bloqueio aqui cobre 100% do CRM interno. A allowlist considera os DOIS
// prefixos de montagem (/api/v1 canônico e /api alias).
// Prefixos que o consultor pode alcançar por completo (todas as sub-rotas).
const CONSULTOR_ALLOWED_PREFIXES = [
  '/api/v1/portal-parceiro',
  '/api/portal-parceiro',
  '/api/v1/notifications', // in-app do portal (escopadas por userId)
  '/api/notifications',
];

// Sub-rotas de /auth liberadas ao consultor — allowlist EXPLÍCITA (fail-closed).
// NÃO inclui /auth/tenant (GET expõe settings internos; PUT deixaria o consultor
// renomear o tenant e redirecionar webhooks internos — lacuna de segurança).
const CONSULTOR_ALLOWED_AUTH_SUBPATHS = [
  '/me',
  '/logout',
  '/logout-all',
  '/profile',
  '/change-password',
  '/email/verify-request',
  '/email/verify',
  '/2fa/setup',
  '/2fa/verify',
  '/2fa/disable',
  '/2fa/status',
];

function matchesPrefix(url: string, p: string): boolean {
  return url === p || url.startsWith(`${p}/`) || url.startsWith(`${p}?`);
}

export function isConsultorAllowed(url: string): boolean {
  if (CONSULTOR_ALLOWED_PREFIXES.some((p) => matchesPrefix(url, p))) return true;
  for (const authBase of ['/api/v1/auth', '/api/auth']) {
    if (!matchesPrefix(url, authBase)) continue;
    // Extrai a sub-rota após o prefixo de auth e confere na allowlist (ignora query).
    const sub = url.slice(authBase.length).split('?')[0].replace(/\/$/, '');
    if (CONSULTOR_ALLOWED_AUTH_SUBPATHS.includes(sub)) return true;
  }
  return false;
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Read token from httpOnly cookie (primary) or Authorization header (fallback)
    const authHeader = req.headers.authorization;
    const cookieToken = req.cookies?.accessToken;
    const token =
      cookieToken || (authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null);

    if (!token) {
      throw createError('No token provided', 401, 'NO_TOKEN');
    }

    const payload = verifyAccessToken(token);

    // Verify user still exists and is active
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        email: true,
        status: true,
        tenantId: true,
        role: true,
        isPlatformAdmin: true,
        tokensValidAfter: true,
      },
    });

    if (!user) {
      throw createError('User not found', 401, 'USER_NOT_FOUND');
    }

    if (user.status !== 'ACTIVE') {
      throw createError('User account is not active', 403, 'USER_INACTIVE');
    }

    // Onda 4 (verbo logout): "Sair de todas as ferramentas" no VYD ID apaga os
    // refresh tokens E carimba esta marca. Sem a comparação abaixo, o access
    // token de 15min que já estava em voo continuaria valendo até expirar —
    // o logout pareceria instantâneo mas não seria.
    //
    // Comparação em segundos porque `iat` do JWT é epoch inteiro (piso do
    // instante de emissão); a marca tem milissegundos. Estrita: no empate
    // dentro do mesmo segundo o token cai, que é o lado seguro do erro.
    const iatSegundos = (payload as { iat?: number }).iat;
    if (
      user.tokensValidAfter &&
      typeof iatSegundos === 'number' &&
      iatSegundos < Math.floor(user.tokensValidAfter.getTime() / 1000) + 1
    ) {
      throw createError('Session has been ended', 401, 'SESSION_ENDED');
    }

    // Attach user to request
    req.user = {
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
      isPlatformAdmin: user.isPlatformAdmin,
    };

    // Papel CONSULTOR: restrito ao Portal do Parceiro (fail-closed).
    if (user.role === 'CONSULTOR' && !isConsultorAllowed(req.originalUrl)) {
      throw createError('Acesso restrito ao Portal do Parceiro', 403, 'PORTAL_ONLY');
    }

    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(createError('Authentication required', 401, 'NOT_AUTHENTICATED'));
    }

    if (!roles.includes(req.user.role)) {
      return next(createError('Insufficient permissions', 403, 'INSUFFICIENT_PERMISSIONS'));
    }

    next();
  };
}

/**
 * Configuração do processo comercial (funis/etapas/campos/motivos/fontes/produtos):
 * leitura (GET/HEAD/OPTIONS) é livre para qualquer autenticado (necessária para
 * preencher formulários), mas escrita exige GESTOR ou ADMIN (spec papeis-comerciais,
 * reqs 9 e 10).
 *
 * Upgrade RD P1 (req 13, capability `configure`): além do piso de papel ADMIN/GESTOR,
 * a escrita passa a respeitar a capability `configure` do perfil de permissão efetivo.
 * FAIL-CLOSED / DEFAULT == HOJE: os builtins ADMIN/GESTOR têm `configure=true`, logo
 * seguem escrevendo exatamente como hoje — a checagem só NEGA (403) quando um admin
 * atribuiu ao usuário um perfil custom com `configure=false`. Uma única mudança aqui
 * cobre TODAS as rotas de settings que já usam `requireManagerForWrites`
 * (funnels/customFields/scoring/dealSources/originCampaigns/stageTaskTemplates/
 * products/lostReasons/salesConfig/questionnaires) sem tocar cada uma.
 *
 * É `async` (consulta o perfil efetivo), mas continua um middleware Express válido:
 * resolve SEMPRE via `next()`/`next(err)` e nunca lança para o chamador síncrono.
 */
export async function requireManagerForWrites(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }
  // Piso de papel (fail-closed): ADMIN/GESTOR. Encadeia a checagem de `configure`
  // só quando o piso passa; qualquer negação de papel curto-circuita aqui.
  return requireRole('ADMIN', 'GESTOR')(req, res, (err?: unknown) => {
    if (err) return next(err);
    void (async () => {
      try {
        const user = req.user!; // garantido por requireRole (401 caso ausente)
        const effective = await getEffective({
          userId: user.userId,
          tenantId: user.tenantId,
          role: user.role,
          isPlatformAdmin: user.isPlatformAdmin,
        });
        if (effective.capabilities.configure !== true) {
          return next(createError('Insufficient permissions', 403, 'INSUFFICIENT_PERMISSIONS'));
        }
        next();
      } catch (error) {
        next(error);
      }
    })();
  });
}

/**
 * Exige uma capability do perfil de permissão efetivo do usuário (Upgrade RD P1).
 * FAIL-CLOSED: 401 sem usuário; 403 quando `can(cap)` é falso. Sem perfil custom,
 * `can` recai nos defaults do baseRole (== comportamento de hoje) — logo esta
 * guarda só NEGA quando um admin configurou explicitamente a restrição.
 */
export function requirePermission(cap: Capability) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      return next(createError('Authentication required', 401, 'NOT_AUTHENTICATED'));
    }
    try {
      const allowed = await can(
        {
          userId: req.user.userId,
          tenantId: req.user.tenantId,
          role: req.user.role,
          isPlatformAdmin: req.user.isPlatformAdmin,
        },
        cap
      );
      if (!allowed) {
        return next(createError('Insufficient permissions', 403, 'INSUFFICIENT_PERMISSIONS'));
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Exige uma capability, mas SOMENTE quando a restrição é EXPLÍCITA (perfil custom).
 *
 * Diferença para `requirePermission`: aqui os builtins SEMPRE passam, mesmo quando o
 * default do baseRole é `false`. Só nega (403) quando o usuário tem um perfil CUSTOM
 * (`hasCustomProfile`) que desligou a capability. Use isto onde a rota HOJE não tem
 * guarda de papel (comportamento aberto) e não se pode regredir o builtin.
 *
 * Caso de uso (req 13, `manageAutomations`): as rotas de automações não têm guarda
 * de papel hoje — qualquer autenticado (incl. USER/VIEWER) gerencia automações. O
 * builtin USER tem `manageAutomations=false` no contrato, então `requirePermission`
 * regrediria (403 onde hoje é 200). Este middleware preserva BYTE-A-BYTE o
 * comportamento de hoje para builtins e permite que um admin restrinja via perfil
 * custom (`manageAutomations=false`).
 *
 * FAIL-CLOSED: 401 sem usuário; em qualquer erro de carga, `getEffective` já recai
 * nos defaults do role e `hasCustomProfile=false` → passa (== hoje).
 */
export function requireCustomProfilePermission(cap: Capability) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      return next(createError('Authentication required', 401, 'NOT_AUTHENTICATED'));
    }
    try {
      const effective = await getEffective({
        userId: req.user.userId,
        tenantId: req.user.tenantId,
        role: req.user.role,
        isPlatformAdmin: req.user.isPlatformAdmin,
      });
      // Builtins passam sempre (== hoje). Só nega quando um perfil custom desligou a capability.
      if (effective.hasCustomProfile && effective.capabilities[cap] !== true) {
        return next(createError('Insufficient permissions', 403, 'INSUFFICIENT_PERMISSIONS'));
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Exige que o usuário autenticado seja super-admin da plataforma (cross-tenant).
 * Usa a flag já carregada por `authenticate` (sem query extra).
 */
export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    return next(createError('Authentication required', 401, 'NOT_AUTHENTICATED'));
  }
  if (!req.user.isPlatformAdmin) {
    return next(createError('Platform admin access required', 403, 'NOT_PLATFORM_ADMIN'));
  }
  next();
}
