import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express, { type Request, type Response, type NextFunction } from 'express';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

/**
 * Upgrade RD parity — P3 (req 24): ações rápidas da extensão Chrome no grupo
 * `/contacts` (apiKeyAuth + escopo próprio + CSRF-exempt). Prova:
 *  - POST /contacts/leads exige escopo `leads:write` (403 sem ele) → 201 com escopo.
 *  - POST /contacts/tasks exige `tasks:write`; leadId cross-tenant → 404.
 *  - POST /contacts/notes cria Interaction NOTE (escopo leads:write).
 *  - GET /contacts/resolve resolve por telefone, tenant-scoped pelo apiKey.
 *
 * apiKeyAuth é mockado p/ injetar req.apiKey; requireScope é o real (valida escopos).
 * Header de teste: "x-api-key: <tenant>|<scope,scope>" ('|' separa tenant dos escopos,
 * pois os escopos contêm ':' — ex.: leads:write).
 */
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../config/database.js', () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));

// apiKeyAuth injeta req.apiKey a partir do header X-API-Key (formato "tenant:scope,scope").
// requireScope permanece REAL — a validação de escopo é o que estamos provando.
vi.mock('../../middleware/apiKeyAuth.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    apiKeyAuth: (req: Request, _res: Response, next: NextFunction) => {
      const raw = (req.headers['x-api-key'] as string | undefined) || '';
      const [tenantId, scopeCsv] = raw.split('|');
      (req as unknown as { apiKey: unknown }).apiKey = {
        id: 'key-1',
        tenantId: tenantId || 't1',
        scopes: scopeCsv ? scopeCsv.split(',').filter(Boolean) : [],
      };
      next();
    },
    apiKeyRateLimiter: (_r: Request, _s: Response, next: NextFunction) => next(),
  };
});

const { createLeadMock, createTaskMock, createInteractionMock, enforceLimitMock } = vi.hoisted(
  () => ({
    createLeadMock: vi.fn(),
    createTaskMock: vi.fn(),
    createInteractionMock: vi.fn(),
    enforceLimitMock: vi.fn(),
  })
);
vi.mock('../../services/leadService.js', () => ({ leadService: { create: createLeadMock } }));
vi.mock('../../services/taskService.js', () => ({ taskService: { create: createTaskMock } }));
vi.mock('../../services/interactionService.js', () => ({
  interactionService: { create: createInteractionMock },
}));
// planLimitsService é importado dinamicamente em POST /contacts/leads (enforceLimit).
vi.mock('../../services/planLimitsService.js', () => ({
  planLimitsService: { enforceLimit: enforceLimitMock },
}));

import prisma from '../../config/database.js';
import contactsRouter from '../../routes/contacts.js';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/contacts', contactsRouter);
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.statusCode || 500).json({ error: err.message, code: err.code });
  });
  return app;
}

beforeEach(() => {
  mockReset(prismaMock);
  createLeadMock.mockReset();
  createTaskMock.mockReset();
  createInteractionMock.mockReset();
  enforceLimitMock.mockReset();
  // Por padrão, a cota do plano permite criar (não rejeita).
  enforceLimitMock.mockResolvedValue(undefined);
});

describe('POST /contacts/leads — req 24', () => {
  it('sem escopo leads:write → 403', async () => {
    const res = await request(makeApp())
      .post('/contacts/leads')
      .set('x-api-key', 't1|contacts:read') // escopo insuficiente
      .send({ name: 'Fulano', phone: '11999990000' });
    expect(res.status).toBe(403);
    expect(createLeadMock).not.toHaveBeenCalled();
  });

  it('com leads:write → 201 e origem OUTROS, tenant do apiKey', async () => {
    createLeadMock.mockResolvedValue({ id: 'lead-1', name: 'Fulano' });
    const res = await request(makeApp())
      .post('/contacts/leads')
      .set('x-api-key', 'tenant-x|leads:write')
      .send({ name: 'Fulano', phone: '11999990000' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ id: 'lead-1' });
    const [tenantArg, data] = createLeadMock.mock.calls[0];
    expect(tenantArg).toBe('tenant-x');
    expect(data.source).toBe('OUTROS');
    expect(data.name).toBe('Fulano');
  });

  it('sem nome → 400 VALIDATION_ERROR', async () => {
    const res = await request(makeApp())
      .post('/contacts/leads')
      .set('x-api-key', 't1|leads:write')
      .send({ phone: '11999990000' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(createLeadMock).not.toHaveBeenCalled();
  });

  it('acima da cota do plano → 403 PLAN_LIMIT_REACHED (não cria lead)', async () => {
    // enforceLimit rejeita quando a cota do plano foi atingida (mesmo padrão de
    // POST /leads JWT). A criação pela extensão NÃO pode furar o limite.
    const err = Object.assign(new Error('Plan limit reached for leads. Current: 100, Limit: 100'), {
      statusCode: 403,
      code: 'PLAN_LIMIT_REACHED',
    });
    enforceLimitMock.mockRejectedValue(err);
    const res = await request(makeApp())
      .post('/contacts/leads')
      .set('x-api-key', 'tenant-cap|leads:write')
      .send({ name: 'Fulano', phone: '11999990000' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PLAN_LIMIT_REACHED');
    // enforceLimit foi imposto com o tenant do apiKey e o recurso 'leads'.
    expect(enforceLimitMock).toHaveBeenCalledWith('tenant-cap', 'leads');
    // Lead NÃO foi criado (limite barrou antes do leadService.create).
    expect(createLeadMock).not.toHaveBeenCalled();
  });
});

describe('POST /contacts/tasks — req 24', () => {
  it('leadId de outro tenant → 404 (não vaza cross-tenant)', async () => {
    prismaMock.lead.findFirst.mockResolvedValue(null as never);
    const res = await request(makeApp())
      .post('/contacts/tasks')
      .set('x-api-key', 't1|tasks:write')
      .send({ title: 'Ligar', leadId: 'lead-de-outro-tenant' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('LEAD_NOT_FOUND');
    expect(createTaskMock).not.toHaveBeenCalled();
  });

  it('com tasks:write e sem leadId → 201', async () => {
    createTaskMock.mockResolvedValue({ id: 'task-1', title: 'Ligar' });
    const res = await request(makeApp())
      .post('/contacts/tasks')
      .set('x-api-key', 't1|tasks:write')
      .send({ title: 'Ligar' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ id: 'task-1' });
    expect(createTaskMock).toHaveBeenCalledOnce();
  });

  it('companyId sem leadId → 201 e tarefa vinculada à empresa', async () => {
    // Contato resolvido só por empresa (sem lead): a tarefa deve ficar vinculada
    // à empresa (companyId), não órfã.
    prismaMock.company.findFirst.mockResolvedValue({ id: 'company-1' } as never);
    createTaskMock.mockResolvedValue({ id: 'task-c1', title: 'Ligar' });
    const res = await request(makeApp())
      .post('/contacts/tasks')
      .set('x-api-key', 'tenant-q|tasks:write')
      .send({ title: 'Ligar', companyId: 'company-1' });
    expect(res.status).toBe(201);
    // Empresa validada cross-tenant (findFirst com o tenant do apiKey).
    const companyWhere = (prismaMock.company.findFirst.mock.calls[0] as unknown as unknown[])[0] as {
      where: { id: string; tenantId: string };
    };
    expect(companyWhere.where.id).toBe('company-1');
    expect(companyWhere.where.tenantId).toBe('tenant-q');
    // taskService.create recebeu companyId e sem leadId, com o tenant do apiKey.
    const [tenantArg, data] = createTaskMock.mock.calls[0];
    expect(tenantArg).toBe('tenant-q');
    expect(data.companyId).toBe('company-1');
    expect(data.leadId).toBeUndefined();
    // Não deve ter consultado lead (não veio leadId).
    expect(prismaMock.lead.findFirst).not.toHaveBeenCalled();
  });

  it('companyId de outro tenant → 404 COMPANY_NOT_FOUND (não vaza cross-tenant)', async () => {
    prismaMock.company.findFirst.mockResolvedValue(null as never);
    const res = await request(makeApp())
      .post('/contacts/tasks')
      .set('x-api-key', 't1|tasks:write')
      .send({ title: 'Ligar', companyId: 'company-de-outro-tenant' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('COMPANY_NOT_FOUND');
    expect(createTaskMock).not.toHaveBeenCalled();
  });
});

describe('POST /contacts/notes — req 24', () => {
  it('com leads:write → 201 e Interaction NOTE OUTBOUND', async () => {
    prismaMock.lead.findFirst.mockResolvedValue({ id: 'lead-1' } as never);
    createInteractionMock.mockResolvedValue({ id: 'int-1' });
    const res = await request(makeApp())
      .post('/contacts/notes')
      .set('x-api-key', 't1|leads:write')
      .send({ content: 'Falei com o cliente.', leadId: 'lead-1' });
    expect(res.status).toBe(201);
    const [, data] = createInteractionMock.mock.calls[0];
    expect(data.type).toBe('NOTE');
    expect(data.direction).toBe('OUTBOUND');
    expect(data.content).toBe('Falei com o cliente.');
  });

  it('companyId sem leadId → 201 e Interaction vinculada à empresa', async () => {
    // Contato resolvido só por empresa (sem lead): a nota deve ficar vinculada
    // à empresa (companyId), não órfã.
    prismaMock.company.findFirst.mockResolvedValue({ id: 'company-1' } as never);
    createInteractionMock.mockResolvedValue({ id: 'int-2' });
    const res = await request(makeApp())
      .post('/contacts/notes')
      .set('x-api-key', 'tenant-q|leads:write')
      .send({ content: 'Contato pela empresa.', companyId: 'company-1' });
    expect(res.status).toBe(201);
    // Empresa validada cross-tenant (findFirst com o tenant do apiKey).
    const companyWhere = (prismaMock.company.findFirst.mock.calls[0] as unknown as unknown[])[0] as {
      where: { id: string; tenantId: string };
    };
    expect(companyWhere.where.id).toBe('company-1');
    expect(companyWhere.where.tenantId).toBe('tenant-q');
    // Interaction criada com companyId e sem leadId.
    const [tenantArg, data] = createInteractionMock.mock.calls[0];
    expect(tenantArg).toBe('tenant-q');
    expect(data.companyId).toBe('company-1');
    expect(data.leadId).toBeUndefined();
    expect(data.type).toBe('NOTE');
    // Não deve ter consultado lead (não veio leadId).
    expect(prismaMock.lead.findFirst).not.toHaveBeenCalled();
  });

  it('companyId de outro tenant → 404 COMPANY_NOT_FOUND (não vaza cross-tenant)', async () => {
    prismaMock.company.findFirst.mockResolvedValue(null as never);
    const res = await request(makeApp())
      .post('/contacts/notes')
      .set('x-api-key', 't1|leads:write')
      .send({ content: 'Nota', companyId: 'company-de-outro-tenant' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('COMPANY_NOT_FOUND');
    expect(createInteractionMock).not.toHaveBeenCalled();
  });

  it('sem leadId e sem companyId → 400 VALIDATION_ERROR', async () => {
    const res = await request(makeApp())
      .post('/contacts/notes')
      .set('x-api-key', 't1|leads:write')
      .send({ content: 'Nota sem alvo.' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(createInteractionMock).not.toHaveBeenCalled();
  });
});

describe('GET /contacts/resolve — req 24', () => {
  it('resolve por telefone, tenant-scoped pelo apiKey', async () => {
    // $queryRaw traz o candidato por sufixo (id + phone); o match por dígitos
    // COMPLETOS (phonesMatch) confirma e findFirst rehidrata.
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'lead-1', phone: '11999990000' }] as never);
    prismaMock.lead.findFirst.mockResolvedValue({
      id: 'lead-1',
      name: 'Fulano',
      email: null,
      phone: '11999990000',
      company: null,
      companyId: null,
    } as never);
    prismaMock.deal.findMany.mockResolvedValue([] as never);
    prismaMock.interaction.findMany.mockResolvedValue([] as never);
    const res = await request(makeApp())
      .get('/contacts/resolve?phone=11999990000')
      .set('x-api-key', 'tenant-y|contacts:read');
    expect(res.status).toBe(200);
    expect(res.body.data.lead).toMatchObject({ id: 'lead-1' });
    // O findFirst do lead foi chamado com o tenant do apiKey.
    const call = (prismaMock.lead.findFirst.mock.calls[0] as unknown as unknown[])[0] as {
      where: { tenantId: string };
    };
    expect(call.where.tenantId).toBe('tenant-y');
  });

  it('telefone gravado COM máscara resolve o lead (match por dígitos no banco)', async () => {
    // O consumidor consulta pelos dígitos ("11999990000"); o cadastro está com
    // máscara ("(11) 99999-0000"). O sufixo casa no $queryRaw e o phonesMatch por
    // dígitos completos confirma (máscara normalizada); a prova é que $queryRaw
    // dirige a resolução.
    prismaMock.$queryRaw.mockResolvedValue([
      { id: 'lead-mask', phone: '(11) 99999-0000' },
    ] as never);
    prismaMock.lead.findFirst.mockResolvedValue({
      id: 'lead-mask',
      name: 'Mascarado',
      email: null,
      phone: '(11) 99999-0000',
      company: null,
      companyId: null,
    } as never);
    prismaMock.deal.findMany.mockResolvedValue([] as never);
    prismaMock.interaction.findMany.mockResolvedValue([] as never);
    const res = await request(makeApp())
      .get('/contacts/resolve?phone=11999990000')
      .set('x-api-key', 'tenant-m|contacts:read');
    expect(res.status).toBe(200);
    expect(res.body.data.lead).toMatchObject({ id: 'lead-mask', phone: '(11) 99999-0000' });
    // A resolução do lead passou pelo $queryRaw (não pelo `contains` cru).
    expect(prismaMock.$queryRaw).toHaveBeenCalled();
    // findFirst rehidratou pelo id retornado, com o tenant do apiKey.
    const call = (prismaMock.lead.findFirst.mock.calls[0] as unknown as unknown[])[0] as {
      where: { id: string; tenantId: string };
    };
    expect(call.where.id).toBe('lead-mask');
    expect(call.where.tenantId).toBe('tenant-m');
  });

  it('lead SEM companyId → empresa NÃO resolvida por telefone (lead-first estrito)', async () => {
    // Há lead, mas sem companyId. Ainda que uma empresa case pelo sufixo de
    // telefone, o comportamento lead-first estrito NÃO deve resolver essa empresa
    // "órfã" — nenhuma consulta de company.findFirst deve ocorrer.
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'lead-3', phone: '11955554444' }] as never);
    prismaMock.lead.findFirst.mockResolvedValue({
      id: 'lead-3',
      name: 'Beltrano',
      email: null,
      phone: '11955554444',
      company: null,
      companyId: null,
    } as never);
    prismaMock.deal.findMany.mockResolvedValue([] as never);
    prismaMock.interaction.findMany.mockResolvedValue([] as never);

    const res = await request(makeApp())
      .get('/contacts/resolve?phone=11955554444')
      .set('x-api-key', 'tenant-v|contacts:read');

    expect(res.status).toBe(200);
    expect(res.body.data.lead).toMatchObject({ id: 'lead-3' });
    // Empresa não resolvida (sem companyId e sem fallback por telefone).
    expect(res.body.data.company).toBeNull();
    // company.findFirst NUNCA chamado — nem por id, nem pelo fallback de telefone.
    expect(prismaMock.company.findFirst).not.toHaveBeenCalled();
  });

  it('sem lead, com empresa → traz deals/interações ligados à empresa (companyId)', async () => {
    // Nenhum lead casa o telefone; a empresa casa pelo fallback de telefone.
    // $queryRaw: 1ª chamada (Lead) → vazio; 2ª chamada (Company) → id da empresa.
    prismaMock.$queryRaw
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{ id: 'company-1', phone: '1133330000' }] as never);
    prismaMock.lead.findFirst.mockResolvedValue(null as never);
    prismaMock.company.findFirst.mockResolvedValue({
      id: 'company-1',
      name: 'Acme SA',
      phone: '1133330000',
    } as never);
    prismaMock.deal.findMany.mockResolvedValue([
      { id: 'deal-c1', name: 'Contrato Acme', stage: 'QUALIFICATION', status: 'OPEN', value: 1000 },
    ] as never);
    prismaMock.interaction.findMany.mockResolvedValue([
      { id: 'int-c1', type: 'NOTE', direction: 'OUTBOUND', content: 'Ligação', createdAt: new Date() },
    ] as never);

    const res = await request(makeApp())
      .get('/contacts/resolve?phone=1133330000')
      .set('x-api-key', 'tenant-z|contacts:read');

    expect(res.status).toBe(200);
    expect(res.body.data.lead).toBeNull();
    expect(res.body.data.company).toMatchObject({ id: 'company-1' });
    // deals[] e lastInteractions[] vieram da empresa (não do lead).
    expect(res.body.data.deals).toHaveLength(1);
    expect(res.body.data.deals[0]).toMatchObject({ id: 'deal-c1' });
    expect(res.body.data.lastInteractions).toHaveLength(1);
    expect(res.body.data.lastInteractions[0]).toMatchObject({ id: 'int-c1' });
    // Buscou deals por companyId + tenant do apiKey (não por leadId).
    const dealWhere = (prismaMock.deal.findMany.mock.calls[0] as unknown as unknown[])[0] as {
      where: { tenantId: string; companyId: string };
    };
    expect(dealWhere.where.tenantId).toBe('tenant-z');
    expect(dealWhere.where.companyId).toBe('company-1');
    const intWhere = (prismaMock.interaction.findMany.mock.calls[0] as unknown as unknown[])[0] as {
      where: { tenantId: string; companyId: string };
    };
    expect(intWhere.where.companyId).toBe('company-1');
  });

  it('lead com companyId de empresa soft-deleted → company=null (sem fallback por telefone)', async () => {
    // Lead resolvido tem companyId, mas a empresa está indisponível (deletada).
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'lead-2', phone: '11988887777' }] as never);
    prismaMock.lead.findFirst.mockResolvedValue({
      id: 'lead-2',
      name: 'Ciclano',
      email: null,
      phone: '11988887777',
      company: 'Empresa Antiga',
      companyId: 'company-deleted',
    } as never);
    // findFirst da empresa por id retorna null (soft-deleted → deletedAt: null filtra fora).
    prismaMock.company.findFirst.mockResolvedValue(null as never);
    prismaMock.deal.findMany.mockResolvedValue([] as never);
    prismaMock.interaction.findMany.mockResolvedValue([] as never);

    const res = await request(makeApp())
      .get('/contacts/resolve?phone=11988887777')
      .set('x-api-key', 'tenant-w|contacts:read');

    expect(res.status).toBe(200);
    expect(res.body.data.lead).toMatchObject({ id: 'lead-2' });
    // Empresa indisponível NÃO deve cair no fallback por telefone → company=null.
    expect(res.body.data.company).toBeNull();
    // company.findFirst chamado UMA vez (só a busca por id do lead), sem fallback.
    expect(prismaMock.company.findFirst).toHaveBeenCalledOnce();
    const companyWhere = (prismaMock.company.findFirst.mock.calls[0] as unknown as unknown[])[0] as {
      where: { id?: string; phone?: unknown };
    };
    expect(companyWhere.where.id).toBe('company-deleted');
    expect(companyWhere.where.phone).toBeUndefined();
  });

  it('dois candidatos com o MESMO sufixo (DDDs diferentes) → resolve o certo por dígitos completos', async () => {
    // O sufixo curto ("955554444") casa DOIS leads no $queryRaw, mas com DDDs
    // diferentes: 11955554444 (consultado) e 21955554444 (outro). O match por
    // dígitos COMPLETOS (phonesMatch) deve escolher SÓ o lead certo, não o primeiro.
    prismaMock.$queryRaw.mockResolvedValue([
      { id: 'lead-rj', phone: '21955554444' }, // sufixo igual, DDD diferente → NÃO casa
      { id: 'lead-sp', phone: '11955554444' }, // dígitos completos batem → casa
    ] as never);
    prismaMock.lead.findFirst.mockResolvedValue({
      id: 'lead-sp',
      name: 'Certo',
      email: null,
      phone: '11955554444',
      company: null,
      companyId: null,
    } as never);
    prismaMock.deal.findMany.mockResolvedValue([] as never);
    prismaMock.interaction.findMany.mockResolvedValue([] as never);

    const res = await request(makeApp())
      .get('/contacts/resolve?phone=11955554444')
      .set('x-api-key', 'tenant-sp|contacts:read');

    expect(res.status).toBe(200);
    // Resolveu o lead cujo NÚMERO COMPLETO bate, não o primeiro do sufixo.
    expect(res.body.data.lead).toMatchObject({ id: 'lead-sp' });
    // findFirst rehidratou o id correto (lead-sp), não lead-rj.
    const call = (prismaMock.lead.findFirst.mock.calls[0] as unknown as unknown[])[0] as {
      where: { id: string };
    };
    expect(call.where.id).toBe('lead-sp');
  });

  it('candidato só com sufixo igual (nenhum dígito-completo casa) → lead=null', async () => {
    // Único candidato do sufixo é de OUTRO DDD; por dígitos completos NÃO casa.
    // Sem match completo → nenhum lead resolvido (e sem fallback de empresa aqui).
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'lead-rj', phone: '21955554444' }] as never);
    // Sem match, o fallback de empresa roda: 2ª chamada do $queryRaw (Company) → vazia.
    prismaMock.$queryRaw.mockResolvedValueOnce([
      { id: 'lead-rj', phone: '21955554444' },
    ] as never);
    prismaMock.$queryRaw.mockResolvedValueOnce([] as never);

    const res = await request(makeApp())
      .get('/contacts/resolve?phone=11955554444')
      .set('x-api-key', 'tenant-none|contacts:read');

    expect(res.status).toBe(200);
    // Nenhum lead casou por dígitos completos → lead=null.
    expect(res.body.data.lead).toBeNull();
    // Não rehidratou nenhum lead (nenhum id casou).
    expect(prismaMock.lead.findFirst).not.toHaveBeenCalled();
    // Nenhuma empresa casou o fallback → company=null.
    expect(res.body.data.company).toBeNull();
  });

  it('tolera o DDI 55: consulta com 55 e cadastro sem 55 → resolve', async () => {
    // Consulta "5511955554444" (com DDI); o cadastro está "11955554444" (sem DDI).
    // phonesMatch tolera a presença/ausência do 55 de um dos lados → casa.
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'lead-ddi', phone: '11955554444' }] as never);
    prismaMock.lead.findFirst.mockResolvedValue({
      id: 'lead-ddi',
      name: 'Com DDI',
      email: null,
      phone: '11955554444',
      company: null,
      companyId: null,
    } as never);
    prismaMock.deal.findMany.mockResolvedValue([] as never);
    prismaMock.interaction.findMany.mockResolvedValue([] as never);

    const res = await request(makeApp())
      .get('/contacts/resolve?phone=5511955554444')
      .set('x-api-key', 'tenant-ddi|contacts:read');

    expect(res.status).toBe(200);
    expect(res.body.data.lead).toMatchObject({ id: 'lead-ddi' });
  });
});
