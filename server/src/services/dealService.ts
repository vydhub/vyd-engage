import prisma from '../config/database.js';
import { DealStage, DealStatus, CommercialRoadmapStatus } from '@prisma/client';
import { createError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { webhookDispatcher } from './webhookDispatcher.js';
import { notifyDealWon, notifyDealLost } from './slackService.js';
import { emitToTenant } from './socketService.js';
import { companyService } from './companyService.js';

const STAGE_PROBABILITY: Record<DealStage, number> = {
  QUALIFICATION: 20,
  PROPOSAL: 40,
  NEGOTIATION: 60,
  CLOSING: 80,
  WON: 100,
  LOST: 0,
};

export interface CreateDealData {
  name: string;
  value: number;
  stage?: DealStage;
  probability?: number;
  expectedCloseDate?: string;
  leadId?: string | null;
  companyId?: string | null;
  empreendimentoId?: string | null;
  assignedTo?: string | null;
  notes?: string;
  customFields?: Record<string, any>;
  lostReason?: string;
  funnelId?: string | null;
  funnelColumnId?: string | null;
  // Gestão de Negócios (RD parity) — P0
  qualification?: number | null;
  sourceId?: string | null;
  originCampaignId?: string | null;
  oneTimeValue?: number | null;
  recurringValue?: number | null;
}

export interface UpdateDealData extends Partial<CreateDealData> {
  id: string;
}

const dealInclude = {
  lead: { select: { id: true, name: true, email: true } },
  assignedUser: { select: { id: true, name: true, email: true } },
} as const;

const contactLeadSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  position: true,
  company: true,
} as const;

function isFilled(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/**
 * Trava o avanço de uma negociação para uma etapa cujos campos obrigatórios
 * (StageRequiredField) ainda não estão preenchidos. Lança 400 com a lista de
 * campos pendentes (reqs 4 e 10). Checa o valor tanto por nome quanto por id do
 * CustomField em `customFields` (o JSON do deal é chaveado por nome ou id).
 */
export async function assertStageRequiredFieldsFilled(
  destColumnId: string,
  customFields: Record<string, unknown>
) {
  const required = await prisma.stageRequiredField.findMany({
    where: { funnelColumnId: destColumnId },
    include: { customField: { select: { id: true, name: true } } },
  });
  const pending = required
    .filter(
      (r) =>
        !isFilled(customFields?.[r.customField.name]) && !isFilled(customFields?.[r.customField.id])
    )
    .map((r) => r.customField.name);
  if (pending.length > 0) {
    const err = createError(
      `Preencha os campos obrigatórios da etapa antes de avançar: ${pending.join(', ')}`,
      400,
      'STAGE_REQUIRED_FIELDS_MISSING'
    ) as Error & { details?: unknown };
    err.details = { pendingFields: pending };
    throw err;
  }
}

export const dealService = {
  async create(tenantId: string, data: CreateDealData) {
    const stage = data.stage || DealStage.QUALIFICATION;
    const probability = data.probability ?? STAGE_PROBABILITY[stage];

    // If funnelId is provided but no funnelColumnId, use first column
    let funnelColumnId = data.funnelColumnId || null;
    if (data.funnelId && !funnelColumnId) {
      const firstColumn = await prisma.funnelColumn.findFirst({
        where: { funnelId: data.funnelId },
        orderBy: { order: 'asc' },
      });
      if (firstColumn) {
        funnelColumnId = firstColumn.id;
      }
    }

    const deal = await prisma.deal.create({
      data: {
        tenantId,
        name: data.name,
        value: data.value,
        stage,
        probability,
        expectedCloseDate: data.expectedCloseDate ? new Date(data.expectedCloseDate) : null,
        leadId: data.leadId || null,
        companyId: data.companyId || null,
        empreendimentoId: data.empreendimentoId || null,
        assignedTo: data.assignedTo || null,
        notes: data.notes || null,
        customFields: data.customFields || {},
        lostReason: data.lostReason || null,
        funnelId: data.funnelId || null,
        funnelColumnId,
        qualification: data.qualification ?? null,
        sourceId: data.sourceId || null,
        originCampaignId: data.originCampaignId || null,
        oneTimeValue: data.oneTimeValue ?? null,
        recurringValue: data.recurringValue ?? null,
      },
      include: dealInclude,
    });

    // Dispatch webhook event
    webhookDispatcher.emitDealEvent(tenantId, 'deal.created', deal);

    // Emit Socket.IO event for real-time cache updates
    emitToTenant(tenantId, 'deal:created', { deal });

    return deal;
  },

  async findById(tenantId: string, id: string) {
    const deal = await prisma.deal.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        lead: { select: { id: true, name: true, email: true, phone: true, company: true } },
        assignedUser: { select: { id: true, name: true, email: true } },
        company: { select: { id: true, name: true, phone: true } },
      },
    });

    if (!deal) {
      throw createError('Deal not found', 404, 'DEAL_NOT_FOUND');
    }

    return deal;
  },

  async findAll(
    tenantId: string,
    filters?: {
      stage?: DealStage;
      // Escopo de responsável: um dono (string) ou o conjunto da equipe ({in}) — req 14.
      assignedTo?: string | { in: string[] };
      leadId?: string;
      funnelId?: string;
      search?: string;
      minValue?: number;
      maxValue?: number;
      qualification?: number;
      sourceId?: string;
      originCampaignId?: string;
      page?: number;
      limit?: number;
      sort?: string;
      order?: 'asc' | 'desc';
    }
  ) {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;
    const sortField = filters?.sort || 'createdAt';
    const sortOrder = filters?.order || 'desc';

    const where: any = { tenantId, deletedAt: null };

    if (filters?.stage) {
      where.stage = filters.stage;
    }

    if (filters?.assignedTo) {
      where.assignedTo = filters.assignedTo;
    }

    if (filters?.leadId) {
      where.leadId = filters.leadId;
    }

    if (filters?.funnelId) {
      where.funnelId = filters.funnelId;
    }

    if (filters?.search) {
      where.OR = [{ name: { contains: filters.search, mode: 'insensitive' } }];
    }

    if (filters?.minValue !== undefined) {
      where.value = { ...where.value, gte: filters.minValue };
    }

    if (filters?.maxValue !== undefined) {
      where.value = { ...where.value, lte: filters.maxValue };
    }

    // Filtros server-side de Gestão de Negócios (LACUNA #1/#6): sem eles o front
    // só filtrava client-side a página atual → totais/paginação errados.
    if (filters?.qualification) {
      // Semântica "N+ estrelas": inclui qualificações iguais ou superiores.
      where.qualification = { gte: filters.qualification };
    }

    if (filters?.sourceId) {
      where.sourceId = filters.sourceId;
    }

    if (filters?.originCampaignId) {
      where.originCampaignId = filters.originCampaignId;
    }

    const [deals, total] = await Promise.all([
      prisma.deal.findMany({
        where,
        include: {
          lead: { select: { id: true, name: true, email: true } },
          assignedUser: { select: { id: true, name: true, email: true } },
        },
        orderBy: { [sortField]: sortOrder },
        skip,
        take: limit,
      }),
      prisma.deal.count({ where }),
    ]);

    return {
      deals,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  async update(tenantId: string, data: UpdateDealData) {
    const existing = await this.findById(tenantId, data.id);

    const stage = data.stage ?? existing.stage;
    // Auto-update probability when stage changes and probability wasn't explicitly set
    const probability =
      data.probability ?? (data.stage ? STAGE_PROBABILITY[data.stage] : undefined);

    const updateData: any = {
      name: data.name,
      value: data.value,
      stage: data.stage,
      probability,
      expectedCloseDate:
        data.expectedCloseDate !== undefined
          ? data.expectedCloseDate
            ? new Date(data.expectedCloseDate)
            : null
          : undefined,
      leadId: data.leadId,
      companyId: data.companyId,
      empreendimentoId: data.empreendimentoId,
      assignedTo: data.assignedTo,
      notes: data.notes,
      customFields: data.customFields,
      lostReason: data.lostReason,
      funnelId: data.funnelId,
      funnelColumnId: data.funnelColumnId,
      qualification: data.qualification,
      sourceId: data.sourceId,
      originCampaignId: data.originCampaignId,
      oneTimeValue: data.oneTimeValue,
      recurringValue: data.recurringValue,
    };

    // Auto-set closedAt when moving to WON or LOST
    const closedStages: DealStage[] = [DealStage.WON, DealStage.LOST];
    if (data.stage && closedStages.includes(data.stage)) {
      if (!existing.closedAt) {
        updateData.closedAt = new Date();
      }
    } else if (data.stage) {
      // Reopening a deal — clear closedAt
      updateData.closedAt = null;
    }

    // Alinhar status/wonAt/lostAt com a etapa ao fechar pelo formulário de edição
    // (LACUNA #10/#12): sem isso, só markWon/markLost alinhavam esses campos e a
    // comemoração + gatilhos BIG_SALE/DEAL_LOST não disparavam por este caminho.
    // Só na TRANSIÇÃO real de etapa (compara existing.stage), sem duplicar efeitos.
    if (data.stage && data.stage !== existing.stage) {
      if (data.stage === DealStage.WON) {
        updateData.status = DealStatus.WON;
        if (!existing.wonAt) {
          updateData.wonAt = new Date();
        }
      } else if (data.stage === DealStage.LOST) {
        updateData.status = DealStatus.LOST;
        if (!existing.lostAt) {
          updateData.lostAt = new Date();
        }
      } else if (existing.stage === DealStage.WON || existing.stage === DealStage.LOST) {
        // Reabrindo: etapa sai de WON/LOST para outra — volta a OPEN e limpa marcos.
        updateData.status = DealStatus.OPEN;
        updateData.wonAt = null;
        updateData.lostAt = null;
      }
    }

    // Remove undefined values
    Object.keys(updateData).forEach((key) => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });

    // Tenant-safe update: verify ownership before updating
    const verified = await prisma.deal.findFirst({
      where: { id: data.id, tenantId, deletedAt: null },
    });
    if (!verified) {
      throw createError('Deal not found', 404, 'DEAL_NOT_FOUND');
    }

    // Enforcement: bloquear avanço se a etapa de destino tem campos obrigatórios vazios (reqs 4/10)
    if (data.funnelColumnId && data.funnelColumnId !== existing.funnelColumnId) {
      await assertStageRequiredFieldsFilled(data.funnelColumnId, {
        ...((existing.customFields as Record<string, unknown>) || {}),
        ...(data.customFields || {}),
      });
    }

    const deal = await prisma.deal.update({
      where: { id: data.id },
      data: updateData,
      include: {
        lead: { select: { id: true, name: true, email: true, phone: true, company: true } },
        assignedUser: { select: { id: true, name: true, email: true } },
      },
    });

    // HOOK A — Stage History tracking
    const newStage = deal.stage;
    if (existing.stage !== newStage) {
      await prisma.dealStageHistory
        .updateMany({
          where: { dealId: data.id, exitedAt: null },
          data: { exitedAt: new Date() },
        })
        .catch(() => {});
      await prisma.dealStageHistory
        .create({
          data: { dealId: data.id, stage: newStage },
        })
        .catch(() => {});
    }

    // HOOK B — Auto-task creation on funnel column change
    if (existing.funnelColumnId !== deal.funnelColumnId && deal.funnelColumnId) {
      prisma.stageTaskTemplate
        .findMany({
          where: { funnelColumnId: deal.funnelColumnId },
        })
        .then(async (templates) => {
          for (const t of templates) {
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() + t.dueDaysFromNow);
            await prisma.task.create({
              data: {
                tenantId: deal.tenantId,
                title: t.taskTitle,
                priority: t.priority as any,
                dueDate,
                dealId: deal.id,
                assignedTo: t.assignToOwner ? deal.assignedTo || null : null,
              },
            });
          }
        })
        .catch((err) => {
          logger.error('Failed to create auto-tasks on stage change', err, { dealId: deal.id });
        });
    }

    // Deal GANHO com leadId: encerra o lead de origem como convertido
    if (data.stage === DealStage.WON && deal.leadId) {
      await prisma.lead
        .update({
          where: { id: deal.leadId },
          data: { status: 'ENCERRADO', statusReason: 'CONVERTIDO_EM_OPORTUNIDADE' },
        })
        .catch((err) => {
          logger.error('Failed to update lead status to WON after deal won', err, {
            dealId: deal.id,
            leadId: deal.leadId,
            tenantId,
          });
        });
    }

    // Deal GANHO promove a empresa vinculada a CLIENTE_ATIVO (no-op se já for) — req 6.
    if (data.stage === DealStage.WON && existing.stage !== DealStage.WON && deal.companyId) {
      await companyService.promoteToActiveClient(tenantId, deal.companyId);
    }

    // Desdobramento comercial — refletir a etapa do Deal no status dos roadmaps
    // vinculados (req 17). Só "espelha" os marcos relevantes; não rebaixa.
    if (data.stage && data.stage !== existing.stage) {
      const ROADMAP_STATUS_BY_STAGE: Partial<Record<DealStage, CommercialRoadmapStatus>> = {
        [DealStage.PROPOSAL]: CommercialRoadmapStatus.PROPOSTA,
        [DealStage.WON]: CommercialRoadmapStatus.GANHO,
        [DealStage.LOST]: CommercialRoadmapStatus.PERDIDO,
      };
      const roadmapStatus = ROADMAP_STATUS_BY_STAGE[data.stage];
      if (roadmapStatus) {
        prisma.commercialRoadmap
          .updateMany({
            where: { tenantId, dealId: deal.id, deletedAt: null },
            data: { status: roadmapStatus },
          })
          .catch(() => {});
      }
    }

    // Dispatch webhook events based on what changed
    if (data.stage && data.stage !== existing.stage) {
      webhookDispatcher.emitDealEvent(tenantId, 'deal.stage_changed', deal, {
        previous_stage: existing.stage,
        new_stage: data.stage,
      });

      if (data.stage === DealStage.WON) {
        webhookDispatcher.emitDealEvent(tenantId, 'deal.won', deal);
        notifyDealWon(tenantId, deal).catch(() => {});
      } else if (data.stage === DealStage.LOST) {
        webhookDispatcher.emitDealEvent(tenantId, 'deal.lost', deal, {
          lost_reason: deal.lostReason || null,
        });
        notifyDealLost(tenantId, deal).catch(() => {});
      }
    }

    // Always emit deal.updated for any update
    webhookDispatcher.emitDealEvent(tenantId, 'deal.updated', deal);

    // Emit Socket.IO event for real-time cache updates
    emitToTenant(tenantId, 'deal:updated', { deal });

    return deal;
  },

  // ── Gestão de Negócios (RD parity) — ações de status dedicadas (reqs 19-23) ──

  async markWon(tenantId: string, id: string) {
    const existing = await this.findById(tenantId, id);
    const deal = await prisma.deal.update({
      where: { id },
      data: {
        status: DealStatus.WON,
        stage: DealStage.WON,
        probability: 100,
        wonAt: new Date(),
        closedAt: new Date(),
      },
      include: dealInclude,
    });
    if (deal.leadId) {
      await prisma.lead
        .update({
          where: { id: deal.leadId },
          data: { status: 'ENCERRADO', statusReason: 'CONVERTIDO_EM_OPORTUNIDADE' },
        })
        .catch(() => {});
    }
    // Deal GANHO promove a empresa vinculada a CLIENTE_ATIVO (req 6) — só na
    // TRANSIÇÃO real para WON: re-marcar um deal já ganho não re-promove uma
    // empresa rebaixada manualmente (mesma guarda de update()).
    if (deal.companyId && existing.stage !== DealStage.WON) {
      await companyService.promoteToActiveClient(tenantId, deal.companyId);
    }
    webhookDispatcher.emitDealEvent(tenantId, 'deal.won', deal);
    notifyDealWon(tenantId, deal).catch(() => {});
    emitToTenant(tenantId, 'deal:updated', { deal });
    return deal;
  },

  async markLost(tenantId: string, id: string, lostReasonId: string) {
    await this.findById(tenantId, id);
    const reason = await prisma.lostReason.findFirst({ where: { id: lostReasonId, tenantId } });
    if (!reason) {
      throw createError('Motivo de perda inválido', 400, 'INVALID_LOST_REASON');
    }
    const deal = await prisma.deal.update({
      where: { id },
      data: {
        status: DealStatus.LOST,
        stage: DealStage.LOST,
        probability: 0,
        lostAt: new Date(),
        closedAt: new Date(),
        lostReasonId,
        lostReason: reason.label,
      },
      include: dealInclude,
    });
    webhookDispatcher.emitDealEvent(tenantId, 'deal.lost', deal, { lost_reason: reason.label });
    notifyDealLost(tenantId, deal).catch(() => {});
    emitToTenant(tenantId, 'deal:updated', { deal });
    return deal;
  },

  async pause(tenantId: string, id: string) {
    await this.findById(tenantId, id);
    const deal = await prisma.deal.update({
      where: { id },
      data: { status: DealStatus.PAUSED, pausedAt: new Date() },
      include: dealInclude,
    });
    emitToTenant(tenantId, 'deal:updated', { deal });
    return deal;
  },

  async resume(tenantId: string, id: string) {
    await this.findById(tenantId, id);
    const deal = await prisma.deal.update({
      where: { id },
      data: { status: DealStatus.OPEN, pausedAt: null },
      include: dealInclude,
    });
    emitToTenant(tenantId, 'deal:updated', { deal });
    return deal;
  },

  // ── Múltiplos contatos da negociação (req 16) ──

  async listContacts(tenantId: string, dealId: string) {
    await this.findById(tenantId, dealId);
    return prisma.dealContact.findMany({
      where: { dealId },
      include: { lead: { select: contactLeadSelect } },
      orderBy: { createdAt: 'asc' },
    });
  },

  async addContact(tenantId: string, dealId: string, leadId: string, roleInDeal?: string | null) {
    await this.findById(tenantId, dealId);
    const lead = await prisma.lead.findFirst({ where: { id: leadId, tenantId } });
    if (!lead) {
      throw createError('Contato não encontrado', 404, 'CONTACT_NOT_FOUND');
    }
    return prisma.dealContact.upsert({
      where: { dealId_leadId: { dealId, leadId } },
      update: { roleInDeal: roleInDeal ?? null },
      create: { dealId, leadId, roleInDeal: roleInDeal ?? null },
      include: { lead: { select: contactLeadSelect } },
    });
  },

  async removeContact(tenantId: string, dealId: string, contactId: string) {
    await this.findById(tenantId, dealId);
    const dc = await prisma.dealContact.findFirst({ where: { id: contactId, dealId } });
    if (!dc) {
      throw createError('Contato não encontrado', 404, 'DEAL_CONTACT_NOT_FOUND');
    }
    await prisma.dealContact.delete({ where: { id: dc.id } });
    return { deleted: true };
  },

  async delete(tenantId: string, id: string) {
    // Tenant-safe delete: verify ownership before deleting
    const deal = await prisma.deal.findFirst({ where: { id, tenantId, deletedAt: null } });
    if (!deal) {
      throw createError('Deal not found', 404, 'DEAL_NOT_FOUND');
    }
    await prisma.deal.update({ where: { id }, data: { deletedAt: new Date() } });

    // Emit Socket.IO event for real-time cache updates
    emitToTenant(tenantId, 'deal:deleted', { dealId: id });
  },

  async getStats(tenantId: string, assignedTo?: string | { in: string[] }) {
    // Escopo por responsável (analista/USER vê só os próprios) — spec papeis-comerciais.
    const scope = assignedTo ? { assignedTo } : {};
    const activeStages: DealStage[] = [
      DealStage.QUALIFICATION,
      DealStage.PROPOSAL,
      DealStage.NEGOTIATION,
      DealStage.CLOSING,
    ];

    // All aggregations at DB level — no full table load
    const [totalCount, stageGroups, activeAgg, wonAgg, lostAgg, wonCycleTimeDeals] =
      await Promise.all([
        // Total deal count
        prisma.deal.count({ where: { tenantId, deletedAt: null, ...scope } }),

        // Group by stage: count + sum value
        prisma.deal.groupBy({
          by: ['stage'],
          where: { tenantId, deletedAt: null, ...scope },
          _count: { id: true },
          _sum: { value: true },
        }),

        // Active pipeline aggregation (sum value for active stages)
        prisma.deal.aggregate({
          where: { tenantId, deletedAt: null, stage: { in: activeStages }, ...scope },
          _sum: { value: true },
          _count: { id: true },
        }),

        // Won deals aggregation
        prisma.deal.aggregate({
          where: { tenantId, deletedAt: null, stage: DealStage.WON, ...scope },
          _sum: { value: true },
          _count: { id: true },
          _avg: { value: true },
        }),

        // Lost deals aggregation
        prisma.deal.aggregate({
          where: { tenantId, deletedAt: null, stage: DealStage.LOST, ...scope },
          _sum: { value: true },
          _count: { id: true },
        }),

        // Won deals with closedAt for cycle time calculation (lightweight select)
        prisma.deal.findMany({
          where: { tenantId, deletedAt: null, stage: DealStage.WON, closedAt: { not: null }, ...scope },
          select: { createdAt: true, closedAt: true },
        }),
      ]);

    const totalPipelineValue = Number(activeAgg._sum.value || 0);
    const wonValue = Number(wonAgg._sum.value || 0);
    const lostValue = Number(lostAgg._sum.value || 0);
    const wonCount = wonAgg._count.id;
    const lostCount = lostAgg._count.id;
    const activeCount = activeAgg._count.id;
    const closedCount = wonCount + lostCount;
    const winRate = closedCount > 0 ? (wonCount / closedCount) * 100 : 0;
    const avgDealSize = wonCount > 0 ? wonValue / wonCount : 0;

    // Weighted pipeline value needs per-stage probability, compute from groupBy
    const stageGroupMap = new Map(stageGroups.map((g) => [g.stage, g]));
    let weightedValue = 0;
    for (const stage of activeStages) {
      const group = stageGroupMap.get(stage);
      if (group && group._sum.value) {
        weightedValue += Number(group._sum.value) * (STAGE_PROBABILITY[stage] / 100);
      }
    }

    // Average cycle time (days) for won deals
    const cycleTimes = wonCycleTimeDeals.map(
      (d) => (d.closedAt!.getTime() - d.createdAt.getTime()) / (1000 * 60 * 60 * 24)
    );
    const avgCycleTime =
      cycleTimes.length > 0 ? cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length : 0;

    // By stage breakdown
    const byStage = activeStages.map((stage) => {
      const group = stageGroupMap.get(stage);
      const totalValue = Number(group?._sum.value || 0);
      return {
        stage,
        count: group?._count.id || 0,
        totalValue,
        weightedValue: totalValue * (STAGE_PROBABILITY[stage] / 100),
      };
    });

    return {
      totalPipelineValue,
      weightedValue: Math.round(weightedValue * 100) / 100,
      wonValue,
      lostValue,
      winRate: Math.round(winRate * 10) / 10,
      avgDealSize: Math.round(avgDealSize * 100) / 100,
      avgCycleTime: Math.round(avgCycleTime * 10) / 10,
      byStage,
      totalDeals: totalCount,
      activeDeals: activeCount,
      wonDeals: wonCount,
      lostDeals: lostCount,
    };
  },
};
