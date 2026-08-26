// Metas por consultor (ConsultorMeta) + acompanhamento de meta vs. realizado
// a partir dos Registros de Oportunidade do período.

import prisma from '../../config/database.js';
import { createError } from '../../middleware/errorHandler.js';

export interface MetaData {
  consultorId: string;
  month: number; // 1-12
  year: number;
  alvoRegistros?: number;
  alvoPipeline?: number;
  alvoGanho?: number;
}

export const metaService = {
  async list(tenantId: string, consultorId?: string) {
    return prisma.consultorMeta.findMany({
      where: {
        tenantId,
        ...(consultorId ? { consultorId } : {}),
      },
      include: { consultor: { select: { id: true, nome: true } } },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  },

  async upsert(tenantId: string, data: MetaData) {
    if (!Number.isInteger(data.month) || data.month < 1 || data.month > 12) {
      throw createError('Mês inválido (use 1-12)', 400, 'VALIDATION_ERROR');
    }

    const consultor = await prisma.consultor.findFirst({
      where: { id: data.consultorId, tenantId, deletedAt: null },
    });
    if (!consultor) throw createError('Consultor não encontrado', 404, 'CONSULTOR_NOT_FOUND');

    return prisma.consultorMeta.upsert({
      where: {
        tenantId_consultorId_month_year: {
          tenantId,
          consultorId: data.consultorId,
          month: data.month,
          year: data.year,
        },
      },
      create: {
        tenantId,
        consultorId: data.consultorId,
        month: data.month,
        year: data.year,
        alvoRegistros: data.alvoRegistros ?? 0,
        alvoPipeline: data.alvoPipeline ?? 0,
        alvoGanho: data.alvoGanho ?? 0,
      },
      update: {
        ...(data.alvoRegistros !== undefined ? { alvoRegistros: data.alvoRegistros } : {}),
        ...(data.alvoPipeline !== undefined ? { alvoPipeline: data.alvoPipeline } : {}),
        ...(data.alvoGanho !== undefined ? { alvoGanho: data.alvoGanho } : {}),
      },
      include: { consultor: { select: { id: true, nome: true } } },
    });
  },

  async remove(tenantId: string, id: string) {
    const existing = await prisma.consultorMeta.findFirst({ where: { id, tenantId } });
    if (!existing) throw createError('Meta não encontrada', 404, 'META_NOT_FOUND');
    await prisma.consultorMeta.delete({ where: { id } });
    return { id };
  },

  /** Meta vs. realizado do consultor no mês/ano informados. */
  async progress(tenantId: string, consultorId: string, month: number, year: number) {
    const inicio = new Date(year, month - 1, 1);
    const fim = new Date(year, month, 1); // exclusivo

    const [registros, pipelineAgg, ganhoAgg, meta] = await Promise.all([
      // (a) nº de oportunidades registradas no período
      prisma.registroOportunidade.count({
        where: { tenantId, consultorId, deletedAt: null, createdAt: { gte: inicio, lt: fim } },
      }),
      // (b) valor de pipeline: registros criados no período em status "vivos"/ganhos
      prisma.registroOportunidade.aggregate({
        where: {
          tenantId,
          consultorId,
          deletedAt: null,
          createdAt: { gte: inicio, lt: fim },
          status: { in: ['SUBMETIDO', 'EM_ANALISE', 'APROVADO', 'GANHO'] },
        },
        _sum: { valorEstimado: true },
      }),
      // (c) valor ganho: contratos com ganho dentro do período
      prisma.registroOportunidade.aggregate({
        where: {
          tenantId,
          consultorId,
          deletedAt: null,
          status: 'GANHO',
          ganhoEm: { gte: inicio, lt: fim },
        },
        _sum: { valorContrato: true },
      }),
      prisma.consultorMeta.findUnique({
        where: { tenantId_consultorId_month_year: { tenantId, consultorId, month, year } },
      }),
    ]);

    const pipeline = Number(pipelineAgg._sum.valorEstimado) || 0;
    const ganho = Number(ganhoAgg._sum.valorContrato) || 0;

    const alvoRegistros = meta ? meta.alvoRegistros : 0;
    const alvoPipeline = meta ? Number(meta.alvoPipeline) : 0;
    const alvoGanho = meta ? Number(meta.alvoGanho) : 0;

    const pct = (real: number, alvo: number) => (alvo > 0 ? Math.round((real / alvo) * 100) : null);

    return {
      meta: { alvoRegistros, alvoPipeline, alvoGanho },
      realizado: { registros, pipeline, ganho },
      pct: {
        registros: pct(registros, alvoRegistros),
        pipeline: pct(pipeline, alvoPipeline),
        ganho: pct(ganho, alvoGanho),
      },
    };
  },
};
