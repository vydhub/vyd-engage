// Aba "Relacionamento" do módulo de Gestão de Parceiros Comerciais.
// Reuniões de cadência (agendar, registrar presença, cancelar, excluir) +
// metas por consultor com acompanhamento de meta vs. realizado (reqs 27-28, 33).
// Dados via hooks de useParceiros.ts; progresso de meta via useQuery local
// com apiClient.getMetaProgress (exceção autorizada).

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarPlus,
  ClipboardCheck,
  FileWarning,
  Loader2,
  Target,
  Trash2,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { apiClient } from '@/services/api/client';
import {
  useConsultores,
  useMetasParceiros,
  useParceirosActions,
  useReunioesParceiros,
} from '@/hooks/useParceiros';
import type {
  ConsultorMeta,
  ConsultorReuniao,
  PresencaStatus,
  ReuniaoStatus,
} from '@/types/parceiros';

// ── Rótulos e formatadores (pt-BR) ──────────────────────────────────────────
type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

const REUNIAO_STATUS_LABEL: Record<ReuniaoStatus, string> = {
  AGENDADA: 'Agendada',
  REALIZADA: 'Realizada',
  CANCELADA: 'Cancelada',
};
const REUNIAO_STATUS_VARIANT: Record<ReuniaoStatus, BadgeVariant> = {
  AGENDADA: 'outline',
  REALIZADA: 'default',
  CANCELADA: 'secondary',
};

const MESES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function fmtDataHora(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

/** Reunião agendada cuja data já passou sem registro de presença. */
function registroPendente(r: ConsultorReuniao): boolean {
  return r.status === 'AGENDADA' && new Date(r.dataHora).getTime() < Date.now();
}

// ── Estados de formulário ────────────────────────────────────────────────────
interface AgendarForm {
  consultorId: string;
  dataHora: string;
  pauta: string;
  participantes: string;
}
const AGENDAR_FORM_INICIAL: AgendarForm = {
  consultorId: '',
  dataHora: '',
  pauta: '',
  participantes: '',
};

/** Converte texto separado por vírgula em array de participantes (ou null). */
function parseParticipantes(texto: string): string[] | null {
  const lista = texto
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return lista.length > 0 ? lista : null;
}

interface MetaForm {
  consultorId: string;
  month: string;
  year: string;
  alvoRegistros: string;
  alvoPipeline: string;
  alvoGanho: string;
}
function metaFormInicial(): MetaForm {
  const agora = new Date();
  return {
    consultorId: '',
    month: String(agora.getMonth() + 1),
    year: String(agora.getFullYear()),
    alvoRegistros: '',
    alvoPipeline: '',
    alvoGanho: '',
  };
}

export function RelacionamentoTab() {
  const actions = useParceirosActions();
  const agora = new Date();

  // ── Estado: reuniões ───────────────────────────────────────────────────────
  const [filtroConsultor, setFiltroConsultor] = useState<string>('__todos');
  const [agendarOpen, setAgendarOpen] = useState(false);
  const [agendarForm, setAgendarForm] = useState<AgendarForm>(AGENDAR_FORM_INICIAL);
  const [agendando, setAgendando] = useState(false);
  const [presencaReuniao, setPresencaReuniao] = useState<ConsultorReuniao | null>(null);
  const [presencaValor, setPresencaValor] = useState<PresencaStatus>('PRESENTE');
  const [presencaObs, setPresencaObs] = useState('');
  const [registrando, setRegistrando] = useState(false);
  const [cancelandoId, setCancelandoId] = useState<string | null>(null);
  const [excluirReuniao, setExcluirReuniao] = useState<ConsultorReuniao | null>(null);
  const [excluindoReuniao, setExcluindoReuniao] = useState(false);

  // ── Estado: metas ──────────────────────────────────────────────────────────
  const [consultorSel, setConsultorSel] = useState<string>('');
  const [mesSel, setMesSel] = useState<string>(String(agora.getMonth() + 1));
  const [anoSel, setAnoSel] = useState<string>(String(agora.getFullYear()));
  const [metaOpen, setMetaOpen] = useState(false);
  const [metaForm, setMetaForm] = useState<MetaForm>(metaFormInicial());
  const [salvandoMeta, setSalvandoMeta] = useState(false);
  const [excluirMeta, setExcluirMeta] = useState<ConsultorMeta | null>(null);
  const [excluindoMeta, setExcluindoMeta] = useState(false);

  // ── Queries ────────────────────────────────────────────────────────────────
  const filtrosReunioes = useMemo<Record<string, string>>(() => {
    const f: Record<string, string> = {};
    if (filtroConsultor !== '__todos') f.consultorId = filtroConsultor;
    return f;
  }, [filtroConsultor]);
  const reunioesQ = useReunioesParceiros(filtrosReunioes);
  const consultoresQ = useConsultores();
  const metasQ = useMetasParceiros();

  const mesNum = Number(mesSel);
  const anoNum = Number(anoSel);
  const progressoHabilitado =
    !!consultorSel && Number.isInteger(mesNum) && Number.isInteger(anoNum) && anoNum > 0;
  const progressQ = useQuery({
    queryKey: ['meta-progress', consultorSel, mesNum, anoNum],
    queryFn: () => apiClient.getMetaProgress(consultorSel, mesNum, anoNum),
    enabled: progressoHabilitado,
  });

  const consultores = consultoresQ.data ?? [];
  const reunioes = reunioesQ.data ?? [];
  const metas = metasQ.data ?? [];

  // ── Ações: reuniões ────────────────────────────────────────────────────────
  const podeAgendar = agendarForm.consultorId !== '' && agendarForm.dataHora !== '';

  const handleAgendar = async () => {
    if (!podeAgendar) return;
    setAgendando(true);
    try {
      const payload = {
        consultorId: agendarForm.consultorId,
        dataHora: new Date(agendarForm.dataHora).toISOString(),
        pauta: agendarForm.pauta.trim() || null,
        participantes: parseParticipantes(agendarForm.participantes),
      };
      await actions.createReuniao(payload);
      setAgendarOpen(false);
      setAgendarForm(AGENDAR_FORM_INICIAL);
    } catch {
      // erro já sinalizado via toast no hook
    } finally {
      setAgendando(false);
    }
  };

  const abrirPresenca = (r: ConsultorReuniao) => {
    setPresencaValor('PRESENTE');
    setPresencaObs('');
    setPresencaReuniao(r);
  };

  const handleRegistrarPresenca = async () => {
    if (!presencaReuniao) return;
    setRegistrando(true);
    try {
      await actions.registrarPresenca(
        presencaReuniao.id,
        presencaValor,
        presencaObs.trim() || undefined
      );
      setPresencaReuniao(null);
    } catch {
      // toast pelo hook
    } finally {
      setRegistrando(false);
    }
  };

  const handleCancelarReuniao = async (id: string) => {
    setCancelandoId(id);
    try {
      await actions.updateReuniao(id, { status: 'CANCELADA' });
    } catch {
      // toast pelo hook
    } finally {
      setCancelandoId(null);
    }
  };

  const handleExcluirReuniao = async () => {
    if (!excluirReuniao) return;
    setExcluindoReuniao(true);
    try {
      await actions.deleteReuniao(excluirReuniao.id);
      setExcluirReuniao(null);
    } catch {
      // toast pelo hook
    } finally {
      setExcluindoReuniao(false);
    }
  };

  // ── Ações: metas ───────────────────────────────────────────────────────────
  const metaMonth = Number(metaForm.month);
  const metaYear = Number(metaForm.year);
  const podeSalvarMeta =
    metaForm.consultorId !== '' &&
    Number.isInteger(metaMonth) &&
    metaMonth >= 1 &&
    metaMonth <= 12 &&
    Number.isInteger(metaYear) &&
    metaYear > 0;

  const handleSalvarMeta = async () => {
    if (!podeSalvarMeta) return;
    setSalvandoMeta(true);
    try {
      await actions.upsertMeta({
        consultorId: metaForm.consultorId,
        month: metaMonth,
        year: metaYear,
        ...(metaForm.alvoRegistros.trim() !== ''
          ? { alvoRegistros: Number(metaForm.alvoRegistros) }
          : {}),
        ...(metaForm.alvoPipeline.trim() !== ''
          ? { alvoPipeline: Number(metaForm.alvoPipeline) }
          : {}),
        ...(metaForm.alvoGanho.trim() !== '' ? { alvoGanho: Number(metaForm.alvoGanho) } : {}),
      });
      setMetaOpen(false);
      setMetaForm(metaFormInicial());
    } catch {
      // toast pelo hook
    } finally {
      setSalvandoMeta(false);
    }
  };

  const handleExcluirMeta = async () => {
    if (!excluirMeta) return;
    setExcluindoMeta(true);
    try {
      await actions.deleteMeta(excluirMeta.id);
      setExcluirMeta(null);
    } catch {
      // toast pelo hook
    } finally {
      setExcluindoMeta(false);
    }
  };

  const setMetaField = <K extends keyof MetaForm>(key: K, value: MetaForm[K]) =>
    setMetaForm((prev) => ({ ...prev, [key]: value }));

  const progresso = progressQ.data;

  return (
    <div className="space-y-6">
      {/* ══ SEÇÃO: REUNIÕES DE CADÊNCIA ══ */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <CardTitle>Reuniões de cadência</CardTitle>
            <CardDescription>
              Acompanhamento periódico com os consultores parceiros.
            </CardDescription>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="space-y-1">
              <Label>Consultor</Label>
              <Select value={filtroConsultor} onValueChange={setFiltroConsultor}>
                <SelectTrigger className="w-full sm:w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__todos">Todos</SelectItem>
                  {consultores.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button className="gap-1.5" onClick={() => setAgendarOpen(true)}>
              <CalendarPlus size={16} />
              Agendar reunião
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {reunioesQ.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : reunioesQ.isError ? (
            <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
              <FileWarning className="mb-3 text-destructive" size={32} />
              <p className="font-medium text-foreground">Erro ao carregar as reuniões</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Não foi possível buscar as reuniões. Tente novamente.
              </p>
            </div>
          ) : reunioes.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
              <CalendarPlus className="mb-3 text-muted-foreground" size={32} />
              <p className="font-medium text-foreground">Nenhuma reunião encontrada</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Ajuste o filtro ou agende a primeira reunião de cadência.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Consultor</TableHead>
                    <TableHead>Data/hora</TableHead>
                    <TableHead>Participantes</TableHead>
                    <TableHead>Pauta</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Presença</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reunioes.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium text-foreground">
                        {r.consultor?.nome ?? '—'}
                      </TableCell>
                      <TableCell className="text-foreground">
                        {fmtDataHora(r.dataHora)}
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-muted-foreground">
                        {r.participantes && r.participantes.length > 0
                          ? r.participantes.join(', ')
                          : '—'}
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-muted-foreground">
                        {r.pauta && r.pauta.trim() ? r.pauta : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant={REUNIAO_STATUS_VARIANT[r.status]}>
                            {REUNIAO_STATUS_LABEL[r.status]}
                          </Badge>
                          {registroPendente(r) && (
                            <Badge variant="destructive">Registro pendente</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {r.presenca === 'PRESENTE' ? (
                          <Badge variant="default">Presente</Badge>
                        ) : r.presenca === 'FALTOU' ? (
                          <Badge variant="destructive">Faltou</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          {r.status === 'AGENDADA' && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-1"
                                onClick={() => abrirPresenca(r)}
                              >
                                <ClipboardCheck size={14} />
                                Registrar presença
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-1"
                                disabled={cancelandoId === r.id}
                                onClick={() => handleCancelarReuniao(r.id)}
                              >
                                {cancelandoId === r.id ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : (
                                  <XCircle size={14} />
                                )}
                                Cancelar
                              </Button>
                            </>
                          )}
                          <Button
                            variant="outline"
                            size="icon"
                            aria-label="Excluir reunião"
                            onClick={() => setExcluirReuniao(r)}
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
        </CardContent>
      </Card>

      {/* ══ SEÇÃO: METAS ══ */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <CardTitle>Metas por consultor</CardTitle>
            <CardDescription>Meta vs. realizado no mês selecionado.</CardDescription>
          </div>
          <Button
            className="gap-1.5"
            onClick={() => {
              setMetaForm(metaFormInicial());
              setMetaOpen(true);
            }}
          >
            <Target size={16} />
            Definir meta
          </Button>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Seleção de consultor + competência */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1">
              <Label>Consultor</Label>
              <Select value={consultorSel} onValueChange={setConsultorSel}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um consultor" />
                </SelectTrigger>
                <SelectContent>
                  {consultores.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      Nenhum consultor cadastrado.
                    </div>
                  ) : (
                    consultores.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nome}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Mês</Label>
              <Select value={mesSel} onValueChange={setMesSel}>
                <SelectTrigger className="w-full sm:w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MESES.map((nome, i) => (
                    <SelectItem key={nome} value={String(i + 1)}>
                      {nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="metas-ano">Ano</Label>
              <Input
                id="metas-ano"
                type="number"
                className="w-full sm:w-28"
                value={anoSel}
                onChange={(e) => setAnoSel(e.target.value)}
              />
            </div>
          </div>

          {/* Progresso meta vs. realizado */}
          {!progressoHabilitado ? (
            <p className="text-sm text-muted-foreground">
              Selecione um consultor (e um ano válido) para ver o progresso da meta.
            </p>
          ) : progressQ.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : progressQ.isError ? (
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted px-3 py-2">
              <FileWarning size={16} className="mt-0.5 shrink-0 text-destructive" />
              <p className="text-sm text-destructive">
                Não foi possível carregar o progresso da meta para o período selecionado.
              </p>
            </div>
          ) : progresso ? (
            <div className="space-y-3 rounded-md border border-border bg-card p-4">
              <ProgressRow
                label="Registros"
                realizado={Number(progresso.realizado.registros)}
                alvo={Number(progresso.meta.alvoRegistros)}
                pct={progresso.pct.registros}
              />
              <ProgressRow
                label="Pipeline"
                realizado={Number(progresso.realizado.pipeline)}
                alvo={Number(progresso.meta.alvoPipeline)}
                pct={progresso.pct.pipeline}
                moeda
              />
              <ProgressRow
                label="Ganho"
                realizado={Number(progresso.realizado.ganho)}
                alvo={Number(progresso.meta.alvoGanho)}
                pct={progresso.pct.ganho}
                moeda
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhum dado de progresso para o período selecionado.
            </p>
          )}

          {/* Lista de metas existentes */}
          <div className="space-y-2">
            <p className="text-sm font-semibold text-foreground">Metas definidas</p>
            {metasQ.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : metasQ.isError ? (
              <div className="flex items-start gap-2 rounded-md border border-border bg-muted px-3 py-2">
                <FileWarning size={16} className="mt-0.5 shrink-0 text-destructive" />
                <p className="text-sm text-destructive">
                  Não foi possível carregar as metas cadastradas.
                </p>
              </div>
            ) : metas.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma meta definida ainda. Use “Definir meta” para criar a primeira.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Consultor</TableHead>
                      <TableHead>Competência</TableHead>
                      <TableHead className="text-right">Registros</TableHead>
                      <TableHead className="text-right">Pipeline</TableHead>
                      <TableHead className="text-right">Ganho</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {metas.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="font-medium text-foreground">
                          {m.consultor?.nome ?? '—'}
                        </TableCell>
                        <TableCell className="text-foreground">
                          {MESES[m.month - 1] ?? m.month}/{m.year}
                        </TableCell>
                        <TableCell className="text-right text-foreground">
                          {m.alvoRegistros}
                        </TableCell>
                        <TableCell className="text-right text-foreground">
                          {brl.format(Number(m.alvoPipeline))}
                        </TableCell>
                        <TableCell className="text-right text-foreground">
                          {brl.format(Number(m.alvoGanho))}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="icon"
                            aria-label="Excluir meta"
                            onClick={() => setExcluirMeta(m)}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Dialog: agendar reunião ── */}
      <Dialog
        open={agendarOpen}
        onOpenChange={(open) => {
          setAgendarOpen(open);
          if (!open) setAgendarForm(AGENDAR_FORM_INICIAL);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agendar reunião</DialogTitle>
            <DialogDescription>
              Agende uma reunião de cadência com um consultor parceiro.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Consultor *</Label>
              <Select
                value={agendarForm.consultorId}
                onValueChange={(v) => setAgendarForm((prev) => ({ ...prev, consultorId: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um consultor" />
                </SelectTrigger>
                <SelectContent>
                  {consultores.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      Nenhum consultor cadastrado.
                    </div>
                  ) : (
                    consultores.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nome}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="reuniao-datahora">Data e hora *</Label>
              <Input
                id="reuniao-datahora"
                type="datetime-local"
                value={agendarForm.dataHora}
                onChange={(e) =>
                  setAgendarForm((prev) => ({ ...prev, dataHora: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="reuniao-participantes">Participantes</Label>
              <Input
                id="reuniao-participantes"
                value={agendarForm.participantes}
                onChange={(e) =>
                  setAgendarForm((prev) => ({ ...prev, participantes: e.target.value }))
                }
                placeholder="Nomes separados por vírgula"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="reuniao-pauta">Pauta</Label>
              <Textarea
                id="reuniao-pauta"
                rows={3}
                value={agendarForm.pauta}
                onChange={(e) => setAgendarForm((prev) => ({ ...prev, pauta: e.target.value }))}
                placeholder="Assuntos a tratar na reunião…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAgendarOpen(false);
                setAgendarForm(AGENDAR_FORM_INICIAL);
              }}
              disabled={agendando}
            >
              Cancelar
            </Button>
            <Button onClick={handleAgendar} disabled={!podeAgendar || agendando}>
              {agendando ? 'Agendando…' : 'Agendar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: registrar presença ── */}
      <Dialog
        open={!!presencaReuniao}
        onOpenChange={(open) => {
          if (!open) setPresencaReuniao(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar presença</DialogTitle>
            <DialogDescription>
              {presencaReuniao
                ? `Reunião com ${presencaReuniao.consultor?.nome ?? 'consultor'} em ${fmtDataHora(
                    presencaReuniao.dataHora
                  )}.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Presença *</Label>
              <div className="flex items-center gap-6">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                  <input
                    type="radio"
                    name="presenca-reuniao"
                    className="h-4 w-4"
                    checked={presencaValor === 'PRESENTE'}
                    onChange={() => setPresencaValor('PRESENTE')}
                  />
                  Presente
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                  <input
                    type="radio"
                    name="presenca-reuniao"
                    className="h-4 w-4"
                    checked={presencaValor === 'FALTOU'}
                    onChange={() => setPresencaValor('FALTOU')}
                  />
                  Faltou
                </label>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="presenca-obs">Observações</Label>
              <Textarea
                id="presenca-obs"
                rows={3}
                value={presencaObs}
                onChange={(e) => setPresencaObs(e.target.value)}
                placeholder="Resumo da reunião, próximos passos…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPresencaReuniao(null)}
              disabled={registrando}
            >
              Cancelar
            </Button>
            <Button onClick={handleRegistrarPresenca} disabled={registrando}>
              {registrando ? 'Registrando…' : 'Registrar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: definir meta ── */}
      <Dialog
        open={metaOpen}
        onOpenChange={(open) => {
          setMetaOpen(open);
          if (!open) setMetaForm(metaFormInicial());
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Definir meta</DialogTitle>
            <DialogDescription>
              Defina os alvos mensais do consultor. Salvar novamente para o mesmo mês
              substitui a meta existente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Consultor *</Label>
              <Select
                value={metaForm.consultorId}
                onValueChange={(v) => setMetaField('consultorId', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um consultor" />
                </SelectTrigger>
                <SelectContent>
                  {consultores.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      Nenhum consultor cadastrado.
                    </div>
                  ) : (
                    consultores.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nome}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Mês *</Label>
                <Select value={metaForm.month} onValueChange={(v) => setMetaField('month', v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MESES.map((nome, i) => (
                      <SelectItem key={nome} value={String(i + 1)}>
                        {nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="meta-ano">Ano *</Label>
                <Input
                  id="meta-ano"
                  type="number"
                  value={metaForm.year}
                  onChange={(e) => setMetaField('year', e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="meta-registros">Alvo de registros</Label>
                <Input
                  id="meta-registros"
                  type="number"
                  min={0}
                  value={metaForm.alvoRegistros}
                  onChange={(e) => setMetaField('alvoRegistros', e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="meta-pipeline">Alvo de pipeline (R$)</Label>
                <Input
                  id="meta-pipeline"
                  type="number"
                  min={0}
                  value={metaForm.alvoPipeline}
                  onChange={(e) => setMetaField('alvoPipeline', e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="meta-ganho">Alvo de ganho (R$)</Label>
                <Input
                  id="meta-ganho"
                  type="number"
                  min={0}
                  value={metaForm.alvoGanho}
                  onChange={(e) => setMetaField('alvoGanho', e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setMetaOpen(false);
                setMetaForm(metaFormInicial());
              }}
              disabled={salvandoMeta}
            >
              Cancelar
            </Button>
            <Button onClick={handleSalvarMeta} disabled={!podeSalvarMeta || salvandoMeta}>
              {salvandoMeta ? 'Salvando…' : 'Salvar meta'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── AlertDialog: excluir reunião ── */}
      <AlertDialog
        open={!!excluirReuniao}
        onOpenChange={(open) => {
          if (!open) setExcluirReuniao(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir reunião</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é permanente e removerá a reunião
              {excluirReuniao
                ? ` com ${excluirReuniao.consultor?.nome ?? 'consultor'} de ${fmtDataHora(
                    excluirReuniao.dataHora
                  )}`
                : ''}
              . Deseja continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluindoReuniao}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              disabled={excluindoReuniao}
              onClick={(e) => {
                e.preventDefault();
                handleExcluirReuniao();
              }}
            >
              {excluindoReuniao ? 'Excluindo…' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── AlertDialog: excluir meta ── */}
      <AlertDialog
        open={!!excluirMeta}
        onOpenChange={(open) => {
          if (!open) setExcluirMeta(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir meta</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é permanente e removerá a meta
              {excluirMeta
                ? ` de ${excluirMeta.consultor?.nome ?? 'consultor'} para ${
                    MESES[excluirMeta.month - 1] ?? excluirMeta.month
                  }/${excluirMeta.year}`
                : ''}
              . Deseja continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluindoMeta}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              disabled={excluindoMeta}
              onClick={(e) => {
                e.preventDefault();
                handleExcluirMeta();
              }}
            >
              {excluindoMeta ? 'Excluindo…' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Linha de progresso meta vs. realizado com barra tokenizada. */
function ProgressRow({
  label,
  realizado,
  alvo,
  pct,
  moeda = false,
}: {
  label: string;
  realizado: number;
  alvo: number;
  pct: number | null;
  moeda?: boolean;
}) {
  const fmt = (v: number) => (moeda ? brl.format(v) : String(v));
  const largura = pct != null ? Math.max(0, Math.min(100, pct)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-foreground">
          {fmt(realizado)} <span className="text-muted-foreground">/ {fmt(alvo)}</span>{' '}
          <span className="font-medium">{pct != null ? `${Math.round(pct)}%` : '—'}</span>
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${largura}%` }} />
      </div>
    </div>
  );
}
