// Testes dos GUARDS de estado/validação introduzidos pelas correções de review
// (marcarPerdido, addRecebimento/ORIGINADOR, reativar, ajustarProtecao, reunião
// REALIZADA sem presença). Unitário sem DB — cada guard lança ANTES de qualquer
// transação, então basta mockar a leitura inicial. Protege contra regressão.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

vi.mock('../../config/database.js', () => ({ __esModule: true, default: mockDeep<PrismaClient>() }));
vi.mock('../../utils/logger.js', () => ({
  __esModule: true,
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../services/parceiros/notifyParceiroService.js', () => ({
  __esModule: true,
  notifyParceiro: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../services/parceiros/configService.js', () => ({
  __esModule: true,
  parceiroConfigService: { get: vi.fn().mockResolvedValue({ splitOriginadorPadrao: 60 }) },
}));

import prisma from '../../config/database.js';
import { registroService } from '../../services/parceiros/registroService.js';
import { comissaoService } from '../../services/parceiros/comissaoService.js';
import { reuniaoService } from '../../services/parceiros/reuniaoService.js';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
beforeEach(() => mockReset(prismaMock));
const T = 't1';

describe('marcarPerdido — guards de estado/conflito (L5)', () => {
  it('registro já GANHO → INVALID_STATUS (não sobrescreve desfecho)', async () => {
    prismaMock.registroOportunidade.findFirst.mockResolvedValue({ id: 'r1', tenantId: T, status: 'GANHO' } as never);
    await expect(registroService.marcarPerdido(T, 'r1', 'u1')).rejects.toMatchObject({ code: 'INVALID_STATUS' });
  });
  it('de SUBMETIDO sem motivo → MOTIVO_REQUIRED', async () => {
    prismaMock.registroOportunidade.findFirst.mockResolvedValue({ id: 'r1', tenantId: T, status: 'SUBMETIDO' } as never);
    await expect(registroService.marcarPerdido(T, 'r1', 'u1')).rejects.toMatchObject({ code: 'MOTIVO_REQUIRED' });
  });
  it('com conflito ABERTO (como origem ou alvo) → CONFLITO_ABERTO', async () => {
    prismaMock.registroOportunidade.findFirst.mockResolvedValue({ id: 'r1', tenantId: T, status: 'APROVADO' } as never);
    prismaMock.conflitoCandidato.findFirst.mockResolvedValue({ id: 'k1' } as never);
    await expect(registroService.marcarPerdido(T, 'r1', 'u1', 'não avançou')).rejects.toMatchObject({ code: 'CONFLITO_ABERTO' });
  });
});

describe('reativar / ajustarProtecao — guards de status', () => {
  it('reativar de APROVADO → REGISTRO_NOT_EXPIRED', async () => {
    prismaMock.registroOportunidade.findFirst.mockResolvedValue({ id: 'r1', tenantId: T, status: 'APROVADO', consultor: {} } as never);
    await expect(registroService.reativar(T, 'r1', 'u1', {})).rejects.toMatchObject({ code: 'REGISTRO_NOT_EXPIRED' });
  });
  it('ajustarProtecao de SUBMETIDO → INVALID_STATUS', async () => {
    prismaMock.registroOportunidade.findFirst.mockResolvedValue({ id: 'r1', tenantId: T, status: 'SUBMETIDO' } as never);
    await expect(
      registroService.ajustarProtecao(T, 'r1', 'u1', { dias: 30, motivo: 'x' })
    ).rejects.toMatchObject({ code: 'INVALID_STATUS' });
  });
});

describe('addRecebimento — exige ORIGINADOR (L25)', () => {
  it('GANHO com só DESENVOLVEDOR → ORIGINADOR_REQUIRED (nunca paga 100% ao dev)', async () => {
    prismaMock.registroOportunidade.findFirst.mockResolvedValue({
      id: 'r1',
      tenantId: T,
      status: 'GANHO',
      atribuicoes: [{ consultorId: 'c2', papel: 'DESENVOLVEDOR', percentualOverride: 10, consultor: { userId: 'u2', comissaoBase: 3 } }],
    } as never);
    await expect(
      comissaoService.addRecebimento(T, 'r1', 'g1', { data: new Date(), valor: 1000 })
    ).rejects.toMatchObject({ code: 'ORIGINADOR_REQUIRED' });
  });
});

describe('reunião REALIZADA exige presença (L24)', () => {
  it('marcar REALIZADA sem presença registrada nem no payload → PRESENCA_REQUIRED', async () => {
    prismaMock.consultorReuniao.findFirst.mockResolvedValue({
      id: 'm1',
      tenantId: T,
      status: 'AGENDADA',
      presenca: null,
      consultor: { id: 'c1' },
    } as never);
    await expect(
      reuniaoService.update(T, 'm1', { status: 'REALIZADA' })
    ).rejects.toMatchObject({ code: 'PRESENCA_REQUIRED' });
  });
});
