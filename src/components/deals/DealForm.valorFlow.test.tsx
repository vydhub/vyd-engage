import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Deal } from '../../types';

/**
 * Depois que o Flow informa valor enviado ou aprovado, `Deal.value` é esse valor e só muda por
 * evento (spec captura-demandas, E-15, E-16). O campo trava, e o formulário não o envia.
 */
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'ADMIN' } }),
}));
vi.mock('../../services/api/client', async (original) => ({
  ...(await original<typeof import('../../services/api/client')>()),
  apiClient: new Proxy({}, { get: () => vi.fn(async () => ({ data: [], leads: [], users: [] })) }),
}));

import { DealForm } from './DealForm';

const negocio = (demanda: Record<string, unknown> | null) =>
  ({
    id: 'd1',
    name: 'Demanda',
    value: 85000,
    stage: 'QUALIFICATION',
    probability: 20,
    demanda,
  }) as unknown as Deal;

function abrir(deal: Deal, onSave = vi.fn(async () => {})) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DealForm open onClose={vi.fn()} onSave={onSave} deal={deal} />
    </QueryClientProvider>
  );
  return onSave;
}

beforeEach(() => vi.clearAllMocks());

describe('Valor no formulário do Negócio', () => {
  it('com valor do Flow, o campo trava e não vai no envio', async () => {
    const onSave = abrir(negocio({ id: 'x', flowCardId: 'c', valorEnviado: '125000.00' }));
    const campo = (await screen.findByLabelText(/Valor \(R\$\)/)) as HTMLInputElement;
    expect(campo.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const enviado = onSave.mock.calls[0][0 as never] as Record<string, unknown>;
    expect(enviado.value).toBeUndefined();
    expect(enviado.name).toBe('Demanda');
  });

  it('da Captura, mas sem valor do Flow: o estimado segue editável', async () => {
    const onSave = abrir(negocio({ id: 'x', flowCardId: 'c', valorEnviado: null }));
    const campo = (await screen.findByLabelText(/Valor \(R\$\)/)) as HTMLInputElement;
    expect(campo.disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect((onSave.mock.calls[0][0 as never] as Record<string, unknown>).value).toBe(85000);
  });

  it('Negócio comum não muda', async () => {
    abrir(negocio(null));
    const campo = (await screen.findByLabelText(/Valor \(R\$\)/)) as HTMLInputElement;
    expect(campo.disabled).toBe(false);
  });
});
