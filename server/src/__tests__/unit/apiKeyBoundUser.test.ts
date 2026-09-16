import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express, { type Request, type Response, type NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

/**
 * API-2.2 — API Key como credencial de um usuario REAL (ApiKey.userId).
 *
 * Prova o middleware `authenticateOrApiKey`, que e a unica porta nova para as
 * rotas comerciais. Cada camada do fail-closed tem um teste:
 *  - sem header X-API-Key -> delega ao `authenticate` de sempre;
 *  - ENABLE_API_KEY_READ desligado -> 401;
 *  - metodo de escrita -> 403 (somente leitura por esta porta);
 *  - chave legada sem userId -> 403 (nenhuma identidade fabricada);
 *  - escopo insuficiente -> 403;
 *  - usuario inativo -> 403; usuario de outro tenant -> 403;
 *  - caminho feliz -> 200 com req.user do usuario vinculado.
 */
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../config/database.js', () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));

import prisma from '../../config/database.js';
import { authenticateOrApiKey } from '../../middleware/apiKeyAuth.js';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const PLAIN = 'fcrm_chave_de_teste_0001';
let hash = '';

const SERVICE_USER = {
  id: 'user-1',
  email: 'agente@k2mais.com.br',
  status: 'ACTIVE',
  tenantId: 'tenant-1',
  role: 'USER',
  isPlatformAdmin: false,
};

function keyRows(over: Record<string, unknown> = {}) {
  return [
    {
      id: 'key-1',
      tenantId: 'tenant-1',
      keyHash: hash,
      scopes: ['deals:read'],
      expiresAt: null,
      userId: 'user-1',
      ...over,
    },
  ];
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.get('/deals', authenticateOrApiKey('deals:read'), (req: Request, res: Response) => {
    res.json({ user: req.user });
  });
  app.post('/deals', authenticateOrApiKey('deals:read'), (_req: Request, res: Response) => {
    res.json({ ok: true });
  });
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.statusCode || 500).json({ error: err.message, code: err.code });
  });
  return app;
}

beforeEach(async () => {
  mockReset(prismaMock);
  if (!hash) hash = await bcrypt.hash(PLAIN, 4);
  process.env.ENABLE_API_KEY_READ = 'true';
  // lastUsedAt e best-effort (.catch) — precisa ser uma Promise.
  prismaMock.apiKey.update.mockResolvedValue({} as never);
});

afterEach(() => {
  delete process.env.ENABLE_API_KEY_READ;
});

describe('authenticateOrApiKey — API-2.2', () => {
  it('sem X-API-Key delega ao authenticate (401 NO_TOKEN)', async () => {
    const res = await request(makeApp()).get('/deals');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('NO_TOKEN');
    expect(prismaMock.apiKey.findMany).not.toHaveBeenCalled();
  });

  it('ENABLE_API_KEY_READ desligado -> 401 API_KEY_DISABLED', async () => {
    delete process.env.ENABLE_API_KEY_READ;
    const res = await request(makeApp()).get('/deals').set('x-api-key', PLAIN);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('API_KEY_DISABLED');
    expect(prismaMock.apiKey.findMany).not.toHaveBeenCalled();
  });

  it('POST com chave -> 403 API_KEY_READ_ONLY (nao chega no handler)', async () => {
    const res = await request(makeApp()).post('/deals').set('x-api-key', PLAIN).send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('API_KEY_READ_ONLY');
  });

  it('chave legada (userId nulo) -> 403 API_KEY_NOT_BOUND', async () => {
    prismaMock.apiKey.findMany.mockResolvedValue(keyRows({ userId: null }) as never);
    const res = await request(makeApp()).get('/deals').set('x-api-key', PLAIN);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('API_KEY_NOT_BOUND');
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('escopo insuficiente -> 403 (nao carrega usuario)', async () => {
    prismaMock.apiKey.findMany.mockResolvedValue(keyRows({ scopes: ['leads:read'] }) as never);
    const res = await request(makeApp()).get('/deals').set('x-api-key', PLAIN);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('API_KEY_INSUFFICIENT_SCOPE');
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('usuario vinculado inativo -> 403 USER_INACTIVE', async () => {
    prismaMock.apiKey.findMany.mockResolvedValue(keyRows() as never);
    prismaMock.user.findUnique.mockResolvedValue({
      ...SERVICE_USER,
      status: 'SUSPENDED',
    } as never);
    const res = await request(makeApp()).get('/deals').set('x-api-key', PLAIN);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('USER_INACTIVE');
  });

  it('usuario de outro tenant -> 403 API_KEY_TENANT_MISMATCH', async () => {
    prismaMock.apiKey.findMany.mockResolvedValue(keyRows() as never);
    prismaMock.user.findUnique.mockResolvedValue({
      ...SERVICE_USER,
      tenantId: 'outro-tenant',
    } as never);
    const res = await request(makeApp()).get('/deals').set('x-api-key', PLAIN);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('API_KEY_TENANT_MISMATCH');
  });

  it('caminho feliz -> 200 com req.user do usuario vinculado', async () => {
    prismaMock.apiKey.findMany.mockResolvedValue(keyRows() as never);
    prismaMock.user.findUnique.mockResolvedValue(SERVICE_USER as never);
    const res = await request(makeApp()).get('/deals').set('x-api-key', PLAIN);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      userId: 'user-1',
      tenantId: 'tenant-1',
      role: 'USER',
    });
  });

  it('chave invalida -> 401 API_KEY_INVALID', async () => {
    prismaMock.apiKey.findMany.mockResolvedValue(keyRows() as never);
    const res = await request(makeApp()).get('/deals').set('x-api-key', 'fcrm_chave_errada');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('API_KEY_INVALID');
  });
});
