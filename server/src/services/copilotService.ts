import { z } from 'zod';
import { generateText, tool, stepCountIs, type ToolSet } from 'ai';
import { InteractionType, InteractionDirection, TaskStatus, DealStage, type Prisma } from '@prisma/client';
import prisma from '../config/database.js';
import { logger } from '../utils/logger.js';
import { getActiveModel, resolveProviderConfig, isAIEnabled, logAiUsage } from './aiProvider.js';
import { permissionService, type PermissionUser } from './permissionService.js';
import { whatsappMessagingService } from './whatsappMessagingService.js';

/**
 * copilotService — Copiloto IA via WhatsApp (Upgrade RD P3, req 25).
 *
 * PRINCÍPIOS DE SEGURANÇA (inegociáveis):
 *  - GATING GRACIOSO: só roteia quando `isAIEnabled()` E a conexão é `isCopilot`.
 *    Sem IA → apenas loga (nunca 500); o webhook segue seu fluxo normal de log.
 *  - AUTORIZAÇÃO POR NÚMERO: só um `User.whatsappNumber` conhecido do tenant pode
 *    comandar. Remetente desconhecido → responde "número não autorizado" e ignora
 *    (não executa nada, não vaza dados).
 *  - ESCOPO POR USUÁRIO: as tools de LEITURA filtram por `tenantId` + o
 *    `visibilityScope` efetivo do usuário (P1). O copiloto nunca vê além do que o
 *    próprio usuário veria na UI.
 *  - ESCRITA COM ACEITE: as tools de ESCRITA (criar tarefa / atualizar deal) NÃO
 *    executam direto — o copiloto PROPÕE a ação e guarda um estado pendente
 *    (Interaction.metadata do thread). Só executa após a próxima mensagem de
 *    confirmação explícita ("sim"/"confirmar"). NUNCA exclui nada.
 *  - LOG DE TOOL CALLS: toda tool chamada é logada (userId + entidade).
 *
 * O estado de confirmação pendente vive em `Interaction.metadata.copilotPending`
 * (WHATSAPP INBOUND, userId do comandante) — sem tabela nova (design fixado).
 */

// ── Tipos ────────────────────────────────────────────────────────────────────

/** Conexão mínima aceita (subset de WhatsAppConnection) para responder pelo copiloto. */
export interface CopilotConnection {
  id: string;
  tenantId: string;
  isCopilot: boolean;
}

/** Ação de escrita proposta, aguardando confirmação do usuário. */
interface PendingAction {
  kind: 'criar_tarefa' | 'atualizar_deal';
  args: Record<string, unknown>;
  /** Resumo em pt-BR mostrado ao usuário para o aceite. */
  summary: string;
}

/** Resultado do handler — texto respondido (ou null quando ignorado sem resposta). */
export interface CopilotResult {
  handled: boolean;
  reply: string | null;
  /** Para observabilidade/testes: nomes das tools de leitura acionadas nesta volta. */
  toolsUsed: string[];
  /** Ação de escrita proposta e persistida como pendente (se houver). */
  pending?: PendingAction | null;
}

/**
 * `tool()` com o tipo de saída ERASADO. O AI SDK infere `Tool<INPUT, OUTPUT>` a partir
 * do `inputSchema` (Zod) e do retorno do `execute`; como aqui o `execute` devolve
 * resultados do Prisma (tipos enormes), a combinação `tool()` + `ToolSet` + `generateText`
 * dispara instanciação de tipo recursiva (instantiateType_DepthLimit) que estoura a memória
 * do tsc. Fixando o retorno em `ToolSet[string]` mantemos a tipagem ÚTIL (o input via
 * `z.infer`) sem inflar o grafo de tipos. Comportamento em runtime: idêntico a `tool()`.
 */
type CopilotTool = ToolSet[string];
const defineTool = tool as unknown as <I extends z.ZodTypeAny>(def: {
  description: string;
  inputSchema: I;
  execute: (input: z.infer<I>) => Promise<unknown>;
}) => CopilotTool;

// ── Confirmação ──────────────────────────────────────────────────────────────

/**
 * Palavras FORTES de aceite/recusa. Deliberadamente SEM fillers ('ok','pode','isso'
 * / 'para'): esses aparecem em consultas naturais ("ok, e o status do deal Y?") e,
 * se contassem como confirmação, EXECUTARIAM a escrita pendente sem aceite real —
 * violando o princípio inegociável "ESCRITA só com aceite EXPLÍCITO" (#1/#6).
 */
const STRONG_CONFIRM = new Set(['sim', 'confirmar', 'confirmo', 'confirma']);
const STRONG_CANCEL = new Set(['não', 'nao', 'cancelar', 'cancela', 'esquece']);

/**
 * Quebra a mensagem em tokens normalizados (minúsculas, sem pontuação de borda).
 * "Sim, pode criar!" → ['sim', 'pode', 'criar']. Vazios são descartados.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[.!,;:?]+/g, ''))
    .filter((t) => t.length > 0);
}

/**
 * Classifica a resposta a uma proposta pendente. A CONFIRMAÇÃO (executa escrita) é
 * ENDURECIDA: só 'confirm' quando a mensagem é PURAMENTE afirmativa — curta (até 3
 * tokens) e com TODOS os tokens em STRONG_CONFIRM. Assim uma NOVA consulta curta e
 * acionável que por acaso contém 'confirma'/'sim' ("confirma a reunião", "sim quero
 * relatório", "sim, pode criar") NÃO executa a proposta pendente — vira 'none' (expira
 * a proposta e é tratada como nova consulta). O CANCELAMENTO permanece LENIENTE (só
 * descarta, é seguro): qualquer token forte de recusa cancela, exceto se a mensagem
 * for uma confirmação pura. Assim:
 *   "sim" / "confirmo" / "sim confirmo" → 'confirm'  (afirmação pura)
 *   "não" / "isso não"                  → 'cancel'   (o 'não' forte decide; 'isso' é filler)
 *   "confirma a reunião" / "sim quero relatório" / "sim, pode criar" → 'none' (nova consulta)
 *   "ok, e o deal Y?"                   → 'none'
 */
function classifyReply(text: string): 'confirm' | 'cancel' | 'none' {
  const tokens = tokenize(text);
  if (tokens.length === 0) return 'none';
  const hasCancel = tokens.some((t) => STRONG_CANCEL.has(t));
  // Confirmação PURA: até 3 tokens E todos afirmativos fortes.
  const allConfirm = tokens.length <= 3 && tokens.every((t) => STRONG_CONFIRM.has(t));
  if (hasCancel && !allConfirm) return 'cancel'; // cancelar é seguro (só descarta)
  if (allConfirm) return 'confirm'; // só afirmação pura executa
  return 'none';
}

// ── Throttle da resposta a remetente desconhecido (#17) ──────────────────────

/**
 * Anti-amplificação: a resposta "número não autorizado" a remetentes DESCONHECIDOS
 * é limitada por número (no máx. 1 a cada `UNKNOWN_REPLY_COOLDOWN_MS`). Sem isso,
 * um remetente malicioso poderia forçar N respostas de saída → custo/abuso na API
 * do Meta. O log (warn) continua SEMPRE acontecendo — só o ENVIO é limitado.
 * Map in-memory com cap p/ não crescer sem limite (LRU-ish: descarta o mais antigo).
 */
const UNKNOWN_REPLY_COOLDOWN_MS = 6 * 60 * 60 * 1000; // ~6h
const UNKNOWN_REPLY_MAX_ENTRIES = 5000;
const unknownReplyLastSent = new Map<string, number>();

/**
 * Decide se DEVEMOS enviar a resposta de "não autorizado" a este número agora.
 * Retorna true (e registra o envio) se passou o cooldown; false se ainda no janela.
 */
function shouldReplyUnknownSender(from: string): boolean {
  const key = digitsOnly(from);
  if (!key) return false;
  const now = Date.now();
  const last = unknownReplyLastSent.get(key);
  if (last !== undefined && now - last < UNKNOWN_REPLY_COOLDOWN_MS) {
    return false;
  }
  // Cap do Map: se cheio e é uma chave nova, remove a entrada mais antiga inserida.
  if (!unknownReplyLastSent.has(key) && unknownReplyLastSent.size >= UNKNOWN_REPLY_MAX_ENTRIES) {
    const oldest = unknownReplyLastSent.keys().next().value;
    if (oldest !== undefined) unknownReplyLastSent.delete(oldest);
  }
  // Reinsere (delete+set) p/ manter ordem de recência aproximada no Map.
  unknownReplyLastSent.delete(key);
  unknownReplyLastSent.set(key, now);
  return true;
}

// ── Throttle da invocação do LLM por usuário autorizado (#6) ─────────────────

/**
 * Anti-abuso: mesmo um usuário AUTORIZADO não pode disparar o modelo (generateText,
 * caro) em rajada. Limita a 1 invocação a cada `COPILOT_LLM_COOLDOWN_MS` por
 * (tenantId+userId). Espelha o padrão do throttle de remetente desconhecido: Map
 * in-memory com cap de tamanho (descarta o mais antigo). NÃO afeta os caminhos de
 * confirmação/cancelamento — esses não chamam o LLM e são checados ANTES daqui.
 */
const COPILOT_LLM_COOLDOWN_MS = 3 * 1000; // ~3s por usuário
const COPILOT_LLM_MAX_ENTRIES = 5000;
const copilotLlmLastCall = new Map<string, number>();

/**
 * Decide se ESTE usuário pode disparar o LLM agora. Retorna true (e registra a
 * invocação) se passou o cooldown; false se ainda dentro da janela.
 */
function shouldInvokeLlm(tenantId: string, userId: string): boolean {
  const key = `${tenantId}:${userId}`;
  const now = Date.now();
  const last = copilotLlmLastCall.get(key);
  if (last !== undefined && now - last < COPILOT_LLM_COOLDOWN_MS) {
    return false;
  }
  // Cap do Map: se cheio e é uma chave nova, remove a entrada mais antiga inserida.
  if (!copilotLlmLastCall.has(key) && copilotLlmLastCall.size >= COPILOT_LLM_MAX_ENTRIES) {
    const oldest = copilotLlmLastCall.keys().next().value;
    if (oldest !== undefined) copilotLlmLastCall.delete(oldest);
  }
  // Reinsere (delete+set) p/ manter ordem de recência aproximada no Map.
  copilotLlmLastCall.delete(key);
  copilotLlmLastCall.set(key, now);
  return true;
}

/**
 * Limpa o estado in-memory dos rate limiters (throttle de LLM por usuário e resposta
 * a remetente desconhecido). Uso EXCLUSIVO de testes, para isolar casos que compartilham
 * o mesmo tenant/usuário — em produção os Maps vivem pelo processo (intencional).
 */
export function __resetCopilotRateLimiters(): void {
  copilotLlmLastCall.clear();
  unknownReplyLastSent.clear();
}

// ── Resolução do remetente → usuário comandante ──────────────────────────────

/** Mantém apenas dígitos de um telefone. */
function digitsOnly(raw: string): string {
  return (raw || '').replace(/\D+/g, '');
}

/**
 * Normaliza um telefone para comparação: retorna o número em dígitos e a variante
 * sem o prefixo de DDI 55 (quando presente). Dois números casam se os dígitos
 * COMPLETOS batem, ou se batem depois de remover o '55' inicial de UM dos lados —
 * assim toleramos apenas a presença/ausência do DDI brasileiro, sem colidir por
 * sufixo (o bug antigo: 8 dígitos finais iguais em DDDs diferentes autorizava o
 * usuário errado).
 */
function phoneVariants(raw: string): string[] {
  const d = digitsOnly(raw);
  if (!d) return [];
  const variants = new Set<string>([d]);
  if (d.startsWith('55') && d.length > 2) variants.add(d.slice(2));
  return [...variants];
}

/** Dois telefones casam se compartilham alguma variante normalizada (com/sem DDI 55). */
function phonesMatch(a: string, b: string): boolean {
  const va = phoneVariants(a);
  const vb = phoneVariants(b);
  if (va.length === 0 || vb.length === 0) return false;
  return va.some((x) => vb.includes(x));
}

/**
 * Resolve o número do remetente para um `User` do tenant com `whatsappNumber`
 * cadastrado, casando pelo número NORMALIZADO por dígitos (tolerando só o prefixo
 * de DDI 55). Só usuários ATIVOS comandam e o match precisa ser ÚNICO: se mais de
 * um usuário ativo casar, RECUSA (retorna null → "número não autorizado") em vez de
 * escolher o primeiro. Retorna null se nenhum número conhecido casar.
 */
async function resolveCommandingUser(tenantId: string, from: string) {
  const fromDigits = digitsOnly(from);
  if (fromDigits.length < 6) return null;

  const candidates = await prisma.user.findMany({
    where: {
      tenantId,
      status: 'ACTIVE',
      whatsappNumber: { not: null },
    },
    select: {
      id: true,
      name: true,
      role: true,
      teamId: true,
      permissionProfileId: true,
      whatsappNumber: true,
    },
    // orderBy determinístico para tornar a consulta estável (a decisão de match
    // não depende da ordem, mas evitamos não-determinismo de driver).
    orderBy: { id: 'asc' },
  });

  const matches = candidates.filter((u) => phonesMatch(u.whatsappNumber || '', from));
  // Match precisa ser único: >1 usuário ativo com o mesmo número → recusa.
  if (matches.length !== 1) return null;
  return matches[0];
}

// ── Estado pendente (Interaction.metadata) ───────────────────────────────────

/**
 * Busca a última ação de escrita pendente do usuário nesta conexão de copiloto
 * (dentro de uma janela de 30 min, para não ressuscitar propostas antigas).
 *
 * Filtra DIRETAMENTE a proposta pendente não-resolvida via path de JSON do Postgres
 * (`metadata.copilotPending.resolved = false`), em vez de escanear as N interações
 * mais recentes. Assim, mesmo que o usuário mande dezenas de mensagens inbound na
 * janela de 30 min, a proposta pendente nunca "sai" de uma janela de varredura — o
 * "sim" sempre a reencontra. O `connectionId` (path de JSON também) garante que a
 * proposta é DESTA conexão de copiloto.
 */
async function findPendingAction(
  tenantId: string,
  connectionId: string,
  userId: string
): Promise<{
  interactionId: string;
  action: PendingAction;
  /** metadata cru da Interaction, para o claim atômico reescrever preservando o resto. */
  metadata: Record<string, unknown>;
  /** objeto copilotPending cru (com connectionId/resolved), idem. */
  pending: Record<string, unknown>;
} | null> {
  const since = new Date(Date.now() - 30 * 60 * 1000);
  const row = await prisma.interaction.findFirst({
    where: {
      tenantId,
      userId,
      type: InteractionType.WHATSAPP,
      direction: InteractionDirection.INBOUND,
      createdAt: { gte: since },
      metadata: { path: ['copilotPending', 'resolved'], equals: false },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, metadata: true },
  });
  if (!row) return null;

  const meta = (row.metadata || {}) as Record<string, unknown>;
  const pending = meta.copilotPending as
    | (PendingAction & { connectionId?: string; resolved?: boolean })
    | undefined;
  // Guarda de coerência: a proposta precisa existir e ser DESTA conexão de copiloto.
  // (O filtro de `resolved=false` já veio do banco; `connectionId` não é indexável
  // no mesmo where de forma tão barata, então confirmamos aqui.)
  if (!pending || pending.connectionId !== connectionId || pending.resolved === true) {
    return null;
  }
  return {
    interactionId: row.id,
    action: pending,
    metadata: meta,
    pending: pending as unknown as Record<string, unknown>,
  };
}

/**
 * "Claim" ATÔMICO da proposta pendente: marca `copilotPending.resolved = true`
 * SÓ na linha que ainda está `resolved === false`, via `updateMany` condicional
 * (filtro por path de JSON — suportado por Prisma/Postgres). O UPDATE toma o lock
 * de linha e serializa a corrida: dois "sim" concorrentes (ou redelivery de webhook
 * do Meta) disputam a mesma linha, mas só UM verá `count === 1` — o outro vê 0 e
 * NÃO reexecuta. Retorna `true` se ESTE chamador venceu a corrida.
 */
async function claimPending(
  tenantId: string,
  interactionId: string,
  meta: Record<string, unknown>,
  pending: Record<string, unknown>
): Promise<boolean> {
  const claim = await prisma.interaction.updateMany({
    where: {
      id: interactionId,
      tenantId,
      metadata: { path: ['copilotPending', 'resolved'], equals: false },
    },
    data: {
      metadata: {
        ...meta,
        copilotPending: { ...pending, resolved: true },
      } as unknown as Prisma.InputJsonValue,
    },
  });
  return claim.count === 1;
}

/**
 * REVERTE um claim vencido: regrava `copilotPending.resolved = false` na linha que
 * este chamador havia marcado como `true`. Usado quando a execução da ação confirmada
 * FALHA (erro transitório de DB / deal fora de escopo) — assim um novo "sim" do
 * usuário reencontra a proposta e pode reconfirmar, honrando o "tente novamente" (#1).
 * Best-effort: se a reversão em si falhar, apenas loga (a proposta expira em 30 min).
 */
async function revertClaim(
  tenantId: string,
  interactionId: string,
  meta: Record<string, unknown>,
  pending: Record<string, unknown>
): Promise<void> {
  try {
    await prisma.interaction.updateMany({
      where: {
        id: interactionId,
        tenantId,
        metadata: { path: ['copilotPending', 'resolved'], equals: true },
      },
      data: {
        metadata: {
          ...meta,
          copilotPending: { ...pending, resolved: false },
        } as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (err: unknown) {
    logger.error('Copilot: falha ao reverter claim da proposta', {
      tenantId,
      interactionId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Persiste a mensagem INBOUND do comandante como Interaction WHATSAPP, opcionalmente
 * carregando a ação de escrita pendente em `metadata.copilotPending`.
 */
async function recordInbound(
  tenantId: string,
  connectionId: string,
  userId: string,
  from: string,
  text: string,
  pending?: PendingAction | null
) {
  const metadata: Record<string, unknown> = {
    from,
    connectionId,
    copilot: true,
  };
  if (pending) {
    metadata.copilotPending = { ...pending, connectionId, resolved: false };
  }
  return prisma.interaction.create({
    data: {
      tenantId,
      userId,
      type: InteractionType.WHATSAPP,
      direction: InteractionDirection.INBOUND,
      content: text,
      metadata: metadata as unknown as Prisma.InputJsonValue,
    },
  });
}

// ── Execução das ações de escrita (após aceite) ──────────────────────────────

/**
 * Sentinela lançado quando a revalidação de visibilidade em `executePending` falha
 * (deal fora de escopo no momento da execução). O handler traduz isso numa resposta
 * de "sem acesso" — e NÃO reverte o claim (a proposta é definitivamente inválida).
 */
class DealAccessError extends Error {
  constructor() {
    super('deal_out_of_scope');
    this.name = 'DealAccessError';
  }
}

/**
 * Sentinela lançado quando o usuário NÃO tem a capacidade por-entidade exigida
 * (#2: tasks.create / deals.edit) ou tenta ganhar/perder via fluxo errado (#7/#10/#14).
 * O handler traduz `message` numa resposta em pt-BR e NÃO reverte o claim — a proposta
 * é definitivamente inválida (recusa deliberada, não erro transitório).
 */
class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermissionError';
  }
}

async function executePending(
  tenantId: string,
  permUser: PermissionUser,
  action: PendingAction
): Promise<string> {
  const { taskService } = await import('./taskService.js');
  const { dealService } = await import('./dealService.js');

  if (action.kind === 'criar_tarefa') {
    // #2: capacidade por-entidade ANTES de mutar. Um VIEWER (entities all-false) ou
    // perfil custom com tasks.create=false não pode contornar via copiloto — espelha
    // o gate de POST /tasks e de deals.ts:600.
    const eff = await permissionService.getEffective(permUser);
    if (!eff.entities.tasks.create) {
      logger.warn('Copilot: sem permissão para criar tarefas — execução recusada', {
        tenantId,
        userId: permUser.userId,
        entity: 'task',
      });
      throw new PermissionError('Você não tem permissão para criar tarefas.');
    }
    const args = action.args as { title: string; description?: string; dueDate?: string };
    // LACUNA #1: valida a dueDate ANTES de criar. O modelo pode emitir "amanhã" (o
    // inputSchema aceita string livre); `new Date('amanhã')` = Invalid Date faria o
    // Prisma lançar RangeError ao gravar o DateTime. Esse erro NÃO é DealAccessError
    // nem PermissionError → cairia no ramo "falha transitória" que REVERTE o claim e
    // responde "tente novamente" — mas o erro é DETERMINÍSTICO, então cada novo "sim"
    // repetiria o mesmo erro → LOOP perpétuo (a tarefa nunca é criada). Recusamos como
    // erro PERMANENTE (PermissionError NÃO reverte o claim e dá mensagem acionável).
    if (args.dueDate !== undefined && Number.isNaN(new Date(args.dueDate).getTime())) {
      logger.warn('Copilot: data de vencimento inválida — criação de tarefa recusada', {
        tenantId,
        userId: permUser.userId,
        entity: 'task',
      });
      throw new PermissionError(
        'Data de vencimento inválida — use uma data como 2026-07-10.'
      );
    }
    const task = await taskService.create(tenantId, {
      title: args.title,
      description: args.description,
      assignedTo: permUser.userId,
      status: TaskStatus.PENDING,
      dueDate: args.dueDate,
    });
    logger.info('Copilot tool executed', {
      tool: 'criar_tarefa',
      userId: permUser.userId,
      tenantId,
      entity: 'task',
      entityId: task.id,
    });
    return `Tarefa "${task.title}" criada.`;
  }

  // atualizar_deal
  const args = action.args as { dealId: string; stage?: string; value?: number; notes?: string };
  // #2: capacidade por-entidade ANTES de mutar. Perfil sem deals.edit (VIEWER ou
  // custom) não pode contornar via copiloto — espelha PUT /deals/:id e deals.ts:603.
  const eff = await permissionService.getEffective(permUser);
  if (!eff.entities.deals.edit) {
    logger.warn('Copilot: sem permissão para editar negociações — execução recusada', {
      tenantId,
      userId: permUser.userId,
      entity: 'deal',
      entityId: args.dealId,
    });
    throw new PermissionError('Você não tem permissão para editar negociações.');
  }
  // #7/#10/#14: WON/LOST NÃO passam por dealService.update direto (contornariam
  // markWon/markLost — e LOST exige lostReason). A tool já não expõe esses stages,
  // mas guardamos defensivamente (espelha a guarda do meetingService).
  if (args.stage === 'WON' || args.stage === 'LOST') {
    logger.warn('Copilot: tentativa de ganhar/perder via update direto — recusada', {
      tenantId,
      userId: permUser.userId,
      entity: 'deal',
      entityId: args.dealId,
      stage: args.stage,
    });
    throw new PermissionError(
      'Para ganhar/perder a negociação, use o fluxo próprio na tela do negócio.'
    );
  }
  // #16: revalida a VISIBILIDADE no momento da execução. A proposta pode ter sido
  // aceita até 30 min atrás; nesse intervalo o deal pode ter sido reatribuído p/ fora
  // do escopo do usuário. Recomputa o visibilityScope e confirma com o MESMO filtro de
  // owner ANTES de mutar — se não for mais visível, aborta (não atualiza).
  const owner = await permissionService.visibilityScope(permUser, 'deals');
  const visible = await prisma.deal.findFirst({
    where: {
      id: args.dealId,
      tenantId,
      deletedAt: null,
      // owner: string (PROPRIA) | {in:[...]} (EQUIPE) | undefined (GERAL, sem filtro)
      ...(owner === undefined ? {} : { assignedTo: owner }),
    },
    // #1: carrega também a etapa ATUAL — se o deal já está WON/LOST, uma etapa
    // não-terminal (ex.: NEGOTIATION) faria dealService.update tratar como REABERTURA
    // (status=OPEN, wonAt/lostAt=null), contornando o fluxo dedicado de reabertura.
    select: {
      id: true,
      stage: true,
      demanda: { select: { id: true, valorEnviado: true, valorAprovado: true } },
    },
  });
  if (!visible) {
    logger.warn('Copilot: deal fora de escopo na execução — atualização abortada', {
      tenantId,
      userId: permUser.userId,
      entity: 'deal',
      entityId: args.dealId,
    });
    throw new DealAccessError();
  }
  // Via única (spec captura-demandas, E-16): erro permanente, com mensagem que explica.
  if (visible.demanda && args.stage) {
    throw new PermissionError('Esta negociação tem o andamento controlado pelo Flow.');
  }
  const valorDoFlow =
    visible.demanda &&
    (visible.demanda.valorEnviado !== null || visible.demanda.valorAprovado !== null);
  if (valorDoFlow && typeof args.value === 'number') {
    throw new PermissionError('O valor desta negociação vem do Flow e não muda por aqui.');
  }
  // #1: recusa REABERTURA implícita. Se o deal ALVO já está WON/LOST, mudar para uma
  // etapa não-terminal reabriria a negociação por baixo dos panos — espelha a guarda
  // de WON/LOST acima (fechar) para o caso simétrico (reabrir). Reabertura deve usar o
  // fluxo próprio na tela do negócio.
  if (visible.stage === 'WON' || visible.stage === 'LOST') {
    logger.warn('Copilot: tentativa de reabrir deal fechado via update direto — recusada', {
      tenantId,
      userId: permUser.userId,
      entity: 'deal',
      entityId: args.dealId,
      currentStage: visible.stage,
    });
    throw new PermissionError('Para reabrir a negociação, use o fluxo próprio na tela do negócio.');
  }
  // #2: notas ANEXAM (não sobrescrevem). O usuário digitou só o texto a acrescentar;
  // passar direto p/ dealService.update apagaria as notas existentes do deal. Carrega
  // as notas atuais e concatena — espelha meetingService.applyMeeting.
  let notesUpdate: string | undefined;
  if (args.notes) {
    const currentDeal = await prisma.deal.findFirst({
      where: { id: args.dealId, tenantId },
      select: { notes: true },
    });
    const currentNotes = currentDeal?.notes ?? '';
    notesUpdate = currentNotes ? `${currentNotes}\n\n${args.notes}` : args.notes;
  }
  const updated = await dealService.update(tenantId, {
    id: args.dealId,
    ...(args.stage ? { stage: args.stage as DealStage } : {}),
    ...(typeof args.value === 'number' ? { value: args.value } : {}),
    ...(notesUpdate !== undefined ? { notes: notesUpdate } : {}),
  });
  logger.info('Copilot tool executed', {
    tool: 'atualizar_deal',
    userId: permUser.userId,
    tenantId,
    entity: 'deal',
    entityId: args.dealId,
  });
  return `Negociação "${updated.name}" atualizada.`;
}

// ── Handler principal ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Você é o copiloto comercial da VYD Engage, operando por WhatsApp em português do Brasil.
Responda de forma curta e objetiva. Use as ferramentas de LEITURA para consultar dados reais do CRM
(tarefas, negociações, contatos) antes de responder — nunca invente dados.
Para AÇÕES DE ESCRITA (criar tarefa, atualizar negociação), use a ferramenta correspondente para PROPOR
a ação; ela não executa direto. O sistema pedirá a confirmação do usuário. Nunca proponha excluir nada.
Se o usuário não pediu nada acionável, apenas responda com o que sabe.`;

export const copilotService = {
  /**
   * Roteia uma mensagem recebida ao copiloto. Só deve ser chamado quando a conexão
   * é `isCopilot`. Aplica o gating de IA, autoriza o remetente, executa a
   * confirmação pendente ou dispara o modelo com tools.
   *
   * @param tenantId   tenant da conexão
   * @param connection conexão do copiloto (id + isCopilot)
   * @param from       telefone do remetente (com DDI)
   * @param text       corpo textual da mensagem
   */
  async handleCopilotMessage(
    tenantId: string,
    connection: CopilotConnection,
    from: string,
    text: string
  ): Promise<CopilotResult> {
    // Gating: sem IA configurada → não roteia (apenas loga). Nunca 500.
    if (!isAIEnabled()) {
      logger.info('Copilot: IA não configurada — mensagem não roteada', { tenantId });
      return { handled: false, reply: null, toolsUsed: [] };
    }

    const body = (text || '').trim();
    if (!body) {
      return { handled: false, reply: null, toolsUsed: [] };
    }

    // Autorização: só números conhecidos comandam.
    const user = await resolveCommandingUser(tenantId, from);
    if (!user) {
      const reply = 'Número não autorizado. Peça a um administrador para cadastrar seu WhatsApp no VYD Engage.';
      // SEMPRE loga o remetente desconhecido (warn). O ENVIO da resposta é limitado
      // por número (#17): no máx. 1 a cada ~6h, para não permitir amplificação/custo
      // de saída na API do Meta a partir de um número que não é usuário do tenant.
      logger.warn('Copilot: remetente desconhecido — ignorado', { tenantId, from: digitsOnly(from).slice(-4) });
      if (shouldReplyUnknownSender(from)) {
        await this.reply(tenantId, connection.id, from, reply).catch(() => {});
      }
      return { handled: false, reply, toolsUsed: [] };
    }

    const permUser: PermissionUser = {
      userId: user.id,
      tenantId,
      role: user.role,
      teamId: user.teamId,
      permissionProfileId: user.permissionProfileId,
    };

    // ── Fluxo de confirmação: se há proposta pendente e o texto é "sim"/"não" ──
    // classifyReply só devolve 'confirm'/'cancel' p/ respostas curtas e inequívocas;
    // qualquer outra coisa (incl. consulta natural com fillers) → 'none' → nova consulta.
    const pendingHit = await findPendingAction(tenantId, connection.id, user.id);
    if (pendingHit) {
      const decision = classifyReply(body);
      if (decision === 'confirm') {
        // Claim ATÔMICO: só executa quem venceu a corrida. Dois "sim" concorrentes
        // (ou redelivery do Meta) → só um vê count===1; o outro não reexecuta.
        const won = await claimPending(
          tenantId,
          pendingHit.interactionId,
          pendingHit.metadata,
          pendingHit.pending
        );
        if (!won) {
          logger.info('Copilot: confirmação já processada por outra volta — ignorada', {
            tenantId,
            userId: user.id,
          });
          return { handled: true, reply: null, toolsUsed: [] };
        }
        await recordInbound(tenantId, connection.id, user.id, from, body);
        let reply: string;
        try {
          reply = await executePending(tenantId, permUser, pendingHit.action);
        } catch (err: unknown) {
          if (err instanceof DealAccessError) {
            // #16: o deal saiu do escopo do usuário entre a proposta e o aceite.
            // A proposta é definitivamente inválida — NÃO reverte o claim (não faz
            // sentido reconfirmar algo a que o usuário não tem mais acesso).
            reply = 'Você não tem mais acesso a essa negociação. A ação foi cancelada.';
          } else if (err instanceof PermissionError) {
            // #2/#7/#10/#14: recusa deliberada (sem capacidade por-entidade, ou
            // WON/LOST via fluxo errado). Proposta definitivamente inválida — NÃO
            // reverte o claim; responde a mensagem em pt-BR da própria exceção.
            reply = err.message;
          } else {
            // #1: falha transitória (erro de DB). REVERTE o claim para que um novo
            // "sim" reencontre a proposta e o usuário possa reconfirmar — honrando o
            // "tente novamente" da mensagem.
            logger.error('Copilot: falha ao executar ação confirmada', {
              tenantId,
              userId: user.id,
              err: err instanceof Error ? err.message : String(err),
            });
            await revertClaim(
              tenantId,
              pendingHit.interactionId,
              pendingHit.metadata,
              pendingHit.pending
            );
            reply = 'Não consegui concluir a ação agora. Tente novamente em instantes.';
          }
        }
        await this.reply(tenantId, connection.id, from, reply).catch(() => {});
        return { handled: true, reply, toolsUsed: [] };
      }
      if (decision === 'cancel') {
        // Também atômico: dois "não" concorrentes cancelam só uma vez.
        const won = await claimPending(
          tenantId,
          pendingHit.interactionId,
          pendingHit.metadata,
          pendingHit.pending
        );
        if (!won) {
          return { handled: true, reply: null, toolsUsed: [] };
        }
        await recordInbound(tenantId, connection.id, user.id, from, body);
        const reply = 'Ok, cancelei a ação.';
        await this.reply(tenantId, connection.id, from, reply).catch(() => {});
        return { handled: true, reply, toolsUsed: [] };
      }
      // decision === 'none': o texto é uma NOVA consulta (não confirma/cancela).
      // #6: NÃO expira a proposta antes de garantir que há modelo p/ processar a nova
      // consulta — se getActiveModel() for null, sairíamos consumindo a proposta à toa.
      // A expiração acontece logo abaixo, DEPOIS de resolver o modelo.
    }

    // ── Volta normal: dispara o modelo com tools ───────────────────────────────
    // #6: throttle por usuário AUTORIZADO. Só o caminho do LLM (nova consulta) é
    // limitado — os fluxos de confirmação/cancelamento já retornaram acima e nunca
    // chamam o modelo. Em rajada, responde curtinho SEM invocar generateText.
    if (!shouldInvokeLlm(tenantId, user.id)) {
      logger.warn('Copilot: throttle de LLM por usuário — invocação recusada', {
        tenantId,
        userId: user.id,
      });
      const reply = 'Aguarde um instante e tente de novo.';
      await this.reply(tenantId, connection.id, from, reply).catch(() => {});
      return { handled: true, reply, toolsUsed: [] };
    }

    const model = getActiveModel();
    if (!model) {
      logger.info('Copilot: modelo indisponível apesar de IA habilitada', { tenantId });
      return { handled: false, reply: null, toolsUsed: [] };
    }

    // #6: só agora que há modelo, EXPIRA a proposta pendente (claim atômico) e segue
    // como nova consulta. Não importa quem vença aqui — só evitamos ressuscitá-la.
    if (pendingHit) {
      await claimPending(
        tenantId,
        pendingHit.interactionId,
        pendingHit.metadata,
        pendingHit.pending
      );
    }

    const toolsUsed: string[] = [];
    let proposal: PendingAction | null = null;

    const tools = this.buildTools(tenantId, permUser, {
      onRead: (name) => toolsUsed.push(name),
      onPropose: (p) => {
        proposal = p;
      },
    });

    let replyText = '';
    try {
      const startedAt = Date.now();
      // O genérico de `generateText` sobre um `ToolSet` dispara instanciação de tipo
      // recursiva (instantiateType_DepthLimit) que estoura a memória do tsc — o mesmo
      // motivo pelo qual `meetingService` chama `generateObject` sem tipar. Invocamos
      // por uma assinatura enxuta: o comportamento em runtime é idêntico e o schema de
      // cada tool continua tipado dentro de `tool()`.
      const runGenerateText = generateText as unknown as (
        opts: Record<string, unknown>
      ) => Promise<{
        text?: string;
        usage?: { totalTokens?: number; inputTokens?: number; outputTokens?: number };
      }>;
      const result = await runGenerateText({
        model,
        system: SYSTEM_PROMPT,
        prompt: body,
        tools,
        stopWhen: stepCountIs(5),
        temperature: 0.2,
        maxOutputTokens: 500,
      });
      replyText = (result.text || '').trim();
      logAiUsage({
        feature: 'copilot',
        tenantId,
        latencyMs: Date.now() - startedAt,
        tokens: result.usage?.totalTokens,
        promptTokens: result.usage?.inputTokens,
        completionTokens: result.usage?.outputTokens,
        provider: resolveProviderConfig()?.provider,
      });
    } catch (err: unknown) {
      logger.error('Copilot: erro no modelo', {
        tenantId,
        userId: user.id,
        err: err instanceof Error ? err.message : String(err),
      });
      const reply = 'O assistente está indisponível no momento. Tente novamente em instantes.';
      await this.reply(tenantId, connection.id, from, reply).catch(() => {});
      return { handled: true, reply, toolsUsed };
    }

    // Se o modelo propôs uma escrita, persiste a proposta e pede confirmação.
    if (proposal) {
      const p = proposal as PendingAction;
      const confirmMsg = `${p.summary}\n\nResponda "sim" para confirmar ou "não" para cancelar.`;
      await recordInbound(tenantId, connection.id, user.id, from, body, p);
      await this.reply(tenantId, connection.id, from, confirmMsg).catch(() => {});
      return { handled: true, reply: confirmMsg, toolsUsed, pending: p };
    }

    const reply = replyText || 'Não encontrei nada para responder.';
    await recordInbound(tenantId, connection.id, user.id, from, body);
    await this.reply(tenantId, connection.id, from, reply).catch(() => {});
    return { handled: true, reply, toolsUsed, pending: null };
  },

  /**
   * Monta o conjunto de tools do copiloto. LEITURA executa direto (escopado);
   * ESCRITA apenas registra a proposta via `onPropose` (não muta o banco).
   */
  buildTools(
    tenantId: string,
    user: PermissionUser,
    hooks: { onRead: (name: string) => void; onPropose: (p: PendingAction) => void }
  ): ToolSet {
    return {
      // ── LEITURA ──────────────────────────────────────────────────────────
      minhas_tarefas_hoje: defineTool({
        description: 'Lista as tarefas pendentes do usuário com vencimento até hoje.',
        inputSchema: z.object({}),
        execute: async () => {
          hooks.onRead('minhas_tarefas_hoje');
          const endOfToday = new Date();
          endOfToday.setHours(23, 59, 59, 999);
          const tasks = await prisma.task.findMany({
            where: {
              tenantId,
              assignedTo: user.userId, // sempre as PRÓPRIAS tarefas do comandante
              deletedAt: null,
              status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] },
              OR: [{ dueDate: null }, { dueDate: { lte: endOfToday } }],
            },
            select: { id: true, title: true, dueDate: true, status: true },
            orderBy: { dueDate: 'asc' },
            take: 20,
          });
          logger.info('Copilot tool call', { tool: 'minhas_tarefas_hoje', userId: user.userId, tenantId, count: tasks.length });
          return { tasks };
        },
      }),

      status_do_deal: defineTool({
        description: 'Consulta o status de uma negociação pelo nome (busca parcial). Respeita a visibilidade do usuário.',
        inputSchema: z.object({
          nome: z.string().min(1).describe('Nome ou parte do nome da negociação'),
        }),
        execute: async ({ nome }) => {
          hooks.onRead('status_do_deal');
          const owner = await permissionService.visibilityScope(user, 'deals');
          const deals = await prisma.deal.findMany({
            where: {
              tenantId,
              deletedAt: null,
              name: { contains: nome, mode: 'insensitive' },
              // owner: string (PROPRIA) | {in:[...]} (EQUIPE) | undefined (GERAL, sem filtro)
              ...(owner === undefined ? {} : { assignedTo: owner }),
            },
            select: { id: true, name: true, stage: true, status: true, value: true, expectedCloseDate: true },
            orderBy: { updatedAt: 'desc' },
            take: 5,
          });
          logger.info('Copilot tool call', { tool: 'status_do_deal', userId: user.userId, tenantId, count: deals.length });
          return { deals };
        },
      }),

      buscar_contato: defineTool({
        description: 'Busca um contato (lead) por nome, e-mail ou telefone. Respeita a visibilidade do usuário.',
        inputSchema: z.object({
          termo: z.string().min(1).describe('Nome, e-mail ou telefone do contato'),
        }),
        execute: async ({ termo }) => {
          hooks.onRead('buscar_contato');
          const owner = await permissionService.visibilityScope(user, 'contacts');
          const leads = await prisma.lead.findMany({
            where: {
              tenantId,
              deletedAt: null,
              // owner: string (PROPRIA) | {in:[...]} (EQUIPE) | undefined (GERAL, sem filtro)
              ...(owner === undefined ? {} : { assignedTo: owner }),
              OR: [
                { name: { contains: termo, mode: 'insensitive' } },
                { email: { contains: termo, mode: 'insensitive' } },
                { phone: { contains: termo } },
              ],
            },
            select: { id: true, name: true, email: true, phone: true, company: true, status: true },
            orderBy: { updatedAt: 'desc' },
            take: 5,
          });
          logger.info('Copilot tool call', { tool: 'buscar_contato', userId: user.userId, tenantId, count: leads.length });
          return { leads };
        },
      }),

      // ── ESCRITA (propõe; NÃO executa) ─────────────────────────────────────
      criar_tarefa: defineTool({
        description:
          'PROPÕE a criação de uma tarefa para o usuário. NÃO cria imediatamente — o sistema pedirá confirmação.',
        inputSchema: z.object({
          title: z.string().min(1).describe('Título da tarefa'),
          description: z.string().optional(),
          dueDate: z.string().optional().describe('Data de vencimento ISO (opcional)'),
        }),
        execute: async ({ title, description, dueDate }) => {
          logger.info('Copilot tool call', { tool: 'criar_tarefa(proposta)', userId: user.userId, tenantId, entity: 'task' });
          hooks.onPropose({
            kind: 'criar_tarefa',
            args: { title, description, dueDate },
            summary: `Vou criar a tarefa: "${title}"${dueDate ? ` (vence em ${dueDate})` : ''}.`,
          });
          return { proposed: true, title };
        },
      }),

      atualizar_deal: defineTool({
        description:
          'PROPÕE a atualização de uma negociação (etapa/valor/notas). NÃO altera imediatamente — o sistema pedirá confirmação. Nunca exclui.',
        inputSchema: z.object({
          dealId: z.string().min(1).describe('ID da negociação (use buscar/status para obter)'),
          // WON/LOST NÃO são expostos: ganhar/perder exige o fluxo próprio (markWon/
          // markLost, com lostReason) na tela do negócio — não via update direto (#7/#10/#14).
          stage: z
            .enum(['QUALIFICATION', 'PROPOSAL', 'NEGOTIATION', 'CLOSING'])
            .optional(),
          // #5: piso em 0 — espelha a guarda `num < 0` do meetingService (sem valor negativo).
          value: z.number().min(0).optional(),
          notes: z.string().optional(),
        }),
        execute: async ({ dealId, stage, value, notes }) => {
          // Valida que o deal existe no tenant E é visível ao usuário antes de propor.
          const owner = await permissionService.visibilityScope(user, 'deals');
          const deal = await prisma.deal.findFirst({
            where: {
              id: dealId,
              tenantId,
              deletedAt: null,
              // owner: string (PROPRIA) | {in:[...]} (EQUIPE) | undefined (GERAL, sem filtro)
              ...(owner === undefined ? {} : { assignedTo: owner }),
            },
            select: { id: true, name: true },
          });
          if (!deal) {
            return { proposed: false, error: 'Negociação não encontrada ou sem acesso.' };
          }
          const changes: string[] = [];
          if (stage) changes.push(`etapa → ${stage}`);
          if (typeof value === 'number') changes.push(`valor → ${value}`);
          if (notes) changes.push('notas atualizadas');
          logger.info('Copilot tool call', { tool: 'atualizar_deal(proposta)', userId: user.userId, tenantId, entity: 'deal', entityId: dealId });
          hooks.onPropose({
            kind: 'atualizar_deal',
            args: { dealId, stage, value, notes },
            summary: `Vou atualizar "${deal.name}": ${changes.join(', ') || 'sem mudanças'}.`,
          });
          return { proposed: true, dealName: deal.name };
        },
      }),
    };
  },

  /** Envia a resposta do copiloto pela própria conexão (texto). */
  async reply(tenantId: string, connectionId: string, to: string, content: string): Promise<void> {
    await whatsappMessagingService.sendMessage(tenantId, {
      connectionId,
      to,
      type: 'text',
      content,
    });
  },
};

export default copilotService;
