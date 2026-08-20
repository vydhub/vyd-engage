import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

/**
 * Rascunho de formulário que sobrevive à navegação entre rotas.
 *
 * O problema: cada rota do app é lazy e desmonta ao sair — quem estava
 * preenchendo "Nova Tarefa" e ia consultar uma empresa voltava para o
 * formulário em branco. Este hook substitui o `useState` do formulário e
 * espelha o valor em `sessionStorage`, restaurando-o quando a tela remonta.
 *
 * Decisões:
 *  - `sessionStorage` (não `localStorage`): o rascunho acompanha a ABA e some
 *    quando ela fecha. Dado de CRM não fica esquecido no disco da máquina.
 *  - Chave namespaced por usuário: logout/login na mesma aba não expõe o
 *    rascunho de outra pessoa.
 *  - TTL de 24h: rascunho velho é descartado em vez de ressuscitar semanas
 *    depois em cima de dados que já mudaram.
 *  - Grava só quando o formulário está SUJO (diferente do inicial), para não
 *    criar rascunho de tela que o usuário apenas abriu e fechou.
 */

const PREFIX = 'vyd.draft';
const TTL_MS = 24 * 60 * 60 * 1000;
const DEBOUNCE_MS = 300;

interface StoredDraft<T> {
  savedAt: number;
  values: T;
}

/** Rascunhos existentes (para telas que só querem sinalizar "há algo pendente"). */
export function readDraftMeta<T = unknown>(
  key: string,
  userId?: string
): { values: T; savedAt: number } | null {
  try {
    const raw = sessionStorage.getItem(`${PREFIX}.${userId || 'anon'}.${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft<T>;
    if (!parsed || typeof parsed.savedAt !== 'number') return null;
    if (Date.now() - parsed.savedAt > TTL_MS) return null;
    return { values: parsed.values, savedAt: parsed.savedAt };
  } catch {
    return null;
  }
}

/**
 * Lista os rascunhos vivos de um prefixo ('task.', 'lead.') — usado pelas
 * listagens para oferecer "retomar" o que ficou pela metade.
 */
export function listDrafts<T = unknown>(
  prefix: string,
  userId?: string
): Array<{ key: string; values: T; savedAt: number }> {
  const out: Array<{ key: string; values: T; savedAt: number }> = [];
  try {
    const base = `${PREFIX}.${userId || 'anon'}.`;
    for (let i = 0; i < sessionStorage.length; i++) {
      const full = sessionStorage.key(i);
      if (!full || !full.startsWith(base)) continue;
      const key = full.slice(base.length);
      if (!key.startsWith(prefix)) continue;
      const meta = readDraftMeta<T>(key, userId);
      if (meta) out.push({ key, values: meta.values, savedAt: meta.savedAt });
    }
  } catch {
    return out;
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

export function discardDraft(key: string, userId?: string) {
  try {
    sessionStorage.removeItem(`${PREFIX}.${userId || 'anon'}.${key}`);
  } catch {
    // storage indisponível (modo privado/quota) — rascunho é best-effort
  }
}

export interface FormDraftControls {
  /** true quando o valor atual veio de um rascunho restaurado, não do inicial. */
  restored: boolean;
  /** Apaga o rascunho — chamar ao salvar ou cancelar explicitamente. */
  clear: () => void;
}

export function useFormDraft<T>(
  /** Identificador estável do formulário: 'task.new', 'task.<id>', 'lead.new'… */
  key: string,
  initial: T,
  options?: {
    /** Desliga a persistência (ex.: enquanto os dados do servidor não chegaram). */
    enabled?: boolean;
    /** Define "sujo". Default: serialização diferente do valor inicial. */
    isDirty?: (values: T) => boolean;
  }
): [T, React.Dispatch<React.SetStateAction<T>>, FormDraftControls] {
  const { user } = useAuth();
  const enabled = options?.enabled !== false;
  const storageKey = `${PREFIX}.${user?.id || 'anon'}.${key}`;

  // Serialização do inicial: base da comparação "sujo" e do reset ao trocar de chave.
  const initialJson = useMemo(() => JSON.stringify(initial), [initial]);
  const initialJsonRef = useRef(initialJson);
  initialJsonRef.current = initialJson;

  const restoredRef = useRef(false);
  const [values, setValues] = useState<T>(() => {
    if (!enabled) return initial;
    const draft = readDraftMeta<T>(key, user?.id);
    if (draft) {
      restoredRef.current = true;
      return draft.values;
    }
    return initial;
  });

  const clearedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || clearedRef.current) return;
    const dirty = options?.isDirty
      ? options.isDirty(values)
      : JSON.stringify(values) !== initialJsonRef.current;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      try {
        if (dirty) {
          const payload: StoredDraft<T> = { savedAt: Date.now(), values };
          sessionStorage.setItem(storageKey, JSON.stringify(payload));
        } else {
          sessionStorage.removeItem(storageKey);
        }
      } catch {
        // storage indisponível — segue sem rascunho
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // `options.isDirty` é lido por referência a cada execução; não entra nas deps
    // para não exigir memoização no chamador.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, storageKey, enabled]);

  // Grava imediatamente se a aba for escondida/fechada no meio da digitação
  // (o debounce sozinho perderia os últimos caracteres).
  useEffect(() => {
    if (!enabled) return;
    const flush = () => {
      if (clearedRef.current) return;
      try {
        const dirty = options?.isDirty
          ? options.isDirty(values)
          : JSON.stringify(values) !== initialJsonRef.current;
        if (dirty) {
          sessionStorage.setItem(
            storageKey,
            JSON.stringify({ savedAt: Date.now(), values } as StoredDraft<T>)
          );
        }
      } catch {
        // best-effort
      }
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, storageKey, enabled]);

  const clear = useCallback(() => {
    clearedRef.current = true;
    restoredRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // best-effort
    }
  }, [storageKey]);

  return [values, setValues, { restored: restoredRef.current, clear }];
}
