// Aba "Registros" do módulo de Gestão de Parceiros Comerciais.
// Fila de aprovação de registros de oportunidade + gestão completa do ciclo:
// aprovação/rejeição, extensões de proteção, ganho/perdido, recebimentos,
// atribuições de comissão, plano de ação bilateral, updates e auditoria.
// Todas as chamadas de API passam pelos hooks de useParceiros.ts.

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Clock,
  FileWarning,
  History,
  Inbox,
  ListChecks,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  Trash2,
  Trophy,
  Users,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { apiClient } from '@/services/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
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
import {
  useConsultores,
  useExtensoes,
  useParceirosActions,
  useRegistro,
  useRegistros,
} from '@/hooks/useParceiros';
import type {
  ConsultorStatus,
  PapelAtribuicao,
  PlanoAcaoItem,
  PlanoAcaoStatus,
  RegistroExtensao,
  RegistroStatus,
} from '@/types/parceiros';

// ── Rótulos e opções (pt-BR) ────────────────────────────────────────────────
type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

const STATUS_LABEL: Record<RegistroStatus, string> = {
  SUBMETIDO: 'Aguardando aprovação',
  EM_ANALISE: 'Em análise',
  APROVADO: 'Aprovado',
  REJEITADO: 'Rejeitado',
  EXPIRADO: 'Expirado',
  GANHO: 'Ganho',
  PERDIDO: 'Perdido',
};

const STATUS_VARIANT: Record<RegistroStatus, BadgeVariant> = {
  SUBMETIDO: 'outline',
  EM_ANALISE: 'secondary',
  APROVADO: 'default',
  REJEITADO: 'destructive',
  EXPIRADO: 'destructive',
  GANHO: 'default',
  PERDIDO: 'outline',
};

const STATUS_OPCOES: RegistroStatus[] = [
  'SUBMETIDO',
  'EM_ANALISE',
  'APROVADO',
  'REJEITADO',
  'EXPIRADO',
  'GANHO',
  'PERDIDO',
];

const PLANO_STATUS_LABEL: Record<PlanoAcaoStatus, string> = {
  PENDENTE: 'Pendente',
  CONCLUIDA: 'Concluída',
  CANCELADA: 'Cancelada',
};

const PAPEL_LABEL: Record<PapelAtribuicao, string> = {
  ORIGINADOR: 'Originador',
  DESENVOLVEDOR: 'Desenvolvedor',
};

// ── Helpers de formatação ───────────────────────────────────────────────────
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function fmtBRL(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '—';
  return brl.format(Number(valor));
}

function fmtData(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
}

/** Dias restantes até a data (null se ausente). */
function diasRestantes(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

function planoVencido(item: PlanoAcaoItem): boolean {
  return (
    !!item.dueDate &&
    item.status === 'PENDENTE' &&
    new Date(item.dueDate).getTime() < Date.now()
  );
}

/** Update em atraso: registro aprovado cujo próximo update já venceu. */
function updateAtrasado(reg: {
  status: RegistroStatus;
  proximoUpdateEm: string | null;
}): boolean {
  return (
    reg.status === 'APROVADO' &&
    !!reg.proximoUpdateEm &&
    new Date(reg.proximoUpdateEm).getTime() < Date.now()
  );
}

/**
 * Status do consultor associado ao registro, quando o backend o expõe.
 * O tipo `Registro.consultor` não o declara; lemos de forma tolerante.
 */
function consultorStatus(
  consultor: { id: string; nome: string; status?: ConsultorStatus } | null | undefined
): ConsultorStatus | undefined {
  return consultor?.status;
}

/** Primeira ação PENDENTE por prazo (asc); ações sem prazo vão por último. */
function proximaAcao(itens: PlanoAcaoItem[] | undefined): PlanoAcaoItem | null {
  const pendentes = (itens ?? []).filter((i) => i.status === 'PENDENTE');
  if (pendentes.length === 0) return null;
  return pendentes.slice().sort((a, b) => {
    const ta = a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
    const tb = b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY;
    return ta - tb;
  })[0];
}

// ── Formulário "Registrar em nome de consultor" ─────────────────────────────
interface NovoRegistroForm {
  consultorId: string;
  clienteNome: string;
  clienteCnpj: string;
  clienteContato: string;
  descricao: string;
  valorEstimado: string;
  observacoes: string;
}

const NOVO_REGISTRO_INICIAL: NovoRegistroForm = {
  consultorId: '',
  clienteNome: '',
  clienteCnpj: '',
  clienteContato: '',
  descricao: '',
  valorEstimado: '',
  observacoes: '',
};

export function RegistrosTab() {
  const actions = useParceirosActions();

  // ── Filtros ───────────────────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState<string>('__todos');
  const [consultorFilter, setConsultorFilter] = useState<string>('__todos');
  const [search, setSearch] = useState('');

  const filters = useMemo<Record<string, string>>(() => {
    const f: Record<string, string> = {};
    if (statusFilter !== '__todos') f.status = statusFilter;
    if (consultorFilter !== '__todos') f.consultorId = consultorFilter;
    const s = search.trim();
    if (s) f.search = s;
    return f;
  }, [statusFilter, consultorFilter, search]);

  const { data: registros, isLoading, isError } = useRegistros(filters);
  const { data: consultores } = useConsultores();
  const { data: extensoes } = useExtensoes();

  // Usuários internos (Tenax) — para nomear o responsável de uma ação do plano.
  const { data: usuariosInternos } = useQuery({
    queryKey: ['users-internos'],
    queryFn: () => apiClient.getUsers(),
  });
  const listaUsuariosInternos = useMemo(
    () =>
      (usuariosInternos ?? []).filter(
        (u) => u.role === 'ADMIN' || u.role === 'GESTOR' || u.role === 'USER'
      ),
    [usuariosInternos]
  );

  // ── Detalhe (Sheet) ───────────────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const {
    data: registro,
    isLoading: registroLoading,
    isError: registroError,
  } = useRegistro(selectedId);

  // ── Dialogs / formulários ─────────────────────────────────────────────────
  const [novoOpen, setNovoOpen] = useState(false);
  const [novoForm, setNovoForm] = useState<NovoRegistroForm>(NOVO_REGISTRO_INICIAL);
  const [salvandoNovo, setSalvandoNovo] = useState(false);

  // Decisão de extensão (aprovar/negar) — um único dialog parametrizado.
  const [extDecisao, setExtDecisao] = useState<{
    ext: RegistroExtensao;
    aprovar: boolean;
  } | null>(null);
  const [extDias, setExtDias] = useState('');
  const [extMotivo, setExtMotivo] = useState('');
  const [decidindoExt, setDecidindoExt] = useState(false);

  // Ações por status (dialogs).
  const [aprovarOpen, setAprovarOpen] = useState(false);
  const [aprovarDias, setAprovarDias] = useState('');
  const [aprovarMotivo, setAprovarMotivo] = useState('');
  const [rejeitarOpen, setRejeitarOpen] = useState(false);
  const [rejeitarMotivo, setRejeitarMotivo] = useState('');
  const [ganhoOpen, setGanhoOpen] = useState(false);
  const [ganhoValor, setGanhoValor] = useState('');
  const [perdidoOpen, setPerdidoOpen] = useState(false);
  const [perdidoMotivo, setPerdidoMotivo] = useState('');
  const [busyAcao, setBusyAcao] = useState(false);

  // Formulários inline do Sheet.
  const [sheetBusy, setSheetBusy] = useState(false);
  const [updateTexto, setUpdateTexto] = useState('');
  const [recData, setRecData] = useState('');
  const [recValor, setRecValor] = useState('');
  const [recReferencia, setRecReferencia] = useState('');
  const [removerRecId, setRemoverRecId] = useState<string | null>(null);
  const [atribConsultorId, setAtribConsultorId] = useState('');
  const [atribPapel, setAtribPapel] = useState<PapelAtribuicao>('ORIGINADOR');
  const [atribOverride, setAtribOverride] = useState('');
  const [splitInput, setSplitInput] = useState('');
  const [planoDescricao, setPlanoDescricao] = useState('');
  const [planoConsultor, setPlanoConsultor] = useState(false);
  const [planoDueDate, setPlanoDueDate] = useState('');
  const [planoResponsavelUserId, setPlanoResponsavelUserId] = useState('');

  // Reativar (registro EXPIRADO).
  const [reativarOpen, setReativarOpen] = useState(false);
  const [reativarDias, setReativarDias] = useState('');
  const [reativarMotivo, setReativarMotivo] = useState('');

  // Ajustar janela de proteção (registro APROVADO).
  const [protecaoOpen, setProtecaoOpen] = useState(false);
  const [protecaoDias, setProtecaoDias] = useState('');
  const [protecaoNovoFim, setProtecaoNovoFim] = useState('');
  const [protecaoMotivo, setProtecaoMotivo] = useState('');

  // Editar cliente (corrigir/definir CNPJ — re-detecta conflito).
  const [clienteOpen, setClienteOpen] = useState(false);
  const [clienteNome, setClienteNome] = useState('');
  const [clienteCnpj, setClienteCnpj] = useState('');
  const [clienteContato, setClienteContato] = useState('');

  // Sincroniza o input de split quando o registro carregado muda.
  useEffect(() => {
    setSplitInput(
      registro?.splitOriginador !== null && registro?.splitOriginador !== undefined
        ? String(registro.splitOriginador)
        : ''
    );
  }, [registro?.id, registro?.splitOriginador]);

  const extensoesPendentes = extensoes ?? [];
  const lista = registros ?? [];
  const listaConsultores = consultores ?? [];

  // ── Handlers: extensões ───────────────────────────────────────────────────
  const abrirDecisaoExt = (ext: RegistroExtensao, aprovar: boolean) => {
    setExtDias(ext.diasSolicitados !== null ? String(ext.diasSolicitados) : '');
    setExtMotivo('');
    setExtDecisao({ ext, aprovar });
  };

  const handleDecidirExtensao = async () => {
    if (!extDecisao) return;
    setDecidindoExt(true);
    try {
      const payload: { aprovar: boolean; dias?: number; motivo?: string } = {
        aprovar: extDecisao.aprovar,
      };
      const dias = Number(extDias);
      if (extDecisao.aprovar && extDias.trim() && Number.isFinite(dias) && dias > 0) {
        payload.dias = dias;
      }
      if (extMotivo.trim()) payload.motivo = extMotivo.trim();
      await actions.decidirExtensao(extDecisao.ext.id, payload);
      setExtDecisao(null);
    } catch {
      // erro já sinalizado via toast no hook
    } finally {
      setDecidindoExt(false);
    }
  };

  // ── Handlers: novo registro interno ───────────────────────────────────────
  const setNovoField = <K extends keyof NovoRegistroForm>(
    key: K,
    value: NovoRegistroForm[K]
  ) => setNovoForm((prev) => ({ ...prev, [key]: value }));

  const podeSalvarNovo =
    novoForm.consultorId.length > 0 &&
    novoForm.clienteNome.trim().length > 0 &&
    novoForm.descricao.trim().length > 0;

  const handleCriarRegistro = async () => {
    if (!podeSalvarNovo) return;
    setSalvandoNovo(true);
    try {
      const valorNum = novoForm.valorEstimado.trim() ? Number(novoForm.valorEstimado) : NaN;
      await actions.createRegistroInterno({
        consultorId: novoForm.consultorId,
        clienteNome: novoForm.clienteNome.trim(),
        clienteCnpj: novoForm.clienteCnpj.trim() || null,
        clienteContato: novoForm.clienteContato.trim() || null,
        descricao: novoForm.descricao.trim(),
        valorEstimado: Number.isFinite(valorNum) ? valorNum : null,
        observacoes: novoForm.observacoes.trim() || null,
      });
      setNovoOpen(false);
      setNovoForm(NOVO_REGISTRO_INICIAL);
    } catch {
      // erro já sinalizado via toast no hook
    } finally {
      setSalvandoNovo(false);
    }
  };

  // ── Handlers: ações por status ────────────────────────────────────────────
  const handleAprovar = async () => {
    if (!registro) return;
    setBusyAcao(true);
    try {
      const payload: { protecaoDias?: number; motivo?: string } = {};
      const dias = Number(aprovarDias);
      if (aprovarDias.trim() && Number.isFinite(dias) && dias > 0) payload.protecaoDias = dias;
      if (aprovarMotivo.trim()) payload.motivo = aprovarMotivo.trim();
      await actions.aprovarRegistro(registro.id, payload);
      setAprovarOpen(false);
    } catch {
      // erro já sinalizado via toast no hook
    } finally {
      setBusyAcao(false);
    }
  };

  const handleRejeitar = async () => {
    if (!registro || !rejeitarMotivo.trim()) return;
    setBusyAcao(true);
    try {
      await actions.rejeitarRegistro(registro.id, rejeitarMotivo.trim());
      setRejeitarOpen(false);
    } catch {
      // erro já sinalizado via toast no hook
    } finally {
      setBusyAcao(false);
    }
  };

  const handleGanho = async () => {
    const valor = Number(ganhoValor);
    if (!registro || !ganhoValor.trim() || !Number.isFinite(valor) || valor <= 0) return;
    setBusyAcao(true);
    try {
      await actions.marcarGanho(registro.id, valor);
      setGanhoOpen(false);
    } catch {
      // erro já sinalizado via toast no hook
    } finally {
      setBusyAcao(false);
    }
  };

  const handlePerdido = async () => {
    if (!registro) return;
    setBusyAcao(true);
    try {
      await actions.marcarPerdido(registro.id, perdidoMotivo.trim() || undefined);
      setPerdidoOpen(false);
    } catch {
      // erro já sinalizado via toast no hook
    } finally {
      setBusyAcao(false);
    }
  };

  // ── Handlers: formulários inline do Sheet ─────────────────────────────────
  const handleAddUpdate = async () => {
    if (!registro || !updateTexto.trim()) return;
    setSheetBusy(true);
    try {
      await actions.addUpdate(registro.id, updateTexto.trim());
      setUpdateTexto('');
    } catch {
      // erro já sinalizado via toast no hook
    } finally {
      setSheetBusy(false);
    }
  };

  const podeLancarRecebimento =
    recData.length > 0 && recValor.trim().length > 0 && Number(recValor) > 0;

  const handleAddRecebimento = async () => {
    if (!registro || !podeLancarRecebimento) return;
    setSheetBusy(true);
    try {
      const res = await actions.addRecebimento(registro.id, {
        data: recData,
        valor: Number(recValor),
        referencia: recReferencia.trim() || null,
      });
      if (res.excedeuContrato) {
        toast.warning('Atenção: os recebimentos ultrapassam o valor do contrato.');
      }
      setRecData('');
      setRecValor('');
      setRecReferencia('');
    } catch {
      // erro já sinalizado via toast no hook
    } finally {
      setSheetBusy(false);
    }
  };

  const handleRemoverRecebimento = async () => {
    if (!removerRecId) return;
    setSheetBusy(true);
    try {
      await actions.removeRecebimento(removerRecId);
      setRemoverRecId(null);
    } catch {
      // erro já sinalizado via toast no hook
    } finally {
      setSheetBusy(false);
    }
  };

  const handleSetAtribuicao = async () => {
    if (!registro || !atribConsultorId) return;
    setSheetBusy(true);
    try {
      const overrideNum = Number(atribOverride);
      await actions.setAtribuicao(registro.id, {
        consultorId: atribConsultorId,
        papel: atribPapel,
        percentualOverride:
          atribOverride.trim() && Number.isFinite(overrideNum) ? overrideNum : null,
      });
      setAtribConsultorId('');
      setAtribPapel('ORIGINADOR');
      setAtribOverride('');
    } catch {
      // erro já sinalizado via toast no hook
    } finally {
      setSheetBusy(false);
    }
  };

  const handleRemoveAtribuicao = async (id: string) => {
    setSheetBusy(true);
    try {
      await actions.removeAtribuicao(id);
    } catch {
      // erro já sinalizado via toast no hook
    } finally {
      setSheetBusy(false);
    }
  };

  const splitNum = Number(splitInput);
  const splitValido =
    splitInput.trim().length > 0 &&
    Number.isFinite(splitNum) &&
    splitNum >= 0 &&
    splitNum <= 100;

  const handleSetSplit = async () => {
    if (!registro || !splitValido) return;
    setSheetBusy(true);
    try {
      await actions.setSplit(registro.id, splitNum);
    } catch {
      // erro já sinalizado via toast no hook
    } finally {
      setSheetBusy(false);
    }
  };

  const handleCriarPlanoItem = async () => {
    if (!registro || !planoDescricao.trim()) return;
    setSheetBusy(true);
    try {
      await actions.createPlanoItem(registro.id, {
        descricao: planoDescricao.trim(),
        responsavelConsultor: planoConsultor,
        // Ação da Tenax → responsável interno nomeado (quando selecionado).
        responsavelUserId:
          !planoConsultor && planoResponsavelUserId ? planoResponsavelUserId : null,
        dueDate: planoDueDate || null,
      });
      setPlanoDescricao('');
      setPlanoConsultor(false);
      setPlanoResponsavelUserId('');
      setPlanoDueDate('');
    } catch {
      // erro já sinalizado via toast no hook
    } finally {
      setSheetBusy(false);
    }
  };

  // ── Handlers: reativar / ajustar proteção / editar cliente ────────────────
  const handleReativar = async () => {
    if (!registro) return;
    setBusyAcao(true);
    try {
      const payload: { protecaoDias?: number; motivo?: string } = {};
      const dias = Number(reativarDias);
      if (reativarDias.trim() && Number.isFinite(dias) && dias > 0) payload.protecaoDias = dias;
      if (reativarMotivo.trim()) payload.motivo = reativarMotivo.trim();
      await actions.reativarRegistro(registro.id, payload);
      setReativarOpen(false);
    } catch {
      // erro já sinalizado via toast no hook
    } finally {
      setBusyAcao(false);
    }
  };

  const handleAjustarProtecao = async () => {
    if (!registro || !protecaoMotivo.trim()) return;
    setBusyAcao(true);
    try {
      const payload: { dias?: number; novoFim?: string; motivo: string } = {
        motivo: protecaoMotivo.trim(),
      };
      const dias = Number(protecaoDias);
      if (protecaoDias.trim() && Number.isFinite(dias)) payload.dias = dias;
      if (protecaoNovoFim.trim()) payload.novoFim = protecaoNovoFim;
      await actions.ajustarProtecao(registro.id, payload);
      setProtecaoOpen(false);
    } catch {
      // erro já sinalizado via toast no hook
    } finally {
      setBusyAcao(false);
    }
  };

  const handleAtualizarCliente = async () => {
    if (!registro || !clienteNome.trim()) return;
    setBusyAcao(true);
    try {
      await actions.atualizarCliente(registro.id, {
        clienteNome: clienteNome.trim(),
        clienteCnpj: clienteCnpj.trim() || null,
        clienteContato: clienteContato.trim() || null,
      });
      setClienteOpen(false);
    } catch {
      // erro já sinalizado via toast no hook
    } finally {
      setBusyAcao(false);
    }
  };

  const handleConcluirPlano = async (id: string) => {
    setSheetBusy(true);
    try {
      await actions.updatePlanoItem(id, { status: 'CONCLUIDA' });
    } catch {
      // erro já sinalizado via toast no hook
    } finally {
      setSheetBusy(false);
    }
  };

  const handleExcluirPlano = async (id: string) => {
    setSheetBusy(true);
    try {
      await actions.deletePlanoItem(id);
    } catch {
      // erro já sinalizado via toast no hook
    } finally {
      setSheetBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* ── Alert: extensões de proteção pendentes ── */}
      {extensoesPendentes.length > 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Pedidos de extensão de proteção aguardando decisão</AlertTitle>
          <AlertDescription>
            <div className="mt-2 space-y-2">
              {extensoesPendentes.map((ext) => (
                <div
                  key={ext.id}
                  className="flex flex-col gap-2 rounded-md border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {ext.registro?.consultor.nome ?? 'Consultor'} —{' '}
                      {ext.registro?.clienteNome ?? 'Cliente'}
                    </p>
                    <p className="text-sm text-muted-foreground">{ext.justificativa}</p>
                    <p className="text-xs text-muted-foreground">
                      {ext.diasSolicitados !== null
                        ? `Dias solicitados: ${ext.diasSolicitados}`
                        : 'Sem quantidade de dias especificada'}
                      {ext.registro?.protecaoFim
                        ? ` · Proteção atual até ${fmtData(ext.registro.protecaoFim)}`
                        : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      className="gap-1"
                      onClick={() => abrirDecisaoExt(ext, true)}
                    >
                      <CheckCircle2 size={14} />
                      Aprovar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      onClick={() => abrirDecisaoExt(ext, false)}
                    >
                      <XCircle size={14} />
                      Negar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* ── Barra de filtros + ações ── */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1">
            <Label htmlFor="registros-busca">Buscar</Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
                size={16}
              />
              <Input
                id="registros-busca"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cliente, CNPJ ou descrição…"
                className="pl-8"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-52">
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

          <div className="space-y-1">
            <Label>Consultor</Label>
            <Select value={consultorFilter} onValueChange={setConsultorFilter}>
              <SelectTrigger className="w-full sm:w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__todos">Todos</SelectItem>
                {listaConsultores.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button className="gap-1.5" onClick={() => setNovoOpen(true)}>
          <Plus size={16} />
          Registrar em nome de consultor
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
            <p className="font-medium text-foreground">Erro ao carregar os registros</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Não foi possível buscar os registros de oportunidade. Tente novamente.
            </p>
          </div>
        ) : lista.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
            <Inbox className="mb-3 text-muted-foreground" size={32} />
            <p className="font-medium text-foreground">Nenhum registro encontrado</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Ajuste os filtros ou registre uma oportunidade em nome de um consultor.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Consultor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Valor estimado</TableHead>
                  <TableHead>Registrado em</TableHead>
                  <TableHead>Expira em</TableHead>
                  <TableHead className="text-right">Conflitos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((r) => {
                  const dias = diasRestantes(r.protecaoFim);
                  const conflitos = r._count?.conflitos ?? 0;
                  return (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer"
                      onClick={() => setSelectedId(r.id)}
                    >
                      <TableCell className="font-medium text-foreground">
                        {r.clienteNome}
                      </TableCell>
                      <TableCell className="text-foreground">
                        {r.consultor?.nome ?? '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant={STATUS_VARIANT[r.status]}>
                            {STATUS_LABEL[r.status]}
                          </Badge>
                          {updateAtrasado(r) && (
                            <Badge variant="destructive" className="gap-1">
                              <Clock size={12} />
                              Update em atraso
                            </Badge>
                          )}
                          {consultorStatus(r.consultor) &&
                            consultorStatus(r.consultor) !== 'ATIVO' && (
                              <Badge variant="destructive" className="gap-1">
                                <ShieldAlert size={12} />
                                Consultor suspenso
                              </Badge>
                            )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-foreground">
                        {fmtBRL(r.valorEstimado)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {fmtData(r.createdAt)}
                      </TableCell>
                      <TableCell>
                        {r.protecaoFim ? (
                          dias !== null && dias < 7 ? (
                            <Badge variant="destructive">{fmtData(r.protecaoFim)}</Badge>
                          ) : (
                            <span className="text-foreground">{fmtData(r.protecaoFim)}</span>
                          )
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {conflitos > 0 ? (
                          <Badge variant="destructive">{conflitos}</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* ── Sheet: detalhe do registro ── */}
      <Sheet
        open={!!selectedId}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedId(null);
            setUpdateTexto('');
          }
        }}
      >
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-xl">
          {registroLoading ? (
            <div className="space-y-3 p-4">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : registroError ? (
            <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
              <FileWarning className="mb-3 text-destructive" size={32} />
              <p className="font-medium text-foreground">Erro ao carregar o registro</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Não foi possível buscar os detalhes. Feche e tente novamente.
              </p>
            </div>
          ) : registro ? (
            <>
              <SheetHeader>
                <SheetTitle>{registro.clienteNome}</SheetTitle>
                <SheetDescription>
                  Registrado por {registro.consultor?.nome ?? 'consultor'} em{' '}
                  {fmtData(registro.createdAt)}
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-5 px-4 pb-6">
                {registro.status === 'EM_ANALISE' && (
                  <div className="flex items-start gap-2 rounded-md border border-border bg-muted px-3 py-2">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0 text-foreground" />
                    <p className="text-sm text-foreground">
                      Em análise de conflito — resolva na aba Conflitos.
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <Badge variant={STATUS_VARIANT[registro.status]}>
                    {STATUS_LABEL[registro.status]}
                  </Badge>
                  {(registro._count?.conflitos ?? 0) > 0 && (
                    <Badge variant="destructive">
                      {registro._count?.conflitos} conflito(s) aberto(s)
                    </Badge>
                  )}
                  {updateAtrasado(registro) && (
                    <Badge variant="destructive" className="gap-1">
                      <Clock size={12} />
                      Update em atraso
                    </Badge>
                  )}
                  {consultorStatus(registro.consultor) &&
                    consultorStatus(registro.consultor) !== 'ATIVO' && (
                      <Badge variant="destructive" className="gap-1">
                        <ShieldAlert size={12} />
                        Consultor suspenso
                      </Badge>
                    )}
                </div>

                {/* Próxima ação em destaque */}
                {(() => {
                  const proxima = proximaAcao(registro.planoAcao);
                  if (!proxima) return null;
                  return (
                    <div className="flex items-start gap-2 rounded-md border border-border bg-muted px-3 py-2">
                      <ListChecks size={16} className="mt-0.5 shrink-0 text-foreground" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-muted-foreground">Próxima ação</p>
                        <p className="text-sm text-foreground">{proxima.descricao}</p>
                        {proxima.dueDate &&
                          (planoVencido(proxima) ? (
                            <Badge variant="destructive" className="mt-1">
                              Vencida em {fmtData(proxima.dueDate)}
                            </Badge>
                          ) : (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              Prazo: {fmtData(proxima.dueDate)}
                            </p>
                          ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Metadados */}
                <div className="space-y-3">
                  <DetailRow label="Cliente" value={registro.clienteNome} />
                  <DetailRow label="CNPJ" value={registro.clienteCnpj} />
                  <DetailRow label="Contato" value={registro.clienteContato} />
                  <DetailRow label="Descrição" value={registro.descricao} />
                  <DetailRow label="Valor estimado" value={fmtBRL(registro.valorEstimado)} />
                  <DetailRow label="Observações" value={registro.observacoes} />
                  <DetailRow label="Consultor" value={registro.consultor?.nome} />
                  {registro.deal?.stage && (
                    <DetailRow
                      label="Estágio no pipeline"
                      value={
                        registro.deal.status
                          ? `${registro.deal.stage} · ${registro.deal.status}`
                          : registro.deal.stage
                      }
                    />
                  )}
                  <DetailRow
                    label="Registrado em (imutável)"
                    value={fmtData(registro.createdAt)}
                  />
                  <DetailRow
                    label="Proteção (dias)"
                    value={
                      registro.protecaoDias !== null ? String(registro.protecaoDias) : null
                    }
                  />
                  <DetailRow label="Proteção até" value={fmtData(registro.protecaoFim)} />
                  <DetailRow
                    label="Próximo update em"
                    value={fmtData(registro.proximoUpdateEm)}
                  />
                  <DetailRow
                    label="Última atividade"
                    value={fmtData(registro.ultimaAtividadeEm)}
                  />
                  {registro.valorContrato !== null && (
                    <DetailRow
                      label="Valor do contrato"
                      value={fmtBRL(registro.valorContrato)}
                    />
                  )}
                  {registro.ganhoEm && (
                    <DetailRow label="Ganho em" value={fmtData(registro.ganhoEm)} />
                  )}
                  {registro.motivoDecisao && (
                    <DetailRow label="Motivo da decisão" value={registro.motivoDecisao} />
                  )}
                </div>

                {/* Editar dados do cliente (corrigir/definir CNPJ — re-detecta conflito) */}
                <div className="border-t border-border pt-4">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => {
                      setClienteNome(registro.clienteNome ?? '');
                      setClienteCnpj(registro.clienteCnpj ?? '');
                      setClienteContato(registro.clienteContato ?? '');
                      setClienteOpen(true);
                    }}
                  >
                    <Pencil size={14} />
                    Editar cliente
                  </Button>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Corrigir ou definir o CNPJ dispara nova detecção de conflito.
                  </p>
                </div>

                {/* Ações: SUBMETIDO */}
                {registro.status === 'SUBMETIDO' && (
                  <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                    <Button
                      className="gap-1.5"
                      onClick={() => {
                        setAprovarDias('');
                        setAprovarMotivo('');
                        setAprovarOpen(true);
                      }}
                    >
                      <CheckCircle2 size={16} />
                      Aprovar
                    </Button>
                    <Button
                      variant="destructive"
                      className="gap-1.5"
                      onClick={() => {
                        setRejeitarMotivo('');
                        setRejeitarOpen(true);
                      }}
                    >
                      <XCircle size={16} />
                      Rejeitar
                    </Button>
                  </div>
                )}

                {/* Ações: APROVADO */}
                {registro.status === 'APROVADO' && (
                  <div className="space-y-3 border-t border-border pt-4">
                    <p className="text-sm font-semibold text-foreground">
                      Adicionar atualização
                    </p>
                    <Textarea
                      rows={3}
                      value={updateTexto}
                      onChange={(e) => setUpdateTexto(e.target.value)}
                      placeholder="Descreva o andamento da oportunidade…"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        className="gap-1.5"
                        disabled={!updateTexto.trim() || sheetBusy}
                        onClick={handleAddUpdate}
                      >
                        <Send size={14} />
                        Registrar atualização
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={() => {
                          setGanhoValor('');
                          setGanhoOpen(true);
                        }}
                      >
                        <Trophy size={14} />
                        Marcar GANHO
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={() => {
                          setPerdidoMotivo('');
                          setPerdidoOpen(true);
                        }}
                      >
                        <XCircle size={14} />
                        Marcar perdido
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={() => {
                          setProtecaoDias('');
                          setProtecaoNovoFim('');
                          setProtecaoMotivo('');
                          setProtecaoOpen(true);
                        }}
                      >
                        <Clock size={14} />
                        Ajustar proteção
                      </Button>
                    </div>
                  </div>
                )}

                {/* Ações: EXPIRADO */}
                {registro.status === 'EXPIRADO' && (
                  <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                    <Button
                      className="gap-1.5"
                      onClick={() => {
                        setReativarDias('');
                        setReativarMotivo('');
                        setReativarOpen(true);
                      }}
                    >
                      <RefreshCw size={16} />
                      Reativar
                    </Button>
                    <Button
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => {
                        setGanhoValor('');
                        setGanhoOpen(true);
                      }}
                    >
                      <Trophy size={16} />
                      Marcar GANHO
                    </Button>
                    <Button
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => {
                        setPerdidoMotivo('');
                        setPerdidoOpen(true);
                      }}
                    >
                      <XCircle size={16} />
                      Marcar perdido
                    </Button>
                  </div>
                )}

                {/* Recebimentos (GANHO) */}
                {registro.status === 'GANHO' && (
                  <div className="space-y-3 border-t border-border pt-4">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                      <Banknote size={16} />
                      Recebimentos
                    </p>
                    {(registro.recebimentos ?? []).length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Nenhum recebimento lançado.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {(registro.recebimentos ?? []).map((rec) => (
                          <div
                            key={rec.id}
                            className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2"
                          >
                            <div className="min-w-0">
                              <p className="text-sm text-foreground">
                                {fmtData(rec.data)} — {fmtBRL(rec.valor)}
                              </p>
                              {rec.referencia && (
                                <p className="text-xs text-muted-foreground">
                                  {rec.referencia}
                                </p>
                              )}
                            </div>
                            <Button
                              variant="outline"
                              size="icon"
                              aria-label="Remover recebimento"
                              disabled={sheetBusy}
                              onClick={() => setRemoverRecId(rec.id)}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <div className="space-y-1">
                        <Label htmlFor="rec-data">Data *</Label>
                        <Input
                          id="rec-data"
                          type="date"
                          value={recData}
                          onChange={(e) => setRecData(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="rec-valor">Valor (R$) *</Label>
                        <Input
                          id="rec-valor"
                          type="number"
                          min="0"
                          step="0.01"
                          value={recValor}
                          onChange={(e) => setRecValor(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="rec-ref">Referência</Label>
                        <Input
                          id="rec-ref"
                          value={recReferencia}
                          onChange={(e) => setRecReferencia(e.target.value)}
                          placeholder="Ex.: NF 123"
                        />
                      </div>
                    </div>
                    <Button
                      size="sm"
                      className="gap-1.5"
                      disabled={!podeLancarRecebimento || sheetBusy}
                      onClick={handleAddRecebimento}
                    >
                      <Plus size={14} />
                      Lançar recebimento
                    </Button>
                  </div>
                )}

                {/* Atribuições (papéis de comissão) */}
                <div className="space-y-3 border-t border-border pt-4">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                    <Users size={16} />
                    Atribuições
                  </p>
                  {(registro.atribuicoes ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Nenhuma atribuição definida.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {(registro.atribuicoes ?? []).map((a) => (
                        <div
                          key={a.id}
                          className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="text-sm text-foreground">{a.consultor.nome}</p>
                            <p className="text-xs text-muted-foreground">
                              {PAPEL_LABEL[a.papel]} ·{' '}
                              {Number(
                                a.percentualOverride ?? a.consultor.comissaoBase
                              ).toLocaleString('pt-BR')}
                              %
                              {a.percentualOverride !== null ? ' (override)' : ''}
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="icon"
                            aria-label="Remover atribuição"
                            disabled={sheetBusy}
                            onClick={() => handleRemoveAtribuicao(a.id)}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <div className="space-y-1">
                      <Label>Consultor</Label>
                      <Select
                        value={atribConsultorId || undefined}
                        onValueChange={setAtribConsultorId}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione…" />
                        </SelectTrigger>
                        <SelectContent>
                          {listaConsultores.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.nome}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Papel</Label>
                      <Select
                        value={atribPapel}
                        onValueChange={(v) => setAtribPapel(v as PapelAtribuicao)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ORIGINADOR">Originador</SelectItem>
                          <SelectItem value="DESENVOLVEDOR">Desenvolvedor</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="atrib-override">% override</Label>
                      <Input
                        id="atrib-override"
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={atribOverride}
                        onChange={(e) => setAtribOverride(e.target.value)}
                        placeholder="Opcional"
                      />
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="gap-1.5"
                    disabled={!atribConsultorId || sheetBusy}
                    onClick={handleSetAtribuicao}
                  >
                    <Plus size={14} />
                    Salvar atribuição
                  </Button>

                  <div className="flex items-end gap-2">
                    <div className="space-y-1">
                      <Label htmlFor="split-originador">Split do originador (%)</Label>
                      <Input
                        id="split-originador"
                        type="number"
                        min="0"
                        max="100"
                        value={splitInput}
                        onChange={(e) => setSplitInput(e.target.value)}
                        className="w-32"
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!splitValido || sheetBusy}
                      onClick={handleSetSplit}
                    >
                      Salvar split
                    </Button>
                  </div>
                </div>

                {/* Plano de ação bilateral */}
                <div className="space-y-3 border-t border-border pt-4">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                    <ListChecks size={16} />
                    Plano de ação
                  </p>
                  {(registro.planoAcao ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhuma ação no plano.</p>
                  ) : (
                    <div className="space-y-2">
                      {(registro.planoAcao ?? []).map((item) => (
                        <div
                          key={item.id}
                          className="flex items-start justify-between gap-2 rounded-md border border-border bg-card px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="text-sm text-foreground">{item.descricao}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <Badge variant="secondary">
                                {item.responsavelConsultor
                                  ? registro.consultor?.nome
                                    ? `Consultor · ${registro.consultor.nome}`
                                    : 'Consultor'
                                  : item.responsavelUserId
                                    ? `Tenax · ${
                                        listaUsuariosInternos.find(
                                          (u) => u.id === item.responsavelUserId
                                        )?.name ?? 'responsável'
                                      }`
                                    : 'Tenax'}
                              </Badge>
                              <Badge
                                variant={
                                  item.status === 'CONCLUIDA'
                                    ? 'default'
                                    : item.status === 'CANCELADA'
                                      ? 'outline'
                                      : 'secondary'
                                }
                              >
                                {PLANO_STATUS_LABEL[item.status]}
                              </Badge>
                              {item.dueDate &&
                                (planoVencido(item) ? (
                                  <Badge variant="destructive">
                                    Vencida em {fmtData(item.dueDate)}
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">
                                    Prazo: {fmtData(item.dueDate)}
                                  </span>
                                ))}
                            </div>
                          </div>
                          <div className="flex shrink-0 gap-1">
                            {item.status === 'PENDENTE' && (
                              <Button
                                variant="outline"
                                size="icon"
                                aria-label="Concluir ação"
                                disabled={sheetBusy}
                                onClick={() => handleConcluirPlano(item.id)}
                              >
                                <CheckCircle2 size={14} />
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="icon"
                              aria-label="Excluir ação"
                              disabled={sheetBusy}
                              onClick={() => handleExcluirPlano(item.id)}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <Label htmlFor="plano-descricao">Descrição *</Label>
                      <Input
                        id="plano-descricao"
                        value={planoDescricao}
                        onChange={(e) => setPlanoDescricao(e.target.value)}
                        placeholder="Ex.: agendar reunião técnica com o cliente"
                      />
                    </div>
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="flex items-center gap-2 pb-2">
                        <Switch
                          id="plano-consultor"
                          checked={planoConsultor}
                          onCheckedChange={(checked) => {
                            setPlanoConsultor(checked);
                            if (checked) setPlanoResponsavelUserId('');
                          }}
                        />
                        <Label htmlFor="plano-consultor">Ação do consultor</Label>
                      </div>
                      {!planoConsultor && (
                        <div className="space-y-1">
                          <Label>Responsável (Tenax)</Label>
                          <Select
                            value={planoResponsavelUserId || undefined}
                            onValueChange={setPlanoResponsavelUserId}
                          >
                            <SelectTrigger className="w-52">
                              <SelectValue placeholder="Selecione…" />
                            </SelectTrigger>
                            <SelectContent>
                              {listaUsuariosInternos.map((u) => (
                                <SelectItem key={u.id} value={u.id}>
                                  {u.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      <div className="space-y-1">
                        <Label htmlFor="plano-due">Prazo</Label>
                        <Input
                          id="plano-due"
                          type="date"
                          value={planoDueDate}
                          onChange={(e) => setPlanoDueDate(e.target.value)}
                          className="w-40"
                        />
                      </div>
                      <Button
                        size="sm"
                        className="gap-1.5"
                        disabled={!planoDescricao.trim() || sheetBusy}
                        onClick={handleCriarPlanoItem}
                      >
                        <Plus size={14} />
                        Adicionar ação
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Updates (histórico, read-only) */}
                <div className="space-y-2 border-t border-border pt-4">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                    <Send size={16} />
                    Atualizações
                  </p>
                  {(registro.updates ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Nenhuma atualização registrada.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {(registro.updates ?? []).map((u) => (
                        <div
                          key={u.id}
                          className="rounded-md border border-border bg-card px-3 py-2"
                        >
                          <p className="text-sm text-foreground">{u.texto}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {fmtData(u.createdAt)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Auditoria (read-only) */}
                <div className="space-y-2 border-t border-border pt-4">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                    <History size={16} />
                    Auditoria
                  </p>
                  {(registro.auditoria ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Nenhum evento de auditoria.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {(registro.auditoria ?? []).map((ev) => (
                        <div
                          key={ev.id}
                          className="rounded-md border border-border bg-card px-3 py-2"
                        >
                          <p className="text-sm font-medium text-foreground">{ev.evento}</p>
                          {ev.detalhe && (
                            <p className="text-sm text-muted-foreground">{ev.detalhe}</p>
                          )}
                          <p className="mt-1 text-xs text-muted-foreground">
                            {fmtData(ev.createdAt)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* ── Dialog: registrar em nome de consultor ── */}
      <Dialog
        open={novoOpen}
        onOpenChange={(open) => {
          setNovoOpen(open);
          if (!open) setNovoForm(NOVO_REGISTRO_INICIAL);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Registrar em nome de consultor</DialogTitle>
            <DialogDescription>
              Cria um registro de oportunidade interno em nome de um consultor parceiro.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Consultor *</Label>
              <Select
                value={novoForm.consultorId || undefined}
                onValueChange={(v) => setNovoField('consultorId', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione…" />
                </SelectTrigger>
                <SelectContent>
                  {listaConsultores.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="novo-cliente">Cliente *</Label>
              <Input
                id="novo-cliente"
                value={novoForm.clienteNome}
                onChange={(e) => setNovoField('clienteNome', e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="novo-cnpj">CNPJ</Label>
                <Input
                  id="novo-cnpj"
                  value={novoForm.clienteCnpj}
                  onChange={(e) => setNovoField('clienteCnpj', e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="novo-contato">Contato</Label>
                <Input
                  id="novo-contato"
                  value={novoForm.clienteContato}
                  onChange={(e) => setNovoField('clienteContato', e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="novo-descricao">Descrição *</Label>
              <Textarea
                id="novo-descricao"
                rows={3}
                value={novoForm.descricao}
                onChange={(e) => setNovoField('descricao', e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="novo-valor">Valor estimado (R$)</Label>
              <Input
                id="novo-valor"
                type="number"
                min="0"
                step="0.01"
                value={novoForm.valorEstimado}
                onChange={(e) => setNovoField('valorEstimado', e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="novo-obs">Observações</Label>
              <Textarea
                id="novo-obs"
                rows={2}
                value={novoForm.observacoes}
                onChange={(e) => setNovoField('observacoes', e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setNovoOpen(false);
                setNovoForm(NOVO_REGISTRO_INICIAL);
              }}
              disabled={salvandoNovo}
            >
              Cancelar
            </Button>
            <Button onClick={handleCriarRegistro} disabled={!podeSalvarNovo || salvandoNovo}>
              {salvandoNovo ? 'Salvando…' : 'Criar registro'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: decidir extensão de proteção ── */}
      <Dialog
        open={!!extDecisao}
        onOpenChange={(open) => {
          if (!open) setExtDecisao(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {extDecisao?.aprovar ? 'Aprovar extensão de proteção' : 'Negar extensão de proteção'}
            </DialogTitle>
            <DialogDescription>
              {extDecisao?.ext.registro
                ? `${extDecisao.ext.registro.consultor.nome} — ${extDecisao.ext.registro.clienteNome}`
                : 'Pedido de extensão do período de proteção.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {extDecisao?.aprovar && (
              <div className="space-y-1">
                <Label htmlFor="ext-dias">Dias de extensão</Label>
                <Input
                  id="ext-dias"
                  type="number"
                  min="1"
                  value={extDias}
                  onChange={(e) => setExtDias(e.target.value)}
                  placeholder="Ex.: 30"
                />
                <p className="text-xs text-muted-foreground">
                  Deixe em branco para usar o padrão do pedido/tenant.
                </p>
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="ext-motivo">Motivo</Label>
              <Textarea
                id="ext-motivo"
                rows={2}
                value={extMotivo}
                onChange={(e) => setExtMotivo(e.target.value)}
                placeholder={
                  extDecisao?.aprovar
                    ? 'Opcional — justificativa da aprovação'
                    : 'Opcional — justificativa da negativa'
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setExtDecisao(null)} disabled={decidindoExt}>
              Cancelar
            </Button>
            <Button
              variant={extDecisao?.aprovar ? 'default' : 'destructive'}
              onClick={handleDecidirExtensao}
              disabled={decidindoExt}
            >
              {decidindoExt
                ? 'Registrando…'
                : extDecisao?.aprovar
                  ? 'Aprovar extensão'
                  : 'Negar extensão'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: aprovar registro ── */}
      <Dialog open={aprovarOpen} onOpenChange={setAprovarOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aprovar registro</DialogTitle>
            <DialogDescription>
              Aprova a oportunidade e inicia o período de proteção do consultor.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="aprovar-dias">Proteção (dias)</Label>
              <Input
                id="aprovar-dias"
                type="number"
                min="1"
                value={aprovarDias}
                onChange={(e) => setAprovarDias(e.target.value)}
                placeholder="Padrão do tenant"
              />
              <p className="text-xs text-muted-foreground">
                Deixe em branco para usar o padrão do tenant.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="aprovar-motivo">Motivo</Label>
              <Textarea
                id="aprovar-motivo"
                rows={2}
                value={aprovarMotivo}
                onChange={(e) => setAprovarMotivo(e.target.value)}
                placeholder="Opcional"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAprovarOpen(false)} disabled={busyAcao}>
              Cancelar
            </Button>
            <Button onClick={handleAprovar} disabled={busyAcao}>
              {busyAcao ? 'Aprovando…' : 'Aprovar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: rejeitar registro ── */}
      <Dialog open={rejeitarOpen} onOpenChange={setRejeitarOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rejeitar registro</DialogTitle>
            <DialogDescription>
              Informe o motivo da rejeição — ele fica visível para o consultor.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="rejeitar-motivo">Motivo *</Label>
            <Textarea
              id="rejeitar-motivo"
              rows={3}
              value={rejeitarMotivo}
              onChange={(e) => setRejeitarMotivo(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejeitarOpen(false)} disabled={busyAcao}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleRejeitar}
              disabled={!rejeitarMotivo.trim() || busyAcao}
            >
              {busyAcao ? 'Rejeitando…' : 'Rejeitar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: marcar GANHO ── */}
      <Dialog open={ganhoOpen} onOpenChange={setGanhoOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Marcar como GANHO</DialogTitle>
            <DialogDescription>
              Informe o valor do contrato fechado para liberar o cálculo de comissões.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="ganho-valor">Valor do contrato (R$) *</Label>
            <Input
              id="ganho-valor"
              type="number"
              min="0"
              step="0.01"
              value={ganhoValor}
              onChange={(e) => setGanhoValor(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGanhoOpen(false)} disabled={busyAcao}>
              Cancelar
            </Button>
            <Button
              onClick={handleGanho}
              disabled={!ganhoValor.trim() || !(Number(ganhoValor) > 0) || busyAcao}
            >
              {busyAcao ? 'Salvando…' : 'Confirmar GANHO'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: marcar perdido ── */}
      <Dialog open={perdidoOpen} onOpenChange={setPerdidoOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Marcar como perdido</DialogTitle>
            <DialogDescription>
              Opcionalmente registre o motivo da perda da oportunidade.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="perdido-motivo">Motivo</Label>
            <Textarea
              id="perdido-motivo"
              rows={3}
              value={perdidoMotivo}
              onChange={(e) => setPerdidoMotivo(e.target.value)}
              placeholder="Opcional"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPerdidoOpen(false)} disabled={busyAcao}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handlePerdido} disabled={busyAcao}>
              {busyAcao ? 'Salvando…' : 'Marcar perdido'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: reativar registro expirado ── */}
      <Dialog open={reativarOpen} onOpenChange={setReativarOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reativar registro</DialogTitle>
            <DialogDescription>
              Reabre a oportunidade expirada e inicia uma nova janela de proteção.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="reativar-dias">Proteção (dias)</Label>
              <Input
                id="reativar-dias"
                type="number"
                min="1"
                value={reativarDias}
                onChange={(e) => setReativarDias(e.target.value)}
                placeholder="Padrão do tenant"
              />
              <p className="text-xs text-muted-foreground">
                Deixe em branco para usar o padrão do tenant.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="reativar-motivo">Motivo</Label>
              <Textarea
                id="reativar-motivo"
                rows={2}
                value={reativarMotivo}
                onChange={(e) => setReativarMotivo(e.target.value)}
                placeholder="Opcional"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReativarOpen(false)} disabled={busyAcao}>
              Cancelar
            </Button>
            <Button onClick={handleReativar} disabled={busyAcao}>
              {busyAcao ? 'Reativando…' : 'Reativar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: ajustar janela de proteção ── */}
      <Dialog open={protecaoOpen} onOpenChange={setProtecaoOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajustar proteção</DialogTitle>
            <DialogDescription>
              Estenda ou reduza a janela de proteção. Informe os dias a somar OU uma nova data
              de término.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="protecao-dias">Dias (+/-)</Label>
              <Input
                id="protecao-dias"
                type="number"
                value={protecaoDias}
                onChange={(e) => setProtecaoDias(e.target.value)}
                placeholder="Ex.: 30 ou -15"
              />
              <p className="text-xs text-muted-foreground">
                Somado ao término atual. Ignore se preencher a nova data abaixo.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="protecao-fim">Nova data de término</Label>
              <Input
                id="protecao-fim"
                type="date"
                value={protecaoNovoFim}
                onChange={(e) => setProtecaoNovoFim(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="protecao-motivo">Motivo *</Label>
              <Textarea
                id="protecao-motivo"
                rows={2}
                value={protecaoMotivo}
                onChange={(e) => setProtecaoMotivo(e.target.value)}
                placeholder="Justificativa do ajuste (obrigatório)"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProtecaoOpen(false)} disabled={busyAcao}>
              Cancelar
            </Button>
            <Button
              onClick={handleAjustarProtecao}
              disabled={!protecaoMotivo.trim() || busyAcao}
            >
              {busyAcao ? 'Salvando…' : 'Ajustar proteção'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: editar dados do cliente ── */}
      <Dialog open={clienteOpen} onOpenChange={setClienteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar cliente</DialogTitle>
            <DialogDescription>
              Corrija ou complete os dados do cliente. Alterar o CNPJ dispara nova detecção de
              conflito.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="cliente-nome">Cliente *</Label>
              <Input
                id="cliente-nome"
                value={clienteNome}
                onChange={(e) => setClienteNome(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cliente-cnpj">CNPJ</Label>
              <Input
                id="cliente-cnpj"
                value={clienteCnpj}
                onChange={(e) => setClienteCnpj(e.target.value)}
                placeholder="Somente números"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cliente-contato">Contato</Label>
              <Input
                id="cliente-contato"
                value={clienteContato}
                onChange={(e) => setClienteContato(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClienteOpen(false)} disabled={busyAcao}>
              Cancelar
            </Button>
            <Button
              onClick={handleAtualizarCliente}
              disabled={!clienteNome.trim() || busyAcao}
            >
              {busyAcao ? 'Salvando…' : 'Salvar cliente'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── AlertDialog: remover recebimento ── */}
      <AlertDialog
        open={!!removerRecId}
        onOpenChange={(open) => {
          if (!open) setRemoverRecId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover recebimento</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação remove o recebimento e as parcelas de comissão geradas por ele. Deseja
              continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sheetBusy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              disabled={sheetBusy}
              onClick={(e) => {
                e.preventDefault();
                handleRemoverRecebimento();
              }}
            >
              {sheetBusy ? 'Removendo…' : 'Remover'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Linha rótulo/valor do detalhe — oculta valores vazios com um traço. */
function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="col-span-2 text-sm text-foreground">
        {value && value.trim() ? value : '—'}
      </span>
    </div>
  );
}
