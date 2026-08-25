import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  continuarRelatorio,
  montarPromptContinuacao,
} from '../../services/deepResearch/continueReport.js';
import type { ResearchProvider } from '../../services/deepResearch/providers/types.js';

/**
 * Continuação automática de relatório incompleto.
 *
 * Motivação medida em produção: o motor entrega 8 de 10 capítulos, corta no meio
 * da frase e reporta `finish_reason: "stop"`. Aumentar `max_tokens` não resolve
 * (a resposta parou abaixo do teto), então pedimos o que faltou e emendamos.
 *
 * O que estes testes protegem é sobretudo o CUSTO: cada continuação é uma
 * chamada paga ao motor.
 */

const PROMPT = `Objetivo: pesquisa sobre [EMPRESA].

## Estrutura da pesquisa solicitada
### Capítulo 1 — Panorama Geral
### Capítulo 2 — Investimentos
### Capítulo 3 — Concorrência
### Capítulo 4 — Estratégias Comerciais
`;

const PARCIAL = [
  '## Capítulo 1 — Panorama Geral',
  'Texto.',
  '',
  '## Capítulo 2 — Investimentos',
  'Texto que termina cortado em segurança e integridade,',
].join('\n');

function providerQueDevolve(...respostas: string[]): ResearchProvider & { chamadas: number } {
  let i = 0;
  const p = {
    name: 'fake',
    isAsync: false,
    enabled: () => true,
    chamadas: 0,
    run: vi.fn(async () => {
      p.chamadas++;
      const md = respostas[i++] ?? '';
      return { status: 'completed' as const, markdown: md, sources: [], searchResults: [] };
    }),
  };
  return p as unknown as ResearchProvider & { chamadas: number };
}

beforeEach(() => {
  delete process.env.DEEP_RESEARCH_MAX_CONTINUATIONS;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('continuarRelatorio', () => {
  it('completa o relatório pedindo só o que falta', async () => {
    const provider = providerQueDevolve(
      '## Capítulo 3 — Concorrência\nTexto.\n\n## Capítulo 4 — Estratégias Comerciais\nFim do relatório.'
    );

    const r = await continuarRelatorio(provider, PROMPT, PARCIAL, [], []);

    expect(r.continuacoes).toBe(1);
    expect(r.completude.incompleto).toBe(false);
    expect(r.markdown).toContain('Capítulo 3');
    expect(r.markdown).toContain('Capítulo 4');
    // O texto original é preservado, não reescrito.
    expect(r.markdown).toContain('Capítulo 1 — Panorama Geral');
  });

  it('PARA quando a continuação não cobre nada novo (não queima crédito)', async () => {
    const provider = providerQueDevolve('Blá blá sem nenhuma seção nova.', 'Mais blá.');

    const r = await continuarRelatorio(provider, PROMPT, PARCIAL, [], []);

    expect(provider.chamadas).toBe(1); // não insistiu
    expect(r.continuacoes).toBe(1);
  });

  it('respeita o teto de tentativas', async () => {
    process.env.DEEP_RESEARCH_MAX_CONTINUATIONS = '1';
    // Cobre uma seção por vez: sem o teto, faria 2 chamadas.
    const provider = providerQueDevolve(
      '## Capítulo 3 — Concorrência\nTexto.',
      '## Capítulo 4 — Estratégias Comerciais\nTexto.'
    );

    const r = await continuarRelatorio(provider, PROMPT, PARCIAL, [], []);

    expect(provider.chamadas).toBe(1);
    expect(r.continuacoes).toBe(1);
    expect(r.completude.incompleto).toBe(true); // ainda falta o 4
  });

  it('teto 0 desliga a continuação por completo', async () => {
    process.env.DEEP_RESEARCH_MAX_CONTINUATIONS = '0';
    const provider = providerQueDevolve('## Capítulo 3 — Concorrência\nTexto.');

    const r = await continuarRelatorio(provider, PROMPT, PARCIAL, [], []);

    expect(provider.chamadas).toBe(0);
    expect(r.markdown).toBe(PARCIAL);
  });

  it('falha do motor mantém o parcial em vez de perder tudo', async () => {
    const provider = {
      name: 'fake',
      isAsync: false,
      enabled: () => true,
      run: vi.fn(async () => {
        throw new Error('502 do provedor');
      }),
    } as unknown as ResearchProvider;

    const r = await continuarRelatorio(provider, PROMPT, PARCIAL, [], []);

    expect(r.markdown).toBe(PARCIAL);
    expect(r.completude.incompleto).toBe(true);
  });

  it('relatório já completo não dispara chamada nenhuma', async () => {
    const completo = [
      '## Capítulo 1 — Panorama Geral',
      'a.',
      '## Capítulo 2 — Investimentos',
      'b.',
      '## Capítulo 3 — Concorrência',
      'c.',
      '## Capítulo 4 — Estratégias Comerciais',
      'd.',
    ].join('\n');
    const provider = providerQueDevolve('não deveria ser chamado');

    const r = await continuarRelatorio(provider, PROMPT, completo, [], []);

    expect(provider.chamadas).toBe(0);
    expect(r.continuacoes).toBe(0);
  });

  it('provider sem run() (assíncrono) não tenta continuar', async () => {
    const asyncProvider = {
      name: 'openai',
      isAsync: true,
      enabled: () => true,
      start: vi.fn(),
      poll: vi.fn(),
    } as unknown as ResearchProvider;

    const r = await continuarRelatorio(asyncProvider, PROMPT, PARCIAL, [], []);

    expect(r.continuacoes).toBe(0);
    expect(r.markdown).toBe(PARCIAL);
  });

  it('acumula fontes novas sem duplicar as que já existiam', async () => {
    const provider = {
      name: 'fake',
      isAsync: false,
      enabled: () => true,
      run: vi.fn(async () => ({
        status: 'completed' as const,
        markdown: '## Capítulo 3 — Concorrência\nx.\n\n## Capítulo 4 — Estratégias Comerciais\ny.',
        sources: ['https://a.com', 'https://b.com'],
        searchResults: [{ url: 'https://a.com' }, { url: 'https://b.com' }],
      })),
    } as unknown as ResearchProvider;

    const r = await continuarRelatorio(
      provider,
      PROMPT,
      PARCIAL,
      [{ url: 'https://a.com' }],
      ['https://a.com']
    );

    expect(r.sources.sort()).toEqual(['https://a.com', 'https://b.com']);
    expect(r.searchResults).toHaveLength(2);
  });
});

describe('montarPromptContinuacao', () => {
  it('inclui as seções faltantes e proíbe repetir o que já existe', () => {
    const p = montarPromptContinuacao(PROMPT, PARCIAL, ['Concorrência', 'Estratégias Comerciais']);
    expect(p).toContain('- Concorrência');
    expect(p).toContain('- Estratégias Comerciais');
    expect(p).toMatch(/NÃO repita/i);
  });

  it('manda só a CAUDA do texto, não o relatório inteiro (custo de entrada)', () => {
    const gigante = `${'x'.repeat(90000)}\n\nfim do trecho conhecido.`;
    const p = montarPromptContinuacao(PROMPT, gigante, ['Concorrência']);
    expect(p).toContain('fim do trecho conhecido.');
    expect(p.length).toBeLessThan(12000);
  });
});

/**
 * Limpeza da COSTURA — caso real de 07/08/2026: o texto original terminava numa
 * linha de tabela cortada e a continuação reescreveu a linha completa, deixando
 * a versão interrompida como lixo acima da emenda.
 */
describe('emendar', () => {
  it('descarta a linha cortada quando a continuação a reescreve', async () => {
    const { emendar } = await import('../../services/deepResearch/continueReport.js');
    const base = [
      '| Projeto | Valor |',
      '| Filtragem | US$ 240 mi |',
      '| Sustaining CAPEX Minas-Rio (Oport. 4) | Estimativa: US$ 140',
    ].join('\n');
    const trecho =
      '| Sustaining CAPEX Minas-Rio (Oport. 4) | Estimativa: US$ 140–200 mi |\n\n## Capítulo 5 — Maturidade\nTexto.';

    const r = emendar(base, trecho);

    expect(r).toContain('US$ 140–200 mi');
    expect(r).toContain('| Filtragem | US$ 240 mi |');
    // A versão CORTADA não sobrevive (só existe a completa).
    expect(r.match(/Sustaining CAPEX Minas-Rio/g)).toHaveLength(1);
  });

  it('preserva a última linha quando ela termina bem', async () => {
    const { emendar } = await import('../../services/deepResearch/continueReport.js');
    const base = 'Parágrafo completo com ponto final.';
    const r = emendar(base, '## Capítulo 5 — Maturidade\nTexto.');
    expect(r).toContain('Parágrafo completo com ponto final.');
  });

  it('preserva a linha cortada quando a continuação NÃO a reescreve (emenda direta)', async () => {
    const { emendar } = await import('../../services/deepResearch/continueReport.js');
    const base = 'A frase foi interrompida no meio de segurança e';
    const r = emendar(base, 'integridade, completando o raciocínio.\n\n## Capítulo 5 — Maturidade');
    // Sem reescrita detectada, nada é descartado — perder conteúdo é pior.
    expect(r).toContain('segurança e');
  });
});
