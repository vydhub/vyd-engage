import {
  ContratoMovimentoTipo,
  DealStatus,
  DemandaCenario,
  DemandaEstado,
  FunnelType,
  Prisma,
} from '@prisma/client';
import prisma from '../../config/database.js';
import { createError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { companyService } from '../companyService.js';
import { soDigitos } from '../contratoService.js';
import { recusarAndamentoManual, valorControladoPeloFlow } from '../dealService.js';
import { emitToTenant } from '../socketService.js';
import { webhookDispatcher } from '../webhookDispatcher.js';
import { derivarDosEventos } from './derivacao.js';
import {
  COLUNAS_PADRAO,
  MOTIVOS_FIXOS,
  NOME_DA_FONTE,
  NOME_DO_FUNIL,
  PROBABILIDADE_DO_STAGE,
} from './estados.js';

/**
 * Registro da demanda no Engage (spec captura-demandas, filha 02, E-11 a E-17, E-19).
 *
 * A demanda é um Negócio (Deal) com um satélite (Demanda). O andamento vem só do Flow,
 * pelos eventos: esta é a única porta que muda estado, valor enviado e valor aprovado.
 */

type Tx = Prisma.TransactionClient;
const ZERO = new Prisma.Decimal(0);

// ── Tipos de entrada (formatos do contrato 06) ───────────────────────────────────

export interface CriarDemandaEntrada {
  chave_dedup: string;
  id_captura: string;
  cenario: DemandaCenario;
  fonte: string;
  nivel: number;
  recebido_em_origem: Date;
  capturado_em: Date;
  cliente_id: string;
  contrato_id?: string | null;
  objeto: string;
  valor_estimado?: number | null;
  flow_card_id?: string | null;
  link_original?: string | null;
  responsavel_email?: string | null;
  situacao_origem?: string | null;
  situacao_origem_em?: Date | null;
}

export interface AtualizarDemandaEntrada {
  flow_card_id?: string | null;
  link_original?: string | null;
  cliente_id?: string;
  cenario?: DemandaCenario;
  contrato_id?: string | null;
  responsavel_email?: string | null;
  situacao_origem?: string | null;
  situacao_origem_em?: Date | null;
  adendo?: { texto: string; em?: Date | null };
}

export interface EventoEntrada {
  evento_id: string;
  chave_dedup: string;
  flow_card_id?: string | null;
  estado: DemandaEstado;
  ocorrido_em: Date;
  valor_enviado?: number | null;
  valor_aprovado?: number | null;
  motivo?: string | null;
  autor_email?: string | null;
}

// ── Utilitários ──────────────────────────────────────────────────────────────────

export function linkDoNegocio(dealId: string): string {
  const base = (process.env.FRONTEND_URL || 'https://engage.vydhub.com').replace(/\/+$/, '');
  return `${base}/app/deals/${dealId}`;
}

function erroDeCampo(campo: string, mensagem: string) {
  return createError(mensagem, 422, 'DADOS_INVALIDOS', { campo });
}

function ehUnicidade(erro: unknown): boolean {
  return (erro as { code?: string })?.code === 'P2002';
}

/** Impasse (40P01) ou falha de serialização (40001), como o Prisma os entrega. */
function ehImpasse(erro: unknown): boolean {
  const e = erro as { code?: string; message?: string };
  return (
    e?.code === 'P2034' ||
    /deadlock detected|could not serialize access|"40P01"|"40001"/.test(e?.message ?? '')
  );
}

/**
 * Repete a transação uma vez quando o banco a desfaz por impasse. A ordem fixa das travas evita
 * o caso conhecido; a repetição cobre o que sobrar, antes de responder erro.
 */
async function repetirUmaVezEmImpasse<T>(transacao: () => Promise<T>): Promise<T> {
  try {
    return await transacao();
  } catch (erro) {
    if (!ehImpasse(erro)) throw erro;
    logger.warn('Transação do Radar desfeita por impasse no banco: repetindo uma vez');
    return transacao();
  }
}

const incluirDoNegocio = {
  lead: { select: { id: true, name: true, email: true } },
  assignedUser: { select: { id: true, name: true, email: true } },
} satisfies Prisma.DealInclude;

async function usuarioPorEmail(
  cliente: Tx | typeof prisma,
  tenantId: string,
  email: string | null | undefined
): Promise<string | null> {
  if (!email) return null;
  const usuario = await cliente.user.findFirst({
    where: { tenantId, email: email.trim().toLowerCase(), status: { not: 'INACTIVE' } },
    select: { id: true },
  });
  return usuario?.id ?? null;
}

// ── Funis (E-12) ─────────────────────────────────────────────────────────────────

/**
 * Cria o que faltar nos dois funis, a fonte "Radar" e os motivos fixos da M-04. Só
 * acrescenta: nunca renomeia nem apaga, então colunas ajustadas à mão continuam valendo, e
 * uma fonte de mesmo nome antigo criada pelo cliente fica como está.
 * A trava consultiva serializa duas primeiras chamadas simultâneas do mesmo tenant.
 */
export async function garantirFunis(tenantId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`captura-funis:${tenantId}`}))`;

    for (const cenario of Object.values(DemandaCenario)) {
      const nome = NOME_DO_FUNIL[cenario];
      let funil = await tx.funnel.findFirst({
        where: { tenantId, name: nome, type: FunnelType.DEAL },
        include: { columns: true },
      });
      if (!funil) {
        const order = await tx.funnel.count({ where: { tenantId, type: FunnelType.DEAL } });
        funil = await tx.funnel.create({
          data: { tenantId, name: nome, type: FunnelType.DEAL, isDefault: false, order },
          include: { columns: true },
        });
      }

      const presentes = new Set(funil.columns.map((c) => c.capturaEstado));
      let proximaOrdem = funil.columns.reduce((max, c) => Math.max(max, c.order), -1) + 1;
      for (const coluna of COLUNAS_PADRAO[cenario]) {
        if (presentes.has(coluna.capturaEstado)) continue;
        await tx.funnelColumn.create({
          data: {
            funnelId: funil.id,
            title: coluna.title,
            color: coluna.color,
            order: proximaOrdem,
            isDefault: proximaOrdem === 0,
            capturaEstado: coluna.capturaEstado,
          },
        });
        proximaOrdem++;
      }
    }

    const fonte = await tx.dealSource.findFirst({ where: { tenantId, name: NOME_DA_FONTE } });
    // A "Radar" que já existe é reaproveitada como está: desativada, segue desativada.
    if (!fonte) await tx.dealSource.create({ data: { tenantId, name: NOME_DA_FONTE } });

    for (const label of MOTIVOS_FIXOS) {
      const motivo = await tx.lostReason.findFirst({ where: { tenantId, label } });
      if (!motivo) await tx.lostReason.create({ data: { tenantId, label } });
    }
  });
}

async function colunaDoEstado(
  cliente: Tx | typeof prisma,
  tenantId: string,
  cenario: DemandaCenario,
  estado: DemandaEstado,
  funilAtual?: string | null
) {
  // O funil em que o Negócio já está vale mais que o nome: quem renomeou não quebra o evento.
  if (funilAtual) {
    const naAtual = await cliente.funnelColumn.findFirst({
      where: { capturaEstado: estado, funnelId: funilAtual, funnel: { tenantId } },
      orderBy: { order: 'asc' },
      select: { id: true, funnelId: true },
    });
    if (naAtual) return naAtual;
  }
  return cliente.funnelColumn.findFirst({
    where: {
      capturaEstado: estado,
      funnel: { tenantId, name: NOME_DO_FUNIL[cenario], type: FunnelType.DEAL },
    },
    orderBy: { order: 'asc' },
    select: { id: true, funnelId: true },
  });
}

// ── Consumo do saldo (E-06) ──────────────────────────────────────────────────────

/**
 * Leva o consumo líquido do Negócio ao valor certo, por diferença. Por isso repetir é
 * inofensivo: `ganha` gera o consumo, sair de `ganha` compensa, e novo `ganha` com outro
 * valor ajusta só a diferença. Se o contrato mudou, o antigo é compensado e o novo recebe.
 * O CONSUMO de abertura da semeadura não tem `dealId` e não entra nesta conta.
 */
export async function reconciliarConsumo(
  tx: Tx,
  params: {
    tenantId: string;
    dealId: string;
    estado: DemandaEstado;
    valorAprovado: Prisma.Decimal | null;
    contratoId: string | null;
    autorId?: string | null;
    demandaEventoId?: string | null;
  }
): Promise<void> {
  const contratoAlvo =
    params.estado === DemandaEstado.ganha && params.valorAprovado !== null
      ? params.contratoId
      : null;

  const grupos = await tx.contratoMovimento.groupBy({
    by: ['contratoId'],
    where: { dealId: params.dealId, tipo: ContratoMovimentoTipo.CONSUMO },
    _sum: { valor: true },
  });
  const atualPorContrato = new Map(
    grupos.map((g) => [g.contratoId, new Prisma.Decimal(g._sum.valor ?? ZERO)])
  );

  const lancamentos: Array<{ contratoId: string; valor: Prisma.Decimal; motivo: string }> = [];

  for (const [contratoId, atual] of atualPorContrato) {
    if (contratoId !== contratoAlvo && !atual.isZero()) {
      lancamentos.push({
        contratoId,
        valor: atual.negated(),
        motivo: 'Compensação: a demanda saiu de ganha ou mudou de contrato',
      });
    }
  }

  if (contratoAlvo && params.valorAprovado) {
    const atual = atualPorContrato.get(contratoAlvo) ?? ZERO;
    const diferenca = params.valorAprovado.minus(atual);
    if (!diferenca.isZero()) {
      lancamentos.push({
        contratoId: contratoAlvo,
        valor: diferenca,
        motivo: atual.isZero()
          ? 'Demanda ganha: valor aprovado'
          : 'Ajuste pela diferença do novo valor aprovado',
      });
    }
  }

  // Duas demandas que trocam de contrato em sentidos opostos escreveriam nos mesmos contratos
  // em ordens diferentes, e o banco desfaria uma delas por impasse. Os contratos são travados de
  // uma vez, na ordem do id, e escritos nessa mesma ordem. `FOR NO KEY UPDATE` é o que a
  // atualização de `updatedAt` pede, e não briga com a trava de chave estrangeira de quem só
  // aponta para o contrato.
  lancamentos.sort((a, b) =>
    a.contratoId < b.contratoId ? -1 : a.contratoId > b.contratoId ? 1 : 0
  );
  const ids = [...new Set(lancamentos.map((l) => l.contratoId))];
  if (ids.length > 0) {
    await tx.$queryRaw`SELECT id FROM "Contrato" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR NO KEY UPDATE`;
  }

  for (const lancamento of lancamentos) {
    const movimento = await tx.contratoMovimento.create({
      data: {
        contratoId: lancamento.contratoId,
        tipo: ContratoMovimentoTipo.CONSUMO,
        valor: lancamento.valor,
        motivo: lancamento.motivo,
        dealId: params.dealId,
        autorId: params.autorId ?? null,
        demandaEventoId: params.demandaEventoId ?? null,
      },
    });
    // `atualizado_desde` precisa enxergar a mudança de saldo (espelho local da Captura).
    await tx.contrato.update({
      where: { id: lancamento.contratoId },
      data: { updatedAt: new Date() },
    });
    // AuditLog exige um usuário. Sem autor conhecido, o rastro é o evento ligado ao movimento.
    if (params.autorId) {
      await tx.auditLog.create({
        data: {
          tenantId: params.tenantId,
          entityType: 'contrato_movimento',
          entityId: movimento.id,
          userId: params.autorId,
          action: 'create',
          changes: [
            { field: 'tipo', oldValue: null, newValue: ContratoMovimentoTipo.CONSUMO },
            { field: 'valor', oldValue: null, newValue: lancamento.valor.toFixed(2) },
            { field: 'motivo', oldValue: null, newValue: lancamento.motivo },
          ],
        },
      });
    }
  }
}

// ── Criar demanda (E-13) ─────────────────────────────────────────────────────────

export async function criarDemanda(tenantId: string, entrada: CriarDemandaEntrada) {
  const existente = await prisma.demanda.findUnique({
    where: { tenantId_chaveDedup: { tenantId, chaveDedup: entrada.chave_dedup } },
    select: { dealId: true },
  });
  if (existente) return respostaDeCriacao(existente.dealId, true);

  const contratoId = entrada.contrato_id ?? null;
  if (entrada.cenario === DemandaCenario.chamado_lta && !contratoId) {
    throw erroDeCampo('contrato_id', 'Chamado LTA exige contrato_id');
  }

  const cliente = await prisma.company.findFirst({
    where: { id: entrada.cliente_id, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!cliente) throw erroDeCampo('cliente_id', 'Cliente não encontrado');

  if (contratoId) {
    const contrato = await prisma.contrato.findFirst({
      where: { id: contratoId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!contrato) throw erroDeCampo('contrato_id', 'Contrato não encontrado');
  }

  let coluna = await colunaDoEstado(prisma, tenantId, entrada.cenario, DemandaEstado.recebida);
  let fonte = await prisma.dealSource.findFirst({
    where: { tenantId, name: NOME_DA_FONTE },
    select: { id: true },
  });
  if (!coluna || !fonte) {
    await garantirFunis(tenantId);
    coluna = await colunaDoEstado(prisma, tenantId, entrada.cenario, DemandaEstado.recebida);
    fonte = await prisma.dealSource.findFirst({
      where: { tenantId, name: NOME_DA_FONTE },
      select: { id: true },
    });
  }
  if (!coluna || !fonte) {
    throw createError('Funil do Radar indisponível', 500, 'FUNIL_INDISPONIVEL');
  }

  const assignedTo = await usuarioPorEmail(prisma, tenantId, entrada.responsavel_email);
  const funnelId = coluna.funnelId;
  const funnelColumnId = coluna.id;
  const sourceId = fonte.id;

  try {
    const negocio = await prisma.$transaction(async (tx) => {
      const deal = await tx.deal.create({
        data: {
          tenantId,
          name: entrada.objeto,
          value: entrada.valor_estimado ?? 0,
          status: DealStatus.OPEN,
          stage: 'QUALIFICATION',
          probability: PROBABILIDADE_DO_STAGE.QUALIFICATION,
          companyId: entrada.cliente_id,
          assignedTo,
          sourceId,
          funnelId,
          funnelColumnId,
        },
        include: incluirDoNegocio,
      });
      await tx.demanda.create({
        data: {
          tenantId,
          dealId: deal.id,
          chaveDedup: entrada.chave_dedup,
          idCaptura: entrada.id_captura,
          flowCardId: entrada.flow_card_id ?? null,
          cenario: entrada.cenario,
          fonte: entrada.fonte,
          nivel: entrada.nivel,
          recebidoEmOrigem: entrada.recebido_em_origem,
          capturadoEm: entrada.capturado_em,
          contratoId,
          linkOriginal: entrada.link_original ?? null,
          valorEstimado: entrada.valor_estimado ?? null,
          situacaoOrigem: entrada.situacao_origem ?? null,
          situacaoOrigemEm: entrada.situacao_origem_em ?? null,
        },
      });
      await tx.dealStageHistory.create({
        data: {
          dealId: deal.id,
          stage: DemandaEstado.recebida,
          enteredAt: entrada.recebido_em_origem,
        },
      });
      return deal;
    });

    webhookDispatcher.emitDealEvent(tenantId, 'deal.created', negocio);
    emitToTenant(tenantId, 'deal:created', { deal: negocio });
    return respostaDeCriacao(negocio.id, false);
  } catch (erro) {
    // Duas chamadas simultâneas: a segunda perde na unicidade e toda a transação dela,
    // inclusive o Negócio, é desfeita.
    if (ehUnicidade(erro)) {
      const vencedora = await prisma.demanda.findUnique({
        where: { tenantId_chaveDedup: { tenantId, chaveDedup: entrada.chave_dedup } },
        select: { dealId: true },
      });
      if (vencedora) return respostaDeCriacao(vencedora.dealId, true);
    }
    throw erro;
  }
}

function respostaDeCriacao(dealId: string, repetido: boolean) {
  return { engage_id: dealId, engage_link: linkDoNegocio(dealId), repetido };
}

// ── Atualizar demanda (E-14): nunca muda estado ──────────────────────────────────

export async function atualizarDemanda(
  tenantId: string,
  engageId: string,
  entrada: AtualizarDemandaEntrada,
  autorId: string
) {
  const demanda = await prisma.demanda.findFirst({
    where: { tenantId, dealId: engageId },
    select: { id: true },
  });
  if (!demanda) throw createError('Demanda não encontrada', 404, 'DEMANDA_NAO_ENCONTRADA');

  if (entrada.contrato_id) {
    const contrato = await prisma.contrato.findFirst({
      where: { id: entrada.contrato_id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!contrato) throw erroDeCampo('contrato_id', 'Contrato não encontrado');
  }
  if (entrada.cliente_id) {
    const cliente = await prisma.company.findFirst({
      where: { id: entrada.cliente_id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!cliente) throw erroDeCampo('cliente_id', 'Cliente não encontrado');
  }

  // A trava consultiva dos funis fica fora da transação que segura a linha da demanda.
  if (entrada.cenario) await garantirFunis(tenantId);

  const responsavel =
    entrada.responsavel_email !== undefined
      ? await usuarioPorEmail(prisma, tenantId, entrada.responsavel_email)
      : null;

  await repetirUmaVezEmImpasse(() =>
    prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Demanda" WHERE id = ${demanda.id} FOR UPDATE`;
      // Tudo o que depende do estado é decidido aqui: um evento pode tê-lo mudado na espera.
      const atual = await tx.demanda.findUniqueOrThrow({
        where: { id: demanda.id },
        select: {
          estado: true,
          cenario: true,
          contratoId: true,
          valorAprovado: true,
          deal: { select: { companyId: true } },
        },
      });

      const cenarioFinal = entrada.cenario ?? atual.cenario;
      const mudouCenario = cenarioFinal !== atual.cenario;

      let contratoFinal = atual.contratoId;
      if (entrada.contrato_id !== undefined) contratoFinal = entrada.contrato_id;
      else if (mudouCenario && cenarioFinal === DemandaCenario.contrato_novo) contratoFinal = null;

      if (cenarioFinal === DemandaCenario.chamado_lta && !contratoFinal) {
        throw erroDeCampo('contrato_id', 'Chamado LTA exige contrato_id');
      }

      await tx.demanda.update({
        where: { id: demanda.id },
        data: {
          ...(entrada.flow_card_id !== undefined ? { flowCardId: entrada.flow_card_id } : {}),
          ...(entrada.link_original !== undefined ? { linkOriginal: entrada.link_original } : {}),
          // W-39: a situação no portal só informa; não passa por etapa nem por estado.
          ...(entrada.situacao_origem !== undefined
            ? { situacaoOrigem: entrada.situacao_origem }
            : {}),
          ...(entrada.situacao_origem_em !== undefined
            ? { situacaoOrigemEm: entrada.situacao_origem_em }
            : {}),
          cenario: cenarioFinal,
          contratoId: contratoFinal,
        },
      });

      const dadosDoNegocio: Prisma.DealUncheckedUpdateInput = {};
      if (mudouCenario) {
        // Descartada não ocupa coluna; a coluna volta pelo estado, se o card voltar a ficar ativo.
        const descartada = atual.estado === DemandaEstado.descartada;
        const coluna = await colunaDoEstado(
          tx,
          tenantId,
          cenarioFinal,
          descartada ? DemandaEstado.recebida : atual.estado
        );
        if (!coluna) throw createError('Funil do Radar indisponível', 500, 'FUNIL_INDISPONIVEL');
        dadosDoNegocio.funnelId = coluna.funnelId;
        if (!descartada) dadosDoNegocio.funnelColumnId = coluna.id;
      }
      if (entrada.cliente_id && entrada.cliente_id !== atual.deal.companyId) {
        dadosDoNegocio.companyId = entrada.cliente_id;
      }
      if (responsavel) dadosDoNegocio.assignedTo = responsavel;
      if (Object.keys(dadosDoNegocio).length > 0) {
        await tx.deal.update({ where: { id: engageId }, data: dadosDoNegocio });
      }

      if (mudouCenario) {
        await tx.interaction.create({
          data: {
            tenantId,
            dealId: engageId,
            type: 'STATUS_CHANGE',
            direction: 'INBOUND',
            subject: 'Reclassificação',
            content: `Demanda reclassificada de ${atual.cenario} para ${cenarioFinal}.`,
            metadata: { origem: 'captura', de: atual.cenario, para: cenarioFinal },
          },
        });
      }
      if (dadosDoNegocio.companyId) {
        await tx.interaction.create({
          data: {
            tenantId,
            dealId: engageId,
            type: 'STATUS_CHANGE',
            direction: 'INBOUND',
            subject: 'Mudança de cliente',
            content: 'O cliente da demanda foi alterado pelo Flow.',
            metadata: {
              origem: 'captura',
              de: atual.deal.companyId,
              para: entrada.cliente_id,
            },
          },
        });
      }

      if (contratoFinal !== atual.contratoId) {
        await reconciliarConsumo(tx, {
          tenantId,
          dealId: engageId,
          estado: atual.estado,
          valorAprovado: atual.valorAprovado,
          contratoId: contratoFinal,
          autorId,
        });
      }

      if (entrada.adendo) {
        const em = entrada.adendo.em ?? null;
        const texto = entrada.adendo.texto;
        // A Captura reenvia em caso de falha: o mesmo adendo não vira duas interações.
        const repetido = await tx.interaction.findFirst({
          where: {
            tenantId,
            dealId: engageId,
            type: 'NOTE',
            subject: 'Adendo do Radar',
            content: texto,
            occurredAt: em,
          },
          select: { id: true },
        });
        if (!repetido) {
          await tx.interaction.create({
            data: {
              tenantId,
              dealId: engageId,
              type: 'NOTE',
              direction: 'INBOUND',
              subject: 'Adendo do Radar',
              content: texto,
              occurredAt: em,
              metadata: { origem: 'captura' },
            },
          });
        }
      }
    })
  );

  return { engage_id: engageId, engage_link: linkDoNegocio(engageId) };
}

// ── Escrita do Engage em Negócio da Captura (E-15, E-16, decisão de 03/11) ───────

/**
 * Toda escrita do Engage num Negócio com Demanda passa por aqui: tela, copiloto e reunião (por
 * `dealService.update`), produtos e quadro do funil. É uma transação que começa travando a linha
 * da demanda, a mesma trava dos eventos do Flow, e só então confere e grava. Assim nenhum evento
 * entra entre a conferência e a gravação, e `trabalho` lê o estado que o último evento deixou.
 * Repete uma vez se o banco a desfizer por impasse.
 */
export function escreverNoNegocioDaDemanda<T>(
  tenantId: string,
  dealId: string,
  trabalho: (tx: Tx) => Promise<T>
): Promise<T> {
  return repetirUmaVezEmImpasse(() =>
    prisma.$transaction(async (tx) => {
      const achada = await tx.demanda.findFirst({
        where: { tenantId, dealId },
        select: { id: true },
      });
      if (!achada) throw createError('Deal not found', 404, 'DEAL_NOT_FOUND');
      await tx.$queryRaw`SELECT id FROM "Demanda" WHERE id = ${achada.id} FOR UPDATE`;
      return trabalho(tx);
    })
  );
}

/**
 * Fora dos eventos, o único caminho que grava `Deal.value` de um Negócio da Captura. Roda dentro
 * de `escreverNoNegocioDaDemanda` (trava de novo a demanda, o que na mesma transação não espera).
 *
 * Confere o valor do Flow sob a trava. Se um evento já trouxe valor enviado ou aprovado, recusa
 * com 403, e a transação inteira volta, inclusive o item de produto gravado nela. Senão, grava o
 * valor em `Demanda.valorEstimado` e em `Deal.value`. Os eventos usam esse valor enquanto o Flow
 * não informar o dele, e um evento sem valor nunca o apaga.
 *
 * `calcular` roda sob a trava: os produtos somam ali os itens, com os de outra edição já gravados.
 */
export async function registrarValorForaDoFlow(
  tx: Tx,
  tenantId: string,
  dealId: string,
  calcular: () => Promise<Prisma.Decimal | number>
): Promise<void> {
  const achada = await tx.demanda.findFirst({
    where: { tenantId, dealId },
    select: { id: true },
  });
  if (achada) {
    await tx.$queryRaw`SELECT id FROM "Demanda" WHERE id = ${achada.id} FOR UPDATE`;
    const atual = await tx.demanda.findUniqueOrThrow({
      where: { id: achada.id },
      select: { valorEnviado: true, valorAprovado: true },
    });
    if (valorControladoPeloFlow(atual)) recusarAndamentoManual();
  }
  const valor = await calcular();
  if (achada) {
    await tx.demanda.update({ where: { id: achada.id }, data: { valorEstimado: valor } });
  }
  await tx.deal.update({ where: { id: dealId }, data: { value: valor } });
}

// ── Receber evento (E-15, E-17) ──────────────────────────────────────────────────

export interface ResultadoEvento {
  aplicado: boolean;
  repetido: boolean;
}

interface Consequencia {
  dealId: string;
  estadoAnterior: DemandaEstado;
  estadoNovo: DemandaEstado;
  stageAnterior: string;
}

function decimalOuNull(valor: number | null | undefined): Prisma.Decimal | null {
  return valor === null || valor === undefined ? null : new Prisma.Decimal(valor);
}

/**
 * Recalcula a demanda e o Negócio a partir de todos os eventos gravados (`derivacao.ts`), na
 * transação que segura a linha da demanda. Histórico, estado, datas, valores e saldo ficam
 * iguais, chegue o evento em ordem ou atrasado.
 */
async function recalcularDaDemanda(
  tx: Tx,
  tenantId: string,
  demanda: {
    id: string;
    dealId: string;
    cenario: DemandaCenario;
    contratoId: string | null;
    recebidoEmOrigem: Date;
    valorEstimado: Prisma.Decimal | null;
    deal: { funnelId: string | null };
  },
  extra: { flowCardId?: string; autorId: string | null; demandaEventoId: string }
) {
  const eventos = await tx.demandaEvento.findMany({
    where: { demandaId: demanda.id },
    select: {
      eventoId: true,
      estado: true,
      ocorridoEm: true,
      createdAt: true,
      valorEnviado: true,
      valorAprovado: true,
      motivo: true,
    },
  });
  const d = derivarDosEventos(
    eventos.map((e) => ({ ...e, recebidoEm: e.createdAt })),
    { recebidoEmOrigem: demanda.recebidoEmOrigem, valorEstimado: demanda.valorEstimado }
  );

  await tx.demanda.update({
    where: { id: demanda.id },
    data: { ...d.demanda, ...(extra.flowCardId ? { flowCardId: extra.flowCardId } : {}) },
  });

  const dadosDoNegocio: Prisma.DealUncheckedUpdateInput = {
    status: d.negocio.status,
    stage: d.negocio.stage,
    probability: d.negocio.probability,
    wonAt: d.negocio.wonAt,
    lostAt: d.negocio.lostAt,
    closedAt: d.negocio.closedAt,
    deletedAt: d.negocio.deletedAt,
    lostReason: d.negocio.lostReason,
    value: d.negocio.value,
    ...(d.negocio.tocado ? { pausedAt: null } : {}),
  };
  if (d.negocio.lostReason) {
    const lista = await tx.lostReason.findFirst({
      where: { tenantId, label: d.negocio.lostReason },
      select: { id: true },
    });
    dadosDoNegocio.lostReasonId = lista?.id ?? null;
  } else {
    dadosDoNegocio.lostReasonId = null;
  }
  if (d.demanda.estado === DemandaEstado.descartada) {
    // E-17: sem coluna, sai também do quadro do funil, que não filtra por deletedAt. A coluna
    // volta pelo estado, se o card voltar a ficar ativo.
    dadosDoNegocio.funnelColumnId = null;
  } else {
    const coluna = await colunaDoEstado(
      tx,
      tenantId,
      demanda.cenario,
      d.demanda.estado,
      demanda.deal.funnelId
    );
    if (coluna) {
      dadosDoNegocio.funnelId = coluna.funnelId;
      dadosDoNegocio.funnelColumnId = coluna.id;
    } else {
      logger.warn('Coluna do estado não encontrada no funil do Radar', {
        tenantId,
        cenario: demanda.cenario,
        estado: d.demanda.estado,
      });
    }
  }
  await tx.deal.update({ where: { id: demanda.dealId }, data: dadosDoNegocio });

  // Em Negócio da Captura, só a criação e os eventos escrevem o histórico: E-16 recusa mudar o
  // andamento pelas outras vias, e os ganchos de etapa delas comparam com o estado lido sob a
  // trava da demanda (`escreverNoNegocioDaDemanda`). Então ele é refeito inteiro.
  await tx.dealStageHistory.deleteMany({ where: { dealId: demanda.dealId } });
  await tx.dealStageHistory.createMany({
    data: d.historico.map((h) => ({ dealId: demanda.dealId, ...h })),
  });

  // Saldo por diferença: o consumo líquido vai ao valor que o conjunto de eventos dá.
  await reconciliarConsumo(tx, {
    tenantId,
    dealId: demanda.dealId,
    estado: d.demanda.estado,
    valorAprovado: d.demanda.valorAprovado,
    contratoId: demanda.contratoId,
    autorId: extra.autorId,
    demandaEventoId: extra.demandaEventoId,
  });
  return d;
}

export async function aplicarEvento(
  tenantId: string,
  evento: EventoEntrada
): Promise<ResultadoEvento | null> {
  const autorEmail = evento.autor_email?.trim().toLowerCase() || null;
  // O cast evita que o TS estreite para null: a atribuição acontece dentro da transação.
  let consequencia = null as Consequencia | null;
  let resultado: ResultadoEvento | null;

  try {
    resultado = await repetirUmaVezEmImpasse(() =>
      prisma.$transaction(async (tx): Promise<ResultadoEvento | null> => {
        const achada = await tx.demanda.findUnique({
          where: { tenantId_chaveDedup: { tenantId, chaveDedup: evento.chave_dedup } },
          select: { id: true },
        });
        if (!achada) return null;

        // Uma demanda por vez: dois eventos dela nunca se cruzam na conta do saldo.
        await tx.$queryRaw`SELECT id FROM "Demanda" WHERE id = ${achada.id} FOR UPDATE`;

        const repetido = await tx.demandaEvento.findUnique({
          where: { tenantId_eventoId: { tenantId, eventoId: evento.evento_id } },
          select: { aplicado: true },
        });
        if (repetido) return { aplicado: repetido.aplicado, repetido: true };

        const demanda = await tx.demanda.findUniqueOrThrow({
          where: { id: achada.id },
          include: { deal: { select: { stage: true, funnelId: true } } },
        });

        // "Fora de ordem" segue o contrato 06: o evento entra no conjunto, mas não muda o estado
        // atual, e a resposta diz `aplicado: false`.
        const foraDeOrdem =
          demanda.ultimoEventoEm !== null &&
          evento.ocorrido_em.getTime() < demanda.ultimoEventoEm.getTime();

        const registrado = await tx.demandaEvento.create({
          data: {
            tenantId,
            demandaId: demanda.id,
            eventoId: evento.evento_id,
            estado: evento.estado,
            ocorridoEm: evento.ocorrido_em,
            flowCardId: evento.flow_card_id ?? null,
            valorEnviado: decimalOuNull(evento.valor_enviado),
            valorAprovado: decimalOuNull(evento.valor_aprovado),
            motivo: evento.motivo ?? null,
            autorEmail,
            aplicado: !foraDeOrdem,
          },
        });

        // M-08: o vínculo é preenchido assim que os dois existem. Em ordem, o card do evento vale.
        const flowCardId =
          evento.flow_card_id && (!foraDeOrdem || !demanda.flowCardId)
            ? evento.flow_card_id
            : undefined;
        const d = await recalcularDaDemanda(tx, tenantId, demanda, {
          flowCardId,
          autorId: await usuarioPorEmail(tx, tenantId, autorEmail),
          demandaEventoId: registrado.id,
        });
        if (d.demanda.estado === DemandaEstado.ganha && d.demanda.valorAprovado === null) {
          logger.warn('Evento ganha sem valor aprovado: consumo não gerado', {
            tenantId,
            demandaId: demanda.id,
            eventoId: evento.evento_id,
          });
        }

        if (foraDeOrdem) return { aplicado: false, repetido: false };
        consequencia = {
          dealId: demanda.dealId,
          estadoAnterior: demanda.estado,
          estadoNovo: d.demanda.estado,
          stageAnterior: demanda.deal.stage,
        };
        return { aplicado: true, repetido: false };
      })
    );
  } catch (erro) {
    // Mesmo evento em duas demandas, ou corrida fora da trava: quem chegou depois
    // devolve o que ficou gravado, sem aplicar de novo.
    if (ehUnicidade(erro)) {
      const gravado = await prisma.demandaEvento.findUnique({
        where: { tenantId_eventoId: { tenantId, eventoId: evento.evento_id } },
        select: { aplicado: true },
      });
      if (gravado) return { aplicado: gravado.aplicado, repetido: true };
    }
    throw erro;
  }

  if (consequencia) await aposAplicar(tenantId, consequencia);
  return resultado;
}

/** Efeitos fora da transação: nunca seguram nem desfazem o evento. */
async function aposAplicar(tenantId: string, c: Consequencia): Promise<void> {
  try {
    const deal = await prisma.deal.findFirst({
      where: { id: c.dealId, tenantId },
      include: incluirDoNegocio,
    });
    if (!deal) return;

    if (c.estadoNovo === DemandaEstado.descartada) {
      emitToTenant(tenantId, 'deal:deleted', { dealId: c.dealId });
      return;
    }

    emitToTenant(tenantId, 'deal:updated', { deal });
    if (c.estadoNovo === c.estadoAnterior) {
      webhookDispatcher.emitDealEvent(tenantId, 'deal.updated', deal);
      return;
    }

    if (deal.stage !== c.stageAnterior) {
      webhookDispatcher.emitDealEvent(tenantId, 'deal.stage_changed', deal, {
        previous_stage: c.stageAnterior,
        new_stage: deal.stage,
      });
    }
    if (c.estadoNovo === DemandaEstado.ganha) {
      webhookDispatcher.emitDealEvent(tenantId, 'deal.won', deal);
      if (deal.companyId) await companyService.promoteToActiveClient(tenantId, deal.companyId);
    } else if (deal.status === DealStatus.LOST) {
      webhookDispatcher.emitDealEvent(tenantId, 'deal.lost', deal, {
        lost_reason: deal.lostReason,
      });
    }
    webhookDispatcher.emitDealEvent(tenantId, 'deal.updated', deal);
  } catch (erro) {
    logger.error('Falha nos efeitos depois de aplicar evento da Captura', erro, {
      tenantId,
      dealId: c.dealId,
    });
  }
}

// ── Busca de cliente (E-19, E-20) ────────────────────────────────────────────────

export type MotivoCasamento = 'cnpj' | 'dominio' | 'nome';

/** Tira protocolo, "www." e caminho: "https://www.Cliente.com.br/x" vira "cliente.com.br". */
export function normalizarDominio(valor: string | null | undefined): string | null {
  const limpo = (valor ?? '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .replace(/^[^@]*@/, '')
    .split(/[/?#:]/)[0];
  return limpo === '' ? null : limpo;
}

const LIMITE_CANDIDATOS = 10;

export async function buscarClientes(
  tenantId: string,
  busca: { cnpj?: string; dominio?: string; nome?: string }
) {
  const achados = new Map<
    string,
    {
      id: string;
      nome: string;
      cnpj: string | null;
      dominio: string | null;
      motivo: MotivoCasamento;
    }
  >();
  const seleciona = { id: true, name: true, cnpj: true, domain: true, website: true } as const;
  const acrescenta = (
    empresa: { id: string; name: string; cnpj: string | null; domain: string | null },
    motivo: MotivoCasamento
  ) => {
    if (achados.has(empresa.id)) return;
    achados.set(empresa.id, {
      id: empresa.id,
      nome: empresa.name,
      cnpj: soDigitos(empresa.cnpj),
      dominio: empresa.domain,
      motivo,
    });
  };

  const cnpj = soDigitos(busca.cnpj);
  if (cnpj) {
    const linhas = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Company"
      WHERE "tenantId" = ${tenantId}
        AND "deletedAt" IS NULL
        AND regexp_replace(COALESCE(cnpj, ''), '\\D', '', 'g') = ${cnpj}
      LIMIT ${LIMITE_CANDIDATOS}`;
    if (linhas.length > 0) {
      const empresas = await prisma.company.findMany({
        where: { id: { in: linhas.map((l) => l.id) }, tenantId },
        select: seleciona,
      });
      for (const empresa of empresas) acrescenta(empresa, 'cnpj');
    }
  }

  const dominio = normalizarDominio(busca.dominio);
  if (dominio) {
    const empresas = await prisma.company.findMany({
      where: {
        tenantId,
        deletedAt: null,
        OR: [
          { domain: { contains: dominio, mode: 'insensitive' } },
          { website: { contains: dominio, mode: 'insensitive' } },
        ],
      },
      select: seleciona,
      take: LIMITE_CANDIDATOS * 3,
    });
    for (const empresa of empresas) {
      const casa = [empresa.domain, empresa.website].some(
        (valor) => normalizarDominio(valor) === dominio
      );
      if (casa) acrescenta(empresa, 'dominio');
    }
  }

  const nome = busca.nome?.trim();
  if (nome) {
    const empresas = await prisma.company.findMany({
      where: {
        tenantId,
        deletedAt: null,
        OR: [
          { name: { contains: nome, mode: 'insensitive' } },
          { fantasyName: { contains: nome, mode: 'insensitive' } },
        ],
      },
      select: seleciona,
      orderBy: { name: 'asc' },
      take: LIMITE_CANDIDATOS,
    });
    for (const empresa of empresas) acrescenta(empresa, 'nome');
  }

  return { candidatos: [...achados.values()].slice(0, LIMITE_CANDIDATOS) };
}
