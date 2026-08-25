import prisma from '../config/database.js';
import { DealStage, LeadStatus } from '@prisma/client';

const ACTIVE_STAGES: DealStage[] = [
  DealStage.QUALIFICATION,
  DealStage.PROPOSAL,
  DealStage.NEGOTIATION,
  DealStage.CLOSING,
];

interface MonthlyForecast {
  month: string; // 'YYYY-MM'
  totalValue: number;
  weightedValue: number;
  dealCount: number;
  conservative: number;
  optimistic: number;
}

interface WonLostMonth {
  month: string;
  won: { count: number; value: number };
  lost: { count: number; value: number };
}

interface ForecastSummary {
  totalPipelineValue: number;
  totalWeightedForecast: number;
  avgDealSize: number;
  avgCloseTimeDays: number;
  winRate: number;
  conservativeTotal: number;
  optimisticTotal: number;
}

export interface ForecastResponse {
  monthly: MonthlyForecast[];
  noDateBucket: { totalValue: number; weightedValue: number; dealCount: number };
  summary: ForecastSummary;
}

export interface TrendResponse {
  months: WonLostMonth[];
}

export interface FunnelConversionStage {
  stage: string;
  count: number;
  conversionToNext: number | null;
  dropOffRate: number | null;
}

export interface FunnelConversionResponse {
  stages: FunnelConversionStage[];
  total: number;
}

export const forecastService = {
  /**
   * Monthly forecast for the next N months, based on open deals with expectedCloseDate.
   */
  async getForecast(
    tenantId: string,
    filters?: { months?: number; assignedTo?: string | { in: string[] }; stage?: DealStage }
  ): Promise<ForecastResponse> {
    const months = filters?.months || 6;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = new Date(now.getFullYear(), now.getMonth() + months, 0, 23, 59, 59, 999);

    // Build where clause for active deals
    const where: any = {
      tenantId,
      deletedAt: null,
      stage: { in: filters?.stage ? [filters.stage] : ACTIVE_STAGES },
    };
    if (filters?.assignedTo) {
      where.assignedTo = filters.assignedTo;
    }

    // Fetch all active deals for this tenant (lightweight select)
    const deals = await prisma.deal.findMany({
      where,
      select: {
        id: true,
        value: true,
        probability: true,
        expectedCloseDate: true,
        stage: true,
        createdAt: true,
        closedAt: true,
      },
    });

    // Group by month
    const monthMap = new Map<string, MonthlyForecast>();

    // Pre-populate month buckets
    for (let i = 0; i < months; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthMap.set(key, {
        month: key,
        totalValue: 0,
        weightedValue: 0,
        dealCount: 0,
        conservative: 0,
        optimistic: 0,
      });
    }

    let noDateTotal = 0;
    let noDateWeighted = 0;
    let noDateCount = 0;

    for (const deal of deals) {
      const value = Number(deal.value);
      const weighted = value * (deal.probability / 100);

      if (!deal.expectedCloseDate) {
        noDateTotal += value;
        noDateWeighted += weighted;
        noDateCount++;
        continue;
      }

      const ecd = deal.expectedCloseDate;
      const key = `${ecd.getFullYear()}-${String(ecd.getMonth() + 1).padStart(2, '0')}`;
      const bucket = monthMap.get(key);
      if (bucket) {
        bucket.totalValue += value;
        bucket.weightedValue += weighted;
        bucket.dealCount++;
        // conservative: weighted value only for high-probability deals (>= 70%)
        if (deal.probability >= 70) {
          bucket.conservative += weighted;
        }
        // optimistic: full face value regardless of probability
        bucket.optimistic += value;
      }
      // Deals outside the forecast window are ignored in monthly breakdown
    }

    const monthly = Array.from(monthMap.values()).sort((a, b) => a.month.localeCompare(b.month));

    // Summary KPIs (reuse all deals for pipeline value)
    const allActiveDeals = await prisma.deal.findMany({
      where: {
        tenantId,
        deletedAt: null,
        stage: { in: ACTIVE_STAGES },
        ...(filters?.assignedTo ? { assignedTo: filters.assignedTo } : {}),
      },
      select: { value: true, probability: true },
    });

    const totalPipelineValue = allActiveDeals.reduce((sum, d) => sum + Number(d.value), 0);
    const totalWeightedForecast = allActiveDeals.reduce(
      (sum, d) => sum + Number(d.value) * (d.probability / 100),
      0
    );
    const avgDealSize = allActiveDeals.length > 0 ? totalPipelineValue / allActiveDeals.length : 0;

    // Conservative: weighted value for high-probability deals only (>= 70%)
    const conservativeTotal = allActiveDeals.reduce((sum, d) => {
      return d.probability >= 70 ? sum + Number(d.value) * (d.probability / 100) : sum;
    }, 0);
    // Optimistic: full face value of all open deals
    const optimisticTotal = totalPipelineValue;

    // Win rate and avg cycle time from closed deals
    const [wonAgg, lostCount, wonCycleDeals] = await Promise.all([
      prisma.deal.aggregate({
        where: {
          tenantId,
          deletedAt: null,
          stage: DealStage.WON,
          ...(filters?.assignedTo ? { assignedTo: filters.assignedTo } : {}),
        },
        _count: { id: true },
      }),
      prisma.deal.count({
        where: {
          tenantId,
          deletedAt: null,
          stage: DealStage.LOST,
          ...(filters?.assignedTo ? { assignedTo: filters.assignedTo } : {}),
        },
      }),
      prisma.deal.findMany({
        where: {
          tenantId,
          deletedAt: null,
          stage: DealStage.WON,
          closedAt: { not: null },
          ...(filters?.assignedTo ? { assignedTo: filters.assignedTo } : {}),
        },
        select: { createdAt: true, closedAt: true },
      }),
    ]);

    const wonCount = wonAgg._count.id;
    const closedCount = wonCount + lostCount;
    const winRate = closedCount > 0 ? (wonCount / closedCount) * 100 : 0;

    const cycleTimes = wonCycleDeals.map(
      (d) => (d.closedAt!.getTime() - d.createdAt.getTime()) / (1000 * 60 * 60 * 24)
    );
    const avgCloseTimeDays =
      cycleTimes.length > 0 ? cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length : 0;

    const monthlyRounded = monthly.map((m) => ({
      ...m,
      conservative: Math.round(m.conservative * 100) / 100,
      optimistic: Math.round(m.optimistic * 100) / 100,
    }));

    return {
      monthly: monthlyRounded,
      noDateBucket: {
        totalValue: Math.round(noDateTotal * 100) / 100,
        weightedValue: Math.round(noDateWeighted * 100) / 100,
        dealCount: noDateCount,
      },
      summary: {
        totalPipelineValue: Math.round(totalPipelineValue * 100) / 100,
        totalWeightedForecast: Math.round(totalWeightedForecast * 100) / 100,
        avgDealSize: Math.round(avgDealSize * 100) / 100,
        avgCloseTimeDays: Math.round(avgCloseTimeDays * 10) / 10,
        winRate: Math.round(winRate * 10) / 10,
        conservativeTotal: Math.round(conservativeTotal * 100) / 100,
        optimisticTotal: Math.round(optimisticTotal * 100) / 100,
      },
    };
  },

  /**
   * Won vs Lost trend for the last N months.
   */
  async getTrend(
    tenantId: string,
    months: number = 6,
    assignedTo?: string | { in: string[] }
  ): Promise<TrendResponse> {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);

    const closedDeals = await prisma.deal.findMany({
      where: {
        tenantId,
        deletedAt: null,
        stage: { in: [DealStage.WON, DealStage.LOST] },
        closedAt: { not: null, gte: startDate },
        ...(assignedTo ? { assignedTo } : {}),
      },
      select: {
        stage: true,
        value: true,
        closedAt: true,
      },
    });

    // Pre-populate month buckets
    const monthMap = new Map<string, WonLostMonth>();
    for (let i = 0; i < months; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - months + 1 + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthMap.set(key, {
        month: key,
        won: { count: 0, value: 0 },
        lost: { count: 0, value: 0 },
      });
    }

    for (const deal of closedDeals) {
      if (!deal.closedAt) continue;
      const key = `${deal.closedAt.getFullYear()}-${String(deal.closedAt.getMonth() + 1).padStart(2, '0')}`;
      const bucket = monthMap.get(key);
      if (!bucket) continue;

      const value = Number(deal.value);
      if (deal.stage === DealStage.WON) {
        bucket.won.count++;
        bucket.won.value += value;
      } else {
        bucket.lost.count++;
        bucket.lost.value += value;
      }
    }

    const result = Array.from(monthMap.values()).sort((a, b) => a.month.localeCompare(b.month));

    // Round values
    for (const m of result) {
      m.won.value = Math.round(m.won.value * 100) / 100;
      m.lost.value = Math.round(m.lost.value * 100) / 100;
    }

    return { months: result };
  },

  /**
   * Lead funnel conversion rates — snapshot approach.
   */
  async getFunnelConversion(
    tenantId: string,
    filters?: {
      from?: string;
      to?: string;
      source?: string;
      assignedTo?: string | { in: string[] };
      // Upgrade RD P0 (req 5): fonte/campanha vivem no Deal — filtra leads que
      // têm ao menos uma negociação com a fonte/campanha pedida.
      sourceId?: string;
      originCampaignId?: string;
      // Upgrade RD P0 (req 8): filtra leads com ≥1 negociação cuja empresa está
      // no segmento pedido (segmentId vive em Company).
      segmentId?: string;
    }
  ): Promise<FunnelConversionResponse> {
    const where: any = { tenantId, deletedAt: null };

    if (filters?.from || filters?.to) {
      where.createdAt = {};
      if (filters.from) where.createdAt.gte = new Date(filters.from);
      if (filters.to) where.createdAt.lte = new Date(filters.to);
    }
    if (filters?.source) {
      where.source = filters.source;
    }
    if (filters?.assignedTo) {
      where.assignedTo = filters.assignedTo;
    }
    if (filters?.sourceId || filters?.originCampaignId || filters?.segmentId) {
      where.deals = {
        some: {
          deletedAt: null,
          ...(filters.sourceId ? { sourceId: filters.sourceId } : {}),
          ...(filters.originCampaignId ? { originCampaignId: filters.originCampaignId } : {}),
          ...(filters.segmentId ? { company: { segmentId: filters.segmentId } } : {}),
        },
      };
    }

    const stageOrder: LeadStatus[] = [
      LeadStatus.NOVO,
      LeadStatus.EM_ANDAMENTO,
      LeadStatus.PAUSADO,
      LeadStatus.CANCELADO,
      LeadStatus.ENCERRADO,
    ];

    const groups = await prisma.lead.groupBy({
      by: ['status'],
      where,
      _count: { id: true },
    });

    const countMap = new Map<LeadStatus, number>(groups.map((g) => [g.status, g._count.id]));
    const total = groups.reduce((sum, g) => sum + g._count.id, 0);

    // Cadeia de conversão: NOVO → EM_ANDAMENTO → ENCERRADO.
    // PAUSADO e CANCELADO ficam fora da cadeia (equivalem ao antigo LOST).
    const conversionChain = stageOrder.filter(
      (s) => s !== LeadStatus.PAUSADO && s !== LeadStatus.CANCELADO,
    );
    const stages: FunnelConversionStage[] = stageOrder.map((stage) => {
      const count = countMap.get(stage) || 0;
      let conversionToNext: number | null = null;
      let dropOffRate: number | null = null;

      if (
        stage !== LeadStatus.PAUSADO &&
        stage !== LeadStatus.CANCELADO &&
        stage !== LeadStatus.ENCERRADO
      ) {
        const chainIdx = conversionChain.indexOf(stage);
        if (chainIdx >= 0 && chainIdx < conversionChain.length - 1) {
          const nextStage = conversionChain[chainIdx + 1];
          const nextCount = countMap.get(nextStage) || 0;
          conversionToNext = count > 0 ? Math.round((nextCount / count) * 1000) / 10 : 0;
          dropOffRate = count > 0 ? Math.round(((count - nextCount) / count) * 1000) / 10 : 0;
        }
      }

      return { stage, count, conversionToNext, dropOffRate };
    });

    return { stages, total };
  },
};
