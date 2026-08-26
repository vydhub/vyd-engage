// Aba "Painel" do módulo de Gestão de Parceiros Comerciais — visão do gestor (req 38).
// Indicadores consolidados + tabela de consultores + relatório executivo em PDF.
// Todas as chamadas de API passam pelos hooks de useParceiros.ts.

import { useState } from 'react';
import {
  Users,
  MoonStar,
  Hourglass,
  AlertTriangle,
  CalendarClock,
  Wallet,
  TrendingUp,
  Percent,
  Timer,
  FileDown,
  FileWarning,
  Inbox,
  Loader2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useParceirosPainel, useParceirosActions } from '@/hooks/useParceiros';
import type { ConsultorPainel, ScoreFaixa } from '@/types/parceiros';

// ── Rótulos e formatadores (pt-BR) ──────────────────────────────────────────
// Janela do relatório executivo (req 39). O backend recorta por inicio/fim e
// imprime `periodo` no cabeçalho; aqui só traduzimos a escolha do gestor.
type PeriodoOpcao = 'MES_ATUAL' | 'MES_ANTERIOR' | 'TRIMESTRE' | 'ANO';

const PERIODO_LABEL: Record<PeriodoOpcao, string> = {
  MES_ATUAL: 'Mês atual',
  MES_ANTERIOR: 'Mês anterior',
  TRIMESTRE: 'Últimos 3 meses',
  ANO: 'Ano atual',
};

const diaIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const nomeMes = (d: Date) => d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

function janelaDoPeriodo(opcao: PeriodoOpcao): { inicio: string; fim: string; periodo: string } {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth();
  // Dia 0 do mês seguinte = último dia do mês corrente.
  const ultimoDia = (a: number, m: number) => new Date(a, m + 1, 0);

  switch (opcao) {
    case 'MES_ANTERIOR': {
      const ini = new Date(ano, mes - 1, 1);
      return { inicio: diaIso(ini), fim: diaIso(ultimoDia(ano, mes - 1)), periodo: nomeMes(ini) };
    }
    case 'TRIMESTRE': {
      const ini = new Date(ano, mes - 2, 1);
      const fim = ultimoDia(ano, mes);
      return {
        inicio: diaIso(ini),
        fim: diaIso(fim),
        periodo: `${ini.toLocaleDateString('pt-BR', { month: 'long' })} a ${nomeMes(fim)}`,
      };
    }
    case 'ANO':
      return { inicio: diaIso(new Date(ano, 0, 1)), fim: diaIso(new Date(ano, 11, 31)), periodo: String(ano) };
    case 'MES_ATUAL':
    default: {
      const ini = new Date(ano, mes, 1);
      return { inicio: diaIso(ini), fim: diaIso(ultimoDia(ano, mes)), periodo: nomeMes(ini) };
    }
  }
}

const SCORE_FAIXA_LABEL: Record<ScoreFaixa, string> = {
  SAUDAVEL: 'Saudável',
  ATENCAO: 'Atenção',
  ESFRIANDO: 'Esfriando',
  FRIO: 'Frio',
};

const SCORE_FAIXA_VARIANT: Record<
  ScoreFaixa,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  SAUDAVEL: 'default',
  ATENCAO: 'secondary',
  ESFRIANDO: 'outline',
  FRIO: 'destructive',
};

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

// ── Card de indicador ────────────────────────────────────────────────────────
function IndicadorCard({
  icon: Icon,
  label,
  value,
  destaque = false,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  destaque?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2">
          <Icon
            size={16}
            className={destaque ? 'shrink-0 text-destructive' : 'shrink-0 text-muted-foreground'}
          />
          <p className="truncate text-xs text-muted-foreground">{label}</p>
        </div>
        <p
          className={
            destaque
              ? 'mt-2 text-2xl font-semibold text-destructive'
              : 'mt-2 text-2xl font-semibold text-foreground'
          }
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

// ── Painel do gestor ─────────────────────────────────────────────────────────
export function PainelTab() {
  const { data, isLoading, isError } = useParceirosPainel();
  const actions = useParceirosActions();

  const [gerandoRelatorio, setGerandoRelatorio] = useState(false);
  const [periodoRelatorio, setPeriodoRelatorio] = useState<PeriodoOpcao>('MES_ATUAL');

  const handleRelatorio = async () => {
    setGerandoRelatorio(true);
    try {
      const res = await actions.gerarRelatorio(janelaDoPeriodo(periodoRelatorio));
      window.open(
        `${import.meta.env.VITE_API_URL || ''}/api/v1/attachments/${res.attachmentId}/download`,
        '_blank'
      );
    } catch {
      // erro já sinalizado via toast no hook
    } finally {
      setGerandoRelatorio(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <div className="space-y-2 rounded-md border border-border bg-card p-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex flex-col items-center justify-center rounded-md border border-border bg-card px-4 py-12 text-center">
        <FileWarning className="mb-3 text-destructive" size={32} />
        <p className="font-medium text-foreground">Erro ao carregar o painel</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Não foi possível buscar os indicadores dos parceiros. Tente novamente.
        </p>
      </div>
    );
  }

  const { indicadores, consultores } = data;

  return (
    <div className="space-y-4">
      {/* ── Cabeçalho + relatório executivo ── */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">Painel de parceiros</h2>
        <div className="flex items-center gap-2">
          <Select
            value={periodoRelatorio}
            onValueChange={(v) => setPeriodoRelatorio(v as PeriodoOpcao)}
          >
            <SelectTrigger className="w-[170px]" aria-label="Período do relatório">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PERIODO_LABEL) as PeriodoOpcao[]).map((op) => (
                <SelectItem key={op} value={op}>
                  {PERIODO_LABEL[op]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            className="gap-1.5"
            disabled={gerandoRelatorio}
            onClick={handleRelatorio}
          >
            {gerandoRelatorio ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <FileDown size={16} />
            )}
            Relatório executivo (PDF)
          </Button>
        </div>
      </div>

      {/* ── Indicadores ── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6 2xl:grid-cols-9">
        <IndicadorCard
          icon={Users}
          label="Consultores ativos"
          value={String(indicadores.consultoresAtivos)}
        />
        <IndicadorCard
          icon={MoonStar}
          label="Dormentes"
          value={String(indicadores.consultoresDormentes)}
          destaque={indicadores.consultoresDormentes > 0}
        />
        <IndicadorCard
          icon={Hourglass}
          label="Aguardando aprovação"
          value={String(indicadores.registrosAguardando)}
        />
        <IndicadorCard
          icon={AlertTriangle}
          label="Conflitos abertos"
          value={String(indicadores.conflitosAbertos)}
          destaque={indicadores.conflitosAbertos > 0}
        />
        <IndicadorCard
          icon={CalendarClock}
          label={`Expirando (${indicadores.avisoExpiracaoDias}d)`}
          value={String(indicadores.registrosExpirando)}
        />
        <IndicadorCard
          icon={Wallet}
          label="Comissões a pagar"
          value={brl.format(Number(indicadores.comissoesAPagar))}
        />
        <IndicadorCard
          icon={TrendingUp}
          label="Pipeline de parceiros"
          value={brl.format(Number(indicadores.pipelineParceiros))}
        />
        <IndicadorCard
          icon={Percent}
          label="Taxa de expiração"
          value={`${Math.round(Number(indicadores.taxaExpiracao))}%`}
          destaque={Number(indicadores.taxaExpiracao) > 20}
        />
        <IndicadorCard
          icon={Timer}
          label="Tempo médio de aprovação"
          value={
            indicadores.tempoMedioAprovacaoDias != null
              ? `${Math.round(Number(indicadores.tempoMedioAprovacaoDias))} dias`
              : '—'
          }
        />
      </div>

      {/* ── Tabela de consultores ── */}
      <div className="rounded-md border border-border bg-card">
        {consultores.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
            <Inbox className="mb-3 text-muted-foreground" size={32} />
            <p className="font-medium text-foreground">Nenhum consultor cadastrado</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Cadastre consultores na aba de consultores para acompanhar o desempenho aqui.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Consultor</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead className="text-right">Dias sem atividade</TableHead>
                  <TableHead className="text-right">Registros ativos</TableHead>
                  <TableHead className="text-right">Pipeline</TableHead>
                  <TableHead className="text-right">Ganho</TableHead>
                  <TableHead>Meta (ganho)</TableHead>
                  <TableHead className="text-right">Cumprimento do plano</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {consultores.map((c: ConsultorPainel) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium text-foreground">{c.nome}</TableCell>
                    <TableCell>
                      {c.scoreFaixa ? (
                        <div className="flex items-center gap-2">
                          <Badge variant={SCORE_FAIXA_VARIANT[c.scoreFaixa]}>
                            {SCORE_FAIXA_LABEL[c.scoreFaixa]}
                          </Badge>
                          <span className="text-sm text-muted-foreground">
                            {c.score != null ? Math.round(Number(c.score)) : '—'}
                          </span>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">Sem score</span>
                      )}
                    </TableCell>
                    <TableCell
                      className={
                        c.diasSemAtividade != null && c.diasSemAtividade > 30
                          ? 'text-right font-medium text-destructive'
                          : 'text-right text-foreground'
                      }
                    >
                      {c.diasSemAtividade != null ? c.diasSemAtividade : '—'}
                    </TableCell>
                    <TableCell className="text-right text-foreground">
                      {c.registrosAtivos}
                    </TableCell>
                    <TableCell className="text-right text-foreground">
                      {brl.format(Number(c.pipeline))}
                    </TableCell>
                    <TableCell className="text-right text-foreground">
                      {brl.format(Number(c.ganho))}
                    </TableCell>
                    <TableCell>
                      {c.metaPct?.ganho != null ? (
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-16 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{
                                width: `${Math.min(100, Math.max(0, Math.round(Number(c.metaPct.ganho))))}%`,
                              }}
                            />
                          </div>
                          <span className="text-sm text-foreground">
                            {Math.round(Number(c.metaPct.ganho))}%
                          </span>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-foreground">
                      {c.taxaCumprimento != null
                        ? `${Math.round(Number(c.taxaCumprimento))}%`
                        : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
