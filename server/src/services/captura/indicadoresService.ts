import { DemandaCenario, DemandaEstado, Prisma } from '@prisma/client';
import prisma from '../../config/database.js';
import {
  type CalendarioUtil,
  horasUteisEntre,
  instanteLocal,
  normalizarCalendario,
  partesLocais,
} from './horasUteis.js';

/**
 * Indicadores da Captura (E-21, E-22), com definição fixa (M-10):
 *
 * - Taxa de go (contrato novo): Go ÷ demandas triadas. Go = chegou a orçamento, a orçamento
 *   enviado ou a ganha, no período, pela primeira dessas datas. Triadas = Go + No-go, em que
 *   No-go = declinada no período sem ter chegado a nenhum deles.
 * - Taxa de conversão: ganhas ÷ (ganhas + perdidas), por data da decisão, só sobre as que
 *   tiveram orçamento. Card movido para "Perdidas" sem orçamento não entra.
 * - Tempo de atendimento: enviadoEm − recebidoEmOrigem, em horas úteis, por data de envio.
 * - Cumprimento de SLA (LTA): % enviados dentro do SLA do contrato, por data de envio.
 *   Chamado sem SLA fica fora, com a contagem visível (`semSla`).
 * - Ticket médio enviado: soma do valor enviado ÷ nº de orçamentos enviados, por data de envio.
 * - Ticket médio aprovado: soma do valor aprovado ÷ nº de aprovados, por data de aprovação.
 *   Linha sem valor conta no divisor, como a definição manda, e aparece em `semValor`.
 *
 * `descartada` fica fora de tudo; `declinada` e `cancelada` ficam fora da conversão.
 */
export interface LinhaIndicador {
  engageId: string;
  objeto: string;
  cenario: DemandaCenario;
  estado: DemandaEstado;
  recebidoEmOrigem: Date;
  orcamentoEm: Date | null;
  enviadoEm: Date | null;
  valorEnviado: Prisma.Decimal | number | null;
  aprovadoEm: Date | null;
  valorAprovado: Prisma.Decimal | number | null;
  encerradoEm: Date | null;
  slaRespostaHoras: number | null;
  clienteId: string | null;
  clienteNome: string | null;
  contratoId: string | null;
  contratoNumero: string | null;
}

export interface Periodo {
  de: Date | null;
  ate: Date | null;
}

function razao(parte: number, todo: number): number | null {
  return todo === 0 ? null : Math.round((parte / todo) * 10000) / 10000;
}

function media(soma: Prisma.Decimal, quantidade: number): number | null {
  return quantidade === 0 ? null : Number(soma.dividedBy(quantidade).toFixed(2));
}

function somar(valores: Array<Prisma.Decimal | number>): Prisma.Decimal {
  return valores.reduce<Prisma.Decimal>(
    (total, valor) => total.plus(new Prisma.Decimal(valor)),
    new Prisma.Decimal(0)
  );
}

/** Primeira vez que a demanda chegou a orçamento, a enviado ou a ganha; null se nunca chegou. */
function marcoDoGo(l: LinhaIndicador): Date | null {
  const datas = [l.orcamentoEm, l.enviadoEm, l.aprovadoEm].filter((d): d is Date => d !== null);
  if (datas.length === 0) return null;
  return new Date(Math.min(...datas.map((d) => d.getTime())));
}

export function calcularIndicadores(
  linhas: LinhaIndicador[],
  calendario: CalendarioUtil,
  periodo: Periodo
) {
  const noPeriodo = (data: Date | null): data is Date =>
    data !== null &&
    (!periodo.de || data.getTime() >= periodo.de.getTime()) &&
    (!periodo.ate || data.getTime() <= periodo.ate.getTime());

  const validas = linhas.filter((l) => l.estado !== DemandaEstado.descartada);

  // Taxa de go
  const contratoNovo = validas.filter((l) => l.cenario === DemandaCenario.contrato_novo);
  const go = contratoNovo.filter((l) => noPeriodo(marcoDoGo(l))).length;
  const noGo = contratoNovo.filter(
    (l) => l.estado === DemandaEstado.declinada && !marcoDoGo(l) && noPeriodo(l.encerradoEm)
  ).length;

  // Conversão
  const aprovadas = validas.filter(
    (l) => l.estado === DemandaEstado.ganha && noPeriodo(l.aprovadoEm)
  );
  const teveOrcamento = (l: LinhaIndicador) => l.orcamentoEm !== null || l.enviadoEm !== null;
  const ganhas = aprovadas.filter(teveOrcamento);
  const perdidas = validas.filter(
    (l) => l.estado === DemandaEstado.perdida && noPeriodo(l.encerradoEm) && teveOrcamento(l)
  );

  // Tempo de atendimento
  const enviadas = validas.filter((l) => noPeriodo(l.enviadoEm));
  const horasDe = (l: LinhaIndicador) =>
    horasUteisEntre(l.recebidoEmOrigem, l.enviadoEm as Date, calendario);
  const horas = enviadas.map(horasDe);
  const horasTotal = horas.reduce((a, b) => a + b, 0);

  // SLA
  const chamadosEnviados = enviadas.filter((l) => l.cenario === DemandaCenario.chamado_lta);
  const avaliados = chamadosEnviados.filter((l) => l.slaRespostaHoras !== null);
  const dentroDoSla = avaliados.filter((l) => horasDe(l) <= (l.slaRespostaHoras as number));

  // Tickets
  const comValorEnviado = enviadas.filter((l) => l.valorEnviado !== null);
  const comValorAprovado = aprovadas.filter((l) => l.valorAprovado !== null);
  const somaEnviado = somar(comValorEnviado.map((l) => l.valorEnviado as Prisma.Decimal));
  const somaAprovado = somar(comValorAprovado.map((l) => l.valorAprovado as Prisma.Decimal));

  return {
    taxaGo: { go, triadas: go + noGo, taxa: razao(go, go + noGo) },
    conversao: {
      ganhas: ganhas.length,
      perdidas: perdidas.length,
      taxa: razao(ganhas.length, ganhas.length + perdidas.length),
    },
    tempoAtendimento: {
      enviadas: enviadas.length,
      mediaHorasUteis:
        enviadas.length === 0 ? null : Math.round((horasTotal / enviadas.length) * 100) / 100,
    },
    sla: {
      dentro: dentroDoSla.length,
      avaliados: avaliados.length,
      taxa: razao(dentroDoSla.length, avaliados.length),
      semSla: chamadosEnviados.length - avaliados.length,
    },
    ticketEnviado: {
      soma: Number(somaEnviado.toFixed(2)),
      quantidade: enviadas.length,
      media: media(somaEnviado, enviadas.length),
      semValor: enviadas.length - comValorEnviado.length,
    },
    ticketAprovado: {
      soma: Number(somaAprovado.toFixed(2)),
      quantidade: aprovadas.length,
      media: media(somaAprovado, aprovadas.length),
      semValor: aprovadas.length - comValorAprovado.length,
    },
  };
}

export type Indicadores = ReturnType<typeof calcularIndicadores>;

export type Agrupamento = 'cenario' | 'cliente' | 'contrato' | 'mes';

const ROTULO_CENARIO: Record<DemandaCenario, string> = {
  contrato_novo: 'Contrato novo',
  chamado_lta: 'Chamado LTA',
};

function agruparPor(linhas: LinhaIndicador[], chave: (l: LinhaIndicador) => [string, string]) {
  const grupos = new Map<string, { rotulo: string; linhas: LinhaIndicador[] }>();
  for (const linha of linhas) {
    const [id, rotulo] = chave(linha);
    const grupo = grupos.get(id) ?? { rotulo, linhas: [] };
    grupo.linhas.push(linha);
    grupos.set(id, grupo);
  }
  return [...grupos.entries()]
    .map(([id, g]) => ({ id, rotulo: g.rotulo, linhas: g.linhas }))
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
}

/** Início do mês e o último instante dele, no fuso do calendário. */
function limitesDoMes(ano: number, mes: number, fuso: string): Periodo {
  const de = instanteLocal(ano, mes, 1, 0, 0, fuso);
  const proximo = mes === 12 ? { ano: ano + 1, mes: 1 } : { ano, mes: mes + 1 };
  const ate = new Date(instanteLocal(proximo.ano, proximo.mes, 1, 0, 0, fuso).getTime() - 1);
  return { de, ate };
}

function periodoDoFiltro(de: string | undefined, ate: string | undefined, fuso: string): Periodo {
  const partes = (valor: string) => valor.split('-').map(Number) as [number, number, number];
  let inicio: Date | null = null;
  let fim: Date | null = null;
  if (de) {
    const [a, m, d] = partes(de);
    inicio = instanteLocal(a, m, d, 0, 0, fuso);
  }
  if (ate) {
    const [a, m, d] = partes(ate);
    const seguinte = new Date(Date.UTC(a, m - 1, d + 1));
    fim = new Date(
      instanteLocal(
        seguinte.getUTCFullYear(),
        seguinte.getUTCMonth() + 1,
        seguinte.getUTCDate(),
        0,
        0,
        fuso
      ).getTime() - 1
    );
  }
  return { de: inicio, ate: fim };
}

const MAX_MESES = 36;

function mesesDoIntervalo(linhas: LinhaIndicador[], periodo: Periodo, fuso: string): string[] {
  const instantes = linhas
    .flatMap((l) => [l.recebidoEmOrigem, l.orcamentoEm, l.enviadoEm, l.aprovadoEm, l.encerradoEm])
    .filter((d): d is Date => d !== null)
    .map((d) => d.getTime());
  const menor = periodo.de?.getTime() ?? (instantes.length ? Math.min(...instantes) : null);
  const maior = periodo.ate?.getTime() ?? (instantes.length ? Math.max(...instantes) : null);
  if (menor === null || maior === null) return [];

  const inicio = partesLocais(menor, fuso);
  const fim = partesLocais(maior, fuso);
  const meses: string[] = [];
  let ano = inicio.ano;
  let mes = inicio.mes;
  while ((ano < fim.ano || (ano === fim.ano && mes <= fim.mes)) && meses.length < MAX_MESES) {
    meses.push(`${ano}-${String(mes).padStart(2, '0')}`);
    mes++;
    if (mes === 13) {
      mes = 1;
      ano++;
    }
  }
  return meses;
}

export interface FiltrosIndicadores {
  de?: string;
  ate?: string;
  cenario?: DemandaCenario;
  clienteId?: string;
  contratoId?: string;
  agrupar?: Agrupamento;
  /** Escopo de visibilidade do usuário sobre Negócios (req 14 de governança). */
  escopoDono?: string | { in: string[] };
}

export async function obterIndicadores(tenantId: string, filtros: FiltrosIndicadores) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { capturaCalendario: true },
  });
  const calendario = normalizarCalendario(tenant?.capturaCalendario);

  const demandas = await prisma.demanda.findMany({
    where: {
      tenantId,
      ...(filtros.cenario ? { cenario: filtros.cenario } : {}),
      ...(filtros.contratoId ? { contratoId: filtros.contratoId } : {}),
      deal: {
        ...(filtros.clienteId ? { companyId: filtros.clienteId } : {}),
        ...(filtros.escopoDono ? { assignedTo: filtros.escopoDono } : {}),
      },
    },
    include: {
      deal: {
        select: { id: true, name: true, companyId: true, company: { select: { name: true } } },
      },
      contrato: { select: { id: true, numero: true, slaRespostaHoras: true } },
    },
  });

  const linhas: LinhaIndicador[] = demandas.map((d) => ({
    engageId: d.dealId,
    objeto: d.deal.name,
    cenario: d.cenario,
    estado: d.estado,
    recebidoEmOrigem: d.recebidoEmOrigem,
    orcamentoEm: d.orcamentoEm,
    enviadoEm: d.enviadoEm,
    valorEnviado: d.valorEnviado,
    aprovadoEm: d.aprovadoEm,
    valorAprovado: d.valorAprovado,
    encerradoEm: d.encerradoEm,
    slaRespostaHoras: d.contrato?.slaRespostaHoras ?? null,
    clienteId: d.deal.companyId,
    clienteNome: d.deal.company?.name ?? null,
    contratoId: d.contrato?.id ?? null,
    contratoNumero: d.contrato?.numero ?? null,
  }));

  const periodo = periodoDoFiltro(filtros.de, filtros.ate, calendario.fuso);

  let grupos: Array<{ id: string; rotulo: string; indicadores: Indicadores }> = [];
  if (filtros.agrupar === 'mes') {
    grupos = mesesDoIntervalo(linhas, periodo, calendario.fuso).map((chave) => {
      const [ano, mes] = chave.split('-').map(Number);
      const doMes = limitesDoMes(ano, mes, calendario.fuso);
      return {
        id: chave,
        rotulo: chave,
        indicadores: calcularIndicadores(linhas, calendario, {
          de: periodo.de && periodo.de > (doMes.de as Date) ? periodo.de : doMes.de,
          ate: periodo.ate && periodo.ate < (doMes.ate as Date) ? periodo.ate : doMes.ate,
        }),
      };
    });
  } else if (filtros.agrupar) {
    const chave: Record<Exclude<Agrupamento, 'mes'>, (l: LinhaIndicador) => [string, string]> = {
      cenario: (l) => [l.cenario, ROTULO_CENARIO[l.cenario]],
      cliente: (l) => [l.clienteId ?? 'sem-cliente', l.clienteNome ?? 'Sem cliente'],
      contrato: (l) => [l.contratoId ?? 'sem-contrato', l.contratoNumero ?? 'Sem contrato'],
    };
    grupos = agruparPor(linhas, chave[filtros.agrupar]).map((g) => ({
      id: g.id,
      rotulo: g.rotulo,
      indicadores: calcularIndicadores(g.linhas, calendario, periodo),
    }));
  }

  // Data de início do relatório (E-22): antes dela as demandas não existem aqui.
  const inicio = await prisma.demanda.aggregate({
    where: { tenantId },
    _min: { recebidoEmOrigem: true },
  });

  // Lacuna da auditoria: `ganha` sem valor aprovado não gera consumo.
  const ganhasSemValor = linhas
    .filter(
      (l) =>
        l.estado === DemandaEstado.ganha &&
        l.valorAprovado === null &&
        l.aprovadoEm !== null &&
        (!periodo.de || l.aprovadoEm >= periodo.de) &&
        (!periodo.ate || l.aprovadoEm <= periodo.ate)
    )
    .map((l) => ({
      engageId: l.engageId,
      objeto: l.objeto,
      cliente: l.clienteNome,
      contrato: l.contratoNumero,
      aprovadoEm: l.aprovadoEm,
    }));

  return {
    dataInicio: inicio._min.recebidoEmOrigem,
    calendario,
    indicadores: calcularIndicadores(linhas, calendario, periodo),
    grupos,
    lacunas: { ganhasSemValor },
  };
}

/** Opções dos filtros da tela: só clientes e contratos que têm demanda. */
export async function opcoesDosFiltros(tenantId: string, escopoDono?: string | { in: string[] }) {
  const demandas = await prisma.demanda.findMany({
    where: { tenantId, ...(escopoDono ? { deal: { assignedTo: escopoDono } } : {}) },
    select: {
      contrato: { select: { id: true, numero: true } },
      deal: { select: { company: { select: { id: true, name: true } } } },
    },
  });
  const clientes = new Map<string, string>();
  const contratos = new Map<string, string>();
  for (const d of demandas) {
    if (d.deal.company) clientes.set(d.deal.company.id, d.deal.company.name);
    if (d.contrato) contratos.set(d.contrato.id, d.contrato.numero);
  }
  const ordenar = (mapa: Map<string, string>) =>
    [...mapa.entries()]
      .map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  return { clientes: ordenar(clientes), contratos: ordenar(contratos) };
}
