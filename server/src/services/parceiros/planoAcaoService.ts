// Plano de ação BILATERAL do registro de oportunidade (PlanoAcaoItem).
// Ações do consultor (responsavelConsultor=true) ou da Tenax (responsavelUserId).
// SLA = dueDate; conclusão alimenta ultimaAtividadeEm do registro (e do consultor
// quando concluída via portal).

import prisma from '../../config/database.js';
import { createError } from '../../middleware/errorHandler.js';
import type { PlanoAcaoStatus } from '@prisma/client';

async function assertRegistro(tenantId: string, registroId: string) {
  const registro = await prisma.registroOportunidade.findFirst({
    where: { id: registroId, tenantId, deletedAt: null },
  });
  if (!registro) throw createError('Registro não encontrado', 404, 'REGISTRO_NOT_FOUND');
  return registro;
}

export const planoAcaoService = {
  async list(tenantId: string, registroId: string) {
    await assertRegistro(tenantId, registroId);
    return prisma.planoAcaoItem.findMany({
      where: { tenantId, registroId },
      orderBy: [{ dueDate: 'asc' }],
    });
  },

  async create(
    tenantId: string,
    registroId: string,
    data: {
      descricao: string;
      responsavelConsultor: boolean;
      responsavelUserId?: string | null;
      dueDate?: Date | null;
    }
  ) {
    await assertRegistro(tenantId, registroId);

    if (!data.responsavelConsultor && data.responsavelUserId) {
      const user = await prisma.user.findFirst({
        where: { id: data.responsavelUserId, tenantId },
      });
      if (!user) throw createError('Usuário não encontrado', 404, 'USER_NOT_FOUND');
    }

    const item = await prisma.planoAcaoItem.create({
      data: {
        tenantId,
        registroId,
        descricao: data.descricao,
        responsavelConsultor: data.responsavelConsultor,
        responsavelUserId: data.responsavelUserId ?? null,
        dueDate: data.dueDate ?? null,
      },
    });

    await prisma.registroOportunidade.update({
      where: { id: registroId },
      data: { ultimaAtividadeEm: new Date() },
    });

    return item;
  },

  async update(
    tenantId: string,
    id: string,
    data: {
      descricao?: string;
      responsavelConsultor?: boolean;
      responsavelUserId?: string | null;
      dueDate?: Date | null;
      status?: PlanoAcaoStatus;
    }
  ) {
    const existing = await prisma.planoAcaoItem.findFirst({ where: { id, tenantId } });
    if (!existing) throw createError('Ação não encontrada', 404, 'ACAO_NOT_FOUND');

    if (
      data.responsavelUserId !== undefined &&
      data.responsavelUserId !== null &&
      data.responsavelUserId !== existing.responsavelUserId
    ) {
      const user = await prisma.user.findFirst({
        where: { id: data.responsavelUserId, tenantId },
      });
      if (!user) throw createError('Usuário não encontrado', 404, 'USER_NOT_FOUND');
    }

    const updateData: Record<string, unknown> = {};
    if (data.descricao !== undefined) updateData.descricao = data.descricao;
    if (data.responsavelConsultor !== undefined)
      updateData.responsavelConsultor = data.responsavelConsultor;
    if (data.responsavelUserId !== undefined) updateData.responsavelUserId = data.responsavelUserId;
    if (data.dueDate !== undefined) updateData.dueDate = data.dueDate;

    const viraConcluida = data.status === 'CONCLUIDA' && existing.status !== 'CONCLUIDA';
    if (data.status !== undefined) {
      updateData.status = data.status;
      if (viraConcluida) updateData.concluidaEm = new Date();
    }

    const item = await prisma.planoAcaoItem.update({ where: { id: existing.id }, data: updateData });

    if (viraConcluida) {
      const now = new Date();
      await prisma.registroOportunidade.update({
        where: { id: existing.registroId },
        data: { ultimaAtividadeEm: now },
      });
      // Ação do consultor concluída (mesmo quando pelo GESTOR): reflete atividade
      // do consultor — busca o consultorId via registro, escopado ao tenant.
      if (existing.responsavelConsultor) {
        const registro = await prisma.registroOportunidade.findFirst({
          where: { id: existing.registroId, tenantId },
          select: { consultorId: true },
        });
        if (registro) {
          await prisma.consultor.update({
            where: { id: registro.consultorId },
            data: { ultimaAtividadeEm: now },
          });
        }
      }
    }

    return item;
  },

  async remove(tenantId: string, id: string) {
    const existing = await prisma.planoAcaoItem.findFirst({ where: { id, tenantId } });
    if (!existing) throw createError('Ação não encontrada', 404, 'ACAO_NOT_FOUND');
    await prisma.planoAcaoItem.delete({ where: { id: existing.id } });
    return { id };
  },

  /**
   * Via do PORTAL — o consultor só conclui ação DELE (responsavelConsultor=true)
   * em registro próprio. Atualiza a última atividade do registro E do consultor.
   */
  async concluirDoConsultor(tenantId: string, consultorId: string, id: string) {
    const existing = await prisma.planoAcaoItem.findFirst({
      where: {
        id,
        tenantId,
        responsavelConsultor: true,
        registro: { consultorId, deletedAt: null },
      },
    });
    if (!existing) throw createError('Ação não encontrada', 404, 'ACAO_NOT_FOUND');

    const now = new Date();
    const item = await prisma.planoAcaoItem.update({
      where: { id: existing.id },
      data: { status: 'CONCLUIDA', concluidaEm: now },
    });

    await prisma.registroOportunidade.update({
      where: { id: existing.registroId },
      data: { ultimaAtividadeEm: now },
    });
    await prisma.consultor.update({
      where: { id: consultorId },
      data: { ultimaAtividadeEm: now },
    });

    return item;
  },
};
