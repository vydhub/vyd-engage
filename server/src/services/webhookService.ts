import prisma from '../config/database.js';
import crypto from 'crypto';
import { createError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { getSamplePayload, type WebhookPayload } from '../utils/webhookPayloads.js';

export interface CreateWebhookData {
  url: string;
  events: string[];
  secret: string;
}

export interface UpdateWebhookData {
  url?: string;
  events?: string[];
  active?: boolean;
}

// Max webhooks per tenant (API-1.2 req 15).
export const MAX_WEBHOOKS_PER_TENANT = 10;

// Max delivery logs retained/returned per webhook (API-1.2 req 14).
export const MAX_WEBHOOK_LOGS = 100;

// Events selectable when creating a webhook (API-1.2 req 10), plus the contract mirror
// events of the Captura de Demandas (E-10), which the Flow subscribes to.
export const SELECTABLE_WEBHOOK_EVENTS = [
  'lead.created',
  'lead.updated',
  'lead.deleted',
  'deal.created',
  'deal.updated',
  'deal.won',
  'deal.lost',
  'task.completed',
  'automation.triggered',
  'contract.created',
  'contract.updated',
  'contract.deleted',
] as const;

// Full emit vocabulary (superset — some events are emitted internally even if not
// exposed in the create selector, e.g. lead.status_changed, payment.*).
export const WEBHOOK_EVENTS = [
  'lead.created',
  'lead.updated',
  'lead.deleted',
  'lead.status_changed',
  'deal.created',
  'deal.updated',
  'deal.stage_changed',
  'deal.won',
  'deal.lost',
  'task.created',
  'task.completed',
  'automation.triggered',
  'payment.approved',
  'payment.failed',
  'contract.created',
  'contract.updated',
  'contract.deleted',
] as const;

export const webhookService = {
  async findAll(tenantId: string) {
    return prisma.webhook.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { logs: true } },
      },
    });
  },

  async findById(tenantId: string, id: string) {
    const webhook = await prisma.webhook.findFirst({
      where: { id, tenantId },
      include: {
        _count: { select: { logs: true } },
      },
    });
    if (!webhook) {
      throw createError('Webhook not found', 404, 'WEBHOOK_NOT_FOUND');
    }
    return webhook;
  },

  async create(tenantId: string, data: CreateWebhookData) {
    // Secret required, non-empty (req 9 edge case) — never create an unsigned webhook.
    const secret = (data.secret || '').trim();
    if (!secret) {
      throw createError('Webhook secret is required', 400, 'WEBHOOK_SECRET_REQUIRED');
    }

    // Enforce per-tenant webhook limit (req 15) → 422 on the 11th.
    const count = await prisma.webhook.count({ where: { tenantId } });
    if (count >= MAX_WEBHOOKS_PER_TENANT) {
      throw createError(
        `Webhook limit reached (max ${MAX_WEBHOOKS_PER_TENANT} per tenant)`,
        422,
        'WEBHOOK_LIMIT_REACHED'
      );
    }

    return prisma.webhook.create({
      data: {
        tenantId,
        url: data.url,
        events: data.events,
        secret,
        active: true,
      },
    });
  },

  async update(tenantId: string, id: string, data: UpdateWebhookData) {
    await this.findById(tenantId, id);

    return prisma.webhook.update({
      where: { id },
      data: {
        url: data.url,
        events: data.events,
        active: data.active,
      },
    });
  },

  async delete(tenantId: string, id: string) {
    await this.findById(tenantId, id);
    await prisma.webhook.delete({ where: { id } });
  },

  async getLogs(tenantId: string, webhookId: string, limit = MAX_WEBHOOK_LOGS) {
    await this.findById(tenantId, webhookId);

    // Last 100 logs per webhook (req 14). Cap defensively at MAX_WEBHOOK_LOGS.
    return prisma.webhookLog.findMany({
      where: { webhookId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, MAX_WEBHOOK_LOGS),
    });
  },

  async testWebhook(tenantId: string, id: string, event?: string) {
    const webhook = await this.findById(tenantId, id);

    // If a specific event type is provided, send a realistic sample payload;
    // otherwise fall back to the generic test message for backward compat.
    const eventType = event || 'test';
    const payload: WebhookPayload | Record<string, unknown> = event
      ? getSamplePayload(event)
      : {
          event: 'test',
          timestamp: new Date().toISOString(),
          data: { message: 'This is a test webhook from VYD Engage' },
        };

    const body = JSON.stringify(payload);

    const signature = crypto.createHmac('sha256', webhook.secret).update(body).digest('hex');

    const startTime = Date.now();

    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Event': eventType,
          'X-Webhook-Delivery-Id': `test_${crypto.randomUUID()}`,
        },
        body,
        signal: AbortSignal.timeout(10000),
      });

      const statusCode = response.status;
      const responseText = await response.text().catch(() => '');
      const responseTime = Date.now() - startTime;

      await prisma.webhookLog.create({
        data: {
          webhookId: id,
          event: eventType,
          status: statusCode >= 200 && statusCode < 300 ? 'SUCCESS' : 'FAILED',
          statusCode,
          response: responseText.slice(0, 1000),
        },
      });

      if (statusCode >= 200 && statusCode < 300) {
        await prisma.webhook.update({
          where: { id },
          data: { successCount: { increment: 1 }, lastTriggeredAt: new Date() },
        });
      } else {
        await prisma.webhook.update({
          where: { id },
          data: { failureCount: { increment: 1 }, lastTriggeredAt: new Date() },
        });
      }

      return {
        success: statusCode >= 200 && statusCode < 300,
        statusCode,
        responseTime,
        payload,
      };
    } catch (error: any) {
      const responseTime = Date.now() - startTime;

      await prisma.webhookLog.create({
        data: {
          webhookId: id,
          event: eventType,
          status: 'FAILED',
          error: error.message,
        },
      });

      await prisma.webhook.update({
        where: { id },
        data: { failureCount: { increment: 1 }, lastTriggeredAt: new Date() },
      });

      return { success: false, error: error.message, responseTime, payload };
    }
  },
};
