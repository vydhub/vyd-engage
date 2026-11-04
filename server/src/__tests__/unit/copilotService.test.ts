import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../helpers/prismaMock.js';

/**
 * Cobertura do copilotService (Upgrade RD P3, req 25 — Copiloto IA via WhatsApp).
 *
 * PROVA os invariantes de segurança do design fixado:
 *  - GATING: sem IA → não roteia (não responde, não consulta).
 *  - AUTORIZAÇÃO: número desconhecido → "não autorizado" e ignora (não executa nada).
 *  - LEITURA ESCOPADA: tool de leitura respeita o visibilityScope do usuário (P1).
 *  - ESCRITA COM ACEITE: proposta de escrita NÃO executa antes do "confirmar";
 *    só após a confirmação a tarefa/deal é de fato criada/atualizada.
 *  - NUNCA EXCLUI: não existe tool de exclusão exposta.
 *
 * IA (`ai.generateText`) e o envio (`whatsappMessagingService.sendMessage`) são
 * mockados; o Prisma é o deep-mock do repo. O mock de generateText EXECUTA as
 * tools que recebe, simulando a decisão do modelo de forma determinística.
 */

// ── Mocks de IA (habilitada por padrão; casos desligam quando preciso) ─────────
const isAIEnabledMock = vi.fn(() => true);
const getActiveModelMock = vi.fn(() => ({ id: 'mock-model' }));
vi.mock('../../services/aiProvider.js', () => ({
  isAIEnabled: () => isAIEnabledMock(),
  getActiveModel: () => getActiveModelMock(),
  resolveProviderConfig: () => ({ provider: 'openai', apiKey: 'x' }),
  logAiUsage: vi.fn(),
}));

// generateText mockado: a cada teste, `generateTextImpl` decide o que fazer com as
// tools (chamar leitura/escrita) e qual texto retornar.
let generateTextImpl: (opts: any) => Promise<any>;
vi.mock('ai', () => ({
  generateText: (opts: any) => generateTextImpl(opts),
  tool: (def: any) => def, // passthrough: preserva `execute`/`inputSchema`
  stepCountIs: (n: number) => n,
}));

// Envio de WhatsApp mockado (captura as respostas do copiloto).
const sendMessageMock = vi.fn(async (..._args: unknown[]) => ({ messageId: 'wamid.1', status: 'sent', to: '55' }));
vi.mock('../../services/whatsappMessagingService.js', () => ({
  whatsappMessagingService: { sendMessage: (...args: any[]) => sendMessageMock(...args) },
}));

// taskService/dealService são importados dinamicamente dentro do service em execução.
const taskCreateMock = vi.fn(async (_t: string, d: any) => ({ id: 'task-1', title: d.title }));
const dealUpdateMock = vi.fn(async (_t: string, d: any) => ({ id: d.id, name: 'Deal X' }));
vi.mock('../../services/taskService.js', () => ({
  taskService: { create: (...a: any[]) => taskCreateMock(...(a as [string, any])) },
}));
vi.mock('../../services/dealService.js', () => ({
  dealService: { update: (...a: any[]) => dealUpdateMock(...(a as [string, any])) },
}));

import { copilotService, __resetCopilotRateLimiters } from '../../services/copilotService.js';

const tenantId = 'tenant-1';
const connection = { id: 'conn-1', tenantId, isCopilot: true };
const KNOWN_FROM = '5511998887766';

// Usuário comandante conhecido (analista USER → visibilidade de deals PROPRIA).
const knownUser = {
  id: 'user-1',
  name: 'Ana',
  role: 'USER',
  teamId: null,
  permissionProfileId: null,
  whatsappNumber: '+55 11 99888-7766',
};

beforeEach(() => {
  vi.clearAllMocks();
  // #6: zera o throttle de LLM por usuário (Map módulo-nível persiste entre testes).
  __resetCopilotRateLimiters();
  isAIEnabledMock.mockReturnValue(true);
  getActiveModelMock.mockReturnValue({ id: 'mock-model' } as any);
  generateTextImpl = async () => ({ text: 'ok', usage: {} });
  // Por padrão: nenhum usuário conhecido e nenhuma pendência.
  prismaMock.user.findMany.mockResolvedValue([] as never);
  // findPendingAction agora busca a proposta pendente DIRETAMENTE via findFirst
  // (filtro por path de JSON: metadata.copilotPending.resolved = false).
  prismaMock.interaction.findFirst.mockResolvedValue(null as never);
  prismaMock.interaction.create.mockResolvedValue({ id: 'int-1' } as never);
  // Claim atômico: por padrão ESTE chamador vence a corrida (count === 1).
  prismaMock.interaction.updateMany.mockResolvedValue({ count: 1 } as never);
  prismaMock.user.findFirst.mockResolvedValue(null as never); // permissionService fail-closed
});

describe('gating de IA', () => {
  it('sem IA configurada → não roteia (não responde, não consulta usuário)', async () => {
    isAIEnabledMock.mockReturnValue(false);

    const res = await copilotService.handleCopilotMessage(tenantId, connection, KNOWN_FROM, 'oi');

    expect(res.handled).toBe(false);
    expect(res.reply).toBeNull();
    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });
});

describe('autorização por número', () => {
  it('número desconhecido → responde "não autorizado" e não executa nada', async () => {
    prismaMock.user.findMany.mockResolvedValue([] as never); // ninguém casa

    const res = await copilotService.handleCopilotMessage(
      tenantId,
      connection,
      '5511000000000',
      'quais minhas tarefas?'
    );

    expect(res.handled).toBe(false);
    expect(res.reply).toMatch(/não autorizado/i);
    // Respondeu, mas não chamou o modelo nem criou interação de comando.
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(taskCreateMock).not.toHaveBeenCalled();
    expect(dealUpdateMock).not.toHaveBeenCalled();
  });

  it('número AMBÍGUO (dois usuários ativos casam) → recusa (não escolhe o primeiro)', async () => {
    // Dois usuários ATIVOS cujo whatsappNumber casa com o remetente pela mesma
    // variante normalizada (com e sem o DDI 55). O antigo casamento por sufixo
    // autorizaria o primeiro; o novo exige match ÚNICO e RECUSA.
    prismaMock.user.findMany.mockResolvedValue([
      { ...knownUser, id: 'user-a', whatsappNumber: '5511998887766' },
      { ...knownUser, id: 'user-b', whatsappNumber: '+55 11 99888-7766' },
    ] as never);

    const res = await copilotService.handleCopilotMessage(
      tenantId,
      connection,
      KNOWN_FROM,
      'quais minhas tarefas?'
    );

    expect(res.handled).toBe(false);
    expect(res.reply).toMatch(/não autorizado/i);
    // Nenhuma ação executada — não escolheu nenhum dos dois.
    expect(taskCreateMock).not.toHaveBeenCalled();
    expect(dealUpdateMock).not.toHaveBeenCalled();
  });
});

describe('leitura escopada', () => {
  it('número conhecido → tool de leitura roda escopada ao próprio usuário (USER=PROPRIA)', async () => {
    prismaMock.user.findMany.mockResolvedValue([knownUser] as never);
    prismaMock.deal.findMany.mockResolvedValue([
      { id: 'deal-1', name: 'Deal X', stage: 'PROPOSAL', status: 'OPEN', value: 1000 },
    ] as never);

    // O "modelo" decide usar a tool status_do_deal.
    generateTextImpl = async ({ tools }: any) => {
      await tools.status_do_deal.execute({ nome: 'Deal' });
      return { text: 'A negociação Deal X está em PROPOSAL.', usage: {} };
    };

    const res = await copilotService.handleCopilotMessage(
      tenantId,
      connection,
      KNOWN_FROM,
      'status da deal'
    );

    expect(res.handled).toBe(true);
    expect(res.toolsUsed).toContain('status_do_deal');
    // USER tem visibilidade PROPRIA de deals → filtro assignedTo = próprio userId.
    const where = (prismaMock.deal.findMany as any).mock.calls[0][0].where;
    expect(where.tenantId).toBe(tenantId);
    expect(where.assignedTo).toBe('user-1');
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
  });
});

describe('escrita com aceite', () => {
  it('proposta de criar tarefa NÃO executa antes da confirmação', async () => {
    prismaMock.user.findMany.mockResolvedValue([knownUser] as never);

    // O "modelo" propõe criar tarefa (chama a tool de escrita, que só registra).
    generateTextImpl = async ({ tools }: any) => {
      await tools.criar_tarefa.execute({ title: 'Ligar para cliente' });
      return { text: '', usage: {} };
    };

    const res = await copilotService.handleCopilotMessage(
      tenantId,
      connection,
      KNOWN_FROM,
      'crie uma tarefa'
    );

    expect(res.handled).toBe(true);
    expect(res.pending?.kind).toBe('criar_tarefa');
    expect(res.reply).toMatch(/sim.*confirmar/i);
    // NÃO criou a tarefa ainda.
    expect(taskCreateMock).not.toHaveBeenCalled();
    // Persistiu a pendência na Interaction.
    const createArg = (prismaMock.interaction.create as any).mock.calls.at(-1)[0].data;
    expect(createArg.metadata.copilotPending.kind).toBe('criar_tarefa');
    expect(createArg.metadata.copilotPending.resolved).toBe(false);
  });

  it('após "confirmar", executa a tarefa pendente (só então cria)', async () => {
    prismaMock.user.findMany.mockResolvedValue([knownUser] as never);
    // Há uma pendência recente desta conexão/usuário.
    prismaMock.interaction.findFirst.mockResolvedValue({
        id: 'int-pending',
        metadata: {
          copilotPending: {
            kind: 'criar_tarefa',
            args: { title: 'Ligar para cliente' },
            summary: 'Vou criar a tarefa...',
            connectionId: 'conn-1',
            resolved: false,
          },
        },
      } as never);

    const res = await copilotService.handleCopilotMessage(
      tenantId,
      connection,
      KNOWN_FROM,
      'sim'
    );

    expect(res.handled).toBe(true);
    expect(taskCreateMock).toHaveBeenCalledTimes(1);
    expect(taskCreateMock.mock.calls[0][1]).toMatchObject({
      title: 'Ligar para cliente',
      assignedTo: 'user-1',
    });
    expect(res.reply).toMatch(/criada/i);
    // Nunca dispara o modelo no caminho de confirmação.
    expect(res.toolsUsed).toEqual([]);
    // O claim atômico foi disparado (updateMany condicional), não o par
    // findUnique+update antigo.
    expect(prismaMock.interaction.updateMany).toHaveBeenCalledTimes(1);
    const claimArg = (prismaMock.interaction.updateMany as any).mock.calls[0][0];
    expect(claimArg.where.metadata.path).toEqual(['copilotPending', 'resolved']);
    expect(claimArg.where.metadata.equals).toBe(false);
  });

  it('segundo "sim" concorrente (claim perdido) → NÃO executa de novo (idempotente)', async () => {
    prismaMock.user.findMany.mockResolvedValue([knownUser] as never);
    prismaMock.interaction.findFirst.mockResolvedValue({
        id: 'int-pending',
        metadata: {
          copilotPending: {
            kind: 'criar_tarefa',
            args: { title: 'Ligar para cliente' },
            summary: 'Vou criar a tarefa...',
            connectionId: 'conn-1',
            resolved: false,
          },
        },
      } as never);
    // A outra volta já resolveu a linha: o claim condicional não afeta nada.
    prismaMock.interaction.updateMany.mockResolvedValue({ count: 0 } as never);

    const res = await copilotService.handleCopilotMessage(
      tenantId,
      connection,
      KNOWN_FROM,
      'sim'
    );

    // Perdeu a corrida → não cria a tarefa nem envia resposta duplicada.
    expect(res.handled).toBe(true);
    expect(res.reply).toBeNull();
    expect(taskCreateMock).not.toHaveBeenCalled();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('"confirmo" (afirmação pura) confirma a pendência (não exige "sim" literal) (#13)', async () => {
    prismaMock.user.findMany.mockResolvedValue([knownUser] as never);
    prismaMock.interaction.findFirst.mockResolvedValue({
        id: 'int-pending',
        metadata: {
          copilotPending: {
            kind: 'criar_tarefa',
            args: { title: 'Ligar para cliente' },
            summary: 'Vou criar a tarefa...',
            connectionId: 'conn-1',
            resolved: false,
          },
        },
      } as never);

    const res = await copilotService.handleCopilotMessage(
      tenantId,
      connection,
      KNOWN_FROM,
      'sim confirmo'
    );

    // "sim confirmo" = afirmação PURA (todos os tokens fortes) → executa.
    expect(res.handled).toBe(true);
    expect(taskCreateMock).toHaveBeenCalledTimes(1);
    expect(res.reply).toMatch(/criada/i);
    // Não disparou o modelo (caminho de confirmação, não de nova consulta).
    expect(res.toolsUsed).toEqual([]);
  });

  it('"confirma a reunião" (nova consulta acionável) NÃO executa a pendência (#2)', async () => {
    // ENDURECIMENTO: uma consulta curta acionável que por acaso contém "confirma"
    // NÃO é aceite explícito. Deve virar nova consulta (proposta expira), NÃO executar.
    prismaMock.user.findMany.mockResolvedValue([knownUser] as never);
    prismaMock.interaction.findFirst.mockResolvedValue({
        id: 'int-pending',
        metadata: {
          copilotPending: {
            kind: 'criar_tarefa',
            args: { title: 'Ligar para cliente' },
            summary: 'Vou criar a tarefa...',
            connectionId: 'conn-1',
            resolved: false,
          },
        },
      } as never);
    // O "modelo" trata como nova consulta (não escreve nada).
    let modelCalled = false;
    generateTextImpl = async () => {
      modelCalled = true;
      return { text: 'Sua próxima reunião é amanhã às 10h.', usage: {} };
    };

    const res = await copilotService.handleCopilotMessage(
      tenantId,
      connection,
      KNOWN_FROM,
      'confirma a reunião'
    );

    // Não é confirmação pura → 'none': EXPIRA a proposta e vira nova consulta.
    expect(res.handled).toBe(true);
    expect(taskCreateMock).not.toHaveBeenCalled();
    expect(modelCalled).toBe(true);
    expect(res.reply).toMatch(/reunião/i);
    // A proposta pendente foi expirada via claim atômico antes de seguir.
    expect(prismaMock.interaction.updateMany).toHaveBeenCalled();
  });

  it('"sim quero relatório" (nova consulta acionável) NÃO executa a pendência (#2)', async () => {
    // "sim" no início de uma consulta acionável não é aceite explícito da proposta.
    prismaMock.user.findMany.mockResolvedValue([knownUser] as never);
    prismaMock.interaction.findFirst.mockResolvedValue({
        id: 'int-pending',
        metadata: {
          copilotPending: {
            kind: 'criar_tarefa',
            args: { title: 'Ligar para cliente' },
            summary: 'Vou criar a tarefa...',
            connectionId: 'conn-1',
            resolved: false,
          },
        },
      } as never);
    let modelCalled = false;
    generateTextImpl = async () => {
      modelCalled = true;
      return { text: 'Aqui está o relatório.', usage: {} };
    };

    const res = await copilotService.handleCopilotMessage(
      tenantId,
      connection,
      KNOWN_FROM,
      'sim quero relatório'
    );

    // 4 tokens (>3) e não puramente afirmativos → 'none': não executa.
    expect(res.handled).toBe(true);
    expect(taskCreateMock).not.toHaveBeenCalled();
    expect(modelCalled).toBe(true);
    expect(prismaMock.interaction.updateMany).toHaveBeenCalled();
  });

  it('falha transitória na execução → REVERTE o claim p/ reconfirmação (#1)', async () => {
    prismaMock.user.findMany.mockResolvedValue([knownUser] as never);
    prismaMock.interaction.findFirst.mockResolvedValue({
        id: 'int-pending',
        metadata: {
          copilotPending: {
            kind: 'criar_tarefa',
            args: { title: 'Ligar para cliente' },
            summary: 'Vou criar a tarefa...',
            connectionId: 'conn-1',
            resolved: false,
          },
        },
      } as never);
    // A criação da tarefa falha (erro transitório de DB).
    taskCreateMock.mockRejectedValueOnce(new Error('db timeout'));

    const res = await copilotService.handleCopilotMessage(
      tenantId,
      connection,
      KNOWN_FROM,
      'sim'
    );

    // Respondeu "tente novamente" e NÃO deixou a proposta resolvida definitivamente.
    expect(res.handled).toBe(true);
    expect(res.reply).toMatch(/tente novamente/i);
    // Dois updateMany: [0] o claim (resolved→true) e [1] a reversão (resolved→false).
    expect(prismaMock.interaction.updateMany).toHaveBeenCalledTimes(2);
    const claimArg = (prismaMock.interaction.updateMany as any).mock.calls[0][0];
    expect(claimArg.where.metadata.equals).toBe(false); // claim: só a linha ainda aberta
    const revertArg = (prismaMock.interaction.updateMany as any).mock.calls[1][0];
    expect(revertArg.where.metadata.equals).toBe(true); // revert: só a linha que fechamos
    // O metadata regravado volta a resolved=false → um novo "sim" reencontra a proposta.
    expect((revertArg.data.metadata as any).copilotPending.resolved).toBe(false);
  });

  it('após "não", cancela a pendência sem executar', async () => {
    prismaMock.user.findMany.mockResolvedValue([knownUser] as never);
    prismaMock.interaction.findFirst.mockResolvedValue({
        id: 'int-pending',
        metadata: {
          copilotPending: {
            kind: 'atualizar_deal',
            args: { dealId: 'deal-1', stage: 'NEGOTIATION' },
            summary: '...',
            connectionId: 'conn-1',
            resolved: false,
          },
        },
      } as never);

    const res = await copilotService.handleCopilotMessage(
      tenantId,
      connection,
      KNOWN_FROM,
      'não'
    );

    expect(res.handled).toBe(true);
    expect(dealUpdateMock).not.toHaveBeenCalled();
    expect(res.reply).toMatch(/cancel/i);
  });

  it('"isso não" cancela (o "não" forte decide; "isso" é filler) (#1/#6)', async () => {
    prismaMock.user.findMany.mockResolvedValue([knownUser] as never);
    prismaMock.interaction.findFirst.mockResolvedValue({
        id: 'int-pending',
        metadata: {
          copilotPending: {
            kind: 'criar_tarefa',
            args: { title: 'Ligar para cliente' },
            summary: 'Vou criar a tarefa...',
            connectionId: 'conn-1',
            resolved: false,
          },
        },
      } as never);

    const res = await copilotService.handleCopilotMessage(
      tenantId,
      connection,
      KNOWN_FROM,
      'isso não'
    );

    // "isso" é filler; o "não" forte manda → cancela (não executa a escrita pendente).
    expect(res.handled).toBe(true);
    expect(taskCreateMock).not.toHaveBeenCalled();
    expect(res.reply).toMatch(/cancel/i);
    expect(res.toolsUsed).toEqual([]);
  });

  it('consulta natural com filler ("ok, e o deal Y?") NÃO executa a pendência (#1/#6)', async () => {
    prismaMock.user.findMany.mockResolvedValue([knownUser] as never);
    prismaMock.interaction.findFirst.mockResolvedValue({
        id: 'int-pending',
        metadata: {
          copilotPending: {
            kind: 'criar_tarefa',
            args: { title: 'Ligar para cliente' },
            summary: 'Vou criar a tarefa...',
            connectionId: 'conn-1',
            resolved: false,
          },
        },
      } as never);
    // O "modelo" trata como nova consulta (chama leitura, não escreve nada).
    let modelCalled = false;
    generateTextImpl = async () => {
      modelCalled = true;
      return { text: 'O deal Y está em PROPOSAL.', usage: {} };
    };

    const res = await copilotService.handleCopilotMessage(
      tenantId,
      connection,
      KNOWN_FROM,
      'ok, e o status do deal Y?'
    );

    // >3 tokens → 'none': EXPIRA a proposta e vira nova consulta. NÃO cria a tarefa.
    expect(res.handled).toBe(true);
    expect(taskCreateMock).not.toHaveBeenCalled();
    expect(modelCalled).toBe(true);
    expect(res.reply).toMatch(/deal Y/i);
    // A proposta pendente foi expirada via claim atômico antes de seguir.
    expect(prismaMock.interaction.updateMany).toHaveBeenCalled();
  });

  it('VIEWER (sem capacidade) → escrita recusada mesmo após "sim" (#2)', async () => {
    // Comandante é VIEWER: entities all-false (fail-closed via defaults, sem perfil custom).
    prismaMock.user.findMany.mockResolvedValue([
      { ...knownUser, role: 'VIEWER' },
    ] as never);
    prismaMock.interaction.findFirst.mockResolvedValue({
        id: 'int-pending',
        metadata: {
          copilotPending: {
            kind: 'criar_tarefa',
            args: { title: 'Ligar para cliente' },
            summary: 'Vou criar a tarefa...',
            connectionId: 'conn-1',
            resolved: false,
          },
        },
      } as never);

    const res = await copilotService.handleCopilotMessage(
      tenantId,
      connection,
      KNOWN_FROM,
      'sim'
    );

    // Recusado por falta de capacidade — a tarefa NUNCA é criada.
    expect(res.handled).toBe(true);
    expect(taskCreateMock).not.toHaveBeenCalled();
    expect(res.reply).toMatch(/não tem permissão/i);
  });

  it('criar_tarefa com dueDate inválida ("amanhã") → recusa acionável, não cria, não faz loop (#1)', async () => {
    // LACUNA #1: o modelo pode emitir "amanhã" como dueDate. Antes, `new Date('amanhã')`
    // = Invalid Date faria o Prisma lançar RangeError → ramo "falha transitória" que
    // reverte o claim e responde "tente novamente" → cada novo "sim" repetiria o mesmo
    // erro determinístico (LOOP). Agora a data inválida é recusada como erro PERMANENTE:
    // resposta acionável, taskService.create NUNCA é chamado, e o claim NÃO é revertido.
    prismaMock.user.findMany.mockResolvedValue([knownUser] as never);
    prismaMock.interaction.findFirst.mockResolvedValue({
        id: 'int-pending',
        metadata: {
          copilotPending: {
            kind: 'criar_tarefa',
            args: { title: 'Ligar para cliente', dueDate: 'amanhã' },
            summary: 'Vou criar a tarefa...',
            connectionId: 'conn-1',
            resolved: false,
          },
        },
      } as never);

    const res = await copilotService.handleCopilotMessage(
      tenantId,
      connection,
      KNOWN_FROM,
      'sim'
    );

    expect(res.handled).toBe(true);
    // Mensagem acionável (sugere formato de data válido), não "tente novamente".
    expect(res.reply).toMatch(/data de vencimento inválida/i);
    expect(res.reply).not.toMatch(/tente novamente/i);
    // A tarefa NUNCA é criada com uma data inválida.
    expect(taskCreateMock).not.toHaveBeenCalled();
    // Recusa PERMANENTE: só o claim (resolved→true) roda; NÃO há reversão (resolved→false)
    // — sem reversão, um novo "sim" não reencontra a proposta e não repete o erro (não loopa).
    expect(prismaMock.interaction.updateMany).toHaveBeenCalledTimes(1);
    const claimArg = (prismaMock.interaction.updateMany as any).mock.calls[0][0];
    expect(claimArg.where.metadata.equals).toBe(false);
  });

  it('atualizar_deal com stage=WON → recusado (fluxo próprio) (#7/#10/#14)', async () => {
    prismaMock.user.findMany.mockResolvedValue([knownUser] as never);
    prismaMock.interaction.findFirst.mockResolvedValue({
        id: 'int-pending',
        metadata: {
          copilotPending: {
            kind: 'atualizar_deal',
            args: { dealId: 'deal-1', stage: 'WON' },
            summary: 'Vou atualizar...',
            connectionId: 'conn-1',
            resolved: false,
          },
        },
      } as never);
    // USER tem deals.edit=true; a recusa vem da guarda de stage, não da capacidade.

    const res = await copilotService.handleCopilotMessage(
      tenantId,
      connection,
      KNOWN_FROM,
      'sim'
    );

    // Recusado: WON não pode via update direto (contornaria markWon).
    expect(res.handled).toBe(true);
    expect(dealUpdateMock).not.toHaveBeenCalled();
    expect(res.reply).toMatch(/fluxo próprio/i);
  });

  it('atualizar_deal com valor em Negócio cujo valor veio do Flow → recusado (E-15, E-16)', async () => {
    prismaMock.user.findMany.mockResolvedValue([knownUser] as never);
    prismaMock.interaction.findFirst.mockResolvedValue({
      id: 'int-pending',
      metadata: {
        copilotPending: {
          kind: 'atualizar_deal',
          args: { dealId: 'deal-1', value: 1 },
          summary: 'Vou atualizar...',
          connectionId: 'conn-1',
          resolved: false,
        },
      },
    } as never);
    prismaMock.deal.findFirst.mockResolvedValueOnce({
      id: 'deal-1',
      stage: 'PROPOSAL',
      demanda: { id: 'dem-1', valorEnviado: 500, valorAprovado: null },
    } as never);

    const res = await copilotService.handleCopilotMessage(tenantId, connection, KNOWN_FROM, 'sim');

    expect(res.handled).toBe(true);
    expect(dealUpdateMock).not.toHaveBeenCalled();
    expect(res.reply).toMatch(/vem do Flow/i);
  });

  it('atualizar_deal com valor em Negócio da Captura sem valor do Flow → segue (estimado é livre)', async () => {
    prismaMock.user.findMany.mockResolvedValue([knownUser] as never);
    prismaMock.interaction.findFirst.mockResolvedValue({
      id: 'int-pending',
      metadata: {
        copilotPending: {
          kind: 'atualizar_deal',
          args: { dealId: 'deal-1', value: 1 },
          summary: 'Vou atualizar...',
          connectionId: 'conn-1',
          resolved: false,
        },
      },
    } as never);
    prismaMock.deal.findFirst.mockResolvedValueOnce({
      id: 'deal-1',
      stage: 'PROPOSAL',
      demanda: { id: 'dem-1', valorEnviado: null, valorAprovado: null },
    } as never);

    await copilotService.handleCopilotMessage(tenantId, connection, KNOWN_FROM, 'sim');

    expect(dealUpdateMock).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ id: 'deal-1', value: 1 })
    );
  });

  it('atualizar_deal cujo deal-alvo já está WON → recusa REABERTURA (não chama update) (#1)', async () => {
    // Proposta com etapa NÃO-terminal (NEGOTIATION) sobre um deal que JÁ está WON.
    // dealService.update trataria isso como reabertura (status=OPEN, wonAt=null),
    // contornando o fluxo próprio. A guarda de etapa ATUAL deve recusar ANTES do update.
    prismaMock.user.findMany.mockResolvedValue([knownUser] as never);
    prismaMock.interaction.findFirst.mockResolvedValue({
        id: 'int-pending',
        metadata: {
          copilotPending: {
            kind: 'atualizar_deal',
            args: { dealId: 'deal-1', stage: 'NEGOTIATION' },
            summary: 'Vou atualizar...',
            connectionId: 'conn-1',
            resolved: false,
          },
        },
      } as never);
    // A revalidação de visibilidade carrega a etapa ATUAL: o deal está fechado (WON).
    (prismaMock.deal.findFirst as any).mockResolvedValueOnce({ id: 'deal-1', stage: 'WON' });

    const res = await copilotService.handleCopilotMessage(
      tenantId,
      connection,
      KNOWN_FROM,
      'sim'
    );

    // Recusa de reabertura — dealService.update NUNCA é chamado.
    expect(res.handled).toBe(true);
    expect(dealUpdateMock).not.toHaveBeenCalled();
    expect(res.reply).toMatch(/reabrir a negociação/i);
  });

  it('confirmar atualizar_deal com notas ANEXA (não sobrescreve) as notas atuais (#2)', async () => {
    prismaMock.user.findMany.mockResolvedValue([knownUser] as never);
    prismaMock.interaction.findFirst.mockResolvedValue({
        id: 'int-pending',
        metadata: {
          copilotPending: {
            kind: 'atualizar_deal',
            args: { dealId: 'deal-1', notes: 'Cliente pediu desconto' },
            summary: 'Vou atualizar...',
            connectionId: 'conn-1',
            resolved: false,
          },
        },
      } as never);
    // executePending faz DOIS findFirst no deal: [1] revalida visibilidade (select id),
    // [2] carrega as notas atuais p/ anexar (select notes).
    (prismaMock.deal.findFirst as any)
      .mockResolvedValueOnce({ id: 'deal-1' }) // visível no escopo do usuário
      .mockResolvedValueOnce({ notes: 'Nota antiga' }); // notas atuais do deal

    const res = await copilotService.handleCopilotMessage(
      tenantId,
      connection,
      KNOWN_FROM,
      'sim'
    );

    expect(res.handled).toBe(true);
    expect(dealUpdateMock).toHaveBeenCalledTimes(1);
    // As notas atuais foram PRESERVADAS e o novo texto ANEXADO (não sobrescrito).
    expect(dealUpdateMock.mock.calls[0][1]).toMatchObject({
      id: 'deal-1',
      notes: 'Nota antiga\n\nCliente pediu desconto',
    });
    expect(res.reply).toMatch(/atualizada/i);
  });

  it('confirmar atualizar_deal com notas quando o deal não tinha notas → usa só o novo texto (#2)', async () => {
    prismaMock.user.findMany.mockResolvedValue([knownUser] as never);
    prismaMock.interaction.findFirst.mockResolvedValue({
        id: 'int-pending',
        metadata: {
          copilotPending: {
            kind: 'atualizar_deal',
            args: { dealId: 'deal-1', notes: 'Primeira nota' },
            summary: 'Vou atualizar...',
            connectionId: 'conn-1',
            resolved: false,
          },
        },
      } as never);
    (prismaMock.deal.findFirst as any)
      .mockResolvedValueOnce({ id: 'deal-1' }) // visível
      .mockResolvedValueOnce({ notes: null }); // deal sem notas

    const res = await copilotService.handleCopilotMessage(
      tenantId,
      connection,
      KNOWN_FROM,
      'sim'
    );

    expect(res.handled).toBe(true);
    expect(dealUpdateMock.mock.calls[0][1]).toMatchObject({
      id: 'deal-1',
      notes: 'Primeira nota',
    });
  });
});

describe('nunca exclui', () => {
  it('as tools expostas não incluem nenhuma ação de exclusão', () => {
    const tools = copilotService.buildTools(
      tenantId,
      { userId: 'user-1', tenantId, role: 'USER' },
      { onRead: () => {}, onPropose: () => {} }
    );
    const names = Object.keys(tools);
    expect(names).toEqual(
      expect.arrayContaining([
        'minhas_tarefas_hoje',
        'status_do_deal',
        'buscar_contato',
        'criar_tarefa',
        'atualizar_deal',
      ])
    );
    // Nenhuma tool de exclusão.
    expect(names.some((n) => /excluir|deletar|delete|remover/i.test(n))).toBe(false);
  });
});
