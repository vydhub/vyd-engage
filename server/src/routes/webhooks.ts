import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { paymentService } from '../services/paymentService.js';
import { whatsappMessagingService } from '../services/whatsappMessagingService.js';
import { emailMessagingService } from '../services/emailMessagingService.js';
import { recordBounceByEmail } from '../services/campaignService.js';
import { logger } from '../utils/logger.js';
import prisma from '../config/database.js';
import { safeDecryptConfig } from '../utils/encryption.js';
import { copilotService } from '../services/copilotService.js';
import { isAIEnabled } from '../services/aiProvider.js';

/**
 * Extract bounced recipient emails from a provider webhook payload and record a
 * campaign BOUNCED event for each (req 24). Does not touch unsubscribe state
 * (edge case: bounce on an already-unsubscribed lead must not duplicate
 * UNSUBSCRIBED). Best-effort: never throws into the webhook handler.
 */
async function recordCampaignBounces(provider: string, payload: any): Promise<void> {
  try {
    const emails = new Set<string>();
    if (provider === 'sendgrid' && Array.isArray(payload)) {
      for (const ev of payload) {
        if ((ev?.event === 'bounce' || ev?.event === 'dropped') && ev?.email) {
          emails.add(String(ev.email));
        }
      }
    } else if (provider === 'resend') {
      if (payload?.type === 'email.bounced') {
        const to = payload?.data?.to;
        const list = Array.isArray(to) ? to : to ? [to] : [];
        for (const e of list) emails.add(String(e));
      }
    }
    for (const email of emails) {
      await recordBounceByEmail(email);
    }
  } catch (err: any) {
    logger.error('Failed to record campaign bounces', { provider, err: err?.message });
  }
}

const router = Router();

/**
 * LACUNA #6: dedup de redelivery do Meta por `message.id`. O Meta reentrega o mesmo
 * webhook (mesmo `message.id`) numa janela curta quando não recebe 200 a tempo; sem
 * guarda, o copiloto reprocessa a mensagem (proposta duplicada / reprocesso). Guarda
 * in-memory leve — suficiente para a janela curta de redelivery (BAIXA). Cap de
 * tamanho por FIFO: ao atingir o limite, descarta os `message.id`s mais antigos.
 * Não afeta o fluxo genérico de inbound (só gate do roteamento ao copiloto).
 */
const COPILOT_SEEN_MESSAGE_CAP = 5000;
const copilotSeenMessageIds = new Set<string>();

// Apenas LÊ se o message.id já foi processado com sucesso — NÃO marca. A marcação
// acontece só APÓS handleCopilotMessage retornar com sucesso (ver markCopilotMessageSeen).
// Assim, se o roteamento ao copiloto lançar, o id NÃO fica marcado e uma reentrega
// legítima do Meta é reprocessada (LACUNA #3).
function copilotMessageAlreadySeen(messageId: string): boolean {
  return copilotSeenMessageIds.has(messageId);
}

// Marca o message.id como processado com sucesso. Chamar SOMENTE depois do await
// bem-sucedido de handleCopilotMessage. Cap FIFO: ao atingir o limite, descarta os
// message.id mais antigos (Set preserva ordem de inserção).
function markCopilotMessageSeen(messageId: string): void {
  copilotSeenMessageIds.add(messageId);
  while (copilotSeenMessageIds.size > COPILOT_SEEN_MESSAGE_CAP) {
    const oldest = copilotSeenMessageIds.values().next().value;
    if (oldest === undefined) break;
    copilotSeenMessageIds.delete(oldest);
  }
}

// Validate Mercado Pago webhook signature
function validateMercadoPagoSignature(req: Request): boolean {
  const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
  if (!secret) {
    logger.error('MERCADO_PAGO_WEBHOOK_SECRET not configured — rejecting webhook');
    return false;
  }

  const xSignature = req.headers['x-signature'] as string | undefined;
  const xRequestId = req.headers['x-request-id'] as string | undefined;

  if (!xSignature || !xRequestId) {
    return false;
  }

  // Parse x-signature header (format: "ts=...,v1=...")
  const parts = Object.fromEntries(
    xSignature.split(',').map((part) => {
      const [key, value] = part.split('=');
      return [key.trim(), value.trim()];
    })
  );

  const ts = parts['ts'];
  const v1 = parts['v1'];
  if (!ts || !v1) return false;

  // Build the manifest string per MP docs
  const dataId = (req.query['data.id'] || req.body?.data?.id || '') as string;
  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

  const hmac = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

  // Validate hex string lengths match before timingSafeEqual to prevent length leak
  if (hmac.length !== v1.length) return false;
  return crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(v1, 'hex'));
}

// POST /api/webhooks/mercadopago - Mercado Pago webhook
router.post('/mercadopago', async (req: Request, res: Response) => {
  try {
    // Validate webhook signature
    if (!validateMercadoPagoSignature(req)) {
      logger.warn('Mercado Pago webhook: invalid signature', {
        ip: req.ip,
        headers: { 'x-signature': req.headers['x-signature'] ? '[present]' : '[missing]' },
      });
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    const data = req.body;
    logger.info('Mercado Pago webhook received', { type: data.type });

    await paymentService.handleWebhook(data);

    res.status(200).json({ received: true });
  } catch (error) {
    logger.error('Error processing Mercado Pago webhook', error);
    // Still return 200 to prevent Mercado Pago from retrying
    res
      .status(200)
      .json({ received: true, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ========================
// WhatsApp Webhooks (Meta Business API)
// ========================

// GET /api/webhooks/whatsapp - Meta webhook verification
router.get('/whatsapp', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === verifyToken) {
    logger.info('WhatsApp webhook verified');
    res.status(200).send(challenge);
  } else {
    logger.warn('WhatsApp webhook verification failed', {
      mode,
      tokenMatch: token === verifyToken,
    });
    res.status(403).send('Forbidden');
  }
});

/**
 * Roteamento do Copiloto IA (Upgrade RD P3, req 25).
 *
 * Para conexões marcadas `isCopilot`, mensagens de TEXTO recebidas são roteadas ao
 * `copilotService` em vez de apenas logadas pelo fluxo genérico. Retorna um payload
 * FILTRADO para o `whatsappMessagingService.processWebhook` seguir seu fluxo normal
 * sem duplicar as mensagens já tratadas pelo copiloto (o copiloto grava sua própria
 * Interaction). O filtro contém: os `changes` inteiros de conexões NÃO-copiloto e,
 * para conexões copiloto, um change com `value.statuses` (preserva o tracking de
 * status sent/delivered/read/failed das mensagens enviadas — LACUNA #10), com as
 * `messages` INBOUND de tipo != 'text' (imagem/áudio/documento/vídeo), que o copiloto
 * NÃO trata — assim o fluxo genérico registra a Interaction INBOUND delas e incrementa
 * `messagesReceived` (LACUNA #2), e com os TEXTOS de remetente NÃO autorizado (não
 * cadastrado como `User.whatsappNumber`), que o copiloto só responde "não autorizado"
 * e NÃO loga — reencaminhados para o log passivo (Interaction INBOUND + `messagesReceived`),
 * equiparando o número copiloto a qualquer outro (LACUNA #4). O sinal de remetente não
 * autorizado é o retorno `handled === false` COM `reply != null` de `handleCopilotMessage`.
 * As mensagens de TEXTO de remetentes CONHECIDOS, já tratadas (e logadas) pelo copiloto,
 * são removidas do change reencaminhado (evita Interaction duplicada).
 *
 * Gating: sem `isAIEnabled()`, o roteamento é ignorado (o payload passa inteiro ao
 * fluxo genérico) — nada quebra quando a IA não está configurada.
 *
 * Segurança (LACUNA #3): o copiloto dispara AÇÕES DE ESCRITA no CRM. Só roteamos ao
 * copiloto quando `signatureVerified === true` (WHATSAPP_APP_SECRET presente E HMAC
 * válido nesta requisição). Sem assinatura verificada, o payload passa INTEIRO ao
 * fluxo genérico (log passivo de Interaction, baixo risco) e o copiloto é ignorado —
 * evita que um atacante forje um POST "from" o número de um usuário e dispare escritas.
 */
async function routeCopilotAndFilter(payload: any, signatureVerified: boolean): Promise<any> {
  if (!signatureVerified || !isAIEnabled() || !payload?.entry) return payload;

  // Cache de conexões CONNECTED por phone_number_id (decripta config uma vez).
  const connections = await prisma.whatsAppConnection.findMany({
    where: { status: 'CONNECTED' },
    select: { id: true, tenantId: true, isCopilot: true, config: true },
  });
  const byPhoneId = new Map<string, { id: string; tenantId: string; isCopilot: boolean }>();
  for (const c of connections) {
    // LACUNA #3: o decrypt/parse da config de UMA conexão pode lançar (config
    // corrompida/adulterada). Isolar por conexão para que uma config quebrada não
    // derrube o roteamento do lote inteiro (inclusive inbound de outros tenants no
    // mesmo webhook). Se falhar: pular esta conexão (warn com id/tenant) e seguir.
    try {
      const cfg = safeDecryptConfig(c.config) as any;
      if (cfg?.phoneNumberId) {
        byPhoneId.set(cfg.phoneNumberId, {
          id: c.id,
          tenantId: c.tenantId,
          isCopilot: c.isCopilot,
        });
      }
    } catch (err) {
      logger.warn('Copilot: falha ao decriptar config de conexão WhatsApp — conexão ignorada', {
        connectionId: c.id,
        tenantId: c.tenantId,
        err: (err as any)?.message,
      });
      continue;
    }
  }

  const outEntries: any[] = [];
  for (const entry of payload.entry || []) {
    const outChanges: any[] = [];
    for (const change of entry.changes || []) {
      const phoneNumberId = change?.value?.metadata?.phone_number_id;
      const conn = phoneNumberId ? byPhoneId.get(phoneNumberId) : undefined;

      // Conexão não-copiloto (ou desconhecida) → segue o fluxo genérico.
      if (!conn || !conn.isCopilot) {
        outChanges.push(change);
        continue;
      }

      // Conexão copiloto: roteia mensagens de TEXTO ao copiloto e separa as
      // mensagens INBOUND de tipo != 'text' (que o copiloto NÃO trata) para
      // reencaminhar ao fluxo genérico (LACUNA #2).
      const messages = change?.value?.messages || [];
      const forwardMessages: any[] = [];
      for (const message of messages) {
        // LACUNA #2: mensagens INBOUND não-texto (imagem/áudio/documento/vídeo) o
        // copiloto não trata. Reencaminha ao fluxo genérico para que o
        // processWebhook registre a Interaction INBOUND ('[Imagem recebida]' etc.)
        // e incremente `messagesReceived`.
        if (message?.type !== 'text') {
          forwardMessages.push(message);
          continue;
        }
        // LACUNA #6: pula redelivery do Meta (mesmo message.id já PROCESSADO COM
        // SUCESSO) para não reprocessar a mensagem no copiloto. Só aplica ao
        // roteamento do copiloto; o fluxo genérico de inbound é preservado (statuses
        // seguem intactos). LACUNA #3: aqui apenas LEMOS o Set — a marcação ocorre só
        // após o await bem-sucedido de handleCopilotMessage. Se o roteamento lançar, o
        // id NÃO é marcado, para que uma reentrega legítima do Meta seja reprocessada.
        const messageId = message?.id;
        const trackMessageId = typeof messageId === 'string' && messageId.length > 0;
        if (trackMessageId && copilotMessageAlreadySeen(messageId)) {
          logger.info('Copilot: message.id já processado (redelivery do Meta) — ignorado', {
            messageId,
            tenantId: conn.tenantId,
          });
          continue;
        }
        const from = message.from;
        const text = message.text?.body || '';
        try {
          const result = await copilotService.handleCopilotMessage(conn.tenantId, conn, from, text);
          // LACUNA #3: só marca o message.id como visto APÓS o handleCopilotMessage
          // retornar com sucesso. Se lançar (catch abaixo), o id fica NÃO marcado e a
          // reentrega do Meta é reprocessada em vez de silenciosamente descartada.
          if (trackMessageId) {
            markCopilotMessageSeen(messageId);
          }
          // LACUNA #4: preservar o LOG PASSIVO de inbound também no número do copiloto
          // para textos de remetente NÃO autorizado. O copiloto só responde "não
          // autorizado" a números desconhecidos (não cadastrados como
          // User.whatsappNumber) e NÃO grava Interaction para eles — divergindo de
          // qualquer número não-copiloto (onde toda mensagem recebida é logada). Como o
          // webhook não resolve o usuário nesta camada, delegamos a decisão ao retorno
          // de `handleCopilotMessage`: um remetente NÃO reconhecido é o ÚNICO caso que
          // devolve `handled === false` COM `reply != null` (a resposta de "não
          // autorizado"). Nesse caso, reencaminhamos o texto ao fluxo genérico SOMENTE
          // para o registro passivo (Interaction INBOUND + `messagesReceived`). Textos
          // de remetentes CONHECIDOS (handled === true, ou os casos handled === false
          // com reply === null: IA não configurada / modelo indisponível) NÃO são
          // reencaminhados — evita Interaction duplicada com a que o copiloto grava.
          if (result && result.handled === false && result.reply != null) {
            forwardMessages.push(message);
          }
        } catch (err) {
          logger.error('Copilot: erro ao rotear mensagem', err as any);
        }
      }

      // Reencaminha ao fluxo genérico um change com:
      //  - as `messages` INBOUND de tipo != 'text' (LACUNA #2) — que o copiloto não
      //    trata, para que o processWebhook registre a Interaction INBOUND delas;
      //  - os textos de remetente NÃO autorizado (LACUNA #4) — para o log passivo;
      //  - os `statuses` (sent/delivered/read/failed) das mensagens ENVIADAS pela
      //    conexão-copiloto (LACUNA #10) — para manter o tracking de status.
      // As mensagens de TEXTO de remetentes conhecidos, já tratadas pelo copiloto, são
      // OMITIDAS (evita Interaction duplicada). Só reencaminha quando há algo a processar.
      const statuses = change?.value?.statuses || [];
      const hasStatuses = Array.isArray(statuses) && statuses.length > 0;
      if (forwardMessages.length > 0 || hasStatuses) {
        const { messages: _omitMessages, ...valueWithoutMessages } = change.value;
        const filteredValue: any = { ...valueWithoutMessages };
        if (forwardMessages.length > 0) {
          filteredValue.messages = forwardMessages;
        }
        outChanges.push({ ...change, value: filteredValue });
      }
    }
    if (outChanges.length > 0) {
      outEntries.push({ ...entry, changes: outChanges });
    }
  }

  return { ...payload, entry: outEntries };
}

// POST /api/webhooks/whatsapp - Incoming WhatsApp messages & status updates
router.post('/whatsapp', async (req: Request, res: Response) => {
  try {
    // Rastreia se a assinatura foi VERIFICADA nesta requisição (appSecret presente
    // E HMAC válido). Gate do caminho de ESCRITA (copiloto) — ver LACUNA #3.
    let signatureVerified = false;

    // Validate signature if secret is configured
    const appSecret = process.env.WHATSAPP_APP_SECRET;
    if (appSecret) {
      const signature = req.headers['x-hub-signature-256'] as string | undefined;
      if (!signature) {
        logger.warn('WhatsApp webhook: missing signature');
        res.status(401).json({ error: 'Missing signature' });
        return;
      }

      // HMAC computado sobre o corpo CRU (req.rawBody, capturado no verify do
      // express.json em index.ts) — os bytes EXATOS recebidos do Meta, senão o
      // HMAC não bate e payloads legítimos são rejeitados. Espelha o ZapSign.
      const raw =
        (req as Request & { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {});
      const expectedSignature =
        'sha256=' + crypto.createHmac('sha256', appSecret).update(raw).digest('hex');

      // Guarda de comprimento antes de timingSafeEqual: um header forjado de
      // tamanho diferente lançaria RangeError (cairia no catch → 200). Espelha o
      // cuidado de validateMercadoPagoSignature.
      const sigBuf = Buffer.from(signature);
      const expBuf = Buffer.from(expectedSignature);
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        logger.warn('WhatsApp webhook: invalid signature');
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }

      // Assinatura verificada com sucesso → caminho de escrita (copiloto) liberado.
      signatureVerified = true;
    } else {
      // LACUNA #3: sem WHATSAPP_APP_SECRET não há como autenticar o remetente. O log
      // passivo de inbound (Interaction) segue como hoje (baixo risco), mas o copiloto
      // (AÇÕES DE ESCRITA no CRM) NÃO é roteado — evita escritas forjadas por atacante.
      logger.warn('WhatsApp webhook: copiloto exige WHATSAPP_APP_SECRET — roteamento ao copiloto ignorado');
    }

    logger.info('WhatsApp webhook received', { object: req.body?.object });

    // Copiloto IA (req 25): roteia mensagens de conexões `isCopilot` e devolve um
    // payload filtrado (sem os changes já tratados pelo copiloto) ao fluxo genérico.
    // Assíncrono — sempre retorna 200 rápido. O roteamento ao copiloto só ocorre
    // quando a assinatura foi verificada (LACUNA #3); senão o payload passa inteiro.
    // Parceiros (PRM): mensagens de CONSULTORES cadastrados viram registro/update
    // de oportunidade (mesmo contrato filter-forward; escrita só com assinatura
    // verificada). O que o hook não tratar segue ao fluxo genérico — nada se perde.
    routeCopilotAndFilter(req.body, signatureVerified)
      .then(async (filtered) => {
        const { routeParceiroAndFilter } = await import('../services/parceiros/whatsappHook.js');
        return routeParceiroAndFilter(filtered, signatureVerified);
      })
      .then((filtered) => whatsappMessagingService.processWebhook(filtered))
      .catch((error) => {
        logger.error('Error processing WhatsApp webhook async', error);
      });

    res.status(200).json({ received: true });
  } catch (error) {
    logger.error('Error handling WhatsApp webhook', error);
    res.status(200).json({ received: true });
  }
});

// ========================
// Email Webhooks (SendGrid, Resend, etc.)
// ========================

// ========================
// Email Webhook Signature Validators
// ========================

/**
 * SendGrid Event Webhook — ECDSA verification.
 * https://docs.sendgrid.com/for-developers/tracking-events/getting-started-event-webhook-security-features
 * Fail-closed: rejects if SENDGRID_WEBHOOK_VERIFICATION_KEY is not configured.
 */
function validateSendGridWebhook(req: Request): boolean {
  const publicKey = process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY;
  if (!publicKey) {
    logger.warn('SENDGRID_WEBHOOK_VERIFICATION_KEY not configured — rejecting SendGrid webhook');
    return false;
  }

  const timestamp = req.headers['x-twilio-email-event-webhook-timestamp'] as string | undefined;
  const signature = req.headers['x-twilio-email-event-webhook-signature'] as string | undefined;
  if (!timestamp || !signature) return false;

  // Verify ECDSA signature over (timestamp + body). Uses JSON.stringify as the
  // payload proxy since Express pre-parses the body — accuracy depends on
  // SendGrid sending canonical JSON. For maximum accuracy, configure raw body
  // capture middleware before express.json() on this route.
  try {
    const payload = timestamp + JSON.stringify(req.body);
    const verify = crypto.createVerify('SHA256');
    verify.update(payload);
    return verify.verify(publicKey, signature, 'base64');
  } catch {
    return false;
  }
}

/**
 * Resend Webhook — Svix HMAC-SHA256 verification.
 * https://resend.com/docs/dashboard/webhooks/introduction
 * Fail-closed: rejects if RESEND_WEBHOOK_SECRET is not configured.
 */
function validateResendWebhook(req: Request): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    logger.warn('RESEND_WEBHOOK_SECRET not configured — rejecting Resend webhook');
    return false;
  }

  const svixId = req.headers['svix-id'] as string | undefined;
  const svixTimestamp = req.headers['svix-timestamp'] as string | undefined;
  const svixSignature = req.headers['svix-signature'] as string | undefined;
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  // Svix signs over "${svix-id}.${svix-timestamp}.${raw-body}".
  // Using JSON.stringify(body) as proxy (see note in validateSendGridWebhook).
  try {
    const rawSecret = secret.startsWith('whsec_')
      ? Buffer.from(secret.slice(6), 'base64')
      : Buffer.from(secret);
    const toSign = `${svixId}.${svixTimestamp}.${JSON.stringify(req.body)}`;
    const hmac = crypto.createHmac('sha256', rawSecret).update(toSign).digest('base64');
    const expected = `v1,${hmac}`;
    // svix-signature may contain multiple space-separated versions
    return svixSignature.split(' ').some((sig) => {
      if (sig.length !== expected.length) return false;
      return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    });
  } catch {
    return false;
  }
}

// POST /api/webhooks/email/sendgrid - SendGrid event webhook
router.post('/email/sendgrid', async (req: Request, res: Response) => {
  try {
    if (!validateSendGridWebhook(req)) {
      logger.warn('SendGrid webhook: invalid or missing signature', { ip: req.ip });
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    logger.info('SendGrid webhook received');
    emailMessagingService.processWebhook('sendgrid', req.body).catch((error) => {
      logger.error('Error processing SendGrid webhook', error);
    });
    // Campaign bounce tracking (req 24) — best-effort, async.
    recordCampaignBounces('sendgrid', req.body).catch(() => {});
    res.status(200).json({ received: true });
  } catch (error) {
    logger.error('Error handling SendGrid webhook', error);
    res.status(200).json({ received: true });
  }
});

// POST /api/webhooks/email/resend - Resend event webhook
router.post('/email/resend', async (req: Request, res: Response) => {
  try {
    if (!validateResendWebhook(req)) {
      logger.warn('Resend webhook: invalid or missing signature', { ip: req.ip });
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    logger.info('Resend webhook received', { type: req.body?.type });
    emailMessagingService.processWebhook('resend', req.body).catch((error) => {
      logger.error('Error processing Resend webhook', error);
    });
    // Campaign bounce tracking (req 24) — best-effort, async.
    recordCampaignBounces('resend', req.body).catch(() => {});
    res.status(200).json({ received: true });
  } catch (error) {
    logger.error('Error handling Resend webhook', error);
    res.status(200).json({ received: true });
  }
});

// ========================
// ZapSign Webhook (assinatura eletrônica — Upgrade RD P2, req 19)
// ========================

// POST /api/webhooks/zapsign — status de assinatura (público, sem CSRF).
// Identifica o tenant pelo envelopeId (Proposal.signatureEnvelopeId) e valida o
// HMAC com o webhookSecret DESSE tenant (feito dentro do signatureService). A
// assinatura é computada sobre o corpo CRU (req.rawBody, capturado no verify do
// express.json em index.ts) — os bytes EXATOS recebidos, para o HMAC bater com o
// provedor. Fallback para JSON.stringify(req.body) se rawBody não estiver presente.
router.post('/zapsign', async (req: Request, res: Response) => {
  try {
    const { signatureService } = await import('../services/signatureService.js');
    const rawBody =
      (req as Request & { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {});
    const headerSignature =
      (req.headers['x-zapsign-signature'] as string | undefined) ||
      (req.headers['x-signature'] as string | undefined) ||
      (req.headers['x-hub-signature-256'] as string | undefined);

    const result = await signatureService.handleWebhook(rawBody, headerSignature);
    if (!result.handled) {
      logger.info('ZapSign webhook não processado', { reason: result.reason });
    }
    // Sempre 200 para não provocar retry do provedor em casos não-acionáveis.
    res.status(200).json({ received: true });
  } catch (error) {
    logger.error('Erro ao processar webhook ZapSign', error);
    res.status(200).json({ received: true });
  }
});

// ========================
// Lead Capture Webhook (public, authenticated via API key)
// ========================

// POST /api/webhooks/capture/:apiKey - Capture leads from external systems
router.post('/capture/:apiKey', async (req: Request, res: Response) => {
  try {
    const { apiKey } = req.params;
    if (!apiKey) {
      res.status(400).json({ error: 'API key required' });
      return;
    }

    // Find API key and resolve tenant
    const { default: prisma } = await import('../config/database.js');
    const { default: bcrypt } = await import('bcryptjs');

    // API keys are stored with hash — we need to find by iterating active keys
    const activeKeys = await prisma.apiKey.findMany({
      where: { active: true },
      select: { id: true, tenantId: true, keyHash: true },
    });

    let tenantId: string | null = null;
    let keyId: string | null = null;

    for (const key of activeKeys) {
      const match = await bcrypt.compare(apiKey, key.keyHash);
      if (match) {
        tenantId = key.tenantId;
        keyId = key.id;
        break;
      }
    }

    if (!tenantId || !keyId) {
      res.status(401).json({ error: 'Invalid API key' });
      return;
    }

    // Update last used
    await prisma.apiKey.update({
      where: { id: keyId },
      data: { lastUsedAt: new Date() },
    });

    // Parse lead data — flexible format
    const body = req.body;
    const name = body.name || body.nome || body.full_name || body.fullName || 'Lead via Webhook';
    const email = body.email || body.e_mail || null;
    const phone = body.phone || body.telefone || body.whatsapp || body.cel || null;
    const company = body.company || body.empresa || body.organization || null;
    const position = body.position || body.cargo || body.job_title || null;
    const notes = body.notes || body.observacao || body.message || body.mensagem || null;
    const source = body.source || 'OTHER';

    // Map source strings to enum values
    const sourceMap: Record<string, string> = {
      website: 'WEBSITE',
      social_media: 'SOCIAL_MEDIA',
      referral: 'REFERRAL',
      email: 'EMAIL',
      phone: 'PHONE',
      other: 'OTHER',
    };
    const leadSource = sourceMap[String(source).toLowerCase()] || 'OTHER';

    // Create lead
    const { leadService } = await import('../services/leadService.js');
    const lead = await leadService.create(tenantId, {
      name,
      email,
      phone,
      company,
      position,
      notes,
      source: leadSource as any,
    });

    logger.info('Lead captured via webhook', { tenantId, leadId: lead.id, source: 'webhook' });

    res.status(201).json({
      success: true,
      data: { id: lead.id, name: lead.name },
    });
  } catch (error) {
    logger.error('Error processing capture webhook', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
