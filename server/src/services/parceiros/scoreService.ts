// Score de saúde do consultor (reqs 23-26) — 4 sinais + decaimento por recência.
// Sinais (janela móvel de 90 dias, pesos configuráveis pelo admin):
//   (a) novasOportunidades — registros trazidos vs. expectativa (1/mês)
//   (b) updatesCumpridos  — cumprimento de updates: combina o ESTADO atual
//       (registros aprovados sem update em atraso) com o VOLUME de updates
//       ("prova de trabalho") postados na janela — assim o histórico de
//       cumprimento não desaparece no instante em que o consultor posta um update.
//   (c) presencaReunioes  — presenças / reuniões realizadas
//   (d) progressaoPipeline — progressão REAL do pipeline: registros que
//       avançaram para APROVADO/GANHO na janela (proxy melhor que "atividade
//       genérica nos 30d", que só media qualquer toque no registro).
// Decaimento: pontos descontados por dia sem atividade (até um teto) — parado esfria.
// Faixas por limiares configuráveis; alerta por MUDANÇA DE FAIXA para pior
// (tendência), não só nível baixo (req 26).

import prisma from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { parceiroConfigService } from './configService.js';
import type { ScoreFaixa } from '@prisma/client';

const JANELA_DIAS = 90;

interface Pesos {
  novasOportunidades: number;
  updatesCumpridos: number;
  presencaReunioes: number;
  progressaoPipeline: number;
}
interface Limiares {
  saudavel: number;
  atencao: number;
  esfriando: number;
}

function faixaFor(score: number, limiares: Limiares): ScoreFaixa {
  if (score >= limiares.saudavel) return 'SAUDAVEL';
  if (score >= limiares.atencao) return 'ATENCAO';
  if (score >= limiares.esfriando) return 'ESFRIANDO';
  return 'FRIO';
}

const FAIXA_ORDEM: Record<ScoreFaixa, number> = { SAUDAVEL: 3, ATENCAO: 2, ESFRIANDO: 1, FRIO: 0 };

export interface ScoreResult {
  consultorId: string;
  score: number;
  /** Score persistido no consultor ANTES deste cálculo (null se ainda não havia). */
  scoreAnterior: number | null;
  faixa: ScoreFaixa;
  diasSemAtividade: number | null;
  sinais: {
    novasOportunidades: number;
    updatesCumpridos: number;
    presencaReunioes: number;
    progressaoPipeline: number;
    decaimento: number;
  };
  faixaAnterior: ScoreFaixa | null;
  pioroou: boolean;
}

export const scoreService = {
  /** Calcula (e persiste) o score de um consultor. Retorna o resultado + tendência. */
  async computeConsultor(tenantId: string, consultorId: string): Promise<ScoreResult | null> {
    const consultor = await prisma.consultor.findFirst({
      where: { id: consultorId, tenantId, deletedAt: null },
    });
    if (!consultor) return null;

    const config = await parceiroConfigService.get(tenantId);
    const pesos = config.scorePesos as unknown as Pesos;
    const limiares = config.scoreLimiares as unknown as Limiares;
    const now = new Date();
    const janelaInicio = new Date(now.getTime() - JANELA_DIAS * 24 * 60 * 60 * 1000);

    // (a) Novas oportunidades na janela (expectativa: 1/mês → 3 na janela = 100%).
    const novas = await prisma.registroOportunidade.count({
      where: { tenantId, consultorId, deletedAt: null, createdAt: { gte: janelaInicio } },
    });
    const sinalNovas = Math.min(novas / 3, 1);

    // (b) Updates cumpridos: combina ESTADO atual + VOLUME histórico.
    //  - estado: fração dos registros APROVADOS sem update em atraso (foto do agora);
    //  - volume: updates ("prova de trabalho") postados na janela vs. a expectativa
    //    de cadência dos registros aprovados. Sem esse termo, o histórico de
    //    atraso "some" no instante em que o consultor posta um update (o estado
    //    zera o débito). Ponderamos estado 60% / volume 40%.
    const aprovados = await prisma.registroOportunidade.findMany({
      where: { tenantId, consultorId, deletedAt: null, status: 'APROVADO' },
      select: { proximoUpdateEm: true },
    });
    const estadoUpdates =
      aprovados.length === 0
        ? 1 // sem obrigação pendente = não penaliza
        : aprovados.filter((r) => !r.proximoUpdateEm || r.proximoUpdateEm >= now).length / aprovados.length;

    // Volume: updates postados na janela. Expectativa ~= 1 update/mês por registro
    // aprovado (3 na janela de 90d). Sem registros aprovados, não há expectativa
    // (volume neutro = 1). Saturado em 1 (mais que o esperado não bonifica além).
    const updatesNaJanela = await prisma.registroUpdate.count({
      where: { tenantId, registro: { consultorId }, createdAt: { gte: janelaInicio } },
    });
    const volumeUpdates =
      aprovados.length === 0 ? 1 : Math.min(updatesNaJanela / (aprovados.length * 3), 1);

    const sinalUpdates = estadoUpdates * 0.6 + volumeUpdates * 0.4;

    // (c) Presença nas reuniões REALIZADAS na janela.
    const reunioes = await prisma.consultorReuniao.findMany({
      where: { tenantId, consultorId, status: 'REALIZADA', dataHora: { gte: janelaInicio } },
      select: { presenca: true },
    });
    const comPresenca = reunioes.filter((r) => r.presenca !== null);
    const sinalPresenca =
      comPresenca.length === 0 ? 1 : comPresenca.filter((r) => r.presenca === 'PRESENTE').length / comPresenca.length;

    // (d) Progressão do pipeline: fração dos registros do consultor que EVOLUÍRAM
    // para um estágio de avanço (APROVADO ou GANHO) dentro da janela, sobre os
    // registros ativos+ganhos da janela. É um proxy declaradamente melhor que
    // "qualquer atividade nos 30d" (a métrica antiga media só toques no registro,
    // não avanço real). Não há histórico de estágio confiável, então usamos o
    // status ATUAL + updatedAt como marcador de "chegou a esse estágio na janela".
    const denominadorProg = await prisma.registroOportunidade.count({
      where: {
        tenantId,
        consultorId,
        deletedAt: null,
        status: { in: ['SUBMETIDO', 'EM_ANALISE', 'APROVADO', 'GANHO'] },
        createdAt: { gte: janelaInicio },
      },
    });
    const avancaram = await prisma.registroOportunidade.count({
      where: {
        tenantId,
        consultorId,
        deletedAt: null,
        status: { in: ['APROVADO', 'GANHO'] },
        updatedAt: { gte: janelaInicio },
      },
    });
    const sinalProgressao = denominadorProg === 0 ? 1 : Math.min(avancaram / denominadorProg, 1);

    // Score ponderado (0-100) + decaimento por inatividade.
    const bruto =
      sinalNovas * pesos.novasOportunidades +
      sinalUpdates * pesos.updatesCumpridos +
      sinalPresenca * pesos.presencaReunioes +
      sinalProgressao * pesos.progressaoPipeline;

    const diasSemAtividade = consultor.ultimaAtividadeEm
      ? Math.floor((now.getTime() - consultor.ultimaAtividadeEm.getTime()) / (24 * 60 * 60 * 1000))
      : null;
    const decaimento =
      diasSemAtividade === null
        ? 0
        : Math.min(diasSemAtividade * config.decaimentoPontosPorDia, config.decaimentoMaxPontos);

    const score = Math.max(0, Math.round((bruto - decaimento) * 10) / 10);
    const faixa = faixaFor(score, limiares);
    const faixaAnterior = consultor.scoreFaixa;
    // Score persistido ANTES deste recálculo — o job usa (score − scoreAnterior)
    // para comparar com ParceiroConfig.quedaLimiarPontos no alerta de tendência.
    const scoreAnterior = consultor.score;
    const pioroou = faixaAnterior !== null && FAIXA_ORDEM[faixa] < FAIXA_ORDEM[faixaAnterior];

    await prisma.consultor.update({ where: { id: consultorId }, data: { score, scoreFaixa: faixa } });
    await prisma.consultorScoreSnapshot
      .create({
        data: {
          tenantId,
          consultorId,
          score,
          faixa,
          sinais: {
            novasOportunidades: Math.round(sinalNovas * 100),
            updatesCumpridos: Math.round(sinalUpdates * 100),
            presencaReunioes: Math.round(sinalPresenca * 100),
            progressaoPipeline: Math.round(sinalProgressao * 100),
            decaimento,
            diasSemAtividade,
          },
        },
      })
      .catch((err) => logger.error('Falha ao gravar snapshot de score', err));

    return {
      consultorId,
      score,
      scoreAnterior,
      faixa,
      diasSemAtividade,
      sinais: {
        novasOportunidades: Math.round(sinalNovas * 100),
        updatesCumpridos: Math.round(sinalUpdates * 100),
        presencaReunioes: Math.round(sinalPresenca * 100),
        progressaoPipeline: Math.round(sinalProgressao * 100),
        decaimento,
      },
      faixaAnterior,
      pioroou,
    };
  },

  /** Calcula todos os consultores ATIVOS do tenant (usado pelo job). */
  async computeTenant(tenantId: string): Promise<ScoreResult[]> {
    const consultores = await prisma.consultor.findMany({
      where: { tenantId, deletedAt: null, status: 'ATIVO' },
      select: { id: true },
    });
    const out: ScoreResult[] = [];
    for (const c of consultores) {
      try {
        const r = await this.computeConsultor(tenantId, c.id);
        if (r) out.push(r);
      } catch (err) {
        logger.error(`Falha ao calcular score do consultor ${c.id}`, err as Error);
      }
    }
    return out;
  },

  /** Histórico de snapshots (para gráfico/tendência no painel). */
  async history(tenantId: string, consultorId: string, dias = 180) {
    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
    return prisma.consultorScoreSnapshot.findMany({
      where: { tenantId, consultorId, data: { gte: desde } },
      orderBy: { data: 'asc' },
    });
  },
};
