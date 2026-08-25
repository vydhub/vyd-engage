import { useState, useMemo } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Loader2, Search } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../ui/command';
import { Button } from '../ui/button';
import { useDebounce } from '../../hooks/useDebounce';
import { apiClient } from '../../services/api/client';
import { cn } from '../ui/utils';

interface Empresa {
  id: string;
  name: string;
}

interface CompanyPickerProps {
  value?: string;
  onChange: (companyId: string, company?: Empresa) => void;
  placeholder?: string;
  /** Some com o item "nenhuma" (usado quando o campo é obrigatório). */
  required?: boolean;
  disabled?: boolean;
  id?: string;
}

const LIMITE = 50;

/**
 * Seletor de empresa com BUSCA NO SERVIDOR.
 *
 * Substitui o `<Select>` que carregava `getCompanies({ limit: 100 })` e listava
 * tudo de uma vez: o tenant tem 219 empresas, então mais da metade era
 * inalcançável e não havia como filtrar por texto — só rolar.
 *
 * Aqui a busca vai ao backend (que já aceita `search`), com debounce, e a lista
 * é curta por definição. A empresa já selecionada é buscada à parte, para o
 * rótulo continuar certo mesmo quando ela não está na página atual de
 * resultados — sem isso o campo mostraria o id cru após escolher e filtrar de novo.
 */
export function CompanyPicker({
  value,
  onChange,
  placeholder = 'Selecione a empresa',
  required = false,
  disabled = false,
  id,
}: CompanyPickerProps) {
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState('');
  const buscaDebounced = useDebounce(busca, 300);

  const listaQuery = useQuery({
    queryKey: ['companies', 'picker', buscaDebounced],
    queryFn: () =>
      apiClient.getCompanies({
        limit: LIMITE,
        ...(buscaDebounced.trim() ? { search: buscaDebounced.trim() } : {}),
      }),
    enabled: open,
    placeholderData: keepPreviousData,
  });

  const empresas = (listaQuery.data?.companies ?? []) as unknown as Empresa[];
  const total = (listaQuery.data as { pagination?: { total?: number } } | undefined)?.pagination
    ?.total;

  // Rótulo do selecionado: pode não estar na página atual de resultados.
  const selecionadaNaLista = useMemo(
    () => empresas.find((e) => e.id === value),
    [empresas, value]
  );
  const selecionadaQuery = useQuery({
    queryKey: ['company', value],
    queryFn: () => apiClient.getCompany(value!) as unknown as Promise<Empresa>,
    enabled: !!value && !selecionadaNaLista,
    staleTime: 5 * 60_000,
  });
  const rotulo = selecionadaNaLista?.name ?? selecionadaQuery.data?.name;

  const escolher = (empresa?: Empresa) => {
    onChange(empresa?.id ?? '', empresa);
    setOpen(false);
    setBusca('');
  };

  const restantes = typeof total === 'number' ? total - empresas.length : 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className={cn('truncate', !rotulo && 'text-muted-foreground')}>
            {rotulo ?? placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
        // `shouldFilter={false}`: quem filtra é o servidor. Sem isto o cmdk
        // filtraria DE NOVO no cliente, escondendo resultados legítimos.
      >
        <Command shouldFilter={false}>
          <div className="flex items-center border-b px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <CommandInput
              value={busca}
              onValueChange={setBusca}
              placeholder="Buscar empresa…"
              className="h-10 border-0 p-0 focus:ring-0"
            />
            {listaQuery.isFetching && <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin opacity-50" />}
          </div>

          <CommandList className="max-h-72">
            {!listaQuery.isFetching && empresas.length === 0 && (
              <CommandEmpty>
                {buscaDebounced.trim()
                  ? `Nenhuma empresa encontrada para "${buscaDebounced.trim()}".`
                  : 'Nenhuma empresa cadastrada.'}
              </CommandEmpty>
            )}

            <CommandGroup>
              {!required && (
                <CommandItem value="__nenhuma__" onSelect={() => escolher(undefined)}>
                  <Check className={cn('mr-2 h-4 w-4', value ? 'opacity-0' : 'opacity-100')} />
                  <span className="text-muted-foreground">Nenhuma</span>
                </CommandItem>
              )}
              {empresas.map((empresa) => (
                <CommandItem
                  key={empresa.id}
                  value={empresa.id}
                  onSelect={() => escolher(empresa)}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      value === empresa.id ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span className="truncate">{empresa.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>

            {/* Diz quantas ficaram de fora em vez de truncar em silêncio. */}
            {restantes > 0 && (
              <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                Mostrando {empresas.length} de {total}. Refine a busca para ver as demais.
              </p>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
