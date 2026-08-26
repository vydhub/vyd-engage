// Portal do Parceiro — extrato de comissões do consultor (req 32).
// Totais (a receber / recebidas) + tabela de parcelas liberadas por recebimento do cliente.
// Dados exclusivamente via usePortalComissoes().

import { Wallet, CheckCircle2, FileWarning, Coins, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { usePortalComissoes } from '@/hooks/usePortalParceiro';
import type { ComissaoStatus, PapelAtribuicao } from '@/types/parceiros';

// ── Rótulos (pt-BR) ─────────────────────────────────────────────────────────
const PAPEL_LABEL: Record<PapelAtribuicao, string> = {
  ORIGINADOR: 'Originador',
  DESENVOLVEDOR: 'Desenvolvedor',
};

const COMISSAO_STATUS_LABEL: Record<ComissaoStatus, string> = {
  A_PAGAR: 'A receber',
  PAGA: 'Paga',
};

const COMISSAO_STATUS_VARIANT: Record<ComissaoStatus, 'default' | 'secondary'> = {
  A_PAGAR: 'secondary',
  PAGA: 'default',
};

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function formatPercentual(valor: string | number): string {
  return `${Number(valor).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
}

export function PortalComissoes() {
  const { data, isLoading, isError } = usePortalComissoes();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
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
        <p className="font-medium text-foreground">Erro ao carregar o extrato de comissões</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Não foi possível buscar suas comissões. Tente novamente.
        </p>
      </div>
    );
  }

  const parcelas = data.parcelas ?? [];

  return (
    <div className="space-y-4">
      {/* ── Totais ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Wallet size={16} />
              A receber
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-foreground">
              {brl.format(Number(data.totais.aPagar))}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <CheckCircle2 size={16} />
              Recebidas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-foreground">
              {brl.format(Number(data.totais.pagas))}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Nota sobre liberação ── */}
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted px-3 py-2">
        <Info size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
        <p className="text-sm text-foreground">
          A comissão é liberada conforme o cliente paga a Tenax.
        </p>
      </div>

      {/* ── Tabela de parcelas ── */}
      <div className="rounded-md border border-border bg-card">
        {parcelas.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
            <Coins className="mb-3 text-muted-foreground" size={32} />
            <p className="font-medium text-foreground">Nenhuma parcela de comissão</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Suas parcelas aparecerão aqui conforme os recebimentos do cliente forem
              registrados.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Oportunidade</TableHead>
                  <TableHead>Papel</TableHead>
                  <TableHead>Recebimento do cliente</TableHead>
                  <TableHead className="text-right">% aplicado</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parcelas.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium text-foreground">
                      {p.registro.clienteNome}
                    </TableCell>
                    <TableCell className="text-foreground">{PAPEL_LABEL[p.papel]}</TableCell>
                    <TableCell className="text-foreground">
                      {new Date(p.recebimento.data).toLocaleDateString('pt-BR')}
                      {p.recebimento.referencia ? (
                        <span className="text-muted-foreground">
                          {' '}
                          — {p.recebimento.referencia}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right text-foreground">
                      {formatPercentual(p.percentualAplicado)}
                    </TableCell>
                    <TableCell className="text-right font-medium text-foreground">
                      {brl.format(Number(p.valor))}
                    </TableCell>
                    <TableCell>
                      <Badge variant={COMISSAO_STATUS_VARIANT[p.status]}>
                        {COMISSAO_STATUS_LABEL[p.status]}
                      </Badge>
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
