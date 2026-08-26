/**
 * signatureService — assinatura eletrônica plugável, GATED (Upgrade RD P2, req 19).
 *
 * Primeiro provedor: ZapSign (https://docs.zapsign.com.br). O envio cria um
 * documento a partir do PDF da proposta (base64) e um signatário; o provedor
 * devolve um token de envelope que guardamos em `Proposal.signatureEnvelopeId`.
 * O acompanhamento de status vem por webhook (POST /webhooks/zapsign), validado
 * por HMAC com o `webhookSecret` do tenant.
 *
 * GATING: sem `IntegrationConfig` kind=SIGNATURE, `sendForSignature` lança
 * 400 SIGNATURE_NOT_CONFIGURED e a UI oculta o recurso.
 *
 * SEGURANÇA: toda chamada externa passa por `assertPublicHttpUrl` (anti-SSRF)
 * + timeout via AbortController. O PDF é lido pelo storageService (provider "db").
 *
 * NOTA: não temos conta ZapSign neste ambiente; o cliente segue a API pública
 * documentada e é exercido nos testes com `fetch` MOCKADO.
 */
import type { SignatureStatus } from '@prisma/client';
import prisma from '../config/database.js';
import crypto from 'crypto';
import { createError } from '../middleware/errorHandler.js';
import { assertPublicHttpUrl } from '../utils/safeFetch.js';
import { integrationService, type SignatureConfig } from './integrationService.js';
import { storageService } from './storageService.js';
import { notificationService } from './notificationService.js';
import { NotificationType } from '@prisma/client';
import { logger } from '../utils/logger.js';

const ZAPSIGN_BASE_URL = 'https://api.zapsign.com.br/api/v1';
const REQUEST_TIMEOUT_MS = 15000;

/** fetch com timeout + validação anti-SSRF do destino. */
async function safeFetchJson(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<{ ok: boolean; status: number; body: any }> {
  await assertPublicHttpUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Mapeia o `status` textual do ZapSign para o nosso enum SignatureStatus.
 * ZapSign usa: signed / refused / pending / new / expired; eventos de webhook
 * incluem doc_signed, doc_refused, doc_viewed, etc. Cobrimos ambos.
 */
function mapZapSignStatus(raw: string | undefined | null): SignatureStatus | null {
  const s = String(raw ?? '')
    .toLowerCase()
    .trim();
  if (!s) return null;
  if (s.includes('sign')) return 'SIGNED';
  if (s.includes('refus') || s.includes('reject') || s.includes('cancel')) return 'REFUSED';
  if (s.includes('view') || s.includes('open')) return 'VIEWED';
  if (s.includes('expir')) return 'EXPIRED';
  if (s === 'new' || s === 'pending' || s.includes('sent')) return 'SENT';
  return null;
}

/**
 * Texto pt-BR do evento de assinatura para a timeline do deal, por status.
 * SENT é omitido aqui (já registrado no envio). Retorna null para status sem
 * evento acionável na timeline.
 */
function signatureTimelineText(status: SignatureStatus, version: number): string | null {
  switch (status) {
    case 'VIEWED':
      return `Proposta v${version} visualizada pelo destinatário.`;
    case 'SIGNED':
      return `Proposta v${version} assinada eletronicamente.`;
    case 'REFUSED':
      return `Proposta v${version} recusada pelo destinatário.`;
    case 'EXPIRED':
      return `Proposta v${version} expirada sem assinatura.`;
    default:
      return null; // SENT (registrado no envio) e demais
  }
}

export const signatureService = {
  mapZapSignStatus,

  /** True quando o tenant tem credencial de assinatura ativa. */
  async isConfigured(tenantId: string): Promise<boolean> {
    return (await integrationService.getConfig<SignatureConfig>(tenantId, 'SIGNATURE')) !== null;
  },

  /**
   * Cria um documento/envelope ZapSign a partir de um PDF genérico (sem acoplar a
   * Proposal). Usado pelo NDA do módulo de Parceiros. Retorna o envelopeId.
   * Sem credencial → 400 SIGNATURE_NOT_CONFIGURED (mesmo gate do sendForSignature).
   */
  async createEnvelope(
    tenantId: string,
    doc: { name: string; pdfBuffer: Buffer; signerName: string; signerEmail: string }
  ): Promise<string> {
    const config = await integrationService.getConfig<SignatureConfig>(tenantId, 'SIGNATURE');
    if (!config) {
      throw createError(
        'Assinatura eletrônica não configurada para este tenant.',
        400,
        'SIGNATURE_NOT_CONFIGURED'
      );
    }
    const { ok, status, body } = await safeFetchJson(`${ZAPSIGN_BASE_URL}/docs/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: doc.name,
        base64_pdf: doc.pdfBuffer.toString('base64'),
        signers: [{ name: doc.signerName, email: doc.signerEmail }],
        lang: 'pt-br',
      }),
    });
    if (!ok) {
      logger.warn('ZapSign send failed (envelope)', { status, tenantId });
      throw createError('Falha ao enviar o documento para assinatura no provedor.', 502, 'SIGNATURE_PROVIDER_ERROR', {
        providerStatus: status,
      });
    }
    const envelopeId: string | undefined = body?.token || body?.doc?.token || body?.id;
    if (!envelopeId) {
      throw createError('Provedor de assinatura não retornou um identificador de envelope.', 502, 'SIGNATURE_PROVIDER_ERROR');
    }
    return envelopeId;
  },

  /**
   * Envia a proposta gerada (PDF) para assinatura via ZapSign.
   * - Sem credencial → 400 SIGNATURE_NOT_CONFIGURED.
   * - Proposta inexistente/de outro tenant → 404.
   * Grava `signatureEnvelopeId` + `signatureStatus=SENT` e retorna a Proposal.
   */
  async sendForSignature(
    tenantId: string,
    proposalId: string,
    signer: { signerEmail: string; signerName: string }
  ) {
    const config = await integrationService.getConfig<SignatureConfig>(tenantId, 'SIGNATURE');
    if (!config) {
      throw createError(
        'Assinatura eletrônica não configurada para este tenant.',
        400,
        'SIGNATURE_NOT_CONFIGURED'
      );
    }

    const proposal = await prisma.proposal.findFirst({
      where: { id: proposalId, tenantId },
      include: { attachment: true },
    });
    if (!proposal || !proposal.attachment) {
      throw createError('Proposta não encontrada.', 404, 'PROPOSAL_NOT_FOUND');
    }

    // Lê o PDF do storage e envia como base64 (ZapSign aceita base64_pdf).
    const pdfBuffer = await storageService.get(proposal.attachment);
    const base64Pdf = pdfBuffer.toString('base64');

    const url = `${ZAPSIGN_BASE_URL}/docs/`;
    const payload = {
      name: proposal.attachment.name,
      base64_pdf: base64Pdf,
      signers: [{ name: signer.signerName, email: signer.signerEmail }],
      // não redirecionar/branding — mínimo necessário
      lang: 'pt-br',
    };

    const { ok, status, body } = await safeFetchJson(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!ok) {
      logger.warn('ZapSign send failed', { status, tenantId, proposalId });
      throw createError(
        'Falha ao enviar a proposta para assinatura no provedor.',
        502,
        'SIGNATURE_PROVIDER_ERROR',
        { providerStatus: status }
      );
    }

    // ZapSign devolve o token do documento (envelope).
    const envelopeId: string | undefined = body?.token || body?.doc?.token || body?.id;
    if (!envelopeId) {
      throw createError(
        'Provedor de assinatura não retornou um identificador de envelope.',
        502,
        'SIGNATURE_PROVIDER_ERROR'
      );
    }

    const updated = await prisma.proposal.update({
      where: { id: proposal.id },
      data: { signatureEnvelopeId: envelopeId, signatureStatus: 'SENT' },
    });
    return updated;
  },

  /**
   * Valida a assinatura HMAC-SHA256 do webhook ZapSign contra o `webhookSecret`
   * do tenant. O ZapSign envia o header configurado no painel; aceitamos o
   * cabeçalho tanto como hex quanto `sha256=<hex>`. Comparação timing-safe.
   */
  verifyWebhookSignature(secret: string, rawBody: string, headerSignature: string | undefined): boolean {
    if (!headerSignature) return false;
    const provided = headerSignature.startsWith('sha256=')
      ? headerSignature.slice('sha256='.length)
      : headerSignature;
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    if (provided.length !== expected.length) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
      return false;
    }
  },

  /**
   * Processa um evento de webhook do ZapSign. Identifica o tenant pelo envelopeId
   * (Proposal.signatureEnvelopeId, único por documento), VALIDA o HMAC com o
   * secret desse tenant, atualiza `signatureStatus` e, quando SIGNED, notifica o
   * responsável pelo deal (Notification PROPOSAL_SIGNED).
   *
   * Retorna { handled, status } — nunca lança para o handler (webhook responde 200).
   */
  async handleWebhook(
    rawBody: string,
    headerSignature: string | undefined
  ): Promise<{ handled: boolean; reason?: string; signatureStatus?: SignatureStatus }> {
    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return { handled: false, reason: 'invalid_json' };
    }

    const envelopeId: string | undefined =
      payload?.token || payload?.doc?.token || payload?.external_id;
    if (!envelopeId) return { handled: false, reason: 'no_envelope_id' };

    // Identifica o tenant/proposta pelo envelope. Proposal não tem relação `deal`
    // no schema (só `dealId`), então buscamos o deal separadamente.
    const proposal = await prisma.proposal.findFirst({
      where: { signatureEnvelopeId: envelopeId },
    });
    if (!proposal) {
      // Fallback: NDA de consultor (módulo de Parceiros) — o token do ZapSign é
      // globalmente único, então o lookup em duas tabelas é seguro. O tenant é
      // derivado do consultor e o HMAC validado com o secret DESSE tenant.
      return this.handleNdaWebhook(rawBody, headerSignature, envelopeId, payload);
    }
    const deal = await prisma.deal.findUnique({
      where: { id: proposal.dealId },
      select: { id: true, name: true, assignedTo: true },
    });

    // Valida o HMAC com o secret do tenant dono da proposta.
    const config = await integrationService.getConfig<SignatureConfig>(
      proposal.tenantId,
      'SIGNATURE'
    );
    if (!config) return { handled: false, reason: 'not_configured' };
    if (!this.verifyWebhookSignature(config.webhookSecret, rawBody, headerSignature)) {
      logger.warn('ZapSign webhook: invalid signature', { envelopeId });
      return { handled: false, reason: 'invalid_signature' };
    }

    const rawStatus: string | undefined =
      payload?.status || payload?.doc?.status || payload?.event_type || payload?.event;
    const nextStatus = mapZapSignStatus(rawStatus);
    if (!nextStatus) return { handled: false, reason: 'unmapped_status' };

    await prisma.proposal.update({
      where: { id: proposal.id },
      data: { signatureStatus: nextStatus },
    });

    // Evento na timeline do deal para TODAS as transições relevantes (req 19).
    // SENT já é registrado no envio (sendForSignature); aqui cobrimos
    // VIEWED/SIGNED/REFUSED/EXPIRED com conteúdo pt-BR por status. Best-effort.
    if (deal) {
      const timelineText = signatureTimelineText(nextStatus, proposal.version);
      if (timelineText) {
        await prisma.interaction
          .create({
            data: {
              tenantId: proposal.tenantId,
              dealId: deal.id,
              type: 'NOTE',
              direction: 'INBOUND',
              content: timelineText,
              metadata: { proposalId: proposal.id, signatureStatus: nextStatus },
            },
          })
          .catch((err) => logger.error('Falha ao registrar interação de assinatura', err));
      }
    }

    // Notifica o responsável pelo deal APENAS quando assinado.
    if (nextStatus === 'SIGNED' && deal?.assignedTo) {
      await notificationService
        .create(proposal.tenantId, {
          userId: deal.assignedTo,
          type: NotificationType.PROPOSAL_SIGNED,
          title: 'Proposta assinada',
          message: `A proposta da negociação "${deal.name}" foi assinada.`,
          link: `/app/deals/${deal.id}`,
          metadata: { proposalId: proposal.id, dealId: deal.id },
        })
        .catch((err) => logger.error('Falha ao notificar assinatura', err));
    }

    return { handled: true, signatureStatus: nextStatus };
  },

  /**
   * Fallback do webhook para o NDA de consultor (módulo de Parceiros). Mesmo
   * contrato do handleWebhook: identifica pelo envelopeId, valida HMAC com o
   * secret do tenant do consultor e atualiza o ndaStatus. SIGNED libera o portal;
   * REFUSED/EXPIRED mantêm bloqueado e notificam o gestor. Nunca lança.
   */
  async handleNdaWebhook(
    rawBody: string,
    headerSignature: string | undefined,
    envelopeId: string,
    payload: any
  ): Promise<{ handled: boolean; reason?: string; signatureStatus?: SignatureStatus }> {
    const consultor = await prisma.consultor.findFirst({ where: { ndaEnvelopeId: envelopeId } });
    if (!consultor) return { handled: false, reason: 'envelope_not_found' };

    const config = await integrationService.getConfig<SignatureConfig>(consultor.tenantId, 'SIGNATURE');
    if (!config) return { handled: false, reason: 'not_configured' };
    if (!this.verifyWebhookSignature(config.webhookSecret, rawBody, headerSignature)) {
      logger.warn('ZapSign webhook (NDA): invalid signature', { envelopeId });
      return { handled: false, reason: 'invalid_signature' };
    }

    const rawStatus: string | undefined =
      payload?.status || payload?.doc?.status || payload?.event_type || payload?.event;
    const nextStatus = mapZapSignStatus(rawStatus);
    if (!nextStatus) return { handled: false, reason: 'unmapped_status' };

    // Mapeia SignatureStatus → NdaStatus da spec: SENT|VIEWED→ENVIADO,
    // SIGNED→ASSINADO, REFUSED|EXPIRED→RECUSADO (ambos mantêm o portal bloqueado).
    const ndaStatus =
      nextStatus === 'SIGNED'
        ? ('ASSINADO' as const)
        : nextStatus === 'REFUSED' || nextStatus === 'EXPIRED'
          ? ('RECUSADO' as const)
          : ('ENVIADO' as const);

    await prisma.consultor.update({ where: { id: consultor.id }, data: { ndaStatus } });

    // Notifica ADMIN + GESTOR do desfecho (best-effort) — o gestor de parceiros
    // precisa saber, não só o ADMIN. Usa notifyParceiro (in-app + e-mail).
    if (ndaStatus !== 'ENVIADO') {
      const gestores = await prisma.user
        .findMany({
          where: { tenantId: consultor.tenantId, role: { in: ['ADMIN', 'GESTOR'] }, status: 'ACTIVE' },
          select: { id: true },
        })
        .catch(() => [] as { id: string }[]);
      const userIds = gestores.map((u) => u.id);
      if (userIds.length > 0) {
        const { notifyParceiro } = await import('./parceiros/notifyParceiroService.js');
        await notifyParceiro(consultor.tenantId, {
          userIds,
          type: NotificationType.PARCEIRO_REGISTRO_DECIDIDO,
          title: ndaStatus === 'ASSINADO' ? 'NDA assinado' : 'NDA recusado/expirado',
          message:
            ndaStatus === 'ASSINADO'
              ? `O consultor ${consultor.nome} assinou o NDA — portal liberado.`
              : `O NDA do consultor ${consultor.nome} foi recusado ou expirou — portal permanece bloqueado.`,
          link: `/app/parceiros`,
          metadata: { consultorId: consultor.id, ndaStatus },
        }).catch((err) => logger.error('Falha ao notificar NDA', err));
      }
    }

    return { handled: true, signatureStatus: nextStatus };
  },
};
