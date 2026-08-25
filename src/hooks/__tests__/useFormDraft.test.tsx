import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFormDraft, listDrafts, readDraftMeta, discardDraft } from '../useFormDraft';

/**
 * Rascunho de formulário (pedido da área comercial: navegar entre abas do
 * sistema não pode apagar o que estava sendo digitado).
 */

let currentUser: { id: string } | null = { id: 'user-1' };
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: currentUser }),
}));

const inicial = { title: '', description: '', priority: 'MEDIUM' };

beforeEach(() => {
  sessionStorage.clear();
  vi.useRealTimers();
  currentUser = { id: 'user-1' };
});

async function esperaDebounce() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 400));
  });
}

describe('useFormDraft', () => {
  it('grava o rascunho quando o formulário fica sujo', async () => {
    const { result } = renderHook(() => useFormDraft('task.new', inicial));
    act(() => result.current[1]({ ...inicial, title: 'Visita à mina' }));
    await esperaDebounce();

    expect(readDraftMeta('task.new', 'user-1')?.values).toMatchObject({ title: 'Visita à mina' });
  });

  it('restaura o que foi digitado quando a tela remonta (volta da outra rota)', async () => {
    const primeira = renderHook(() => useFormDraft('task.new', inicial));
    act(() => primeira.result.current[1]({ ...inicial, title: 'Proposta CBL' }));
    await esperaDebounce();
    primeira.unmount(); // navegou para outra aba do sistema

    const segunda = renderHook(() => useFormDraft('task.new', inicial));
    expect(segunda.result.current[0]).toMatchObject({ title: 'Proposta CBL' });
    expect(segunda.result.current[2].restored).toBe(true);
  });

  it('formulário apenas aberto e fechado não deixa rascunho', async () => {
    const { result } = renderHook(() => useFormDraft('task.new', inicial));
    act(() => result.current[1]({ ...inicial }));
    await esperaDebounce();

    expect(readDraftMeta('task.new', 'user-1')).toBeNull();
  });

  it('clear() apaga o rascunho (salvar/cancelar) e não regrava depois', async () => {
    const { result } = renderHook(() => useFormDraft('task.new', inicial));
    act(() => result.current[1]({ ...inicial, title: 'Some' }));
    await esperaDebounce();
    act(() => result.current[2].clear());
    await esperaDebounce();

    expect(readDraftMeta('task.new', 'user-1')).toBeNull();
  });

  it('isola rascunhos por usuário (login de outra pessoa na mesma aba)', async () => {
    const { result, unmount } = renderHook(() => useFormDraft('task.new', inicial));
    act(() => result.current[1]({ ...inicial, title: 'Do Kleber' }));
    await esperaDebounce();
    unmount();

    currentUser = { id: 'user-2' };
    const outro = renderHook(() => useFormDraft('task.new', inicial));
    expect(outro.result.current[0]).toMatchObject({ title: '' });
    expect(outro.result.current[2].restored).toBe(false);
  });

  it('descarta rascunho expirado (TTL de 24h)', () => {
    const velho = { savedAt: Date.now() - 25 * 60 * 60 * 1000, values: { title: 'Antigo' } };
    sessionStorage.setItem('vyd.draft.user-1.task.new', JSON.stringify(velho));

    expect(readDraftMeta('task.new', 'user-1')).toBeNull();
    const { result } = renderHook(() => useFormDraft('task.new', inicial));
    expect(result.current[0]).toMatchObject({ title: '' });
  });

  it('storage corrompido não derruba a tela', () => {
    sessionStorage.setItem('vyd.draft.user-1.task.new', '{lixo');
    const { result } = renderHook(() => useFormDraft('task.new', inicial));
    expect(result.current[0]).toMatchObject(inicial);
  });

  it('listDrafts enumera por prefixo e discardDraft remove', async () => {
    const a = renderHook(() => useFormDraft('task.new', inicial));
    act(() => a.result.current[1]({ ...inicial, title: 'Tarefa A' }));
    await esperaDebounce();
    const b = renderHook(() => useFormDraft('lead.new', inicial));
    act(() => b.result.current[1]({ ...inicial, title: 'Lead B' }));
    await esperaDebounce();

    expect(listDrafts('task.', 'user-1')).toHaveLength(1);
    expect(listDrafts('lead.', 'user-1')).toHaveLength(1);

    discardDraft('task.new', 'user-1');
    expect(listDrafts('task.', 'user-1')).toHaveLength(0);
  });
});
