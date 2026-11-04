import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

/**
 * Link do Flow para criar o cliente na triagem (spec captura-demandas, E-20):
 * /app/companies?novo=1&nome=&cnpj=&dominio= abre o formulário já preenchido.
 */
vi.mock('../hooks/useCompanies', () => ({
  useCompanies: () => ({
    companies: [],
    loading: false,
    pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    fetchCompanies: vi.fn(),
    createCompany: vi.fn(),
    updateCompany: vi.fn(),
    refetch: vi.fn(),
  }),
}));
vi.mock('../services/api/client', async (original) => {
  const real = await original<typeof import('../services/api/client')>();
  return {
    ...real,
    apiClient: new Proxy({}, { get: () => vi.fn(async () => ({ data: [], users: [] })) }),
  };
});

import { Companies } from './Companies';

// Tela inteira em jsdom: com a suíte toda em paralelo, a primeira montagem passa de 5 s.
vi.setConfig({ testTimeout: 15_000 });

function abrir(url: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[url]}>
        <Companies />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('Empresas: criar com dados preenchidos (E-20)', () => {
  it('abre o formulário com nome, CNPJ e domínio do link', async () => {
    abrir('/app/companies?novo=1&nome=Cliente%20Novo&cnpj=12345678000190&dominio=cliente.com.br');
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    expect(screen.getByDisplayValue('Cliente Novo')).toBeTruthy();
    expect(screen.getByDisplayValue('12345678000190')).toBeTruthy();
    expect(screen.getByDisplayValue('cliente.com.br')).toBeTruthy();
  });

  it('cancelar não deixa os dados do link para a próxima empresa', async () => {
    abrir('/app/companies?novo=1&nome=Cliente%20Novo&cnpj=12345678000190&dominio=cliente.com.br');
    await waitFor(() => expect(screen.getByDisplayValue('Cliente Novo')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getAllByRole('button', { name: /Nova Empresa/ })[0]);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    expect(screen.queryByDisplayValue('Cliente Novo')).toBeNull();
    expect(screen.queryByDisplayValue('cliente.com.br')).toBeNull();
  });

  it('fechar o diálogo também limpa os dados do link', async () => {
    abrir('/app/companies?novo=1&nome=Cliente%20Novo');
    await waitFor(() => expect(screen.getByDisplayValue('Cliente Novo')).toBeTruthy());
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getAllByRole('button', { name: /Nova Empresa/ })[0]);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    expect(screen.queryByDisplayValue('Cliente Novo')).toBeNull();
  });

  it('sem novo=1, não abre nada', async () => {
    abrir('/app/companies?nome=Cliente%20Novo');
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /Nova Empresa/ }).length).toBeGreaterThan(0)
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
