import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

/**
 * Jobs de acompanhamento de lead (specs/leads-oportunidade reqs. 47-48 + casos
 * extremos 10-11), testados com JANELA REDUZIDA via env — exatamente o mecanismo
 * previsto na Definição de Concluído da spec.
 *
 * Banco mockado (padrão http/leadsCreate.test.ts): o alvo é a REGRA dos jobs
 * (elegibilidade, dedup, destinatários, campos da tarefa), não o SQL.
 */

vi.mock('../../config/database.js', () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));
vi.mock('../../services/emailService.js', () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: 'email-1' }),
}));
vi.mock('../../services/notificationService.js', () => ({
  notificationService: {
    create: vi.fn().mockResolvedValue({}),
    getTenantAdminIds: vi.fn().mockResolvedValue(['admin-1', 'admin-2']),
  },
}));

import prisma from '../../config/database.js';
import { sendEmail } from '../../services/emailService.js';
import { notificationService } from '../../services/notificationService.js';
import { checkLeadReminders } from '../../jobs/leadReminderChecker.js';
import { checkLeadPlanningTasks, PLANNING_TASK_TITLE } from '../../jobs/leadPlanningTaskChecker.js';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Primeiro argumento da primeira chamada de um mock (tipagem do DeepMockProxy
 * não expõe .mock.calls indexável — cast deliberado, só para asserções). */
function firstCallArg<T>(fn: unknown): T {
  return (fn as { mock: { calls: unknown[][] } }).mock.calls[0][0] as T;
}

const NOW = new Date('2026-08-17T12:00:00Z');

function leadEmAndamento(over: Record<string, unknown> = {}) {
  return {
    id: 'lead-1',
    name: 'Planta de beneficiamento',
    company: null,
    companyRef: { name: 'Mineradora XYZ' },
    createdAt: new Date(NOW.getTime() - 2 * DAY_MS), // 2 dias atrás
    assignedTo: 'user-1',
    assignedUser: { id: 'user-1', email: 'vendedor@k2mais.com.br', status: 'ACTIVE' },
    ...over,
  };
}

beforeEach(() => {
  mockReset(prismaMock);
  vi.clearAllMocks();
  prismaMock.tenant.findMany.mockResolvedValue([{ id: 'tenant-1' }] as never);
  prismaMock.notification.findMany.mockResolvedValue([]);
  prismaMock.interaction.findFirst.mockResolvedValue(null);
  prismaMock.task.findFirst.mockResolvedValue(null);
  prismaMock.task.create.mockResolvedValue({ id: 'task-1' } as never);
  // Janela reduzida: lembrete após 1 dia (em vez de 30)
  process.env.LEAD_REMINDER_DAYS = '1';
  process.env.LEAD_PLANNING_GRACE_HOURS = '1';
  process.env.LEAD_PLANNING_DUE_DAYS = '3';
});

afterEach(() => {
  delete process.env.LEAD_REMINDER_DAYS;
  delete process.env.LEAD_PLANNING_GRACE_HOURS;
  delete process.env.LEAD_PLANNING_DUE_DAYS;
});

describe('leadReminderChecker (req. 47)', () => {
  it('lead EM_ANDAMENTO com responsável ativo recebe e-mail + notificação in-app', async () => {
    prismaMock.lead.findMany.mockResolvedValue([leadEmAndamento()] as never);

    const reminded = await checkLeadReminders(NOW);

    expect(reminded).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const emailArgs = vi.mocked(sendEmail).mock.calls[0][0] as {
      to: string;
      subject: string;
      html: string;
    };
    expect(emailArgs.to).toBe('vendedor@k2mais.com.br');
    expect(emailArgs.subject).toContain('Planta de beneficiamento');
    expect(emailArgs.html).toContain('/app/leads/lead-1');
    expect(notificationService.create).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        userId: 'user-1',
        type: 'LEAD_REMINDER',
        metadata: { leadId: 'lead-1' },
      })
    );
  });

  it('dedup persistido: lead já lembrado na janela é pulado (caso extremo 10)', async () => {
    prismaMock.lead.findMany.mockResolvedValue([leadEmAndamento()] as never);
    prismaMock.notification.findMany.mockResolvedValue([
      { metadata: { leadId: 'lead-1' } },
    ] as never);

    const reminded = await checkLeadReminders(NOW);

    expect(reminded).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(notificationService.create).not.toHaveBeenCalled();
  });

  it('lead SEM responsável gera notificação in-app para os ADMINs (sem e-mail)', async () => {
    prismaMock.lead.findMany.mockResolvedValue([
      leadEmAndamento({ assignedTo: null, assignedUser: null }),
    ] as never);

    const reminded = await checkLeadReminders(NOW);

    expect(reminded).toBe(1);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(notificationService.getTenantAdminIds).toHaveBeenCalledWith('tenant-1');
    // um create por admin
    expect(notificationService.create).toHaveBeenCalledTimes(2);
    expect(notificationService.create).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ userId: 'admin-1', type: 'LEAD_REMINDER' })
    );
  });

  it('responsável DESATIVADO conta como sem responsável (caso extremo 10)', async () => {
    prismaMock.lead.findMany.mockResolvedValue([
      leadEmAndamento({
        assignedUser: { id: 'user-1', email: 'ex@k2mais.com.br', status: 'INACTIVE' },
      }),
    ] as never);

    await checkLeadReminders(NOW);

    expect(sendEmail).not.toHaveBeenCalled();
    expect(notificationService.getTenantAdminIds).toHaveBeenCalled();
  });

  it('falha no e-mail (RESEND ausente) não crasha e mantém a notificação in-app', async () => {
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error('RESEND_API_KEY not configured'));
    prismaMock.lead.findMany.mockResolvedValue([leadEmAndamento()] as never);

    const reminded = await checkLeadReminders(NOW);

    expect(reminded).toBe(1);
    expect(notificationService.create).toHaveBeenCalledTimes(1);
  });
});

describe('leadPlanningTaskChecker (req. 48)', () => {
  it('lead criado sem tarefa ganha "Planejamento de próximas ações" com prazo configurado', async () => {
    prismaMock.lead.findMany.mockResolvedValue([
      { id: 'lead-1', name: 'Sem tarefa', assignedTo: 'user-1' },
    ] as never);

    const created = await checkLeadPlanningTasks(NOW);

    expect(created).toBe(1);
    expect(prismaMock.task.create).toHaveBeenCalledTimes(1);
    const args = firstCallArg<{
      data: {
        title: string;
        type: string;
        priority: string;
        dueDate: Date;
        assignedTo: string | null;
        leadId: string;
      };
    }>(prismaMock.task.create);
    expect(args.data.title).toBe(PLANNING_TASK_TITLE);
    expect(args.data.type).toBe('FOLLOW_UP');
    expect(args.data.priority).toBe('MEDIUM');
    expect(args.data.leadId).toBe('lead-1');
    expect(args.data.assignedTo).toBe('user-1');
    // Janela reduzida: LEAD_PLANNING_DUE_DAYS=3 → vencimento em ~3 dias
    const expectedDue = NOW.getTime() + 3 * DAY_MS;
    expect(Math.abs(args.data.dueDate.getTime() - expectedDue)).toBeLessThan(1000);
  });

  it('dedup por título: tarefa de planejamento aberta impede duplicata', async () => {
    prismaMock.lead.findMany.mockResolvedValue([
      { id: 'lead-1', name: 'Já tem planejamento', assignedTo: null },
    ] as never);
    prismaMock.task.findFirst.mockResolvedValue({ id: 'task-existente' } as never);

    const created = await checkLeadPlanningTasks(NOW);

    expect(created).toBe(0);
    expect(prismaMock.task.create).not.toHaveBeenCalled();
  });

  it('lead sem responsável gera tarefa sem assignedTo (caso extremo 11)', async () => {
    prismaMock.lead.findMany.mockResolvedValue([
      { id: 'lead-2', name: 'Órfão', assignedTo: null },
    ] as never);

    await checkLeadPlanningTasks(NOW);

    const args = firstCallArg<{ data: { assignedTo: string | null } }>(prismaMock.task.create);
    expect(args.data.assignedTo).toBeNull();
  });

  it('a query de elegibilidade exclui leads que JÁ tiveram tarefa (tasks none, incl. deletadas)', async () => {
    prismaMock.lead.findMany.mockResolvedValue([] as never);

    const created = await checkLeadPlanningTasks(NOW);

    expect(created).toBe(0);
    const where = firstCallArg<{ where: Record<string, unknown> }>(prismaMock.lead.findMany).where;
    // Caso extremo 11: "nunca teve" = nenhuma linha de Task, sem filtro de
    // deletedAt/status — o none:{} garante que soft-deleted/concluídas contam.
    expect(where.tasks).toEqual({ none: {} });
    expect(where.isContact).toBe(false);
    expect(where.deletedAt).toBeNull();
  });
});
