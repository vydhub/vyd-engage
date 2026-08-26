/**
 * permissionService — NÚCLEO de Times & Governança (Upgrade RD P1).
 *
 * PRINCÍPIO INEGOCIÁVEL: FAIL-CLOSED / DEFAULT == HOJE.
 * Sem PermissionProfile custom atribuído ao usuário, TODA consulta a este serviço
 * devolve EXATAMENTE o comportamento de hoje (defaults derivados do `baseRole`).
 * A camada é ADITIVA: só EXPANDE escopo/capacidade quando um admin configura um
 * perfil custom explicitamente. Qualquer erro/ausência recai nos defaults do role
 * — nunca mais permissivo que o próprio role.
 *
 * Mapeamento role → defaults (provado por teste de não-regressão):
 *  - ADMIN/GESTOR: todas as capabilities true; visibilidade GERAL nas 3 entidades.
 *  - USER (analista): exporta, faz bulk, deleta os próprios registros, vê relatórios
 *    (escopados); NÃO configura, NÃO gerencia automações, NÃO transfere responsável;
 *    visibilidade deals=PROPRIA, companies=GERAL, contacts=GERAL (== hoje).
 *  - VIEWER: só viewReports; visibilidade PROPRIA em tudo.
 */

import prisma from '../config/database.js';
import { UserRole, type Prisma } from '@prisma/client';
import { logger } from '../utils/logger.js';

// ── Tipos do contrato ────────────────────────────────────────────────────────

export type Capability =
  | 'exportData'
  | 'importData'
  | 'bulkActions'
  | 'deleteRecords'
  | 'configure'
  | 'manageAutomations'
  | 'transferOwner'
  | 'viewReports'
  // Gestão de Atestados Técnicos — acesso ao módulo (gate próprio) e gestão (escrita).
  // Default OFF para USER/VIEWER: o acesso é restrito a um perfil específico.
  | 'accessAtestados'
  | 'manageAtestados'
  // Gestão de Parceiros Comerciais (PRM) — mesmo padrão de gate próprio.
  | 'accessParceiros'
  | 'manageParceiros';

export type VisibilityLevel = 'PROPRIA' | 'EQUIPE' | 'GERAL';

/** Entidades cujo escopo de visibilidade é configurável. */
export type VisibilityEntity = 'deals' | 'companies' | 'contacts' | 'tasks';

/** Entidades do eixo por-entidade (criar/editar/excluir). */
export type EntityKind = 'leads' | 'companies' | 'deals' | 'tasks';

/** Ações granulares por entidade (req 13). */
export type EntityAction = 'create' | 'edit' | 'delete';

export interface Capabilities {
  exportData: boolean;
  importData: boolean;
  bulkActions: boolean;
  deleteRecords: boolean;
  configure: boolean;
  manageAutomations: boolean;
  transferOwner: boolean;
  viewReports: boolean;
  accessAtestados: boolean;
  manageAtestados: boolean;
  accessParceiros: boolean;
  manageParceiros: boolean;
}

/** Permissões por-entidade (create/edit/delete) por tipo de registro (req 13). */
export type EntityPermissions = Record<EntityKind, Record<EntityAction, boolean>>;

/** Resultado de escopo de responsável: string (um dono) | {in} (equipe) | undefined (sem filtro). */
export type OwnerScope = string | { in: string[] } | undefined;

export interface VisibilityMap {
  deals: VisibilityLevel;
  companies: VisibilityLevel;
  contacts: VisibilityLevel;
}

export interface RequireApprovalFor {
  export: boolean;
  bulk: boolean;
  delete: boolean;
}

export interface EffectivePermissions {
  baseRole: UserRole;
  capabilities: Capabilities;
  /** Eixo por-entidade (create/edit/delete por leads|companies|deals|tasks) — req 13. */
  entities: EntityPermissions;
  visibility: VisibilityMap;
  requireApprovalFor: RequireApprovalFor;
  /**
   * true quando as permissões vêm de um perfil CUSTOM (isBuiltin=false) atribuído
   * ao usuário. Permite às rotas distinguir "restrição EXPLÍCITA do admin" de
   * "default do builtin" — chave p/ não regredir builtins (BYTE-A-BYTE == HOJE).
   */
  hasCustomProfile: boolean;
}

/** Usuário mínimo aceito pelo serviço (compatível com req.user). */
export interface PermissionUser {
  userId: string;
  tenantId: string;
  role?: string;
  isPlatformAdmin?: boolean;
  /** Opcional: quando já carregado pelo chamador, evita a query de perfil. */
  permissionProfileId?: string | null;
  teamId?: string | null;
}

// ── Nomes canônicos dos 4 builtins (1 por baseRole) ──────────────────────────

export const BUILTIN_PROFILE_NAMES: Record<UserRole, string> = {
  ADMIN: 'Administrador',
  GESTOR: 'Gestor',
  USER: 'Vendedor',
  VIEWER: 'Visualizador',
  // CONSULTOR (portal do parceiro) não tem builtin semeado — o papel é fail-closed
  // (defaultsForRole cai em VIEWER) e o acesso dele é só ao portal (gate no authenticate).
  CONSULTOR: 'Consultor Externo',
};

// ── Defaults por baseRole (== HOJE) ──────────────────────────────────────────

const ALL_CAPS_TRUE: Capabilities = {
  exportData: true,
  importData: true,
  bulkActions: true,
  deleteRecords: true,
  configure: true,
  manageAutomations: true,
  transferOwner: true,
  viewReports: true,
  accessAtestados: true,
  manageAtestados: true,
  accessParceiros: true,
  manageParceiros: true,
};

const USER_CAPS: Capabilities = {
  exportData: true,
  // == HOJE: a rota POST /leads/import não tem guarda de papel — qualquer
  // autenticado (incl. USER) importa. Manter true evita regressão ao adicionar
  // requirePermission('importData'); só um perfil custom pode desligar.
  importData: true,
  bulkActions: true,
  deleteRecords: true,
  configure: false,
  manageAutomations: false,
  transferOwner: false,
  viewReports: true,
  // Acesso ao módulo de Atestados é restrito a um perfil específico (default OFF).
  accessAtestados: false,
  manageAtestados: false,
  accessParceiros: false,
  manageParceiros: false,
};

const VIEWER_CAPS: Capabilities = {
  exportData: false,
  importData: false,
  bulkActions: false,
  deleteRecords: false,
  configure: false,
  manageAutomations: false,
  transferOwner: false,
  viewReports: true,
  accessAtestados: false,
  manageAtestados: false,
  accessParceiros: false,
  manageParceiros: false,
};

const GERAL_VISIBILITY: VisibilityMap = { deals: 'GERAL', companies: 'GERAL', contacts: 'GERAL' };
// USER (analista): deals PROPRIA (ownerScope de hoje), empresas/contatos GERAL.
const USER_VISIBILITY: VisibilityMap = {
  deals: 'PROPRIA',
  companies: 'GERAL',
  contacts: 'GERAL',
};

const NO_APPROVALS: RequireApprovalFor = { export: false, bulk: false, delete: false };

// Eixo por-entidade (req 13). DEFAULT == HOJE: qualquer autenticado ADMIN/GESTOR/USER
// cria/edita/exclui as 4 entidades (não há guarda por-entidade hoje). VIEWER: tudo false.
const ENTITY_KINDS: EntityKind[] = ['leads', 'companies', 'deals', 'tasks'];
const ENTITY_ACTIONS: EntityAction[] = ['create', 'edit', 'delete'];

function entitiesAll(value: boolean): EntityPermissions {
  const out = {} as EntityPermissions;
  for (const kind of ENTITY_KINDS) {
    out[kind] = { create: value, edit: value, delete: value };
  }
  return out;
}

/**
 * Defaults de um baseRole — a fonte de verdade do comportamento de HOJE.
 * Retorna cópias frescas (nunca as constantes acima diretamente) para evitar
 * mutação acidental por chamadores que fazem merge.
 */
export function defaultsForRole(role: UserRole): EffectivePermissions {
  switch (role) {
    case UserRole.ADMIN:
    case UserRole.GESTOR:
      return {
        baseRole: role,
        capabilities: { ...ALL_CAPS_TRUE },
        entities: entitiesAll(true),
        visibility: { ...GERAL_VISIBILITY },
        requireApprovalFor: { ...NO_APPROVALS },
        hasCustomProfile: false,
      };
    case UserRole.USER:
      return {
        baseRole: role,
        capabilities: { ...USER_CAPS },
        // == HOJE: USER cria/edita/exclui as 4 entidades sem guarda por-entidade.
        entities: entitiesAll(true),
        visibility: { ...USER_VISIBILITY },
        requireApprovalFor: { ...NO_APPROVALS },
        hasCustomProfile: false,
      };
    case UserRole.VIEWER:
    default:
      return {
        baseRole: UserRole.VIEWER,
        capabilities: { ...VIEWER_CAPS },
        entities: entitiesAll(false),
        // == HOJE: o VIEWER é tenant-wide só-leitura (ownerScope NUNCA o restringia
        // — só o analista USER). Visibilidade GERAL preserva BYTE-A-BYTE esse
        // comportamento; um admin pode restringir via perfil custom.
        visibility: { ...GERAL_VISIBILITY },
        requireApprovalFor: { ...NO_APPROVALS },
        hasCustomProfile: false,
      };
  }
}

/**
 * Resolve o baseRole efetivo do usuário. Platform-admin e ADMIN → ADMIN;
 * papéis válidos são preservados; qualquer coisa desconhecida → VIEWER
 * (fail-closed: o mais restritivo).
 */
function resolveBaseRole(user: PermissionUser): UserRole {
  if (user.isPlatformAdmin === true) return UserRole.ADMIN;
  switch (user.role) {
    case 'ADMIN':
      return UserRole.ADMIN;
    case 'GESTOR':
      return UserRole.GESTOR;
    case 'USER':
      return UserRole.USER;
    case 'VIEWER':
      return UserRole.VIEWER;
    default:
      return UserRole.VIEWER;
  }
}

const VISIBILITY_VALUES: VisibilityLevel[] = ['PROPRIA', 'EQUIPE', 'GERAL'];

function coerceVisibility(raw: unknown, fallback: VisibilityLevel): VisibilityLevel {
  return typeof raw === 'string' && VISIBILITY_VALUES.includes(raw as VisibilityLevel)
    ? (raw as VisibilityLevel)
    : fallback;
}

/**
 * Aplica os overrides de um PermissionProfile sobre os defaults do baseRole.
 * Só chaves booleanas explícitas do JSON sobrescrevem; ausência mantém o default.
 * O baseRole do resultado é sempre o do PERFIL (que herda dele).
 */
function mergeProfile(
  defaults: EffectivePermissions,
  profile: {
    baseRole: UserRole;
    isBuiltin: boolean;
    capabilities: unknown;
    visibility: unknown;
    requireApprovalFor: unknown;
  }
): EffectivePermissions {
  const capOverrides = (profile.capabilities ?? {}) as Record<string, unknown>;
  const capabilities: Capabilities = { ...defaults.capabilities };
  for (const key of Object.keys(capabilities) as Capability[]) {
    if (typeof capOverrides[key] === 'boolean') {
      capabilities[key] = capOverrides[key] as boolean;
    }
  }

  // Eixo por-entidade (req 13): overrides ficam aninhados em `capabilities.entities`
  // do JSON do perfil (sem migração — a coluna capabilities já é Json). Só chaves
  // booleanas explícitas sobrescrevem; ausência mantém o default do baseRole.
  const entities: EntityPermissions = {
    leads: { ...defaults.entities.leads },
    companies: { ...defaults.entities.companies },
    deals: { ...defaults.entities.deals },
    tasks: { ...defaults.entities.tasks },
  };
  const entOverrides = (capOverrides.entities ?? {}) as Record<string, unknown>;
  for (const kind of ENTITY_KINDS) {
    const kindOverride = entOverrides[kind] as Record<string, unknown> | undefined;
    if (kindOverride && typeof kindOverride === 'object') {
      for (const action of ENTITY_ACTIONS) {
        if (typeof kindOverride[action] === 'boolean') {
          entities[kind][action] = kindOverride[action] as boolean;
        }
      }
    }
  }

  const visOverrides = (profile.visibility ?? {}) as Record<string, unknown>;
  const visibility: VisibilityMap = {
    deals: coerceVisibility(visOverrides.deals, defaults.visibility.deals),
    companies: coerceVisibility(visOverrides.companies, defaults.visibility.companies),
    contacts: coerceVisibility(visOverrides.contacts, defaults.visibility.contacts),
  };

  const apprOverrides = (profile.requireApprovalFor ?? {}) as Record<string, unknown>;
  const requireApprovalFor: RequireApprovalFor = {
    export:
      typeof apprOverrides.export === 'boolean'
        ? (apprOverrides.export as boolean)
        : defaults.requireApprovalFor.export,
    bulk:
      typeof apprOverrides.bulk === 'boolean'
        ? (apprOverrides.bulk as boolean)
        : defaults.requireApprovalFor.bulk,
    delete:
      typeof apprOverrides.delete === 'boolean'
        ? (apprOverrides.delete as boolean)
        : defaults.requireApprovalFor.delete,
  };

  return {
    baseRole: profile.baseRole,
    capabilities,
    entities,
    visibility,
    requireApprovalFor,
    // Só perfis CUSTOM (não-builtin) contam como "restrição explícita do admin".
    hasCustomProfile: profile.isBuiltin !== true,
  };
}

// ── API pública ──────────────────────────────────────────────────────────────

/**
 * Permissões efetivas do usuário (merge default-do-baseRole + overrides do perfil).
 * FAIL-CLOSED: sem `permissionProfileId`, ou em qualquer erro de carga, devolve os
 * defaults do baseRole (== HOJE). Nunca lança.
 */
export async function getEffective(user: PermissionUser): Promise<EffectivePermissions> {
  const baseRole = resolveBaseRole(user);
  const defaults = defaultsForRole(baseRole);

  try {
    // O chamador pode já ter carregado o profileId (req.user); senão, buscamos.
    let profileId = user.permissionProfileId;
    if (profileId === undefined) {
      const dbUser = await prisma.user.findFirst({
        where: { id: user.userId, tenantId: user.tenantId },
        select: { permissionProfileId: true },
      });
      profileId = dbUser?.permissionProfileId ?? null;
    }
    if (!profileId) return defaults;

    const profile = await prisma.permissionProfile.findFirst({
      where: { id: profileId, tenantId: user.tenantId },
      select: {
        baseRole: true,
        isBuiltin: true,
        capabilities: true,
        visibility: true,
        requireApprovalFor: true,
      },
    });
    if (!profile) return defaults;

    // O perfil herda dos defaults do SEU baseRole (não do role bruto do user).
    const profileDefaults = defaultsForRole(profile.baseRole);
    return mergeProfile(profileDefaults, profile);
  } catch (err) {
    logger.error(`permissionService.getEffective falhou para user ${user.userId} — fail-closed`, err);
    return defaults;
  }
}

/** Verifica uma capability do usuário. Fail-closed via getEffective. */
export async function can(user: PermissionUser, cap: Capability): Promise<boolean> {
  const effective = await getEffective(user);
  return effective.capabilities[cap] === true;
}

/**
 * Verifica uma ação por-entidade (create/edit/delete) do usuário — req 13.
 * FAIL-CLOSED via getEffective. Sem perfil custom, ADMIN/GESTOR/USER têm TODAS as
 * ações por-entidade = true (== hoje, onde não há guarda por-entidade); VIEWER false.
 */
export async function canEntity(
  user: PermissionUser,
  entity: EntityKind,
  action: EntityAction
): Promise<boolean> {
  const effective = await getEffective(user);
  return effective.entities[entity]?.[action] === true;
}

/**
 * Ids dos membros da equipe do usuário (inclui o próprio). Se o usuário não tem
 * equipe, devolve apenas [userId]. Fail-closed: em erro, [userId].
 */
export async function teamMemberIds(tenantId: string, user: PermissionUser): Promise<string[]> {
  try {
    let teamId = user.teamId;
    if (teamId === undefined) {
      const dbUser = await prisma.user.findFirst({
        where: { id: user.userId, tenantId },
        select: { teamId: true },
      });
      teamId = dbUser?.teamId ?? null;
    }
    if (!teamId) return [user.userId];

    const members = await prisma.user.findMany({
      where: { tenantId, teamId },
      select: { id: true },
    });
    const ids = members.map((m) => m.id);
    // Garante o próprio na lista mesmo se algum estado transitório o omitir.
    if (!ids.includes(user.userId)) ids.push(user.userId);
    return ids;
  } catch (err) {
    logger.error(`permissionService.teamMemberIds falhou para user ${user.userId} — fail-closed`, err);
    return [user.userId];
  }
}

/**
 * Filtro de "responsável" (assignedTo) para uma entidade, respeitando a
 * visibilidade efetiva do usuário.
 *
 *  - GERAL   → devolve `requested` (igual ao ownerScope de hoje p/ manager);
 *              quando não há `requested`, devolve `undefined` (sem filtro).
 *  - EQUIPE  → { in: teamMemberIds } (membros da equipe; sem equipe → [userId]).
 *  - PROPRIA → o próprio userId (== ownerScope de analista de hoje).
 *
 * `tasks` acompanha o nível de `deals` (mesma dona da negociação);
 * `contacts` mapeia leads. Sem perfil custom, o resultado é IDÊNTICO ao de hoje.
 */
export async function visibilityScope(
  user: PermissionUser,
  entity: VisibilityEntity,
  requested?: string
): Promise<OwnerScope> {
  const effective = await getEffective(user);
  const key: keyof VisibilityMap = entity === 'tasks' ? 'deals' : entity;
  const level = effective.visibility[key];

  if (level === 'GERAL') return requested;
  if (level === 'EQUIPE') return { in: await teamMemberIds(user.tenantId, user) };
  // PROPRIA
  return user.userId;
}

/**
 * Garante os 4 builtins do tenant (1 por baseRole), idempotente. Cada builtin
 * apenas materializa os defaults do seu role (imutável na UI). Seguro para chamar
 * repetidamente (upsert por [tenantId, name]).
 */
export async function ensureBuiltinProfiles(tenantId: string): Promise<void> {
  const roles: UserRole[] = [UserRole.ADMIN, UserRole.GESTOR, UserRole.USER, UserRole.VIEWER];
  for (const role of roles) {
    const name = BUILTIN_PROFILE_NAMES[role];
    const defaults = defaultsForRole(role);
    try {
      await prisma.permissionProfile.upsert({
        where: { tenantId_name: { tenantId, name } },
        create: {
          tenantId,
          name,
          description: `Perfil padrão (${name}) — imutável.`,
          isBuiltin: true,
          baseRole: role,
          // Materializa também o eixo por-entidade aninhado em `capabilities.entities`
          // (a UI/CF-1b lê o efetivo daqui). getEffective reconstrói a partir disso.
          capabilities: {
            ...defaults.capabilities,
            entities: defaults.entities,
          } as unknown as Prisma.InputJsonValue,
          visibility: defaults.visibility as unknown as Prisma.InputJsonValue,
          requireApprovalFor: defaults.requireApprovalFor as unknown as Prisma.InputJsonValue,
        },
        // Idempotente: mantém builtin marcado e alinhado ao baseRole; não sobrescreve
        // capabilities/visibility (builtins refletem os defaults do role de qualquer forma).
        update: { isBuiltin: true, baseRole: role },
      });
    } catch (err) {
      logger.error(`ensureBuiltinProfiles: falha ao semear "${name}" (tenant ${tenantId})`, err);
    }
  }
}

export const permissionService = {
  defaultsForRole,
  getEffective,
  can,
  canEntity,
  teamMemberIds,
  visibilityScope,
  ensureBuiltinProfiles,
  BUILTIN_PROFILE_NAMES,
};

export default permissionService;
