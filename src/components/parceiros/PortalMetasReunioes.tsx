// Portal do Parceiro — Metas e Reuniões do consultor (reqs 27, 33).
// Progresso do mês corrente (meta vs. realizado), histórico de metas e agenda de reuniões.
// Dados exclusivamente via usePortalMetas() / usePortalReunioes().

import { Target, CalendarClock, FileWarning } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { usePortalMetas, usePortalReunioes } from '@/hooks/usePortalParceiro';
import type { ConsultorMeta, MetaProgress, ReuniaoStatus, PresencaStatus } from '@/types/parceiros';

// ── Formatação (pt-BR) ──────────────────────────────────────────────────────
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function formatMesAno(month: number, year: number): string {
  return `${String(month).padStart(2, '0')}/${year}`;
}

function formatDataHora(iso: string): string {
  const d = new Date(iso);
  const data = d.toLocaleDateString('pt-BR');
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${data} ${hora}`;
}

// ── Rótulos canônicos ───────────────────────────────────────────────────────
const REUNIAO_STATUS_LABEL: Record<ReuniaoStatus, string> = {
  AGENDADA: 'Agendada',
  REALIZADA: 'Realizada',
  CANCELADA: 'Cancelada',
};

const REUNIAO_STATUS_VARIANT: Record<
  ReuniaoStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  AGENDADA: 'secondary',
  REALIZADA: 'default',
  CANCELADA: 'outline',
};

const PRESENCA_LABEL: Record<PresencaStatus, string> = {
  PRESENTE: 'Presente',
  FALTOU: 'Faltou',
};

const PRESENCA_VARIANT: Record<PresencaStatus, 'default' | 'destructive'> = {
  PRESENTE: 'default',
  FALTOU: 'destructive',
};

// ── Sub-blocos ──────────────────────────────────────────────────────────────
/** Linha meta vs. realizado com barra de progresso tokenizada (bg-muted + bg-primary). */
function LinhaProgresso({
  label,
  alvo,
  realizado,
  pct,
  moeda,
}: {
  label: string;
  alvo: number;
  realizado: number;
  pct: number | null;
  moeda: boolean;
}) {
  const format = (v: number) => (moeda ? brl.format(v) : String(v));
  const largura = pct != null ? Math.min(Math.max(pct, 0), 100) : 0;

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-sm text-muted-foreground">
          {format(realizado)} <span className="text-muted-foreground">/</span> {format(alvo)}{' '}
          <span className="font-medium text-foreground">
            {pct != null ? `${Math.round(pct)}%` : '—'}
          </span>
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${largura}%` }} />
      </div>
    </div>
  );
}

/** true quando todos os alvos do progresso são 0 (nenhuma meta efetiva). */
function alvosTodosZerados(progresso: MetaProgress): boolean {
  return (
    Number(progresso.meta.alvoRegistros) === 0 &&
    Number(progresso.meta.alvoPipeline) === 0 &&
    Number(progresso.meta.alvoGanho) === 0
  );
}

function EstadoErro({ mensagem }: { mensagem: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
      <FileWarning className="mb-2 text-destructive" size={28} />
      <p className="text-sm font-medium text-foreground">{mensagem}</p>
      <p className="mt-1 text-sm text-muted-foreground">Tente novamente mais tarde.</p>
    </div>
  );
}

function EstadoCarregando() {
  return (
    <div className="space-y-2 p-1">
      <Skeleton className="h-6 w-full" />
      <Skeleton className="h-6 w-full" />
      <Skeleton className="h-6 w-full" />
    </div>
  );
}

// ── Componente principal ────────────────────────────────────────────────────
export function PortalMetasReunioes() {
  const {
    data: metasData,
    isLoading: metasLoading,
    isError: metasError,
  } = usePortalMetas();
  const {
    data: reunioes,
    isLoading: reunioesLoading,
    isError: reunioesError,
  } = usePortalReunioes();

  const progresso = metasData?.progressoAtual ?? null;
  const historico: ConsultorMeta[] = metasData?.metas ?? [];
  const listaReunioes = reunioes ?? [];

  const semMetaDoMes = !progresso || alvosTodosZerados(progresso);

  return (
    <div className="space-y-4">
      {/* ── Seção: Metas ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Target size={18} className="text-muted-foreground" />
            Minhas metas
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {metasLoading ? (
            <EstadoCarregando />
          ) : metasError ? (
            <EstadoErro mensagem="Erro ao carregar as metas" />
          ) : (
            <>
              {/* Progresso do mês corrente */}
              <div className="space-y-3">
                <p className="text-sm font-semibold text-foreground">Mês corrente</p>
                {semMetaDoMes ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhuma meta definida para este mês.
                  </p>
                ) : (
                  <div className="space-y-3">
                    <LinhaProgresso
                      label="Registros"
                      alvo={Number(progresso.meta.alvoRegistros)}
                      realizado={Number(progresso.realizado.registros)}
                      pct={progresso.pct.registros}
                      moeda={false}
                    />
                    <LinhaProgresso
                      label="Pipeline"
                      alvo={Number(progresso.meta.alvoPipeline)}
                      realizado={Number(progresso.realizado.pipeline)}
                      pct={progresso.pct.pipeline}
                      moeda
                    />
                    <LinhaProgresso
                      label="Ganho"
                      alvo={Number(progresso.meta.alvoGanho)}
                      realizado={Number(progresso.realizado.ganho)}
                      pct={progresso.pct.ganho}
                      moeda
                    />
                  </div>
                )}
              </div>

              {/* Histórico de metas */}
              <div className="space-y-2">
                <p className="text-sm font-semibold text-foreground">Histórico de metas</p>
                {historico.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma meta cadastrada.</p>
                ) : (
                  <div className="overflow-x-auto rounded-md border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Mês/Ano</TableHead>
                          <TableHead className="text-right">Registros</TableHead>
                          <TableHead className="text-right">Pipeline</TableHead>
                          <TableHead className="text-right">Ganho</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {historico.map((m) => (
                          <TableRow key={m.id}>
                            <TableCell className="font-medium text-foreground">
                              {formatMesAno(m.month, m.year)}
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
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Seção: Reuniões ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <CalendarClock size={18} className="text-muted-foreground" />
            Reuniões
          </CardTitle>
        </CardHeader>
        <CardContent>
          {reunioesLoading ? (
            <EstadoCarregando />
          ) : reunioesError ? (
            <EstadoErro mensagem="Erro ao carregar as reuniões" />
          ) : listaReunioes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma reunião agendada.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data e hora</TableHead>
                    <TableHead>Pauta</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Presença</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listaReunioes.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium text-foreground">
                        {formatDataHora(r.dataHora)}
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-foreground">
                        {r.pauta && r.pauta.trim() ? r.pauta : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={REUNIAO_STATUS_VARIANT[r.status]}>
                          {REUNIAO_STATUS_LABEL[r.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {r.presenca ? (
                          <Badge variant={PRESENCA_VARIANT[r.presenca]}>
                            {PRESENCA_LABEL[r.presenca]}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
