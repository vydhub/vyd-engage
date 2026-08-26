// Configuração do módulo de Parceiros Comerciais por tenant (ParceiroConfig, 1:1
// com o tenant). Defaults vêm do schema; get() cria on-demand via upsert.

import prisma from '../../config/database.js';
import { createError } from '../../middleware/errorHandler.js';

export interface ParceiroConfigInput {
  protecaoDiasPadrao?: number;
  updateCadenciaDias?: number;
  avisoExpiracaoDias?: number;
  splitOriginadorPadrao?: number;
  reuniaoCadenciaDias?: number;
  scorePesos?: {
    novasOportunidades: number;
    updatesCumpridos: number;
    presencaReunioes: number;
    progressaoPipeline: number;
  };
  scoreLimiares?: { saudavel: number; atencao: number; esfriando: number };
  decaimentoPontosPorDia?: number;
  decaimentoMaxPontos?: number;
  quedaLimiarPontos?: number;
  conflitoInternoUserId?: string | null;
}

export const parceiroConfigService = {
  /** Retorna a config do tenant; se não existir, cria com os defaults do schema. */
  async get(tenantId: string) {
    return prisma.parceiroConfig.upsert({
      where: { tenantId },
      create: { tenantId },
      update: {},
    });
  },

  async update(tenantId: string, data: ParceiroConfigInput) {
    // (a) Pesos do score: 4 pesos numéricos >= 0 que somam 100.
    if (data.scorePesos !== undefined) {
      const pesos = data.scorePesos;
      const valores = [
        pesos.novasOportunidades,
        pesos.updatesCumpridos,
        pesos.presencaReunioes,
        pesos.progressaoPipeline,
      ];
      if (valores.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0)) {
        throw createError(
          'Pesos do score inválidos: cada um dos quatro pesos deve ser um número maior ou igual a zero',
          400,
          'VALIDATION_ERROR'
        );
      }
      const soma = valores.reduce((acc, v) => acc + v, 0);
      if (Math.abs(soma - 100) > 1e-9) {
        throw createError(
          'Pesos do score inválidos: a soma dos quatro pesos deve ser exatamente 100',
          400,
          'VALIDATION_ERROR'
        );
      }
    }

    // (b) Limiares das faixas: saudavel > atencao > esfriando > 0.
    if (data.scoreLimiares !== undefined) {
      const { saudavel, atencao, esfriando } = data.scoreLimiares;
      if ([saudavel, atencao, esfriando].some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
        throw createError(
          'Limiares do score inválidos: saudável, atenção e esfriando devem ser números',
          400,
          'VALIDATION_ERROR'
        );
      }
      if (!(saudavel > atencao && atencao > esfriando && esfriando > 0)) {
        throw createError(
          'Limiares do score inválidos: é necessário saudável > atenção > esfriando > 0',
          400,
          'VALIDATION_ERROR'
        );
      }
    }

    // (c) Usuário de resolução de conflitos internos: deve existir no tenant com
    // papel ADMIN ou GESTOR.
    if (data.conflitoInternoUserId !== undefined && data.conflitoInternoUserId !== null) {
      const user = await prisma.user.findFirst({
        where: { id: data.conflitoInternoUserId, tenantId, role: { in: ['ADMIN', 'GESTOR'] } },
        select: { id: true },
      });
      if (!user) {
        throw createError(
          'Usuário não encontrado no tenant com papel ADMIN ou GESTOR',
          404,
          'USER_NOT_FOUND'
        );
      }
    }

    const fields = {
      ...(data.protecaoDiasPadrao !== undefined ? { protecaoDiasPadrao: data.protecaoDiasPadrao } : {}),
      ...(data.updateCadenciaDias !== undefined ? { updateCadenciaDias: data.updateCadenciaDias } : {}),
      ...(data.avisoExpiracaoDias !== undefined ? { avisoExpiracaoDias: data.avisoExpiracaoDias } : {}),
      ...(data.splitOriginadorPadrao !== undefined
        ? { splitOriginadorPadrao: data.splitOriginadorPadrao }
        : {}),
      ...(data.reuniaoCadenciaDias !== undefined ? { reuniaoCadenciaDias: data.reuniaoCadenciaDias } : {}),
      ...(data.scorePesos !== undefined ? { scorePesos: { ...data.scorePesos } } : {}),
      ...(data.scoreLimiares !== undefined ? { scoreLimiares: { ...data.scoreLimiares } } : {}),
      ...(data.decaimentoPontosPorDia !== undefined
        ? { decaimentoPontosPorDia: data.decaimentoPontosPorDia }
        : {}),
      ...(data.decaimentoMaxPontos !== undefined ? { decaimentoMaxPontos: data.decaimentoMaxPontos } : {}),
      ...(data.quedaLimiarPontos !== undefined ? { quedaLimiarPontos: data.quedaLimiarPontos } : {}),
      ...(data.conflitoInternoUserId !== undefined
        ? { conflitoInternoUserId: data.conflitoInternoUserId }
        : {}),
    };

    return prisma.parceiroConfig.upsert({
      where: { tenantId },
      create: { tenantId, ...fields },
      update: fields,
    });
  },
};
