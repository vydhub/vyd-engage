import { createElement } from 'react';
import { render } from '@react-email/render';
import prisma from '../config/database.js';
import { LeadStatus, NotificationType } from '@prisma/client';
import { notificationService } from '../services/notificationService.js';
import { sendEmail } from '../services/emailService.js';
import { LeadReminderEmail } from '../emails/LeadReminderEmail.js';
import { logger } from '../utils/logger.js';

/**
 * Lembrete de 30 dias de leads em andamento (spec req. 47 + caso extremo 10).
 *
 * Padrão sempre-ativo sem BullMQ/Redis (clientFollowUpChecker/salesOps):
 * setInterval com primeira passada ~30s após o boot. A cada ciclo, varre por
 * tenant os leads EM_ANDAMENTO (não-contato, não-deletados) cuja "última
 * cobrança" tem LEAD_REMINDER_DAYS+ dias — âncora: criação do lead ou o último
 * lembrete emitido (Notification LEAD_REMINDER com metadata.leadId, dedup
 * PERSISTIDO em banco → sobrevive a reinícios do servidor).
 *
 *  - Com responsável ativo → e-mail via Resend global (LeadReminderEmail) +
 *    Notification LEAD_REMINDER in-app. Falha de e-mail (ex.: RESEND_API_KEY
 *    ausente) só loga: a notificação in-app segue e o job não crasha.
 *  - Sem responsável (ou responsável desativado/removido) → apenas Notification
 *    LEAD_REMINDER para todos os ADMINs ativos do tenant.
 *
 * Janela e intervalo configuráveis por env (para testes com janela reduzida):
 * LEAD_REMINDER_DAYS (default 30) e LEAD_REMINDER_CHECK_INTERVAL_MS (default 24h).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_REMINDER_DAYS = 30;
const DEFAULT_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 horas
const INITIAL_DELAY_MS = 30 * 1000; // 30 segundos

// Lidos a cada chamada (não no load do módulo) para os testes poderem ajustar
// o env antes de invocar a varredura.
function getReminderDays(): number {
  const parsed = Number(process.env.LEAD_REMINDER_DAYS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REMINDER_DAYS;
}

function getCheckIntervalMs(): number {
  const parsed = Number(process.env.LEAD_REMINDER_CHECK_INTERVAL_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CHECK_INTERVAL_MS;
}

function getAppBaseUrl(): string {
  return process.env.FRONTEND_URL || 'https://engage.vydhub.com';
}

async function sweepTenantReminders(
  tenantId: string,
  now: Date,
  reminderDays: number,
  windowStart: Date
): Promise<number> {
  // Dedup persistido: leads já lembrados dentro da janela (qualquer destinatário)
  // são pulados — chave é metadata.leadId, padrão salesOps/clientFollowUpChecker.
  const recentReminders = await prisma.notification.findMany({
    where: {
      tenantId,
      type: NotificationType.LEAD_REMINDER,
      createdAt: { gte: windowStart },
    },
    select: { metadata: true },
  });
  const remindedLeadIds = new Set<string>();
  for (const notif of recentReminders) {
    const meta = notif.metadata as Record<string, unknown> | null;
    if (typeof meta?.leadId === 'string') remindedLeadIds.add(meta.leadId);
  }

  // Âncora mínima: lead criado há reminderDays+ dias. Se houve lembrete anterior,
  // ele é necessariamente posterior à criação — o dedup acima cobre a janela.
  const leads = await prisma.lead.findMany({
    where: {
      tenantId,
      status: LeadStatus.EM_ANDAMENTO,
      deletedAt: null,
      isContact: false,
      createdAt: { lte: windowStart },
    },
    select: {
      id: true,
      name: true,
      company: true,
      createdAt: true,
      assignedTo: true,
      companyRef: { select: { name: true } },
      assignedUser: { select: { id: true, email: true, status: true } },
    },
  });
  if (leads.length === 0) return 0;

  // Cache dos ADMINs ativos do tenant (resolvido só se algum lead precisar).
  let adminIds: string[] | null = null;
  let reminded = 0;

  for (const lead of leads) {
    if (remindedLeadIds.has(lead.id)) continue;

    const daysInProgress = Math.floor((now.getTime() - lead.createdAt.getTime()) / DAY_MS);
    const companyName = lead.companyRef?.name ?? lead.company ?? null;
    const link = `/app/leads/${lead.id}`;

    // Responsável desativado/removido conta como "sem responsável" (caso extremo 10).
    const owner =
      lead.assignedUser && lead.assignedUser.status === 'ACTIVE' ? lead.assignedUser : null;

    if (owner) {
      // Última atividade = interação mais recente do lead (data do evento quando houver).
      const lastInteraction = await prisma.interaction.findFirst({
        where: { tenantId, leadId: lead.id, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { occurredAt: true, createdAt: true },
      });
      const lastActivity = lastInteraction
        ? (lastInteraction.occurredAt ?? lastInteraction.createdAt)
        : null;
      const lastActivityLabel = lastActivity
        ? lastActivity.toLocaleDateString('pt-BR')
        : null;

      // E-mail via Resend global. Sem RESEND_API_KEY (ou falha do provedor) o
      // sendEmail lança → loga e segue só com a notificação in-app (não crasha).
      if (owner.email) {
        try {
          const html = await render(
            createElement(LeadReminderEmail, {
              leadName: lead.name,
              companyName,
              daysInProgress,
              lastActivityLabel,
              leadUrl: `${getAppBaseUrl()}${link}`,
            })
          );
          await sendEmail({
            to: owner.email,
            subject: `Lembrete: lead "${lead.name}" em andamento há ${daysInProgress} dias - VYD Engage`,
            html,
          });
        } catch (err) {
          logger.error(`Lead reminder email failed for lead ${lead.id} — in-app only`, err);
        }
      }

      await notificationService
        .create(tenantId, {
          userId: owner.id,
          type: NotificationType.LEAD_REMINDER,
          title: 'Lembrete de lead em andamento',
          message: `O lead "${lead.name}"${companyName ? ` (${companyName})` : ''} está em andamento há ${daysInProgress} dias. Registre uma atividade ou atualize o status.`,
          link,
          metadata: { leadId: lead.id },
        })
        .catch((err) =>
          logger.error(`Failed to create LEAD_REMINDER notification for lead ${lead.id}`, err)
        );
      reminded++;
    } else {
      // Sem responsável → notificação in-app para todos os ADMINs ativos do tenant.
      if (adminIds === null) {
        adminIds = await notificationService.getTenantAdminIds(tenantId);
      }
      if (adminIds.length === 0) continue; // ninguém a avisar — tenta na próxima varredura

      for (const adminId of adminIds) {
        await notificationService
          .create(tenantId, {
            userId: adminId,
            type: NotificationType.LEAD_REMINDER,
            title: 'Lead em andamento sem responsável',
            message: `O lead "${lead.name}"${companyName ? ` (${companyName})` : ''} está em andamento há ${daysInProgress} dias e não tem responsável comercial. Atribua um responsável.`,
            link,
            metadata: { leadId: lead.id },
          })
          .catch((err) =>
            logger.error(
              `Failed to create LEAD_REMINDER admin notification for lead ${lead.id}`,
              err
            )
          );
      }
      reminded++;
    }
  }

  return reminded;
}

/**
 * Varredura completa (todos os tenants). Exportada pura para testes — recebe o
 * "agora" opcional e devolve quantos leads foram lembrados no ciclo.
 */
export async function checkLeadReminders(now: Date = new Date()): Promise<number> {
  let reminded = 0;
  try {
    const reminderDays = getReminderDays();
    const windowStart = new Date(now.getTime() - reminderDays * DAY_MS);

    const tenants = await prisma.tenant.findMany({ select: { id: true } });
    for (const tenant of tenants) {
      try {
        reminded += await sweepTenantReminders(tenant.id, now, reminderDays, windowStart);
      } catch (err) {
        logger.error(`Lead reminder sweep failed for tenant ${tenant.id}`, err);
      }
    }

    if (reminded > 0) {
      logger.info(`Lead reminder checker: reminded ${reminded} leads`);
    }
  } catch (error) {
    logger.error('Lead reminder checker failed', error);
  }
  return reminded;
}

// ── Boot (sempre-ativo, sem Redis) ───────────────────────────────────────────

let intervalId: ReturnType<typeof setInterval> | null = null;
let initialTimeoutId: ReturnType<typeof setTimeout> | null = null;

export function startLeadReminderChecker() {
  const intervalMs = getCheckIntervalMs();

  // Atraso inicial de 30s para não competir com o boot do servidor.
  initialTimeoutId = setTimeout(() => {
    checkLeadReminders();
    intervalId = setInterval(() => {
      checkLeadReminders();
    }, intervalMs);
  }, INITIAL_DELAY_MS);

  logger.info(
    `Lead reminder checker initialized (interval: ${intervalMs}ms, window: ${getReminderDays()} days, initial delay: 30s)`
  );
}

export function stopLeadReminderChecker() {
  if (initialTimeoutId) {
    clearTimeout(initialTimeoutId);
    initialTimeoutId = null;
  }
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
