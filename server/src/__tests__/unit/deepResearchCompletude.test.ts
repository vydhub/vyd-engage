import { describe, it, expect } from 'vitest';
import { avaliarCompletude } from '../../services/deepResearch/completeness.js';
import { extractOutline, extractPlaceholders } from '../../services/deepResearch/promptUtils.js';
import {
  EMPRESA_TEMPLATE_PROMPT,
  SEGMENTO_TEMPLATE_PROMPT,
} from '../../services/deepResearch/builtinTemplates.js';

/**
 * Detecção de relatório incompleto QUANDO O PROVEDOR DIZ QUE ESTÁ COMPLETO.
 *
 * Caso real (07/08/2026): template "Empresa" pede 10 capítulos; o relatório
 * gerado parou no capítulo 8, cortado em "…segurança e integridade," — e o
 * OpenRouter reportou `finish_reason: "stop"`. Confiar só no provedor deixaria
 * o usuário com 2 capítulos e a seção de Fontes faltando, sem aviso nenhum.
 */

const PROMPT_10_CAPS = `Objetivo: pesquisa sobre [EMPRESA].

## Estrutura da pesquisa solicitada
### Capítulo 1 — Panorama Geral da Empresa
### Capítulo 2 — Investimentos em Curso e Planejados
### Capítulo 3 — Distribuição de Investimentos por Fase de Projeto
### Capítulo 4 — Maturidade dos Projetos
### Capítulo 5 — Modelo de Contratação e Preferências da Empresa
### Capítulo 6 — Concorrência e Parcerias Estratégicas
### Capítulo 7 — Organograma e Tomadores de Decisão
### Capítulo 8 — Conteúdo Local e Política de Contratação Regional
### Capítulo 9 — Pipeline de Projetos e Oportunidades Futuras
### Capítulo 10 — Estratégias Comerciais Recomendadas
`;

/** Relatório com os N primeiros capítulos, terminando bem ou cortado. */
function relatorio(ateCapitulo: number, cortado = false): string {
  const titulos = [
    'Panorama Geral da Empresa',
    'Investimentos em Curso e Planejados',
    'Distribuição de Investimentos por Fase de Projeto',
    'Maturidade dos Projetos e Janelas de Entrada', // reescrito pelo modelo
    'Modelo de Contratação e Preferências da Empresa',
    'Concorrência e Parcerias Estratégicas',
    'Organograma e Tomadores de Decisão (Situação em 2026)',
    'Conteúdo Local e Política de Contratação Regional',
    'Pipeline de Projetos e Oportunidades Futuras',
    'Estratégias Comerciais Recomendadas',
  ];
  const corpo = titulos
    .slice(0, ateCapitulo)
    .map((t, i) => `## Capítulo ${i + 1} — ${t}\n\nTexto do capítulo.`)
    .join('\n\n');
  return cortado ? `${corpo}\n\nE é fundamental demonstrar aderência a padrões de segurança e integridade,` : corpo;
}

describe('avaliarCompletude', () => {
  it('detecta o caso real: 8 de 10 capítulos e frase cortada', () => {
    const r = avaliarCompletude(PROMPT_10_CAPS, relatorio(8, true));
    expect(r.incompleto).toBe(true);
    expect(r.fraseIncompleta).toBe(true);
    expect(r.faltando).toHaveLength(2);
    expect(r.faltando.join(' ')).toContain('Pipeline');
    expect(r.faltando.join(' ')).toContain('Estratégias Comerciais');
  });

  it('relatório com os 10 capítulos e fecho correto é considerado completo', () => {
    const r = avaliarCompletude(PROMPT_10_CAPS, relatorio(10));
    expect(r.incompleto).toBe(false);
    expect(r.faltando).toEqual([]);
  });

  it('tolera título REESCRITO pelo modelo (não exige texto idêntico)', () => {
    // "Maturidade dos Projetos" virou "…e Janelas de Entrada" no relatório real.
    const r = avaliarCompletude(PROMPT_10_CAPS, relatorio(10));
    expect(r.faltando.join(' ')).not.toContain('Maturidade');
  });

  it('frase cortada sozinha já marca incompleto, mesmo com todos os capítulos', () => {
    const r = avaliarCompletude(PROMPT_10_CAPS, relatorio(10, true));
    expect(r.incompleto).toBe(true);
    expect(r.faltando).toEqual([]);
    expect(r.fraseIncompleta).toBe(true);
  });

  it('fecho em tabela, lista ou negrito conta como término válido', () => {
    for (const fim of ['| a | b |', '- item final.', 'texto em **negrito**', 'citação "assim"']) {
      const r = avaliarCompletude(PROMPT_10_CAPS, `${relatorio(10)}\n\n${fim}`);
      expect(r.fraseIncompleta).toBe(false);
    }
  });

  it('prompt sem outline não acusa nada (não inventa exigência)', () => {
    const r = avaliarCompletude('Escreva um resumo livre sobre a empresa.', 'Um resumo qualquer.');
    expect(r.esperados).toBe(0);
    expect(r.incompleto).toBe(false);
  });
});

/**
 * Contrato de renderização dos templates builtin (spec req. 54): o card
 * "O que você vai receber" e o detector de completude derivam AMBOS de
 * extractOutline(promptBody). Estes testes prendem os capítulos novos do
 * template de Segmento expandido (reqs. 49-52) a esse contrato — se um título
 * de capítulo passar a começar com palavra ignorada pelo outline (objetivo/
 * estrutura/instru…/formata/fontes/refer…), o capítulo some do card e deixa de
 * ser cobrado pela continuação automática, silenciosamente.
 */

const CAPITULOS_SEGMENTO = [
  'Escopo, premissas e leitura executiva',
  'Visão Geral do Segmento e Commodities',
  'Mapa de Empresas e Ativos no Território',
  'Censo de Empresas do Segmento',
  'Retrospectiva de Projetos Implantados',
  'Investimentos de Capital e Correntes (a partir de 2026)',
  'Matriz de Screening do Segmento',
  'Maturidade, modelos de contratação e concorrência',
  'Conteúdo local e política regional',
  'Posicionamento e Proposta de Valor',
  'Pipeline futuro, estratégia comercial e limitações',
];

/** Relatório sintético cobrindo os títulos dados, com fecho válido. */
function relatorioSegmento(titulos: string[]): string {
  const corpo = titulos
    .map((t, i) => `## Capítulo ${i + 1} — ${t}\n\nTexto do capítulo.`)
    .join('\n\n');
  return `# Pesquisa de Segmento\n\n${corpo}\n\n## Fontes e Referências\n\n1. Fonte.`;
}

describe('template builtin de Segmento (expandido)', () => {
  it('o outline expõe exatamente os 11 capítulos novos, na ordem', () => {
    expect(extractOutline(SEGMENTO_TEMPLATE_PROMPT)).toEqual(CAPITULOS_SEGMENTO);
  });

  it('mantém os placeholders [SEGMENTO] e [REGIÃO] (o link do mapa IBRAM não vira placeholder)', () => {
    expect(extractPlaceholders(SEGMENTO_TEMPLATE_PROMPT)).toEqual(['SEGMENTO', 'REGIÃO']);
  });

  it('não pede mais diretório de decisores (concentrado no template de Empresa)', () => {
    expect(SEGMENTO_TEMPLATE_PROMPT.toLowerCase()).not.toContain('diretório de decisores');
    expect(SEGMENTO_TEMPLATE_PROMPT.toLowerCase()).not.toContain('decisores por empresa-alvo');
  });

  it('referencia o mapa IBRAM como link markdown (nunca iframe)', () => {
    expect(SEGMENTO_TEMPLATE_PROMPT).toContain(
      '[Mapa da Mineração Brasileira — IBRAM](https://www.google.com/maps/d/u/0/viewer?mid=1cYf5kH02tHYtKnX9ZvTomkRMO0FhkBw&femb=1)'
    );
    expect(SEGMENTO_TEMPLATE_PROMPT.toLowerCase()).not.toContain('<iframe');
  });

  it('instrui "sem dados públicos suficientes" em vez de inventar (req. 55)', () => {
    expect(SEGMENTO_TEMPLATE_PROMPT).toContain('sem dados públicos suficientes');
  });

  it('relatório com os 11 capítulos é considerado completo', () => {
    const r = avaliarCompletude(SEGMENTO_TEMPLATE_PROMPT, relatorioSegmento(CAPITULOS_SEGMENTO));
    expect(r.esperados).toBe(CAPITULOS_SEGMENTO.length);
    expect(r.faltando).toEqual([]);
    expect(r.incompleto).toBe(false);
  });

  it('capítulo novo faltando (Matriz de Screening) é acusado pelo detector', () => {
    const semScreening = CAPITULOS_SEGMENTO.filter((t) => t !== 'Matriz de Screening do Segmento');
    const r = avaliarCompletude(SEGMENTO_TEMPLATE_PROMPT, relatorioSegmento(semScreening));
    expect(r.incompleto).toBe(true);
    expect(r.faltando.join(' ')).toContain('Matriz de Screening');
  });
});

describe('template builtin de Empresa', () => {
  it('Mapa de Stakeholders segue no outline — local canônico do diretório de decisores', () => {
    const outline = extractOutline(EMPRESA_TEMPLATE_PROMPT);
    expect(outline.join(' | ')).toContain('Mapa de Stakeholders');
    expect(EMPRESA_TEMPLATE_PROMPT).toContain('decide | influencia | veta');
    expect(EMPRESA_TEMPLATE_PROMPT).toContain('Engenharia/Projetos/Suprimentos/Diretoria');
  });
});
