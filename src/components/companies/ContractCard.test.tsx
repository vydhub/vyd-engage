import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { Company } from '../../types';

/**
 * Campos atuais da empresa e contratos novos (spec captura-demandas, E-07, E-08): quem é
 * CONCORRENTE segue igual, e o contrato NOS não avisa duas vezes.
 */
const api = vi.hoisted(() => ({ getContratos: vi.fn(), getExpiringContracts: vi.fn() }));

vi.mock('../../services/api/client', async (original) => ({
  ...(await original<typeof import('../../services/api/client')>()),
  apiClient: api,
}));
vi.mock('../comercial/RoadmapCreateDialog', () => ({ RoadmapCreateDialog: () => null }));

import { ContractCard } from './ContractCard';
import { ExpiringContractsWidget } from './ExpiringContractsWidget';

function emDias(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString();
}

function contratoCom(extra: Record<string, unknown>) {
  return {
    id: 'c1',
    numero: 'CT-0042',
    tipo: 'LTA',
    vigenciaInicio: null,
    vigenciaFim: null,
    saldo: null,
    saldoDisponivel: false,
    lacunas: [],
    ...extra,
  };
}

function renderizar(ui: React.ReactElement) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

const empresa = (extra: Partial<Company>) =>
  ({ id: 'e1', name: 'Empresa', updatedAt: 'x', ...extra }) as Company;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ContractCard (E-08)', () => {
  it('CONCORRENTE segue igual: a contagem regressiva continua', async () => {
    api.getContratos.mockResolvedValue({ data: { itens: [] } });
    renderizar(
      <ContractCard
        company={empresa({
          contractHolder: 'CONCORRENTE',
          contractCompetitor: 'Rival',
          contractEndDate: emDias(20),
        })}
        onUpdated={vi.fn()}
      />
    );
    expect(await screen.findByText(/Vence em \d+ dias/)).toBeTruthy();
    expect(screen.queryByText('Contratos LTA')).toBeNull();
  });

  it('NOS com contrato que tem vencimento: lista o contrato e não repete o aviso antigo', async () => {
    api.getContratos.mockResolvedValue({
      data: { itens: [contratoCom({ vigenciaFim: emDias(20), lacunas: ['sem_sla'] })] },
    });
    renderizar(
      <ContractCard
        company={empresa({ contractHolder: 'NOS', contractEndDate: emDias(20) })}
        onUpdated={vi.fn()}
      />
    );
    expect(await screen.findByText('CT-0042')).toBeTruthy();
    expect(screen.getByText('Sem SLA')).toBeTruthy();
    // Um aviso só, o do contrato: a contagem dos campos antigos sai, mas o aviso não some.
    await waitFor(() => expect(screen.getAllByText(/Vence em \d+ dias/)).toHaveLength(1));
    expect(screen.getByText('CT-0042').closest('li')?.textContent).toMatch(/Vence em \d+ dias/);
    expect(api.getContratos).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'e1' }));
  });

  it('contrato vencido tem selo na página da empresa', async () => {
    api.getContratos.mockResolvedValue({
      data: { itens: [contratoCom({ vigenciaFim: emDias(-5) })] },
    });
    renderizar(
      <ContractCard
        company={empresa({ contractHolder: 'NOS', contractEndDate: emDias(-5) })}
        onUpdated={vi.fn()}
      />
    );
    await screen.findByText('CT-0042');
    expect(screen.getAllByText('Vencido')).toHaveLength(1);
    expect(screen.getByText('CT-0042').closest('li')?.textContent).toContain('Vencido');
  });

  it('dois contratos com vencimentos diferentes: um selo para cada', async () => {
    api.getContratos.mockResolvedValue({
      data: {
        itens: [
          contratoCom({ vigenciaFim: emDias(20) }),
          contratoCom({ id: 'c2', numero: 'CT-0043', vigenciaFim: emDias(-1) }),
          contratoCom({ id: 'c3', numero: 'CT-0044' }),
        ],
      },
    });
    renderizar(<ContractCard company={empresa({ contractHolder: 'NOS' })} onUpdated={vi.fn()} />);
    await screen.findByText('CT-0042');
    expect(screen.getByText('CT-0042').closest('li')?.textContent).toMatch(/Vence em \d+ dias/);
    expect(screen.getByText('CT-0043').closest('li')?.textContent).toContain('Vencido');
    const semVigencia = screen.getByText('CT-0044').closest('li')?.textContent ?? '';
    expect(semVigencia).not.toMatch(/Vence|Vencido/);
  });

  it('saldo negativo aparece destacado; o positivo, não', async () => {
    api.getContratos.mockResolvedValue({
      data: {
        itens: [
          contratoCom({ saldo: -100, saldoDisponivel: true }),
          contratoCom({ id: 'c2', numero: 'CT-0043', saldo: 100, saldoDisponivel: true }),
        ],
      },
    });
    renderizar(<ContractCard company={empresa({ contractHolder: 'NOS' })} onUpdated={vi.fn()} />);
    await screen.findByText('CT-0042');
    const negativo = within(screen.getByText('CT-0042').closest('li') as HTMLElement).getByText(
      /-.*100/
    );
    expect(negativo.className).toContain('text-destructive');
    const positivo = within(screen.getByText('CT-0043').closest('li') as HTMLElement).getByText(
      /100,00/
    );
    expect(positivo.className).not.toContain('text-destructive');
  });

  it('NOS com contrato sem vigência: o aviso antigo fica, porque é o único', async () => {
    api.getContratos.mockResolvedValue({ data: { itens: [contratoCom({})] } });
    renderizar(
      <ContractCard
        company={empresa({ contractHolder: 'NOS', contractEndDate: emDias(20) })}
        onUpdated={vi.fn()}
      />
    );
    expect(await screen.findByText('CT-0042')).toBeTruthy();
    expect(screen.getByText(/Vence em \d+ dias/)).toBeTruthy();
  });
});

describe('ExpiringContractsWidget (E-08)', () => {
  it('mostra linha da empresa e linha do contrato, com o número', async () => {
    api.getExpiringContracts.mockResolvedValue({
      data: {
        windowDays: 90,
        companies: [
          {
            id: 'e1',
            name: 'Concorrida',
            contractHolder: 'CONCORRENTE',
            contractCompetitor: 'Rival',
            contractEndDate: emDias(10),
            contrato: null,
          },
          {
            id: 'e2',
            name: 'Nossa',
            contractHolder: 'NOS',
            contractCompetitor: null,
            contractEndDate: emDias(20),
            contrato: { id: 'c1', numero: 'CT-0042' },
          },
          {
            id: 'e2',
            name: 'Nossa',
            contractHolder: 'NOS',
            contractCompetitor: null,
            contractEndDate: emDias(30),
            contrato: { id: 'c2', numero: 'CT-0043' },
          },
        ],
      },
    });
    renderizar(<ExpiringContractsWidget />);
    expect(await screen.findByText('Concorrida')).toBeTruthy();
    expect(screen.getByText('Nossa · CT-0042')).toBeTruthy();
    expect(screen.getByText('Nossa · CT-0043')).toBeTruthy();
  });
});
