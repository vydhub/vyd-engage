import { extractOutline } from './promptUtils.js';

/**
 * O relatório entregou tudo o que o prompt pediu?
 *
 * Existe porque `finish_reason` NÃO é confiável neste motor. Teste real com o
 * template "Empresa" (10 capítulos): o relatório parou no capítulo 8, no meio da
 * frase "…segurança e integridade," — e o provedor reportou `stop`, como se
 * tivesse concluído normalmente. Sem esta checagem o usuário recebe um relatório
 * faltando 2 capítulos e a seção de Fontes, sem nenhum aviso.
 *
 * A verificação é por COBERTURA: quais títulos do outline do prompt aparecem
 * como cabeçalho no markdown gerado. Comparação frouxa de propósito — o modelo
 * reescreve os títulos ("Maturidade dos Projetos" vira "Maturidade dos Projetos
 * e Janelas de Entrada"), então exigir igualdade exata daria falso positivo.
 */

/** Normaliza para comparar: sem acento, sem pontuação, minúsculo. */
function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Títulos (H2/H3) presentes no markdown gerado. */
function titulosDoRelatorio(markdown: string): string[] {
  const out: string[] = [];
  for (const linha of (markdown || '').split('\n')) {
    const m = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(linha);
    if (!m) continue;
    const t = m[2]
      .replace(/[*_`]/g, '')
      .replace(/^cap[íi]tulo\s+\d+\s*[—:-]\s*/i, '')
      .trim();
    if (t) out.push(t);
  }
  return out;
}

/**
 * Um item do outline conta como coberto quando algum título do relatório o
 * contém (ou vice-versa), ou quando compartilham as primeiras palavras — a
 * granularidade que sobrevive à reescrita do modelo.
 */
function cobre(itemEsperado: string, titulos: string[]): boolean {
  const alvo = normalizar(itemEsperado);
  if (!alvo) return true;
  const chave = alvo.split(' ').slice(0, 4).join(' ');
  return titulos.some((t) => {
    const n = normalizar(t);
    return n.includes(alvo) || alvo.includes(n) || (chave.length > 8 && n.includes(chave));
  });
}

export interface Completude {
  /** Itens do prompt sem cabeçalho correspondente no relatório. */
  faltando: string[];
  esperados: number;
  /** Última frase termina sem pontuação de fecho — sinal de corte abrupto. */
  fraseIncompleta: boolean;
  /** Faltou conteúdo pedido, ou o texto foi cortado no meio da frase. */
  incompleto: boolean;
}

export function avaliarCompletude(promptBody: string, markdown: string): Completude {
  const esperados = extractOutline(promptBody);
  const titulos = titulosDoRelatorio(markdown);
  const faltando = esperados.filter((e) => !cobre(e, titulos));

  // Fecho válido: pontuação final, fim de tabela/lista ou marcação de ênfase.
  const fim = (markdown || '').trimEnd().slice(-1);
  const fraseIncompleta = !!markdown.trim() && !['.', '!', '?', ':', ')', '`', '|', '*', '"'].includes(fim);

  return {
    faltando,
    esperados: esperados.length,
    fraseIncompleta,
    incompleto: faltando.length > 0 || fraseIncompleta,
  };
}
