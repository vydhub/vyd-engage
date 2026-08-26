// Hook de WhatsApp do módulo de Parceiros (req 8): mensagens recebidas do número
// cadastrado de um CONSULTOR podem virar registro de oportunidade ("REGISTRO ...")
// ou atualização de progresso ("UPDATE ..."). Segue o contrato filter-forward do
// copiloto: trata+loga OU reencaminha ao fluxo genérico — nunca ambos, nunca nenhum;
// statuses SEMPRE reencaminhados. Escrita só com assinatura HMAC verificada.
// Sem WhatsApp configurado, nada acontece (o portal segue como único canal).

import prisma from '../../config/database.js';
import { logger } from '../../utils/logger.js';
import { safeDecryptConfig } from '../../utils/encryption.js';
import { consultorService } from './consultorService.js';
import { registroService } from './registroService.js';

// Dedup de redelivery do Meta (message.id). O Set em memória é só um cache rápido
// (não sobrevive a restart); a fonte de verdade é a Interaction gravada ao tratar,
// consultada por metadata.parceiroHook=true + metadata.msgId=<id> (idempotente).
const seen = new Set<string>();
const SEEN_CAP = 2000;
function markSeen(id: string) {
  if (seen.size >= SEEN_CAP) {
    const first = seen.values().next().value;
    if (first) seen.delete(first);
  }
  seen.add(id);
}

/** true se esta mensagem (msgId) já foi tratada e persistida como Interaction. */
async function alreadyHandled(tenantId: string, msgId: string): Promise<boolean> {
  if (seen.has(msgId)) return true;
  try {
    const existing = await prisma.interaction.findFirst({
      where: {
        tenantId,
        metadata: { path: ['parceiroHook'], equals: true },
        AND: [{ metadata: { path: ['msgId'], equals: msgId } }],
      },
      select: { id: true },
    });
    if (existing) {
      markSeen(msgId); // reaquece o cache para o próximo redelivery
      return true;
    }
  } catch (err) {
    // Falha na checagem persistente não deve derrubar o lote; cai no cache em memória.
    logger.warn('Parceiros/WhatsApp: falha ao checar dedup persistente', { err: (err as Error)?.message });
  }
  return false;
}

/** Marca o consultor ativo como tendo atividade recente (best-effort). */
async function touchConsultorActivity(consultorId: string): Promise<void> {
  await prisma.consultor
    .update({ where: { id: consultorId }, data: { ultimaAtividadeEm: new Date() } })
    .catch((err) => logger.warn('Parceiros/WhatsApp: falha ao atualizar ultimaAtividadeEm', { err: (err as Error)?.message }));
}

async function reply(tenantId: string, connectionId: string, to: string, content: string): Promise<void> {
  try {
    const { whatsappMessagingService } = await import('../whatsappMessagingService.js');
    await whatsappMessagingService.sendMessage(tenantId, { connectionId, to, type: 'text', content });
  } catch (err) {
    logger.warn('Parceiros/WhatsApp: falha ao responder consultor', { err: (err as Error)?.message });
  }
}

/**
 * Grava a Interaction do inbound tratado (nada se perde — caso extremo da spec).
 * O msgId é persistido em metadata para o dedup idempotente (sobrevive a restart).
 */
async function recordInbound(
  tenantId: string,
  consultorId: string,
  from: string,
  text: string,
  msgId?: string
): Promise<void> {
  await prisma.interaction
    .create({
      data: {
        tenantId,
        type: 'WHATSAPP',
        direction: 'INBOUND',
        content: text,
        metadata: { parceiroHook: true, consultorId, from, ...(msgId ? { msgId } : {}) },
      },
    })
    .catch((err) => logger.error('Parceiros/WhatsApp: falha ao gravar interaction', err));
}

/**
 * Trata uma mensagem de texto de um consultor. Retorna true quando TRATOU
 * (a mensagem sai do payload); false reencaminha ao fluxo genérico.
 */
async function handleConsultorText(
  tenantId: string,
  connectionId: string,
  consultorId: string,
  consultorUserId: string,
  from: string,
  text: string,
  msgId?: string
): Promise<boolean> {
  const registroMatch = text.match(/^registro[:\s]+([\s\S]+)/i);
  if (registroMatch) {
    const corpo = registroMatch[1].trim();
    // Formato: "REGISTRO Cliente X | descrição da demanda" (ou quebra de linha).
    const sep = corpo.includes('|') ? '|' : '\n';
    const [clienteParte, ...resto] = corpo.split(sep);
    const clienteNome = clienteParte.trim().slice(0, 200);
    const descricao = resto.join(sep).trim() || clienteNome;
    if (!clienteNome) return false;
    try {
      await registroService.create(tenantId, consultorId, { clienteNome, descricao });
      await recordInbound(tenantId, consultorId, from, text, msgId);
      await reply(
        tenantId,
        connectionId,
        from,
        `✅ Oportunidade "${clienteNome}" registrada e enviada para aprovação. Acompanhe pelo portal.`
      );
      return true;
    } catch (err) {
      logger.warn('Parceiros/WhatsApp: falha ao registrar via WhatsApp', { err: (err as Error)?.message });
      await reply(tenantId, connectionId, from, `Não consegui registrar: ${(err as Error)?.message ?? 'erro'}. Use o portal.`);
      await recordInbound(tenantId, consultorId, from, text, msgId);
      return true;
    }
  }

  const updateMatch = text.match(/^update[:\s]+([\s\S]+)/i);
  if (updateMatch) {
    const texto = updateMatch[1].trim();
    const ativos = await prisma.registroOportunidade.findMany({
      where: { tenantId, consultorId, deletedAt: null, status: 'APROVADO' },
      select: { id: true, clienteNome: true },
    });
    if (ativos.length === 1) {
      try {
        await registroService.addUpdate(tenantId, ativos[0].id, consultorUserId, texto);
        await recordInbound(tenantId, consultorId, from, text, msgId);
        await reply(tenantId, connectionId, from, `✅ Atualização registrada em "${ativos[0].clienteNome}". Obrigado!`);
        return true;
      } catch (err) {
        logger.warn('Parceiros/WhatsApp: falha no update via WhatsApp', { err: (err as Error)?.message });
      }
    } else {
      await recordInbound(tenantId, consultorId, from, text, msgId);
      await reply(
        tenantId,
        connectionId,
        from,
        ativos.length === 0
          ? 'Você não tem oportunidades aprovadas no momento — registre uma com "REGISTRO Cliente | descrição".'
          : `Você tem ${ativos.length} oportunidades ativas — atualize pelo portal para escolher qual.`
      );
      return true;
    }
  }

  // Texto livre de consultor → reencaminha ao fluxo genérico (inbox), nada se perde.
  return false;
}

/**
 * Intercepta o payload do webhook Meta: mensagens de TEXTO cujo remetente casa
 * (match ÚNICO) com um Consultor ATIVO são tratadas aqui e removidas do payload.
 * Tudo o mais (statuses, não-texto, remetentes desconhecidos) é reencaminhado.
 */
export async function routeParceiroAndFilter(payload: any, signatureVerified: boolean): Promise<any> {
  if (!signatureVerified || !payload?.entry) return payload;

  // Resolve tenant/conexão por phone_number_id (mesmo padrão do copiloto).
  const connections = await prisma.whatsAppConnection.findMany({
    where: { status: 'CONNECTED' },
    select: { id: true, tenantId: true, config: true },
  });
  const byPhoneId = new Map<string, { id: string; tenantId: string }>();
  for (const c of connections) {
    try {
      const cfg = safeDecryptConfig(c.config) as { phoneNumberId?: string } | null;
      if (cfg?.phoneNumberId) byPhoneId.set(cfg.phoneNumberId, { id: c.id, tenantId: c.tenantId });
    } catch {
      continue; // config corrompida não derruba o lote
    }
  }
  if (byPhoneId.size === 0) return payload;

  const outEntries: any[] = [];
  for (const entry of payload.entry || []) {
    const outChanges: any[] = [];
    for (const change of entry.changes || []) {
      if (change?.field !== 'messages') {
        outChanges.push(change);
        continue;
      }
      const phoneNumberId = change?.value?.metadata?.phone_number_id;
      const conn = phoneNumberId ? byPhoneId.get(phoneNumberId) : undefined;
      const messages: any[] = change?.value?.messages ?? [];
      if (!conn || messages.length === 0) {
        outChanges.push(change); // statuses/desconhecidos seguem o fluxo genérico
        continue;
      }

      const keptMessages: any[] = [];
      for (const msg of messages) {
        const isText = msg?.type === 'text' && typeof msg?.text?.body === 'string';
        const msgId: string | undefined = msg?.id;
        if (!isText) {
          keptMessages.push(msg);
          continue;
        }
        // Dedup idempotente: se este msgId já foi tratado (persistido), DESCARTA —
        // não reencaminha ao fluxo genérico (evita duplicar Interaction no redelivery).
        if (msgId && (await alreadyHandled(conn.tenantId, msgId))) {
          continue;
        }
        const from: string = String(msg?.from ?? '');
        const consultor = await consultorService.resolveByPhone(conn.tenantId, from).catch(() => null);
        if (!consultor) {
          keptMessages.push(msg); // número não reconhecido → inbox normal
          continue;
        }
        // Remetente = consultor ATIVO: TODA mensagem inbound dele conta como atividade,
        // inclusive texto livre reencaminhado e comandos que falham (0 ou >1 registros).
        await touchConsultorActivity(consultor.id);
        try {
          const handled = await handleConsultorText(
            conn.tenantId,
            conn.id,
            consultor.id,
            consultor.userId,
            from,
            msg.text.body,
            msgId
          );
          if (handled) {
            if (msgId) markSeen(msgId);
          } else {
            keptMessages.push(msg);
          }
        } catch (err) {
          logger.error('Parceiros/WhatsApp: erro no hook — mensagem reencaminhada', err as Error);
          keptMessages.push(msg);
        }
      }

      // Preserva o change se sobraram mensagens OU se o value tem outros campos
      // relevantes (statuses SEMPRE reencaminhados; errors também não podem se perder).
      const hasStatuses = (change?.value?.statuses ?? []).length > 0;
      const hasErrors = (change?.value?.errors ?? []).length > 0;
      if (keptMessages.length === messages.length) {
        outChanges.push(change);
      } else if (keptMessages.length > 0) {
        outChanges.push({ ...change, value: { ...change.value, messages: keptMessages } });
      } else if (hasStatuses || hasErrors) {
        outChanges.push({ ...change, value: { ...change.value, messages: [] } });
      }
      // change sem mensagens restantes e sem statuses/errors → totalmente tratado, sai.
    }
    if (outChanges.length > 0) outEntries.push({ ...entry, changes: outChanges });
  }
  return { ...payload, entry: outEntries };
}
