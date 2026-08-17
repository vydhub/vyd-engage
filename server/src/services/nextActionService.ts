import prisma from '../config/database.js';
import { DealStage, LeadStatus } from '@prisma/client';
import { logger } from '../utils/logger.js';
import { generateText } from 'ai';
import { getActiveModel, isAIEnabled, logAiUsage, resolveProviderConfig } from './aiProvider.js';

/** Canonical next-action types (spec req 12). */
export type NextActionType =
  | 'CALL'
  | 'EMAIL'
  | 'WHATSAPP'
  | 'MEETING'
  | 'FOLLOW_UP'
  | 'DEMO'
  | 'PROPOSAL'
  | 'CLOSE';

export interface NextAction {
  /** Canonical action type from the fixed enum (spec req 12). */
  actionType: NextActionType | null;
  action: string;
  reason: string;
  /** 1-2 sentence justification referencing real lead data (spec reqs 10, 13). */
  reasoning: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  icon: string;
  category: string;
}

// Estados em que o lead não deve receber sugestões de próxima ação
// (encerrado/cancelado são terminais; pausado está congelado pelo cliente).
const INACTIVE_LEAD_STATUSES: LeadStatus[] = [
  LeadStatus.ENCERRADO,
  LeadStatus.CANCELADO,
  LeadStatus.PAUSADO,
];

const NO_ACTION: NextAction = {
  actionType: null,
  action: 'Tudo em dia',
  reason: 'Nenhuma ação pendente para este registro.',
  reasoning: 'Nenhuma ação pendente para este registro.',
  priority: 'LOW',
  icon: 'check-circle',
  category: 'ok',
};

function daysSince(date: Date | null | undefined): number {
  if (!date) return Infinity;
  return Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Builds a NextAction from a rule, defaulting `reasoning` to the deterministic
 * `reason`. The AI reasoning enrichment (when requested) overrides it later.
 */
function withReason(partial: Omit<NextAction, 'reasoning'>): NextAction {
  return { ...partial, reasoning: partial.reason };
}

// ===========================
// Lead Rules
// ===========================

export async function getLeadNextAction(tenantId: string, leadId: string): Promise<NextAction> {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, tenantId },
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      score: true,
      createdAt: true,
    },
  });

  if (!lead) {
    return {
      actionType: null,
      action: 'Lead não encontrado',
      reason: '',
      reasoning: '',
      priority: 'LOW',
      icon: 'alert-circle',
      category: 'error',
    };
  }

  // Get last interaction
  const lastInteraction = await prisma.interaction.findFirst({
    where: { leadId, tenantId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, type: true },
  });

  // Check if lead has any EMAIL interaction
  const hasEmailInteraction = await prisma.interaction.count({
    where: { leadId, tenantId, type: 'EMAIL' },
  });

  // Check if lead has deals
  const dealCount = await prisma.deal.count({
    where: { leadId, tenantId, deletedAt: null },
  });

  const daysSinceLastInteraction = daysSince(lastInteraction?.createdAt);
  const leadAgeDays = daysSince(lead.createdAt);

  // Rules ordered by priority (first match wins)
  // HIGH priority rules first, then MEDIUM, then LOW

  // Rule: Status NOVO for 3+ days → first contact
  if (lead.status === LeadStatus.NOVO && leadAgeDays >= 3) {
    return withReason({
      actionType: 'CALL',
      action: 'Fazer primeiro contato',
      reason: `Lead está como "Novo" há ${leadAgeDays} dias sem nenhum contato.`,
      priority: 'HIGH',
      icon: 'phone-outgoing',
      category: 'contact',
    });
  }

  // Rule: No interaction in 7+ days → follow-up
  if (daysSinceLastInteraction >= 7 && !INACTIVE_LEAD_STATUSES.includes(lead.status)) {
    return withReason({
      actionType: 'FOLLOW_UP',
      action: 'Fazer follow-up',
      reason: `Última interação foi há ${daysSinceLastInteraction} dias. O lead pode esfriar.`,
      priority: 'HIGH',
      icon: 'message-circle',
      category: 'follow-up',
    });
  }

  // Rule: Score > 80 → hot lead, schedule meeting
  if (lead.score > 80) {
    return withReason({
      actionType: 'MEETING',
      action: 'Lead quente — agendar reunião',
      reason: `Score de ${lead.score} indica alto interesse. Aproveite o momento.`,
      priority: 'HIGH',
      icon: 'flame',
      category: 'meeting',
    });
  }

  // Rule: No interaction in 3-7 days → send message
  if (
    daysSinceLastInteraction >= 3 &&
    daysSinceLastInteraction < 7 &&
    !INACTIVE_LEAD_STATUSES.includes(lead.status)
  ) {
    return withReason({
      actionType: 'WHATSAPP',
      action: 'Enviar mensagem',
      reason: `Sem interação há ${daysSinceLastInteraction} dias. Mantenha o lead engajado.`,
      priority: 'MEDIUM',
      icon: 'send',
      category: 'message',
    });
  }

  // Rule: Has email but no EMAIL interaction → send intro email
  if (
    lead.email &&
    hasEmailInteraction === 0 &&
    !INACTIVE_LEAD_STATUSES.includes(lead.status)
  ) {
    return withReason({
      actionType: 'EMAIL',
      action: 'Enviar email de apresentação',
      reason: 'Lead tem email cadastrado mas ainda não recebeu nenhum email.',
      priority: 'MEDIUM',
      icon: 'mail',
      category: 'email',
    });
  }

  // Rule: Em andamento without deal → create deal
  if (lead.status === LeadStatus.EM_ANDAMENTO && dealCount === 0) {
    return withReason({
      actionType: 'PROPOSAL',
      action: 'Criar deal/oportunidade',
      reason: 'Lead qualificado sem nenhum deal associado. Crie uma oportunidade.',
      priority: 'MEDIUM',
      icon: 'handshake',
      category: 'deal',
    });
  }

  // Rule: Score < 20 and age > 30 days → re-engage or discard
  if (
    lead.score < 20 &&
    leadAgeDays > 30 &&
    !INACTIVE_LEAD_STATUSES.includes(lead.status)
  ) {
    return withReason({
      actionType: 'FOLLOW_UP',
      action: 'Re-engajar ou descartar',
      reason: `Score baixo (${lead.score}) e lead com mais de ${leadAgeDays} dias. Avalie se vale investir mais tempo.`,
      priority: 'LOW',
      icon: 'refresh-cw',
      category: 'cleanup',
    });
  }

  return NO_ACTION;
}

// ===========================
// AI Reasoning Enrichment (spec reqs 10, 13)
// ===========================

const REASONING_SYSTEM_PROMPT = `Você é um assistente de vendas. Dada a ação recomendada para um lead e os dados reais dele, escreva UMA justificativa de 1 a 2 frases em português brasileiro.
Regras:
- Referencie dados concretos fornecidos (ex.: dias desde a última interação, canal, score).
- Nunca invente informações que não foram fornecidas.
- Responda APENAS com a justificativa, sem prefixos nem aspas.`;

/**
 * Enriches a rule-based NextAction with an AI `reasoning` that references real
 * lead data (spec reqs 10, 13). Falls back to the deterministic `reason` when AI
 * is disabled or fails — never throws, so the endpoint always returns a value.
 */
export async function getLeadNextActionWithReasoning(
  tenantId: string,
  leadId: string
): Promise<NextAction> {
  const base = await getLeadNextAction(tenantId, leadId);

  // No actionable suggestion or AI disabled → keep deterministic reason.
  if (!base.actionType || !isAIEnabled()) return base;

  try {
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, tenantId },
      select: { name: true, email: true, company: true, status: true, score: true },
    });
    if (!lead) return base;

    const lastInteraction = await prisma.interaction.findFirst({
      where: { leadId, tenantId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, type: true, content: true },
    });

    const facts: string[] = [
      `Nome: ${lead.name}`,
      `Status: ${lead.status}`,
      `Score: ${lead.score}`,
      lead.company ? `Empresa: ${lead.company}` : '',
    ].filter(Boolean);

    if (lastInteraction) {
      const days = daysSince(lastInteraction.createdAt);
      facts.push(
        `Última interação: há ${days} dia(s), canal ${lastInteraction.type}` +
          (lastInteraction.content ? `, anotação: "${lastInteraction.content.slice(0, 120)}"` : '')
      );
    } else {
      facts.push('Sem histórico de interações registrado.');
    }

    const model = getActiveModel();
    if (!model) return base;

    const startedAt = Date.now();
    const result = await generateText({
      model,
      system: REASONING_SYSTEM_PROMPT,
      prompt: `Ação recomendada: ${base.action} (${base.actionType}).\nDados do lead:\n${facts.join('\n')}`,
      temperature: 0.4,
      maxOutputTokens: 120,
    });

    const text = result.text?.trim();
    if (text) {
      logAiUsage({
        feature: 'next-action',
        tenantId,
        leadId,
        latencyMs: Date.now() - startedAt,
        tokens: result.usage?.totalTokens,
        promptTokens: result.usage?.inputTokens,
        completionTokens: result.usage?.outputTokens,
        provider: resolveProviderConfig()?.provider,
      });
      return { ...base, reasoning: text };
    }
  } catch (error: any) {
    logger.warn('Next-action AI reasoning failed, using deterministic reason', {
      leadId,
      error: error?.message,
    });
  }

  return base;
}

// ===========================
// Deal Rules
// ===========================

export async function getDealNextAction(tenantId: string, dealId: string): Promise<NextAction> {
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, tenantId },
    select: {
      id: true,
      name: true,
      value: true,
      stage: true,
      probability: true,
      expectedCloseDate: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!deal) {
    return {
      actionType: null,
      action: 'Deal não encontrado',
      reason: '',
      reasoning: '',
      priority: 'LOW',
      icon: 'alert-circle',
      category: 'error',
    };
  }

  // Skip closed deals
  if (deal.stage === DealStage.WON || deal.stage === DealStage.LOST) {
    return NO_ACTION;
  }

  // Get last interaction for this deal
  const lastInteraction = await prisma.interaction.findFirst({
    where: { dealId, tenantId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  // Get average deal value for this tenant (active deals only)
  const avgResult = await prisma.deal.aggregate({
    where: {
      tenantId,
      deletedAt: null,
      stage: { notIn: [DealStage.WON, DealStage.LOST] },
    },
    _avg: { value: true },
  });
  const avgDealValue = Number(avgResult._avg.value || 0);

  const daysSinceLastInteraction = daysSince(lastInteraction?.createdAt);
  const dealValue = Number(deal.value);
  const daysSinceUpdate = daysSince(deal.updatedAt);

  // Rule: expectedCloseDate in the past → update forecast
  if (deal.expectedCloseDate && new Date(deal.expectedCloseDate) < new Date()) {
    return withReason({
      actionType: 'FOLLOW_UP',
      action: 'Atualizar previsão de fechamento',
      reason: 'A data prevista de fechamento já passou. Atualize para manter o forecast correto.',
      priority: 'HIGH',
      icon: 'calendar-x',
      category: 'update',
    });
  }

  // Rule: Probability < 30% in CLOSING stage → decisive meeting
  if (deal.stage === DealStage.CLOSING && deal.probability < 30) {
    return withReason({
      actionType: 'MEETING',
      action: 'Agendar reunião decisiva',
      reason: `Deal em fase de fechamento mas com probabilidade de apenas ${deal.probability}%. Precisa de atenção imediata.`,
      priority: 'HIGH',
      icon: 'target',
      category: 'meeting',
    });
  }

  // Rule: No interaction in 5+ days → resume negotiation
  if (daysSinceLastInteraction >= 5) {
    return withReason({
      actionType: 'FOLLOW_UP',
      action: 'Retomar negociação',
      reason: `Sem interação há ${daysSinceLastInteraction} dias. A negociação pode esfriar.`,
      priority: 'HIGH',
      icon: 'message-circle',
      category: 'follow-up',
    });
  }

  // Rule: Value > avg × 2 → strategic deal, special attention
  if (avgDealValue > 0 && dealValue > avgDealValue * 2) {
    return withReason({
      actionType: 'CALL',
      action: 'Deal estratégico — atenção especial',
      reason: `Valor de ${formatBRL(dealValue)} é mais que o dobro do ticket médio (${formatBRL(avgDealValue)}). Priorize este deal.`,
      priority: 'HIGH',
      icon: 'star',
      category: 'strategic',
    });
  }

  // Rule: In same stage for 14+ days → move deal forward
  if (daysSinceUpdate >= 14) {
    return withReason({
      actionType: 'CLOSE',
      action: 'Mover negociação adiante',
      reason: `Deal parado no stage atual há ${daysSinceUpdate} dias. Tente avançar para a próxima etapa.`,
      priority: 'MEDIUM',
      icon: 'arrow-right',
      category: 'progress',
    });
  }

  // Rule: No expectedCloseDate → set one
  if (!deal.expectedCloseDate) {
    return withReason({
      actionType: 'FOLLOW_UP',
      action: 'Definir data prevista de fechamento',
      reason: 'Deal sem previsão de fechamento. Defina uma data para melhor controle do pipeline.',
      priority: 'MEDIUM',
      icon: 'calendar',
      category: 'update',
    });
  }

  return NO_ACTION;
}

// ===========================
// Dashboard Summary (top 5 urgent actions)
// ===========================

export interface ActionSummaryItem {
  entityType: 'lead' | 'deal';
  entityId: string;
  entityName: string;
  action: NextAction;
}

export async function getActionSummary(
  tenantId: string,
  limit = 5,
  assignedTo?: string | { in: string[] }
): Promise<ActionSummaryItem[]> {
  const results: ActionSummaryItem[] = [];
  // Escopo por responsável (analista/USER só vê os próprios) — spec papeis-comerciais.
  const scope = assignedTo ? { assignedTo } : {};

  // Fetch active leads (not WON/LOST, limited to recent/relevant)
  const leads = await prisma.lead.findMany({
    where: {
      tenantId,
      deletedAt: null,
      status: { notIn: INACTIVE_LEAD_STATUSES },
      ...scope,
    },
    select: { id: true, name: true },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });

  // Fetch active deals (not WON/LOST)
  const deals = await prisma.deal.findMany({
    where: {
      tenantId,
      deletedAt: null,
      stage: { notIn: [DealStage.WON, DealStage.LOST] },
      ...scope,
    },
    select: { id: true, name: true },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });

  // Evaluate actions for all leads and deals
  const leadActions = await Promise.all(
    leads.map(async (lead) => {
      const action = await getLeadNextAction(tenantId, lead.id);
      return { entityType: 'lead' as const, entityId: lead.id, entityName: lead.name, action };
    })
  );

  const dealActions = await Promise.all(
    deals.map(async (deal) => {
      const action = await getDealNextAction(tenantId, deal.id);
      return { entityType: 'deal' as const, entityId: deal.id, entityName: deal.name, action };
    })
  );

  // Combine and filter out "Tudo em dia"
  const allActions = [...leadActions, ...dealActions].filter(
    (item) => item.action.category !== 'ok'
  );

  // Sort by priority: HIGH first, then MEDIUM, then LOW
  const priorityOrder: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  allActions.sort((a, b) => priorityOrder[a.action.priority] - priorityOrder[b.action.priority]);

  return allActions.slice(0, limit);
}

// Helper
function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}
