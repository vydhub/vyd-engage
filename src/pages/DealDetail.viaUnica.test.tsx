import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';

/**
 * Via única na tela do Negócio (spec captura-demandas, E-16). A tela troca o estado pela resposta
 * de cada edição, e a trava não pode sumir depois da primeira. Os filhos pesados ficam de fora:
 * o que importa aqui é o aviso, as ações de status e a aba de produtos.
 */
const api = vi.hoisted(() => ({
  getDeal: vi.fn(),
  getDealInteractions: vi.fn(async () => []),
  getSalesFlags: vi.fn(async () => ({ data: {} })),
  getFunnel: vi.fn(async () => ({ data: { columns: [{ id: 'c1', title: 'Em orçamento' }] } })),
  getApiUrl: vi.fn(() => ''),
  updateDeal: vi.fn(),
}));

vi.mock('../services/api/client', async (original) => ({
  ...(await original<typeof import('../services/api/client')>()),
  apiClient: api,
}));

const nulo = vi.hoisted(() => () => null);
vi.mock('../components/Header', () => ({ Header: nulo }));
vi.mock('../components/deals/DealForm', () => ({ DealForm: nulo }));
vi.mock('../components/deals/DealAIScore', () => ({ DealAIScore: nulo }));
vi.mock('../components/deals/QuestionnaireSection', () => ({ QuestionnaireSection: nulo }));
vi.mock('../components/deals/SendEmailDialog', () => ({ SendEmailDialog: nulo }));
vi.mock('../components/deals/MultiSaleDialog', () => ({ MultiSaleDialog: nulo }));
vi.mock('../components/deals/CelebrationModal', () => ({ CelebrationModal: nulo }));
vi.mock('../components/deals/ScheduledDealsSection', () => ({ ScheduledDealsSection: nulo }));
vi.mock('../components/deals/ProposalsSection', () => ({ ProposalsSection: nulo }));
vi.mock('../components/deals/MeetingsSection', () => ({ MeetingsSection: nulo }));
vi.mock('../components/attachments/AttachmentsTab', () => ({ AttachmentsTab: nulo }));
vi.mock('../components/lead/WhatsAppSendPanel', () => ({ WhatsAppSendPanel: nulo }));
vi.mock('../components/NextActionCard', () => ({ NextActionCard: nulo }));
vi.mock('../components/ai/AIDraftDialog', () => ({ AIDraftDialog: nulo }));
vi.mock('../components/AuditTimeline', () => ({ AuditTimeline: nulo }));
vi.mock('../hooks/useAIStatus', () => ({ useAIStatus: () => ({ enabled: false }) }));
vi.mock('../components/deals/QualificationStars', () => ({
  QualificationStars: ({ onChange }: { onChange: (nivel: number) => void }) => (
    <button type="button" onClick={() => onChange(3)}>
      Dar estrela
    </button>
  ),
  qualificationLevelName: () => '',
  useQualificationConfig: () => ({ data: undefined }),
}));
const produtos = vi.hoisted(() => ({ somenteLeitura: undefined as boolean | undefined }));
vi.mock('../components/deals/DealProducts', () => ({
  DealProducts: ({ somenteLeitura }: { somenteLeitura?: boolean }) => {
    produtos.somenteLeitura = somenteLeitura;
    return <div>Itens do negócio</div>;
  },
}));

import { DealDetail } from './DealDetail';

// Tela inteira em jsdom: com a suíte toda em paralelo, a primeira montagem passa de 5 s.
vi.setConfig({ testTimeout: 15_000 });

const demanda = {
  id: 'dem-1',
  flowCardId: 'card-1',
  estado: 'em_orcamento',
  cenario: 'contrato_novo',
  valorEnviado: null,
  valorAprovado: null,
  linkOriginal: null,
};
const negocio = (extra: Record<string, unknown> = {}) => ({
  id: 'd1',
  name: 'Demanda da Captura',
  value: '85000.00',
  stage: 'QUALIFICATION',
  status: 'OPEN',
  funnelId: 'f1',
  funnelColumnId: 'c1',
  updatedAt: new Date().toISOString(),
  demanda,
  ...extra,
});

function abrir() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/app/deals/d1']}>
        <Routes>
          <Route path="/app/deals/:id" element={<DealDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  produtos.somenteLeitura = undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => [] }))
  );
});

describe('DealDetail com Negócio da Captura (E-16)', () => {
  it('mostra o aviso e tira as ações de status', async () => {
    api.getDeal.mockResolvedValue(negocio());
    abrir();
    expect(await screen.findByText('Andamento controlado pelo Flow')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Marcar venda' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Marcar perda' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pausar' })).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Em orçamento' }).hasAttribute('disabled')).toBe(
        true
      )
    );
  });

  it('a trava continua depois de uma edição, com a resposta do PUT', async () => {
    api.getDeal.mockResolvedValue(negocio());
    api.updateDeal.mockResolvedValue(negocio({ qualification: 3 }));
    abrir();
    fireEvent.click(await screen.findByRole('button', { name: 'Dar estrela' }));

    await waitFor(() => expect(api.updateDeal).toHaveBeenCalledWith('d1', { qualification: 3 }));
    await waitFor(() => expect(screen.getByText('Andamento controlado pelo Flow')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Marcar venda' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pausar' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Em orçamento' }).hasAttribute('disabled')).toBe(
      true
    );
  });

  it('Negócio comum segue com as ações', async () => {
    api.getDeal.mockResolvedValue(negocio({ demanda: null }));
    abrir();
    expect(await screen.findByRole('button', { name: 'Marcar venda' })).toBeTruthy();
    expect(screen.queryByText('Andamento controlado pelo Flow')).toBeNull();
  });

  it('produtos ficam só para leitura depois que o Flow informa o valor (E-15)', async () => {
    api.getDeal.mockResolvedValue(negocio({ demanda: { ...demanda, valorEnviado: '125000.00' } }));
    abrir();
    await screen.findByText('Andamento controlado pelo Flow');
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Produtos/ }));
    await screen.findByText('Itens do negócio');
    expect(produtos.somenteLeitura).toBe(true);
  });

  it('antes do Flow informar o valor, os produtos seguem livres', async () => {
    api.getDeal.mockResolvedValue(negocio());
    abrir();
    await screen.findByText('Andamento controlado pelo Flow');
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Produtos/ }));
    await screen.findByText('Itens do negócio');
    expect(produtos.somenteLeitura).toBe(false);
  });
});
