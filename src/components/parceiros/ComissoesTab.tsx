// Aba "Comissões" do módulo de Gestão de Parceiros Comerciais (req 32).
// Extrato de parcelas de comissão: totais, filtros por consultor/status,
// tabela de parcelas e marcação de pagamento (pago fora do sistema).
// Dados exclusivamente via hooks de useParceiros.ts.

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Info,
  Inbox,
  Loader2,
  RotateCcw,
  Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
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
  useConsultores,
  useExtratoComissoes,
  useParceirosActions,
} from '@/hooks/useParceiros';
import type {
  ComissaoStatus,
  Consultor,
  ExtratoComissao,
  PapelAtribuicao,
} from '@/types/parceiros';

// ── Rótulos e formatadores (pt-BR) ──────────────────────────────────────────
const PAPEL_LABEL: Record<PapelAtribuicao, string> = {
  ORIGINADOR: 'Originador',
  DESENVOLVEDOR: 'Desenvolvedor',
};

const COMISSAO_STATUS_LABEL: Record<ComissaoStatus, string> = {
  A_PAGAR: 'A pagar',
  PAGA: 'Paga',
};

const COMISSAO_STATUS_VARIANT: Record<
  ComissaoStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  A_PAGAR: 'secondary',
  PAGA: 'default',
};

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const numPtBr = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

/** Percentual aplicado (comissão base ou override) — valor em pontos percentuais. */
function formatPercentual(value: string | number): string {
  return `${numPtBr.format(Number(value))}%`;
}

/**
 * Fração do papel, gravada pelo backend como percentual inteiro (60/40/100).
 * Quando há mais de um consultor no mesmo papel, o VALOR da parcela já vem
 * dividido do backend; a fração exibida aqui é a do papel (não multiplicar).
 */
function formatFracao(value: number): string {
  return `${new Intl.NumberFormat('pt-BR').format(Number(value))}%`;
}

function formatData(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}

export function ComissoesTab() {
  const actions = useParceirosActions();

  // Filtros (só chaves selecionadas viram query).
  const [consultorId, setConsultorId] = useState<string>('__todos');
  const [status, setStatus] = useState<string>('__todos');

  const filters = useMemo<Record<string, string>>(() => {
    const f: Record<string, string> = {};
    if (consultorId !== '__todos') f.consultorId = consultorId;
    if (status !== '__todos') f.status = status;
    return f;
  }, [consultorId, status]);

  const { data, isLoading, isError } = useExtratoComissoes(filters);
  const consultoresQuery = useConsultores();

  const extrato = data as ExtratoComissao | undefined;
  const parcelas = extrato?.parcelas ?? [];
  const consultores = (consultoresQuery.data ?? []) as Consultor[];

  // Parcela sendo marcada/reaberta no momento (desabilita o botão da linha).
  const [marcandoId, setMarcandoId] = useState<string | null>(null);

  const handleMarcar = async (id: string, paga: boolean) => {
    setMarcandoId(id);
    try {
      await actions.marcarParcelaPaga(id, paga);
    } catch {
      // erro já sinalizado via toast no hook
    } finally {
      setMarcandoId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* ── Cards de totais ── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Wallet size={16} />
              A pagar
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <p className="text-2xl font-semibold text-foreground">
                {brl.format(extrato?.totais.aPagar ?? 0)}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <CheckCircle2 size={16} />
              Pagas
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <p className="text-2xl font-semibold text-foreground">
                {brl.format(extrato?.totais.pagas ?? 0)}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Nota: pagamento acontece fora do sistema ── */}
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted px-3 py-2">
        <Info size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
        <p className="text-sm text-foreground">
          O pagamento efetivo (transferência) acontece fora do sistema — aqui as comissões são
          calculadas, rastreadas e marcadas como pagas.
        </p>
      </div>

      {/* ── Filtros ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="space-y-1">
          <Label>Consultor</Label>
          <Select value={consultorId} onValueChange={setConsultorId}>
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

        <div className="space-y-1">
          <Label>Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__todos">Todos</SelectItem>
              <SelectItem value="A_PAGAR">{COMISSAO_STATUS_LABEL.A_PAGAR}</SelectItem>
              <SelectItem value="PAGA">{COMISSAO_STATUS_LABEL.PAGA}</SelectItem>
            </SelectContent>
          </Select>
        </div>
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
            <AlertTriangle className="mb-3 text-destructive" size={32} />
            <p className="font-medium text-foreground">Erro ao carregar o extrato</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Não foi possível buscar as parcelas de comissão. Tente novamente.
            </p>
          </div>
        ) : parcelas.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
            <Inbox className="mb-3 text-muted-foreground" size={32} />
            <p className="font-medium text-foreground">Nenhuma parcela encontrada</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Ajuste os filtros ou registre recebimentos nas oportunidades ganhas para gerar
              comissões.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Consultor</TableHead>
                  <TableHead>Oportunidade</TableHead>
                  <TableHead>Papel</TableHead>
                  <TableHead className="text-right">% aplicado</TableHead>
                  <TableHead className="text-right">Fração papel</TableHead>
                  <TableHead>Recebimento</TableHead>
                  <TableHead className="text-right">Valor da parcela</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parcelas.map((p) => {
                  const aPagar = p.status === 'A_PAGAR';
                  const ocupada = marcandoId === p.id;
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium text-foreground">
                        {p.consultor.nome}
                      </TableCell>
                      <TableCell className="text-foreground">
                        {p.registro.clienteNome}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{PAPEL_LABEL[p.papel]}</Badge>
                      </TableCell>
                      <TableCell className="text-right text-foreground">
                        {formatPercentual(p.percentualAplicado)}
                      </TableCell>
                      <TableCell className="text-right text-foreground">
                        {formatFracao(p.fracaoPapel)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-foreground">
                            {formatData(p.recebimento.data)} —{' '}
                            {brl.format(Number(p.recebimento.valor))}
                          </span>
                          {p.recebimento.referencia ? (
                            <span className="text-xs text-muted-foreground">
                              {p.recebimento.referencia}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium text-foreground">
                        {brl.format(Number(p.valor))}
                      </TableCell>
                      <TableCell>
                        <Badge variant={COMISSAO_STATUS_VARIANT[p.status]}>
                          {COMISSAO_STATUS_LABEL[p.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          disabled={ocupada}
                          onClick={() => handleMarcar(p.id, aPagar)}
                        >
                          {ocupada ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : aPagar ? (
                            <Check size={14} />
                          ) : (
                            <RotateCcw size={14} />
                          )}
                          {aPagar ? 'Marcar paga' : 'Reabrir'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
