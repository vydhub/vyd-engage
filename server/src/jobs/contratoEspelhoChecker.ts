import { NotificationType, UserRole } from '@prisma/client';
import prisma from '../config/database.js';
import { dadosDoEspelho } from '../services/contratoService.js';
import { notificationService } from '../services/notificationService.js';
import { webhookDispatcher } from '../services/webhookDispatcher.js';
import { logger } from '../utils/logger.js';

/**
 * Rotina do espelho de contratos (spec captura-demandas, emenda de 31/10 a E-10).
 *
 * Sem Redis, o webhook tenta uma vez só, e a reconciliação do Flow não devolve o id ao Engage.
 * Sem o id, a Captura não preenche o campo Contrato do card. Esta rotina reenvia
 * `contract.updated` **ao webhook do espelho do Flow**, e a entrega grava o id que o Flow
 * responder (`webhookDispatcher`). Outros assinantes de `contract.*` não recebem esse reenvio.
 *
 * Recusa por colisão (409, decisões de 03/11): o contrato fica marcado na versão recusada e sai da
 * rotina até ser alterado no Engage. ADMIN e GESTOR ativos, que podem corrigir o contrato (E-07),
 * são avisados uma vez por contrato e por código recusado: o reenvio depois de um movimento de
 * saldo não repete o aviso, e só um código novo recusado avisa de novo.
 *
 * Padrão sempre-ativo sem BullMQ/Redis (clientFollowUpChecker). A falha fica em WebhookLog e no
 * log, e o contrato volta na próxima rodada. O limite por rodada e o cursor em memória dão a vez
 * aos demais quando o Flow estiver fora do ar.
 */

const INTERVALO_MS = 15 * 60 * 1000;
const ATRASO_INICIAL_MS = 60 * 1000;
const LIMITE_POR_RODADA = 50;
/** Contrato recém-alterado ainda está na entrega normal: não entrega duas vezes. */
const CARENCIA_MS = 60 * 1000;
/** Rota fixada na mãe para o receptor do espelho no Flow. */
const ROTA_DO_ESPELHO = '/functions/v1/espelho-contratos';
const URL_DO_ESPELHO = [ROTA_DO_ESPELHO, `${ROTA_DO_ESPELHO}/`];
const AVISO_DE_RECUSA = 'espelho_recusado';

let cursor: string | null = null;
let emExecucao = false;
let inicial: ReturnType<typeof setTimeout> | null = null;
let intervalo: ReturnType<typeof setInterval> | null = null;

export interface ResultadoDaRodada {
  enviados: number;
  falhas: number;
  /** Recusados pelo Flow com 409: marcados e fora da rotina até a próxima alteração. */
  recusados: number;
}

interface ContratoRecusado {
  id: string;
  tenantId: string;
  numero: string;
  updatedAt: Date;
  company: { name: string };
}

/** A marca guarda a versão recusada, sem andar `updatedAt`: não é mudança do contrato. */
async function marcarRecusa(contrato: ContratoRecusado): Promise<void> {
  await prisma.contrato.updateMany({
    where: { id: contrato.id, updatedAt: contrato.updatedAt },
    data: { espelhoRecusadoNaVersao: contrato.updatedAt, updatedAt: contrato.updatedAt },
  });
}

async function avisarQuemCorrige(contrato: ContratoRecusado): Promise<void> {
  const codigo = contrato.numero;
  const jaAvisado = await prisma.notification.findFirst({
    where: {
      tenantId: contrato.tenantId,
      type: NotificationType.SYSTEM,
      AND: [
        { metadata: { path: ['tipo'], equals: AVISO_DE_RECUSA } },
        { metadata: { path: ['contratoId'], equals: contrato.id } },
        { metadata: { path: ['codigo'], equals: codigo } },
      ],
    },
    select: { id: true },
  });
  if (jaAvisado) return;

  const quemCorrige = await prisma.user.findMany({
    where: {
      tenantId: contrato.tenantId,
      role: { in: [UserRole.ADMIN, UserRole.GESTOR] },
      status: 'ACTIVE',
    },
    select: { id: true },
  });
  for (const usuario of quemCorrige) {
    await notificationService
      .create(contrato.tenantId, {
        userId: usuario.id,
        type: NotificationType.SYSTEM,
        title: `Contrato ${contrato.numero} sem espelho no Flow`,
        message:
          `O Flow recusou o contrato ${contrato.numero} (${contrato.company.name}): o código ` +
          'disputa um registro da tabela Contratos com outro contrato. Corrija o código aqui ' +
          'ou o registro no Flow. Depois de alterar o contrato no Engage, o envio volta sozinho.',
        link: `/app/contratos?contrato=${contrato.id}`,
        metadata: { tipo: AVISO_DE_RECUSA, contratoId: contrato.id, codigo },
      })
      .catch((erro) => logger.error('Espelho de contrato: aviso de recusa não criado', erro));
  }
}

export async function reenviarContratosSemFlowRecordId(
  opcoes: { limite?: number; carenciaMs?: number; tenantId?: string } = {}
): Promise<ResultadoDaRodada> {
  const resultado: ResultadoDaRodada = { enviados: 0, falhas: 0, recusados: 0 };
  if (emExecucao) return resultado;
  emExecucao = true;

  try {
    const limite = opcoes.limite ?? LIMITE_POR_RODADA;
    const corte = new Date(Date.now() - (opcoes.carenciaMs ?? CARENCIA_MS));

    // Só tenant com o webhook do espelho do Flow: nos demais não há para quem reenviar.
    const assinantes = await prisma.webhook.findMany({
      where: {
        active: true,
        events: { has: 'contract.updated' },
        OR: URL_DO_ESPELHO.map((sufixo) => ({ url: { endsWith: sufixo } })),
        ...(opcoes.tenantId ? { tenantId: opcoes.tenantId } : {}),
      },
      select: { tenantId: true },
      distinct: ['tenantId'],
    });
    if (assinantes.length === 0) return resultado;

    const pendentes = {
      tenantId: { in: assinantes.map((a) => a.tenantId) },
      deletedAt: null,
      flowRecordId: null,
      updatedAt: { lt: corte },
      // Recusado pelo Flow só volta depois de alterado no Engage.
      OR: [
        { espelhoRecusadoNaVersao: null },
        { updatedAt: { gt: prisma.contrato.fields.espelhoRecusadoNaVersao } },
      ],
    };
    const buscar = (id: object, quantos: number) =>
      prisma.contrato.findMany({
        where: { ...pendentes, ...id },
        orderBy: { id: 'asc' },
        take: quantos,
        include: { company: { select: { name: true } } },
      });

    let lote = await buscar(cursor ? { id: { gt: cursor } } : {}, limite);
    if (cursor && lote.length < limite) {
      lote = [...lote, ...(await buscar({ id: { lte: cursor } }, limite - lote.length))];
    }
    cursor = lote.length > 0 ? lote[lote.length - 1].id : null;

    for (const contrato of lote) {
      const entregas = await webhookDispatcher.emitirEAguardar(
        contrato.tenantId,
        'contract.updated',
        dadosDoEspelho(contrato),
        { urlTerminaEm: URL_DO_ESPELHO }
      );
      resultado.enviados++;
      const falhas = entregas.filter((e) => !e.ok);
      if (falhas.length === 0) continue;
      resultado.falhas++;
      if (falhas.some((e) => e.status === 409)) {
        resultado.recusados++;
        await marcarRecusa(contrato);
        await avisarQuemCorrige(contrato);
      }
      logger.warn('Espelho de contrato: reenvio ao Flow falhou', {
        tenantId: contrato.tenantId,
        contratoId: contrato.id,
        falhas,
      });
    }

    if (resultado.enviados > 0) {
      logger.info('Espelho de contrato: rodada de reenvio concluída', { ...resultado });
    }
  } catch (erro) {
    logger.error('Espelho de contrato: falha na rodada de reenvio', erro);
  } finally {
    emExecucao = false;
  }
  return resultado;
}

export function initializeContratoEspelhoChecker(): void {
  if (intervalo || inicial) return;
  inicial = setTimeout(() => void reenviarContratosSemFlowRecordId(), ATRASO_INICIAL_MS);
  inicial.unref?.();
  intervalo = setInterval(() => void reenviarContratosSemFlowRecordId(), INTERVALO_MS);
  intervalo.unref?.();
}

export function stopContratoEspelhoChecker(): void {
  if (inicial) clearTimeout(inicial);
  if (intervalo) clearInterval(intervalo);
  inicial = null;
  intervalo = null;
}
