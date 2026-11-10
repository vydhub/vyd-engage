import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

/**
 * INTEGRAÇÃO HTTP do POST /api/v1/leads/import (FRG-178) — cadeia inteira:
 * auth → tenant → CSRF → permissão → schema por linha → resolução de vínculos →
 * leadService.create. Prisma mockado (mesmo molde de leadsCreate.test.ts): roda
 * sem Postgres, local e no CI.
 *
 * Trava a medição 5 da spec: ANTES, uma célula de origem inválida reprovava o
 * array inteiro com 400 e nenhuma linha entrava; AGORA recusa só a linha.
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

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const OUTRA_EMPRESA_ID = '99999999-9999-4999-8999-999999999999';
const CONTACT_ID = '22222222-2222-4222-8222-222222222222';
const RESPONSAVEL_ID = '33333333-3333-4333-8333-333333333333';

/** POST /import autenticado com CSRF, como o navegador faz. */
function postImport(leads: Record<string, unknown>[]) {
  const token = generateAccessToken({
    userId: user.id,
    tenantId: tenant.id,
    email: user.email,
    role: user.role,
  });
  return request(app)
    .post('/api/v1/leads/import')
    .set('Cookie', [`accessToken=${token}`, `csrf-token=${CSRF}`])
    .set('x-csrf-token', CSRF)
    .send({ leads, skipDuplicateEmails: true });
}

/** Linha mínima válida: empresa + contato que existem no cadastro mockado. */
function linha(over: Record<string, unknown> = {}) {
  return {
    name: 'Oportunidade A',
    company: 'ABC Ltda',
    contact_email: 'joao@abc.com.br',
    ...over,
  };
}

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

type LeadCreateArgs = { data: Record<string, unknown> };
const criadas = () =>
  (prismaMock.lead.create as unknown as { mock: { calls: LeadCreateArgs[][] } }).mock.calls.map(
    (c) => c[0].data
  );

let empresas: Array<Record<string, unknown>>;
let contatos: Array<Record<string, unknown>>;

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

  empresas = [{ id: COMPANY_ID, name: 'ABC Ltda', fantasyName: 'ABC', cnpj: '12.345.678/0001-90' }];
  contatos = [
    { id: CONTACT_ID, name: 'João Souza', email: 'joao@abc.com.br', companyId: COMPANY_ID },
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prismaMock.company.findMany.mockImplementation((() => Promise.resolve(empresas)) as any);
  // assertOpportunityLinks (dentro do leadService.create) volta a conferir a empresa
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prismaMock.company.findFirst.mockResolvedValue({ id: COMPANY_ID } as any);
  // `lead.findMany` atende a deduplicação de e-mail E a busca em lote de contatos.
  prismaMock.lead.findMany.mockImplementation(((args: { where?: { isContact?: boolean } }) =>
    Promise.resolve(args?.where?.isContact ? contatos : [])) as never);
  // `lead.findFirst`: o contato (assertOpportunityLinks) e o re-read do findById.
  prismaMock.lead.findFirst.mockImplementation(((args: { where?: { id?: string } }) => {
    if (args?.where?.id === CONTACT_ID) {
      return Promise.resolve({ id: CONTACT_ID, isContact: true, companyId: COMPANY_ID });
    }
    return Promise.resolve(leadCriado);
  }) as never);
  prismaMock.lead.findUnique.mockResolvedValue(leadCriado);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prismaMock.user.findMany.mockResolvedValue([
    { id: RESPONSAVEL_ID, email: 'Vendedor@Tenant.com' },
  ] as any);
  prismaMock.leadTag.create.mockResolvedValue({} as never);
  prismaMock.interaction.create.mockResolvedValue({} as never);
  prismaMock.notification.create.mockResolvedValue({} as never);
});

describe('POST /api/v1/leads/import — uma linha ruim não derruba o arquivo', () => {
  it('origem inválida na linha 1 e linha 2 válida: 200, imported 1, failed 1, errors[0].row 1', async () => {
    const res = await postImport([
      linha({ source: 'Carta pombo' }),
      linha({ name: 'Oportunidade B' }),
    ]);

    expect(res.status).toBe(200);
    expect(res.body.data.imported).toBe(1);
    expect(res.body.data.failed).toBe(1);
    expect(res.body.data.errors[0].row).toBe(1);
    expect(res.body.data.errors[0].error).toContain('source');
    expect(criadas()).toHaveLength(1);
    expect(criadas()[0].name).toBe('Oportunidade B');
  });

  it('o modelo ANTIGO (WEBSITE/NEW) é traduzido: a linha só cai por falta de empresa/contato', async () => {
    const res = await postImport([
      {
        name: 'Maria',
        email: 'maria@email.com',
        company: 'ABC Ltda',
        source: 'WEBSITE',
        status: 'NEW',
      },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.data.imported).toBe(0);
    expect(res.body.data.errors[0].error).toContain('Contato obrigatório');
  });
});

describe('POST /api/v1/leads/import — vínculos', () => {
  it('empresa pelo nome e contato pelo e-mail DELA: cria com companyId e contactId', async () => {
    const res = await postImport([linha()]);

    expect(res.status).toBe(200);
    expect(res.body.data.imported).toBe(1);
    const dados = criadas()[0];
    expect(dados.companyId).toBe(COMPANY_ID);
    expect(dados.contactId).toBe(CONTACT_ID);
    expect(dados.company).toBe('ABC Ltda'); // texto da célula continua gravado (D15)
  });

  it('empresa pelo CNPJ e contato pelo nome', async () => {
    const res = await postImport([
      { name: 'Por CNPJ', company_cnpj: '12345678000190', contact_name: 'joão  souza' },
    ]);
    expect(res.body.data.imported).toBe(1);
    expect(criadas()[0].companyId).toBe(COMPANY_ID);
    expect(criadas()[0].contactId).toBe(CONTACT_ID);
  });

  it('linha sem company é recusada e aparece em errors com o número da linha', async () => {
    const res = await postImport([
      linha(),
      { name: 'Sem empresa', contact_email: 'joao@abc.com.br' },
    ]);

    expect(res.status).toBe(200);
    expect(res.body.data.imported).toBe(1);
    expect(res.body.data.failed).toBe(1);
    expect(res.body.data.errors).toEqual([
      { row: 2, error: 'Empresa obrigatória: preencha company ou company_cnpj' },
    ]);
  });

  it('empresa que não existe é recusada', async () => {
    const res = await postImport([linha({ company: 'Não existe S/A' })]);
    expect(res.body.data.imported).toBe(0);
    expect(res.body.data.errors[0].error).toContain('Empresa não encontrada');
  });

  it('company que casa DUAS empresas é recusada (caso extremo 3)', async () => {
    empresas.push({ id: OUTRA_EMPRESA_ID, name: 'abc  LTDA', fantasyName: null, cnpj: null });
    const res = await postImport([linha()]);

    expect(res.body.data.imported).toBe(0);
    expect(res.body.data.errors[0].error).toContain('casa mais de uma empresa');
    expect(criadas()).toHaveLength(0);
  });

  it('company_cnpj e company apontando para empresas diferentes: recusada (caso 4)', async () => {
    empresas.push({
      id: OUTRA_EMPRESA_ID,
      name: 'Outra',
      fantasyName: null,
      cnpj: '99.999.999/0001-99',
    });
    const res = await postImport([linha({ company: 'Outra', company_cnpj: '12.345.678/0001-90' })]);

    expect(res.body.data.imported).toBe(0);
    expect(res.body.data.errors[0].error).toContain('apontam para empresas diferentes');
  });

  it('contato de OUTRA empresa é recusado (caso 5)', async () => {
    contatos = [
      { id: CONTACT_ID, name: 'João Souza', email: 'joao@abc.com.br', companyId: OUTRA_EMPRESA_ID },
    ];
    const res = await postImport([linha()]);

    expect(res.body.data.imported).toBe(0);
    expect(res.body.data.errors[0].error).toContain('Contato não encontrado');
  });

  it('a resolução é em lote: 3 linhas, UMA consulta de empresas e UMA de contatos', async () => {
    await postImport([linha(), linha({ name: 'B' }), linha({ name: 'C' })]);

    expect(prismaMock.company.findMany).toHaveBeenCalledTimes(1);
    const consultasDeContato = (
      prismaMock.lead.findMany as unknown as {
        mock: { calls: Array<[{ where?: { isContact?: boolean } }]> };
      }
    ).mock.calls.filter((c) => c[0]?.where?.isContact);
    expect(consultasDeContato).toHaveLength(1);
  });

  it('e-mail duplicado é pulado ANTES de resolver vínculos (conta em skipped, não em failed)', async () => {
    prismaMock.lead.findMany.mockImplementation(((args: { where?: { isContact?: boolean } }) =>
      Promise.resolve(args?.where?.isContact ? contatos : [{ email: 'ja@existe.com' }])) as never);
    const res = await postImport([linha({ email: 'JA@existe.com', company: 'Nem existe' })]);

    expect(res.body.data.skipped).toBe(1);
    expect(res.body.data.failed).toBe(0);
  });
});

describe('POST /api/v1/leads/import — responsável comercial', () => {
  it('assigned_to_email de usuário do tenant vira assignedTo com o uuid dele', async () => {
    const res = await postImport([linha({ assigned_to_email: 'vendedor@tenant.com' })]);
    expect(res.body.data.imported).toBe(1);
    expect(criadas()[0].assignedTo).toBe(RESPONSAVEL_ID);
  });

  it('e-mail desconhecido recusa a linha', async () => {
    const res = await postImport([linha({ assigned_to_email: 'ninguem@tenant.com' })]);
    expect(res.body.data.imported).toBe(0);
    expect(res.body.data.errors[0].error).toContain('Responsável não encontrado');
  });

  it('célula vazia cria o lead sem responsável', async () => {
    const res = await postImport([linha({ assigned_to_email: '' })]);
    expect(res.body.data.imported).toBe(1);
    expect(criadas()[0].assignedTo).toBeUndefined();
  });
});

describe('POST /api/v1/leads/import — motivo dos status terminais', () => {
  it('Pausado sem motivo é recusada com a mensagem de STATUS_REASON_REQUIRED', async () => {
    const res = await postImport([linha({ status: 'Pausado' })]);
    expect(res.body.data.imported).toBe(0);
    expect(res.body.data.errors[0].error).toBe(
      'Informe o motivo para pausar, cancelar ou encerrar o lead'
    );
  });

  it('motivo "Outro" sem nota é recusada com a de STATUS_REASON_NOTE_REQUIRED', async () => {
    const res = await postImport([linha({ status: 'Pausado', status_reason: 'Outro' })]);
    expect(res.body.data.errors[0].error).toBe('Descreva o motivo quando selecionar "Outro"');
  });

  it('Pausado com motivo é criada, com motivo e nota gravados', async () => {
    const res = await postImport([
      linha({ status: 'Pausado', status_reason: 'Sem retorno', status_reason_note: 'sumiu' }),
    ]);
    expect(res.body.data.imported).toBe(1);
    expect(criadas()[0].status).toBe('PAUSADO');
    expect(criadas()[0].statusReason).toBe('SEM_RETORNO');
    expect(criadas()[0].statusReasonNote).toBe('sumiu');
  });
});

describe('POST /api/v1/leads/import — campos de oportunidade chegam ao serviço', () => {
  it('valor, prazo, probabilidade, origem e status', async () => {
    const res = await postImport([
      linha({
        estimated_value: 'R$ 1.234,56',
        estimated_timeline: '2º semestre',
        probability_go_get: '70',
        source: 'Indicação de parceiros',
        status: 'Em Andamento',
      }),
    ]);
    expect(res.body.data.imported).toBe(1);
    const d = criadas()[0];
    expect(d.estimatedValue).toBe(1234.56);
    expect(d.estimatedTimeline).toBe('2º semestre');
    expect(d.probabilityGoGet).toBe(70);
    expect(d.source).toBe('INDICACAO_PARCEIROS');
    expect(d.status).toBe('EM_ANDAMENTO');
  });

  it('mais de mil linhas continua sendo recusado pela rota (400)', async () => {
    const res = await postImport(Array.from({ length: 1001 }, (_, i) => linha({ name: `L${i}` })));
    expect(res.status).toBe(400);
  });
});
