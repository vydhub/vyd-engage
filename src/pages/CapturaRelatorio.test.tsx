import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

/** Relatório "Captura" (spec captura-demandas, E-21, E-22): só mostra o que o servidor calculou. */
const api = vi.hoisted(() => ({ getCapturaIndicadores: vi.fn(), getCapturaFiltros: vi.fn() }));

vi.mock('../services/api/client', async (original) => ({
  ...(await original<typeof import('../services/api/client')>()),
  apiClient: api,
}));

import { CapturaRelatorio } from './CapturaRelatorio';

const indicadores = {
  taxaGo: { go: 4, triadas: 5, taxa: 0.8 },
  conversao: { ganhas: 3, perdidas: 2, taxa: 0.6 },
  tempoAtendimento: { enviadas: 6, mediaHorasUteis: 9 },
  sla: { dentro: 1, avaliados: 2, taxa: 0.5, semSla: 1 },
  ticketEnviado: { soma: 720000, quantidade: 6, media: 120000, semValor: 1 },
  ticketAprovado: { soma: 240000, quantidade: 3, media: 80000, semValor: 1 },
};

function abrir() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <CapturaRelatorio />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getCapturaFiltros.mockResolvedValue({ data: { clientes: [], contratos: [] } });
  api.getCapturaIndicadores.mockResolvedValue({
    data: {
      dataInicio: '2026-11-20T13:58:00.000Z',
      calendario: {
        diasUteis: [1, 2, 3, 4, 5],
        inicio: '08:00',
        fim: '18:00',
        fuso: 'America/Sao_Paulo',
        excluirFeriadosNacionais: true,
      },
      indicadores,
      grupos: [],
      lacunas: {
        ganhasSemValor: [
          {
            engageId: 'd1',
            objeto: 'Pedido sem valor',
            cliente: 'Cliente',
            contrato: 'CT-1',
            aprovadoEm: '2026-11-26T15:00:00.000Z',
          },
        ],
      },
    },
  });
});

describe('Relatório Captura', () => {
  it('mostra os seis indicadores com as definições fixas', async () => {
    abrir();
    expect(await screen.findByText('Taxa de go (contrato novo)')).toBeTruthy();
    expect(screen.getByText('80%')).toBeTruthy();
    expect(screen.getByText('60%')).toBeTruthy();
    expect(screen.getByText('9 h')).toBeTruthy();
    expect(screen.getByText('50%')).toBeTruthy();
    expect(screen.getByText(/120\.000/)).toBeTruthy();
    expect(screen.getByText(/80\.000/)).toBeTruthy();
    expect(screen.getByText(/sobre orçamentos com decisão no período/)).toBeTruthy();
    // Nome visível do produto (emenda de 03/11).
    expect(screen.getByRole('heading', { name: 'Radar' })).toBeTruthy();
    expect(screen.getByText(/demandas que entraram pelo Radar/)).toBeTruthy();
    expect(screen.getByText(/chegou a orçamento, a orçamento enviado ou a ganha/)).toBeTruthy();
    expect(screen.getByText(/1 fora da conta, sem SLA/)).toBeTruthy();
  });

  it('mostra a data de início, o calendário e a lacuna de ganha sem valor', async () => {
    abrir();
    expect(await screen.findByText(/Demandas registradas desde/)).toBeTruthy();
    expect(screen.getByText(/As anteriores à ativação não existem aqui/)).toBeTruthy();
    expect(screen.getByText(/das 08:00 às 18:00/)).toBeTruthy();
    expect(screen.getByText('Pedido sem valor')).toBeTruthy();
  });

  it('sem nada para medir, mostra traço em vez de zero enganoso', async () => {
    api.getCapturaIndicadores.mockResolvedValue({
      data: {
        dataInicio: null,
        calendario: {
          diasUteis: [1],
          inicio: '08:00',
          fim: '18:00',
          fuso: 'America/Sao_Paulo',
          excluirFeriadosNacionais: true,
        },
        indicadores: {
          taxaGo: { go: 0, triadas: 0, taxa: null },
          conversao: { ganhas: 0, perdidas: 0, taxa: null },
          tempoAtendimento: { enviadas: 0, mediaHorasUteis: null },
          sla: { dentro: 0, avaliados: 0, taxa: null, semSla: 0 },
          ticketEnviado: { soma: 0, quantidade: 0, media: null, semValor: 0 },
          ticketAprovado: { soma: 0, quantidade: 0, media: null, semValor: 0 },
        },
        grupos: [],
        lacunas: { ganhasSemValor: [] },
      },
    });
    abrir();
    expect(await screen.findByText(/Ainda não há demandas registradas/)).toBeTruthy();
    expect(screen.getAllByText('—')).toHaveLength(6);
  });
});
