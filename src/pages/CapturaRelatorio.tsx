// Captura de Demandas · Relatório "Captura" (spec captura-demandas, filha 02, E-21 a E-23).
//
// Rota /app/reports/captura. Os seis indicadores, com as definições fixas do escopo, por
// cenário, cliente, contrato e período. Toda a conta é do servidor: a tela só mostra.

import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Header } from '../components/Header';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
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
import { apiClient } from '../services/api/client';
import { formatCurrency } from '../utils/format';
import {
  ROTULO_CENARIO,
  type AgrupamentoCaptura,
  type DemandaCenario,
  type IndicadoresCaptura,
} from '../types/captura';

const TODOS = 'TODOS';
const SEM_AGRUPAR = 'SEM';

const ROTULO_AGRUPAMENTO: Record<AgrupamentoCaptura, string> = {
  cenario: 'Cenário',
  cliente: 'Cliente',
  contrato: 'Contrato',
  mes: 'Mês',
};

function percentual(taxa: number | null): string {
  return taxa === null
    ? '—'
    : `${(taxa * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

function horas(valor: number | null): string {
  return valor === null ? '—' : `${valor.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`;
}

function dinheiro(valor: number | null): string {
  return valor === null ? '—' : formatCurrency(valor);
}

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function Indicador({
  titulo,
  valor,
  detalhe,
  definicao,
}: {
  titulo: string;
  valor: string;
  detalhe: string;
  definicao: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <p className="text-2xl font-semibold text-foreground mt-1 tabular-nums">{valor}</p>
      <p className="text-xs text-foreground mt-1">{detalhe}</p>
      <p className="text-xs text-muted-foreground mt-2">{definicao}</p>
    </div>
  );
}

function cartoes(i: IndicadoresCaptura) {
  return [
    {
      titulo: 'Taxa de go (contrato novo)',
      valor: percentual(i.taxaGo.taxa),
      detalhe: `${i.taxaGo.go} go de ${i.taxaGo.triadas} triadas`,
      definicao:
        'Go ÷ demandas triadas no período. Go: chegou a orçamento, a orçamento enviado ou a ganha.',
    },
    {
      titulo: 'Taxa de conversão',
      valor: percentual(i.conversao.taxa),
      detalhe: `${i.conversao.ganhas} ganhas, ${i.conversao.perdidas} perdidas`,
      definicao:
        'Ganhas ÷ (ganhas + perdidas), sobre orçamentos com decisão no período. Declinadas e canceladas ficam fora.',
    },
    {
      titulo: 'Tempo de atendimento',
      valor: horas(i.tempoAtendimento.mediaHorasUteis),
      detalhe: `média de ${i.tempoAtendimento.enviadas} orçamentos enviados`,
      definicao: 'Do horário de origem ao envio do orçamento, em horas úteis.',
    },
    {
      titulo: 'Cumprimento de SLA (LTA)',
      valor: percentual(i.sla.taxa),
      detalhe: `${i.sla.dentro} de ${i.sla.avaliados} no prazo · ${i.sla.semSla} fora da conta, sem SLA`,
      definicao: 'Chamados com orçamento enviado dentro do SLA do contrato.',
    },
    {
      titulo: 'Ticket médio enviado',
      valor: dinheiro(i.ticketEnviado.media),
      detalhe: `${i.ticketEnviado.quantidade} orçamentos · ${i.ticketEnviado.semValor} sem valor`,
      definicao: 'Soma do valor enviado ÷ nº de orçamentos enviados.',
    },
    {
      titulo: 'Ticket médio aprovado',
      valor: dinheiro(i.ticketAprovado.media),
      detalhe: `${i.ticketAprovado.quantidade} aprovados · ${i.ticketAprovado.semValor} sem valor`,
      definicao: 'Soma do valor aprovado ÷ nº de aprovados.',
    },
  ];
}

export function CapturaRelatorio() {
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [cenario, setCenario] = useState(TODOS);
  const [clienteId, setClienteId] = useState(TODOS);
  const [contratoId, setContratoId] = useState(TODOS);
  const [agrupar, setAgrupar] = useState(SEM_AGRUPAR);

  const { data: opcoes } = useQuery({
    queryKey: ['captura-filtros'],
    queryFn: async () => (await apiClient.getCapturaFiltros()).data,
    staleTime: 5 * 60 * 1000,
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ['captura-indicadores', de, ate, cenario, clienteId, contratoId, agrupar],
    queryFn: async () =>
      (
        await apiClient.getCapturaIndicadores({
          de: de || undefined,
          ate: ate || undefined,
          cenario: cenario === TODOS ? undefined : (cenario as DemandaCenario),
          clienteId: clienteId === TODOS ? undefined : clienteId,
          contratoId: contratoId === TODOS ? undefined : contratoId,
          agrupar: agrupar === SEM_AGRUPAR ? undefined : (agrupar as AgrupamentoCaptura),
        })
      ).data,
  });

  const calendario = data?.calendario;

  return (
    <div className="min-h-screen">
      <Header
        title="Radar"
        subtitle="Conversão, tempo e ticket das demandas que entraram pelo Radar."
      />

      <div className="px-4 md:px-8 py-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div>
            <Label htmlFor="captura-de">De</Label>
            <Input
              id="captura-de"
              type="date"
              value={de}
              onChange={(e) => setDe(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="captura-ate">Até</Label>
            <Input
              id="captura-ate"
              type="date"
              value={ate}
              onChange={(e) => setAte(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="captura-cenario">Cenário</Label>
            <Select value={cenario} onValueChange={setCenario}>
              <SelectTrigger id="captura-cenario" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos</SelectItem>
                {(Object.keys(ROTULO_CENARIO) as DemandaCenario[]).map((c) => (
                  <SelectItem key={c} value={c}>
                    {ROTULO_CENARIO[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="captura-cliente">Cliente</Label>
            <Select value={clienteId} onValueChange={setClienteId}>
              <SelectTrigger id="captura-cliente" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos</SelectItem>
                {(opcoes?.clientes ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="captura-contrato">Contrato</Label>
            <Select value={contratoId} onValueChange={setContratoId}>
              <SelectTrigger id="captura-contrato" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos</SelectItem>
                {(opcoes?.contratos ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="captura-agrupar">Abrir por</Label>
            <Select value={agrupar} onValueChange={setAgrupar}>
              <SelectTrigger id="captura-agrupar" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM_AGRUPAR}>Sem abertura</SelectItem>
                {(Object.keys(ROTULO_AGRUPAMENTO) as AgrupamentoCaptura[]).map((a) => (
                  <SelectItem key={a} value={a}>
                    {ROTULO_AGRUPAMENTO[a]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="animate-spin" size={20} />
            <span className="ml-2 text-sm">Carregando…</span>
          </div>
        ) : isError || !data ? (
          <p role="alert" className="text-sm text-destructive">
            Não foi possível carregar os indicadores. Tente de novo em instantes.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {cartoes(data.indicadores).map((c) => (
                <Indicador key={c.titulo} {...c} />
              ))}
            </div>

            {data.grupos.length > 0 && (
              <div className="rounded-md border border-border bg-card overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{ROTULO_AGRUPAMENTO[agrupar as AgrupamentoCaptura]}</TableHead>
                      <TableHead className="text-right">Taxa de go</TableHead>
                      <TableHead className="text-right">Conversão</TableHead>
                      <TableHead className="text-right">Tempo</TableHead>
                      <TableHead className="text-right">SLA</TableHead>
                      <TableHead className="text-right">Ticket enviado</TableHead>
                      <TableHead className="text-right">Ticket aprovado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.grupos.map((g) => (
                      <TableRow key={g.id}>
                        <TableCell className="font-medium text-foreground">{g.rotulo}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {percentual(g.indicadores.taxaGo.taxa)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {percentual(g.indicadores.conversao.taxa)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {horas(g.indicadores.tempoAtendimento.mediaHorasUteis)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {percentual(g.indicadores.sla.taxa)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {dinheiro(g.indicadores.ticketEnviado.media)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {dinheiro(g.indicadores.ticketAprovado.media)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {data.lacunas.ganhasSemValor.length > 0 && (
              <div className="rounded-md border border-border bg-card p-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle size={16} className="text-warning" aria-hidden="true" />
                  <h2 className="text-sm font-semibold text-foreground">
                    Ganhas sem valor aprovado ({data.lacunas.ganhasSemValor.length})
                  </h2>
                </div>
                <p className="text-xs text-muted-foreground mb-2">
                  O estado foi aplicado, mas sem valor não há consumo de saldo. Corrija o valor no
                  card do Flow.
                </p>
                <ul className="divide-y divide-border">
                  {data.lacunas.ganhasSemValor.map((l) => (
                    <li key={l.engageId} className="py-2 text-sm">
                      <Link
                        to={`/app/deals/${l.engageId}`}
                        className="text-primary hover:underline"
                      >
                        {l.objeto}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {l.cliente ? ` · ${l.cliente}` : ''}
                        {l.contrato ? ` · ${l.contrato}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              {data.dataInicio
                ? `Demandas registradas desde ${new Date(data.dataInicio).toLocaleDateString('pt-BR')}. As anteriores à ativação não existem aqui.`
                : 'Ainda não há demandas registradas.'}{' '}
              Descartadas ficam fora de todos os indicadores.
              {calendario &&
                ` Horas úteis: ${calendario.diasUteis.map((d) => DIAS[d]).join(', ')}, das ${calendario.inicio} às ${calendario.fim}${calendario.excluirFeriadosNacionais ? ', sem feriados nacionais' : ''}.`}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
