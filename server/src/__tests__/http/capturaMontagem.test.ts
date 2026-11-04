import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

/**
 * Montagem das rotas da Captura no app real (spec captura-demandas, Restrições): as rotas de
 * máquina ficam fora do CSRF, as de tela ficam dentro, e tudo exige autenticação.
 */
vi.mock('bullmq', () => {
  class Falso {
    add = vi.fn();
    on = vi.fn();
    close = vi.fn();
  }
  return { Queue: Falso, Worker: Falso, QueueEvents: Falso };
});
vi.mock('ioredis', () => {
  class FalsoRedis {
    on = vi.fn();
    quit = vi.fn();
    disconnect = vi.fn();
  }
  return { default: FalsoRedis, Redis: FalsoRedis };
});
vi.mock('../../jobs/taskNotificationChecker.js', () => ({
  initializeTaskNotificationChecker: vi.fn(),
  stopTaskNotificationChecker: vi.fn(),
}));
vi.mock('../../config/database.js', () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));

import prisma from '../../config/database.js';
import app from '../../index.js';
import { logger } from '../../utils/logger.js';
import { assinarVyd } from '../../utils/vydHmac.js';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

beforeEach(() => {
  mockReset(prismaMock);
  process.env.CAPTURA_EVENTOS_HMAC = 'segredo';
  process.env.CAPTURA_TENANT_ID = 'tenant-1';
});

afterEach(() => {
  delete process.env.CAPTURA_EVENTOS_HMAC;
  delete process.env.CAPTURA_TENANT_ID;
});

describe('montagem das rotas da Captura', () => {
  it('eventos: fora do CSRF, e a assinatura é quem recusa', async () => {
    const res = await request(app).post('/api/v1/captura/eventos').send({ evento_id: 'x' });
    expect(res.status).toBe(401);
    expect(res.body.codigo).toBe('CABECALHO_AUSENTE');
  });

  describe('eventos com corpo malformado (contrato 06, §1)', () => {
    const LIXO = '{ texto do email do cliente';
    const postarLixo = (cabecalhos: Record<string, string> = {}, prefixo = '/api/v1') => {
      let req = request(app)
        .post(`${prefixo}/captura/eventos`)
        .set('Content-Type', 'application/json');
      for (const [nome, valor] of Object.entries(cabecalhos)) req = req.set(nome, valor);
      return req.send(LIXO);
    };
    const assinado = () => {
      const ts = String(Math.floor(Date.now() / 1000));
      return { 'X-VYD-Timestamp': ts, 'X-VYD-Assinatura': assinarVyd('segredo', ts, LIXO) };
    };

    it('sem assinatura dá 401, e não 400, nos dois prefixos', async () => {
      for (const prefixo of ['/api/v1', '/api']) {
        const res = await postarLixo({}, prefixo);
        expect(res.status).toBe(401);
        expect(res.body.codigo).toBe('CABECALHO_AUSENTE');
      }
    });

    it('assinatura errada dá 401, sem interpretar o corpo', async () => {
      const res = await postarLixo({ ...assinado(), 'X-VYD-Assinatura': 'a'.repeat(64) });
      expect(res.status).toBe(401);
    });

    it('com assinatura certa dá 400, e o texto não vai para o log', async () => {
      const espiaErro = vi.spyOn(logger, 'error');
      const res = await postarLixo(assinado());
      expect(res.status).toBe(400);
      expect(res.body.codigo).toBe('JSON_INVALIDO');
      expect(JSON.stringify(espiaErro.mock.calls)).not.toContain('texto do email');
      espiaErro.mockRestore();
    });

    it('JSON válido com assinatura certa e dados errados dá 422', async () => {
      const corpo = JSON.stringify({ evento_id: 'x' });
      const ts = String(Math.floor(Date.now() / 1000));
      const res = await request(app)
        .post('/api/v1/captura/eventos')
        .set('Content-Type', 'application/json')
        .set('X-VYD-Timestamp', ts)
        .set('X-VYD-Assinatura', assinarVyd('segredo', ts, corpo))
        .send(corpo);
      expect(res.status).toBe(422);
    });

    it('corpo malformado em outra rota: o texto também não vai para o log', async () => {
      const espiaErro = vi.spyOn(logger, 'error');
      const res = await request(app)
        .post('/api/v1/captura/demandas')
        .set('Content-Type', 'application/json')
        .send(LIXO);
      expect(res.status).toBe(400);
      expect(JSON.stringify(espiaErro.mock.calls)).not.toContain('texto do email');
      espiaErro.mockRestore();
    });
  });

  it('calendário de máquina exige chave', async () => {
    expect((await request(app).get('/api/v1/captura/calendario')).status).toBe(401);
    expect((await request(app).put('/api/v1/captura/calendario').send({})).status).toBe(401);
  });

  it('criar demanda: fora do CSRF, e a chave é quem recusa', async () => {
    const res = await request(app).post('/api/v1/captura/demandas').send({});
    expect(res.status).toBe(401);
    expect(res.body.codigo).toBe('API_KEY_REQUIRED');
  });

  it('contratos e clientes de máquina exigem chave', async () => {
    expect((await request(app).get('/api/v1/contratos')).status).toBe(401);
    expect((await request(app).get('/api/v1/captura/clientes?nome=x')).status).toBe(401);
  });

  it('tela de contratos: escrita passa pelo CSRF', async () => {
    const res = await request(app).post('/api/v1/gestao-contratos').send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('CSRF token missing');
  });

  it('tela de contratos e relatório: leitura exige sessão', async () => {
    expect((await request(app).get('/api/v1/gestao-contratos')).status).toBe(401);
    expect((await request(app).get('/api/v1/captura-relatorio/indicadores')).status).toBe(401);
  });

  it('o prefixo /api, alias do v1, também atende', async () => {
    expect((await request(app).get('/api/contratos')).status).toBe(401);
  });

  it('rota comercial com chave segue sem aceitar escrita', async () => {
    const res = await request(app)
      .post('/api/v1/deals')
      .set('X-API-Key', 'fcrm_qualquer')
      .send({ name: 'x', value: 1 });
    expect(res.status).toBe(403);
  });
});
