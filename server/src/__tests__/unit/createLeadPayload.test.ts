import { describe, it, expect, vi } from 'vitest';

/**
 * Contrato do POST/PUT /leads: valida os payloads da tela contra o schema REAL
 * da rota (importado de routes/leads.ts — uma cópia divergiria em silêncio).
 *
 * Régua "Leads como Oportunidade" (specs/leads-oportunidade-inteligencia-mercado.md):
 * companyId/contactId OBRIGATÓRIOS na criação manual + campos de oportunidade,
 * com limpeza explícita (null) permitida só na edição.
 */

// A rota importa serviços que puxam BullMQ/Redis no load — mockados como no
// http/leadsCreate.test.ts (nenhum job real sobe num teste de schema).
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

import { createLeadSchema, updateLeadSchema } from '../../routes/leads.js';

const GO_GET_STEPS = [10, 25, 50, 75, 90] as const;
const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const CONTACT_ID = '22222222-2222-4222-8222-222222222222';

/** Payload como o useLeads.createLead monta hoje (régua nova). */
function payloadDaTela(over: Record<string, unknown> = {}) {
  return {
    name: 'Lead de teste',
    email: '', // formData.email começa vazio e vai assim quando não preenchido
    phone: '',
    position: undefined,
    companyId: COMPANY_ID,
    contactId: CONTACT_ID,
    status: 'NOVO',
    source: 'OUTROS',
    estimatedValue: 150000,
    estimatedTimeline: '2º semestre de 2026',
    probabilityGoGet: 50,
    customFields: {},
    notes: undefined,
    assignedTo: undefined,
    tagIds: [],
    ...over,
  };
}

describe('POST /leads — payload da tela vs schema REAL da rota', () => {
  it('e-mail VAZIO passa a ser aceito como "não informado" (era a causa do 400)', () => {
    const r = createLeadSchema.safeParse(payloadDaTela());
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email).toBeUndefined();
  });

  it('e-mail INVÁLIDO continua sendo rejeitado — a tolerância é só para vazio', () => {
    const r = createLeadSchema.safeParse(payloadDaTela({ email: 'nao-e-email' }));
    expect(r.success).toBe(false);
  });

  it('com e-mail preenchido, o mesmo payload passa', () => {
    const r = createLeadSchema.safeParse(payloadDaTela({ email: 'alguem@k2mais.com.br' }));
    expect(r.success).toBe(true);
  });

  it('assignedTo vazio também é aceito (uuid rejeitaria string vazia)', () => {
    const r = createLeadSchema.safeParse(payloadDaTela({ email: undefined, assignedTo: '' }));
    expect(r.success).toBe(true);
  });

  it('phone vazio NÃO é problema (z.string() aceita vazio)', () => {
    const r = createLeadSchema.safeParse(payloadDaTela({ email: undefined, phone: '' }));
    expect(r.success).toBe(true);
  });

  // ── Régua nova (spec reqs. 1 e 9) ─────────────────────────────────────────

  it('SEM companyId a criação manual é rejeitada (req. 1)', () => {
    const r = createLeadSchema.safeParse(payloadDaTela({ companyId: undefined }));
    expect(r.success).toBe(false);
  });

  it('SEM contactId a criação manual é rejeitada (req. 1)', () => {
    const r = createLeadSchema.safeParse(payloadDaTela({ contactId: undefined }));
    expect(r.success).toBe(false);
  });

  it('probabilityGoGet fora dos degraus 10/25/50/75/90 é rejeitada (req. 9)', () => {
    const r = createLeadSchema.safeParse(payloadDaTela({ probabilityGoGet: 33 }));
    expect(r.success).toBe(false);
  });

  it('probabilityGoGet em cada degrau válido passa (req. 9)', () => {
    for (const step of GO_GET_STEPS) {
      const r = createLeadSchema.safeParse(payloadDaTela({ probabilityGoGet: step }));
      expect(r.success).toBe(true);
    }
  });

  it('status legado (NEW) é rejeitado pelo schema — a régua nova é a única aceita', () => {
    const r = createLeadSchema.safeParse(payloadDaTela({ status: 'NEW' }));
    expect(r.success).toBe(false);
  });

  it('null NÃO é aceito na criação (limpeza só existe na edição)', () => {
    const r = createLeadSchema.safeParse(payloadDaTela({ estimatedValue: null }));
    expect(r.success).toBe(false);
  });
});

describe('PUT /leads — edição: vínculos opcionais e limpeza explícita (req. 9)', () => {
  const ID = '33333333-3333-4333-8333-333333333333';

  it('edição SEM vínculos é aceita (leads legados continuam editáveis — caso 1)', () => {
    const r = updateLeadSchema.safeParse({ id: ID, name: 'Só renomear' });
    expect(r.success).toBe(true);
  });

  it('null limpa os campos de oportunidade na edição', () => {
    const r = updateLeadSchema.safeParse({
      id: ID,
      notes: null,
      estimatedValue: null,
      estimatedTimeline: null,
      probabilityGoGet: null,
      assignedTo: null,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.notes).toBeNull();
      expect(r.data.estimatedValue).toBeNull();
      expect(r.data.probabilityGoGet).toBeNull();
      expect(r.data.assignedTo).toBeNull();
    }
  });

  it('degraus do Go×Get continuam valendo na edição (33 rejeitado; 75 aceito)', () => {
    expect(updateLeadSchema.safeParse({ id: ID, probabilityGoGet: 33 }).success).toBe(false);
    expect(updateLeadSchema.safeParse({ id: ID, probabilityGoGet: 75 }).success).toBe(true);
  });
});
