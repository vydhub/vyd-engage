// Captura de Demandas · Contratos LTA (spec captura-demandas, filha 02, E-07).
//
// Rota /app/contratos. Lista, cria e edita contratos, solicitantes, itens e movimentos.
// ADMIN e GESTOR editam; os demais usuários do tenant só leem. O saldo vem calculado do
// servidor. Movimento não se edita: correção é outro movimento. Detalhe em overlay (Sheet).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileText, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { Header } from '../components/Header';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { apiClient, ApiError } from '../services/api/client';
import { useAuth } from '@/contexts/AuthContext';
import { isManagerRole } from '../utils/roles';
import { formatCurrency } from '../utils/format';
import { SaldoContrato } from '../components/companies/SaldoContrato';
import {
  ROTULO_LACUNA,
  ROTULO_MOVIMENTO,
  ROTULO_TIPO_CONTRATO,
  type ContratoDetalhe,
  type ContratoEntrada,
  type ContratoMovimentoTipo,
  type ContratoResumo,
  type ContratoTipo,
  type LacunaContrato,
} from '../types/captura';

const TODAS = 'TODAS';

function mensagemDoErro(erro: unknown, padrao: string): string {
  return erro instanceof ApiError || erro instanceof Error ? erro.message : padrao;
}

function dataCivil(valor: string | null | undefined): string {
  if (!valor) return '—';
  return new Date(`${valor.slice(0, 10)}T00:00:00Z`).toLocaleDateString('pt-BR', {
    timeZone: 'UTC',
  });
}

function BadgesDeLacuna({ lacunas }: { lacunas: LacunaContrato[] }) {
  if (lacunas.length === 0) return <span className="text-xs text-muted-foreground">Completo</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {lacunas.map((l) => (
        <Badge key={l} variant="outline">
          {ROTULO_LACUNA[l]}
        </Badge>
      ))}
    </div>
  );
}

// ── Formulário do contrato ───────────────────────────────────────────────────────

interface FormularioState {
  companyId: string;
  numero: string;
  numeroCliente: string;
  tipo: ContratoTipo;
  objeto: string;
  escopo: string;
  vigenciaInicio: string;
  vigenciaFim: string;
  valorContratado: string;
  slaRespostaHoras: string;
  gerenteNome: string;
  gerenteEmail: string;
  planejadorNome: string;
  planejadorEmail: string;
}

function estadoInicial(contrato: ContratoResumo | null, companyId: string): FormularioState {
  return {
    companyId: contrato?.companyId ?? companyId,
    numero: contrato?.numero ?? '',
    numeroCliente: contrato?.numeroCliente ?? '',
    tipo: contrato?.tipo ?? 'LTA',
    objeto: contrato?.objeto ?? '',
    escopo: contrato?.escopo ?? '',
    vigenciaInicio: contrato?.vigenciaInicio?.slice(0, 10) ?? '',
    vigenciaFim: contrato?.vigenciaFim?.slice(0, 10) ?? '',
    valorContratado: contrato?.valorContratado != null ? String(contrato.valorContratado) : '',
    slaRespostaHoras: contrato?.slaRespostaHoras != null ? String(contrato.slaRespostaHoras) : '',
    gerenteNome: contrato?.gerenteNome ?? '',
    gerenteEmail: contrato?.gerenteEmail ?? '',
    planejadorNome: contrato?.planejadorNome ?? '',
    planejadorEmail: contrato?.planejadorEmail ?? '',
  };
}

function ContratoFormDialog({
  aberto,
  contrato,
  empresaInicial,
  onFechar,
  onSalvo,
}: {
  aberto: boolean;
  contrato: ContratoResumo | null;
  empresaInicial: string;
  onFechar: () => void;
  onSalvo: (id: string) => void;
}) {
  const [form, setForm] = useState(() => estadoInicial(contrato, empresaInicial));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [buscaEmpresa, setBuscaEmpresa] = useState('');

  useEffect(() => {
    if (aberto) {
      setForm(estadoInicial(contrato, empresaInicial));
      setErro(null);
      setBuscaEmpresa('');
    }
  }, [aberto, contrato, empresaInicial]);

  const { data: empresas = [] } = useQuery({
    queryKey: ['contratos-empresas', buscaEmpresa],
    queryFn: async () => {
      const res = await apiClient.getCompanies({ search: buscaEmpresa || undefined, limit: 20 });
      return res.companies as Array<{ id: string; name: string }>;
    },
    enabled: aberto,
    staleTime: 30 * 1000,
  });

  const opcoesEmpresa = useMemo(() => {
    const lista = [...empresas];
    if (contrato && !lista.some((e) => e.id === contrato.companyId)) {
      lista.unshift({ id: contrato.companyId, name: contrato.company.name });
    }
    return lista;
  }, [empresas, contrato]);

  const campo = (nome: keyof FormularioState) => ({
    id: `contrato-${nome}`,
    value: form[nome],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [nome]: e.target.value })),
  });

  const salvar = async () => {
    setErro(null);
    if (!form.companyId) return setErro('Escolha a empresa do contrato.');
    if (!form.numero.trim()) return setErro('Informe o número do contrato.');
    if (form.vigenciaInicio && form.vigenciaFim && form.vigenciaFim < form.vigenciaInicio) {
      return setErro('O fim da vigência deve ser igual ou posterior ao início.');
    }
    const dados: ContratoEntrada = {
      companyId: form.companyId,
      numero: form.numero,
      numeroCliente: form.numeroCliente || null,
      tipo: form.tipo,
      objeto: form.objeto || null,
      escopo: form.escopo || null,
      vigenciaInicio: form.vigenciaInicio || null,
      vigenciaFim: form.vigenciaFim || null,
      valorContratado: form.valorContratado === '' ? null : Number(form.valorContratado),
      slaRespostaHoras: form.slaRespostaHoras === '' ? null : Number(form.slaRespostaHoras),
      gerenteNome: form.gerenteNome || null,
      gerenteEmail: form.gerenteEmail || null,
      planejadorNome: form.planejadorNome || null,
      planejadorEmail: form.planejadorEmail || null,
    };
    try {
      setSalvando(true);
      const res = contrato
        ? await apiClient.updateContrato(contrato.id, dados)
        : await apiClient.createContrato(dados);
      toast.success(contrato ? 'Contrato atualizado.' : 'Contrato criado.');
      onSalvo(res.data.id);
    } catch (e) {
      // `numero` repetido: a mensagem do servidor já traz o contrato existente.
      setErro(mensagemDoErro(e, 'Não foi possível salvar o contrato.'));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open={aberto} onOpenChange={(a) => !a && onFechar()}>
      <DialogContent className="sm:max-w-[640px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{contrato ? `Editar ${contrato.numero}` : 'Novo contrato'}</DialogTitle>
          <DialogDescription>
            Vigência, valor e SLA alimentam os alertas do card. O que ficar em branco aparece como
            lacuna.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {erro && (
            <p role="alert" className="text-sm text-destructive">
              {erro}
            </p>
          )}

          <div>
            <Label htmlFor="contrato-busca-empresa">Empresa *</Label>
            <Input
              id="contrato-busca-empresa"
              placeholder="Buscar empresa"
              value={buscaEmpresa}
              onChange={(e) => setBuscaEmpresa(e.target.value)}
              className="mt-1 mb-2"
            />
            <Select
              value={form.companyId || undefined}
              onValueChange={(v) => setForm((f) => ({ ...f, companyId: v }))}
            >
              <SelectTrigger aria-label="Empresa do contrato">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {opcoesEmpresa.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="contrato-numero">Número *</Label>
              <Input {...campo('numero')} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="contrato-numeroCliente">Número no cliente</Label>
              <Input {...campo('numeroCliente')} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="contrato-tipo">Tipo</Label>
              <Select
                value={form.tipo}
                onValueChange={(v) => setForm((f) => ({ ...f, tipo: v as ContratoTipo }))}
              >
                <SelectTrigger id="contrato-tipo" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LTA">{ROTULO_TIPO_CONTRATO.LTA}</SelectItem>
                  <SelectItem value="GUARDA_CHUVA">{ROTULO_TIPO_CONTRATO.GUARDA_CHUVA}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="contrato-objeto">Objeto</Label>
            <Textarea {...campo('objeto')} rows={2} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="contrato-escopo">Escopo</Label>
            <Textarea {...campo('escopo')} rows={3} className="mt-1" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="contrato-vigenciaInicio">Início da vigência</Label>
              <Input {...campo('vigenciaInicio')} type="date" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="contrato-vigenciaFim">Fim da vigência</Label>
              <Input {...campo('vigenciaFim')} type="date" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="contrato-valorContratado">Valor contratado (R$)</Label>
              <Input
                {...campo('valorContratado')}
                type="number"
                min={0}
                step="0.01"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="contrato-slaRespostaHoras">SLA de resposta (horas úteis)</Label>
              <Input
                {...campo('slaRespostaHoras')}
                type="number"
                min={1}
                step={1}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="contrato-gerenteNome">Gerente</Label>
              <Input {...campo('gerenteNome')} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="contrato-gerenteEmail">E-mail do gerente</Label>
              <Input {...campo('gerenteEmail')} type="email" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="contrato-planejadorNome">Planejador</Label>
              <Input {...campo('planejadorNome')} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="contrato-planejadorEmail">E-mail do planejador</Label>
              <Input {...campo('planejadorEmail')} type="email" className="mt-1" />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Detalhe: solicitantes, itens e movimentos ────────────────────────────────────

function DetalheContrato({
  contratoId,
  podeEditar,
  onFechar,
  onEditar,
  onMudou,
}: {
  contratoId: string | null;
  podeEditar: boolean;
  onFechar: () => void;
  onEditar: (contrato: ContratoDetalhe) => void;
  onMudou: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: contrato, isLoading } = useQuery({
    queryKey: ['contrato', contratoId],
    queryFn: async () => (await apiClient.getContrato(contratoId as string)).data,
    enabled: !!contratoId,
  });

  const recarregar = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['contrato', contratoId] });
    onMudou();
  }, [queryClient, contratoId, onMudou]);

  const [novoSolicitante, setNovoSolicitante] = useState({ nome: '', email: '' });
  const [novoItem, setNovoItem] = useState({ descricao: '', disciplina: '' });
  const [novoMovimento, setNovoMovimento] = useState<{
    tipo: ContratoMovimentoTipo;
    valor: string;
    motivo: string;
  }>({ tipo: 'ADITIVO', valor: '', motivo: '' });
  const [ocupado, setOcupado] = useState(false);
  const [edicaoSolicitante, setEdicaoSolicitante] = useState<{
    id: string;
    nome: string;
    email: string;
  } | null>(null);
  const [edicaoItem, setEdicaoItem] = useState<{
    id: string;
    descricao: string;
    disciplina: string;
  } | null>(null);

  const executar = async (acao: () => Promise<unknown>, sucesso: string, padrao: string) => {
    try {
      setOcupado(true);
      await acao();
      toast.success(sucesso);
      await recarregar();
      return true;
    } catch (e) {
      toast.error(mensagemDoErro(e, padrao));
      return false;
    } finally {
      setOcupado(false);
    }
  };

  const id = contratoId as string;

  return (
    <Sheet open={!!contratoId} onOpenChange={(a) => !a && onFechar()}>
      <SheetContent className="w-full sm:max-w-[640px] overflow-y-auto p-6">
        <SheetHeader className="p-0 mb-4">
          <SheetTitle>{contrato?.numero ?? 'Contrato'}</SheetTitle>
          <SheetDescription>{contrato?.company.name ?? ''}</SheetDescription>
        </SheetHeader>

        {isLoading || !contrato ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="animate-spin" size={20} />
            <span className="ml-2 text-sm">Carregando…</span>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <span className="text-xs text-muted-foreground block">Saldo</span>
                <SaldoContrato contrato={contrato} />
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">Valor contratado</span>
                <span className="text-sm text-foreground">
                  {contrato.valorContratado !== null
                    ? formatCurrency(contrato.valorContratado)
                    : '—'}
                </span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">Vigência</span>
                <span className="text-sm text-foreground">
                  {dataCivil(contrato.vigenciaInicio)} – {dataCivil(contrato.vigenciaFim)}
                </span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">SLA de resposta</span>
                <span className="text-sm text-foreground">
                  {contrato.slaRespostaHoras !== null
                    ? `${contrato.slaRespostaHoras} horas úteis`
                    : '—'}
                </span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">Gerente</span>
                <span className="text-sm text-foreground">
                  {contrato.gerenteNome || contrato.gerenteEmail || '—'}
                </span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">Planejador</span>
                <span className="text-sm text-foreground">
                  {contrato.planejadorNome || contrato.planejadorEmail || '—'}
                </span>
              </div>
            </div>

            <div className="mb-4">
              <BadgesDeLacuna lacunas={contrato.lacunas} />
            </div>

            {podeEditar && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2 mb-4"
                onClick={() => onEditar(contrato)}
              >
                <Pencil size={14} />
                Editar dados
              </Button>
            )}

            <Tabs defaultValue="solicitantes">
              <TabsList>
                <TabsTrigger value="solicitantes">
                  Solicitantes ({contrato.solicitantes.length})
                </TabsTrigger>
                <TabsTrigger value="itens">Itens ({contrato.itens.length})</TabsTrigger>
                <TabsTrigger value="movimentos">
                  Movimentos ({contrato.movimentos.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="solicitantes" className="space-y-3">
                {contrato.solicitantes.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nenhum solicitante autorizado.</p>
                )}
                <ul className="divide-y divide-border">
                  {contrato.solicitantes.map((s) => (
                    <li key={s.id} className="py-2 flex items-center justify-between gap-2">
                      {edicaoSolicitante?.id === s.id ? (
                        <div className="flex flex-1 flex-wrap items-center gap-2">
                          <Input
                            aria-label="Nome do solicitante"
                            value={edicaoSolicitante.nome}
                            onChange={(e) =>
                              setEdicaoSolicitante({ ...edicaoSolicitante, nome: e.target.value })
                            }
                            className="flex-1 min-w-32"
                          />
                          <Input
                            aria-label="E-mail do solicitante"
                            type="email"
                            value={edicaoSolicitante.email}
                            onChange={(e) =>
                              setEdicaoSolicitante({ ...edicaoSolicitante, email: e.target.value })
                            }
                            className="flex-1 min-w-40"
                          />
                          <Button
                            size="sm"
                            disabled={ocupado || !edicaoSolicitante.email.trim()}
                            onClick={async () => {
                              const ok = await executar(
                                () =>
                                  apiClient.updateContratoSolicitante(id, s.id, {
                                    nome: edicaoSolicitante.nome || null,
                                    email: edicaoSolicitante.email,
                                  }),
                                'Solicitante atualizado.',
                                'Não foi possível atualizar o solicitante.'
                              );
                              if (ok) setEdicaoSolicitante(null);
                            }}
                          >
                            Salvar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEdicaoSolicitante(null)}
                          >
                            Cancelar
                          </Button>
                        </div>
                      ) : (
                        <>
                          <div className="min-w-0">
                            <p className="text-sm text-foreground truncate">{s.nome || s.email}</p>
                            {s.nome && (
                              <p className="text-xs text-muted-foreground truncate">{s.email}</p>
                            )}
                          </div>
                          {podeEditar && (
                            <div className="flex items-center gap-1 shrink-0">
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={`Editar ${s.email}`}
                                onClick={() =>
                                  setEdicaoSolicitante({
                                    id: s.id,
                                    nome: s.nome ?? '',
                                    email: s.email,
                                  })
                                }
                              >
                                <Pencil size={14} />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={`Remover ${s.email}`}
                                disabled={ocupado}
                                onClick={() =>
                                  executar(
                                    () => apiClient.removeContratoSolicitante(id, s.id),
                                    'Solicitante removido.',
                                    'Não foi possível remover o solicitante.'
                                  )
                                }
                              >
                                <Trash2 size={14} />
                              </Button>
                            </div>
                          )}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
                {podeEditar && (
                  <div className="flex flex-wrap items-end gap-2 pt-2">
                    <div className="flex-1 min-w-32">
                      <Label htmlFor="novo-solicitante-nome">Nome</Label>
                      <Input
                        id="novo-solicitante-nome"
                        value={novoSolicitante.nome}
                        onChange={(e) =>
                          setNovoSolicitante((n) => ({ ...n, nome: e.target.value }))
                        }
                        className="mt-1"
                      />
                    </div>
                    <div className="flex-1 min-w-40">
                      <Label htmlFor="novo-solicitante-email">E-mail *</Label>
                      <Input
                        id="novo-solicitante-email"
                        type="email"
                        value={novoSolicitante.email}
                        onChange={(e) =>
                          setNovoSolicitante((n) => ({ ...n, email: e.target.value }))
                        }
                        className="mt-1"
                      />
                    </div>
                    <Button
                      size="sm"
                      className="gap-1"
                      disabled={ocupado || !novoSolicitante.email.trim()}
                      onClick={async () => {
                        const ok = await executar(
                          () =>
                            apiClient.addContratoSolicitante(id, {
                              nome: novoSolicitante.nome || null,
                              email: novoSolicitante.email,
                            }),
                          'Solicitante adicionado.',
                          'Não foi possível adicionar o solicitante.'
                        );
                        if (ok) setNovoSolicitante({ nome: '', email: '' });
                      }}
                    >
                      <Plus size={14} />
                      Adicionar
                    </Button>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="itens" className="space-y-3">
                {contrato.itens.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nenhum item cadastrado.</p>
                )}
                <ul className="divide-y divide-border">
                  {contrato.itens.map((item) => (
                    <li key={item.id} className="py-2 flex items-center justify-between gap-2">
                      {edicaoItem?.id === item.id ? (
                        <div className="flex flex-1 flex-wrap items-center gap-2">
                          <Input
                            aria-label="Descrição do item"
                            value={edicaoItem.descricao}
                            onChange={(e) =>
                              setEdicaoItem({ ...edicaoItem, descricao: e.target.value })
                            }
                            className="flex-1 min-w-40"
                          />
                          <Input
                            aria-label="Disciplina do item"
                            value={edicaoItem.disciplina}
                            onChange={(e) =>
                              setEdicaoItem({ ...edicaoItem, disciplina: e.target.value })
                            }
                            className="flex-1 min-w-32"
                          />
                          <Button
                            size="sm"
                            disabled={ocupado || !edicaoItem.descricao.trim()}
                            onClick={async () => {
                              const ok = await executar(
                                () =>
                                  apiClient.updateContratoItem(id, item.id, {
                                    descricao: edicaoItem.descricao,
                                    disciplina: edicaoItem.disciplina || null,
                                  }),
                                'Item atualizado.',
                                'Não foi possível atualizar o item.'
                              );
                              if (ok) setEdicaoItem(null);
                            }}
                          >
                            Salvar
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEdicaoItem(null)}>
                            Cancelar
                          </Button>
                        </div>
                      ) : (
                        <>
                          <div className="min-w-0">
                            <p className="text-sm text-foreground">{item.descricao}</p>
                            {item.disciplina && (
                              <p className="text-xs text-muted-foreground">{item.disciplina}</p>
                            )}
                          </div>
                          {podeEditar && (
                            <div className="flex items-center gap-1 shrink-0">
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={`Editar ${item.descricao}`}
                                onClick={() =>
                                  setEdicaoItem({
                                    id: item.id,
                                    descricao: item.descricao,
                                    disciplina: item.disciplina ?? '',
                                  })
                                }
                              >
                                <Pencil size={14} />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={`Remover ${item.descricao}`}
                                disabled={ocupado}
                                onClick={() =>
                                  executar(
                                    () => apiClient.removeContratoItem(id, item.id),
                                    'Item removido.',
                                    'Não foi possível remover o item.'
                                  )
                                }
                              >
                                <Trash2 size={14} />
                              </Button>
                            </div>
                          )}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
                {podeEditar && (
                  <div className="flex flex-wrap items-end gap-2 pt-2">
                    <div className="flex-1 min-w-40">
                      <Label htmlFor="novo-item-descricao">Descrição *</Label>
                      <Input
                        id="novo-item-descricao"
                        value={novoItem.descricao}
                        onChange={(e) => setNovoItem((n) => ({ ...n, descricao: e.target.value }))}
                        className="mt-1"
                      />
                    </div>
                    <div className="flex-1 min-w-32">
                      <Label htmlFor="novo-item-disciplina">Disciplina</Label>
                      <Input
                        id="novo-item-disciplina"
                        value={novoItem.disciplina}
                        onChange={(e) => setNovoItem((n) => ({ ...n, disciplina: e.target.value }))}
                        className="mt-1"
                      />
                    </div>
                    <Button
                      size="sm"
                      className="gap-1"
                      disabled={ocupado || !novoItem.descricao.trim()}
                      onClick={async () => {
                        const ok = await executar(
                          () =>
                            apiClient.addContratoItem(id, {
                              descricao: novoItem.descricao,
                              disciplina: novoItem.disciplina || null,
                            }),
                          'Item adicionado.',
                          'Não foi possível adicionar o item.'
                        );
                        if (ok) setNovoItem({ descricao: '', disciplina: '' });
                      }}
                    >
                      <Plus size={14} />
                      Adicionar
                    </Button>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="movimentos" className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Movimento não se edita: a correção é um novo ajuste, com motivo. O consumo nasce
                  quando o Flow informa que a demanda foi ganha.
                </p>
                {contrato.movimentos.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum movimento.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tipo</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                        <TableHead>Motivo</TableHead>
                        <TableHead>Quando</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {contrato.movimentos.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell>
                            <Badge variant="secondary">{ROTULO_MOVIMENTO[m.tipo]}</Badge>
                          </TableCell>
                          <TableCell className="text-right text-foreground">
                            {formatCurrency(m.valor)}
                          </TableCell>
                          <TableCell className="text-foreground">
                            {m.motivo || '—'}
                            {m.deal && (
                              <Link
                                to={`/app/deals/${m.deal.id}`}
                                className="block text-xs text-primary hover:underline"
                              >
                                {m.deal.name}
                              </Link>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground whitespace-nowrap">
                            {new Date(m.createdAt).toLocaleDateString('pt-BR')}
                            {m.autor ? ` · ${m.autor.name}` : ''}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                {podeEditar && (
                  <div className="flex flex-wrap items-end gap-2 pt-2">
                    <div className="w-32">
                      <Label htmlFor="novo-movimento-tipo">Tipo</Label>
                      <Select
                        value={novoMovimento.tipo}
                        onValueChange={(v) =>
                          setNovoMovimento((n) => ({ ...n, tipo: v as ContratoMovimentoTipo }))
                        }
                      >
                        <SelectTrigger id="novo-movimento-tipo" className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ADITIVO">{ROTULO_MOVIMENTO.ADITIVO}</SelectItem>
                          <SelectItem value="AJUSTE">{ROTULO_MOVIMENTO.AJUSTE}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-36">
                      <Label htmlFor="novo-movimento-valor">Valor (R$)</Label>
                      <Input
                        id="novo-movimento-valor"
                        type="number"
                        step="0.01"
                        value={novoMovimento.valor}
                        onChange={(e) => setNovoMovimento((n) => ({ ...n, valor: e.target.value }))}
                        className="mt-1"
                      />
                    </div>
                    <div className="flex-1 min-w-40">
                      <Label htmlFor="novo-movimento-motivo">
                        Motivo{novoMovimento.tipo === 'AJUSTE' ? ' *' : ''}
                      </Label>
                      <Input
                        id="novo-movimento-motivo"
                        value={novoMovimento.motivo}
                        onChange={(e) =>
                          setNovoMovimento((n) => ({ ...n, motivo: e.target.value }))
                        }
                        className="mt-1"
                      />
                    </div>
                    <Button
                      size="sm"
                      className="gap-1"
                      disabled={
                        ocupado ||
                        novoMovimento.valor === '' ||
                        (novoMovimento.tipo === 'AJUSTE' && !novoMovimento.motivo.trim())
                      }
                      onClick={async () => {
                        const ok = await executar(
                          () =>
                            apiClient.addContratoMovimento(id, {
                              tipo: novoMovimento.tipo,
                              valor: Number(novoMovimento.valor),
                              motivo: novoMovimento.motivo || null,
                            }),
                          'Movimento registrado.',
                          'Não foi possível registrar o movimento.'
                        );
                        if (ok) setNovoMovimento({ tipo: 'ADITIVO', valor: '', motivo: '' });
                      }}
                    >
                      <Plus size={14} />
                      Registrar
                    </Button>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Página ───────────────────────────────────────────────────────────────────────

export function Contratos() {
  const { user } = useAuth();
  const podeEditar = isManagerRole(user);
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();

  const empresaFiltro = params.get('empresa') ?? '';
  const contratoAberto = params.get('contrato');

  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [lacuna, setLacuna] = useState<string>(TODAS);
  const [pagina, setPagina] = useState(1);
  const [formAberto, setFormAberto] = useState(false);
  const [editando, setEditando] = useState<ContratoResumo | null>(null);
  const [paraExcluir, setParaExcluir] = useState<ContratoResumo | null>(null);
  const [excluindo, setExcluindo] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setBuscaAplicada(busca.trim());
      setPagina(1);
    }, 300);
    return () => clearTimeout(t);
  }, [busca]);

  const { data, isLoading } = useQuery({
    queryKey: ['contratos', buscaAplicada, lacuna, empresaFiltro, pagina],
    queryFn: async () =>
      (
        await apiClient.getContratos({
          busca: buscaAplicada || undefined,
          lacuna: lacuna === TODAS ? undefined : (lacuna as LacunaContrato),
          companyId: empresaFiltro || undefined,
          page: pagina,
          limit: 25,
        })
      ).data,
  });

  const recarregarLista = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['contratos'] });
    void queryClient.invalidateQueries({ queryKey: ['contratos-da-empresa'] });
  }, [queryClient]);

  const abrirDetalhe = (id: string | null) => {
    setParams(
      (atual) => {
        const proximo = new URLSearchParams(atual);
        if (id) proximo.set('contrato', id);
        else proximo.delete('contrato');
        return proximo;
      },
      { replace: true }
    );
  };

  const excluir = async () => {
    if (!paraExcluir) return;
    try {
      setExcluindo(true);
      await apiClient.deleteContrato(paraExcluir.id);
      toast.success('Contrato excluído.');
      setParaExcluir(null);
      recarregarLista();
    } catch (e) {
      toast.error(mensagemDoErro(e, 'Não foi possível excluir o contrato.'));
    } finally {
      setExcluindo(false);
    }
  };

  const itens = data?.itens ?? [];
  const paginacao = data?.paginacao;

  return (
    <div className="min-h-screen">
      <Header
        title="Contratos"
        subtitle="Contratos LTA e guarda-chuva, com saldo, itens e solicitantes autorizados."
      />

      <div className="px-4 md:px-8 py-6 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Buscar contrato"
            placeholder="Buscar por número, objeto ou cliente"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full sm:w-80"
          />
          <Select
            value={lacuna}
            onValueChange={(v) => {
              setLacuna(v);
              setPagina(1);
            }}
          >
            <SelectTrigger aria-label="Filtrar por lacuna" className="w-full sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODAS}>Todas as situações</SelectItem>
              {(Object.keys(ROTULO_LACUNA) as LacunaContrato[]).map((l) => (
                <SelectItem key={l} value={l}>
                  {ROTULO_LACUNA[l]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {empresaFiltro && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setParams(
                  (atual) => {
                    const proximo = new URLSearchParams(atual);
                    proximo.delete('empresa');
                    return proximo;
                  },
                  { replace: true }
                )
              }
            >
              Limpar filtro de empresa
            </Button>
          )}
          {podeEditar && (
            <Button
              className="gap-2 sm:ml-auto"
              onClick={() => {
                setEditando(null);
                setFormAberto(true);
              }}
            >
              <Plus size={16} />
              Novo contrato
            </Button>
          )}
        </div>

        <div className="rounded-md border border-border bg-card">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="animate-spin" size={20} />
              <span className="ml-2 text-sm">Carregando…</span>
            </div>
          ) : itens.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <FileText className="text-muted-foreground mb-3" size={32} aria-hidden="true" />
              <p className="text-foreground font-medium">Nenhum contrato encontrado</p>
              <p className="text-muted-foreground text-sm mt-1">
                {buscaAplicada || lacuna !== TODAS || empresaFiltro
                  ? 'Ajuste a busca ou os filtros.'
                  : 'Os contratos cadastrados aparecerão aqui.'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Número</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Vigência</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead>Lacunas</TableHead>
                  {podeEditar && <TableHead className="text-right">Ações</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {itens.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <button
                        type="button"
                        className="font-medium text-foreground hover:underline text-left"
                        onClick={() => abrirDetalhe(c.id)}
                      >
                        {c.numero}
                      </button>
                      <span className="block text-xs text-muted-foreground">
                        {ROTULO_TIPO_CONTRATO[c.tipo]}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Link
                        to={`/app/companies/${c.company.id}`}
                        className="text-foreground hover:underline"
                      >
                        {c.company.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {dataCivil(c.vigenciaInicio)} – {dataCivil(c.vigenciaFim)}
                    </TableCell>
                    <TableCell className="text-right">
                      <SaldoContrato contrato={c} />
                    </TableCell>
                    <TableCell>
                      <BadgesDeLacuna lacunas={c.lacunas} />
                    </TableCell>
                    {podeEditar && (
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Editar ${c.numero}`}
                            onClick={() => {
                              setEditando(c);
                              setFormAberto(true);
                            }}
                          >
                            <Pencil size={14} />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Excluir ${c.numero}`}
                            onClick={() => setParaExcluir(c)}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {paginacao && paginacao.totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Página {paginacao.page} de {paginacao.totalPages} · {paginacao.total} contratos
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={pagina <= 1}
                onClick={() => setPagina((p) => p - 1)}
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pagina >= paginacao.totalPages}
                onClick={() => setPagina((p) => p + 1)}
              >
                Próxima
              </Button>
            </div>
          </div>
        )}
      </div>

      <ContratoFormDialog
        aberto={formAberto}
        contrato={editando}
        empresaInicial={empresaFiltro}
        onFechar={() => setFormAberto(false)}
        onSalvo={(id) => {
          setFormAberto(false);
          recarregarLista();
          void queryClient.invalidateQueries({ queryKey: ['contrato', id] });
        }}
      />

      <DetalheContrato
        contratoId={contratoAberto}
        podeEditar={podeEditar}
        onFechar={() => abrirDetalhe(null)}
        onEditar={(c) => {
          setEditando(c);
          setFormAberto(true);
        }}
        onMudou={recarregarLista}
      />

      <Dialog open={!!paraExcluir} onOpenChange={(a) => !a && setParaExcluir(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Excluir o contrato {paraExcluir?.numero}?</DialogTitle>
            <DialogDescription>
              Os chamados abertos mantêm o vínculo, e o registro no Flow fica inativo.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setParaExcluir(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={excluir} disabled={excluindo}>
              {excluindo && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
