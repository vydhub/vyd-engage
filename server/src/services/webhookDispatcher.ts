import crypto from 'crypto';
import prisma from '../config/database.js';
import { logger } from '../utils/logger.js';
import { flattenLeadData, flattenDealData, flattenTaskData } from '../utils/webhookPayloads.js';

/**
 * Webhook Dispatcher — intercepts business events and fires outgoing webhooks.
 *
 * Called from the service layer (not routes) so every mutation path is covered.
 * Dispatch is fully async (fire-and-forget) and never blocks or fails the caller
 * (API-1.2 req 16 + Redis-down edge case).
 *
 * Delivery path:
 *  - When ENABLE_AUTOMATION_ENGINE=true and Redis is reachable, each delivery is
 *    enqueued on a BullMQ queue with 3 attempts and 1s→5s→25s backoff (req 13).
 *  - Otherwise (dev without Redis, or Redis down) we fall back to a single inline
 *    best-effort delivery so the feature still works, logging failures and never
 *    throwing into the caller.
 */

// ---------------------------------------------------------------------------
// Outgoing webhook payload (req 11): { event, tenantId, timestamp, data }
// ---------------------------------------------------------------------------

export interface OutgoingWebhookPayload {
  event: string;
  tenantId?: string;
  timestamp: string;
  data: Record<string, unknown>;
}

/** Eventos do espelho de contratos para o Flow (spec captura-demandas, E-10). */
function ehEventoDeEspelho(event: string): boolean {
  return event.startsWith('contract.');
}

export function buildOutgoingPayload(
  tenantId: string,
  event: string,
  data: Record<string, unknown>
): OutgoingWebhookPayload {
  const timestamp = new Date().toISOString();
  // O contrato do espelho (06, §3) fixa o envelope em { event, timestamp, data }.
  if (ehEventoDeEspelho(event)) return { event, timestamp, data };
  return { event, tenantId, timestamp, data };
}

/**
 * Compute the HMAC-SHA256 signature sent in the X-VYD-Signature header (req 12).
 * Hex digest of the raw request body keyed by the webhook secret. Exported as a
 * pure helper so receivers can verify deliveries with the same algorithm.
 */
export function computeSignature(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

interface DeliveryJobData {
  webhookId: string;
  tenantId: string;
  event: string;
  payload: OutgoingWebhookPayload;
  /** O mesmo em todas as tentativas, para o destino reconhecer uma repetição. */
  deliveryId: string;
}

const MAX_LOGS_PER_WEBHOOK = 100; // req 14
const DELIVERY_ATTEMPTS = 3; // req 13
const DELIVERY_TIMEOUT_MS = 10000;

// ---------------------------------------------------------------------------
// Log retention (req 14): keep only the last 100 logs per webhook.
// ---------------------------------------------------------------------------

async function pruneLogs(webhookId: string): Promise<void> {
  try {
    const cutoff = await prisma.webhookLog.findMany({
      where: { webhookId },
      orderBy: { createdAt: 'desc' },
      skip: MAX_LOGS_PER_WEBHOOK,
      take: 1,
      select: { createdAt: true },
    });
    if (cutoff.length === 0) return;
    await prisma.webhookLog.deleteMany({
      where: { webhookId, createdAt: { lte: cutoff[0].createdAt } },
    });
  } catch (err: any) {
    logger.error('Failed to prune webhook logs', { webhookId, error: err?.message });
  }
}

// ---------------------------------------------------------------------------
// Espelho de contratos (E-10): o Flow devolve o id do registro, e o Engage grava.
// ---------------------------------------------------------------------------

/**
 * Se uma entrega anterior já trouxe o id do Flow, a seguinte vai com ele. O evento
 * enfileirado antes da resposta não recria o registro no Flow.
 */
async function comFlowRecordIdAtual(job: DeliveryJobData): Promise<OutgoingWebhookPayload> {
  const { data } = job.payload;
  if (!ehEventoDeEspelho(job.event) || data.flow_record_id || typeof data.id !== 'string') {
    return job.payload;
  }
  const contrato = await prisma.contrato.findFirst({
    where: { id: data.id, tenantId: job.tenantId },
    select: { flowRecordId: true },
  });
  if (!contrato?.flowRecordId) return job.payload;
  return { ...job.payload, data: { ...data, flow_record_id: contrato.flowRecordId } };
}

/** Grava `flow_record_id` da resposta só quando o contrato ainda não tem um. Nunca lança. */
async function gravarFlowRecordId(job: DeliveryJobData, respostaTexto: string): Promise<void> {
  try {
    const contratoId = job.payload.data.id;
    if (typeof contratoId !== 'string') return;
    const flowRecordId = (JSON.parse(respostaTexto) as { flow_record_id?: unknown }).flow_record_id;
    if (typeof flowRecordId !== 'string' || flowRecordId === '') return;
    await prisma.contrato.updateMany({
      where: { id: contratoId, tenantId: job.tenantId, flowRecordId: null },
      data: { flowRecordId },
    });
  } catch (err: any) {
    logger.warn('Não foi possível gravar o flow_record_id devolvido pelo Flow', {
      webhookId: job.webhookId,
      event: job.event,
      error: err?.message,
    });
  }
}

// ---------------------------------------------------------------------------
// HTTP delivery — performs a single POST attempt and records the result.
// Returns the HTTP status (or throws to trigger a BullMQ retry).
// ---------------------------------------------------------------------------

async function deliverOnce(job: DeliveryJobData, attempts: number): Promise<void> {
  const webhook = await prisma.webhook.findFirst({
    where: { id: job.webhookId, tenantId: job.tenantId, active: true },
  });
  // Webhook deleted/deactivated between enqueue and delivery — drop silently.
  if (!webhook) return;

  const body = JSON.stringify(await comFlowRecordIdAtual(job));
  const signature = computeSignature(webhook.secret, body);

  const startTime = Date.now();
  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-VYD-Signature': signature, // req 12
        // Mesmos cabeçalhos do "testar webhook"; o Flow confere X-Webhook-Signature (06, §1).
        'X-Webhook-Signature': signature,
        'X-Webhook-Event': job.event,
        'X-Webhook-Delivery-Id': job.deliveryId,
      },
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });

    const statusCode = response.status;
    const responseText = await response.text().catch(() => '');
    const durationMs = Date.now() - startTime;
    const success = statusCode >= 200 && statusCode < 300;

    await prisma.webhookLog.create({
      data: {
        webhookId: webhook.id,
        event: job.event,
        status: success ? 'SUCCESS' : 'FAILED',
        statusCode,
        durationMs,
        success,
        response: responseText.slice(0, 1000),
        attempts,
      },
    });
    await prisma.webhook.update({
      where: { id: webhook.id },
      data: {
        ...(success ? { successCount: { increment: 1 } } : { failureCount: { increment: 1 } }),
        lastTriggeredAt: new Date(),
      },
    });
    await pruneLogs(webhook.id);

    if (success && ehEventoDeEspelho(job.event)) {
      await gravarFlowRecordId(job, responseText);
    }

    if (!success) {
      // Non-2xx → throw so BullMQ retries (req 13). Inline path catches this.
      throw Object.assign(new Error(`Webhook responded ${statusCode}`), { statusCode });
    }
  } catch (error: any) {
    // Network error / timeout / non-2xx re-thrown above.
    const durationMs = Date.now() - startTime;
    // Only log a network-level failure here if we didn't already log a non-2xx.
    if (!/^Webhook responded \d+$/.test(error?.message || '')) {
      await prisma.webhookLog
        .create({
          data: {
            webhookId: webhook.id,
            event: job.event,
            status: 'FAILED',
            durationMs,
            success: false,
            error: error?.message?.slice(0, 1000),
            attempts,
          },
        })
        .catch(() => {});
      await prisma.webhook
        .update({
          where: { id: webhook.id },
          data: { failureCount: { increment: 1 }, lastTriggeredAt: new Date() },
        })
        .catch(() => {});
      await pruneLogs(webhook.id);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// BullMQ queue/worker (lazy + gated). Falls back to inline delivery when the
// automation engine is disabled or Redis is unreachable.
// ---------------------------------------------------------------------------

const engineEnabled = process.env.ENABLE_AUTOMATION_ENGINE === 'true';

let queue: import('bullmq').Queue<DeliveryJobData> | null = null;
let queueReady = false;
let bullmqInitFailed = false;

async function getQueue(): Promise<import('bullmq').Queue<DeliveryJobData> | null> {
  if (!engineEnabled || bullmqInitFailed) return null;
  if (queueReady) return queue;
  try {
    const { Queue, Worker } = await import('bullmq');
    const { getBullConnection } = await import('../config/redis.js');
    const connection = {
      ...getBullConnection(),
      maxRetriesPerRequest: null,
    };

    queue = new Queue<DeliveryJobData>('webhooks', {
      connection,
      defaultJobOptions: {
        attempts: DELIVERY_ATTEMPTS, // req 13: up to 3 attempts
        backoff: { type: 'webhookExp' }, // custom: 1s → 5s → 25s
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });

    // Custom backoff strategy: 1000ms * 5^attemptsMade → 1s, 5s, 25s (req 13).
    const worker = new Worker<DeliveryJobData>(
      'webhooks',
      async (job) => {
        await deliverOnce(job.data, job.attemptsMade + 1);
      },
      {
        connection,
        concurrency: 10,
        settings: {
          // 1000ms * 5^(attemptsMade-1) → 1s, 5s, 25s ladder (req 13).
          backoffStrategy: (attemptsMade: number) =>
            1000 * Math.pow(5, Math.max(0, attemptsMade - 1)),
        },
      }
    );

    worker.on('failed', (job, err) => {
      // After the final attempt the job is exhausted — log and stop (req 13).
      if (job && job.attemptsMade >= DELIVERY_ATTEMPTS) {
        logger.warn('Webhook delivery exhausted after retries', {
          webhookId: job.data.webhookId,
          event: job.data.event,
          attempts: job.attemptsMade,
          error: err?.message,
        });
      }
    });
    worker.on('error', (err) => {
      logger.error('Webhook worker error', { error: err?.message });
    });

    queueReady = true;
    return queue;
  } catch (err: any) {
    // Redis unreachable / BullMQ init failed → disable queue path, fall back inline.
    bullmqInitFailed = true;
    logger.error('Webhook BullMQ init failed — falling back to inline delivery', {
      error: err?.message,
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Core dispatch: find active webhooks for the event, enqueue (or inline-deliver).
// ---------------------------------------------------------------------------

async function dispatch(
  tenantId: string,
  event: string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    const webhooks = await prisma.webhook.findMany({
      where: { tenantId, active: true, events: { has: event } },
      select: { id: true },
    });
    if (webhooks.length === 0) return;

    const payload = buildOutgoingPayload(tenantId, event, data);
    const q = await getQueue();

    for (const webhook of webhooks) {
      const jobData: DeliveryJobData = {
        webhookId: webhook.id,
        tenantId,
        event,
        payload,
        deliveryId: crypto.randomUUID(),
      };

      if (q) {
        try {
          await q.add('deliver', jobData);
          continue;
        } catch (err: any) {
          // Enqueue failed (Redis dropped mid-flight) → fall back inline below.
          logger.error('Webhook enqueue failed — delivering inline', {
            webhookId: webhook.id,
            event,
            error: err?.message,
          });
        }
      }

      // Inline best-effort single attempt (dev without Redis, or Redis down).
      deliverOnce(jobData, 1).catch((err) => {
        logger.warn('Inline webhook delivery failed', {
          webhookId: webhook.id,
          event,
          error: err?.message,
        });
      });
    }
  } catch (error: any) {
    // Never let dispatcher errors propagate to callers (req 16 + Redis-down edge).
    logger.error('Webhook dispatcher error', { tenantId, event, error: error?.message });
  }
}

/** Resultado de uma entrega aguardada, por webhook assinante do evento. */
export interface ResultadoEntrega {
  webhookId: string;
  ok: boolean;
  /** Código HTTP da resposta, quando houve resposta. */
  status?: number;
  erro?: string;
}

/** Só os webhooks cuja URL termina com um destes sufixos. */
export interface FiltroDeEntrega {
  urlTerminaEm?: string[];
}

/**
 * Entrega agora e devolve o resultado, sem a fila: a semeadura desconecta logo depois, e a
 * rotina do espelho precisa saber o que falhou. Nunca lança. A falha também fica em WebhookLog.
 */
async function entregarEAguardar(
  tenantId: string,
  event: string,
  data: Record<string, unknown>,
  filtro: FiltroDeEntrega = {}
): Promise<ResultadoEntrega[]> {
  const webhooks = await prisma.webhook.findMany({
    where: {
      tenantId,
      active: true,
      events: { has: event },
      ...(filtro.urlTerminaEm
        ? { OR: filtro.urlTerminaEm.map((sufixo) => ({ url: { endsWith: sufixo } })) }
        : {}),
    },
    select: { id: true },
  });
  const payload = buildOutgoingPayload(tenantId, event, data);
  const resultados: ResultadoEntrega[] = [];
  for (const webhook of webhooks) {
    try {
      await deliverOnce(
        { webhookId: webhook.id, tenantId, event, payload, deliveryId: crypto.randomUUID() },
        1
      );
      resultados.push({ webhookId: webhook.id, ok: true });
    } catch (err) {
      const erro = err instanceof Error ? err.message : 'falha';
      const status = (err as { statusCode?: number }).statusCode;
      resultados.push({ webhookId: webhook.id, ok: false, erro, ...(status ? { status } : {}) });
    }
  }
  return resultados;
}

// ---------------------------------------------------------------------------
// Public API — fire-and-forget helpers for each entity type.
// ---------------------------------------------------------------------------

export const webhookDispatcher = {
  /** Generic dispatch entry-point (req: webhookDispatcher.dispatch(tenantId, event, data)). */
  dispatch(tenantId: string, event: string, data: Record<string, unknown>): void {
    dispatch(tenantId, event, data).catch(() => {});
  },

  /** Emit a lead event. Flattens lead data to Zapier-friendly format. */
  emitLeadEvent(tenantId: string, event: string, lead: Record<string, any>): void {
    dispatch(tenantId, event, flattenLeadData(lead)).catch(() => {});
  },

  /** Emit a deal event. `extra` allows adding fields like previous_stage. */
  emitDealEvent(
    tenantId: string,
    event: string,
    deal: Record<string, any>,
    extra?: Record<string, unknown>
  ): void {
    dispatch(tenantId, event, flattenDealData(deal, extra)).catch(() => {});
  },

  /** Emit a task event. Flattens task data to Zapier-friendly format. */
  emitTaskEvent(tenantId: string, event: string, task: Record<string, any>): void {
    dispatch(tenantId, event, flattenTaskData(task)).catch(() => {});
  },

  /** Emit a generic event with arbitrary data. */
  emit(tenantId: string, event: string, data: Record<string, unknown>): void {
    dispatch(tenantId, event, data).catch(() => {});
  },

  /** Como `emit`, mas entrega agora e devolve o resultado de cada webhook. */
  emitirEAguardar(
    tenantId: string,
    event: string,
    data: Record<string, unknown>,
    filtro?: FiltroDeEntrega
  ): Promise<ResultadoEntrega[]> {
    return entregarEAguardar(tenantId, event, data, filtro);
  },
};
