import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

/**
 * INTEGRAÇÃO HTTP do POST /api/v1/leads — a cadeia inteira: rate limit → auth →
 * tenant → CSRF → permissão → limite de plano → schema Zod → serviço.
 *
 * Por que este arquivo existe: salvar lead quebrou QUATRO vezes seguidas em
 * produção, cada falha só aparecendo depois de corrigir a anterior —
 * 403 (plano ilimitado -1), 400 (tagIds como objeto), 429 (balde por IP) e
 * 400 (e-mail vazio). Nenhuma delas seria pega pelos testes que existiam:
 * `src/__tests__/leads.test.ts` chama o `leadService` DIRETO e pula justamente
 * as camadas onde os quatro bugs moravam.
 *
 * Cada caso abaixo trava uma dessas regressões pelo caminho real da requisição.
 *
 * Banco mockado de propósito (mesmo padrão de http/app.test.ts): o alvo aqui é
 * a cadeia de middlewares e a validação, não o SQL — e assim o teste roda sem
 * Postgres, local e no CI.
 */

vi.mock('bullmq', () => {
  class Fake {
    add = vi.fn();
    on = vi.fn();
    close = vi.fn();
  }
  return { Queue: Fake, Worker: Fake, QueueEvents: Fake };
});
vi.mock('ioredis', () => {
  class FakeRedis {
    on = vi.fn();
    quit = vi.fn();
    disconnect = vi.fn();
  }
  return { default: FakeRedis, Redis: FakeRedis };
});
vi.mock('../../jobs/taskNotificationChecker.js', () => ({
  initializeTaskNotificationChecker: vi.fn(),
  stopTaskNotificationChecker: vi.fn(),
}));
vi.mock('../../config/database.js', () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));
// Socket/notificações são efeitos colaterais do sucesso; não são o alvo.
vi.mock('../../services/socketService.js', () => ({
  getIO: () => null,
  emitToTenant: vi.fn(),
  emitToUser: vi.fn(),
  initSocketIO: vi.fn(),
}));

import prisma from '../../config/database.js';
import app from '../../index.js';
import { tenantFactory, userFactory, leadFactory } from '../factories/index.js';
import { generateAccessToken } from '../../utils/jwt.js';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const CSRF = 'token-csrf-de-teste';
const tenant = tenantFactory.build();
const user = userFactory.build({ tenantId: tenant.id, role: 'GESTOR', status: 'ACTIVE' });

// Vínculos obrigatórios da criação manual (specs/leads-oportunidade req. 1):
// empresa e contato válidos, mockados no beforeEach.
const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const CONTACT_ID = '22222222-2222-4222-8222-222222222222';

/** Payload mínimo válido da tela nova (empresa + contato sempre presentes). */
function comVinculos(body: Record<string, unknown> = {}) {
  return { companyId: COMPANY_ID, contactId: CONTACT_ID, ...body };
}

/** Requisição autenticada com CSRF, como o navegador faz. */
function postLead(body: Record<string, unknown>) {
  const token = generateAccessToken({
    userId: user.id,
    tenantId: tenant.id,
    email: user.email,
    role: user.role,
  });
  return request(app)
    .post('/api/v1/leads')
    .set('Cookie', [`accessToken=${token}`, `csrf-token=${CSRF}`])
    .set('x-csrf-token', CSRF)
    .send(body);
}

/** Plano ENTERPRISE real: limites gravados como -1 (= ilimitado). */
function planoIlimitado() {
  return {
    tenantId: tenant.id,
    status: 'ACTIVE',
    plan: {
      limits: {
        maxLeads: -1,
        maxUsers: -1,
        maxAutomations: -1,
        maxWhatsAppConnections: -1,
        maxEmailConfigs: -1,
        features: {},
      },
    },
  };
}

beforeEach(() => {
  mockReset(prismaMock);
  prismaMock.user.findUnique.mockResolvedValue(user);
  prismaMock.tenant.findUnique.mockResolvedValue(tenant);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prismaMock.subscription.findUnique.mockResolvedValue(planoIlimitado() as any);
  prismaMock.lead.count.mockResolvedValue(357);
  prismaMock.user.count.mockResolvedValue(5);
  prismaMock.automation.count.mockResolvedValue(0);
  prismaMock.whatsAppConnection.count.mockResolvedValue(0);
  prismaMock.emailConfig.count.mockResolvedValue(0);
  const leadCriado = leadFactory.build({ tenantId: tenant.id });
  prismaMock.lead.create.mockResolvedValue(leadCriado);
  // Empresa do vínculo obrigatório (assertOpportunityLinks)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prismaMock.company.findFirst.mockResolvedValue({ id: COMPANY_ID } as any);
  // `lead.findFirst` atende DOIS chamadores: a validação do CONTATO
  // (assertOpportunityLinks — where.id === CONTACT_ID) e o re-read do
  // `leadService.findById` — sem este último o serviço lança LEAD_NOT_FOUND e a
  // rota responde 404.
  prismaMock.lead.findFirst.mockImplementation(((args: { where?: { id?: string } }) => {
    if (args?.where?.id === CONTACT_ID) {
      return Promise.resolve({
        id: CONTACT_ID,
        isContact: true,
        companyId: COMPANY_ID,
      });
    }
    return Promise.resolve(leadCriado);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any);
  prismaMock.lead.findUnique.mockResolvedValue(leadCriado);
  prismaMock.leadTag.create.mockResolvedValue({} as never);
  prismaMock.interaction.create.mockResolvedValue({} as never);
  prismaMock.notification.create.mockResolvedValue({} as never);
});

describe('POST /api/v1/leads — o payload que a tela envia', () => {
  it('cria o lead com o payload REAL da tela (sem e-mail, sem tags)', async () => {
    // Exatamente o que useLeads.createLead monta quando o usuário preenche só
    // o nome e os vínculos obrigatórios — o caso que quebrou em produção.
    const res = await postLead(
      comVinculos({
        name: 'Lead pela tela',
        status: 'NOVO',
        source: 'OUTROS',
        estimatedValue: 150000,
        estimatedTimeline: '2º semestre de 2026',
        probabilityGoGet: 50,
        customFields: {},
        tagIds: [],
      })
    );

    expect(res.status).toBe(201);
    expect(prismaMock.lead.create).toHaveBeenCalled();
  });

  it('plano ilimitado (-1) NÃO bloqueia — regressão do 403', async () => {
    prismaMock.lead.count.mockResolvedValue(999999);
    const res = await postLead(comVinculos({ name: 'Com plano ilimitado' }));

    expect(res.status).toBe(201);
    expect(res.body.error).toBeUndefined();
  });

  it('limite FINITO estourado continua bloqueando com 403', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({
      ...planoIlimitado(),
      plan: { limits: { ...planoIlimitado().plan.limits, maxLeads: 10 } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    prismaMock.lead.count.mockResolvedValue(10);

    const res = await postLead(comVinculos({ name: 'Estourou o plano' }));
    expect(res.status).toBe(403);
  });

  it('e-mail VAZIO é aceito como não informado — regressão do 400', async () => {
    const res = await postLead(comVinculos({ name: 'Sem e-mail', email: '', phone: '' }));
    expect(res.status).toBe(201);
  });

  it('e-mail INVÁLIDO segue rejeitado com 400', async () => {
    const res = await postLead(comVinculos({ name: 'E-mail ruim', email: 'nao-e-email' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
  });

  it('tagIds como ARRAY DE STRINGS é aceito — o formato que o backend valida', async () => {
    const res = await postLead(
      comVinculos({
        name: 'Com tags',
        tagIds: ['33333333-3333-4333-8333-333333333333'],
      })
    );
    expect(res.status).toBe(201);
  });

  it('tagIds como objetos [{id}] é rejeitado — regressão que quebrou a tela', async () => {
    const res = await postLead(
      comVinculos({
        name: 'Tags no formato errado',
        tagIds: [{ id: '33333333-3333-4333-8333-333333333333' }],
      })
    );
    expect(res.status).toBe(400);
  });

  it('nome ausente continua sendo 400', async () => {
    const res = await postLead(comVinculos({ email: 'alguem@k2mais.com.br' }));
    expect(res.status).toBe(400);
  });

  // ── Vínculos obrigatórios (spec reqs. 1-2) ────────────────────────────────

  it('SEM companyId/contactId a criação manual devolve 400 (req. 1)', async () => {
    const res = await postLead({ name: 'Sem vínculos' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
  });

  it('contato de OUTRA empresa devolve 400 CONTACT_COMPANY_MISMATCH (req. 2)', async () => {
    prismaMock.lead.findFirst.mockImplementation(((args: { where?: { id?: string } }) => {
      if (args?.where?.id === CONTACT_ID) {
        return Promise.resolve({
          id: CONTACT_ID,
          isContact: true,
          companyId: '99999999-9999-4999-8999-999999999999', // outra empresa
        });
      }
      return Promise.resolve(leadFactory.build({ tenantId: tenant.id }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);

    const res = await postLead(comVinculos({ name: 'Contato de outra empresa' }));
    expect(res.status).toBe(400);
    // errorHandler expõe só a mensagem (code fica no objeto de erro interno)
    expect(res.body.error).toContain('não pertence à empresa');
  });

  it('contato que NÃO é contato (isContact=false) devolve 404 CONTACT_NOT_FOUND', async () => {
    prismaMock.lead.findFirst.mockImplementation(((args: { where?: { id?: string } }) => {
      if (args?.where?.id === CONTACT_ID) {
        return Promise.resolve({ id: CONTACT_ID, isContact: false, companyId: COMPANY_ID });
      }
      return Promise.resolve(leadFactory.build({ tenantId: tenant.id }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);

    const res = await postLead(comVinculos({ name: 'Contato inválido' }));
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Contato não encontrado');
  });

  it('requisição anônima é barrada (403 do CSRF, que roda antes do auth)', async () => {
    // O csrfProtection é montado no v1Router ANTES das rotas, e o `authenticate`
    // roda dentro do router de leads — então uma requisição sem nada morre no
    // CSRF, não no auth. Registrado para que a ordem não mude sem querer.
    const res = await request(app).post('/api/v1/leads').send({ name: 'Anônimo' });
    expect(res.status).toBe(403);
  });

  it('com CSRF mas sem sessão devolve 401', async () => {
    const res = await request(app)
      .post('/api/v1/leads')
      .set('Cookie', [`csrf-token=${CSRF}`])
      .set('x-csrf-token', CSRF)
      .send({ name: 'Sem sessão' });

    expect(res.status).toBe(401);
  });

  it('sem CSRF devolve 403 (escrita autenticada é protegida)', async () => {
    const token = generateAccessToken({
      userId: user.id,
      tenantId: tenant.id,
      email: user.email,
      role: user.role,
    });
    const res = await request(app)
      .post('/api/v1/leads')
      .set('Cookie', [`accessToken=${token}`])
      .send({ name: 'Sem CSRF' });

    expect(res.status).toBe(403);
  });
});
