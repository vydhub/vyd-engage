// Provider OpenRouter. Síncrono via streaming (mantém a conexão aberta durante a
// pesquisa de minutos, evitando timeout). Acessa perplexity/sonar-deep-research
// (e outros) com a chave OpenRouter — sem verificação de organização.
import { logger } from '../../../utils/logger.js';
import type { ProviderResult, ResearchProvider, ResearchSource } from './types.js';

const OR_BASE = 'https://openrouter.ai/api/v1';

function model(): string {
  return process.env.OPENROUTER_DEEP_RESEARCH_MODEL || 'perplexity/sonar-deep-research';
}

function apiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY ausente');
  return key;
}

/**
 * Teto de tokens de SAÍDA por relatório.
 *
 * Sem `max_tokens` explícito, o OpenRouter aplica o default do modelo — e era
 * baixo demais para um relatório de inteligência de mercado: as respostas
 * paravam no meio da frase por volta de 65-100k caracteres. O default subiu de
 * 32k para 48k tokens quando o template de Segmento foi expandido para 11
 * capítulos (histórico de preços, censo de empresas, matriz de screening…) —
 * folga para o relatório inteiro (~180k caracteres) sem virar cheque em branco.
 *
 * Ajustável por env sem deploy: OPENROUTER_MAX_OUTPUT_TOKENS. Se o modelo
 * configurado aceitar menos que o pedido, o provedor corta para o máximo dele —
 * por isso o truncamento continua sendo DETECTADO (finish_reason), não presumido
 * como resolvido.
 */
function maxOutputTokens(): number {
  const raw = parseInt(process.env.OPENROUTER_MAX_OUTPUT_TOKENS || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 48000;
}

/**
 * Parseia um chunk SSE da OpenRouter, acumulando conteúdo e fontes. As fontes
 * chegam em dois formatos possíveis e são ACUMULADAS (dedup por url):
 * - OpenRouter/OpenAI: `annotations[].url_citation` — chegam 1 por chunk em
 *   `delta.annotations` no stream (também aceitamos `message.annotations`/top-level).
 * - Perplexity direto: `search_results[]` (title/url/date) — vem completo num chunk.
 */
export function applyChunk(
  json: any,
  acc: {
    markdown: string;
    citations: string[];
    searchResults: ResearchSource[];
    finishReason?: string;
  }
): void {
  const choice = json?.choices?.[0];
  const delta = choice?.delta;
  if (typeof delta?.content === 'string') acc.markdown += delta.content;
  if (Array.isArray(json?.citations)) acc.citations = json.citations;

  // O motivo da parada só chega no ÚLTIMO chunk (nos anteriores vem null), e é
  // o único jeito de saber que o texto foi cortado por limite ('length') em vez
  // de ter terminado ('stop'). Sem isto o relatório vinha decapitado e era
  // gravado como COMPLETED.
  const fr = choice?.finish_reason ?? choice?.finishReason;
  if (typeof fr === 'string' && fr) acc.finishReason = fr;

  const annotations = delta?.annotations || choice?.message?.annotations || json?.annotations;
  const fromAnnotations: ResearchSource[] = Array.isArray(annotations)
    ? annotations
        .map((a: any) => a?.url_citation || a)
        .filter((u: any) => u?.url)
        .map((u: any) => ({ title: u.title, url: u.url, date: u.date }))
    : [];

  const sr = json?.search_results || choice?.message?.search_results;
  const fromSearch: ResearchSource[] = Array.isArray(sr)
    ? sr
        .map((s: any) => ({ title: s?.title, url: s?.url, date: s?.date }))
        .filter((s: ResearchSource) => !!s.url)
    : [];

  for (const src of [...fromAnnotations, ...fromSearch]) {
    if (!acc.searchResults.some((e) => e.url === src.url)) acc.searchResults.push(src);
  }
}

export const openrouterProvider: ResearchProvider = {
  name: 'openrouter',
  isAsync: false,

  enabled() {
    return !!process.env.OPENROUTER_API_KEY;
  },

  async run(prompt: string): Promise<ProviderResult> {
    const res = await fetch(`${OR_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.FRONTEND_URL || 'https://engage.vydhub.com',
        'X-Title': 'VYD Engage - Inteligencia de Mercado',
      },
      body: JSON.stringify({
        model: model(),
        messages: [{ role: 'user', content: prompt }],
        stream: true,
        max_tokens: maxOutputTokens(),
      }),
    });

    if (!res.ok || !res.body) {
      const b = await res.text().catch(() => '');
      return { status: 'failed', error: `OpenRouter ${res.status}: ${b.slice(0, 300)}` };
    }

    const acc = {
      markdown: '',
      citations: [] as string[],
      searchResults: [] as ResearchSource[],
      finishReason: undefined as string | undefined,
    };
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          applyChunk(JSON.parse(payload), acc);
        } catch {
          /* chunk parcial — ignora */
        }
      }
    }

    const markdown = acc.markdown.trim();
    if (!markdown) return { status: 'failed', error: 'OpenRouter retornou conteúdo vazio.' };
    const sources = acc.searchResults.length ? acc.searchResults.map((s) => s.url) : acc.citations;
    const truncated = acc.finishReason === 'length';

    // Truncado NÃO é falha: o conteúdo recebido é válido e vale mais que nada.
    // Entregamos o relatório e sinalizamos — quem consome decide o que mostrar.
    logger[truncated ? 'warn' : 'info'](
      truncated
        ? 'Deep Research TRUNCADO por limite de saída (openrouter)'
        : 'Deep Research concluído (openrouter)',
      {
        chars: markdown.length,
        fontes: sources.length,
        finishReason: acc.finishReason ?? 'desconhecido',
        maxTokens: maxOutputTokens(),
      }
    );
    return {
      status: 'completed',
      markdown,
      sources: Array.from(new Set(sources)),
      searchResults: acc.searchResults,
      truncated,
      finishReason: acc.finishReason,
    };
  },
};
