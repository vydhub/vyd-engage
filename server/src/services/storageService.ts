/**
 * storageService — abstração de armazenamento de anexos (Upgrade RD P2, req 22).
 *
 * Dois providers:
 *  - "db"  (AttachmentBlob bytea) — DEFAULT, sempre disponível, sem dependência externa.
 *  - "s3"  (S3-compatível: AWS S3, Cloudflare R2, MinIO…) — ATIVO só quando as env
 *          STORAGE_S3_* (bucket + chaves) estão configuradas. Ver `s3StorageProvider`.
 *
 * GATING GRACIOSO: sem STORAGE_S3_* → provider "db" (sem regressão). Se o S3 estiver
 * configurado mas a escrita falhar, o upload NÃO quebra: faz fallback para "db"
 * (loga um aviso). Nunca lança 500 por ausência de credencial de storage.
 *
 * Limite por tenant: `put` soma o tamanho dos anexos vivos (deletedAt null) e
 * recusa (422 STORAGE_LIMIT) quando o novo arquivo estouraria `maxStorageMB` do
 * plano (planLimitsService.resolveStorageLimitMB).
 *
 * Multi-tenant: todo acesso é escopado por tenantId; `get`/`remove` recebem o
 * Attachment já validado pelo caller (rota valida tenant antes de ler bytes).
 */
import type { Attachment } from '@prisma/client';
import prisma from '../config/database.js';
import { createError } from '../middleware/errorHandler.js';
import { planLimitsService } from './planLimitsService.js';
import { logger } from '../utils/logger.js';
import * as s3Provider from './s3StorageProvider.js';

const BYTES_PER_MB = 1024 * 1024;

export interface PutAttachmentInput {
  name: string;
  mimeType: string;
  buffer: Buffer;
  dealId?: string | null;
  companyId?: string | null;
  source?:
    | 'UPLOAD'
    | 'PROPOSAL'
    | 'MEETING'
    | 'ATESTADO_DOC'
    | 'DOSSIER'
    | 'CURRICULO'
    | 'PARCEIRO_DOC'
    | 'PARCEIRO_NDA'
    | 'PARCEIRO_REPORT';
  uploadedById?: string | null;
}

export interface StorageUsage {
  usedMB: number;
  limitMB: number; // 0 = ilimitado (Infinity), coerente com o resto de planLimits
}

/** Soma dos bytes dos anexos vivos (não deletados) do tenant. */
async function usedBytes(tenantId: string): Promise<number> {
  const agg = await prisma.attachment.aggregate({
    where: { tenantId, deletedAt: null },
    _sum: { size: true },
  });
  return agg._sum.size ?? 0;
}

export const storageService = {
  /**
   * Persiste um novo anexo respeitando o limite de armazenamento do tenant.
   * Cria o metadado (Attachment) e, no provider "db", o blob (AttachmentBlob).
   */
  async put(tenantId: string, input: PutAttachmentInput): Promise<Attachment> {
    const size = input.buffer.length;

    // Checagem de limite: uso atual + novo arquivo ≤ maxStorageMB (a menos de ilimitado).
    const limitMB = await planLimitsService.resolveStorageLimitMB(tenantId);
    if (Number.isFinite(limitMB)) {
      const current = await usedBytes(tenantId);
      const limitBytes = limitMB * BYTES_PER_MB;
      if (current + size > limitBytes) {
        throw createError(
          `Limite de armazenamento atingido (${limitMB}MB). Exclua arquivos ou faça upgrade do plano.`,
          422,
          'STORAGE_LIMIT',
          { usedMB: Math.round((current / BYTES_PER_MB) * 100) / 100, limitMB }
        );
      }
    }

    // Provider: "s3" só quando STORAGE_S3_* configurado; senão "db" (default).
    let storageProvider = 'db';
    let storageKey: string;

    if (s3Provider.isS3Configured()) {
      // GATING GRACIOSO: se a escrita no S3 falhar (rede/credencial), caímos em
      // "db" sem quebrar o upload (nunca 500 por storage externo).
      try {
        storageKey = await s3Provider.putObject(
          tenantId,
          input.name,
          input.mimeType,
          input.buffer
        );
        storageProvider = 's3';
      } catch (err) {
        logger.warn('Falha no provider S3 — fallback para "db".', err);
        storageKey = await this.putDbBlob(input.buffer);
        storageProvider = 'db';
      }
    } else {
      storageKey = await this.putDbBlob(input.buffer);
    }

    return prisma.attachment.create({
      data: {
        tenantId,
        name: input.name,
        mimeType: input.mimeType,
        size,
        storageProvider,
        storageKey,
        dealId: input.dealId ?? null,
        companyId: input.companyId ?? null,
        source: input.source ?? 'UPLOAD',
        uploadedById: input.uploadedById ?? null,
      },
    });
  },

  /** Cria um AttachmentBlob e retorna seu id (usado como storageKey do provider "db"). */
  async putDbBlob(buffer: Buffer): Promise<string> {
    const blob = await prisma.attachmentBlob.create({ data: { data: buffer } });
    return blob.id;
  },

  /** Lê os bytes de um anexo. Assume que o caller já validou tenant/visibilidade. */
  async get(attachment: Pick<Attachment, 'storageProvider' | 'storageKey'>): Promise<Buffer> {
    if (attachment.storageProvider === 's3') {
      if (!s3Provider.isS3Configured()) {
        // Anexo gravado no S3 mas as env sumiram — não conseguimos ler os bytes.
        throw createError('Provider S3 indisponível para leitura do anexo.', 500, 'S3_UNAVAILABLE');
      }
      return s3Provider.getObject(attachment.storageKey);
    }
    const blob = await prisma.attachmentBlob.findUnique({ where: { id: attachment.storageKey } });
    if (!blob) throw createError('Arquivo não encontrado.', 404, 'ATTACHMENT_BLOB_NOT_FOUND');
    return Buffer.from(blob.data);
  },

  /**
   * Soft-delete do anexo (marca deletedAt). Os bytes (blob "db" ou objeto S3) só
   * são purgados no EXPURGO definitivo da Lixeira (P1) — mantemos os bytes para
   * permitir restauração dentro da janela de retenção.
   */
  async remove(tenantId: string, attachmentId: string): Promise<void> {
    await prisma.attachment.updateMany({
      where: { id: attachmentId, tenantId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  },

  /**
   * Purga FÍSICA dos bytes de um anexo (chamada no expurgo definitivo da Lixeira).
   * Apaga o AttachmentBlob ("db") ou o objeto S3 conforme o provider. Best-effort:
   * uma falha ao remover os bytes NÃO deve abortar o hard-delete do metadado.
   */
  async purgeBytes(
    attachment: Pick<Attachment, 'storageProvider' | 'storageKey'>
  ): Promise<void> {
    if (attachment.storageProvider === 's3') {
      if (s3Provider.isS3Configured()) {
        await s3Provider.removeObject(attachment.storageKey).catch((err) => {
          logger.warn(`Falha ao remover objeto S3 ${attachment.storageKey} no expurgo.`, err);
        });
      }
      return;
    }
    await prisma.attachmentBlob
      .delete({ where: { id: attachment.storageKey } })
      .catch(() => {
        // Blob já ausente (corrida/expurgo prévio) — idempotente.
      });
  },

  /** Uso de armazenamento do tenant em MB + limite (0 = ilimitado). */
  async usage(tenantId: string): Promise<StorageUsage> {
    const [bytes, limitMB] = await Promise.all([
      usedBytes(tenantId),
      planLimitsService.resolveStorageLimitMB(tenantId),
    ]);
    return {
      usedMB: Math.round((bytes / BYTES_PER_MB) * 100) / 100,
      limitMB: Number.isFinite(limitMB) ? limitMB : 0,
    };
  },
};
