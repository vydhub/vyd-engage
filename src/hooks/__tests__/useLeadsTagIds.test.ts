import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * O backend valida `tagIds` como z.array(z.string().uuid()) — array de STRINGS
 * (server/src/routes/leads.ts). As telas de lead montavam a lista como
 * `[{ id }]`, e o payload ia assim para a API, que respondia
 * 400 "Validation error" ao salvar.
 *
 * O bug ficou invisível por muito tempo porque, na rota, o enforceLimit do plano
 * roda ANTES do parse do schema: enquanto o plano ENTERPRISE (-1) barrava tudo
 * com 403, este 400 nunca chegava a aparecer.
 */

const createLead = vi.fn().mockResolvedValue({ id: 'l1', name: 'X', status: 'NEW', source: 'OTHER' });
const updateLead = vi.fn().mockResolvedValue({ id: 'l1', name: 'X', status: 'NEW', source: 'OTHER' });

vi.mock('../../services/api/client', () => ({
  apiClient: {
    createLead: (...a: unknown[]) => createLead(...a),
    updateLead: (...a: unknown[]) => updateLead(...a),
    getLeads: vi.fn().mockResolvedValue({ leads: [], pagination: {} }),
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../useSocket', () => ({ useSocket: () => ({ on: () => () => {} }) }));
vi.mock('../../lib/approvalResponse', () => ({ handlePendingApproval: (r: unknown) => r }));

const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const React = await import('react');
const { useLeads } = await import('../useLeads');

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

describe('useLeads — tagIds enviados ao backend', () => {
  beforeEach(() => vi.clearAllMocks());

  it('envia array de STRINGS quando a tela manda objetos [{id}] (o bug do 400)', async () => {
    const { result } = renderHook(() => useLeads(), { wrapper });
    await act(async () => {
      await result.current.createLead({
        name: 'Lead teste',
        tags: [{ id: UUID_A }, { id: UUID_B }] as never,
      });
    });
    expect(createLead).toHaveBeenCalledTimes(1);
    expect(createLead.mock.calls[0][0].tagIds).toEqual([UUID_A, UUID_B]);
  });

  it('mantém array de strings quando a tela já manda ids', async () => {
    const { result } = renderHook(() => useLeads(), { wrapper });
    await act(async () => {
      await result.current.createLead({ name: 'Lead teste', tags: [UUID_A] as never });
    });
    expect(createLead.mock.calls[0][0].tagIds).toEqual([UUID_A]);
  });

  it('sem tags envia lista vazia (nunca undefined/null)', async () => {
    const { result } = renderHook(() => useLeads(), { wrapper });
    await act(async () => {
      await result.current.createLead({ name: 'Lead teste' });
    });
    expect(createLead.mock.calls[0][0].tagIds).toEqual([]);
  });

  it('vale também para updateLead', async () => {
    const { result } = renderHook(() => useLeads(), { wrapper });
    await act(async () => {
      await result.current.updateLead('l1', { tags: [{ id: UUID_A }] as never });
    });
    expect(updateLead.mock.calls[0][1].tagIds).toEqual([UUID_A]);
  });

  it('descarta entradas sem id em vez de mandar string vazia (que o uuid() rejeitaria)', async () => {
    const { result } = renderHook(() => useLeads(), { wrapper });
    await act(async () => {
      await result.current.createLead({
        name: 'Lead teste',
        tags: [{ id: UUID_A }, {}, null, ''] as never,
      });
    });
    expect(createLead.mock.calls[0][0].tagIds).toEqual([UUID_A]);
  });

  it('shape CRU da API (linhas de LeadTag) envia o id da TAG, não o da junção', async () => {
    // GET /leads/:id devolve tags como linhas de LeadTag:
    // {id: <id da LINHA>, tagId, tag: {id}}. Mandar o id da linha apagaria as
    // tags no PUT (uuid válido que não é Tag → FK violada no backend).
    const { result } = renderHook(() => useLeads(), { wrapper });
    await act(async () => {
      await result.current.updateLead('l1', {
        tags: [
          { id: 'aaaaaaaa-0000-4000-8000-000000000001', tagId: UUID_A, tag: { id: UUID_A } },
          { id: 'aaaaaaaa-0000-4000-8000-000000000002', tagId: UUID_B, tag: { id: UUID_B } },
        ] as never,
      });
    });
    expect(updateLead.mock.calls[0][1].tagIds).toEqual([UUID_A, UUID_B]);
  });
});

/**
 * Campos de texto opcionais não podem ir como string vazia: o backend valida
 * `email` com .email().optional() e `assignedTo` com .uuid().optional(), e o
 * `.optional()` do Zod aceita `undefined`, NÃO `''`. Salvar um lead sem e-mail
 * (campo opcional na tela) devolvia 400 "Validation error".
 */
describe('useLeads — campos opcionais vazios', () => {
  beforeEach(() => vi.clearAllMocks());

  it('e-mail vazio vira undefined, não string vazia (a causa do 400)', async () => {
    const { result } = renderHook(() => useLeads(), { wrapper });
    await act(async () => {
      await result.current.createLead({ name: 'Sem e-mail', email: '' });
    });
    expect(createLead.mock.calls[0][0].email).toBeUndefined();
  });

  it('e-mail preenchido passa intacto (com trim)', async () => {
    const { result } = renderHook(() => useLeads(), { wrapper });
    await act(async () => {
      await result.current.createLead({ name: 'X', email: '  alguem@k2mais.com.br  ' });
    });
    expect(createLead.mock.calls[0][0].email).toBe('alguem@k2mais.com.br');
  });

  it('assignedTo vazio vira undefined (reprovaria no uuid)', async () => {
    const { result } = renderHook(() => useLeads(), { wrapper });
    await act(async () => {
      await result.current.createLead({ name: 'X', assignedTo: '' });
    });
    expect(createLead.mock.calls[0][0].assignedTo).toBeUndefined();
  });

  it('vale também para o update', async () => {
    const { result } = renderHook(() => useLeads(), { wrapper });
    await act(async () => {
      await result.current.updateLead('l1', { email: '', phone: '' });
    });
    expect(updateLead.mock.calls[0][1].email).toBeUndefined();
    expect(updateLead.mock.calls[0][1].phone).toBeUndefined();
  });
});
