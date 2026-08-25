import prisma from '../config/database.js';
import { DeepResearchStatus } from '@prisma/client';
import { logger } from '../utils/logger.js';
import { getProvider } from '../services/deepResearch/deepResearchProvider.js';
import { deepResearchService } from '../services/deepResearchService.js';

/**
 * Poller do Deep Research. Para provedores assíncronos (OpenAI/Perplexity),
 * acompanha os jobs em andamento e publica o resultado. Também faz a limpeza de
 * pesquisas travadas (run síncrono que morreu num restart do servidor). Job leve
 * (setInterval, sem Redis), no padrão do taskNotificationChecker.
 */

const POLL_INTERVAL_MS = process.env.DEEP_RESEARCH_POLL_INTERVAL_MS
  ? parseInt(process.env.DEEP_RESEARCH_POLL_INTERVAL_MS)
  : 30 * 1000; // 30s

const STALE_AFTER_MS = 20 * 60 * 1000; // 20 min sem concluir → falha

async function pollPending() {
  const provider = getProvider();
  if (!provider) return;
  try {
    // 1) Acompanha jobs assíncronos (providerResponseId presente).
    if (provider.isAsync && provider.poll) {
      const pending = await prisma.deepResearch.findMany({
        where: {
          status: DeepResearchStatus.RESEARCHING,
          providerResponseId: { not: null },
        },
        select: { id: true, providerResponseId: true },
        take: 20,
      });

      for (const r of pending) {
        try {
          const result = await provider.poll(r.providerResponseId!);
          if (result.status === 'completed') {
            await deepResearchService.applyProviderResult(r.id, {
              markdown: result.markdown,
              sources: result.sources,
              searchResults: result.searchResults,
              // Repassado explicitamente: este caminho monta o objeto campo a
              // campo, então um campo novo do provider some se não vier aqui.
              truncated: result.truncated,
              finishReason: result.finishReason,
            });
            logger.info('Deep Research concluído', { id: r.id });
          } else if (result.status === 'failed') {
            await deepResearchService.applyProviderResult(r.id, {
              failed: true,
              error: result.error,
            });
            logger.warn('Deep Research falhou', { id: r.id, error: result.error });
          }
          // pending → aguarda o próximo ciclo
        } catch (err) {
          logger.error('Erro ao consultar Deep Research', err as Error);
        }
      }
    }

    // 2) Limpeza de travados: RESEARCHING há muito tempo sem job assíncrono — run
    //    síncrono interrompido por restart, OU disparo que nunca ocorreu (provider
    //    indisponível quando foi solicitada). Cobre requestedAt antigo OU nulo
    //    (nunca disparou). Só roda com provider ativo, então não afeta o fluxo
    //    manual (API desligada, em que RESEARCHING aguarda o admin).
    const cutoff = new Date(Date.now() - STALE_AFTER_MS);
    const stale = await prisma.deepResearch.updateMany({
      where: {
        status: DeepResearchStatus.RESEARCHING,
        providerResponseId: null,
        OR: [{ requestedAt: { lt: cutoff } }, { requestedAt: null, createdAt: { lt: cutoff } }],
      },
      data: {
        status: DeepResearchStatus.FAILED,
        providerError: 'Tempo limite excedido ao gerar a pesquisa. Tente novamente.',
      },
    });
    if (stale.count > 0) {
      logger.warn(`Deep Research: ${stale.count} pesquisa(s) travada(s) marcada(s) como FAILED`);
    }
  } catch (error) {
    logger.error('Deep Research poller falhou', error as Error);
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function initializeDeepResearchPoller() {
  pollPending();
  intervalId = setInterval(pollPending, POLL_INTERVAL_MS);
  logger.info(`Deep Research poller initialized (interval: ${POLL_INTERVAL_MS}ms)`);
}

export function stopDeepResearchPoller() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
