import prisma from '../config/database.js';
import { DeepResearchStatus } from '@prisma/client';
import { createError } from '../middleware/errorHandler.js';
import { sanitizeMarkdown } from './deepResearch/sanitizeMarkdown.js';
import { deepResearchTemplateService } from './deepResearch/templateService.js';
import { buildPrompt } from './deepResearch/promptUtils.js';
import { getProvider } from './deepResearch/deepResearchProvider.js';
import { avaliarCompletude } from './deepResearch/completeness.js';
import { continuarRelatorio } from './deepResearch/continueReport.js';
import type { ResearchSource } from './deepResearch/providers/types.js';
import { logger } from '../utils/logger.js';

// Chave reservada em `variables` para o texto livre de enriquecimento do
// usuário — anexado ao prompt como contexto adicional, sem ser um placeholder.
export const CONTEXT_KEY = 'Contexto adicional';

export interface CreateDeepResearchData {
  title: string;
  templateId?: string;
  variables?: Record<string, string>;
  status?: DeepResearchStatus;
}

export interface UpdateDeepResearchData {
  title?: string;
  variables?: Record<string, string>;
  status?: DeepResearchStatus;
  reportMarkdown?: string;
}

/**
 * Remove o prompt montado (`promptUsed`) da resposta quando o solicitante não é
 * platform admin — o prompt é IP da plataforma e nunca chega ao usuário final.
 */
function toClientResearch<
  T extends {
    promptUsed?: string;
    providerResponseId?: string | null;
    providerError?: string | null;
  },
>(research: T, includePrompt: boolean) {
  if (includePrompt) return research;
  // Usuário comum não recebe o prompt nem detalhes técnicos do provider.
  const { promptUsed: _p, providerResponseId: _r, providerError: _e, ...rest } = research;
  return rest;
}

/** Monta o prompt final (server-side) a partir do template e dos valores. */
async function buildPromptForResearch(
  tenantId: string,
  templateId: string | null | undefined,
  variables: Record<string, string> | undefined
): Promise<string> {
  if (!templateId) return '';
  const tpl = await deepResearchTemplateService.getRaw(tenantId, templateId);
  const vars = variables || {};
  return buildPrompt(tpl.promptBody, vars, vars[CONTEXT_KEY]);
}

export const deepResearchService = {
  async create(
    tenantId: string,
    createdById: string | undefined,
    data: CreateDeepResearchData,
    includePrompt = false
  ) {
    const promptUsed = await buildPromptForResearch(tenantId, data.templateId, data.variables);
    const research = await prisma.deepResearch.create({
      data: {
        tenantId,
        createdById: createdById || null,
        title: data.title,
        templateId: data.templateId || null,
        promptUsed,
        variables: data.variables || {},
        status: data.status || DeepResearchStatus.DRAFT,
      },
    });

    if (research.status === DeepResearchStatus.RESEARCHING) {
      void this.maybeTrigger(tenantId, research.id);
    }

    return this.findById(tenantId, research.id, includePrompt);
  },

  async findById(tenantId: string, id: string, includePrompt = false) {
    const research = await prisma.deepResearch.findFirst({
      where: { id, tenantId },
      include: { template: { select: { id: true, name: true } } },
    });
    if (!research) {
      throw createError('Deep research not found', 404, 'DEEP_RESEARCH_NOT_FOUND');
    }
    return toClientResearch(research, includePrompt);
  },

  async findAll(
    tenantId: string,
    filters?: {
      status?: DeepResearchStatus;
      search?: string;
      page?: number;
      limit?: number;
    }
  ) {
    const page = filters?.page || 1;
    const limit = filters?.limit || 50;
    const skip = (page - 1) * limit;

    const where: any = { tenantId };
    if (filters?.status) where.status = filters.status;
    if (filters?.search) {
      where.title = { contains: filters.search, mode: 'insensitive' };
    }

    // A lista nunca traz promptUsed nem o promptBody do template.
    const [items, total] = await Promise.all([
      prisma.deepResearch.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          title: true,
          status: true,
          templateId: true,
          createdById: true,
          createdAt: true,
          updatedAt: true,
          template: { select: { id: true, name: true } },
        },
      }),
      prisma.deepResearch.count({ where }),
    ]);

    return {
      items,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  },

  async update(tenantId: string, id: string, data: UpdateDeepResearchData, includePrompt = false) {
    const current = await prisma.deepResearch.findFirst({
      where: { id, tenantId },
      select: { id: true, templateId: true },
    });
    if (!current) {
      throw createError('Deep research not found', 404, 'DEEP_RESEARCH_NOT_FOUND');
    }

    const updateData: any = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.status !== undefined) updateData.status = data.status;

    // Re-solicitar limpa o disparo anterior, permitindo nova tentativa (ex.: após
    // uma falha) — o maybeTrigger volta a disparar pois não há mais responseId.
    if (data.status === DeepResearchStatus.RESEARCHING) {
      updateData.providerResponseId = null;
      updateData.providerError = null;
    }
    if (data.variables !== undefined) {
      updateData.variables = data.variables;
      // Re-monta o prompt (server-side) com os novos valores.
      updateData.promptUsed = await buildPromptForResearch(
        tenantId,
        current.templateId,
        data.variables
      );
    }

    // Recebimento do resultado (apenas platform admin chega aqui — gate na rota).
    if (data.reportMarkdown !== undefined) {
      const { markdown, sources } = sanitizeMarkdown(data.reportMarkdown);
      updateData.reportMarkdown = markdown;
      updateData.reportMeta = {
        sources,
        charCount: markdown.length,
        generatedAt: new Date().toISOString(),
      };
      if (markdown.trim() && data.status === undefined) {
        updateData.status = DeepResearchStatus.COMPLETED;
      }
    }

    await prisma.deepResearch.update({ where: { id }, data: updateData });

    if (updateData.status === DeepResearchStatus.RESEARCHING) {
      void this.maybeTrigger(tenantId, id);
    }

    return this.findById(tenantId, id, includePrompt);
  },

  /**
   * Dispara a OpenAI Deep Research API (background) quando habilitada. Idempotente:
   * só dispara se a pesquisa está RESEARCHING, tem prompt e ainda não tem response.
   * Fire-and-forget — falhas marcam a pesquisa como FAILED.
   */
  async maybeTrigger(tenantId: string, id: string) {
    const provider = getProvider();
    if (!provider) {
      // API ligada mas sem provider utilizável (ex.: falta a chave no servidor) →
      // não deixa a pesquisa presa em "Pesquisando": marca FAILED com mensagem
      // clara, permitindo re-solicitar. Se a API está desligada (fluxo manual do
      // admin), não mexe no status — RESEARCHING aguarda o processamento manual.
      if (process.env.ENABLE_DEEP_RESEARCH_API === 'true') {
        await prisma.deepResearch
          .updateMany({
            where: { id, tenantId, status: DeepResearchStatus.RESEARCHING },
            data: {
              status: DeepResearchStatus.FAILED,
              providerError:
                'Motor de pesquisa não configurado no servidor (verifique a chave do provedor, ex.: OPENROUTER_API_KEY).',
            },
          })
          .catch(() => {});
      }
      return;
    }
    try {
      const r = await prisma.deepResearch.findFirst({
        where: { id, tenantId },
        select: { id: true, status: true, promptUsed: true, providerResponseId: true },
      });
      if (!r || r.status !== DeepResearchStatus.RESEARCHING) return;
      if (r.providerResponseId || !r.promptUsed?.trim()) return;

      if (provider.isAsync) {
        // Dispara em background; o poller acompanha via providerResponseId.
        const jobId = await provider.start!(r.promptUsed);
        await prisma.deepResearch.update({
          where: { id },
          data: { providerResponseId: jobId, requestedAt: new Date(), providerError: null },
        });
      } else {
        // Síncrono (streaming): marca requestedAt e processa em background.
        await prisma.deepResearch.update({
          where: { id },
          data: { requestedAt: new Date(), providerError: null },
        });
        provider.run!(r.promptUsed)
          .then((result) => this.applyProviderResult(id, result))
          .catch((err) =>
            this.applyProviderResult(id, { failed: true, error: String(err?.message || err) })
          );
      }
    } catch (err: any) {
      logger.error('Falha ao iniciar Deep Research', err);
      await prisma.deepResearch
        .update({
          where: { id },
          data: { status: DeepResearchStatus.FAILED, providerError: String(err?.message || err) },
        })
        .catch(() => {});
    }
  },

  /** Aplica o resultado vindo do provider (markdown concluído ou falha). */
  async applyProviderResult(
    id: string,
    result: {
      markdown?: string;
      sources?: string[];
      searchResults?: ResearchSource[];
      failed?: boolean;
      error?: string;
      /** Provedor parou por limite de saída — o texto está cortado. */
      truncated?: boolean;
      finishReason?: string;
    }
  ) {
    if (result.failed) {
      await prisma.deepResearch.update({
        where: { id },
        data: {
          status: DeepResearchStatus.FAILED,
          providerError: result.error || 'Falha ao gerar a pesquisa.',
        },
      });
      return;
    }
    const cleaned = sanitizeMarkdown(result.markdown || '');
    const sources = result.sources?.length ? result.sources : cleaned.sources;

    // O `finish_reason` do provedor NÃO basta: num teste real o motor entregou 8
    // dos 10 capítulos pedidos, cortado no meio da frase, e mesmo assim reportou
    // `stop`. Conferimos a cobertura contra o outline do prompt.
    const atual = await prisma.deepResearch.findUnique({
      where: { id },
      select: { promptUsed: true },
    });
    const promptOriginal = atual?.promptUsed || '';
    let markdownFinal = cleaned.markdown;
    let searchResultsFinal = result.searchResults || [];
    let sourcesFinal = sources;
    let completude = avaliarCompletude(promptOriginal, markdownFinal);
    let continuacoes = 0;

    // Incompleto → tenta COMPLETAR antes de gravar, pedindo ao motor apenas as
    // seções que faltam. Só quando há prompt para comparar (sem outline não há
    // o que cobrar) e provider síncrono disponível.
    const provider = getProvider();
    if (completude.incompleto && promptOriginal.trim() && provider) {
      const cont = await continuarRelatorio(
        provider,
        promptOriginal,
        markdownFinal,
        searchResultsFinal,
        sourcesFinal
      );
      if (cont.continuacoes > 0) {
        const limpo = sanitizeMarkdown(cont.markdown);
        markdownFinal = limpo.markdown;
        searchResultsFinal = cont.searchResults;
        sourcesFinal = cont.sources.length ? cont.sources : limpo.sources;
        completude = avaliarCompletude(promptOriginal, markdownFinal);
        continuacoes = cont.continuacoes;
        logger.info('Deep Research — continuação aplicada', {
          id,
          continuacoes,
          charsAntes: cleaned.markdown.length,
          charsDepois: markdownFinal.length,
          aindaFaltando: completude.faltando,
        });
      }
    }

    const incompleto = completude.incompleto;
    if (incompleto) {
      logger.warn('Deep Research INCOMPLETO (após continuação)', {
        id,
        truncadoPeloProvedor: result.truncated === true,
        finishReason: result.finishReason,
        secoesFaltando: completude.faltando,
        fraseIncompleta: completude.fraseIncompleta,
        continuacoes,
      });
    }
    await prisma.deepResearch.update({
      where: { id },
      data: {
        reportMarkdown: markdownFinal,
        reportMeta: {
          sources: sourcesFinal,
          searchResults: searchResultsFinal,
          charCount: markdownFinal.length,
          generatedAt: new Date().toISOString(),
          // Relatório cortado. Fica no meta (e não em providerError) porque NÃO é
          // falha: o conteúdo recebido é válido — só está incompleto, e a tela
          // avisa em vez de fingir que está pronto.
          //
          // `truncated` é a UNIÃO de duas evidências: o provedor admitir o corte
          // (finish_reason=length) OU a cobertura do outline denunciar. A segunda
          // é a que pega o caso real, em que o provedor diz `stop` e ainda assim
          // faltam capítulos.
          truncated: incompleto,
          ...(result.finishReason ? { finishReason: result.finishReason } : {}),
          ...(completude.faltando.length
            ? { missingSections: completude.faltando }
            : {}),
          ...(continuacoes > 0 ? { continuations: continuacoes } : {}),
        } as any,
        status: DeepResearchStatus.COMPLETED,
        providerError: null,
      },
    });
  },

  async delete(tenantId: string, id: string) {
    const existing = await prisma.deepResearch.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!existing) {
      throw createError('Deep research not found', 404, 'DEEP_RESEARCH_NOT_FOUND');
    }
    await prisma.deepResearch.delete({ where: { id } });
  },
};
