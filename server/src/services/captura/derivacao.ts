import { DealStage, DealStatus, DemandaEstado, Prisma } from '@prisma/client';
import {
  ESTADOS_ENCERRADOS,
  MOTIVO_CANCELADA,
  MOTIVO_DECLINADA,
  PROBABILIDADE_DO_STAGE,
  efeitoNoDeal,
} from './estados.js';

/**
 * Estado derivado de uma demanda (spec captura-demandas, E-15, M-04): função pura do conjunto de
 * eventos gravados em `DemandaEvento`. O resultado não depende da ordem em que os eventos
 * chegaram, só da ordem do tempo: `ocorrido_em`, e, no empate, a ordem de recebimento e depois
 * `evento_id`, para ser determinística.
 *
 * As regras são as da chegada em ordem, aplicadas evento a evento sobre o conjunto ordenado:
 * - histórico de etapas: uma entrada por mudança de estado, a partir de `recebida`;
 * - `triagemEm`, `orcamentoEm` e `enviadoEm`: primeiro instante em que o estado ocorreu;
 * - `valorEnviado`: o último informado;
 * - `aprovadoEm` e `valorAprovado`: enquanto a demanda segue em `ganha`; sair limpa;
 * - `aprovadoEm`, `encerradoEm`, `wonAt`, `lostAt` e `closedAt`: o início da última entrada no
 *   estado final; repetir o fechamento não muda a data;
 * - `deletedAt`: o primeiro `descartada` da sequência atual; `descartada` não mexe no resto do
 *   Negócio;
 * - motivo da perda: `perdida` repetida sem motivo mantém o último informado;
 * - `Deal.value`: só valores que o Flow informou, aprovado e senão enviado. Sem nenhum dos dois,
 *   o último valor definido fora do Flow (criação ou edição à mão permitida), guardado em
 *   `Demanda.valorEstimado`, ou 0.
 */

export interface EventoDaDemanda {
  eventoId: string;
  estado: DemandaEstado;
  ocorridoEm: Date;
  /** Ordem de recebimento: desempata eventos com o mesmo `ocorridoEm`. */
  recebidoEm: Date;
  valorEnviado: Prisma.Decimal | null;
  valorAprovado: Prisma.Decimal | null;
  motivo: string | null;
}

export interface EntradaDoHistorico {
  stage: DemandaEstado;
  enteredAt: Date;
  exitedAt: Date | null;
}

export interface Derivado {
  demanda: {
    estado: DemandaEstado;
    ultimoEventoEm: Date | null;
    triagemEm: Date | null;
    orcamentoEm: Date | null;
    enviadoEm: Date | null;
    valorEnviado: Prisma.Decimal | null;
    aprovadoEm: Date | null;
    valorAprovado: Prisma.Decimal | null;
    encerradoEm: Date | null;
    motivo: string | null;
  };
  negocio: {
    status: DealStatus;
    stage: DealStage;
    probability: number;
    wonAt: Date | null;
    lostAt: Date | null;
    closedAt: Date | null;
    deletedAt: Date | null;
    /** Rótulo do motivo de perda, quando o Negócio está perdido. */
    lostReason: string | null;
    value: Prisma.Decimal;
    /** Algum evento, que não `descartada`, passou pelo Negócio (limpa a pausa). */
    tocado: boolean;
  };
  historico: EntradaDoHistorico[];
}

export function ordenarEventos<T extends EventoDaDemanda>(eventos: T[]): T[] {
  return [...eventos].sort(
    (a, b) =>
      a.ocorridoEm.getTime() - b.ocorridoEm.getTime() ||
      a.recebidoEm.getTime() - b.recebidoEm.getTime() ||
      (a.eventoId < b.eventoId ? -1 : a.eventoId > b.eventoId ? 1 : 0)
  );
}

export function derivarDosEventos(
  eventosEmQualquerOrdem: EventoDaDemanda[],
  base: {
    recebidoEmOrigem: Date;
    /** Último valor definido fora do Flow: o da criação, ou a edição à mão permitida. */
    valorEstimado: Prisma.Decimal | null;
  }
): Derivado {
  const demanda: Derivado['demanda'] = {
    estado: DemandaEstado.recebida,
    ultimoEventoEm: null,
    triagemEm: null,
    orcamentoEm: null,
    enviadoEm: null,
    valorEnviado: null,
    aprovadoEm: null,
    valorAprovado: null,
    encerradoEm: null,
    motivo: null,
  };
  const negocio: Derivado['negocio'] = {
    status: DealStatus.OPEN,
    stage: DealStage.QUALIFICATION,
    probability: PROBABILIDADE_DO_STAGE.QUALIFICATION,
    wonAt: null,
    lostAt: null,
    closedAt: null,
    deletedAt: null,
    lostReason: null,
    value: base.valorEstimado ?? new Prisma.Decimal(0),
    tocado: false,
  };
  const historico: EntradaDoHistorico[] = [
    { stage: DemandaEstado.recebida, enteredAt: base.recebidoEmOrigem, exitedAt: null },
  ];

  for (const e of ordenarEventos(eventosEmQualquerOrdem)) {
    const s = e.estado;
    const t = e.ocorridoEm;
    const mudou = s !== demanda.estado;
    const encerrada = ESTADOS_ENCERRADOS.has(s);
    const ganha = s === DemandaEstado.ganha;

    // ── Demanda ──
    if (e.valorEnviado !== null) demanda.valorEnviado = e.valorEnviado;
    demanda.valorAprovado = ganha ? (e.valorAprovado ?? demanda.valorAprovado) : null;
    demanda.aprovadoEm = ganha ? (demanda.aprovadoEm ?? t) : null;
    demanda.encerradoEm = encerrada ? (mudou ? t : (demanda.encerradoEm ?? t)) : null;
    demanda.motivo = encerrada && !ganha ? (e.motivo ?? (mudou ? null : demanda.motivo)) : null;
    if (s === DemandaEstado.em_triagem) demanda.triagemEm = demanda.triagemEm ?? t;
    if (s === DemandaEstado.em_orcamento) demanda.orcamentoEm = demanda.orcamentoEm ?? t;
    if (s === DemandaEstado.orcamento_enviado) demanda.enviadoEm = demanda.enviadoEm ?? t;
    demanda.estado = s;
    demanda.ultimoEventoEm = t;

    // ── Negócio ──
    negocio.value =
      demanda.valorAprovado ?? demanda.valorEnviado ?? base.valorEstimado ?? new Prisma.Decimal(0);

    if (s === DemandaEstado.descartada) {
      // E-17: só a exclusão lógica; o resto do Negócio fica como estava.
      negocio.deletedAt = negocio.deletedAt ?? t;
    } else {
      const efeito = efeitoNoDeal(s);
      const perdeu = efeito.status === DealStatus.LOST;
      negocio.tocado = true;
      negocio.deletedAt = null;
      negocio.status = efeito.status;
      negocio.stage = efeito.stage;
      negocio.probability = PROBABILIDADE_DO_STAGE[efeito.stage];
      negocio.wonAt = ganha ? (mudou ? t : (negocio.wonAt ?? t)) : null;
      negocio.lostAt = perdeu ? (mudou ? t : (negocio.lostAt ?? t)) : null;
      negocio.closedAt = ganha || perdeu ? (mudou ? t : (negocio.closedAt ?? t)) : null;
      negocio.lostReason = perdeu
        ? s === DemandaEstado.declinada
          ? MOTIVO_DECLINADA
          : s === DemandaEstado.cancelada
            ? MOTIVO_CANCELADA
            : (demanda.motivo ?? 'Perdida')
        : null;
    }

    // ── Histórico: uma entrada por mudança de estado ──
    if (mudou) {
      historico[historico.length - 1].exitedAt = t;
      historico.push({ stage: s, enteredAt: t, exitedAt: null });
    }
  }

  return { demanda, negocio, historico };
}
