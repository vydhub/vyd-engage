import { logger } from '../../utils/logger.js';
import { avaliarCompletude, type Completude } from './completeness.js';
import type { ResearchProvider, ResearchSource } from './providers/types.js';

/**
 * Continuação automática de relatório incompleto.
 *
 * O motor para antes de cobrir o roteiro inteiro e ainda reporta
 * `finish_reason: "stop"` — medido: 8 de 10 capítulos, cortado em "…segurança e
 * integridade,". Aumentar `max_tokens` não resolve (a resposta parou bem abaixo
 * do teto), então a saída é pedir a continuação e emendar.
 *
 * Regras que existem para isto não virar um cano de dinheiro:
 *  - teto de tentativas (DEEP_RESEARCH_MAX_CONTINUATIONS, default 3 — elevado
 *    de 2 quando o template de Segmento foi expandido para 11 capítulos);
 *  - PARA no primeiro ciclo que não fizer progresso — se o modelo devolve algo
 *    que não cobre nenhuma seção nova, insistir só queima crédito;
 *  - a cada rodada pede APENAS as seções que ainda faltam, e não o relatório
 *    todo de novo;
 *  - só reenvia a CAUDA do texto como contexto (não os 88k caracteres), o que
 *    mantém o custo de entrada baixo.
 */

/** Quanto do texto já escrito volta como contexto de continuidade. */
const CAUDA_CONTEXTO = 1500;

function maxTentativas(): number {
  const raw = parseInt(process.env.DEEP_RESEARCH_MAX_CONTINUATIONS || '', 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : 3;
}

/**
 * Prompt de continuação: contexto mínimo + o que falta.
 *
 * Pede explicitamente para NÃO repetir o que já existe (senão o relatório final
 * ganha capítulos duplicados) e para emendar a frase interrompida, já que o
 * corte costuma cair no meio de uma.
 */
export function montarPromptContinuacao(
  promptOriginal: string,
  markdownAteAgora: string,
  faltando: string[]
): string {
  const cauda = markdownAteAgora.trimEnd().slice(-CAUDA_CONTEXTO);
  const lista = faltando.map((s) => `- ${s}`).join('\n');

  return [
    'Você está CONTINUANDO um relatório de inteligência de mercado que foi interrompido antes do fim.',
    '',
    '## Roteiro original (para manter o mesmo padrão de profundidade e formato)',
    promptOriginal.trim(),
    '',
    '## Como o texto já escrito termina',
    '```',
    cauda,
    '```',
    '',
    '## Sua tarefa',
    'Se a última frase acima estiver interrompida, complete-a naturalmente e siga em frente.',
    'Escreva APENAS as seções abaixo, que ainda não foram escritas:',
    lista,
    '',
    'REGRAS:',
    '- NÃO repita nenhum conteúdo já escrito nem reescreva seções anteriores.',
    '- NÃO comece com introdução, saudação ou resumo do que já foi dito.',
    '- Mantenha o mesmo idioma, tom e nível de detalhe do trecho acima.',
    '- Use os mesmos níveis de cabeçalho markdown (## para capítulo, ### para subseção).',
    '- Ao terminar as seções pedidas, encerre o relatório normalmente.',
  ].join('\n');
}

/**
 * Emenda o trecho novo ao texto existente, limpando a costura.
 *
 * Caso real (07/08/2026): o texto original terminava numa linha de tabela
 * cortada ("| Sustaining CAPEX … US$ 140") e a continuação REESCREVEU a linha
 * completa — deixando a versão interrompida como lixo imediatamente acima da
 * emenda. Quando a última linha está visivelmente incompleta E a continuação a
 * reescreve (mesmo prefixo), a versão cortada é descartada.
 */
export function emendar(markdown: string, trecho: string): string {
  const base = markdown.trimEnd();
  const linhas = base.split('\n');
  const ultima = (linhas[linhas.length - 1] ?? '').trim();

  const terminaBem = /[.!?:)`|*"]$/.test(ultima);
  const prefixo = ultima.slice(0, 40);
  const reescrita =
    !terminaBem && prefixo.length >= 15 && trecho.slice(0, 600).includes(prefixo);

  const corpo = reescrita ? linhas.slice(0, -1).join('\n').trimEnd() : base;
  return `${corpo}\n\n${trecho}`;
}

export interface ResultadoContinuacao {
  markdown: string;
  searchResults: ResearchSource[];
  sources: string[];
  /** Quantas chamadas extras foram feitas ao motor. */
  continuacoes: number;
  completude: Completude;
}

/**
 * Tenta completar o relatório. Devolve sempre o melhor texto conseguido — se
 * nada melhorar, devolve o original (nunca piora o que o usuário já teria).
 */
export async function continuarRelatorio(
  provider: ResearchProvider,
  promptOriginal: string,
  markdownInicial: string,
  searchResultsIniciais: ResearchSource[],
  sourcesIniciais: string[]
): Promise<ResultadoContinuacao> {
  let markdown = markdownInicial;
  const searchResults = [...searchResultsIniciais];
  const sources = new Set(sourcesIniciais);
  let continuacoes = 0;
  let completude = avaliarCompletude(promptOriginal, markdown);

  // Continuação exige chamada síncrona: os provedores start/poll (OpenAI,
  // Perplexity async) teriam de abrir outro job e esperar outro ciclo do poller.
  // Ficam só com a detecção — documentado, não esquecido.
  if (!provider.run) return { markdown, searchResults, sources: [...sources], continuacoes, completude };

  const teto = maxTentativas();
  while (completude.incompleto && continuacoes < teto) {
    const faltando = completude.faltando;
    if (faltando.length === 0 && !completude.fraseIncompleta) break;

    logger.info('Deep Research — continuando relatório incompleto', {
      tentativa: continuacoes + 1,
      teto,
      faltando,
    });

    const prompt = montarPromptContinuacao(promptOriginal, markdown, faltando);
    let extra;
    try {
      extra = await provider.run(prompt);
    } catch (err) {
      logger.warn('Deep Research — continuação falhou; mantendo o parcial', {
        erro: err instanceof Error ? err.message : String(err),
      });
      break;
    }
    continuacoes++;

    const trecho = (extra?.markdown || '').trim();
    if (extra?.status !== 'completed' || !trecho) {
      logger.warn('Deep Research — continuação sem conteúdo; mantendo o parcial');
      break;
    }

    const candidato = emendar(markdown, trecho);
    const novaCompletude = avaliarCompletude(promptOriginal, candidato);

    const cobriuAlgo = novaCompletude.faltando.length < completude.faltando.length;
    const fechouFrase = completude.fraseIncompleta && !novaCompletude.fraseIncompleta;

    // Nenhum progresso: descarta o trecho e para. Insistir é queimar crédito.
    if (!cobriuAlgo && !fechouFrase) {
      logger.warn('Deep Research — continuação não cobriu nada novo; parando', {
        aindaFaltando: novaCompletude.faltando,
      });
      break;
    }

    // Houve progresso: fica com o ganho.
    markdown = candidato;
    completude = novaCompletude;
    for (const s of extra.searchResults || []) {
      if (!searchResults.some((e) => e.url === s.url)) searchResults.push(s);
    }
    for (const u of extra.sources || []) sources.add(u);

    // Só vale OUTRA rodada paga se esta cobriu seção faltante. Ter apenas
    // fechado a frase é progresso pequeno demais para justificar nova chamada —
    // o modelo já demonstrou que não está entregando as seções pedidas.
    if (!cobriuAlgo) {
      logger.info('Deep Research — continuação fechou a frase mas não cobriu seções; parando');
      break;
    }
  }

  return { markdown, searchResults, sources: [...sources], continuacoes, completude };
}
