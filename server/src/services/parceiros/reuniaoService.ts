// Cadência de reuniões com consultores comerciais (model ConsultorReuniao).
// Presença alimenta o score do consultor; reunião REALIZADA espelha uma
// Interaction type MEETING (best-effort, sem lead/deal/company).

import prisma from '../../config/database.js';
import { createError } from '../../middleware/errorHandler.js';
import type { PresencaStatus, ReuniaoStatus } from '@prisma/client';

export const reuniaoService = {
  async list(
    tenantId: string,
    filters: { consultorId?: string; status?: ReuniaoStatus } = {}
  ) {
    return prisma.consultorReuniao.findMany({
      where: {
        tenantId,
        ...(filters.consultorId ? { consultorId: filters.consultorId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
      orderBy: { dataHora: 'desc' },
      include: { consultor: { select: { id: true, nome: true } } },
    });
  },

  async create(
    tenantId: string,
    data: { consultorId: string; dataHora: Date; pauta?: string | null; participantes?: string[] | null; criadoPorId?: string }
  ) {
    const consultor = await prisma.consultor.findFirst({
      where: { id: data.consultorId, tenantId, deletedAt: null },
    });
    if (!consultor) throw createError('Consultor não encontrado', 404, 'CONSULTOR_NOT_FOUND');

    return prisma.consultorReuniao.create({
      data: {
        tenantId,
        consultorId: data.consultorId,
        dataHora: data.dataHora,
        pauta: data.pauta ?? null,
        participantes: data.participantes ?? undefined,
        status: 'AGENDADA',
        criadoPorId: data.criadoPorId ?? null,
      },
      include: { consultor: { select: { id: true, nome: true } } },
    });
  },

  async update(
    tenantId: string,
    id: string,
    data: {
      dataHora?: Date;
      pauta?: string | null;
      participantes?: string[] | null;
      observacoes?: string | null;
      status?: ReuniaoStatus;
      presenca?: PresencaStatus;
    }
  ) {
    const existing = await prisma.consultorReuniao.findFirst({
      where: { id, tenantId },
      include: { consultor: true },
    });
    if (!existing) throw createError('Reunião não encontrada', 404, 'REUNIAO_NOT_FOUND');

    // Transição para REALIZADA exige presença: sem ela a reunião "some" do score
    // (filtro presenca != null) e de vencidas() (filtro AGENDADA). Aceitamos a
    // presença no próprio update; se REALIZADA vier sem presença (nem no payload,
    // nem já registrada), rejeitamos direcionando p/ registrarPresenca.
    const viraRealizada = data.status === 'REALIZADA' && existing.status !== 'REALIZADA';
    const presencaEfetiva = data.presenca ?? existing.presenca;
    if (viraRealizada && presencaEfetiva === null) {
      throw createError(
        'Registre a presença do consultor ao marcar a reunião como realizada',
        400,
        'PRESENCA_REQUIRED'
      );
    }

    const reuniao = await prisma.consultorReuniao.update({
      where: { id },
      data: {
        ...(data.dataHora !== undefined ? { dataHora: data.dataHora } : {}),
        ...(data.pauta !== undefined ? { pauta: data.pauta } : {}),
        ...(data.participantes !== undefined ? { participantes: data.participantes ?? undefined } : {}),
        ...(data.observacoes !== undefined ? { observacoes: data.observacoes } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.presenca !== undefined ? { presenca: data.presenca } : {}),
      },
      include: { consultor: { select: { id: true, nome: true } } },
    });

    // Presença PRESENTE (nova) toca a última atividade do consultor e espelha
    // a reunião como Interaction MEETING — mesma semântica de registrarPresenca.
    const presencaNova = data.presenca !== undefined && data.presenca !== existing.presenca;
    if (presencaNova && data.presenca === 'PRESENTE') {
      await prisma.consultor.update({
        where: { id: existing.consultorId },
        data: { ultimaAtividadeEm: new Date() },
      });
      await prisma.interaction
        .create({
          data: {
            tenantId,
            type: 'MEETING',
            direction: 'OUTBOUND',
            subject: 'Reunião com consultor',
            content: `Reunião de cadência com ${existing.consultor.nome}${
              data.observacoes ? ' — ' + data.observacoes : ''
            }`,
            metadata: { consultorId: existing.consultorId, reuniaoId: id },
          },
        })
        .catch(() => {});
    }

    return reuniao;
  },

  async registrarPresenca(
    tenantId: string,
    id: string,
    presenca: PresencaStatus,
    observacoes?: string
  ) {
    const existing = await prisma.consultorReuniao.findFirst({
      where: { id, tenantId },
      include: { consultor: true },
    });
    if (!existing) throw createError('Reunião não encontrada', 404, 'REUNIAO_NOT_FOUND');

    const reuniao = await prisma.consultorReuniao.update({
      where: { id },
      data: {
        status: 'REALIZADA',
        presenca,
        ...(observacoes !== undefined ? { observacoes } : {}),
      },
      include: { consultor: { select: { id: true, nome: true } } },
    });

    if (presenca === 'PRESENTE') {
      await prisma.consultor.update({
        where: { id: existing.consultorId },
        data: { ultimaAtividadeEm: new Date() },
      });
      // Espelha a reunião como Interaction MEETING (best-effort, sem lead/deal/company).
      await prisma.interaction
        .create({
          data: {
            tenantId,
            type: 'MEETING',
            direction: 'OUTBOUND',
            subject: 'Reunião com consultor',
            content: `Reunião de cadência com ${existing.consultor.nome}${observacoes ? ' — ' + observacoes : ''}`,
            metadata: { consultorId: existing.consultorId, reuniaoId: id },
          },
        })
        .catch(() => {});
    }

    return reuniao;
  },

  async remove(tenantId: string, id: string) {
    const existing = await prisma.consultorReuniao.findFirst({ where: { id, tenantId } });
    if (!existing) throw createError('Reunião não encontrada', 404, 'REUNIAO_NOT_FOUND');
    await prisma.consultorReuniao.delete({ where: { id } });
    return { id };
  },

  async vencidas(tenantId: string) {
    return prisma.consultorReuniao.findMany({
      where: { tenantId, status: 'AGENDADA', dataHora: { lt: new Date() } },
      include: { consultor: { select: { id: true, nome: true } } },
      orderBy: { dataHora: 'asc' },
    });
  },
};
