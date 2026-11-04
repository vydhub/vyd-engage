import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

/**
 * Tela de contratos (spec captura-demandas, E-07). Sem navegador neste ciclo: o bundle aponta
 * para produção, então a tela é conferida renderizada, com a API mockada.
 */
const api = vi.hoisted(() => ({
  getContratos: vi.fn(),
  getContrato: vi.fn(),
  getCompanies: vi.fn(),
  createContrato: vi.fn(),
  deleteContrato: vi.fn(),
  addContratoMovimento: vi.fn(),
}));
const auth = vi.hoisted(() => ({ user: { role: 'ADMIN', isPlatformAdmin: false } as unknown }));

vi.mock('../services/api/client', async (original) => ({
  ...(await original<typeof import('../services/api/client')>()),
  apiClient: api,
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }));

import { Contratos } from './Contratos';

const completo = {
  id: 'c1',
  numero: 'CT-0042',
  numeroCliente: '46',
  tipo: 'LTA',
  objeto: 'Serviços',
  escopo: null,
  vigenciaInicio: '2025-04-01T00:00:00.000Z',
  vigenciaFim: '2027-03-31T00:00:00.000Z',
  valorContratado: 2000000,
  saldo: 60000,
  saldoDisponivel: true,
  slaRespostaHoras: 24,
  gerenteNome: 'Gerente',
  gerenteEmail: 'g@e.com',
  planejadorNome: null,
  planejadorEmail: null,
  flowRecordId: 'f1',
  lacunas: [],
  companyId: 'e1',
  company: { id: 'e1', name: 'Cliente Exemplo' },
};
const comLacunas = {
  ...completo,
  id: 'c2',
  numero: 'G0025',
  tipo: 'GUARDA_CHUVA',
  valorContratado: null,
  saldo: null,
  saldoDisponivel: false,
  slaRespostaHoras: null,
  gerenteNome: null,
  gerenteEmail: null,
  lacunas: ['sem_solicitantes', 'sem_sla', 'sem_valor', 'sem_gerente'],
};
const negativo = { ...completo, id: 'c3', numero: 'NEG-1', saldo: -1500 };

function abrir(url = '/app/contratos') {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[url]}>
        <Contratos />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { role: 'ADMIN', isPlatformAdmin: false };
  api.getCompanies.mockResolvedValue({ companies: [{ id: 'e1', name: 'Cliente Exemplo' }] });
  api.getContratos.mockResolvedValue({
    data: {
      itens: [completo, comLacunas, negativo],
      paginacao: { page: 1, limit: 25, total: 3, totalPages: 1 },
    },
  });
  api.getContrato.mockResolvedValue({
    data: {
      ...completo,
      solicitantes: [{ id: 's1', nome: 'Fiscal', email: 'fiscal@cliente.com.br' }],
      itens: [{ id: 'i1', descricao: 'Manutenção', disciplina: 'Mecânica' }],
      movimentos: [],
    },
  });
});

describe('Contratos (E-07)', () => {
  it('lista contratos, saldo e lacunas; sem valor, saldo não disponível', async () => {
    abrir();
    expect(await screen.findByText('CT-0042')).toBeTruthy();
    expect(screen.getByText('G0025')).toBeTruthy();
    expect(screen.getByText('Não disponível')).toBeTruthy();
    expect(screen.getByText('Sem solicitantes')).toBeTruthy();
    expect(screen.getByText('Sem gerente')).toBeTruthy();
    // Saldo negativo aceito e destacado.
    const saldoNegativo = screen.getByText(/1\.500,00/);
    expect(saldoNegativo.className).toContain('text-destructive');
  });

  it('ADMIN e GESTOR têm os comandos de edição', async () => {
    auth.user = { role: 'GESTOR', isPlatformAdmin: false };
    abrir();
    await screen.findByText('CT-0042');
    expect(screen.getByRole('button', { name: /Novo contrato/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Editar CT-0042' })).toBeTruthy();
  });

  it('os demais usuários do tenant só leem', async () => {
    auth.user = { role: 'USER', isPlatformAdmin: false };
    abrir();
    await screen.findByText('CT-0042');
    expect(screen.queryByRole('button', { name: /Novo contrato/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar CT-0042' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Excluir CT-0042' })).toBeNull();
  });

  it('o link com ?contrato= abre o detalhe, com solicitantes', async () => {
    abrir('/app/contratos?contrato=c1');
    expect(await screen.findByText('Fiscal')).toBeTruthy();
    expect(screen.getByText('fiscal@cliente.com.br')).toBeTruthy();
    expect(api.getContrato).toHaveBeenCalledWith('c1');
  });

  it('o filtro de empresa do link vai para a consulta', async () => {
    abrir('/app/contratos?empresa=e1');
    await screen.findByText('CT-0042');
    expect(api.getContratos).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'e1' }));
  });

  it('número repetido mostra a mensagem do servidor, com o contrato existente', async () => {
    api.createContrato.mockRejectedValue(
      new Error('Já existe o contrato E2180 (Cliente Exemplo).')
    );
    abrir('/app/contratos?empresa=e1');
    await screen.findByText('CT-0042');
    fireEvent.click(screen.getByRole('button', { name: /Novo contrato/ }));
    const numero = await screen.findByLabelText('Número *');
    fireEvent.change(numero, { target: { value: 'E2180' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Já existe o contrato E2180')
    );
  });

  it('sem contratos, explica em vez de mostrar tabela vazia', async () => {
    api.getContratos.mockResolvedValue({
      data: { itens: [], paginacao: { page: 1, limit: 25, total: 0, totalPages: 1 } },
    });
    abrir();
    expect(await screen.findByText('Nenhum contrato encontrado')).toBeTruthy();
  });
});
