import { Router } from 'express';
import { z } from 'zod';
import { authService } from '../services/authService.js';
import { twoFactorService } from '../services/twoFactorService.js';
import { authenticate } from '../middleware/auth.js';
import { createError } from '../middleware/errorHandler.js';
import prisma from '../config/database.js';
import { setAuthCookies, clearAuthCookies } from '../utils/cookies.js';
import { personNameSchema } from '../utils/validators.js';

const router = Router();

/*
 * CORTE DO LOGIN NATIVO (Onda 4 / Pacote 2 — decisão do dono, 07/08/2026).
 *
 * A identidade do ecossistema VYD mora no VYD ID (id.vydhub.com). A ÚNICA
 * porta de entrada deste app é `POST /auth/sso/exchange` (token exchange).
 * Por isso saíram daqui: `register` (que criava usuário E empresa, ou seja,
 * auto-cadastro de tenant), `login` por senha e o par
 * `password/reset-request` + `password/reset`.
 *
 * NÃO reintroduza nenhuma dessas rotas. Quem não consegue entrar usa o
 * resgate do IdP (edge `request-access`), não uma porta local.
 *
 * O que fica, e por quê: `/refresh` (a sessão do exchange precisa renovar),
 * `/logout` e `/logout-all` (autenticadas; `logout-all` é o verbo da Onda 4),
 * `/me` e `/tenant` (leitura autenticada), `/email/verify*` e 2FA (exigem
 * sessão — não são porta de entrada).
 */

// Refresh token
router.post('/refresh', async (req, res, next) => {
  try {
    // Read refreshToken from httpOnly cookie (primary) or body (fallback)
    const refreshTokenValue = req.cookies?.refreshToken || req.body?.refreshToken;
    if (!refreshTokenValue) {
      return next(createError('Refresh token missing', 401, 'NO_REFRESH_TOKEN'));
    }
    const result = await authService.refreshToken(refreshTokenValue);
    // Set new accessToken cookie (use setAuthCookies-consistent options)
    setAuthCookies(res, result.accessToken, refreshTokenValue);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Logout
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    // Invalidate refresh token from cookie or header
    const refreshTokenValue = req.cookies?.refreshToken;
    if (refreshTokenValue) {
      await authService.logout(refreshTokenValue);
    }
    clearAuthCookies(res);
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    next(error);
  }
});

// Logout all devices
router.post('/logout-all', authenticate, async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }
    await authService.logoutAll(req.user.userId);
    clearAuthCookies(res);
    res.json({ message: 'Logged out from all devices' });
  } catch (error) {
    next(error);
  }
});

// Get current user
router.get('/me', authenticate, async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        role: true,
        isPlatformAdmin: true,
        tenantId: true,
        emailVerified: true,
        twoFactorEnabled: true,
        // Número do WhatsApp do copiloto (gravado por PUT /users/me/whatsapp);
        // sem isto o Profile exibe vazio após salvar/recarregar.
        whatsappNumber: true,
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
            logo: true,
          },
        },
      },
    });

    if (!user) {
      return next(createError('User not found', 404));
    }

    res.json({ user });
  } catch (error) {
    next(error);
  }
});

// Send verification email
router.post('/email/verify-request', authenticate, async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }
    await authService.sendVerificationEmail(req.user.userId);
    res.json({ message: 'Verification email sent' });
  } catch (error) {
    next(error);
  }
});

// Verify email
const verifyEmailSchema = z.object({
  token: z.string().uuid(),
});

router.post('/email/verify', async (req, res, next) => {
  try {
    const { token } = verifyEmailSchema.parse(req.body);
    await authService.verifyEmail(token);
    res.json({ message: 'Email verified successfully' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
    }
    next(error);
  }
});

// Update profile
const updateProfileSchema = z.object({
  name: personNameSchema.optional(),
  phone: z.string().optional(),
  avatar: z.string().nullable().optional(),
});

router.put('/profile', authenticate, async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const data = updateProfileSchema.parse(req.body);

    const user = await prisma.user.update({
      where: { id: req.user.userId },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        role: true,
        tenantId: true,
        emailVerified: true,
        createdAt: true,
        lastLoginAt: true,
        // Mantém o número do WhatsApp no objeto user retornado ao frontend,
        // para não zerar o campo do Profile após um update de perfil.
        whatsappNumber: true,
        tenant: {
          select: { id: true, name: true, slug: true, logo: true },
        },
      },
    });

    res.json({ user });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
    }
    next(error);
  }
});

/*
 * `PUT /change-password` saiu junto com o corte: sem login por senha, ninguém
 * tem "senha atual" para informar — quem entra pelo exchange recebe um hash
 * que não corresponde a nenhuma senha conhecida. A rota era código morto que
 * mantinha viva a ideia de credencial local.
 */

// Update tenant (company info)
const updateTenantSchema = z.object({
  name: personNameSchema.optional(),
  logo: z.string().nullable().optional(),
  settings: z
    .object({
      slackWebhookUrl: z.string().url().optional().nullable(),
      teamsWebhookUrl: z.string().url().optional().nullable(),
    })
    .optional(),
  // Follow-up de clientes & contratos (req 16) — restrito a ADMIN/GESTOR.
  clientFollowUpDays: z.coerce
    .number({ invalid_type_error: 'Informe um número de dias' })
    .int('O intervalo de follow-up deve ser um número inteiro de dias')
    .positive('O intervalo de follow-up deve ser maior que zero')
    .optional(),
  contractAlertDays: z
    .array(
      z.coerce
        .number({ invalid_type_error: 'Limiar inválido' })
        .int('Os limiares devem ser números inteiros de dias')
        .positive('Os limiares devem ser maiores que zero')
    )
    .min(1, 'Informe ao menos um limiar de alerta')
    .refine((arr) => new Set(arr).size === arr.length, {
      message: 'Os limiares não podem ter valores duplicados',
    })
    .optional(),
});

const tenantSelect = {
  id: true,
  name: true,
  slug: true,
  logo: true,
  settings: true,
  clientFollowUpDays: true,
  contractAlertDays: true,
} as const;

router.get('/tenant', authenticate, async (req, res, next) => {
  try {
    if (!req.user) return next(createError('Authentication required', 401));
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.user.tenantId },
      select: tenantSelect,
    });
    res.json({ tenant });
  } catch (error) {
    next(error);
  }
});

router.put('/tenant', authenticate, async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const data = updateTenantSchema.parse(req.body);

    // Configuração de follow-up/contratos é restrita a ADMIN/GESTOR (req 16/17).
    const touchesFollowUpConfig =
      data.clientFollowUpDays !== undefined || data.contractAlertDays !== undefined;
    if (touchesFollowUpConfig && !['ADMIN', 'GESTOR'].includes(req.user.role)) {
      return next(
        createError(
          'Apenas ADMIN/GESTOR podem alterar as configurações de follow-up e contratos',
          403,
          'INSUFFICIENT_PERMISSIONS'
        )
      );
    }

    // Merge settings JSON so existing keys are preserved
    let updateData: Record<string, unknown> = {
      name: data.name,
      logo: data.logo,
      clientFollowUpDays: data.clientFollowUpDays,
      // Limiares persistidos em ordem decrescente (req 16).
      contractAlertDays: data.contractAlertDays
        ? [...data.contractAlertDays].sort((a, b) => b - a)
        : undefined,
    };
    if (data.settings) {
      const current = await prisma.tenant.findUnique({
        where: { id: req.user.tenantId },
        select: { settings: true },
      });
      updateData.settings = { ...((current?.settings as object) ?? {}), ...data.settings };
    }
    // Remove undefined keys
    updateData = Object.fromEntries(Object.entries(updateData).filter(([, v]) => v !== undefined));

    const tenant = await prisma.tenant.update({
      where: { id: req.user.tenantId },
      data: updateData,
      select: tenantSelect,
    });

    res.json({ tenant });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
    }
    next(error);
  }
});

// ========================
// 2FA endpoints
// ========================

// Setup 2FA - generates secret and QR code
router.post('/2fa/setup', authenticate, async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }
    const result = await twoFactorService.setup(req.user.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Verify and enable 2FA
const verify2FASchema = z.object({
  code: z.string().length(6),
});

router.post('/2fa/verify', authenticate, async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }
    const { code } = verify2FASchema.parse(req.body);
    const result = await twoFactorService.verifyAndEnable(req.user.userId, code);
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
    }
    next(error);
  }
});

// Disable 2FA
const disable2FASchema = z.object({
  code: z.string().length(6),
});

router.post('/2fa/disable', authenticate, async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }
    const { code } = disable2FASchema.parse(req.body);
    const result = await twoFactorService.disable(req.user.userId, code);
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
    }
    next(error);
  }
});

// Get 2FA status
router.get('/2fa/status', authenticate, async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }
    const enabled = await twoFactorService.isEnabled(req.user.userId);
    res.json({ enabled });
  } catch (error) {
    next(error);
  }
});

export default router;
