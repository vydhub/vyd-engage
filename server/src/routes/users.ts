import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { tenantScope, requireTenantAccess } from '../middleware/tenant.js';
import { requireRole } from '../middleware/auth.js';
import { createError } from '../middleware/errorHandler.js';
import prisma from '../config/database.js';
import { UserRole, UserStatus, CommercialFunction } from '@prisma/client';
import { personNameSchema } from '../utils/validators.js';

const router = Router();

router.use(authenticate);
router.use(tenantScope);

// ── Normalização de telefone (coerente com o Copiloto IA) ────────────────────
// O copiloto resolve o remetente comparando por DÍGITOS, tolerando apenas o
// prefixo de DDI 55 (com/sem). Replicamos a mesma semântica aqui para que a
// checagem de duplicidade de número seja coerente com a resolução do copiloto.
function digitsOnly(raw: string): string {
  return (raw || '').replace(/\D+/g, '');
}

/** Variantes normalizadas: dígitos completos + variante sem o DDI 55 inicial. */
function phoneVariants(raw: string): string[] {
  const d = digitsOnly(raw);
  if (!d) return [];
  const variants = new Set<string>([d]);
  if (d.startsWith('55') && d.length > 2) variants.add(d.slice(2));
  return [...variants];
}

/** Dois telefones casam se compartilham alguma variante (com/sem DDI 55). */
function phonesMatch(a: string, b: string): boolean {
  const va = phoneVariants(a);
  const vb = phoneVariants(b);
  if (va.length === 0 || vb.length === 0) return false;
  return va.some((x) => vb.includes(x));
}

// GET /api/users - List all users in tenant
router.get('/', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const users = await prisma.user.findMany({
      where: { tenantId: req.user.tenantId },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        role: true,
        status: true,
        commercialFunction: true,
        createdAt: true,
        lastLoginAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(users);
  } catch (error) {
    next(error);
  }
});

// GET /api/users/:id - Get user by ID
router.get('/:id', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const user = await prisma.user.findFirst({
      where: {
        id: req.params.id,
        tenantId: req.user.tenantId,
      },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        role: true,
        status: true,
        commercialFunction: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });

    if (!user) {
      return next(createError('User not found', 404));
    }

    res.json(user);
  } catch (error) {
    next(error);
  }
});

// PUT /api/users/me/whatsapp - o próprio usuário cadastra/edita o seu número de
// WhatsApp para o Copiloto IA (Upgrade RD P3, req 25). Só afeta o registro do
// requisitante — não exige papel ADMIN/GESTOR. `null`/"" limpa o número.
router.put('/me/whatsapp', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const { whatsappNumber } = z
      .object({
        // Aceita dígitos, +, espaços e traços; até 20 chars. String vazia → limpa.
        whatsappNumber: z
          .string()
          .trim()
          .max(20, 'Número inválido')
          .regex(/^[+0-9()\-\s]*$/, 'Número inválido')
          .nullable(),
      })
      .parse(req.body);

    const normalized = whatsappNumber && whatsappNumber.trim() !== '' ? whatsappNumber.trim() : null;

    // Ao gravar um número NÃO-nulo, exige uma quantidade mínima de dígitos. O
    // regex aceita máscaras como "---" ou "() -" que não têm NENHUM dígito e
    // seriam persistidas como lixo — nunca resolvem para um comando do copiloto
    // (a resolução é por DÍGITOS). Exigimos ao menos 8 dígitos (número local com
    // DDD). Limpar (nulo/"") continua permitido e não passa por esta checagem.
    if (normalized && digitsOnly(normalized).length < 8) {
      return next(
        createError(
          'Informe um número de WhatsApp válido com DDD.',
          400,
          'VALIDATION_ERROR'
        )
      );
    }

    // Ao gravar um número NÃO-nulo, impede que dois usuários ATIVOS do mesmo
    // tenant cadastrem o mesmo número. A resolução do copiloto é por DÍGITOS
    // (tolerando o DDI 55); usamos o mesmo critério para não deixar passar
    // uma colisão que depois faria o copiloto recusar o comando por match
    // não-único. Limpar (número nulo) não checa.
    if (normalized) {
      const others = await prisma.user.findMany({
        where: {
          tenantId: req.user.tenantId,
          status: 'ACTIVE',
          whatsappNumber: { not: null },
          id: { not: req.user.userId },
        },
        select: { id: true, whatsappNumber: true },
      });

      const collision = others.some((u) => phonesMatch(u.whatsappNumber || '', normalized));
      if (collision) {
        return next(
          createError(
            'Este número de WhatsApp já está vinculado a outro usuário do time.',
            409,
            'WHATSAPP_NUMBER_TAKEN'
          )
        );
      }
    }

    const updated = await prisma.user.update({
      where: { id: req.user.userId },
      data: { whatsappNumber: normalized },
      select: { id: true, whatsappNumber: true },
    });

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
    }
    next(error);
  }
});

// PUT /api/users/:id - Update user (Admin only)
router.put('/:id', requireRole('ADMIN', 'GESTOR'), async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const { name, email, role, status, commercialFunction, teamId, permissionProfileId } = z
      .object({
        // Nome: corrigível por ADMIN/GESTOR. Rejeita e-mail no campo (mesma guarda do
        // aceite de convite) — foi assim que um "nome" virou o e-mail de um usuário.
        name: personNameSchema.optional(),
        // E-mail: é a identidade de LOGIN — só ADMIN pode alterar. Normalizado
        // (trim + lowercase) para casar com o armazenamento canônico.
        email: z.string().trim().toLowerCase().email('Email inválido').optional(),
        // CONSULTOR não é atribuível por aqui — a conta nasce (e morre) com o
        // cadastro do consultor no módulo de Parceiros; e um consultor não pode
        // ser "promovido" a papel interno por esta rota (troca de papel do portal
        // exige recriar a conta pelo fluxo interno).
        role: z
          .nativeEnum(UserRole)
          .optional()
          .refine((r) => r !== UserRole.CONSULTOR, {
            message: 'O papel CONSULTOR é gerenciado pelo módulo de Parceiros',
          }),
        status: z.nativeEnum(UserStatus).optional(),
        commercialFunction: z.nativeEnum(CommercialFunction).nullable().optional(),
        // Times & governança (Upgrade RD P1): vínculo com equipe/perfil.
        // Editáveis por ADMIN/GESTOR (guarda de rota já restringe a esses papéis).
        teamId: z.string().uuid().nullable().optional(),
        permissionProfileId: z.string().uuid().nullable().optional(),
      })
      .parse(req.body);

    const user = await prisma.user.findFirst({
      where: {
        id: req.params.id,
        tenantId: req.user.tenantId,
      },
    });

    if (!user) {
      return next(createError('User not found', 404));
    }

    // Conta de consultor externo (portal) não muda de papel por aqui — o papel
    // é gerenciado pelo módulo de Parceiros (vínculo 1:1 com o Consultor).
    // (o schema já garante que `role` nunca é CONSULTOR — qualquer troca de papel
    // solicitada para uma conta de consultor é bloqueada)
    if (user.role === UserRole.CONSULTOR && role) {
      return next(
        createError('Contas de consultor são gerenciadas pelo módulo de Parceiros', 400, 'CONSULTOR_ROLE_LOCKED')
      );
    }

    // Valida vínculos no tenant antes de aplicar (multi-tenant estrito).
    if (teamId) {
      const team = await prisma.team.findFirst({
        where: { id: teamId, tenantId: req.user.tenantId },
        select: { id: true },
      });
      if (!team) return next(createError('Equipe não encontrada', 404, 'TEAM_NOT_FOUND'));
    }
    if (permissionProfileId) {
      const profile = await prisma.permissionProfile.findFirst({
        where: { id: permissionProfileId, tenantId: req.user.tenantId },
        select: { id: true },
      });
      if (!profile) return next(createError('Perfil não encontrado', 404, 'PROFILE_NOT_FOUND'));
    }

    // role/status/email seguem restritos a ADMIN; GESTOR pode definir nome, função
    // comercial (spec: commercialFunction restrito a ADMIN/GESTOR) e o vínculo de
    // equipe/perfil (Upgrade RD P1). E-mail é a identidade de LOGIN → só ADMIN.
    const isAdmin = req.user.role === 'ADMIN';

    // E-mail é @unique global — antes de gravar, garantir que não pertence a outro
    // usuário (senão o update lançaria P2002; devolvemos 409 claro).
    if (isAdmin && email && email !== user.email) {
      const clash = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (clash && clash.id !== user.id) {
        return next(
          createError('Este e-mail já está vinculado a outro usuário.', 409, 'EMAIL_TAKEN')
        );
      }
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(isAdmin && email ? { email } : {}),
        ...(isAdmin && role ? { role } : {}),
        ...(isAdmin && status ? { status } : {}),
        ...(commercialFunction !== undefined ? { commercialFunction } : {}),
        ...(teamId !== undefined ? { teamId } : {}),
        ...(permissionProfileId !== undefined ? { permissionProfileId } : {}),
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        commercialFunction: true,
        teamId: true,
        permissionProfileId: true,
      },
    });

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
    }
    next(error);
  }
});

export default router;
