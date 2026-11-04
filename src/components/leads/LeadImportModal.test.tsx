import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

/**
 * Importar Leads (FRG-178): o passo final mostra o relatório de erros que a
 * rota devolve (antes a tela guardava só os três totais), e o passo de
 * conferência avisa ANTES de confirmar quando a planilha não tem os vínculos.
 */
const api = vi.hoisted(() => ({ importLeads: vi.fn() }));

vi.mock('../../services/api/client', async (original) => ({
  ...(await original<typeof import('../../services/api/client')>()),
  apiClient: api,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { LeadImportModal } from './LeadImportModal';

const MODELO_NOVO = [
  'name,company,contact_email,source,status',
  'Oportunidade A,ABC Ltda,joao@abc.com.br,Prospecção ativa,Novo',
  'Oportunidade B,Empresa X,ana@x.com,Outros,Novo',
  'Oportunidade C,Empresa Y,bia@y.com,Outros,Novo',
].join('\n');

const PLANILHA_ANTIGA = [
  'name,email,phone,company,source,status',
  'Maria Silva,maria@email.com,(11)99999-0000,ABC Ltda,WEBSITE,NEW',
].join('\n');

async function abrirComArquivo(csv: string) {
  const { container } = render(
    <LeadImportModal open onClose={() => {}} onImportComplete={() => {}} />
  );
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const arquivo = new File([csv], 'leads.csv', { type: 'text/csv' });
  fireEvent.change(input, { target: { files: [arquivo] } });
  await screen.findByText('Mapeamento de colunas');
}

beforeEach(() => api.importLeads.mockReset());

describe('LeadImportModal', () => {
  it('passo final renderiza a linha e o motivo de cada erro devolvido pela rota', async () => {
    api.importLeads.mockResolvedValue({
      imported: 2,
      skipped: 0,
      failed: 1,
      errors: [{ row: 3, error: 'Empresa não encontrada' }],
    });
    await abrirComArquivo(MODELO_NOVO);
    fireEvent.click(screen.getByText('Continuar'));
    fireEvent.click(await screen.findByText(/Confirmar Importacao/));

    const relatorio = await screen.findByTestId('relatorio-de-erros');
    expect(within(relatorio).getByText('3')).toBeInTheDocument();
    expect(within(relatorio).getByText('Empresa não encontrada')).toBeInTheDocument();
  });

  it('manda ao servidor os títulos novos, sem traduzir origem/status no navegador', async () => {
    api.importLeads.mockResolvedValue({ imported: 3, skipped: 0, failed: 0, errors: [] });
    await abrirComArquivo(MODELO_NOVO);
    fireEvent.click(screen.getByText('Continuar'));
    fireEvent.click(await screen.findByText(/Confirmar Importacao/));

    await waitFor(() => expect(api.importLeads).toHaveBeenCalled());
    const [primeira] = api.importLeads.mock.calls[0][0].leads;
    expect(primeira).toEqual({
      name: 'Oportunidade A',
      company: 'ABC Ltda',
      contact_email: 'joao@abc.com.br',
      source: 'Prospecção ativa',
      status: 'Novo',
    });
  });

  it('planilha antiga (seis colunas): avisa ANTES de confirmar que nenhuma linha entra', async () => {
    await abrirComArquivo(PLANILHA_ANTIGA);
    fireEvent.click(screen.getByText('Continuar'));

    const aviso = await screen.findByTestId('aviso-vinculos');
    expect(aviso).toHaveTextContent('Nenhuma linha vai entrar');
    expect(api.importLeads).not.toHaveBeenCalled();
  });

  it('com empresa e contato mapeados não há aviso', async () => {
    await abrirComArquivo(MODELO_NOVO);
    fireEvent.click(screen.getByText('Continuar'));
    await screen.findByText(/Confirmar Importacao/);
    expect(screen.queryByTestId('aviso-vinculos')).not.toBeInTheDocument();
  });

  it('reconhece os rótulos em português da tela e não confunde "E-mail do contato" com o e-mail do lead', async () => {
    api.importLeads.mockResolvedValue({ imported: 1, skipped: 0, failed: 0, errors: [] });
    await abrirComArquivo(
      [
        'Nome da oportunidade;Empresa;E-mail do contato;E-mail;Valor estimado (Budget);Probabilidade Go×Get',
        'Proposta ABC;ABC Ltda;joao@abc.com.br;lead@abc.com.br;"1.234,56";70',
      ].join('\n')
    );
    fireEvent.click(screen.getByText('Continuar'));
    fireEvent.click(await screen.findByText(/Confirmar Importacao/));

    await waitFor(() => expect(api.importLeads).toHaveBeenCalled());
    expect(api.importLeads.mock.calls[0][0].leads[0]).toEqual({
      name: 'Proposta ABC',
      company: 'ABC Ltda',
      contact_email: 'joao@abc.com.br',
      email: 'lead@abc.com.br',
      estimated_value: '1.234,56',
      probability_go_get: '70',
    });
  });
});
