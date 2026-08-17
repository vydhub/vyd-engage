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
import { useDebounce } from '../../hooks/useDebounce';
import { usePermissions } from '../../hooks/usePermissions';
import { apiClient, ApiError } from '../../services/api/client';
import { cn } from '../ui/utils';

interface Contato {
  id: string;
  name: string;
  position?: string | null;
  email?: string | null;
  phone?: string | null;
}

interface ContactQuickSelectProps {
  /**
   * Empresa dona dos contatos — o seletor lista apenas Leads-contato
   * (`isContact=true`) desta empresa. Sem empresa o campo fica desabilitado
   * com o hint "Selecione a empresa primeiro".
   *
   * IMPORTANTE (caso extremo 2): ao TROCAR a empresa no formulário-pai, o pai
   * deve limpar o contato selecionado (`onChange('')` / zerar `value`) — este
   * componente apenas filtra pela empresa recebida, não detecta a troca.
   */
  companyId?: string | null;
  value?: string;
  onChange: (contactId: string, contact?: Contato) => void;
  disabled?: boolean;
  id?: string;
}

const LIMITE = 100;

/**
 * Combobox de Contato da empresa selecionada com cadastro rápido inline
 * (specs/leads-oportunidade req. 4). Mesmo padrão do CompanyQuickSelect
 * (Popover+Command, busca no servidor com debounce, rehidratação do rótulo);
 * a criação usa POST /api/v1/leads/contacts (contato = Lead isContact=true
 * nascido com o companyId da empresa).
 *
 * Erros de permissão/limite de plano (casos 4 e 6) aparecem dentro do
 * mini-dialog, sem fechar o formulário principal.
 */
export function ContactQuickSelect({
  companyId,
  value,
  onChange,
  disabled = false,
  id,
}: ContactQuickSelectProps) {
  // Caso extremo 4: o item "+ Criar" só aparece com entities.leads.create
  const { canEntity } = usePermissions();
  const podeCriarContato = canEntity('leads', 'create');
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState('');
  const buscaDebounced = useDebounce(busca, 300);

  // Mini-dialog de criação
  const [dialogAberto, setDialogAberto] = useState(false);
  const [nome, setNome] = useState('');
  const [cargo, setCargo] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const semEmpresa = !companyId;

  const listaQuery = useQuery({
    queryKey: ['leads', 'contact-quick-select', companyId, buscaDebounced],
    queryFn: () =>
      apiClient.getLeads({
        companyId: companyId as string,
        isContact: 'true',
        limit: LIMITE,
        ...(buscaDebounced.trim() ? { search: buscaDebounced.trim() } : {}),
      }),
    enabled: open && !semEmpresa,
    placeholderData: keepPreviousData,
  });

  const contatos = (listaQuery.data?.leads ?? []) as unknown as Contato[];

  // Rótulo do selecionado: pode não estar na página atual de resultados.
  const selecionadoNaLista = useMemo(() => contatos.find((c) => c.id === value), [contatos, value]);
  const selecionadoQuery = useQuery({
    queryKey: ['lead-contact-quick', value],
    queryFn: async () => {
      const raw = await apiClient.getLead(value!);
      return ((raw as { data?: unknown }).data ?? raw) as Contato;
    },
    enabled: !!value && !selecionadoNaLista,
    staleTime: 5 * 60_000,
  });
  const selecionado = selecionadoNaLista ?? selecionadoQuery.data;
  const rotulo = selecionado
    ? selecionado.position
      ? `${selecionado.name} — ${selecionado.position}`
      : selecionado.name
    : undefined;

  const escolher = (contato: Contato) => {
    onChange(contato.id, contato);
    setOpen(false);
    setBusca('');
  };

  const abrirCriacao = () => {
    setOpen(false);
    setNome(busca.trim());
    setCargo('');
    setEmail('');
    setTelefone('');
    setErro(null);
    setDialogAberto(true);
  };

  const fecharDialog = () => {
    setDialogAberto(false);
    setErro(null);
    setSalvando(false);
  };

  const criarContato = async () => {
    const nomeLimpo = nome.trim();
    if (!nomeLimpo) {
      setErro('Informe o nome do contato.');
      return;
    }
    if (!companyId) return;
    setSalvando(true);
    setErro(null);
    try {
      const res = await apiClient.createLeadContact({
        name: nomeLimpo,
        companyId,
        ...(cargo.trim() ? { position: cargo.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(telefone.trim() ? { phone: telefone.trim() } : {}),
      });
      const criado = ((res as { data?: unknown }).data ?? res) as Contato;
      queryClient.setQueryData(['lead-contact-quick', criado.id], criado);
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      onChange(criado.id, criado);
      toast.success(`Contato "${criado.name}" criado e selecionado.`);
      fecharDialog();
    } catch (err: unknown) {
      // Mantém o mini-dialog (e o formulário principal) abertos — casos 4 e 6:
      // a mensagem do backend (sem permissão / limite do plano de leads) aparece aqui.
      const msg = err instanceof Error ? err.message : 'Erro ao criar contato';
      setErro(msg);
      if (err instanceof ApiError && err.statusCode === 403) toast.error(msg);
    } finally {
      setSalvando(false);
    }
  };

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
            disabled={disabled || semEmpresa}
            title={semEmpresa ? 'Selecione a empresa primeiro' : undefined}
            className="w-full justify-between font-normal"
          >
            <span className={cn('truncate', !rotulo && 'text-muted-foreground')}>
              {semEmpresa ? 'Selecione a empresa primeiro' : (rotulo ?? 'Selecione o contato')}
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
                placeholder="Buscar contato…"
                className="h-10 border-0 p-0 focus:ring-0"
              />
              {listaQuery.isFetching && (
                <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin opacity-50" />
              )}
            </div>

            <CommandList className="max-h-72">
              {!listaQuery.isFetching && contatos.length === 0 && (
                <CommandEmpty>
                  {buscaDebounced.trim()
                    ? `Nenhum contato encontrado para "${buscaDebounced.trim()}".`
                    : 'Esta empresa ainda não tem contatos.'}
                </CommandEmpty>
              )}

              <CommandGroup>
                {/* Caso extremo 4: sem entities.leads.create o item some;
                    o combobox continua funcionando para seleção. */}
                {podeCriarContato && (
                  <CommandItem value="__criar__" onSelect={abrirCriacao}>
                    <Plus className="mr-2 h-4 w-4" />
                    <span>Criar novo contato{busca.trim() ? ` "${busca.trim()}"` : ''}</span>
                  </CommandItem>
                )}
                {contatos.map((contato) => (
                  <CommandItem key={contato.id} value={contato.id} onSelect={() => escolher(contato)}>
                    <Check
                      className={cn('mr-2 h-4 w-4', value === contato.id ? 'opacity-100' : 'opacity-0')}
                    />
                    <span className="truncate">
                      {contato.name}
                      {contato.position ? (
                        <span className="text-muted-foreground"> — {contato.position}</span>
                      ) : null}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Dialog open={dialogAberto} onOpenChange={(o) => !o && fecharDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo contato</DialogTitle>
            <DialogDescription>
              Cadastro rápido — o contato nasce vinculado à empresa selecionada e fica
              selecionado no lead.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="quick-contact-name">Nome *</Label>
              <Input
                id="quick-contact-name"
                value={nome}
                onChange={(e) => {
                  setNome(e.target.value);
                  setErro(null);
                }}
                placeholder="Nome do contato"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quick-contact-position">Cargo (opcional)</Label>
              <Input
                id="quick-contact-position"
                value={cargo}
                onChange={(e) => setCargo(e.target.value)}
                placeholder="Ex.: Gerente de Suprimentos"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quick-contact-email">E-mail (opcional)</Label>
              <Input
                id="quick-contact-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="contato@empresa.com.br"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quick-contact-phone">Telefone (opcional)</Label>
              <Input
                id="quick-contact-phone"
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                placeholder="(11) 99999-9999"
              />
            </div>

            {erro && <p className="text-sm text-destructive">{erro}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={fecharDialog} disabled={salvando}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void criarContato()}
              disabled={salvando || !nome.trim()}
            >
              {salvando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Criar contato
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
