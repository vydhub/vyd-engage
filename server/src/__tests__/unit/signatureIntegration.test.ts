import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

/**
 * Upgrade RD parity — P2 (B3): assinatura eletrônica (req 19) gated + webhook HMAC.
 *
 * Prova:
 *  - sendForSignature sem credencial → 400 SIGNATURE_NOT_CONFIGURED (gating).
 *  - sendForSignature configurado → chama ZapSign (fetch mock), grava envelopeId + SENT.
 *  - handleWebhook com HMAC válido → atualiza signatureStatus (SIGNED) + notifica.
 *  - handleWebhook com HMAC inválido → não atualiza (reason invalid_signature).
 *  - verifyWebhookSignature: HMAC-SHA256 timing-safe.
 */

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../config/database.js', () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));
// Neutraliza a checagem anti-SSRF (DNS real) — o alvo ZapSign é público.
vi.mock('../../utils/safeFetch.js', () => ({
  assertPublicHttpUrl: vi.fn(async (u: string) => new URL(u)),
}));

const { getConfigMock } = vi.hoisted(() => ({ getConfigMock: vi.fn() }));
vi.mock('../../services/integrationService.js', () => ({
  integrationService: { getConfig: getConfigMock },
}));

const { storageGetMock } = vi.hoisted(() => ({ storageGetMock: vi.fn() }));
vi.mock('../../services/storageService.js', () => ({
  storageService: { get: storageGetMock },
}));

const { notifyCreateMock } = vi.hoisted(() => ({ notifyCreateMock: vi.fn() }));
vi.mock('../../services/notificationService.js', () => ({
  notificationService: { create: notifyCreateMock },
}));

import prisma from '../../config/database.js';
import { signatureService } from '../../services/signatureService.js';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

/** Primeiro argumento da primeira chamada (cast via unknown p/ contornar a
 * inferência de tupla do mockDeep sob strict). */
function firstCallArg(mockFn: unknown): any {
  const calls = (mockFn as { mock: { calls: unknown[][] } }).mock.calls;
  return calls[0]?.[0] ?? {};
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockReset(prismaMock);
  getConfigMock.mockReset();
  storageGetMock.mockReset();
  notifyCreateMock.mockReset();
  notifyCreateMock.mockResolvedValue({});
});

const SECRET = 'whsec_zap_123';

describe('signatureService.sendForSignature — gating', () => {
  it('lança 400 SIGNATURE_NOT_CONFIGURED sem credencial', async () => {
    getConfigMock.mockResolvedValue(null);
    await expect(
      signatureService.sendForSignature('t1', 'prop-1', {
        signerEmail: 'a@b.com',
        signerName: 'A',
      })
    ).rejects.toMatchObject({ statusCode: 400, code: 'SIGNATURE_NOT_CONFIGURED' });
  });

  it('envia ao ZapSign e grava signatureEnvelopeId + SENT', async () => {
    getConfigMock.mockResolvedValue({ provider: 'zapsign', apiKey: 'k', webhookSecret: SECRET });
    prismaMock.proposal.findFirst.mockResolvedValue({
      id: 'prop-1',
      tenantId: 't1',
      attachment: { name: 'proposta.pdf', storageProvider: 'db', storageKey: 'blob-1' },
    } as never);
    storageGetMock.mockResolvedValue(Buffer.from('%PDF-1.4'));
    prismaMock.proposal.update.mockResolvedValue({
      id: 'prop-1',
      signatureStatus: 'SENT',
      signatureEnvelopeId: 'doc-token-abc',
    } as never);

    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ token: 'doc-token-abc' }), { status: 200 })
      );

    const result = await signatureService.sendForSignature('t1', 'prop-1', {
      signerEmail: 'a@b.com',
      signerName: 'A',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('api.zapsign.com.br');
    expect((init as RequestInit).method).toBe('POST');
    const updateArg = firstCallArg(prismaMock.proposal.update) as { data: Record<string, unknown> };
    expect(updateArg.data).toMatchObject({
      signatureEnvelopeId: 'doc-token-abc',
      signatureStatus: 'SENT',
    });
    expect(result.signatureStatus).toBe('SENT');
  });

  it('propaga 502 quando o provedor falha', async () => {
    getConfigMock.mockResolvedValue({ provider: 'zapsign', apiKey: 'k', webhookSecret: SECRET });
    prismaMock.proposal.findFirst.mockResolvedValue({
      id: 'prop-1',
      tenantId: 't1',
      attachment: { name: 'p.pdf', storageProvider: 'db', storageKey: 'b' },
    } as never);
    storageGetMock.mockResolvedValue(Buffer.from('x'));
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));

    await expect(
      signatureService.sendForSignature('t1', 'prop-1', { signerEmail: 'a@b.com', signerName: 'A' })
    ).rejects.toMatchObject({ statusCode: 502, code: 'SIGNATURE_PROVIDER_ERROR' });
  });
});

describe('signatureService.verifyWebhookSignature — HMAC-SHA256', () => {
  it('valida assinatura correta (hex e sha256=hex)', () => {
    const body = JSON.stringify({ token: 'doc-1', status: 'signed' });
    const sig = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
    expect(signatureService.verifyWebhookSignature(SECRET, body, sig)).toBe(true);
    expect(signatureService.verifyWebhookSignature(SECRET, body, `sha256=${sig}`)).toBe(true);
  });

  it('rejeita assinatura errada ou ausente', () => {
    const body = JSON.stringify({ token: 'doc-1' });
    expect(signatureService.verifyWebhookSignature(SECRET, body, 'deadbeef')).toBe(false);
    expect(signatureService.verifyWebhookSignature(SECRET, body, undefined)).toBe(false);
  });
});

describe('signatureService.handleWebhook — atualiza status + notifica', () => {
  const buildBody = (status: string) => JSON.stringify({ token: 'env-1', status });

  beforeEach(() => {
    prismaMock.proposal.findFirst.mockResolvedValue({
      id: 'prop-1',
      tenantId: 't1',
      dealId: 'deal-1',
      version: 2,
    } as never);
    prismaMock.deal.findUnique.mockResolvedValue({
      id: 'deal-1',
      name: 'Negócio X',
      assignedTo: 'user-1',
    } as never);
    getConfigMock.mockResolvedValue({ provider: 'zapsign', apiKey: 'k', webhookSecret: SECRET });
    prismaMock.proposal.update.mockResolvedValue({ id: 'prop-1' } as never);
    prismaMock.interaction.create.mockResolvedValue({ id: 'int-1' } as never);
  });

  it('HMAC válido + status signed → SIGNED + Notification + Interaction', async () => {
    const body = buildBody('signed');
    const sig = crypto.createHmac('sha256', SECRET).update(body).digest('hex');

    const res = await signatureService.handleWebhook(body, sig);

    expect(res).toMatchObject({ handled: true, signatureStatus: 'SIGNED' });
    const updateArg = firstCallArg(prismaMock.proposal.update) as { data: Record<string, unknown> };
    expect(updateArg.data.signatureStatus).toBe('SIGNED');
    expect(notifyCreateMock).toHaveBeenCalledOnce();
    expect(notifyCreateMock.mock.calls[0][1]).toMatchObject({ userId: 'user-1', type: 'PROPOSAL_SIGNED' });
    expect(prismaMock.interaction.create).toHaveBeenCalledOnce();
  });

  it('HMAC inválido → não atualiza (invalid_signature)', async () => {
    const res = await signatureService.handleWebhook(buildBody('signed'), 'ffff');
    expect(res).toMatchObject({ handled: false, reason: 'invalid_signature' });
    expect(prismaMock.proposal.update).not.toHaveBeenCalled();
    expect(notifyCreateMock).not.toHaveBeenCalled();
  });

  it('status viewed → VIEWED (sem notificação de assinatura)', async () => {
    const body = buildBody('viewed');
    const sig = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
    const res = await signatureService.handleWebhook(body, sig);
    expect(res).toMatchObject({ handled: true, signatureStatus: 'VIEWED' });
    expect(notifyCreateMock).not.toHaveBeenCalled();
  });

  // Timeline em TODAS as transições relevantes (req 19). VIEWED/REFUSED/EXPIRED
  // criam Interaction pt-BR, mas NÃO notificam (só SIGNED notifica).
  it.each([
    ['viewed', 'VIEWED', 'visualizada'],
    ['refused', 'REFUSED', 'recusada'],
    ['expired', 'EXPIRED', 'expirada'],
  ])('status %s → Interaction pt-BR "%s" sem notificação', async (raw, expected, needle) => {
    const body = buildBody(raw);
    const sig = crypto.createHmac('sha256', SECRET).update(body).digest('hex');

    const res = await signatureService.handleWebhook(body, sig);

    expect(res).toMatchObject({ handled: true, signatureStatus: expected });
    expect(prismaMock.interaction.create).toHaveBeenCalledOnce();
    const intArg = firstCallArg(prismaMock.interaction.create) as { data: Record<string, unknown> };
    expect(String(intArg.data.content)).toContain('Proposta v2');
    expect(String(intArg.data.content)).toContain(needle);
    expect((intArg.data.metadata as Record<string, unknown>).signatureStatus).toBe(expected);
    expect(notifyCreateMock).not.toHaveBeenCalled();
  });

  it('status signed → Interaction pt-BR "assinada" + notificação', async () => {
    const body = buildBody('signed');
    const sig = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
    await signatureService.handleWebhook(body, sig);
    const intArg = firstCallArg(prismaMock.interaction.create) as { data: Record<string, unknown> };
    expect(String(intArg.data.content)).toContain('assinada');
    expect(notifyCreateMock).toHaveBeenCalledOnce();
  });

  // Sem proposta, o webhook cai no fallback do NDA de consultor (módulo de
  // Parceiros) — o token do ZapSign é global, então o mesmo endpoint serve os
  // dois tipos de documento. Não achando nem consultor, o motivo passa a ser
  // 'envelope_not_found': desconhecido em AMBAS as tabelas.
  it('envelope desconhecido em proposta e NDA → envelope_not_found (não quebra)', async () => {
    prismaMock.proposal.findFirst.mockResolvedValue(null as never);
    prismaMock.consultor.findFirst.mockResolvedValue(null as never);
    const res = await signatureService.handleWebhook(buildBody('signed'), 'x');
    expect(res).toMatchObject({ handled: false, reason: 'envelope_not_found' });
  });

  // HMAC sobre o corpo CRU (req 3 do escopo B3): um payload com espaçamento e
  // ordem de chaves que JSON.stringify(JSON.parse(raw)) NÃO reproduziria. A
  // assinatura só bate se validarmos sobre os bytes exatos recebidos.
  it('valida HMAC sobre o RAW body (whitespace/ordem preservados)', async () => {
    const rawBody = '{\n  "status": "signed",\n  "token": "env-1"\n}';
    // Prova de que o raw difere da reserialização (o antigo proxy quebraria).
    expect(JSON.stringify(JSON.parse(rawBody))).not.toBe(rawBody);

    const sig = crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');
    const res = await signatureService.handleWebhook(rawBody, sig);

    expect(res).toMatchObject({ handled: true, signatureStatus: 'SIGNED' });
  });
});
