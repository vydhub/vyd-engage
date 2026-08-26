// Documentos/templates da empresa disponibilizados aos consultores (PRM).
// Metadados no model ConsultorDocumento; bytes via storageService + Attachment.

import prisma from '../../config/database.js';
import { createError } from '../../middleware/errorHandler.js';
import { storageService } from '../storageService.js';
import { sanitizeFileName } from '../attachmentService.js';

export const documentoService = {
  /** Lista os documentos do tenant. ativosOnly=true (via do portal) filtra ativo:true. */
  async list(tenantId: string, opts: { ativosOnly?: boolean } = {}) {
    return prisma.consultorDocumento.findMany({
      where: {
        tenantId,
        ...(opts.ativosOnly ? { ativo: true } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  /** Sobe um novo documento: bytes via storageService (Attachment) + metadado ConsultorDocumento. */
  async upload(
    tenantId: string,
    data: {
      titulo: string;
      buffer: Buffer;
      mimeType: string;
      fileName: string;
      criadoPorId?: string;
    }
  ) {
    const attachment = await storageService.put(tenantId, {
      name: sanitizeFileName(data.fileName),
      mimeType: data.mimeType,
      buffer: data.buffer,
      source: 'PARCEIRO_DOC',
      uploadedById: data.criadoPorId ?? null,
    });

    return prisma.consultorDocumento.create({
      data: {
        tenantId,
        titulo: data.titulo,
        attachmentId: attachment.id,
        criadoPorId: data.criadoPorId ?? null,
      },
    });
  },

  /** Atualiza título/visibilidade. Posse validada via findFirst id+tenantId. */
  async update(tenantId: string, id: string, data: { titulo?: string; ativo?: boolean }) {
    const existing = await prisma.consultorDocumento.findFirst({ where: { id, tenantId } });
    if (!existing) throw createError('Documento não encontrado', 404, 'DOCUMENTO_NOT_FOUND');
    return prisma.consultorDocumento.update({
      where: { id },
      data: {
        ...(data.titulo !== undefined ? { titulo: data.titulo } : {}),
        ...(data.ativo !== undefined ? { ativo: data.ativo } : {}),
      },
    });
  },

  /** Remove o metadado ConsultorDocumento (o Attachment permanece). */
  async remove(tenantId: string, id: string) {
    const existing = await prisma.consultorDocumento.findFirst({ where: { id, tenantId } });
    if (!existing) throw createError('Documento não encontrado', 404, 'DOCUMENTO_NOT_FOUND');
    await prisma.consultorDocumento.delete({ where: { id } });
    return { id };
  },

  /**
   * Baixa os bytes de um documento. Com ativosOnly (via do PORTAL do parceiro),
   * exige ativo:true — documento inativo é invisível ao consultor.
   */
  async download(tenantId: string, id: string, opts: { ativosOnly?: boolean } = {}) {
    const doc = await prisma.consultorDocumento.findFirst({
      where: {
        id,
        tenantId,
        ...(opts.ativosOnly ? { ativo: true } : {}),
      },
    });
    if (!doc) throw createError('Documento não encontrado', 404, 'DOCUMENTO_NOT_FOUND');

    const attachment = await prisma.attachment.findFirst({
      where: { id: doc.attachmentId, tenantId },
    });
    if (!attachment) throw createError('Arquivo não encontrado', 404, 'ATTACHMENT_NOT_FOUND');

    const buffer = await storageService.get(attachment);
    return {
      doc,
      attachment: { name: attachment.name, mimeType: attachment.mimeType },
      buffer,
    };
  },
};
