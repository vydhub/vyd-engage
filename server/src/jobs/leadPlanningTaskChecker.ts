import prisma from '../config/database.js';
import { LeadStatus, TaskPriority, TaskType } from '@prisma/client';
import { logger } from '../utils/logger.js';

/**
 * Tarefa automática de planejamento (spec req. 48 + caso extremo 11).
 *
 * Padrão sempre-ativo sem BullMQ/Redis (clientFollowUpChecker/salesOps):
 * setInterval com primeira passada ~30s após o boot. A cada ciclo, varre por
 * tenant os leads (não-contato, não-deletados, status NOVO/EM_ANDAMENTO)
 * criados há mais de LEAD_PLANNING_GRACE_HOURS que NUNCA tiveram Task
 * vinculada — "nunca": nenhuma linha de Task com leadId, INCLUINDO tarefas
 * soft-deleted e concluídas (caso extremo 11: tarefa criada e apagada ou
 * concluída dentro da carência conta como "teve tarefa" — não recria).
 *
 * Para cada lead elegível cria a Task "Planejamento de próximas ações"
 * (type FOLLOW_UP, priority MEDIUM, vencimento em LEAD_PLANNING_DUE_DAYS dias,
 * responsável = responsável comercial do lead; null se sem responsável — caso
 * extremo 11). A tarefa entra sozinha nas notificações de vencimento existentes
 * (taskNotificationChecker).
 *
 * Janelas configuráveis por env (para testes): LEAD_PLANNING_CHECK_INTERVAL_MS
 * (default 1h), LEAD_PLANNING_GRACE_HOURS (default 24) e LEAD_PLANNING_DUE_DAYS
 * (default 15).
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const DEFAULT_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hora
const DEFAULT_GRACE_HOURS = 24;
const DEFAULT_DUE_DAYS = 15;
const INITIAL_DELAY_MS = 30 * 1000; // 30 segundos

/** Título fixo da tarefa automática — também é o prefixo de dedup. */
export const PLANNING_TASK_TITLE = 'Planejamento de próximas ações';

/** Teto de leads processados por tenant em cada varredura. */
const TENANT_SWEEP_LIMIT = 500;

// Lidos a cada chamada (não no load do módulo) para os testes poderem ajustar
// o env antes de invocar a varredura.
function getGraceHours(): number {
  const parsed = Number(process.env.LEAD_PLANNING_GRACE_HOURS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_GRACE_HOURS;
}

function getDueDays(): number {
  const parsed = Number(process.env.LEAD_PLANNING_DUE_DAYS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DUE_DAYS;
}

function getCheckIntervalMs(): number {
  const parsed = Number(process.env.LEAD_PLANNING_CHECK_INTERVAL_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CHECK_INTERVAL_MS;
}

async function sweepTenantPlanningTasks(
  tenantId: string,
  cutoff: Date,
  dueDate: Date
): Promise<number> {
  // "Nunca teve tarefa" = nenhuma Task com este leadId, sem filtro de
  // deletedAt/status — soft-deleted e concluídas CONTAM como "teve tarefa".
  const leads = await prisma.lead.findMany({
    where: {
      tenantId,
      isContact: false,
      deletedAt: null,
      status: { in: [LeadStatus.NOVO, LeadStatus.EM_ANDAMENTO] },
      createdAt: { lte: cutoff },
      tasks: { none: {} },
    },
    select: { id: true, name: true, assignedTo: true },
    orderBy: { createdAt: 'asc' },
    take: TENANT_SWEEP_LIMIT,
  });
  if (leads.length === 0) return 0;
  if (leads.length === TENANT_SWEEP_LIMIT) {
    logger.warn(
      `Lead planning task checker: tenant ${tenantId} sweep truncated at ${TENANT_SWEEP_LIMIT} leads`
    );
  }

  let created = 0;
  for (const lead of leads) {
    // Dedup adicional por prefixo de título (padrão FOLLOWUP_TASK_TITLE_PREFIX):
    // protege contra corrida entre varreduras/instâncias.
    const existing = await prisma.task.findFirst({
      where: {
        tenantId,
        leadId: lead.id,
        deletedAt: null,
        title: { startsWith: PLANNING_TASK_TITLE },
      },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.task.create({
      data: {
        tenantId,
        leadId: lead.id,
        title: PLANNING_TASK_TITLE,
        description: `Tarefa criada automaticamente: o lead "${lead.name}" foi criado sem nenhuma tarefa de acompanhamento.`,
        type: TaskType.FOLLOW_UP,
        priority: TaskPriority.MEDIUM,
        dueDate,
        // Lead sem responsável → tarefa sem assignedTo (caso extremo 11).
        assignedTo: lead.assignedTo || null,
      },
    });
    created++;
  }

  if (created > 0) {
    logger.info(
      `Lead planning task checker: tenant ${tenantId} — scanned ${leads.length} leads, created ${created} tasks`
    );
  }
  return created;
}

/**
 * Varredura completa (todos os tenants). Exportada pura para testes — recebe o
 * "agora" opcional e devolve quantas tarefas de planejamento foram criadas.
 */
export async function checkLeadPlanningTasks(now: Date = new Date()): Promise<number> {
  let created = 0;
  try {
    const cutoff = new Date(now.getTime() - getGraceHours() * HOUR_MS);
    const dueDate = new Date(now.getTime() + getDueDays() * DAY_MS);

    const tenants = await prisma.tenant.findMany({ select: { id: true } });
    for (const tenant of tenants) {
      try {
        created += await sweepTenantPlanningTasks(tenant.id, cutoff, dueDate);
      } catch (err) {
        logger.error(`Lead planning task sweep failed for tenant ${tenant.id}`, err);
      }
    }

    if (created > 0) {
      logger.info(`Lead planning task checker: created ${created} planning tasks in total`);
    }
  } catch (error) {
    logger.error('Lead planning task checker failed', error);
  }
  return created;
}

// ── Boot (sempre-ativo, sem Redis) ───────────────────────────────────────────

let intervalId: ReturnType<typeof setInterval> | null = null;
let initialTimeoutId: ReturnType<typeof setTimeout> | null = null;

export function startLeadPlanningTaskChecker() {
  const intervalMs = getCheckIntervalMs();

  // Atraso inicial de 30s para não competir com o boot do servidor.
  initialTimeoutId = setTimeout(() => {
    checkLeadPlanningTasks();
    intervalId = setInterval(() => {
      checkLeadPlanningTasks();
    }, intervalMs);
  }, INITIAL_DELAY_MS);

  logger.info(
    `Lead planning task checker initialized (interval: ${intervalMs}ms, grace: ${getGraceHours()}h, due: ${getDueDays()} days, initial delay: 30s)`
  );
}

export function stopLeadPlanningTaskChecker() {
  if (initialTimeoutId) {
    clearTimeout(initialTimeoutId);
    initialTimeoutId = null;
  }
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
