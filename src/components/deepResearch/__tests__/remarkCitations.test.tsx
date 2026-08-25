import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ReportRenderer } from '../ReportRenderer';

/**
 * Citações `[1][2][3]` viram <sup>.
 *
 * Caso real: o relatório traz "…entre 2021 e 2026.[1][2][3]…[20] Fato com
 * fonte." — a citação ocupava mais espaço visual que a própria frase.
 *
 * Testa o pipeline COMPLETO (remark-gfm → citações → rehype-slug →
 * rehype-sanitize), e não o plugin isolado: o que importa é que o <sup>
 * sobreviva ao sanitize, que é o último passo.
 */
function html(md: string): string {
  const { container } = render(<ReportRenderer markdown={md} />);
  return container.innerHTML;
}

describe('citações sobrescritas', () => {
  it('agrupa citações coladas num único sobrescrito', () => {
    const out = html('Texto do relatório.[1][2][3] Continua.');
    expect(out).toContain('<sup');
    expect(out).toContain('1,2,3');
    expect(out).not.toContain('[1]');
  });

  it('sobrevive ao rehype-sanitize (é a última etapa do pipeline)', () => {
    const { container } = render(<ReportRenderer markdown="Fato.[9]" />);
    expect(container.querySelector('sup')).not.toBeNull();
  });

  it('preserva o texto ao redor, sem comer caractere', () => {
    const out = html('Antes[7]depois.');
    expect(out).toContain('Antes');
    expect(out).toContain('depois.');
  });

  it('lida com o caso real de 20 citações seguidas', () => {
    const cit = Array.from({ length: 20 }, (_, i) => `[${i + 1}]`).join('');
    const { container } = render(<ReportRenderer markdown={`Base documental.${cit} Fato.`} />);
    const sup = container.querySelector('sup');
    expect(sup?.textContent).toBe('1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20');
    expect(container.textContent).toContain('Fato.');
  });

  it('NÃO mexe em link markdown (o [texto] ali é rótulo)', () => {
    const { container } = render(
      <ReportRenderer markdown="Veja [a fonte](https://exemplo.com) aqui." />
    );
    const a = container.querySelector('a');
    expect(a?.getAttribute('href')).toBe('https://exemplo.com');
    expect(a?.textContent).toBe('a fonte');
  });

  it('não cria sobrescrito em texto sem citação', () => {
    const { container } = render(<ReportRenderer markdown="Parágrafo comum, sem colchetes." />);
    expect(container.querySelector('sup')).toBeNull();
  });

  it('funciona dentro de célula de tabela', () => {
    const { container } = render(
      <ReportRenderer markdown={'| Projeto | Fonte |\n| --- | --- |\n| Minas-Rio | [2][5] |'} />
    );
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelector('td sup')?.textContent).toBe('2,5');
  });

  it('ignora colchete que não é citação numérica', () => {
    const { container } = render(<ReportRenderer markdown="Item [a] e [x1] permanecem." />);
    expect(container.querySelector('sup')).toBeNull();
  });

  it('múltiplos grupos no mesmo parágrafo', () => {
    const { container } = render(
      <ReportRenderer markdown="Primeiro fato.[1] Segundo fato.[2][3] Fim." />
    );
    const sups = [...container.querySelectorAll('sup')].map((s) => s.textContent);
    expect(sups).toEqual(['1', '2,3']);
  });
});
