import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../config/database.js';
import { taskService } from '../services/taskService.js';
import { authenticateOrApiKey } from '../middleware/apiKeyAuth.js';
import { tenantScope } from '../middleware/tenant.js';
import { createError } from '../middleware/errorHandler.js';
import { TaskStatus, TaskPriority, TaskType, NotificationType } from '@prisma/client';
import { notificationService } from '../services/notificationService.js';
import { googleCalendarService } from '../services/googleCalendarService.js';
import { emitToTenant } from '../services/socketService.js';
import { approvalService } from '../services/approvalService.js';
import { visibilityScope, getEffective } from '../services/permissionService.js';

const router = Router();

router.use(authenticateOrApiKey('tasks:read'));
router.use(tenantScope);

const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  priority: z.nativeEnum(TaskPriority).optional(),
  assignedTo: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  dueDate: z.coerce.date().optional(),
  // Desdobramento comercial — vínculos da ação (agenda do roadmap).
  type: z.nativeEnum(TaskType).optional(),
  companyId: z.string().uuid().optional(),
  empreendimentoId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
  roadmapId: z.string().uuid().optional(),
});

const updateTaskSchema = createTaskSchema.partial().extend({
  id: z.string().uuid(),
  // Update parcial: title não é obrigatório; dueDate aceita null p/ limpar.
  dueDate: z.coerce.date().nullable().optional(),
});

const registerActionSchema = z.object({
  outcome: z.enum(['REALIZADA', 'SEM_CONTATO', 'REAGENDAR']),
  note: z.string().max(2000).optional(),
  date: z.coerce.date().optional(),
  newDueDate: z.coerce.date().optional(),
});

const querySchema = z.object({
  status: z.nativeEnum(TaskStatus).optional(),
  priority: z.nativeEnum(TaskPriority).optional(),
  assignedTo: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  overdue: z.coerce.boolean().optional(),
  dueToday: z.coerce.boolean().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

router.get('/', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const filters = querySchema.parse(req.query);
    // Visibilidade viva (req 14): tarefas acompanham o nível de 'deals' (mesma dona).
    // Sem perfil custom, idêntico ao ownerScope de hoje (analista→userId).
    const scopedFilters = {
      ...filters,
      assignedTo: await visibilityScope(req.user, 'tasks', filters.assignedTo),
    };
    const result = await taskService.findAll(req.user.tenantId, scopedFilters);
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
    }
    next(error);
  }
});

// Guard de posse (req 6 + visibilidade viva req 14): tarefas acompanham o nível de
// 'deals'. Acesso a /:id* liberado quando o dono da tarefa ∈ escopo efetivo —
// próprio (PROPRIA), equipe (EQUIPE) ou qualquer do tenant (GERAL). Fora → 404.
// FAIL-CLOSED / == HOJE: sem perfil custom, USER builtin tem deals=PROPRIA →
// escopo = userId → 404 idêntico; GESTOR/ADMIN GERAL → passam direto.
async function enforceTaskOwnership(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) return next(createError('Authentication required', 401));
    const scope = await visibilityScope(req.user, 'tasks');
    if (scope === undefined) return next(); // GERAL: sem filtro por dono.
    const owned = await prisma.task.findFirst({
      where: {
        id: req.params.id,
        tenantId: req.user.tenantId,
        deletedAt: null,
        assignedTo: scope,
      },
      select: { id: true },
    });
    if (!owned) return next(createError('Task not found', 404, 'TASK_NOT_FOUND'));
    return next();
  } catch (err) {
    next(err);
  }
}
router.use('/:id', enforceTaskOwnership);

router.get('/:id', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    const task = await taskService.findById(req.user.tenantId, req.params.id);
    res.json(task);
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    // Capability por-entidade (req 13): criar tarefas exige entities.tasks.create.
    const eff = await getEffective({
      userId: req.user.userId,
      tenantId: req.user.tenantId,
      role: req.user.role,
      isPlatformAdmin: req.user.isPlatformAdmin,
    });
    if (!eff.entities.tasks.create) {
      return next(createError('Insufficient permissions', 403, 'INSUFFICIENT_PERMISSIONS'));
    }

    // Tasks don't have plan limits, but we could add if needed
    const data = createTaskSchema.parse(req.body);
    // transferOwner (req 13): atribuir a outra pessoa exige a capability (perfil).
    // Sem ela, o dono é forçado a si mesmo — piso do analista de hoje.
    if (eff.capabilities.transferOwner !== true) data.assignedTo = req.user.userId;
    const task = await taskService.create(req.user.tenantId, data);

    // Notify assignee if task is assigned to someone other than the creator
    if (data.assignedTo && data.assignedTo !== req.user.userId) {
      notificationService
        .create(req.user.tenantId, {
          userId: data.assignedTo,
          type: NotificationType.TASK_DUE,
          title: 'Nova tarefa atribuída',
          message: `A tarefa "${task.title}" foi atribuída a você.${task.dueDate ? ` Vencimento: ${new Date(task.dueDate).toLocaleDateString('pt-BR')}.` : ''}`,
          link: `/app/tasks`,
          metadata: { taskId: task.id, taskTitle: task.title, dueDate: task.dueDate },
        })
        .catch(() => {});
    }

    // Google Calendar sync (fire-and-forget)
    googleCalendarService.syncTaskForUser(req.user.userId, req.user.tenantId, task).catch(() => {});

    // Emit Socket.IO event for real-time cache updates
    emitToTenant(req.user.tenantId, 'task:created', { task });

    res.status(201).json(task);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
    }
    next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    // Capability por-entidade (req 13): editar tarefas exige entities.tasks.edit.
    const eff = await getEffective({
      userId: req.user.userId,
      tenantId: req.user.tenantId,
      role: req.user.role,
      isPlatformAdmin: req.user.isPlatformAdmin,
    });
    if (!eff.entities.tasks.edit) {
      return next(createError('Insufficient permissions', 403, 'INSUFFICIENT_PERMISSIONS'));
    }

    const data = updateTaskSchema.parse({
      ...req.body,
      id: req.params.id,
    });
    // transferOwner (req 13): reatribuir exige a capability (perfil). Sem ela, o
    // campo assignedTo é ignorado — piso do analista de hoje.
    if (eff.capabilities.transferOwner !== true) delete data.assignedTo;
    const task = await taskService.update(req.user.tenantId, data);

    // Notify new assignee if task was reassigned to someone else
    if (data.assignedTo && data.assignedTo !== req.user.userId) {
      notificationService
        .create(req.user.tenantId, {
          userId: data.assignedTo,
          type: NotificationType.TASK_DUE,
          title: 'Tarefa atribuída a você',
          message: `A tarefa "${task.title}" foi atribuída a você.${task.dueDate ? ` Vencimento: ${new Date(task.dueDate).toLocaleDateString('pt-BR')}.` : ''}`,
          link: `/app/tasks`,
          metadata: { taskId: task.id, taskTitle: task.title, dueDate: task.dueDate },
        })
        .catch(() => {});
    }

    // Google Calendar sync (fire-and-forget)
    googleCalendarService.syncTaskForUser(req.user.userId, req.user.tenantId, task).catch(() => {});

    // Emit Socket.IO event for real-time cache updates
    emitToTenant(req.user.tenantId, 'task:updated', { task });

    res.json(task);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
    }
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }

    // Gate de exclusão (req 16): sem permissão OU perfil exige aprovação → cria
    // solicitação (não deleta) + 202. A guarda de posse (enforceTaskOwnership) já
    // rodou no router.use('/:id'). Sem perfil custom → deleta direto (== hoje).
    const gate = await approvalService.deleteGate(
      {
        userId: req.user.userId,
        tenantId: req.user.tenantId,
        role: req.user.role,
        isPlatformAdmin: req.user.isPlatformAdmin,
      },
      'tasks',
      req.params.id,
      'tarefa'
    );
    if (gate.queued) {
      return res.status(202).json({ status: 202, data: { approvalId: gate.approvalId, pending: true } });
    }

    // Fetch task before deleting to get googleEventId for calendar cleanup
    const taskToDelete = await taskService.findById(req.user.tenantId, req.params.id);
    const googleEventId = (taskToDelete as any).googleEventId;

    await taskService.delete(req.user.tenantId, req.params.id);

    // Google Calendar cleanup (fire-and-forget)
    if (googleEventId) {
      googleCalendarService
        .deleteEventForUser(req.user.userId, req.user.tenantId, googleEventId)
        .catch(() => {});
    }

    // Emit Socket.IO event for real-time cache updates
    emitToTenant(req.user.tenantId, 'task:deleted', { taskId: req.params.id });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Registrar desfecho de uma ação da agenda (desdobramento): loga interação no
// histórico do CRM e conclui/reagenda a tarefa conforme o desfecho.
router.post('/:id/register', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }
    const input = registerActionSchema.parse(req.body);
    if (input.outcome === 'REAGENDAR' && !input.newDueDate) {
      return next(createError('Nova data é obrigatória para reagendar', 400, 'VALIDATION_ERROR'));
    }
    const task = await taskService.registerAction(
      req.user.tenantId,
      req.params.id,
      input,
      req.user.userId
    );
    emitToTenant(req.user.tenantId, 'task:updated', { task });
    res.json(task);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
    }
    next(error);
  }
});

export default router;
