// Notificação multicanal do módulo de Parceiros: in-app (sempre) + e-mail
// (best-effort) + WhatsApp quando o tenant tem conexão CONNECTED (gated,
// best-effort) — reqs 26/36 ('in-app + e-mail; WhatsApp quando configurado').
// "Nunca silêncio": falha de canal externo é logada, nunca derruba a operação.

import type { NotificationType } from '@prisma/client';
import prisma from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { notificationService } from '../notificationService.js';

const FRONTEND = () => process.env.FRONTEND_URL || 'https://engage.vydhub.com';

export interface NotifyParceiroInput {
  userIds: string[];
  type: NotificationType;
  title: string;
  message: string;
  /** Caminho relativo (ex.: '/app/parceiros' ou '/portal'). */
  link?: string;
  metadata?: unknown;
  /** Também enviar WhatsApp a estes consultores (telefoneDigits). */
  whatsappConsultorIds?: string[];
  /** Não enviar e-mail (ex.: eventos de altíssima frequência). Default: envia. */
  skipEmail?: boolean;
}

async function sendEmails(tenantId: string, userIds: string[], title: string, message: string, link?: string) {
  try {
    const users = await prisma.user.findMany({
      where: { tenantId, id: { in: [...new Set(userIds)] }, status: 'ACTIVE' },
      select: { email: true, name: true },
    });
    if (users.length === 0) return;
    const { sendEmail, emailTemplates } = await import('../emailService.js');
    const ctaUrl = link ? `${FRONTEND()}${link}` : undefined;
    const tmpl = await emailTemplates.parceiroNotificacao(title, [message], ctaUrl);
    await Promise.all(
      users.map((u) =>
        sendEmail({ to: u.email, subject: tmpl.subject, html: tmpl.html }).catch((err) =>
          logger.warn('Parceiros/e-mail: falha ao enviar', { err: (err as Error)?.message })
        )
      )
    );
  } catch (err) {
    logger.warn('Parceiros/e-mail: falha geral', { err: (err as Error)?.message });
  }
}

async function sendWhatsApps(tenantId: string, consultorIds: string[], message: string) {
  try {
    const connection = await prisma.whatsAppConnection.findFirst({
      where: { tenantId, status: 'CONNECTED' },
      select: { id: true },
    });
    if (!connection) return; // gate: sem conexão, sem erro (degrada em silêncio no canal)
    const consultores = await prisma.consultor.findMany({
      where: { tenantId, id: { in: [...new Set(consultorIds)] }, deletedAt: null, telefoneDigits: { not: null } },
      select: { telefoneDigits: true },
    });
    if (consultores.length === 0) return;
    const { whatsappMessagingService } = await import('../whatsappMessagingService.js');
    await Promise.all(
      consultores.map((c) =>
        whatsappMessagingService
          .sendMessage(tenantId, { connectionId: connection.id, to: c.telefoneDigits as string, type: 'text', content: message })
          .catch((err) => logger.warn('Parceiros/WhatsApp: falha ao enviar notificação', { err: (err as Error)?.message }))
      )
    );
  } catch (err) {
    logger.warn('Parceiros/WhatsApp: falha geral', { err: (err as Error)?.message });
  }
}

/**
 * Notifica um conjunto de usuários por in-app + e-mail (+ WhatsApp aos consultores
 * indicados). O in-app é aguardado; e-mail/WhatsApp são disparados best-effort.
 */
export async function notifyParceiro(tenantId: string, input: NotifyParceiroInput): Promise<void> {
  const userIds = [...new Set(input.userIds)].filter(Boolean);
  for (const userId of userIds) {
    await notificationService
      .create(tenantId, {
        userId,
        type: input.type,
        title: input.title,
        message: input.message,
        link: input.link,
        metadata: input.metadata as never,
      })
      .catch((err) => logger.error('Parceiros: falha ao criar notificação in-app', err));
  }
  if (!input.skipEmail && userIds.length > 0) {
    await sendEmails(tenantId, userIds, input.title, input.message, input.link);
  }
  if (input.whatsappConsultorIds && input.whatsappConsultorIds.length > 0) {
    await sendWhatsApps(tenantId, input.whatsappConsultorIds, `${input.title}\n\n${input.message}`);
  }
}
