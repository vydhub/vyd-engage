import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prismaMock } from '../helpers/prismaMock.js';

/**
 * "Dias na etapa" da nota de IA. Em Negócio da Captura, `DealStageHistory.stage` guarda o estado
 * M-04, e não o `DealStage`: filtrar pela etapa nunca casaria, e a conta cairia em `updatedAt`.
 */
const gerar = vi.fn();
vi.mock('ai', () => ({ generateObject: (...args: unknown[]) => gerar(...args) }));
vi.mock('../../services/aiProvider.js', () => ({
  isAIEnabled: () => true,
  getActiveModel: () => 'modelo',
  resolveProviderConfig: () => ({ provider: 'teste' }),
  aiUnavailableError: () => new Error('IA indisponível'),
  logAiUsage: vi.fn(),
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { dealScoringService } from '../../services/dealScoringService.js';

describe('dias na etapa da nota de IA', () => {
  beforeEach(() => {
    gerar.mockReset();
    gerar.mockResolvedValue({ object: { score: 50, factors: [] }, usage: {} });
    prismaMock.deal.findFirst.mockResolvedValue({
      name: 'Demanda',
      value: 10,
      stage: 'PROPOSAL',
      probability: 50,
      assignedTo: null,
      updatedAt: new Date(),
    } as never);
    prismaMock.interaction.count.mockResolvedValue(0 as never);
    prismaMock.interaction.findFirst.mockResolvedValue(null as never);
    prismaMock.dealStageHistory.findFirst.mockResolvedValue({
      enteredAt: new Date(Date.now() - 10 * 86_400_000),
    } as never);
  });

  it('lê a entrada aberta do histórico, sem filtrar pela etapa', async () => {
    await dealScoringService.computeAndStore('t1', 'd1');

    expect(prismaMock.dealStageHistory.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { dealId: 'd1', exitedAt: null } })
    );
    expect(gerar.mock.calls[0][0].prompt).toContain('Tempo no estágio atual: 10 dia(s)');
  });
});
