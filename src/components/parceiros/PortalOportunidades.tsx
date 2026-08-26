// Portal do consultor — minhas oportunidades.
// Registro de oportunidade, lista de cards, detalhe lateral (Sheet) com
// atualizações, pedido de extensão e plano de ação do consultor.
// Todas as chamadas de API passam pelos hooks de usePortalParceiro.ts.

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Plus,
  Loader2,
  AlertTriangle,
  Handshake,
  CalendarClock,
  CheckCircle2,
  Hourglass,
  MessageSquarePlus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
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
  usePortalRegistros,
  usePortalRegistro,
  usePortalActions,
} from '@/hooks/usePortalParceiro';
import type {
  Registro,
  RegistroInput,
  RegistroStatus,
  PlanoAcaoStatus,
} from '@/types/parceiros';

// ── Rótulos canônicos de status (pt-BR) ─────────────────────────────────────
type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

const REGISTRO_STATUS_LABEL: Record<RegistroStatus, string> = {
  SUBMETIDO: 'Aguardando aprovação',
  EM_ANALISE: 'Em análise',
  APROVADO: 'Aprovado',
  REJEITADO: 'Rejeitado',
  EXPIRADO: 'Expirado',
  GANHO: 'Ganho',
  PERDIDO: 'Perdido',
};

const REGISTRO_STATUS_VARIANT: Record<RegistroStatus, BadgeVariant> = {
  SUBMETIDO: 'outline',
  EM_ANALISE: 'secondary',
  APROVADO: 'default',
  REJEITADO: 'destructive',
  EXPIRADO: 'destructive',
  GANHO: 'default',
  PERDIDO: 'outline',
};

const PLANO_STATUS_LABEL: Record<PlanoAcaoStatus, string> = {
  PENDENTE: 'Pendente',
  CONCLUIDA: 'Concluída',
  CANCELADA: 'Cancelada',
};

const PLANO_STATUS_VARIANT: Record<PlanoAcaoStatus, BadgeVariant> = {
  PENDENTE: 'secondary',
  CONCLUIDA: 'default',
  CANCELADA: 'outline',
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Formata Decimal (string|number) como BRL; null quando ausente/ inválido. */
function formatValor(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? brl.format(n) : null;
}

function formatData(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('pt-BR');
}

/** Dias (arredondados para cima) até o fim da proteção; null se indefinido. */
function diasAteExpirar(protecaoFim: string | null | undefined): number | null {
  if (!protecaoFim) return null;
  const fim = new Date(protecaoFim).getTime();
  if (!Number.isFinite(fim)) return null;
  return Math.ceil((fim - Date.now()) / 86_400_000);
}

function updateAtrasado(r: Registro): boolean {
  if (!r.proximoUpdateEm) return false;
  const t = new Date(r.proximoUpdateEm).getTime();
  return Number.isFinite(t) && t < Date.now();
}

function acoesPendentes(r: Registro): number {
  if (r.planoAcao) return r.planoAcao.filter((a) => a.status === 'PENDENTE').length;
  return r._count?.planoAcao ?? 0;
}

function acaoVencida(dueDate: string | null, status: PlanoAcaoStatus): boolean {
  if (!dueDate || status !== 'PENDENTE') return false;
  const t = new Date(dueDate).getTime();
  return Number.isFinite(t) && t < Date.now();
}

// ── Formulário de novo registro ──────────────────────────────────────────────
interface NovoRegistroForm {
  clienteNome: string;
  clienteCnpj: string;
  clienteContato: string;
  descricao: string;
  valorEstimado: string;
  observacoes: string;
}

const FORM_INICIAL: NovoRegistroForm = {
  clienteNome: '',
  clienteCnpj: '',
  clienteContato: '',
  descricao: '',
  valorEstimado: '',
  observacoes: '',
};

export function PortalOportunidades() {
  const actions = usePortalActions();
  const { data: registros, isLoading, isError } = usePortalRegistros();

  // Detalhe (Sheet).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const {
    data: detalhe,
    isLoading: detalheLoading,
    isError: detalheErro,
  } = usePortalRegistro(selectedId);

  // Dialog de registro.
  const [novoOpen, setNovoOpen] = useState(false);
  const [form, setForm] = useState<NovoRegistroForm>(FORM_INICIAL);
  const [salvando, setSalvando] = useState(false);

  // Atualização (dentro do detalhe).
  const [updateTexto, setUpdateTexto] = useState('');
  const [enviandoUpdate, setEnviandoUpdate] = useState(false);

  // Pedido de extensão (Dialog dentro do detalhe).
  const [extOpen, setExtOpen] = useState(false);
  const [extJustificativa, setExtJustificativa] = useState('');
  const [extDias, setExtDias] = useState('');
  const [enviandoExt, setEnviandoExt] = useState(false);

  // Conclusão de ação do plano.
  const [concluindoId, setConcluindoId] = useState<string | null>(null);

  const setFormField = <K extends keyof NovoRegistroForm>(
    key: K,
    value: NovoRegistroForm[K]
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  const podeRegistrar =
    form.clienteNome.trim().length > 0 && form.descricao.trim().length > 0;

  const handleCriar = async () => {
    if (!podeRegistrar) return;
    const valorNum = form.valorEstimado.trim() ? Number(form.valorEstimado) : NaN;
    const input: RegistroInput = {
      clienteNome: form.clienteNome.trim(),
      clienteCnpj: form.clienteCnpj.trim() || null,
      clienteContato: form.clienteContato.trim() || null,
      descricao: form.descricao.trim(),
      valorEstimado: Number.isFinite(valorNum) ? valorNum : null,
      observacoes: form.observacoes.trim() || null,
    };
    setSalvando(true);
    try {
      const criado = await actions.criarRegistro(input);
      setNovoOpen(false);
      setForm(FORM_INICIAL);
      // Registro foi criado; se houver possíveis duplicatas do próprio consultor,
      // avisamos (sem bloquear) para que considere unificar.
      const duplicatas = criado?.possivelDuplicata ?? [];
      if (duplicatas.length > 0) {
        const nomes = duplicatas.map((d) => d.clienteNome).join(', ');
        toast.warning('Você já tem um registro para este cliente — considere unificar', {
          description: nomes,
        });
      }
    } catch {
      // erro já sinalizado via toast no hook
    } finally {
      setSalvando(false);
    }
  };

  const handleAddUpdate = async () => {
    if (!detalhe || !updateTexto.trim()) return;
    setEnviandoUpdate(true);
    try {
      await actions.addUpdate(detalhe.id, updateTexto.trim());
      setUpdateTexto('');
    } catch {
      // toast pelo hook
    } finally {
      setEnviandoUpdate(false);
    }
  };

  const handlePedirExtensao = async () => {
    if (!detalhe || !extJustificativa.trim()) return;
    const dias = extDias.trim() ? Number(extDias) : NaN;
    setEnviandoExt(true);
    try {
      await actions.pedirExtensao(detalhe.id, {
        justificativa: extJustificativa.trim(),
        ...(Number.isFinite(dias) && dias > 0 ? { diasSolicitados: dias } : {}),
      });
      setExtOpen(false);
      setExtJustificativa('');
      setExtDias('');
    } catch {
      // toast pelo hook
    } finally {
      setEnviandoExt(false);
    }
  };

  const handleConcluirAcao = async (acaoId: string) => {
    setConcluindoId(acaoId);
    try {
      await actions.concluirAcao(acaoId);
    } catch {
      // toast pelo hook
    } finally {
      setConcluindoId(null);
    }
  };

  const fecharDetalhe = () => {
    setSelectedId(null);
    setUpdateTexto('');
    setExtOpen(false);
    setExtJustificativa('');
    setExtDias('');
  };

  const lista = registros ?? [];

  return (
    <div className="space-y-4">
      {/* ── Cabeçalho + ação principal ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Minhas oportunidades</h2>
          <p className="text-sm text-muted-foreground">
            Registre e acompanhe as oportunidades que você indicou.
          </p>
        </div>
        <Button className="gap-1.5" onClick={() => setNovoOpen(true)}>
          <Plus size={16} />
          Registrar oportunidade
        </Button>
      </div>

      {/* ── Lista / estados ── */}
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center rounded-md border border-border bg-card px-4 py-12 text-center">
          <AlertTriangle className="mb-3 text-destructive" size={32} />
          <p className="font-medium text-foreground">Erro ao carregar suas oportunidades</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Não foi possível buscar seus registros. Tente novamente.
          </p>
        </div>
      ) : lista.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-md border border-border bg-card px-4 py-12 text-center">
          <Handshake className="mb-3 text-muted-foreground" size={32} />
          <p className="font-medium text-foreground">
            Você ainda não registrou oportunidades — registre a primeira.
          </p>
          <Button className="mt-4 gap-1.5" onClick={() => setNovoOpen(true)}>
            <Plus size={16} />
            Registrar oportunidade
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {lista.map((r) => {
            const valor = formatValor(r.valorEstimado);
            const dias = r.status === 'APROVADO' ? diasAteExpirar(r.protecaoFim) : null;
            const pendentes = acoesPendentes(r);
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelectedId(r.id)}
                className="rounded-md border border-border bg-card p-4 text-left transition-colors hover:bg-muted"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-foreground">{r.clienteNome}</p>
                  <Badge variant={REGISTRO_STATUS_VARIANT[r.status]}>
                    {REGISTRO_STATUS_LABEL[r.status]}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-foreground">
                  {valor ?? 'Valor não informado'}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Registrado em {formatData(r.createdAt) ?? '—'}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {dias !== null && (
                    <Badge variant={dias < 7 ? 'destructive' : 'outline'} className="gap-1">
                      <CalendarClock size={12} />
                      {dias <= 0
                        ? 'Expira hoje'
                        : `Expira em ${dias} ${dias === 1 ? 'dia' : 'dias'}`}
                    </Badge>
                  )}
                  {updateAtrasado(r) && (
                    <Badge variant="destructive">Atualização pendente</Badge>
                  )}
                  {pendentes > 0 && (
                    <Badge variant="secondary">
                      {pendentes} {pendentes === 1 ? 'ação pendente' : 'ações pendentes'}
                    </Badge>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Dialog: registrar oportunidade ── */}
      <Dialog
        open={novoOpen}
        onOpenChange={(open) => {
          setNovoOpen(open);
          if (!open) setForm(FORM_INICIAL);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Registrar oportunidade</DialogTitle>
            <DialogDescription>
              Informe os dados do cliente e da oportunidade que você identificou.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="novo-cliente">Cliente *</Label>
              <Input
                id="novo-cliente"
                value={form.clienteNome}
                onChange={(e) => setFormField('clienteNome', e.target.value)}
                placeholder="Nome da empresa cliente"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="novo-cnpj">CNPJ</Label>
              <Input
                id="novo-cnpj"
                value={form.clienteCnpj}
                onChange={(e) => setFormField('clienteCnpj', e.target.value)}
                placeholder="00.000.000/0000-00"
              />
              <p className="text-xs text-muted-foreground">CNPJ garante sua prioridade</p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="novo-contato">Contato no cliente</Label>
              <Input
                id="novo-contato"
                value={form.clienteContato}
                onChange={(e) => setFormField('clienteContato', e.target.value)}
                placeholder="Nome, e-mail ou telefone"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="novo-descricao">Descrição da oportunidade *</Label>
              <Textarea
                id="novo-descricao"
                rows={3}
                value={form.descricao}
                onChange={(e) => setFormField('descricao', e.target.value)}
                placeholder="O que o cliente precisa e qual o contexto?"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="novo-valor">Valor estimado (R$)</Label>
              <Input
                id="novo-valor"
                type="number"
                min="0"
                step="0.01"
                value={form.valorEstimado}
                onChange={(e) => setFormField('valorEstimado', e.target.value)}
                placeholder="Ex.: 50000"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="novo-observacoes">Observações</Label>
              <Textarea
                id="novo-observacoes"
                rows={2}
                value={form.observacoes}
                onChange={(e) => setFormField('observacoes', e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setNovoOpen(false);
                setForm(FORM_INICIAL);
              }}
              disabled={salvando}
            >
              Cancelar
            </Button>
            <Button onClick={handleCriar} disabled={!podeRegistrar || salvando}>
              {salvando ? (
                <>
                  <Loader2 size={16} className="mr-1.5 animate-spin" />
                  Registrando…
                </>
              ) : (
                'Registrar'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Sheet: detalhe da oportunidade ── */}
      <Sheet
        open={!!selectedId}
        onOpenChange={(open) => {
          if (!open) fecharDetalhe();
        }}
      >
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
          {detalheLoading ? (
            <div className="space-y-3 p-4">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : detalheErro ? (
            <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
              <AlertTriangle className="mb-3 text-destructive" size={32} />
              <p className="font-medium text-foreground">
                Erro ao carregar o detalhe da oportunidade
              </p>
              <p className="mt-1 text-sm text-muted-foreground">Tente novamente.</p>
            </div>
          ) : detalhe ? (
            <>
              <SheetHeader>
                <SheetTitle>{detalhe.clienteNome}</SheetTitle>
                <SheetDescription>
                  Registrada em {formatData(detalhe.createdAt) ?? '—'}
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-5 px-4 pb-6">
                <div className="flex flex-wrap gap-2">
                  <Badge variant={REGISTRO_STATUS_VARIANT[detalhe.status]}>
                    {REGISTRO_STATUS_LABEL[detalhe.status]}
                  </Badge>
                  {detalhe.status === 'APROVADO' &&
                    (() => {
                      const dias = diasAteExpirar(detalhe.protecaoFim);
                      if (dias === null) return null;
                      return (
                        <Badge
                          variant={dias < 7 ? 'destructive' : 'outline'}
                          className="gap-1"
                        >
                          <CalendarClock size={12} />
                          {dias <= 0
                            ? 'Expira hoje'
                            : `Expira em ${dias} ${dias === 1 ? 'dia' : 'dias'}`}
                        </Badge>
                      );
                    })()}
                  {updateAtrasado(detalhe) && (
                    <Badge variant="destructive">Atualização pendente</Badge>
                  )}
                </div>

                {detalhe.status === 'REJEITADO' && detalhe.motivoDecisao && (
                  <div className="flex items-start gap-2 rounded-md bg-destructive px-3 py-2 text-destructive-foreground">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                    <p className="text-sm">Motivo da rejeição: {detalhe.motivoDecisao}</p>
                  </div>
                )}

                {/* Campos */}
                <div className="space-y-3">
                  <DetailRow label="CNPJ" value={detalhe.clienteCnpj} />
                  <DetailRow label="Contato" value={detalhe.clienteContato} />
                  <DetailRow label="Descrição" value={detalhe.descricao} />
                  <DetailRow
                    label="Valor estimado"
                    value={formatValor(detalhe.valorEstimado)}
                  />
                  <DetailRow label="Observações" value={detalhe.observacoes} />
                  <DetailRow label="Proteção até" value={formatData(detalhe.protecaoFim)} />
                  <DetailRow
                    label="Próxima atualização"
                    value={formatData(detalhe.proximoUpdateEm)}
                  />
                  {detalhe.deal && (
                    <DetailRow label="Estágio no pipeline" value={detalhe.deal.stage} />
                  )}
                </div>

                {/* Ações do consultor quando APROVADO */}
                {detalhe.status === 'APROVADO' && (
                  <div className="space-y-3 border-t border-border pt-4">
                    <div className="space-y-2">
                      <Label htmlFor="detalhe-update">Adicionar atualização</Label>
                      <Textarea
                        id="detalhe-update"
                        rows={3}
                        value={updateTexto}
                        onChange={(e) => setUpdateTexto(e.target.value)}
                        placeholder="Como está o andamento com o cliente?"
                      />
                      <p className="text-xs text-muted-foreground">
                        Atualizar periodicamente mantém seu registro ativo.
                      </p>
                      <Button
                        className="gap-1.5"
                        disabled={!updateTexto.trim() || enviandoUpdate}
                        onClick={handleAddUpdate}
                      >
                        {enviandoUpdate ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <MessageSquarePlus size={16} />
                        )}
                        Enviar atualização
                      </Button>
                    </div>

                    <Button
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => setExtOpen(true)}
                    >
                      <Hourglass size={16} />
                      Pedir extensão
                    </Button>
                  </div>
                )}

                {/* Minhas ações (plano de ação) */}
                <div className="space-y-2 border-t border-border pt-4">
                  <p className="text-sm font-semibold text-foreground">Minhas ações</p>
                  {!detalhe.planoAcao || detalhe.planoAcao.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Nenhuma ação atribuída a você nesta oportunidade.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {detalhe.planoAcao.map((a) => (
                        <div
                          key={a.id}
                          className="rounded-md border border-border bg-card p-3"
                        >
                          <p className="text-sm text-foreground">{a.descricao}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <Badge variant={PLANO_STATUS_VARIANT[a.status]}>
                              {PLANO_STATUS_LABEL[a.status]}
                            </Badge>
                            {a.dueDate && (
                              <Badge
                                variant={
                                  acaoVencida(a.dueDate, a.status)
                                    ? 'destructive'
                                    : 'outline'
                                }
                                className="gap-1"
                              >
                                <CalendarClock size={12} />
                                Prazo: {formatData(a.dueDate) ?? '—'}
                              </Badge>
                            )}
                            {a.status === 'PENDENTE' && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="ml-auto gap-1"
                                disabled={concluindoId === a.id}
                                onClick={() => handleConcluirAcao(a.id)}
                              >
                                {concluindoId === a.id ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : (
                                  <CheckCircle2 size={14} />
                                )}
                                Concluir
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Histórico de atualizações */}
                <div className="space-y-2 border-t border-border pt-4">
                  <p className="text-sm font-semibold text-foreground">
                    Histórico de atualizações
                  </p>
                  {!detalhe.updates || detalhe.updates.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Nenhuma atualização registrada.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {detalhe.updates.map((u) => (
                        <div
                          key={u.id}
                          className="rounded-md border border-border bg-card p-3"
                        >
                          <p className="text-sm text-foreground">{u.texto}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatData(u.createdAt) ?? '—'}
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

      {/* ── Dialog: pedir extensão de proteção ── */}
      <Dialog
        open={extOpen}
        onOpenChange={(open) => {
          setExtOpen(open);
          if (!open) {
            setExtJustificativa('');
            setExtDias('');
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pedir extensão</DialogTitle>
            <DialogDescription>
              Justifique por que a proteção deste registro deve ser estendida.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="ext-justificativa">Justificativa *</Label>
              <Textarea
                id="ext-justificativa"
                rows={3}
                value={extJustificativa}
                onChange={(e) => setExtJustificativa(e.target.value)}
                placeholder="Explique o andamento e o motivo do pedido"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ext-dias">Dias solicitados</Label>
              <Input
                id="ext-dias"
                type="number"
                min="1"
                step="1"
                value={extDias}
                onChange={(e) => setExtDias(e.target.value)}
                placeholder="Ex.: 30"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setExtOpen(false)}
              disabled={enviandoExt}
            >
              Cancelar
            </Button>
            <Button
              onClick={handlePedirExtensao}
              disabled={!extJustificativa.trim() || enviandoExt}
            >
              {enviandoExt ? (
                <>
                  <Loader2 size={16} className="mr-1.5 animate-spin" />
                  Enviando…
                </>
              ) : (
                'Enviar pedido'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
