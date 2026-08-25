import { useEffect, useState } from 'react';

/**
 * Valor que só acompanha a origem depois de `delay` ms parado.
 *
 * Usado em campos de busca que consultam o servidor: sem isto, cada tecla
 * dispara uma requisição.
 */
export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);

  return debounced;
}
