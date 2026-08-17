import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

/**
 * Motivo obrigatório nas transições terminais + conversão em oportunidade
 * (specs/leads-oportunidade reqs. 13-18 + caso extremo 13), no nível do
 * serviço — o caminho compartilhado por PUT, bulk e Kanban.
 */

vi.mock('../../config/database.js', () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));
// Efeitos colaterais fora do alvo (scoring/automations/webhooks/socket)
vi.mock('../../services/scoringService.js', () => ({
  scoringService: { processEvent: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../jobs/automationEngine.js', () => ({
  dispatchTrigger: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../services/planLimitsService.js', () => ({
  planLimitsService: { invalidateUsage: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../services/webhookDispatcher.js', () => ({
  webhookDispatcher: { emitLeadEvent: vi.fn() },
}));
vi.mock('../../services/socketService.js', () => ({
  emitToTenant: vi.fn(),
  getIO: () => null,
}));
vi.mock('../../services/dealService.js', () => ({
  dealService: {
    create: vi.fn().mockResolvedValue({ id: 'deal-1', name: 'Planta XPTO' }),
  },
}));

import prisma from '../../config/database.js';
import { dealService } from '../../services/dealService.js';
import { leadService, assertStatusReason } from '../../services/leadService.js';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const TENANT = 'tenant-1';

function leadBase(over: Record<string, unknown> = {}) {
  return {
    id: 'lead-1',
    tenantId: TENANT,
    name: 'Planta XPTO',
    status: 'EM_ANDAMENTO',
    statusReason: null,
    statusReasonNote: null,
    companyId: 'company-1',
    contactId: 'contact-1',
    estimatedValue: 250000,
    estimatedTimeline: '1º semestre de 2027',
    probabilityGoGet: 75,
    assignedTo: 'user-1',
    notes: 'EPCM de beneficiamento',
    isContact: false,
    deletedAt: null,
    tags: [],
    ...over,
  };
}

beforeEach(() => {
  mockReset(prismaMock);
  vi.clearAllMocks();
  prismaMock.interaction.create.mockResolvedValue({} as never);
  prismaMock.dealContact.create.mockResolvedValue({} as never);
});

describe('assertStatusReason (req. 13)', () => {
  it('transição terminal sem motivo lança 400 STATUS_REASON_REQUIRED', () => {
    expect(() => assertStatusReason('PAUSADO' as never)).toThrowError(
      expect.objectContaining({ code: 'STATUS_REASON_REQUIRED', statusCode: 400 })
    );
  });

  it('motivo OUTRO sem nota lança 400 STATUS_REASON_NOTE_REQUIRED', () => {
    expect(() => assertStatusReason('CANCELADO' as never, 'OUTRO' as never)).toThrowError(
      expect.objectContaining({ code: 'STATUS_REASON_NOTE_REQUIRED', statusCode: 400 })
    );
  });

  it('motivo da lista com status terminal passa; status não-terminal nunca exige', () => {
    expect(() =>
      assertStatusReason('ENCERRADO' as never, 'SEM_RETORNO' as never)
    ).not.toThrow();
    expect(() => assertStatusReason('EM_ANDAMENTO' as never)).not.toThrow();
  });
});

describe('leadService.update — transições de status (reqs. 13-16)', () => {
  it('PAUSADO sem motivo → 400 e nada é gravado', async () => {
    prismaMock.lead.findFirst.mockResolvedValue(leadBase() as never);

    await expect(
      leadService.update(TENANT, { id: 'lead-1', status: 'PAUSADO' as never })
    ).rejects.toMatchObject({ code: 'STATUS_REASON_REQUIRED', statusCode: 400 });
    expect(prismaMock.lead.update).not.toHaveBeenCalled();
  });

  it('PAUSADO com motivo grava motivo + Interaction STATUS_CHANGE com anterior/novo', async () => {
    prismaMock.lead.findFirst.mockResolvedValue(leadBase() as never);
    prismaMock.lead.update.mockResolvedValue(
      leadBase({ status: 'PAUSADO', statusReason: 'PAUSADO_PELO_CLIENTE' }) as never
    );

    await leadService.update(
      TENANT,
      { id: 'lead-1', status: 'PAUSADO' as never, statusReason: 'PAUSADO_PELO_CLIENTE' as never },
      'user-1'
    );

    const updateArgs = (prismaMock.lead.update as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateArgs.data.status).toBe('PAUSADO');
    expect(updateArgs.data.statusReason).toBe('PAUSADO_PELO_CLIENTE');

    const interactionArgs = (
      prismaMock.interaction.create as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls[0][0] as { data: { content: string; metadata: Record<string, unknown> } };
    expect(interactionArgs.data.content).toContain('Em Andamento');
    expect(interactionArgs.data.content).toContain('Pausado');
    expect(interactionArgs.data.content).toContain('Pausado pelo cliente');
    expect(interactionArgs.data.metadata.previousStatus).toBe('EM_ANDAMENTO');
    expect(interactionArgs.data.metadata.newStatus).toBe('PAUSADO');
  });

  it('voltar para EM_ANDAMENTO limpa motivo e nota (req. 16)', async () => {
    prismaMock.lead.findFirst.mockResolvedValue(
      leadBase({ status: 'PAUSADO', statusReason: 'PAUSADO_PELO_CLIENTE' }) as never
    );
    prismaMock.lead.update.mockResolvedValue(leadBase() as never);

    await leadService.update(TENANT, { id: 'lead-1', status: 'EM_ANDAMENTO' as never });

    const updateArgs = (prismaMock.lead.update as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateArgs.data.statusReason).toBeNull();
    expect(updateArgs.data.statusReasonNote).toBeNull();
  });

  it('limpeza explícita (req. 9): null zera valor/prazo/probabilidade/notas', async () => {
    prismaMock.lead.findFirst.mockResolvedValue(leadBase() as never);
    prismaMock.lead.update.mockResolvedValue(leadBase() as never);

    await leadService.update(TENANT, {
      id: 'lead-1',
      estimatedValue: null,
      estimatedTimeline: null,
      probabilityGoGet: null,
      notes: null,
    });

    const updateArgs = (prismaMock.lead.update as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateArgs.data.estimatedValue).toBeNull();
    expect(updateArgs.data.estimatedTimeline).toBeNull();
    expect(updateArgs.data.probabilityGoGet).toBeNull();
    expect(updateArgs.data.notes).toBeNull();
  });
});

describe('leadService.convertToOpportunity (reqs. 17-18 + caso 13)', () => {
  it('cria o Deal com os dados copiados, vincula o contato e encerra o lead', async () => {
    prismaMock.lead.findFirst.mockResolvedValue(leadBase() as never);
    prismaMock.lead.update.mockResolvedValue(
      leadBase({ status: 'ENCERRADO', statusReason: 'CONVERTIDO_EM_OPORTUNIDADE' }) as never
    );

    const result = await leadService.convertToOpportunity(TENANT, 'lead-1', 'user-1');

    expect(result.alreadyConverted).toBe(false);
    expect(result.deal.id).toBe('deal-1');
    // Deal copiado do lead (req. 17a)
    expect(dealService.create).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({
        name: 'Planta XPTO',
        value: 250000,
        probability: 75,
        leadId: 'lead-1',
        companyId: 'company-1',
        assignedTo: 'user-1',
        notes: expect.stringContaining('1º semestre de 2027'),
      })
    );
    // Contato vira DealContact (req. 17a)
    expect(prismaMock.dealContact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ dealId: 'deal-1', leadId: 'contact-1' }),
      })
    );
    // Lead encerrado como convertido (req. 17b)
    const updateArgs = (prismaMock.lead.update as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateArgs.data.status).toBe('ENCERRADO');
    expect(updateArgs.data.statusReason).toBe('CONVERTIDO_EM_OPORTUNIDADE');
  });

  it('segundo clique NÃO cria segundo deal (caso 13): devolve o existente', async () => {
    prismaMock.lead.findFirst.mockResolvedValue(
      leadBase({ status: 'ENCERRADO', statusReason: 'CONVERTIDO_EM_OPORTUNIDADE' }) as never
    );
    prismaMock.deal.findFirst.mockResolvedValue({ id: 'deal-1', name: 'Planta XPTO' } as never);

    const result = await leadService.convertToOpportunity(TENANT, 'lead-1', 'user-1');

    expect(result.alreadyConverted).toBe(true);
    expect(result.deal.id).toBe('deal-1');
    expect(dealService.create).not.toHaveBeenCalled();
    expect(prismaMock.lead.update).not.toHaveBeenCalled();
  });
});
