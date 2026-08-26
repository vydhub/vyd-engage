// Aba "Conflitos" do módulo de Gestão de Parceiros Comerciais (reqs 16-19).
// Resolução de conflitos entre frentes (consultor × consultor / consultor × interno)
// + matriz de sobreposição de contas. Dados via useConflitos/useSobreposicao;
// mutações via useParceirosActions().

import { useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  CheckCircle2,
  EyeOff,
  Handshake,
  Scale,
  User,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useConflitos, useSobreposicao, useParceirosActions } from '@/hooks/useParceiros';
import type {
  ConflitoCandidato,
  ConflitoDecisao,
  ConflitoTipo,
  MatchForca,
  RegistroStatus,
} from '@/types/parceiros';

// ── Rótulos canônicos (pt-BR) ───────────────────────────────────────────────
type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

const TIPO_LABEL: Record<ConflitoTipo, string> = {
  EXTERNO_EXTERNO: 'Consultor × Consultor',
  EXTERNO_INTERNO: 'Consultor × Interno',
};
const TIPO_VARIANT: Record<ConflitoTipo, BadgeVariant> = {
  EXTERNO_EXTERNO: 'secondary',
  EXTERNO_INTERNO: 'destructive',
};

const MATCH_FORCA_LABEL: Record<MatchForca, string> = {
  FORTE: 'CNPJ',
  FRACO: 'Nome/contato',
};

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

const DECISAO_LABEL: Record<ConflitoDecisao, string> = {
  MANTER: 'Manter o registro — segue para aprovação',
  REJEITAR: 'Rejeitar em favor da outra frente',
  INDEPENDENTE: 'Demandas diferentes — não é conflito',
};
const DECISAO_OPCOES: ConflitoDecisao[] = ['MANTER', 'REJEITAR', 'INDEPENDENTE'];

function fmtData(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
function fmtMoeda(valor: string | number | null | undefined): string | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = typeof valor === 'number' ? valor : Number(valor);
  return Number.isNaN(n) ? null : BRL.format(n);
}

export function ConflitosTab() {
  const actions = useParceirosActions();

  const [statusTab, setStatusTab] = useState<'ABERTO' | 'RESOLVIDO'>('ABERTO');
  const { data: conflitos, isLoading, isError } = useConflitos(statusTab);
  const {
    data: sobreposicao,
    isLoading: sobreposicaoLoading,
    isError: sobreposicaoError,
  } = useSobreposicao();

  // Dialog de resolução.
  const [resolverAlvo, setResolverAlvo] = useState<ConflitoCandidato | null>(null);
  const [decisao, setDecisao] = useState<ConflitoDecisao>('MANTER');
  const [rationale, setRationale] = useState('');
  const [salvando, setSalvando] = useState(false);

  const abrirResolver = (c: ConflitoCandidato) => {
    setDecisao('MANTER');
    setRationale('');
    setResolverAlvo(c);
  };

  const handleResolver = async () => {
    if (!resolverAlvo || !rationale.trim()) return;
    setSalvando(true);
    try {
      await actions.resolverConflito(resolverAlvo.id, {
        decisao,
        rationale: rationale.trim(),
      });
      setResolverAlvo(null);
      setRationale('');
    } catch {
      // erro já sinalizado via toast no hook
    } finally {
      setSalvando(false);
    }
  };

  const lista = conflitos ?? [];
  const contas = sobreposicao ?? [];

  return (
    <div className="space-y-6">
      {/* ── Aviso de confidencialidade ── */}
      <Alert>
        <EyeOff size={16} />
        <AlertTitle>Visão restrita à gestão</AlertTitle>
        <AlertDescription>
          A identidade das frentes envolvidas é visível somente nesta tela. O consultor
          nunca vê quem é a frente concorrente — ele recebe apenas a decisão sobre o
          próprio registro.
        </AlertDescription>
      </Alert>

      {/* ── Toggle ABERTO / RESOLVIDO ── */}
      <Tabs value={statusTab} onValueChange={(v) => setStatusTab(v as 'ABERTO' | 'RESOLVIDO')}>
        <TabsList>
          <TabsTrigger value="ABERTO">Abertos</TabsTrigger>
          <TabsTrigger value="RESOLVIDO">Resolvidos</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* ── Lista de conflitos ── */}
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center rounded-md border border-border bg-card px-4 py-12 text-center">
          <AlertTriangle className="mb-3 text-destructive" size={32} />
          <p className="font-medium text-foreground">Erro ao carregar os conflitos</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Não foi possível buscar os conflitos. Tente novamente.
          </p>
        </div>
      ) : lista.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-md border border-border bg-card px-4 py-12 text-center">
          <CheckCircle2 className="mb-3 text-muted-foreground" size={32} />
          <p className="font-medium text-foreground">
            {statusTab === 'ABERTO'
              ? 'Nenhum conflito aberto'
              : 'Nenhum conflito resolvido'}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {statusTab === 'ABERTO'
              ? 'Nenhuma sobreposição de frentes aguarda decisão no momento.'
              : 'Ainda não há conflitos com decisão registrada.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {lista.map((c) => (
            <Card key={c.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={TIPO_VARIANT[c.tipo]}>{TIPO_LABEL[c.tipo]}</Badge>
                  <Badge variant="outline">
                    Match {MATCH_FORCA_LABEL[c.matchForca]}: {c.matchChave}
                  </Badge>
                  <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                    <CalendarDays size={12} />
                    Detectado em {fmtData(c.createdAt)}
                  </span>
                </div>
                <CardTitle className="text-base text-foreground">
                  {c.registro?.clienteNome ?? 'Registro não disponível'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {/* Lado (a): o registro do consultor */}
                  <div className="space-y-2 rounded-md border border-border bg-muted/50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Registro do consultor
                    </p>
                    {c.registro ? (
                      <>
                        <p className="font-medium text-foreground">{c.registro.clienteNome}</p>
                        <p className="flex items-center gap-1.5 text-sm text-foreground">
                          <User size={14} className="text-muted-foreground" />
                          {c.registro.consultor.nome}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Registrado em {fmtData(c.registro.createdAt)} (primeiro a registrar
                          tem precedência)
                        </p>
                        <p className="text-sm text-foreground">{c.registro.descricao}</p>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Dados do registro indisponíveis.
                      </p>
                    )}
                  </div>

                  {/* Lado (b): a frente concorrente */}
                  <div className="space-y-2 rounded-md border border-border bg-muted/50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Frente concorrente
                    </p>
                    {c.alvoRegistro ? (
                      <>
                        <p className="font-medium text-foreground">
                          {c.alvoRegistro.clienteNome}
                        </p>
                        <p className="flex items-center gap-1.5 text-sm text-foreground">
                          <User size={14} className="text-muted-foreground" />
                          {c.alvoRegistro.consultor.nome}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Registrado em {fmtData(c.alvoRegistro.createdAt)}
                        </p>
                        <Badge variant={REGISTRO_STATUS_VARIANT[c.alvoRegistro.status]}>
                          {REGISTRO_STATUS_LABEL[c.alvoRegistro.status]}
                        </Badge>
                        {c.alvoRegistro.descricao && c.alvoRegistro.descricao.trim() ? (
                          <p className="text-sm text-foreground">{c.alvoRegistro.descricao}</p>
                        ) : null}
                        {fmtMoeda(c.alvoRegistro.valorEstimado) ? (
                          <p className="text-sm text-muted-foreground">
                            Valor estimado: {fmtMoeda(c.alvoRegistro.valorEstimado)}
                          </p>
                        ) : null}
                      </>
                    ) : c.alvoDeal ? (
                      <>
                        <p className="flex items-center gap-1.5 font-medium text-foreground">
                          <Handshake size={14} className="text-muted-foreground" />
                          {c.alvoDeal.name}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Negócio do pipeline interno — etapa: {c.alvoDeal.stage}
                        </p>
                        {c.alvoDeal.notes && c.alvoDeal.notes.trim() ? (
                          <p className="text-sm text-foreground">{c.alvoDeal.notes}</p>
                        ) : null}
                        {fmtMoeda(c.alvoDeal.value) ? (
                          <p className="text-sm text-muted-foreground">
                            Valor: {fmtMoeda(c.alvoDeal.value)}
                          </p>
                        ) : null}
                      </>
                    ) : c.alvoCompany ? (
                      <>
                        <p className="flex items-center gap-1.5 font-medium text-foreground">
                          <Building2 size={14} className="text-muted-foreground" />
                          {c.alvoCompany.name}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Empresa da base interna — CNPJ: {c.alvoCompany.cnpj ?? 'não informado'}
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Frente concorrente indisponível.
                      </p>
                    )}
                  </div>
                </div>

                {c.status === 'ABERTO' ? (
                  <div className="flex justify-end">
                    <Button className="gap-1.5" onClick={() => abrirResolver(c)}>
                      <Scale size={16} />
                      Resolver conflito
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-1 rounded-md border border-border bg-card p-3">
                    <p className="text-sm font-semibold text-foreground">
                      Decisão:{' '}
                      {c.decisao ? DECISAO_LABEL[c.decisao] : 'não registrada'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {c.rationale && c.rationale.trim()
                        ? c.rationale
                        : 'Sem justificativa registrada.'}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Matriz de sobreposição ── */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Matriz de sobreposição</h3>
          <p className="text-sm text-muted-foreground">
            Contas tocadas por mais de uma frente (consultores e pipeline interno).
          </p>
        </div>
        <div className="rounded-md border border-border bg-card">
          {sobreposicaoLoading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : sobreposicaoError ? (
            <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
              <AlertTriangle className="mb-3 text-destructive" size={28} />
              <p className="font-medium text-foreground">
                Erro ao carregar a matriz de sobreposição
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Não foi possível buscar as contas sobrepostas. Tente novamente.
              </p>
            </div>
          ) : contas.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="font-medium text-foreground">
                Nenhuma conta tocada por mais de uma frente.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>CNPJ</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Frentes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contas.map((row) => (
                    <TableRow key={row.cnpj}>
                      <TableCell className="font-medium text-foreground">{row.cnpj}</TableCell>
                      <TableCell className="text-foreground">{row.clienteNome}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          {row.frentes.map((f, i) => (
                            <Badge
                              key={`${f.tipo}-${f.nome}-${i}`}
                              variant={f.tipo === 'INTERNO' ? 'destructive' : 'secondary'}
                            >
                              {f.tipo === 'INTERNO' ? 'Pipeline interno' : f.nome}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>

      {/* ── Dialog: resolver conflito ── */}
      <Dialog
        open={!!resolverAlvo}
        onOpenChange={(open) => {
          if (!open) {
            setResolverAlvo(null);
            setRationale('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolver conflito</DialogTitle>
            <DialogDescription>
              {resolverAlvo?.registro
                ? `Decida o destino do registro de "${resolverAlvo.registro.clienteNome}" (${resolverAlvo.registro.consultor.nome}).`
                : 'Decida o destino deste conflito.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Decisão</Label>
              <Select value={decisao} onValueChange={(v) => setDecisao(v as ConflitoDecisao)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DECISAO_OPCOES.map((d) => (
                    <SelectItem key={d} value={d}>
                      {DECISAO_LABEL[d]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="conflito-rationale">Justificativa *</Label>
              <Textarea
                id="conflito-rationale"
                rows={4}
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                placeholder="Explique a decisão…"
              />
              <p className="text-xs text-muted-foreground">
                Obrigatória — fica na trilha de auditoria.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              disabled={salvando}
              onClick={() => {
                setResolverAlvo(null);
                setRationale('');
              }}
            >
              Cancelar
            </Button>
            <Button onClick={handleResolver} disabled={!rationale.trim() || salvando}>
              {salvando ? 'Registrando…' : 'Registrar decisão'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
