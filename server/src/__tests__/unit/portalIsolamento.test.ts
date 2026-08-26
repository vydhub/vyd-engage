// Testes de ISOLAMENTO do Portal do Parceiro (spec parceiros, req 2 + Restrições/DoD):
// o papel CONSULTOR não alcança endpoints internos nem dados de outro consultor.
// Unitário (sem DB): matriz allow/deny do gate + posse por consultorId + NDA gate.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

vi.mock('../../config/database.js', () => ({ __esModule: true, default: mockDeep<PrismaClient>() }));
vi.mock('../../utils/logger.js', () => ({
  __esModule: true,
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import prisma from '../../config/database.js';
import { isConsultorAllowed } from '../../middleware/auth.js';
import { registroService } from '../../services/parceiros/registroService.js';
import { consultorService } from '../../services/parceiros/consultorService.js';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
beforeEach(() => mockReset(prismaMock));

describe('gate do papel CONSULTOR (fail-closed, dois prefixos)', () => {
  it('NEGA todas as rotas internas do CRM', () => {
    for (const url of [
      '/api/v1/leads',
      '/api/leads',
      '/api/v1/deals',
      '/api/v1/companies',
      '/api/v1/users',
      '/api/v1/parceiros',
      '/api/v1/parceiros/consultores',
      '/api/parceiros/painel',
      '/api/v1/reports',
      '/api/v1/auth/tenant', // <- expõe/edita settings do tenant (lacuna corrigida)
      '/api/auth/tenant',
      '/api/v1/auth/tenant?x=1',
    ]) {
      expect(isConsultorAllowed(url), url).toBe(false);
    }
  });

  it('PERMITE apenas o Portal do Parceiro, notificações e sub-rotas de conta', () => {
    for (const url of [
      '/api/v1/portal-parceiro/registros',
      '/api/portal-parceiro/registros',
      '/api/v1/portal-parceiro/perfil?x=1',
      '/api/v1/notifications',
      '/api/notifications/123/read',
      '/api/v1/auth/me',
      '/api/auth/logout',
      '/api/v1/auth/2fa/setup',
      '/api/v1/auth/change-password',
    ]) {
      expect(isConsultorAllowed(url), url).toBe(true);
    }
  });
});

describe('posse por consultorId no Portal (req 4)', () => {
  it('getDoConsultor de registro de OUTRO consultor → REGISTRO_NOT_FOUND', async () => {
    // O where inclui consultorId do vínculo; registro de outro dono não é encontrado.
    prismaMock.registroOportunidade.findFirst.mockResolvedValue(null as never);
    await expect(
      registroService.getDoConsultor('t1', 'consultor-A', 'registro-de-consultor-B')
    ).rejects.toMatchObject({ code: 'REGISTRO_NOT_FOUND' });
    // Confirma que a query filtrou por tenantId + consultorId (não aceita id solto).
    const arg = (prismaMock.registroOportunidade.findFirst.mock.calls[0] as unknown as unknown[])[0] as {
      where: Record<string, unknown>;
    };
    expect(arg.where).toMatchObject({ id: 'registro-de-consultor-B', tenantId: 't1', consultorId: 'consultor-A' });
  });
});

describe('vínculo do consultor (req 2)', () => {
  it('getByUserId sem Consultor vinculado → CONSULTOR_NOT_LINKED', async () => {
    prismaMock.consultor.findFirst.mockResolvedValue(null as never);
    await expect(consultorService.getByUserId('t1', 'user-sem-vinculo')).rejects.toMatchObject({
      code: 'CONSULTOR_NOT_LINKED',
    });
  });
});
