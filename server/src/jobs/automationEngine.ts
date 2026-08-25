import { Queue, Worker, Job } from 'bullmq';
import { logger } from '../utils/logger.js';
import prisma from '../config/database.js';
import { AutomationLogStatus, AutomationStepType, NotificationType } from '@prisma/client';
import { normalizeLeadStatus, normalizeLeadSource } from '../utils/leadLegacy.js';
import { automationService } from '../services/automationService.js';
import { whatsappMessagingService } from '../services/whatsappMessagingService.js';
import { emailMessagingService } from '../services/emailMessagingService.js';
import { notificationService } from '../services/notificationService.js';
import { interpolateMergeTags, type MergeContext } from '../utils/mergeTags.js';
import { computeDelayMs, evaluateCondition } from '../utils/automationEval.js';
import { assertPublicHttpUrl } from '../utils/safeFetch.js';
import { webhookDispatcher } from '../services/webhookDispatcher.js';
import { getBullConnection } from '../config/redis.js';

const redisConnection = getBullConnection();

// ========================
// Types
// ========================

export interface AutomationJobData {
  automationId: string;
  tenantId: string;
  leadId?: string;
  dealId?: string;
  triggerEvent: string;
  triggerData?: Record<string, any>;
  /** Modelo de grafo: id do nó atual a executar. */
  currentNodeId?: string;
  /** Legado (modelo linear por índice). Mantido para jobs/automes antigos. */
  currentStepIndex?: number;
  executionId: string;
}

export type AutomationStepType2 =
  | 'send_whatsapp'
  | 'send_email'
  | 'delay'
  | 'update_lead'
  | 'condition'
  | 'add_tag'
  | 'remove_tag'
  | 'create_task'
  | 'send_webhook';

export interface AutomationStep {
  type: AutomationStepType2;
  config: Record<string, any>;
}

/**
 * Passo normalizado do grafo: id + arestas de saída. Tolera automações antigas
 * (sem id/next) tratando-as como cadeia linear.
 */
export interface NormalizedStep {
  id: string;
  type: AutomationStepType2;
  delay?: string;
  config: Record<string, any>;
  next: string[];
  trueNext?: string[];
  falseNext?: string[];
}

/**
 * Normaliza os steps persistidos para o modelo de grafo, tolerando automações
 * ANTIGAS (formato linear, sem id/next, e com vocabulário da UI):
 *  - sem `next`: encadeia ao step seguinte por ordem;
 *  - condition sem `trueNext`/`falseNext`: deriva de config.trueBranch/falseBranch
 *    (converter antigo gravava node-ids) e, na falta, segue linearmente (`next`),
 *    preservando o comportamento histórico "condição sempre continua";
 *  - remapeia tipos legados: `wait_delay` → `delay`, `update_field` (config
 *    {field,value}) → `update_lead` (config { [field]: value }, score numérico).
 */
export function normalizeSteps(rawSteps: unknown): NormalizedStep[] {
  const steps = Array.isArray(rawSteps) ? rawSteps : [];
  const idOf = (s: any, i: number) => (s && s.id) || `step_${i}`;

  return steps.map((s: any, i: number) => {
    const next: string[] = Array.isArray(s?.next)
      ? s.next
      : i + 1 < steps.length
        ? [idOf(steps[i + 1], i + 1)]
        : [];

    // Remapeia vocabulário legado da UI para o vocabulário do engine.
    let type = s?.type;
    let config = s?.config || {};
    if (type === 'wait_delay') {
      type = 'delay';
    } else if (type === 'update_field') {
      const field = config.field || 'status';
      const raw = config.value;
      config = { [field]: field === 'score' ? Number(raw) : raw };
      type = 'update_lead';
    }

    let trueNext = Array.isArray(s?.trueNext) ? s.trueNext : undefined;
    let falseNext = Array.isArray(s?.falseNext) ? s.falseNext : undefined;
    if (type === 'condition') {
      if (!trueNext) trueNext = s?.config?.trueBranch ? [s.config.trueBranch] : next;
      if (!falseNext) falseNext = s?.config?.falseBranch ? [s.config.falseBranch] : next;
    }

    return { id: idOf(s, i), type, delay: s?.delay, config, next, trueNext, falseNext };
  });
}

export interface AutomationTrigger {
  type:
    | 'lead_created'
    | 'status_changed'
    | 'tag_added'
    | 'manual'
    | 'deal_created'
    | 'deal_stage_changed';
  conditions?: Record<string, any>;
}

// Map lowercase step type (from JSON config) to Prisma enum value
const stepTypeToEnum: Record<string, AutomationStepType> = {
  delay: AutomationStepType.DELAY,
  update_lead: AutomationStepType.UPDATE_LEAD,
  add_tag: AutomationStepType.ADD_TAG,
  remove_tag: AutomationStepType.REMOVE_TAG,
  condition: AutomationStepType.CONDITION,
  send_whatsapp: AutomationStepType.SEND_WHATSAPP,
  send_email: AutomationStepType.SEND_EMAIL,
};

export interface AutomationSchedule {
  enabled: boolean;
  days: number[]; // 0=Sunday, 1=Monday, ...6=Saturday
  startHour: number; // 0-23
  endHour: number; // 0-23
  timezone: string;
}

// ========================
// Queue
// ========================

export const automationQueue = new Queue('automations', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000, // 5s, then 25s, then 125s
    },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

// Dead letter queue for permanently failed jobs
export const automationDLQ = new Queue('automations-dlq', {
  connection: redisConnection,
});

// ========================
// Step Executor
// ========================

async function executeStep(
  step: AutomationStep,
  jobData: AutomationJobData
): Promise<{ success: boolean; message: string; data?: any }> {
  switch (step.type) {
    case 'delay': {
      // O agendamento do próximo passo é feito pelo worker (após este retorno),
      // usando computeDelayMs(step.config). Aqui só sinalizamos sucesso.
      return { success: true, message: 'Atraso aplicado' };
    }

    case 'update_lead': {
      if (!jobData.leadId) return { success: false, message: 'Step update_lead requer leadId' };
      const updateData: any = {};
      if (step.config.status !== undefined) updateData.status = step.config.status;
      if (step.config.assignedTo !== undefined) updateData.assignedTo = step.config.assignedTo;
      if (step.config.source !== undefined) updateData.source = step.config.source;
      if (step.config.score !== undefined) updateData.score = Number(step.config.score);
      if (step.config.customFields !== undefined)
        updateData.customFields = step.config.customFields;

      if (Object.keys(updateData).length === 0) {
        return { success: true, message: 'Nada para atualizar' };
      }

      await prisma.lead.update({
        where: { id: jobData.leadId },
        data: updateData,
      });

      return { success: true, message: `Lead atualizado: ${JSON.stringify(updateData)}` };
    }

    case 'add_tag': {
      if (!jobData.leadId) return { success: false, message: 'Step add_tag requer leadId' };
      // UI grava tagName; resolvemos para tagId (criando a tag se necessário).
      let tagId: string | undefined = step.config.tagId;
      const tagName: string | undefined = step.config.tagName;
      if (!tagId && tagName) {
        const tag = await prisma.tag.upsert({
          where: { tenantId_name: { tenantId: jobData.tenantId, name: tagName } },
          update: {},
          create: { tenantId: jobData.tenantId, name: tagName },
        });
        tagId = tag.id;
      }
      if (!tagId) return { success: false, message: 'Tag não fornecida (tagName/tagId ausente)' };

      const existing = await prisma.leadTag.findFirst({
        where: { leadId: jobData.leadId, tagId },
      });
      if (!existing) {
        await prisma.leadTag.create({
          data: { leadId: jobData.leadId, tagId },
        });
      }
      return { success: true, message: `Tag ${tagName || tagId} adicionada` };
    }

    case 'remove_tag': {
      if (!jobData.leadId) return { success: false, message: 'Step remove_tag requer leadId' };
      // UI grava tagName; resolvemos para tagId. Tag inexistente = sucesso (no-op).
      let removeTagId: string | undefined = step.config.tagId;
      const tagName: string | undefined = step.config.tagName;
      if (!removeTagId && tagName) {
        const tag = await prisma.tag.findFirst({
          where: { tenantId: jobData.tenantId, name: tagName },
          select: { id: true },
        });
        if (!tag) return { success: true, message: `Tag "${tagName}" não existe (nada a remover)` };
        removeTagId = tag.id;
      }
      if (!removeTagId)
        return { success: false, message: 'Tag não fornecida (tagName/tagId ausente)' };

      await prisma.leadTag.deleteMany({
        where: { leadId: jobData.leadId, tagId: removeTagId },
      });
      return { success: true, message: `Tag ${tagName || removeTagId} removida` };
    }

    case 'create_task': {
      if (!step.config.title) return { success: false, message: 'Título da tarefa não fornecido' };

      const lead = await prisma.lead.findFirst({
        where: { id: jobData.leadId, tenantId: jobData.tenantId },
      });
      const ctx: MergeContext = {
        name: lead?.name,
        email: lead?.email,
        company: lead?.company,
        phone: lead?.phone,
      };
      const offset = step.config.dueDateOffset ? Number(step.config.dueDateOffset) : null;

      const task = await prisma.task.create({
        data: {
          tenantId: jobData.tenantId,
          leadId: jobData.leadId,
          title: interpolateMergeTags(step.config.title, ctx),
          assignedTo: step.config.assigneeId || null,
          dueDate: offset && offset > 0 ? new Date(Date.now() + offset * 86400000) : null,
        },
      });

      return { success: true, message: `Tarefa criada: ${task.title}`, data: { taskId: task.id } };
    }

    case 'send_webhook': {
      const url: string | undefined = step.config.url;
      if (!url) return { success: false, message: 'URL do webhook não fornecida' };

      // Anti-SSRF: bloqueia destinos internos (loopback, privados, metadados).
      try {
        await assertPublicHttpUrl(url);
      } catch (err: any) {
        return {
          success: false,
          message: `URL de webhook bloqueada: ${err?.message || 'destino inválido'}`,
        };
      }

      const lead = await prisma.lead.findFirst({
        where: { id: jobData.leadId, tenantId: jobData.tenantId },
      });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(url, {
          method: step.config.method || 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: jobData.triggerEvent,
            automationId: jobData.automationId,
            leadId: jobData.leadId,
            lead,
            triggerData: jobData.triggerData,
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          return { success: false, message: `Webhook respondeu ${response.status}` };
        }
        return { success: true, message: `Webhook enviado (${response.status})` };
      } catch (err: any) {
        return { success: false, message: `Falha no webhook: ${err?.message || 'erro de rede'}` };
      } finally {
        clearTimeout(timeout);
      }
    }

    case 'condition': {
      if (!jobData.leadId) return { success: false, message: 'Step condition requer leadId' };
      // Avalia a condição; o roteamento (true/false) é feito pelo worker.
      const lead = await prisma.lead.findUnique({
        where: { id: jobData.leadId },
        include: { tags: { include: { tag: true } } },
      });

      if (!lead) return { success: false, message: 'Lead não encontrado' };

      const { field, operator, value } = step.config;
      const tagNames = lead.tags.map((t: any) => t.tag?.name).filter(Boolean) as string[];
      const tagIds = lead.tags.map((t: any) => t.tagId);
      const leadValue = field === 'tags' ? tagNames : (lead as any)[field];

      const conditionMet = evaluateCondition({
        operator,
        leadValue,
        value,
        tags: [...tagIds, ...tagNames],
      });

      return {
        success: true,
        message: `Condição ${field} ${operator} ${value}: ${conditionMet ? 'VERDADEIRO' : 'FALSO'}`,
        data: { conditionMet },
      };
    }

    case 'send_whatsapp': {
      const lead = await prisma.lead.findFirst({
        where: { id: jobData.leadId, tenantId: jobData.tenantId },
      });
      if (!lead?.phone) {
        return { success: false, message: 'Lead não possui telefone' };
      }

      const waCtx: MergeContext = {
        name: lead.name,
        email: lead.email,
        company: lead.company,
        phone: lead.phone,
      };
      // builder salva em `message`; aceitamos `content` (legado) também
      const waContent = interpolateMergeTags(
        step.config.content || step.config.message || '',
        waCtx
      );

      const result = await whatsappMessagingService.sendMessage(jobData.tenantId, {
        connectionId: step.config.connectionId,
        to: lead.phone,
        type: step.config.templateName ? 'template' : 'text',
        content: waContent,
        templateName: step.config.templateName,
        templateParams: step.config.templateParams,
        leadId: jobData.leadId,
      });

      return { success: true, message: `WhatsApp enviado: ${result.messageId}`, data: result };
    }

    case 'send_email': {
      const lead = await prisma.lead.findFirst({
        where: { id: jobData.leadId, tenantId: jobData.tenantId },
      });
      if (!lead?.email) {
        return { success: false, message: 'Lead não possui email' };
      }

      const emailCtx: MergeContext = {
        name: lead.name,
        email: lead.email,
        company: lead.company,
        phone: lead.phone,
      };
      // builder salva o corpo em `message`; aceitamos `html`/`content` (legado) também
      const emailBody = interpolateMergeTags(
        step.config.html || step.config.content || step.config.message || '',
        emailCtx
      );
      const emailSubject = interpolateMergeTags(step.config.subject || 'Sem assunto', emailCtx);

      const result = await emailMessagingService.sendEmail(jobData.tenantId, {
        configId: step.config.configId,
        to: lead.email,
        subject: emailSubject,
        html: emailBody,
        leadId: jobData.leadId,
      });

      return { success: true, message: `Email enviado: ${result.messageId}`, data: result };
    }

    default:
      return { success: false, message: `Step type desconhecido: ${(step as any).type}` };
  }
}

// ========================
// Schedule Check
// ========================

function isWithinSchedule(schedule?: AutomationSchedule): boolean {
  if (!schedule || !schedule.enabled) return true; // No schedule = always run

  const now = new Date();
  const currentDay = now.getDay();
  const currentHour = now.getHours();

  if (!schedule.days.includes(currentDay)) return false;
  if (currentHour < schedule.startHour || currentHour >= schedule.endHour) return false;

  return true;
}

// ========================
// Worker
// ========================

export const automationWorker = new Worker(
  'automations',
  async (job: Job<AutomationJobData>) => {
    const { automationId, tenantId, leadId, executionId } = job.data;
    // Declarado fora do try para o catch enxergar o nó que estava executando.
    let currentNodeId = job.data.currentNodeId;

    logger.info('Processing automation node', {
      automationId,
      leadId,
      nodeId: currentNodeId,
      legacyStepIndex: job.data.currentStepIndex,
      executionId,
      jobId: job.id,
    });

    try {
      // Load automation
      const automation = await prisma.automation.findFirst({
        where: { id: automationId, tenantId },
      });

      if (!automation) {
        throw new Error(`Automation ${automationId} not found`);
      }

      // Check if still active
      if (automation.status !== 'ACTIVE') {
        await automationService.addLog(
          automationId,
          AutomationLogStatus.SKIPPED,
          'Automação não está ativa',
          null,
          undefined,
          { leadId, executionId }
        );
        return;
      }

      // Check schedule (stored in conditions.schedule)
      const conditions = automation.conditions as Record<string, any> | null;
      const schedule = conditions?.schedule as AutomationSchedule | undefined;
      if (!isWithinSchedule(schedule)) {
        // Re-schedule for 1 hour later
        await automationQueue.add('process-step', job.data, { delay: 3600000 });
        await automationService.addLog(
          automationId,
          AutomationLogStatus.SKIPPED,
          'Fora do horário permitido, reagendado para 1h',
          null,
          undefined,
          { leadId, executionId }
        );
        return;
      }

      // Verify lead still exists (only when the trigger is lead-scoped)
      if (leadId) {
        const lead = await prisma.lead.findFirst({
          where: { id: leadId, tenantId },
        });
        if (!lead) {
          await automationService.addLog(
            automationId,
            AutomationLogStatus.SKIPPED,
            `Lead ${leadId} não encontrado`,
            null,
            undefined,
            { leadId, executionId }
          );
          return;
        }
      }

      // Normaliza os steps para o modelo de grafo (tolera automações antigas).
      const steps = normalizeSteps(automation.steps);
      const stepMap = new Map(steps.map((s) => [s.id, s]));

      // Compat: jobs antigos carregam currentStepIndex em vez de currentNodeId.
      if (!currentNodeId && typeof job.data.currentStepIndex === 'number') {
        currentNodeId = steps[job.data.currentStepIndex]?.id;
      }

      const step = currentNodeId ? stepMap.get(currentNodeId) : undefined;
      if (!step) {
        // Fim do caminho (sem nó atual válido) = execução concluída.
        await automationService.addLog(
          automationId,
          AutomationLogStatus.SUCCESS,
          `Execução ${executionId} completa (${steps.length} steps)`,
          null,
          undefined,
          { leadId, executionId }
        );
        await automationService.updateStats(automationId, true);
        return;
      }

      const stepIdx = steps.findIndex((s) => s.id === currentNodeId);

      // Execute step
      const result = await executeStep(step as AutomationStep, job.data);

      // Log step result
      await automationService.addLog(
        automationId,
        result.success ? AutomationLogStatus.SUCCESS : AutomationLogStatus.ERROR,
        `Step ${stepIdx + 1}/${steps.length} (${step.type}): ${result.message}`,
        {
          stepId: currentNodeId,
          stepIndex: stepIdx,
          stepType: step.type,
          executionId,
          leadId,
          ...result.data,
        },
        result.success ? undefined : result.message,
        {
          leadId,
          stepOrder: stepIdx >= 0 ? stepIdx : undefined,
          stepType: stepTypeToEnum[step.type] || null,
          executionId,
        }
      );

      if (!result.success) {
        await automationService.updateStats(automationId, false);

        // Notify admins on first step failure (before retries)
        if (job.attemptsMade === 0) {
          const automationInfo = await prisma.automation.findFirst({
            where: { id: automationId },
            select: { name: true },
          });
          notificationService
            .notifyTenantAdmins(tenantId, {
              type: NotificationType.AUTOMATION_ERROR,
              title: 'Erro em automação',
              message: `"${automationInfo?.name || 'Automação'}" - Step ${stepIdx + 1} (${step.type}) falhou: ${result.message}`,
              link: `/app/automation-logs?automationId=${automationId}`,
              metadata: { automationId, leadId, executionId, stepId: currentNodeId },
            })
            .catch(() => {});
        }

        throw new Error(result.message);
      }

      // Determina o(s) próximo(s) nó(s): condição roteia por true/false; demais
      // seguem `next` (fan-out = N arestas → N jobs filhos).
      const nextIds =
        step.type === 'condition'
          ? (result.data?.conditionMet ? step.trueNext : step.falseNext) || []
          : step.next || [];

      if (nextIds.length === 0) {
        // Fim deste ramo.
        await automationService.addLog(
          automationId,
          AutomationLogStatus.SUCCESS,
          `Execução ${executionId} completa`,
          null,
          undefined,
          { leadId, executionId }
        );
        await automationService.updateStats(automationId, true);
        return;
      }

      // Nó de atraso agenda seus sucessores com delay (fan-out preservado).
      const delayMs = step.type === 'delay' ? computeDelayMs(step.config) : 0;
      const executeAt = delayMs > 0 ? new Date(Date.now() + delayMs) : undefined;

      // Atualiza o log do step de delay para WAITING (visibilidade no log de automações)
      if (step.type === 'delay' && executeAt) {
        await prisma.automationLog.updateMany({
          where: {
            executionId,
            stepOrder: stepIdx >= 0 ? stepIdx : undefined,
            status: AutomationLogStatus.SUCCESS,
          },
          data: { status: AutomationLogStatus.WAITING, executeAt },
        });
      }

      for (const nextId of nextIds) {
        // jobId determinístico por (execução, nó): o BullMQ ignora um add com id
        // já existente, evitando dupla execução em reconvergência (diamante) e
        // loop infinito em ciclos do grafo.
        await automationQueue.add(
          'process-step',
          { ...job.data, currentNodeId: nextId, currentStepIndex: undefined },
          { jobId: `${executionId}:${nextId}`, ...(delayMs > 0 ? { delay: delayMs } : {}) }
        );
      }
    } catch (error: any) {
      logger.error('Error processing automation node', error, {
        automationId,
        leadId,
        nodeId: currentNodeId,
        executionId,
      });

      // If final attempt, move to DLQ and notify admins
      if (job.attemptsMade >= (job.opts.attempts || 3) - 1) {
        await automationDLQ.add('failed-automation', {
          ...job.data,
          error: error.message,
          failedAt: new Date().toISOString(),
        });
        await automationService.addLog(
          automationId,
          AutomationLogStatus.ERROR,
          `Nó ${currentNodeId || '(desconhecido)'} falhou após ${job.attemptsMade + 1} tentativas: ${error.message}`,
          { executionId, leadId, stepId: currentNodeId, attempts: job.attemptsMade + 1 },
          error.message,
          { leadId, executionId }
        );
        await automationService.updateStats(automationId, false);

        // Notify tenant admins about the automation failure
        const automation = await prisma.automation.findFirst({
          where: { id: automationId },
          select: { name: true },
        });
        const lead = await prisma.lead.findFirst({ where: { id: leadId }, select: { name: true } });
        notificationService
          .notifyTenantAdmins(tenantId, {
            type: NotificationType.AUTOMATION_ERROR,
            title: 'Automação falhou',
            message: `"${automation?.name || 'Automação'}" falhou${lead?.name ? ` para o lead "${lead.name}"` : ''}: ${error.message}`,
            link: `/app/automation-logs?automationId=${automationId}`,
            metadata: {
              automationId,
              leadId,
              executionId,
              stepId: currentNodeId,
              error: error.message,
            },
          })
          .catch(() => {});
      }

      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 10,
  }
);

// ========================
// Event Listeners
// ========================

automationWorker.on('completed', (job) => {
  logger.info('Automation job completed', { jobId: job.id });
});

automationWorker.on('failed', (job, err) => {
  logger.error('Automation job failed', err, { jobId: job?.id, attempts: job?.attemptsMade });
});

// ========================
// Trigger Dispatcher
// ========================

/**
 * Dispatch automation trigger event.
 * Finds all active automations matching the trigger type and conditions,
 * then queues them for execution.
 */
export async function dispatchTrigger(
  tenantId: string,
  triggerType: string,
  leadId: string | undefined,
  triggerData?: Record<string, any>,
  dealId?: string
): Promise<number> {
  try {
    // Find all active automations for this tenant
    const automations = await prisma.automation.findMany({
      where: {
        tenantId,
        status: 'ACTIVE',
      },
    });

    let dispatched = 0;

    for (const automation of automations) {
      const trigger = automation.trigger as any;
      if (!trigger || trigger.type !== triggerType) continue;

      // Filtros do gatilho: builder gráfico grava no nível raiz; legado em
      // trigger.conditions. Só aplicamos um filtro quando ele está definido.
      // Status/origem passam por normalização de valores LEGADOS (pré régua
      // "Leads como Oportunidade") — automações antigas seguem casando.
      const filters = trigger.conditions || trigger;
      let conditionsMet = true;
      if (
        filters.status &&
        normalizeLeadStatus(triggerData?.newStatus) !== normalizeLeadStatus(filters.status)
      )
        conditionsMet = false;
      if (filters.tagId && triggerData?.tagId !== filters.tagId) conditionsMet = false;
      if (
        filters.source &&
        normalizeLeadSource(triggerData?.source) !== normalizeLeadSource(filters.source)
      )
        conditionsMet = false;
      if (!conditionsMet) continue;

      // Nós de entrada (conectados ao gatilho). Fallback: primeiro step (legado linear).
      const steps = normalizeSteps(automation.steps);
      const entry: string[] =
        Array.isArray(trigger.entry) && trigger.entry.length
          ? trigger.entry
          : steps[0]
            ? [steps[0].id]
            : [];

      const executionId = `exec_${automation.id}_${Date.now()}`;

      if (entry.length === 0) {
        await automationService.addLog(
          automation.id,
          AutomationLogStatus.SKIPPED,
          `Trigger ${triggerType}: automação sem passos`,
          { executionId, leadId, dealId },
          undefined,
          { leadId, executionId }
        );
        continue;
      }

      // Enfileira cada nó de entrada (fan-out a partir do gatilho), com jobId
      // determinístico por (execução, nó) para evitar duplicidade.
      for (const nodeId of entry) {
        await automationQueue.add(
          'process-step',
          {
            automationId: automation.id,
            tenantId,
            leadId,
            dealId,
            triggerEvent: triggerType,
            triggerData,
            currentNodeId: nodeId,
            executionId,
          },
          { jobId: `${executionId}:${nodeId}` }
        );
      }

      const subject = leadId ? `lead ${leadId}` : dealId ? `deal ${dealId}` : 'evento';
      await automationService.addLog(
        automation.id,
        AutomationLogStatus.SUCCESS,
        `Trigger ${triggerType} disparado para ${subject}`,
        { executionId, leadId, dealId, triggerData },
        undefined,
        { leadId, executionId }
      );

      // Fire outgoing webhook (req: automation.triggered) — fire-and-forget.
      webhookDispatcher.dispatch(tenantId, 'automation.triggered', {
        automation_id: automation.id,
        automation_name: automation.name,
        trigger_type: triggerType,
        lead_id: leadId ?? null,
        deal_id: dealId ?? null,
        execution_id: executionId,
        triggered_at: new Date().toISOString(),
      });

      dispatched++;
    }

    if (dispatched > 0) {
      logger.info('Automation triggers dispatched', {
        tenantId,
        triggerType,
        leadId,
        dealId,
        dispatched,
      });
    }

    return dispatched;
  } catch (error: any) {
    logger.error('Error dispatching automation trigger', error, {
      tenantId,
      triggerType,
      leadId,
      dealId,
    });
    return 0;
  }
}

// ========================
// Initialization
// ========================

export async function initializeAutomationEngine(): Promise<void> {
  logger.info('Automation engine initialized');
  // Worker is already running by importing this file
  // Future: Could load pending delayed jobs or check for stuck jobs
}
