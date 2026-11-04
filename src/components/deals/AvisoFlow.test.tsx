import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AvisoFlow, linkDoCard } from './AvisoFlow';

describe('AvisoFlow (spec captura-demandas, E-16)', () => {
  it('mostra o aviso e o link do card', () => {
    render(<AvisoFlow demanda={{ id: 'd', flowCardId: 'card-1', estado: 'em_orcamento' }} />);
    expect(screen.getByText('Andamento controlado pelo Flow')).toBeTruthy();
    expect(screen.getByText(/Em orçamento/)).toBeTruthy();
    const link = screen.getByRole('link', { name: /Abrir o card no Flow/ });
    expect(link.getAttribute('href')).toBe(linkDoCard('card-1'));
    expect(link.getAttribute('href')).toMatch(/\/card\/card-1$/);
  });

  it('sem card vinculado, diz isso em vez de oferecer link', () => {
    render(<AvisoFlow demanda={{ id: 'd', flowCardId: null }} />);
    expect(screen.queryByRole('link', { name: /Abrir o card/ })).toBeNull();
    expect(screen.getByText('Card ainda não vinculado')).toBeTruthy();
  });

  it('link original só vira link se for http ou https (D-T6)', () => {
    const { unmount } = render(
      <AvisoFlow demanda={{ id: 'd', flowCardId: 'c', linkOriginal: 'javascript:alert(1)' }} />
    );
    expect(screen.queryByRole('link', { name: /Original/ })).toBeNull();
    unmount();
    render(
      <AvisoFlow demanda={{ id: 'd', flowCardId: 'c', linkOriginal: 'https://exemplo.com/x' }} />
    );
    expect(screen.getByRole('link', { name: /Original/ }).getAttribute('href')).toBe(
      'https://exemplo.com/x'
    );
  });

  it('conteúdo de leitura não usa a cor de meta', () => {
    render(
      <AvisoFlow
        demanda={{ id: 'd', flowCardId: 'c', estado: 'ganha', valorEnviado: 1, valorAprovado: 2 }}
      />
    );
    expect(screen.getByText(/Etapa, status e valores/).className).toContain('text-foreground');
    expect(screen.getByText(/Valor enviado/).className).toContain('text-foreground');
  });

  it('mostra os valores do Flow só para leitura', () => {
    render(
      <AvisoFlow
        demanda={{ id: 'd', flowCardId: 'c', valorEnviado: '125000.00', valorAprovado: 100000 }}
      />
    );
    expect(screen.getByText(/Valor enviado/)).toBeTruthy();
    expect(screen.getByText(/Valor aprovado/)).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
