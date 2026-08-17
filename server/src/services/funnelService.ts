import prisma from '../config/database.js';
import { LeadStatus, LeadStatusReason, FunnelType } from '@prisma/client';
import { createError } from '../middleware/errorHandler.js';
import { assertStageRequiredFieldsFilled } from './dealService.js';
import {
  TERMINAL_LEAD_STATUSES,
  LEAD_STATUS_REASON_LABELS,
  LEAD_STATUS_LABELS,
  assertStatusReason,
} from './leadService.js';

// Régua nova da área comercial (specs/leads-oportunidade-inteligencia-mercado.md req. 33)
const DEFAULT_COLUMNS = [
  { title: 'Novo', color: '#3B82F6', order: 0, isDefault: true, mappedStatus: LeadStatus.NOVO },
  {
    title: 'Em Andamento',
    color: '#F59E0B',
    order: 1,
    isDefault: false,
    mappedStatus: LeadStatus.EM_ANDAMENTO,
  },
  {
    title: 'Pausado',
    color: '#6B7280',
    order: 2,
    isDefault: false,
    mappedStatus: LeadStatus.PAUSADO,
  },
  {
    title: 'Cancelado',
    color: '#EF4444',
    order: 3,
    isDefault: false,
    mappedStatus: LeadStatus.CANCELADO,
  },
  {
    title: 'Encerrado',
    color: '#10B981',
    order: 4,
    isDefault: false,
    mappedStatus: LeadStatus.ENCERRADO,
  },
];

const DEFAULT_DEAL_COLUMNS = [
  { title: 'Qualificação', color: '#3B82F6', order: 0, isDefault: true },
  { title: 'Proposta', color: '#F59E0B', order: 1, isDefault: false },
  { title: 'Negociação', color: '#8B5CF6', order: 2, isDefault: false },
  { title: 'Fechamento', color: '#EC4899', order: 3, isDefault: false },
  { title: 'Ganho', color: '#10B981', order: 4, isDefault: false },
  { title: 'Perdido', color: '#EF4444', order: 5, isDefault: false },
];

export const funnelService = {
  /**
   * Get all funnels for a tenant, including columns and lead/deal counts.
   * Para o analista (USER), `ownerId` restringe as contagens por coluna aos
   * PRÓPRIOS registros — o seletor de funil não deve revelar volumes do time
   * (spec papeis-comerciais req 4/5).
   *
   * `ownerId` aceita um dono (string) | conjunto da equipe ({in}) | undefined
   * (sem filtro) — req 14. DEFAULT == HOJE: USER builtin deals=PROPRIA → userId;
   * GESTOR/ADMIN → undefined → contagens tenant-wide.
   */
  async findAll(tenantId: string, type?: FunnelType, ownerId?: string | { in: string[] }) {
    const where: { tenantId: string; type?: FunnelType } = { tenantId };
    if (type) {
      where.type = type;
    }

    // Filtro de posse aplicado às contagens de leads/deals (vazio = tenant-wide).
    const ownerWhere = ownerId ? { assignedTo: ownerId } : {};

    const funnels = await prisma.funnel.findMany({
      where,
      orderBy: [{ isDefault: 'desc' }, { order: 'asc' }],
      include: {
        columns: {
          orderBy: { order: 'asc' },
          include: {
            _count: {
              select: {
                leads: { where: ownerWhere },
                deals: { where: ownerWhere },
              },
            },
          },
        },
      },
    });

    return funnels;
  },

  /**
   * Get a single funnel with columns and leads/deals (o BOARD do kanban).
   *
   * `assignedTo` aceita um dono (string) | conjunto da equipe ({in}) | undefined
   * (sem filtro) — req 14. DEFAULT == HOJE: USER builtin deals=PROPRIA → userId
   * (== ownerScope de hoje no board); GESTOR/ADMIN → undefined → board completo.
   */
  async findById(tenantId: string, funnelId: string, assignedTo?: string | { in: string[] }) {
    // Escopo do analista (USER): board mostra só os leads/deals do próprio responsável.
    const ownerWhere = assignedTo ? { assignedTo } : {};
    const funnel = await prisma.funnel.findFirst({
      where: { id: funnelId, tenantId },
      include: {
        columns: {
          orderBy: { order: 'asc' },
          include: {
            leads: {
              where: ownerWhere,
              orderBy: { positionInColumn: 'asc' },
              include: {
                tags: { include: { tag: true } },
                // Empresa vinculada no card do Kanban (req. 21): leads novos só
                // têm companyRef; o texto livre é fallback legado.
                companyRef: { select: { id: true, name: true } },
              },
            },
            deals: {
              where: ownerWhere,
              orderBy: { positionInColumn: 'asc' },
              include: {
                lead: { select: { id: true, name: true, email: true, company: true } },
                assignedUser: { select: { id: true, name: true, email: true } },
                company: { select: { id: true, name: true } },
                _count: { select: { tasks: true } },
              },
            },
          },
        },
      },
    });

    if (!funnel) {
      throw createError('Funnel not found', 404);
    }

    return funnel;
  },

  /**
   * Create a new funnel with default columns
   */
  async create(
    tenantId: string,
    data: {
      name: string;
      type?: FunnelType;
      columns?: Array<{ title: string; color?: string; mappedStatus?: LeadStatus }>;
    }
  ) {
    const funnelType = data.type || FunnelType.LEAD;
    const existingCount = await prisma.funnel.count({ where: { tenantId, type: funnelType } });
    const defaultColumns = funnelType === FunnelType.DEAL ? DEFAULT_DEAL_COLUMNS : DEFAULT_COLUMNS;

    const funnel = await prisma.funnel.create({
      data: {
        tenantId,
        name: data.name,
        type: funnelType,
        isDefault: existingCount === 0,
        order: existingCount,
        columns: {
          create: (data.columns || defaultColumns).map((col, index) => ({
            title: col.title,
            color: col.color || '#3B82F6',
            order: index,
            isDefault: index === 0,
            mappedStatus: ('mappedStatus' in col ? col.mappedStatus : null) || null,
          })),
        },
      },
      include: {
        columns: {
          orderBy: { order: 'asc' },
          include: {
            _count: { select: { leads: true, deals: true } },
          },
        },
      },
    });

    return funnel;
  },

  /**
   * Update funnel name or order
   */
  async update(tenantId: string, funnelId: string, data: { name?: string; order?: number }) {
    const funnel = await prisma.funnel.findFirst({
      where: { id: funnelId, tenantId },
    });

    if (!funnel) {
      throw createError('Funnel not found', 404);
    }

    return prisma.funnel.update({
      where: { id: funnelId },
      data: {
        name: data.name ?? funnel.name,
        order: data.order ?? funnel.order,
      },
      include: {
        columns: {
          orderBy: { order: 'asc' },
          include: {
            _count: { select: { leads: true } },
          },
        },
      },
    });
  },

  /**
   * Delete a funnel (cannot delete default)
   */
  async delete(tenantId: string, funnelId: string) {
    const funnel = await prisma.funnel.findFirst({
      where: { id: funnelId, tenantId },
      include: { columns: { include: { _count: { select: { leads: true, deals: true } } } } },
    });

    if (!funnel) {
      throw createError('Funnel not found', 404);
    }

    if (funnel.isDefault) {
      throw createError('Cannot delete the default funnel', 400);
    }

    const totalLeads = funnel.columns.reduce((sum, col) => sum + col._count.leads, 0);
    if (totalLeads > 0) {
      throw createError('Cannot delete funnel with leads. Move leads first.', 400);
    }

    const totalDeals = funnel.columns.reduce((sum, col) => sum + col._count.deals, 0);
    if (totalDeals > 0) {
      throw createError('Cannot delete funnel with deals. Move deals first.', 400);
    }

    await prisma.funnel.delete({ where: { id: funnelId } });
    return { success: true };
  },

  /**
   * Ensure default funnel exists for tenant, create if not
   */
  async ensureDefaultFunnel(tenantId: string, type?: FunnelType) {
    const funnelType = type || FunnelType.LEAD;
    const existing = await prisma.funnel.findFirst({
      where: { tenantId, isDefault: true, type: funnelType },
      include: {
        columns: {
          orderBy: { order: 'asc' },
          include: {
            _count: { select: { leads: true, deals: true } },
          },
        },
      },
    });

    if (existing) return existing;

    const defaultName = funnelType === FunnelType.DEAL ? 'Pipeline de Vendas' : 'Funil de Venda';
    return this.create(tenantId, { name: defaultName, type: funnelType });
  },

  // ========================
  // Column operations
  // ========================

  /**
   * Add column to funnel
   */
  async addColumn(
    tenantId: string,
    funnelId: string,
    data: { title: string; color?: string; mappedStatus?: LeadStatus }
  ) {
    const funnel = await prisma.funnel.findFirst({
      where: { id: funnelId, tenantId },
      include: { columns: true },
    });

    if (!funnel) {
      throw createError('Funnel not found', 404);
    }

    const maxOrder = funnel.columns.reduce((max, col) => Math.max(max, col.order), -1);

    return prisma.funnelColumn.create({
      data: {
        funnelId,
        title: data.title,
        color: data.color || '#3B82F6',
        order: maxOrder + 1,
        isDefault: false,
        mappedStatus: data.mappedStatus || null,
      },
      include: {
        _count: { select: { leads: true } },
      },
    });
  },

  /**
   * Update column (title, color, order)
   */
  async updateColumn(
    tenantId: string,
    columnId: string,
    data: { title?: string; color?: string; order?: number }
  ) {
    const column = await prisma.funnelColumn.findFirst({
      where: { id: columnId, funnel: { tenantId } },
    });

    if (!column) {
      throw createError('Column not found', 404);
    }

    return prisma.funnelColumn.update({
      where: { id: columnId },
      data: {
        title: data.title ?? column.title,
        color: data.color ?? column.color,
        order: data.order ?? column.order,
      },
      include: {
        _count: { select: { leads: true } },
      },
    });
  },

  /**
   * Reorder columns within a funnel
   */
  async reorderColumns(tenantId: string, funnelId: string, columnIds: string[]) {
    const funnel = await prisma.funnel.findFirst({
      where: { id: funnelId, tenantId },
    });

    if (!funnel) {
      throw createError('Funnel not found', 404);
    }

    // Verify all columns belong to this funnel before reordering
    const columns = await prisma.funnelColumn.findMany({
      where: { funnelId },
      select: { id: true },
    });
    const validColumnIds = new Set(columns.map((c) => c.id));
    const invalidIds = columnIds.filter((id) => !validColumnIds.has(id));
    if (invalidIds.length > 0) {
      throw createError('One or more column IDs do not belong to this funnel', 400);
    }

    await prisma.$transaction(
      columnIds.map((id, index) =>
        prisma.funnelColumn.update({
          where: { id },
          data: { order: index },
        })
      )
    );

    return this.findById(tenantId, funnelId);
  },

  /**
   * Delete column (cannot delete default, cannot delete if has leads or deals)
   */
  async deleteColumn(tenantId: string, columnId: string) {
    const column = await prisma.funnelColumn.findFirst({
      where: { id: columnId, funnel: { tenantId } },
      include: { _count: { select: { leads: true, deals: true } } },
    });

    if (!column) {
      throw createError('Column not found', 404);
    }

    if (column.isDefault) {
      throw createError('Cannot delete the default column', 400);
    }

    if (column._count.leads > 0) {
      throw createError('Cannot delete column with leads. Move leads first.', 400);
    }

    if (column._count.deals > 0) {
      throw createError('Cannot delete column with deals. Move deals first.', 400);
    }

    await prisma.funnelColumn.delete({ where: { id: columnId } });
    return { success: true };
  },

  /**
   * Move a lead to a different column (drag-and-drop)
   */
  async moveLead(
    tenantId: string,
    leadId: string,
    targetColumnId: string,
    position: number,
    ownerId?: string | { in: string[] },
    // Motivo da transição quando a coluna de destino mapeia um status TERMINAL
    // (specs/leads-oportunidade reqs. 14-16): exigido também neste caminho de
    // API — a UI do Pipeline grava o motivo via PUT antes do move, mas chamadas
    // diretas ao move-lead não podem contornar a regra.
    reason?: { statusReason?: LeadStatusReason; statusReasonNote?: string; userId?: string }
  ) {
    // Posse (reqs 6/8/14): analista (USER) só move os próprios; equipe ({in}) move
    // os do time; não-dono → 404. undefined → sem filtro (manager).
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, tenantId, deletedAt: null, ...(ownerId ? { assignedTo: ownerId } : {}) },
    });

    if (!lead) {
      throw createError('Lead not found', 404);
    }

    const targetColumn = await prisma.funnelColumn.findFirst({
      where: { id: targetColumnId, funnel: { tenantId } },
    });

    if (!targetColumn) {
      throw createError('Target column not found', 404);
    }

    // Update lead's column position and status
    const updateData: Record<string, unknown> = {
      funnelColumnId: targetColumnId,
      positionInColumn: position,
    };

    // If column has a mapped status, update lead status too.
    // O ciclo do motivo acompanha o status (reqs. 13-16), também no Kanban:
    // transição para terminal exige motivo (400 sem ele); voltar para
    // NOVO/EM_ANDAMENTO limpa motivo/nota obsoletos.
    const statusChanged =
      targetColumn.mappedStatus !== null && targetColumn.mappedStatus !== lead.status;
    if (targetColumn.mappedStatus) {
      updateData.status = targetColumn.mappedStatus;
      if (statusChanged) {
        if (TERMINAL_LEAD_STATUSES.includes(targetColumn.mappedStatus)) {
          assertStatusReason(
            targetColumn.mappedStatus,
            reason?.statusReason,
            reason?.statusReasonNote
          );
          updateData.statusReason = reason!.statusReason;
          updateData.statusReasonNote = reason?.statusReasonNote ?? null;
        } else {
          updateData.statusReason = null;
          updateData.statusReasonNote = null;
        }
      }
    }

    const updatedLead = await prisma.lead.update({
      where: { id: leadId },
      data: updateData,
      include: {
        tags: { include: { tag: true } },
      },
    });

    // Timeline (req. 15): transição terminal COM motivo feita por este caminho
    // gera a Interaction aqui. (No fluxo da UI o PUT grava o motivo antes e o
    // move não vê transição — sem duplicata.)
    if (statusChanged && updateData.statusReason) {
      const reasonLabel =
        LEAD_STATUS_REASON_LABELS[updateData.statusReason as LeadStatusReason];
      await prisma.interaction
        .create({
          data: {
            tenantId,
            leadId,
            type: 'STATUS_CHANGE',
            direction: 'OUTBOUND',
            subject: 'Mudança de status',
            content: `Status alterado de "${LEAD_STATUS_LABELS[lead.status]}" para "${LEAD_STATUS_LABELS[targetColumn.mappedStatus as LeadStatus]}". Motivo: ${reasonLabel}${updateData.statusReasonNote ? `. Nota: ${updateData.statusReasonNote}` : ''}`,
            userId: reason?.userId,
            metadata: {
              previousStatus: lead.status,
              newStatus: targetColumn.mappedStatus,
              statusReason: updateData.statusReason,
              statusReasonNote: updateData.statusReasonNote ?? null,
              via: 'kanban_move',
            },
          },
        })
        .catch(() => {});
    }

    // Reorder other leads in target column
    const leadsInColumn = await prisma.lead.findMany({
      where: { funnelColumnId: targetColumnId, id: { not: leadId }, deletedAt: null },
      orderBy: { positionInColumn: 'asc' },
    });

    await prisma.$transaction(
      leadsInColumn.map((l, index) => {
        const newPosition = index >= position ? index + 1 : index;
        return prisma.lead.update({
          where: { id: l.id },
          data: { positionInColumn: newPosition },
        });
      })
    );

    return updatedLead;
  },

  /**
   * Move a deal to a different column (drag-and-drop)
   */
  async moveDeal(
    tenantId: string,
    dealId: string,
    targetColumnId: string,
    position: number,
    ownerId?: string | { in: string[] }
  ) {
    // Posse (reqs 6/8/14): analista (USER) só move os próprios; equipe ({in}) move
    // os do time; não-dono → 404. undefined → sem filtro (manager).
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, tenantId, deletedAt: null, ...(ownerId ? { assignedTo: ownerId } : {}) },
    });

    if (!deal) {
      throw createError('Deal not found', 404);
    }

    const targetColumn = await prisma.funnelColumn.findFirst({
      where: { id: targetColumnId, funnel: { tenantId } },
    });

    if (!targetColumn) {
      throw createError('Target column not found', 404);
    }

    // Enforcement (reqs 4/10): bloquear o avanço via drag-drop se a etapa de destino
    // tem campos obrigatórios (StageRequiredField) ainda não preenchidos. Mesma regra
    // aplicada no dealService.update (clique no stepper) — paridade entre os dois caminhos.
    if (deal.funnelColumnId !== targetColumnId) {
      await assertStageRequiredFieldsFilled(
        targetColumnId,
        (deal.customFields as Record<string, unknown>) || {}
      );
    }

    // Update deal's column position and funnel
    const updateData: Record<string, unknown> = {
      funnelColumnId: targetColumnId,
      funnelId: targetColumn.funnelId,
      positionInColumn: position,
    };

    const updatedDeal = await prisma.deal.update({
      where: { id: dealId },
      data: updateData,
      include: {
        lead: { select: { id: true, name: true, email: true } },
        assignedUser: { select: { id: true, name: true, email: true } },
      },
    });

    // Reorder other deals in target column
    const dealsInColumn = await prisma.deal.findMany({
      where: { funnelColumnId: targetColumnId, id: { not: dealId }, deletedAt: null },
      orderBy: { positionInColumn: 'asc' },
    });

    await prisma.$transaction(
      dealsInColumn.map((d, index) => {
        const newPosition = index >= position ? index + 1 : index;
        return prisma.deal.update({
          where: { id: d.id },
          data: { positionInColumn: newPosition },
        });
      })
    );

    return updatedDeal;
  },
};
