/**
 * trashService — Lixeira (soft-delete) por entidade (Upgrade RD P1, req 16).
 *
 * Consolida o soft-delete existente (`deletedAt`) num registro de "lixeira" por
 * entidade, com restauração (≤ 30 dias) e expurgo definitivo (hard-delete). Tudo
 * é tenant-scoped (tenantId em TODA query, inclusive lookups por id).
 *
 * ENTIDADES suportadas (as que já têm soft-delete e DELETE /:id gateado):
 *   leads, deals, tasks, companies, empreendimentos, roadmaps.
 *
 * PRESERVA as guardas existentes: a EXCLUSÃO em si continua nos *Service.delete
 * (que aplicam COMPANY_HAS_RELATIONS, enforceTaskOwnership etc.). Este serviço só
 * lida com o PÓS-exclusão: listar, restaurar (deletedAt=null) e expurgar.
 */
import prisma from '../config/database.js';
import { createError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { storageService } from './storageService.js';

// ── Registry de entidades da lixeira ─────────────────────────────────────────

/**
 * Entidades "clássicas" da lixeira (as que passam pelo fluxo de aprovação de
 * exclusão do approvalService). Este union é o CONTRATO com o approvalService
 * (mapas exaustivos `Record<TrashEntity,…>`) — NÃO adicionar novos membros aqui
 * sem atualizar aquele serviço.
 */
export type TrashEntity =
  | 'leads'
  | 'deals'
  | 'tasks'
  | 'companies'
  | 'empreendimentos'
  | 'roadmaps';

/**
 * Entidade da lixeira específica de ANEXOS (CF-B, req 22). É tratada em separado
 * do union `TrashEntity` porque (a) não passa pelo gate de aprovação de exclusão e
 * (b) o expurgo definitivo precisa APAGAR os bytes (AttachmentBlob "db" ou objeto
 * S3) — o `delegate.delete` genérico deixaria o blob órfão (vazamento). Registrada
 * em runtime em `ALL_TRASH_ENTITIES`/`isTrashEntity` para aparecer na UI e no job.
 */
export const ATTACHMENTS_ENTITY = 'attachments' as const;
export type AnyTrashEntity = TrashEntity | typeof ATTACHMENTS_ENTITY;

/** Chave do AuditLog.entityType correspondente (para "quem/quando" excluiu). */
type AuditEntityType = 'lead' | 'deal' | 'task' | 'company' | 'empreendimento' | 'roadmap';

interface EntityConfig {
  /** Delegate do Prisma (typed as any: as delegates diferem em shape). */
  delegate: () => {
    findFirst: (args: unknown) => Promise<unknown>;
    findMany: (args: unknown) => Promise<unknown[]>;
    count: (args: unknown) => Promise<number>;
    update: (args: unknown) => Promise<unknown>;
    delete: (args: unknown) => Promise<unknown>;
  };
  auditType: AuditEntityType;
  /** Rótulo legível em pt-BR (para mensagens). */
  label: string;
  /**
   * Verifica se o "pai" do registro está excluído. Retorna uma mensagem clara
   * quando a restauração deve ser BLOQUEADA (pai na lixeira), ou null quando ok.
   * Ex.: deal cujo lead/empresa está soft-deletado.
   */
  parentDeleted?: (tenantId: string, record: Record<string, unknown>) => Promise<string | null>;
}

const ENTITIES: Record<TrashEntity, EntityConfig> = {
  leads: {
    delegate: () => prisma.lead as never,
    auditType: 'lead',
    label: 'lead',
    parentDeleted: async (tenantId, record) => {
      const companyId = record.companyId as string | null | undefined;
      if (!companyId) return null;
      const company = await prisma.company.findFirst({
        where: { id: companyId, tenantId },
        select: { deletedAt: true, name: true },
      });
      if (company?.deletedAt) {
        return `A empresa "${company.name}" vinculada está na lixeira. Restaure-a primeiro.`;
      }
      return null;
    },
  },
  deals: {
    delegate: () => prisma.deal as never,
    auditType: 'deal',
    label: 'negociação',
    parentDeleted: async (tenantId, record) => {
      const leadId = record.leadId as string | null | undefined;
      if (leadId) {
        const lead = await prisma.lead.findFirst({
          where: { id: leadId, tenantId },
          select: { deletedAt: true, name: true },
        });
        if (lead?.deletedAt) {
          return `O lead "${lead.name}" vinculado está na lixeira. Restaure-o primeiro.`;
        }
      }
      const companyId = record.companyId as string | null | undefined;
      if (companyId) {
        const company = await prisma.company.findFirst({
          where: { id: companyId, tenantId },
          select: { deletedAt: true, name: true },
        });
        if (company?.deletedAt) {
          return `A empresa "${company.name}" vinculada está na lixeira. Restaure-a primeiro.`;
        }
      }
      return null;
    },
  },
  tasks: {
    delegate: () => prisma.task as never,
    auditType: 'task',
    label: 'tarefa',
  },
  companies: {
    delegate: () => prisma.company as never,
    auditType: 'company',
    label: 'empresa',
  },
  empreendimentos: {
    delegate: () => prisma.empreendimento as never,
    auditType: 'empreendimento',
    label: 'empreendimento',
    parentDeleted: async (tenantId, record) => {
      const companyId = record.companyId as string | null | undefined;
      if (!companyId) return null;
      const company = await prisma.company.findFirst({
        where: { id: companyId, tenantId },
        select: { deletedAt: true, name: true },
      });
      if (company?.deletedAt) {
        return `A empresa "${company.name}" vinculada está na lixeira. Restaure-a primeiro.`;
      }
      return null;
    },
  },
  roadmaps: {
    delegate: () => prisma.commercialRoadmap as never,
    auditType: 'roadmap',
    label: 'desdobramento',
    parentDeleted: async (tenantId, record) => {
      const companyId = record.companyId as string | null | undefined;
      if (!companyId) return null;
      const company = await prisma.company.findFirst({
        where: { id: companyId, tenantId },
        select: { deletedAt: true, name: true },
      });
      if (company?.deletedAt) {
        return `A empresa "${company.name}" vinculada está na lixeira. Restaure-a primeiro.`;
      }
      return null;
    },
  },
};

/** Entidades "clássicas" (contrato com approvalService). NÃO inclui attachments. */
export const TRASH_ENTITIES = Object.keys(ENTITIES) as TrashEntity[];

/** TODAS as entidades da lixeira, incluindo `attachments` (UI, route e job). */
export const ALL_TRASH_ENTITIES: AnyTrashEntity[] = [...TRASH_ENTITIES, ATTACHMENTS_ENTITY];

/** Guarda estrita p/ o approvalService (só as 6 clássicas). */
export function isTrashEntity(value: unknown): value is TrashEntity {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ENTITIES, value);
}

/** Guarda ampla: aceita as 6 clássicas + `attachments` (route/UI). */
export function isAnyTrashEntity(value: unknown): value is AnyTrashEntity {
  return isTrashEntity(value) || value === ATTACHMENTS_ENTITY;
}

function getConfig(entity: TrashEntity): EntityConfig {
  return ENTITIES[entity];
}

/**
 * Negócio de demanda descartada não é item de lixeira (spec captura-demandas, E-17): o
 * `deletedAt` dele é um estado que vem do Flow. Não aparece, não se restaura à mão e não
 * é expurgado, porque a `Demanda` fica.
 */
function filtroDaLixeira(entity: TrashEntity): Record<string, unknown> {
  return entity === 'deals' ? { demanda: null } : {};
}

async function recusarSeForDemanda(tenantId: string, entity: TrashEntity, id: string) {
  if (entity !== 'deals') return;
  const demanda = await prisma.demanda.findFirst({
    where: { tenantId, dealId: id },
    select: { id: true },
  });
  if (demanda) {
    throw createError('Andamento controlado pelo Flow', 403, 'DEAL_CONTROLADO_PELO_FLOW');
  }
}

// ── Listagem da lixeira ──────────────────────────────────────────────────────

export interface TrashItem {
  id: string;
  entity: AnyTrashEntity;
  label: string; // nome/título do registro
  deletedAt: Date;
  deletedBy?: { id: string; name: string | null; email: string } | null;
  deletedByAt?: Date | null;
}

const PAGE_SIZE = 25;

type TrashList = {
  items: TrashItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
};

function paginate(items: TrashItem[], page: number, total: number): TrashList {
  return {
    items,
    pagination: {
      page: Math.max(1, page),
      limit: PAGE_SIZE,
      total,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    },
  };
}

/**
 * Lista registros na lixeira de uma entidade (deletedAt != null), tenant-scoped,
 * paginado. Enriquece com "quem/quando" a partir do AuditLog (action 'delete')
 * quando houver. `attachments` tem caminho próprio (`listAttachmentsTrash`).
 */
export async function listTrash(
  tenantId: string,
  entity: AnyTrashEntity,
  page = 1
): Promise<TrashList> {
  if (entity === ATTACHMENTS_ENTITY) return listAttachmentsTrash(tenantId, page);

  const cfg = getConfig(entity);
  const delegate = cfg.delegate();
  const where = { tenantId, deletedAt: { not: null }, ...filtroDaLixeira(entity) };
  const skip = (Math.max(1, page) - 1) * PAGE_SIZE;

  const [records, total] = await Promise.all([
    delegate.findMany({
      where,
      orderBy: { deletedAt: 'desc' },
      skip,
      take: PAGE_SIZE,
    }) as Promise<Array<Record<string, unknown>>>,
    delegate.count({ where }),
  ]);

  const ids = records.map((r) => String(r.id));

  // "Quem/quando" excluiu — best-effort a partir do AuditLog.
  const auditByEntity = new Map<string, { userId: string; createdAt: Date }>();
  if (ids.length > 0) {
    const audits = await prisma.auditLog.findMany({
      where: { tenantId, entityType: cfg.auditType, entityId: { in: ids }, action: 'delete' },
      orderBy: { createdAt: 'desc' },
      select: { entityId: true, userId: true, createdAt: true },
    });
    for (const a of audits) {
      if (!auditByEntity.has(a.entityId)) {
        auditByEntity.set(a.entityId, { userId: a.userId, createdAt: a.createdAt });
      }
    }
  }

  const userIds = [...new Set([...auditByEntity.values()].map((v) => v.userId))];
  const users =
    userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds }, tenantId },
          select: { id: true, name: true, email: true },
        })
      : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  const items: TrashItem[] = records.map((r) => {
    const id = String(r.id);
    const audit = auditByEntity.get(id);
    const deletedBy = audit ? userMap.get(audit.userId) ?? null : null;
    return {
      id,
      entity,
      label: labelForRecord(entity, r),
      deletedAt: r.deletedAt as Date,
      deletedBy,
      deletedByAt: audit?.createdAt ?? null,
    };
  });

  return paginate(items, page, total);
}

/**
 * Lista de anexos na lixeira (deletedAt != null), tenant-scoped, paginado.
 * "Quem" = o `uploadedById` (autor do upload); label = `name`. Não usa AuditLog
 * (anexos não têm entityType próprio no fluxo de aprovação).
 */
async function listAttachmentsTrash(tenantId: string, page: number): Promise<TrashList> {
  const where = { tenantId, deletedAt: { not: null } };
  const skip = (Math.max(1, page) - 1) * PAGE_SIZE;

  const [records, total] = await Promise.all([
    prisma.attachment.findMany({
      where,
      orderBy: { deletedAt: 'desc' },
      skip,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        deletedAt: true,
        uploadedById: true,
        createdAt: true,
      },
    }),
    prisma.attachment.count({ where }),
  ]);

  const userIds = [...new Set(records.map((r) => r.uploadedById).filter((v): v is string => !!v))];
  const users =
    userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds }, tenantId },
          select: { id: true, name: true, email: true },
        })
      : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  const items: TrashItem[] = records.map((r) => ({
    id: r.id,
    entity: ATTACHMENTS_ENTITY,
    label: r.name || '(sem nome)',
    deletedAt: r.deletedAt as Date,
    deletedBy: r.uploadedById ? userMap.get(r.uploadedById) ?? null : null,
    // O anexo não registra "quando" foi excluído em AuditLog; usa o deletedAt.
    deletedByAt: (r.deletedAt as Date) ?? null,
  }));

  return paginate(items, page, total);
}

function labelForRecord(entity: TrashEntity, record: Record<string, unknown>): string {
  if (entity === 'tasks') return String(record.title ?? '(sem título)');
  return String(record.name ?? '(sem nome)');
}

// ── Restauração ──────────────────────────────────────────────────────────────

/**
 * Restaura um registro da lixeira (deletedAt=null). Tenant-scoped. Se o "pai"
 * (empresa/lead) estiver na lixeira, BLOQUEIA com 400 e mensagem clara (req 16 /
 * caso extremo). Só restaura registros que estão de fato na lixeira.
 */
export async function restoreItem(
  tenantId: string,
  entity: AnyTrashEntity,
  id: string
): Promise<void> {
  if (entity === ATTACHMENTS_ENTITY) {
    const found = await prisma.attachment.updateMany({
      where: { id, tenantId, deletedAt: { not: null } },
      data: { deletedAt: null },
    });
    if (found.count === 0) {
      throw createError('Registro não encontrado na lixeira', 404, 'TRASH_ITEM_NOT_FOUND');
    }
    return;
  }

  await recusarSeForDemanda(tenantId, entity, id);

  const cfg = getConfig(entity);
  const delegate = cfg.delegate();

  const record = (await delegate.findFirst({
    where: { id, tenantId, deletedAt: { not: null } },
  })) as Record<string, unknown> | null;

  if (!record) {
    throw createError('Registro não encontrado na lixeira', 404, 'TRASH_ITEM_NOT_FOUND');
  }

  if (cfg.parentDeleted) {
    const blockMsg = await cfg.parentDeleted(tenantId, record);
    if (blockMsg) {
      throw createError(blockMsg, 400, 'TRASH_PARENT_DELETED');
    }
  }

  await delegate.update({ where: { id }, data: { deletedAt: null } });
}

// ── Expurgo (hard-delete) ────────────────────────────────────────────────────

/**
 * Expurga definitivamente (hard-delete) UM item que já está na lixeira.
 * Tenant-scoped; recusa itens que não estão na lixeira (deletedAt=null).
 * Para `attachments`, apaga TAMBÉM os bytes (AttachmentBlob "db" | objeto S3).
 */
export async function purgeItem(
  tenantId: string,
  entity: AnyTrashEntity,
  id: string
): Promise<void> {
  if (entity === ATTACHMENTS_ENTITY) return purgeAttachment(tenantId, id);

  await recusarSeForDemanda(tenantId, entity, id);

  // A chave de Contrato para Company é NO ACTION: contrato, mesmo excluído, guarda o saldo
  // e o histórico das demandas. A recusa é clara, em vez de um 500 da chave estrangeira.
  if (
    entity === 'companies' &&
    (await prisma.contrato.count({ where: { tenantId, companyId: id } })) > 0
  ) {
    throw createError(
      'Empresa com contratos não pode ser expurgada: os contratos guardam saldo e histórico.',
      400,
      'COMPANY_HAS_RELATIONS'
    );
  }

  const cfg = getConfig(entity);
  const delegate = cfg.delegate();

  const record = (await delegate.findFirst({
    where: { id, tenantId, deletedAt: { not: null } },
    // seleção mínima
  })) as Record<string, unknown> | null;

  if (!record) {
    throw createError(
      'Registro não encontrado na lixeira (apenas itens já excluídos podem ser expurgados)',
      404,
      'TRASH_ITEM_NOT_FOUND'
    );
  }

  await delegate.delete({ where: { id } });
}

/**
 * Expurga UM anexo já na lixeira: apaga os bytes (blob "db" ou objeto S3) e o
 * metadado Attachment. Recusa (404) itens que não estão na lixeira.
 */
async function purgeAttachment(tenantId: string, id: string): Promise<void> {
  const att = await prisma.attachment.findFirst({
    where: { id, tenantId, deletedAt: { not: null } },
    select: { id: true, storageProvider: true, storageKey: true },
  });
  if (!att) {
    throw createError(
      'Registro não encontrado na lixeira (apenas itens já excluídos podem ser expurgados)',
      404,
      'TRASH_ITEM_NOT_FOUND'
    );
  }
  // Apaga os bytes ANTES do metadado (best-effort — falha nos bytes não aborta).
  await storageService.purgeBytes(att);
  await prisma.attachment.delete({ where: { id } });
}

/**
 * Expurgo em lote por entidade de itens com deletedAt < cutoff (job de governança).
 * Tenant-scoped; hard-delete respeitando FKs (deleta filhos antes quando aplicável).
 * Retorna a contagem expurgada. Best-effort por item (uma falha não aborta o resto).
 * Para `attachments`, apaga TAMBÉM os bytes de cada anexo (blob/S3).
 */
export async function purgeExpiredForEntity(
  tenantId: string,
  entity: AnyTrashEntity,
  cutoff: Date
): Promise<number> {
  if (entity === ATTACHMENTS_ENTITY) return purgeExpiredAttachments(tenantId, cutoff);

  const cfg = getConfig(entity);
  const delegate = cfg.delegate();

  const stale = (await delegate.findMany({
    where: {
      tenantId,
      deletedAt: { lt: cutoff },
      ...filtroDaLixeira(entity),
      // Empresa com contrato não sai no expurgo automático (ver purgeItem).
      ...(entity === 'companies' ? { contratos: { none: {} } } : {}),
    },
    orderBy: { deletedAt: 'asc' },
    // Evita carregar demais de uma vez.
    take: 500,
  })) as Array<Record<string, unknown>>;

  let purged = 0;
  for (const rec of stale) {
    const id = String(rec.id);
    try {
      await delegate.delete({ where: { id } });
      purged++;
    } catch (err) {
      // FK ou corrida — loga e segue; não aborta o lote.
      logger.error(`trashService.purgeExpired: falha ao expurgar ${entity}/${id}`, err);
    }
  }
  return purged;
}

/**
 * Expurgo em lote de anexos soft-deletados há > cutoff: apaga os bytes (blob/S3)
 * e o metadado de cada um. Best-effort por item. Retorna a contagem expurgada.
 */
async function purgeExpiredAttachments(tenantId: string, cutoff: Date): Promise<number> {
  const stale = await prisma.attachment.findMany({
    where: { tenantId, deletedAt: { lt: cutoff } },
    orderBy: { deletedAt: 'asc' },
    take: 500,
    select: { id: true, storageProvider: true, storageKey: true },
  });

  let purged = 0;
  for (const att of stale) {
    try {
      await storageService.purgeBytes(att);
      await prisma.attachment.delete({ where: { id: att.id } });
      purged++;
    } catch (err) {
      logger.error(`trashService.purgeExpired: falha ao expurgar attachments/${att.id}`, err);
    }
  }
  return purged;
}

export const trashService = {
  TRASH_ENTITIES,
  ALL_TRASH_ENTITIES,
  ATTACHMENTS_ENTITY,
  isTrashEntity,
  isAnyTrashEntity,
  listTrash,
  restoreItem,
  purgeItem,
  purgeExpiredForEntity,
};

export default trashService;
