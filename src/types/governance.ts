// Upgrade RD parity — P1 · Times & governança (contrato fixado em
// specs/upgrade-rd-parity.md, reqs 12–16). Tipos consumidos por
// src/services/api/client.ts e pelas telas de Equipes / Perfis / Aprovações /
// Lixeira / Metas de equipe.

// ── Capacidades e visibilidade ───────────────────────

export type Capability =
  | 'exportData'
  | 'importData'
  | 'bulkActions'
  | 'deleteRecords'
  | 'configure'
  | 'manageAutomations'
  | 'transferOwner'
  | 'viewReports'
  | 'accessAtestados'
  | 'manageAtestados'
  | 'accessParceiros'
  | 'manageParceiros';

export type Capabilities = Record<Capability, boolean>;

export type VisibilityLevel = 'PROPRIA' | 'EQUIPE' | 'GERAL';

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

export type BaseRole = 'ADMIN' | 'GESTOR' | 'USER' | 'VIEWER';

// ── Equipes (req 12) ─────────────────────────────────

export interface TeamMemberSummary {
  id: string;
  name: string;
  email: string;
}

export interface Team {
  id: string;
  tenantId: string;
  name: string;
  leaderId: string | null;
  leader?: TeamMemberSummary | null;
  members?: TeamMemberSummary[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateTeamInput {
  name: string;
  leaderId?: string | null;
  memberIds?: string[];
}

export type UpdateTeamInput = Partial<CreateTeamInput>;

// ── Perfis de permissão (req 13/14) ──────────────────

export interface PermissionProfile {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  /** Builtins (1 por baseRole) são imutáveis: não deletáveis/renomeáveis. */
  isBuiltin: boolean;
  baseRole: BaseRole;
  capabilities: Partial<Capabilities>;
  visibility: Partial<VisibilityMap>;
  requireApprovalFor: Partial<RequireApprovalFor>;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePermissionProfileInput {
  name: string;
  description?: string | null;
  baseRole: BaseRole;
  capabilities?: Partial<Capabilities>;
  visibility?: Partial<VisibilityMap>;
  requireApprovalFor?: Partial<RequireApprovalFor>;
}

export type UpdatePermissionProfileInput = Partial<
  Omit<CreatePermissionProfileInput, 'baseRole'>
>;

/** Perfil efetivo do usuário logado (GET /permission-profiles/me) — para a UI
 *  esconder ações conforme capabilities (UI-only; enforcement real é backend). */
// ── Permissões por entidade (eixo `entities` do getEffective) ─────────
// O backend sempre envia este eixo no GET /permission-profiles/me
// (permissionService.getEffective); o tipo era omitido no frontend até o
// caso extremo 4 da spec leads-oportunidade precisar dele na UI.
export type EntityAction = 'create' | 'edit' | 'delete';
export interface EntityPermissionEntry {
  create: boolean;
  edit: boolean;
  delete: boolean;
}

export interface EffectivePermissions {
  baseRole: BaseRole;
  capabilities: Capabilities;
  visibility: VisibilityMap;
  requireApprovalFor: RequireApprovalFor;
  entities?: Record<string, EntityPermissionEntry>;
}

// ── Aprovações (req 15/16) ───────────────────────────

export type ApprovalType = 'EXPORT' | 'BULK' | 'DELETE';
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'EXECUTED';

export interface ApprovalRequest {
  id: string;
  tenantId: string;
  type: ApprovalType;
  status: ApprovalStatus;
  requestedById: string;
  requestedBy?: TeamMemberSummary | null;
  payload: Record<string, unknown>;
  summary: string;
  reason: string | null;
  decidedById: string | null;
  decidedAt: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

/** Resposta 202 quando uma ação (export/bulk/delete) exige aprovação. */
export interface PendingApprovalResult {
  approvalId: string;
  pending: true;
}

// ── Lixeira (req 16) ─────────────────────────────────

export type TrashEntity =
  | 'leads'
  | 'deals'
  | 'tasks'
  | 'companies'
  | 'empreendimentos'
  | 'roadmaps';

export interface TrashItem {
  id: string;
  entity: TrashEntity;
  name: string;
  deletedAt: string;
  /** Quem excluiu (do AuditLog quando houver). */
  deletedById?: string | null;
  deletedByName?: string | null;
}

export interface TrashListResult {
  items: TrashItem[];
  page: number;
  pageSize: number;
  total: number;
}

// ── Metas de equipe (req 12) ─────────────────────────
// A meta é individual (userId) OU de equipe (teamId) — exatamente um.

export interface Goal {
  id: string;
  tenantId: string;
  userId: string | null;
  teamId: string | null;
  month: number;
  year: number;
  targetRevenue: number;
  targetDeals: number;
  targetLeads: number;
  user?: TeamMemberSummary | null;
  team?: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertGoalInput {
  /** Exatamente um de userId/teamId (validado no backend). */
  userId?: string;
  teamId?: string;
  month: number;
  year: number;
  targetRevenue?: number;
  targetDeals?: number;
  targetLeads?: number;
}
