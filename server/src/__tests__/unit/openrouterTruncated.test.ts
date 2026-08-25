import { describe, it, expect } from 'vitest';
import { applyChunk } from '../../services/deepResearch/providers/openrouter.js';

/**
 * Detecção de relatório TRUNCADO.
 *
 * Quatro das cinco primeiras pesquisas de produção terminavam no meio de uma
 * palavra ("…aproveitando", "…em Fl", "…inser") e mesmo assim eram gravadas
 * como COMPLETED: o provider concatenava `delta.content` e nunca lia o
 * `finish_reason`. Sem esse sinal não há como distinguir um relatório inteiro
 * de um decapitado.
 *
 * O `finish_reason` só vem no ÚLTIMO chunk do stream — nos anteriores é null.
 */
function acc() {
  return {
    markdown: '',
    citations: [] as string[],
    searchResults: [] as { title?: string; url: string; date?: string }[],
    finishReason: undefined as string | undefined,
  };
}

/** Chunk de conteúdo, como o OpenRouter emite no meio do stream. */
function chunkTexto(texto: string) {
  return { choices: [{ delta: { content: texto }, finish_reason: null }] };
}

describe('openrouter — finish_reason', () => {
  it('marca "length" quando o modelo corta por limite de saída', () => {
    const a = acc();
    applyChunk(chunkTexto('Análise de mercado'), a);
    applyChunk({ choices: [{ delta: {}, finish_reason: 'length' }] }, a);

    expect(a.finishReason).toBe('length');
    expect(a.markdown).toBe('Análise de mercado');
  });

  it('marca "stop" quando o texto termina naturalmente', () => {
    const a = acc();
    applyChunk(chunkTexto('Conclusão.'), a);
    applyChunk({ choices: [{ delta: {}, finish_reason: 'stop' }] }, a);

    expect(a.finishReason).toBe('stop');
  });

  it('os chunks intermediários (finish_reason null) NÃO apagam o motivo', () => {
    const a = acc();
    applyChunk(chunkTexto('a'), a);
    applyChunk(chunkTexto('b'), a);
    expect(a.finishReason).toBeUndefined();

    applyChunk({ choices: [{ delta: {}, finish_reason: 'length' }] }, a);
    applyChunk(chunkTexto(''), a); // chunk tardio não pode zerar o sinal
    expect(a.finishReason).toBe('length');
  });

  it('aceita finishReason em camelCase (variação entre provedores)', () => {
    const a = acc();
    applyChunk({ choices: [{ delta: {}, finishReason: 'length' }] }, a);
    expect(a.finishReason).toBe('length');
  });

  it('stream sem finish_reason deixa o motivo indefinido — não presume truncado', () => {
    const a = acc();
    applyChunk(chunkTexto('texto'), a);
    expect(a.finishReason).toBeUndefined();
  });

  it('segue acumulando conteúdo e fontes como antes', () => {
    const a = acc();
    applyChunk(
      {
        choices: [
          {
            delta: {
              content: 'texto',
              annotations: [{ url_citation: { url: 'https://exemplo.com', title: 'Fonte' } }],
            },
            finish_reason: null,
          },
        ],
      },
      a
    );
    expect(a.markdown).toBe('texto');
    expect(a.searchResults).toEqual([{ title: 'Fonte', url: 'https://exemplo.com', date: undefined }]);
  });
});
