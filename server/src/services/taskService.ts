import prisma from '../config/database.js';
import {
  TaskStatus,
  TaskPriority,
  TaskType,
  InteractionType,
  InteractionDirection,
} from '@prisma/client';
import { createError } from '../middleware/errorHandler.js';
import { dispatchTrigger } from '../jobs/automationEngine.js';
import { webhookDispatcher } from './webhookDispatcher.js';

export interface CreateTaskData {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignedTo?: string;
  leadId?: string;
  // Desdobramento comercial — tipo de ação + vínculos (agenda das ações).
  dealId?: string;
  companyId?: string;
  empreendimentoId?: string;
  roadmapId?: string;
  type?: TaskType;
  dueDate?: Date | string;
}

export interface UpdateTaskData extends Partial<Omit<CreateTaskData, 'dueDate'>> {
  id: string;
  // null limpa a data; undefined não toca (evita apagar em updates parciais).
  dueDate?: Date | string | null;
}

/** Mapeia o tipo de ação da agenda para o tipo de interação do histórico. */
function mapTaskTypeToInteraction(type: TaskType | null): InteractionType {
  switch (type) {
    case TaskType.LIGACAO:
      return InteractionType.CALL;
    case TaskType.REUNIAO:
    case TaskType.VISITA:
    // Visita técnica é presencial — paridade com VISITA (spec req. 39)
    case TaskType.VISITA_TECNICA:
    case TaskType.APRESENTACAO:
      return InteractionType.MEETING;
    case TaskType.EMAIL:
      return InteractionType.EMAIL;
    // Deliberado (spec req. 39): follow-up não presume canal e preparação de
    // documento é trabalho interno — ambos entram no histórico como NOTE.
    case TaskType.FOLLOW_UP:
    case TaskType.PREPARACAO_DOCUMENTO:
      return InteractionType.NOTE;
    default:
      return InteractionType.NOTE;
  }
}

export const taskService = {
  async create(tenantId: string, data: CreateTaskData) {
    const task = await prisma.task.create({
      data: {
        tenantId,
        title: data.title,
        description: data.description,
        status: data.status || TaskStatus.PENDING,
        priority: data.priority || TaskPriority.MEDIUM,
        assignedTo: data.assignedTo,
        leadId: data.leadId,
        dealId: data.dealId,
        companyId: data.companyId,
        empreendimentoId: data.empreendimentoId,
        roadmapId: data.roadmapId,
        type: data.type,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
      },
    });

    return this.findById(tenantId, task.id);
  },

  async findById(tenantId: string, id: string) {
    const task = await prisma.task.findFirst({
      where: {
        id,
        tenantId,
        deletedAt: null,
      },
      include: {
        lead: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!task) {
      throw createError('Task not found', 404, 'TASK_NOT_FOUND');
    }

    return task;
  },

  async findAll(
    tenantId: string,
    filters?: {
      status?: TaskStatus;
      priority?: TaskPriority;
      // Escopo de responsável: um dono (string) ou o conjunto da equipe ({in}) — req 14.
      assignedTo?: string | { in: string[] };
      leadId?: string;
      overdue?: boolean;
      dueToday?: boolean;
      startDate?: Date;
      endDate?: Date;
      page?: number;
      limit?: number;
    }
  ) {
    const page = filters?.page || 1;
    const limit = filters?.limit || 50;
    const skip = (page - 1) * limit;

    const where: any = {
      tenantId,
      deletedAt: null,
    };

    if (filters?.status) {
      where.status = filters.status;
    }

    if (filters?.priority) {
      where.priority = filters.priority;
    }

    if (filters?.assignedTo) {
      where.assignedTo = filters.assignedTo;
    }

    if (filters?.leadId) {
      where.leadId = filters.leadId;
    }

    if (filters?.startDate && filters?.endDate) {
      where.dueDate = {
        gte: filters.startDate,
        lte: new Date(new Date(filters.endDate).setHours(23, 59, 59, 999)),
      };
    } else if (filters?.overdue) {
      where.dueDate = {
        lt: new Date(),
      };
      where.status = {
        not: TaskStatus.COMPLETED,
      };
    } else if (filters?.dueToday) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      where.dueDate = {
        gte: today,
        lt: tomorrow,
      };
    }

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        include: {
          lead: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      prisma.task.count({ where }),
    ]);

    return {
      tasks,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  async update(tenantId: string, data: UpdateTaskData) {
    const existing = await this.findById(tenantId, data.id);

    const updateData: any = {
      title: data.title,
      description: data.description,
      status: data.status,
      priority: data.priority,
      assignedTo: data.assignedTo,
      leadId: data.leadId,
    };
    // Só toca dueDate quando explicitamente enviado (data, ou null p/ limpar);
    // senão updates parciais (concluir/atribuir) apagariam a data da ação.
    if (data.dueDate !== undefined) {
      updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
    }

    // If marking as completed, set completedAt
    if (data.status === 'COMPLETED') {
      updateData.completedAt = new Date();
    } else if (data.status) {
      updateData.completedAt = null;
    }

    // Remove undefined values
    Object.keys(updateData).forEach((key) => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });

    const task = await prisma.task.update({
      where: { id: data.id },
      data: updateData,
      include: {
        lead: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    // On transition to COMPLETED: fire outgoing webhook (req: task.completed) +
    // automation trigger (lead-linked only). Both fire-and-forget.
    if (existing.status !== 'COMPLETED' && task.status === 'COMPLETED') {
      webhookDispatcher.emitTaskEvent(tenantId, 'task.completed', task);
      if (task.leadId) {
        dispatchTrigger(tenantId, 'task_completed', task.leadId, {
          taskId: task.id,
          title: task.title,
        }).catch(() => {});
      }
    }

    return task;
  },

  /**
   * Registra o desfecho de uma ação da agenda (desdobramento comercial): cria uma
   * Interação no histórico do CRM (vinculada a lead/deal/empresa quando houver) e
   * conclui ou reagenda a tarefa conforme o desfecho escolhido.
   */
  async registerAction(
    tenantId: string,
    taskId: string,
    input: {
      outcome: 'REALIZADA' | 'SEM_CONTATO' | 'REAGENDAR';
      note?: string;
      date?: Date | string;
      newDueDate?: Date | string;
    },
    userId?: string
  ) {
    const task = await this.findById(tenantId, taskId);

    const when = input.date ? new Date(input.date) : new Date();
    const outcomeLabel =
      input.outcome === 'REALIZADA'
        ? 'Realizada'
        : input.outcome === 'SEM_CONTATO'
          ? 'Sem contato'
          : 'Reagendada';
    const note = input.note?.trim();
    const content = note
      ? `[${outcomeLabel}] ${note}`
      : `Ação ${outcomeLabel.toLowerCase()}: ${task.title}`;

    // Loga no histórico do CRM. Import dinâmico evita ciclo de módulos.
    const { interactionService } = await import('./interactionService.js');
    await interactionService.create(tenantId, {
      type: mapTaskTypeToInteraction(task.type ?? null),
      direction: InteractionDirection.OUTBOUND,
      subject: task.title,
      content,
      leadId: task.leadId ?? undefined,
      dealId: task.dealId ?? undefined,
      companyId: task.companyId ?? undefined,
      userId,
      metadata: {
        source: 'roadmap_action',
        taskId: task.id,
        outcome: input.outcome,
        executedAt: when.toISOString(),
      },
    });

    // Atualiza a tarefa conforme o desfecho.
    if (input.outcome === 'REAGENDAR') {
      return this.update(tenantId, { id: taskId, dueDate: input.newDueDate ?? null });
    }
    // REALIZADA / SEM_CONTATO → concluída (a ação foi executada/tentada).
    return this.update(tenantId, { id: taskId, status: TaskStatus.COMPLETED });
  },

  async delete(tenantId: string, id: string) {
    await this.findById(tenantId, id);
    await prisma.task.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  },

  async count(tenantId: string) {
    return prisma.task.count({
      where: { tenantId, deletedAt: null },
    });
  },
};
