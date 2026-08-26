// Aba "Consultores" do módulo de Gestão de Parceiros Comerciais.
// CRUD de consultores externos + fluxo de NDA (envio p/ assinatura e upload manual).
// Todas as chamadas de API passam pelos hooks de useParceiros.ts.

import { useMemo, useRef, useState } from 'react';
import {
  FileSignature,
  FileUp,
  FileWarning,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useConsultores, useParceirosActions } from '@/hooks/useParceiros';
import type {
  Consultor,
  ConsultorInput,
  ConsultorStatus,
  NdaStatus,
  ScoreFaixa,
} from '@/types/parceiros';

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

// ── Rótulos e variantes (pt-BR) ─────────────────────────────────────────────
const STATUS_LABEL: Record<ConsultorStatus, string> = {
  ATIVO: 'Ativo',
  SUSPENSO: 'Suspenso',
  INATIVO: 'Inativo',
};
const STATUS_VARIANT: Record<ConsultorStatus, BadgeVariant> = {
  ATIVO: 'default',
  SUSPENSO: 'secondary',
  INATIVO: 'outline',
};
const STATUS_OPCOES: ConsultorStatus[] = ['ATIVO', 'SUSPENSO', 'INATIVO'];

const NDA_LABEL: Record<NdaStatus, string> = {
  PENDENTE: 'Pendente',
  ENVIADO: 'Enviado',
  ASSINADO: 'Assinado',
  RECUSADO: 'Recusado',
};
const NDA_VARIANT: Record<NdaStatus, BadgeVariant> = {
  PENDENTE: 'outline',
  ENVIADO: 'secondary',
  ASSINADO: 'default',
  RECUSADO: 'destructive',
};

const FAIXA_LABEL: Record<ScoreFaixa, string> = {
  SAUDAVEL: 'Saudável',
  ATENCAO: 'Atenção',
  ESFRIANDO: 'Esfriando',
  FRIO: 'Frio',
};
const FAIXA_VARIANT: Record<ScoreFaixa, BadgeVariant> = {
  SAUDAVEL: 'default',
  ATENCAO: 'secondary',
  ESFRIANDO: 'outline',
  FRIO: 'destructive',
};

// ── Estado do formulário (criar/editar) ─────────────────────────────────────
interface ConsultorForm {
  nome: string;
  email: string;
  senhaInicial: string;
  telefone: string;
  cpfCnpj: string;
  empresa: string;
  nivel: string;
  comissaoBase: string;
  inicioParceria: string;
  cadenciaReuniaoDias: string;
}

const FORM_INICIAL: ConsultorForm = {
  nome: '',
  email: '',
  senhaInicial: '',
  telefone: '',
  cpfCnpj: '',
  empresa: '',
  nivel: '',
  comissaoBase: '',
  inicioParceria: '',
  cadenciaReuniaoDias: '',
};

/** Preenche o formulário a partir de um consultor existente (edição). */
function consultorToForm(c: Consultor): ConsultorForm {
  return {
    ...FORM_INICIAL,
    nome: c.nome,
    email: c.email,
    telefone: c.telefone ?? '',
    empresa: c.empresa ?? '',
    nivel: c.nivel ?? '',
    comissaoBase: c.comissaoBase != null ? String(Number(c.comissaoBase)) : '',
    inicioParceria: c.inicioParceria ? c.inicioParceria.slice(0, 10) : '',
  };
}

export function ConsultoresTab() {
  const actions = useParceirosActions();

  // Filtros.
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>('__todos');

  const filters = useMemo<Record<string, string>>(() => {
    const f: Record<string, string> = {};
    const s = search.trim();
    if (s) f.search = s;
    if (status !== '__todos') f.status = status;
    return f;
  }, [search, status]);

  const { data: consultores, isLoading, isError } = useConsultores(filters);
  const lista = consultores ?? [];

  // Dialog criar/editar.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editando, setEditando] = useState<Consultor | null>(null);
  const [form, setForm] = useState<ConsultorForm>(FORM_INICIAL);
  const [salvando, setSalvando] = useState(false);

  // Exclusão.
  const [excluir, setExcluir] = useState<Consultor | null>(null);
  const [excluindo, setExcluindo] = useState(false);

  // NDA — inputs de arquivo escondidos + consultor alvo.
  const ndaAlvoRef = useRef<string | null>(null);
  const enviarNdaInputRef = useRef<HTMLInputElement>(null);
  const ndaManualInputRef = useRef<HTMLInputElement>(null);
  const [ndaBusyId, setNdaBusyId] = useState<string | null>(null);

  const setFormField = <K extends keyof ConsultorForm>(key: K, value: ConsultorForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const abrirCriar = () => {
    setEditando(null);
    setForm(FORM_INICIAL);
    setDialogOpen(true);
  };

  const abrirEditar = (c: Consultor) => {
    setEditando(c);
    setForm(consultorToForm(c));
    setDialogOpen(true);
  };

  const fecharDialog = () => {
    setDialogOpen(false);
    setEditando(null);
    setForm(FORM_INICIAL);
  };

  const senhaOk = form.senhaInicial.length >= 8;
  const podeSalvar = editando
    ? form.nome.trim().length > 0
    : form.nome.trim().length > 0 && form.email.trim().length > 0 && senhaOk;

  const handleSalvar = async () => {
    if (!podeSalvar || salvando) return;

    const comissaoNum = form.comissaoBase.trim() ? Number(form.comissaoBase) : NaN;
    const cadenciaNum = form.cadenciaReuniaoDias.trim() ? Number(form.cadenciaReuniaoDias) : NaN;

    setSalvando(true);
    try {
      if (editando) {
        const data: Partial<ConsultorInput> = {
          nome: form.nome.trim(),
          telefone: form.telefone.trim() || null,
          empresa: form.empresa.trim() || null,
          nivel: form.nivel.trim() || null,
          inicioParceria: form.inicioParceria || null,
          ...(Number.isFinite(comissaoNum) ? { comissaoBase: comissaoNum } : {}),
          ...(form.cpfCnpj.trim() ? { cpfCnpj: form.cpfCnpj.trim() } : {}),
          ...(Number.isFinite(cadenciaNum) ? { cadenciaReuniaoDias: cadenciaNum } : {}),
        };
        await actions.updateConsultor(editando.id, data);
      } else {
        const data: ConsultorInput = {
          nome: form.nome.trim(),
          email: form.email.trim(),
          senhaInicial: form.senhaInicial,
          telefone: form.telefone.trim() || null,
          cpfCnpj: form.cpfCnpj.trim() || null,
          empresa: form.empresa.trim() || null,
          nivel: form.nivel.trim() || null,
          inicioParceria: form.inicioParceria || null,
          ...(Number.isFinite(comissaoNum) ? { comissaoBase: comissaoNum } : {}),
          ...(Number.isFinite(cadenciaNum) ? { cadenciaReuniaoDias: cadenciaNum } : {}),
        };
        await actions.createConsultor(data);
      }
      fecharDialog();
    } catch {
      // erro já sinalizado via toast no hook
    } finally {
      setSalvando(false);
    }
  };

  const handleExcluir = async () => {
    if (!excluir || excluindo) return;
    setExcluindo(true);
    try {
      await actions.deleteConsultor(excluir.id);
      setExcluir(null);
    } catch {
      // toast pelo hook
    } finally {
      setExcluindo(false);
    }
  };

  // ── NDA ───────────────────────────────────────────────────────────────────
  const abrirEnviarNda = (consultorId: string) => {
    ndaAlvoRef.current = consultorId;
    enviarNdaInputRef.current?.click();
  };
  const abrirNdaManual = (consultorId: string) => {
    ndaAlvoRef.current = consultorId;
    ndaManualInputRef.current?.click();
  };

  const handleEnviarNdaFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite reenviar o mesmo arquivo
    const id = ndaAlvoRef.current;
    ndaAlvoRef.current = null;
    if (!file || !id) return;
    setNdaBusyId(id);
    try {
      await actions.enviarNda(id, file);
    } catch {
      // toast pelo hook
    } finally {
      setNdaBusyId(null);
    }
  };

  const handleNdaManualFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const id = ndaAlvoRef.current;
    ndaAlvoRef.current = null;
    if (!file || !id) return;
    setNdaBusyId(id);
    try {
      await actions.uploadNdaManual(id, file);
    } catch {
      // toast pelo hook
    } finally {
      setNdaBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Inputs de arquivo escondidos (NDA) */}
      <input
        ref={enviarNdaInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={handleEnviarNdaFile}
      />
      <input
        ref={ndaManualInputRef}
        type="file"
        className="hidden"
        onChange={handleNdaManualFile}
      />

      {/* ── Nota: portal + bloqueio por NDA ── */}
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted px-3 py-2">
        <Lock size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
        <p className="text-sm text-foreground">
          Cada consultor acessa um portal próprio para registrar e acompanhar oportunidades.
          Enquanto o NDA não estiver assinado, o acesso ao portal permanece{' '}
          <span className="font-medium">bloqueado</span>.
        </p>
      </div>

      {/* ── Barra de filtros + ações ── */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1">
            <Label htmlFor="consultores-busca">Buscar</Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
                size={16}
              />
              <Input
                id="consultores-busca"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Nome, e-mail ou empresa…"
                className="pl-8"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-full sm:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__todos">Todos</SelectItem>
                {STATUS_OPCOES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button className="gap-1.5" onClick={abrirCriar}>
          <Plus size={16} />
          Novo consultor
        </Button>
      </div>

      {/* ── Tabela / estados ── */}
      <div className="rounded-md border border-border bg-card">
        {isLoading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
            <FileWarning className="mb-3 text-destructive" size={32} />
            <p className="font-medium text-foreground">Erro ao carregar os consultores</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Não foi possível buscar os consultores. Tente novamente.
            </p>
          </div>
        ) : lista.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
            <Users className="mb-3 text-muted-foreground" size={32} />
            <p className="font-medium text-foreground">Nenhum consultor encontrado</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Ajuste os filtros ou cadastre um novo consultor parceiro.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Nível</TableHead>
                  <TableHead className="text-right">% base</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>NDA</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium text-foreground">{c.nome}</TableCell>
                    <TableCell className="text-foreground">{c.email}</TableCell>
                    <TableCell className="text-muted-foreground">{c.empresa ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{c.nivel ?? '—'}</TableCell>
                    <TableCell className="text-right text-foreground">
                      {Number(c.comissaoBase).toLocaleString('pt-BR')}%
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={NDA_VARIANT[c.ndaStatus]}>{NDA_LABEL[c.ndaStatus]}</Badge>
                    </TableCell>
                    <TableCell>
                      {c.scoreFaixa ? (
                        <Badge variant={FAIXA_VARIANT[c.scoreFaixa]}>
                          {FAIXA_LABEL[c.scoreFaixa]}
                        </Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="outline"
                          size="icon"
                          aria-label={`Editar ${c.nome}`}
                          onClick={() => abrirEditar(c)}
                        >
                          <Pencil size={14} />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="outline"
                              size="icon"
                              aria-label={`NDA de ${c.nome}`}
                              disabled={ndaBusyId === c.id}
                            >
                              {ndaBusyId === c.id ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <FileSignature size={14} />
                              )}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => abrirEnviarNda(c.id)}>
                              <FileSignature size={14} className="mr-2" />
                              Enviar NDA p/ assinatura
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => abrirNdaManual(c.id)}>
                              <FileUp size={14} className="mr-2" />
                              Upload NDA assinado (manual)
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <Button
                          variant="outline"
                          size="icon"
                          aria-label={`Excluir ${c.nome}`}
                          onClick={() => setExcluir(c)}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* ── Dialog: novo/editar consultor ── */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) fecharDialog();
          else setDialogOpen(true);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editando ? 'Editar consultor' : 'Novo consultor'}</DialogTitle>
            <DialogDescription>
              {editando
                ? 'Atualize os dados do consultor parceiro.'
                : 'Cadastre um consultor parceiro com acesso ao portal próprio.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="consultor-nome">Nome *</Label>
              <Input
                id="consultor-nome"
                value={form.nome}
                onChange={(e) => setFormField('nome', e.target.value)}
              />
            </div>

            {!editando && (
              <>
                <div className="space-y-1">
                  <Label htmlFor="consultor-email">E-mail *</Label>
                  <Input
                    id="consultor-email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setFormField('email', e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="consultor-senha">Senha inicial *</Label>
                  <Input
                    id="consultor-senha"
                    type="password"
                    value={form.senhaInicial}
                    onChange={(e) => setFormField('senhaInicial', e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Mínimo de 8 caracteres — o consultor troca depois.
                  </p>
                </div>
              </>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="consultor-telefone">Telefone (WhatsApp)</Label>
                <Input
                  id="consultor-telefone"
                  value={form.telefone}
                  onChange={(e) => setFormField('telefone', e.target.value)}
                  placeholder="Ex.: (11) 99999-9999"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="consultor-cpfcnpj">CPF/CNPJ</Label>
                <Input
                  id="consultor-cpfcnpj"
                  value={form.cpfCnpj}
                  onChange={(e) => setFormField('cpfCnpj', e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="consultor-empresa">Empresa</Label>
                <Input
                  id="consultor-empresa"
                  value={form.empresa}
                  onChange={(e) => setFormField('empresa', e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="consultor-nivel">Nível</Label>
                <Input
                  id="consultor-nivel"
                  value={form.nivel}
                  onChange={(e) => setFormField('nivel', e.target.value)}
                  placeholder="Ex.: Sênior"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="consultor-comissao">Comissão base (%)</Label>
                <Input
                  id="consultor-comissao"
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  value={form.comissaoBase}
                  onChange={(e) => setFormField('comissaoBase', e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="consultor-inicio">Início da parceria</Label>
                <Input
                  id="consultor-inicio"
                  type="date"
                  value={form.inicioParceria}
                  onChange={(e) => setFormField('inicioParceria', e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="consultor-cadencia">Cadência de reunião (dias)</Label>
                <Input
                  id="consultor-cadencia"
                  type="number"
                  min={1}
                  value={form.cadenciaReuniaoDias}
                  onChange={(e) => setFormField('cadenciaReuniaoDias', e.target.value)}
                />
              </div>
            </div>

            {!editando && form.senhaInicial.length > 0 && !senhaOk && (
              <p className="text-sm text-destructive">
                A senha inicial precisa ter no mínimo 8 caracteres.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={fecharDialog} disabled={salvando}>
              Cancelar
            </Button>
            <Button onClick={handleSalvar} disabled={!podeSalvar || salvando}>
              {salvando ? 'Salvando…' : editando ? 'Salvar alterações' : 'Criar consultor'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── AlertDialog: confirmação de exclusão ── */}
      <AlertDialog
        open={!!excluir}
        onOpenChange={(open) => {
          if (!open) setExcluir(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir consultor</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é permanente e removerá o consultor
              {excluir ? ` "${excluir.nome}"` : ''} e o acesso dele ao portal. Deseja continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluindo}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              disabled={excluindo}
              onClick={(e) => {
                e.preventDefault();
                handleExcluir();
              }}
            >
              {excluindo ? 'Excluindo…' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
