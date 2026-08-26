// Consultor comercial externo (parceiro) — cadastro 1:1 com conta User (papel
// CONSULTOR, restrita ao Portal do Parceiro) + NDA como pré-condição de acesso.
// Reqs 1-3, 34 da spec gestao-parceiros-comerciais.

import prisma from '../../config/database.js';
import { createError } from '../../middleware/errorHandler.js';
import { hashPassword } from '../../utils/password.js';
import { onlyDigits, collapseSpaces } from '../atestados/normalize.js';
import type { ConsultorStatus, Prisma } from '@prisma/client';

export interface ConsultorData {
  nome: string;
  email: string;
  telefone?: string | null;
  cpfCnpj?: string | null;
  empresa?: string | null;
  nivel?: string | null;
  comissaoBase?: number;
  status?: ConsultorStatus;
  inicioParceria?: Date | null;
  cadenciaReuniaoDias?: number | null;
}

const listSelect = {
  id: true,
  nome: true,
  email: true,
  telefone: true,
  empresa: true,
  nivel: true,
  comissaoBase: true,
  status: true,
  inicioParceria: true,
  ndaStatus: true,
  score: true,
  scoreFaixa: true,
  ultimaAtividadeEm: true,
  createdAt: true,
} satisfies Prisma.ConsultorSelect;

export const consultorService = {
  async list(tenantId: string, filters: { search?: string; status?: ConsultorStatus } = {}) {
    return prisma.consultor.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.search
          ? {
              OR: [
                { nome: { contains: filters.search, mode: 'insensitive' } },
                { email: { contains: filters.search, mode: 'insensitive' } },
                { empresa: { contains: filters.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: listSelect,
      orderBy: { nome: 'asc' },
    });
  },

  async get(tenantId: string, id: string) {
    const consultor = await prisma.consultor.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        metas: { orderBy: [{ year: 'desc' }, { month: 'desc' }], take: 12 },
        reunioes: { orderBy: { dataHora: 'desc' }, take: 10 },
      },
    });
    if (!consultor) throw createError('Consultor não encontrado', 404, 'CONSULTOR_NOT_FOUND');
    return consultor;
  },

  /** Resolve o Consultor da conta autenticada do portal (vínculo 1:1 por userId). */
  async getByUserId(tenantId: string, userId: string) {
    const consultor = await prisma.consultor.findFirst({ where: { tenantId, userId, deletedAt: null } });
    if (!consultor) throw createError('Conta sem consultor vinculado', 403, 'CONSULTOR_NOT_LINKED');
    return consultor;
  },

  /**
   * Cria o consultor + a conta User (papel CONSULTOR) numa transação.
   * A senha inicial é definida pelo gestor (o consultor pode trocar depois).
   */
  async create(tenantId: string, data: ConsultorData & { senhaInicial: string }) {
    const email = data.email.trim().toLowerCase();
    const existingUser = await prisma.user.findFirst({ where: { email } });
    if (existingUser) throw createError('Já existe um usuário com este e-mail', 400, 'EMAIL_EXISTS');

    const passwordHash = await hashPassword(data.senhaInicial);
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          tenantId,
          email,
          passwordHash,
          name: collapseSpaces(data.nome),
          role: 'CONSULTOR',
          status: 'ACTIVE',
          emailVerified: true,
        },
        select: { id: true },
      });
      return tx.consultor.create({
        data: {
          tenantId,
          userId: user.id,
          nome: collapseSpaces(data.nome),
          email,
          telefone: data.telefone ?? null,
          telefoneDigits: data.telefone ? onlyDigits(data.telefone) || null : null,
          cpfCnpj: data.cpfCnpj ?? null,
          empresa: data.empresa ?? null,
          nivel: data.nivel ?? null,
          comissaoBase: data.comissaoBase ?? 0,
          status: data.status ?? 'ATIVO',
          inicioParceria: data.inicioParceria ?? null,
          cadenciaReuniaoDias: data.cadenciaReuniaoDias ?? null,
        },
      });
    });
  },

  async update(tenantId: string, id: string, data: Partial<ConsultorData>, autorId?: string) {
    const existing = await prisma.consultor.findFirst({ where: { id, tenantId, deletedAt: null } });
    if (!existing) throw createError('Consultor não encontrado', 404, 'CONSULTOR_NOT_FOUND');

    const updateData: Record<string, unknown> = {};
    if (data.nome !== undefined) updateData.nome = collapseSpaces(data.nome);
    if (data.telefone !== undefined) {
      updateData.telefone = data.telefone;
      updateData.telefoneDigits = data.telefone ? onlyDigits(data.telefone) || null : null;
    }
    for (const key of ['cpfCnpj', 'empresa', 'nivel', 'comissaoBase', 'inicioParceria', 'cadenciaReuniaoDias'] as const) {
      if (data[key] !== undefined) updateData[key] = data[key];
    }

    // Auditoria da comissão base: registra valor antigo→novo quando muda de fato.
    const comissaoMudou =
      data.comissaoBase !== undefined && Number(data.comissaoBase) !== Number(existing.comissaoBase);

    // Status do consultor espelha na conta: SUSPENSO/INATIVO bloqueiam o login
    // do portal (User.status != ACTIVE → authenticate nega). Reativar restaura.
    const statusMudou = data.status !== undefined && data.status !== existing.status;
    if (statusMudou) {
      updateData.status = data.status;
      await prisma.user
        .update({
          where: { id: existing.userId },
          data: { status: data.status === 'ATIVO' ? 'ACTIVE' : 'INACTIVE' },
        })
        .catch(() => {});
    }

    const updated = await prisma.consultor.update({ where: { id }, data: updateData });

    // Trilha de auditoria da alteração de comissão base (best-effort).
    if (comissaoMudou) {
      await prisma.consultorAuditoria
        .create({
          data: {
            tenantId,
            consultorId: id,
            evento: 'COMISSAO_BASE_ALTERADA',
            valorAntigo: String(existing.comissaoBase),
            valorNovo: String(data.comissaoBase),
            autorId: autorId ?? null,
          },
        })
        .catch(() => {});
    }

    // Suspensão/inativação com oportunidades ativas: avisa os gestores para decidirem
    // caso a caso (as janelas de proteção continuam correndo — não mexemos nelas).
    if (statusMudou && (data.status === 'SUSPENSO' || data.status === 'INATIVO')) {
      const ativos = await prisma.registroOportunidade
        .count({
          where: {
            tenantId,
            consultorId: id,
            status: { in: ['SUBMETIDO', 'EM_ANALISE', 'APROVADO'] },
            deletedAt: null,
          },
        })
        .catch(() => 0);
      if (ativos > 0) {
        const gestores = await prisma.user
          .findMany({
            where: { tenantId, role: { in: ['ADMIN', 'GESTOR'] }, status: 'ACTIVE' },
            select: { id: true },
          })
          .catch(() => [] as { id: string }[]);
        const userIds = gestores.map((u) => u.id);
        if (userIds.length > 0) {
          const acao = data.status === 'SUSPENSO' ? 'suspenso' : 'inativado';
          const { notifyParceiro } = await import('./notifyParceiroService.js');
          const { NotificationType } = await import('@prisma/client');
          await notifyParceiro(tenantId, {
            userIds,
            type: NotificationType.PARCEIRO_REGISTRO_SUBMETIDO,
            title: 'Consultor com oportunidades ativas',
            message: `Consultor ${existing.nome} ${acao} com ${ativos} oportunidade(s) ativa(s) — decida caso a caso.`,
            link: `/app/parceiros`,
            metadata: { consultorId: id, status: data.status, oportunidadesAtivas: ativos },
          }).catch(() => {});
        }
      }
    }

    return updated;
  },

  /** Soft-delete do consultor + desativa a conta do portal. */
  async remove(tenantId: string, id: string) {
    const existing = await prisma.consultor.findFirst({ where: { id, tenantId, deletedAt: null } });
    if (!existing) throw createError('Consultor não encontrado', 404, 'CONSULTOR_NOT_FOUND');
    await prisma.consultor.update({ where: { id }, data: { deletedAt: new Date(), status: 'INATIVO' } });
    await prisma.user.update({ where: { id: existing.userId }, data: { status: 'INACTIVE' } }).catch(() => {});
    return { id };
  },

  // ── NDA (pré-condição de acesso ao portal — req 3/34) ──────────────────────

  /**
   * Envia o NDA para assinatura eletrônica via ZapSign (gated pela IntegrationConfig
   * SIGNATURE). `attachmentId` é o PDF do NDA (Attachment já enviado pelo gestor).
   */
  async sendNda(tenantId: string, consultorId: string, attachmentId: string) {
    const consultor = await prisma.consultor.findFirst({ where: { id: consultorId, tenantId, deletedAt: null } });
    if (!consultor) throw createError('Consultor não encontrado', 404, 'CONSULTOR_NOT_FOUND');

    const attachment = await prisma.attachment.findFirst({ where: { id: attachmentId, tenantId, deletedAt: null } });
    if (!attachment) throw createError('Documento do NDA não encontrado', 404, 'ATTACHMENT_NOT_FOUND');

    const { signatureService } = await import('../signatureService.js');
    const { storageService } = await import('../storageService.js');
    const pdfBuffer = await storageService.get(attachment);

    const envelopeId = await signatureService.createEnvelope(tenantId, {
      name: `NDA — ${consultor.nome}`,
      pdfBuffer,
      signerName: consultor.nome,
      signerEmail: consultor.email,
    });

    return prisma.consultor.update({
      where: { id: consultorId },
      data: { ndaEnvelopeId: envelopeId, ndaStatus: 'ENVIADO', ndaAttachmentId: attachmentId },
    });
  },

  /** Fallback sem ZapSign: upload manual do NDA já assinado libera o portal. */
  async uploadNdaAssinado(
    tenantId: string,
    consultorId: string,
    file: { buffer: Buffer; mimeType: string; fileName: string },
    uploadedById?: string
  ) {
    const consultor = await prisma.consultor.findFirst({ where: { id: consultorId, tenantId, deletedAt: null } });
    if (!consultor) throw createError('Consultor não encontrado', 404, 'CONSULTOR_NOT_FOUND');

    const { storageService } = await import('../storageService.js');
    const { sanitizeFileName } = await import('../attachmentService.js');
    const attachment = await storageService.put(tenantId, {
      name: sanitizeFileName(file.fileName || `nda-${consultor.nome}.pdf`),
      mimeType: file.mimeType,
      buffer: file.buffer,
      source: 'PARCEIRO_NDA',
      uploadedById: uploadedById ?? null,
    });

    return prisma.consultor.update({
      where: { id: consultorId },
      data: { ndaStatus: 'ASSINADO', ndaAttachmentId: attachment.id, ndaEnvelopeId: null },
    });
  },

  /** Resolve consultor ATIVO pelo telefone (WhatsApp inbound) — exige match único. */
  async resolveByPhone(tenantId: string, phone: string) {
    const digits = onlyDigits(phone);
    if (!digits) return null;
    // Tolera presença/ausência do DDI 55 (padrão do copiloto).
    const variants = [digits, digits.startsWith('55') ? digits.slice(2) : `55${digits}`];
    const matches = await prisma.consultor.findMany({
      where: { tenantId, deletedAt: null, status: 'ATIVO', telefoneDigits: { in: variants } },
    });
    return matches.length === 1 ? matches[0] : null;
  },
};
