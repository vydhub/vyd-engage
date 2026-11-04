import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DealProducts } from './DealProducts';

/** Produtos recalculam `Deal.value`, que nesse caso só muda por evento do Flow (E-15, E-16). */
const item = {
  id: 'i1',
  productId: 'p1',
  productName: 'Serviço',
  quantity: 2,
  unitPrice: 10,
  discount: 0,
  lineTotal: 20,
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => ({ data: String(url).includes('/deals/') ? [item] : [] }),
    }))
  );
});

function abrir(somenteLeitura?: boolean) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DealProducts
        dealId="d1"
        currentValue={20}
        onValueChange={vi.fn()}
        somenteLeitura={somenteLeitura}
      />
    </QueryClientProvider>
  );
}

describe('DealProducts', () => {
  it('sem trava, edita, remove e acrescenta como sempre', async () => {
    abrir();
    await screen.findByText('Serviço');
    expect(screen.getByRole('button', { name: /Adicionar item/ })).toBeTruthy();
    expect(screen.getByTitle('Remover item')).toBeTruthy();
    expect(screen.getAllByRole('spinbutton').every((c) => !(c as HTMLInputElement).disabled)).toBe(
      true
    );
  });

  it('somente leitura: mostra os itens, sem editar, remover nem acrescentar', async () => {
    abrir(true);
    await screen.findByText('Serviço');
    expect(screen.queryByRole('button', { name: /Adicionar item/ })).toBeNull();
    expect(screen.queryByTitle('Remover item')).toBeNull();
    expect(screen.getAllByRole('spinbutton').every((c) => (c as HTMLInputElement).disabled)).toBe(
      true
    );
    expect(screen.getByText(/O valor deste negócio vem do Flow/)).toBeTruthy();
  });
});
