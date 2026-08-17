import { useMemo, useState } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Loader2, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useDebounce } from '../../hooks/useDebounce';
import { apiClient, ApiError } from '../../services/api/client';
import { cn } from '../ui/utils';

interface Empresa {
  id: string;
  name: string;
}

interface Segmento {
  id: string;
  name: string;
  active?: boolean;
}

interface CompanyQuickSelectProps {
  value?: string;
  onChange: (companyId: string, company?: Empresa) => void;
  disabled?: boolean;
  id?: string;
}

const LIMITE = 50;
const SEM_SEGMENTO = '__none__';

/**
 * Combobox de Empresa com busca no servidor + cadastro rápido inline
 * (specs/leads-oportunidade req. 3). Mecânica de busca copiada do
 * `comercial/CompanyPicker` (Popover+Command, debounce 300ms, rehidratação do
 * rótulo da selecionada), acrescida do item "+ Criar nova empresa" que abre um
 * mini-formulário (Nome*, CNPJ e Segmento opcionais).
 *
 * - Dedupe (caso extremo 3): antes de criar, busca por nome (case-insensitive)
 *   e oferece a existente ("Usar esta"); criar mesmo assim continua permitido.
 * - Sem permissão / limite de plano (casos 4 e 6): o erro do backend aparece
 *   dentro do mini-dialog, sem fechar o formulário principal.
 */
export function CompanyQuickSelect({ value, onChange, disabled = false, id }: CompanyQuickSelectProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState('');
  const buscaDebounced = useDebounce(busca, 300);

  // Mini-dialog de criação
  const [dialogAberto, setDialogAberto] = useState(false);
  const [nome, setNome] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [segmentId, setSegmentId] = useState(SEM_SEGMENTO);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [duplicata, setDuplicata] = useState<Empresa | null>(null);

  const listaQuery = useQuery({
    queryKey: ['companies', 'quick-select', buscaDebounced],
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

  // Rótulo da selecionada: pode não estar na página atual de resultados.
  const selecionadaNaLista = useMemo(() => empresas.find((e) => e.id === value), [empresas, value]);
  const selecionadaQuery = useQuery({
    queryKey: ['company-quick', value],
    queryFn: async () => {
      const raw = await apiClient.getCompany(value!);
      return ((raw as { data?: unknown }).data ?? raw) as Empresa;
    },
    enabled: !!value && !selecionadaNaLista,
    staleTime: 5 * 60_000,
  });
  const rotulo = selecionadaNaLista?.name ?? selecionadaQuery.data?.name;

  const segmentosQuery = useQuery({
    queryKey: ['company-segments', 'quick-select'],
    queryFn: () => apiClient.getCompanySegments(true),
    enabled: dialogAberto,
    staleTime: 5 * 60_000,
  });
  const segmentos = ((segmentosQuery.data?.data ?? []) as Segmento[]).filter(
    (s) => s.active !== false
  );

  const escolher = (empresa: Empresa) => {
    onChange(empresa.id, empresa);
    setOpen(false);
    setBusca('');
  };

  const abrirCriacao = () => {
    setOpen(false);
    setNome(busca.trim());
    setCnpj('');
    setSegmentId(SEM_SEGMENTO);
    setErro(null);
    setDuplicata(null);
    setDialogAberto(true);
  };

  const fecharDialog = () => {
    setDialogAberto(false);
    setErro(null);
    setDuplicata(null);
    setSalvando(false);
  };

  const usarExistente = (empresa: Empresa) => {
    queryClient.setQueryData(['company-quick', empresa.id], empresa);
    onChange(empresa.id, empresa);
    toast.success(`Empresa "${empresa.name}" selecionada.`);
    fecharDialog();
  };

  const criarEmpresa = async (ignorarDuplicata = false) => {
    const nomeLimpo = nome.trim();
    if (!nomeLimpo) {
      setErro('Informe o nome da empresa.');
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      // Dedupe pelo caminho feliz (caso extremo 3): oferece a existente antes de duplicar.
      if (!ignorarDuplicata) {
        try {
          const res = await apiClient.getCompanies({ limit: 10, search: nomeLimpo });
          const existente = ((res.companies ?? []) as unknown as Empresa[]).find(
            (c) => c.name.trim().toLowerCase() === nomeLimpo.toLowerCase()
          );
          if (existente) {
            setDuplicata(existente);
            setSalvando(false);
            return;
          }
        } catch {
          // Busca de dedupe falhou: segue para a criação (o dedupe é conveniência).
        }
      }

      const payload: Record<string, unknown> = { name: nomeLimpo };
      if (cnpj.trim()) payload.cnpj = cnpj.trim();
      if (segmentId !== SEM_SEGMENTO) payload.segmentId = segmentId;

      const res = await apiClient.createCompany(payload);
      const criada = ((res as { data?: unknown }).data ?? res) as Empresa;
      queryClient.setQueryData(['company-quick', criada.id], criada);
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      onChange(criada.id, criada);
      toast.success(`Empresa "${criada.name}" criada e selecionada.`);
      fecharDialog();
    } catch (err: unknown) {
      // Mantém o mini-dialog (e o formulário principal) abertos — casos 4 e 6:
      // a mensagem do backend (sem permissão / limite do plano) aparece aqui.
      const msg = err instanceof Error ? err.message : 'Erro ao criar empresa';
      setErro(msg);
      if (err instanceof ApiError && err.statusCode === 403) toast.error(msg);
    } finally {
      setSalvando(false);
    }
  };

  const restantes = typeof total === 'number' ? total - empresas.length : 0;

  return (
    <>
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
              {rotulo ?? 'Selecione a empresa'}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          {/* shouldFilter={false}: quem filtra é o servidor (padrão do CompanyPicker). */}
          <Command shouldFilter={false}>
            <div className="flex items-center border-b px-3">
              <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
              <CommandInput
                value={busca}
                onValueChange={setBusca}
                placeholder="Buscar empresa…"
                className="h-10 border-0 p-0 focus:ring-0"
              />
              {listaQuery.isFetching && (
                <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin opacity-50" />
              )}
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
                <CommandItem value="__criar__" onSelect={abrirCriacao}>
                  <Plus className="mr-2 h-4 w-4" />
                  <span>Criar nova empresa{busca.trim() ? ` "${busca.trim()}"` : ''}</span>
                </CommandItem>
                {empresas.map((empresa) => (
                  <CommandItem key={empresa.id} value={empresa.id} onSelect={() => escolher(empresa)}>
                    <Check
                      className={cn('mr-2 h-4 w-4', value === empresa.id ? 'opacity-100' : 'opacity-0')}
                    />
                    <span className="truncate">{empresa.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>

              {restantes > 0 && (
                <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                  Mostrando {empresas.length} de {total}. Refine a busca para ver as demais.
                </p>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Dialog open={dialogAberto} onOpenChange={(o) => !o && fecharDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nova empresa</DialogTitle>
            <DialogDescription>
              Cadastro rápido — a empresa criada fica selecionada no lead.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="quick-company-name">Nome *</Label>
              <Input
                id="quick-company-name"
                value={nome}
                onChange={(e) => {
                  setNome(e.target.value);
                  setDuplicata(null);
                  setErro(null);
                }}
                placeholder="Razão social ou nome da empresa"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quick-company-cnpj">CNPJ (opcional)</Label>
              <Input
                id="quick-company-cnpj"
                value={cnpj}
                onChange={(e) => setCnpj(e.target.value)}
                placeholder="00.000.000/0000-00"
              />
            </div>
            {segmentos.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="quick-company-segment">Segmento (opcional)</Label>
                <Select value={segmentId} onValueChange={setSegmentId}>
                  <SelectTrigger id="quick-company-segment">
                    <SelectValue placeholder="Sem segmento" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SEM_SEGMENTO}>Sem segmento</SelectItem>
                    {segmentos.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {duplicata && (
              <div className="rounded-md border border-border bg-muted/50 p-3 space-y-2">
                <p className="text-sm text-foreground">
                  Já existe uma empresa chamada <strong>{duplicata.name}</strong>.
                </p>
                <div className="flex gap-2">
                  <Button type="button" size="sm" onClick={() => usarExistente(duplicata)}>
                    Usar esta
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={salvando}
                    onClick={() => void criarEmpresa(true)}
                  >
                    Criar mesmo assim
                  </Button>
                </div>
              </div>
            )}

            {erro && <p className="text-sm text-destructive">{erro}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={fecharDialog} disabled={salvando}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void criarEmpresa(false)}
              disabled={salvando || !nome.trim() || !!duplicata}
            >
              {salvando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Criar empresa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
