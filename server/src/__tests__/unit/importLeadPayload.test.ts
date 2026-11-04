import { describe, it, expect, vi } from 'vitest';

/**
 * Contrato do POST /leads/import (FRG-178): valida as linhas da planilha contra o
 * schema REAL da rota (importLeadSchema, importado de routes/leads.ts — uma cópia
 * divergiria em silêncio). Mesmo molde de createLeadPayload.test.ts.
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

import { importLeadSchema } from '../../routes/leads.js';

/** Linha com as 17 colunas do modelo, como a tela as envia (tudo texto). */
function linhaCompleta(over: Record<string, unknown> = {}) {
  return {
    name: 'Maria Silva',
    email: 'maria@email.com',
    phone: '(11)99999-0000',
    company: 'ABC Ltda',
    source: 'Prospecção ativa',
    status: 'Novo',
    company_cnpj: '12.345.678/0001-90',
    contact_email: 'joao@abc.com.br',
    contact_name: 'João Souza',
    position: 'Diretor',
    status_reason: '',
    status_reason_note: '',
    notes: 'Quer proposta',
    estimated_value: 'R$ 1.234,56',
    estimated_timeline: '2º semestre de 2026',
    probability_go_get: '70',
    assigned_to_email: 'vendedor@tenant.com',
    ...over,
  };
}

describe('importLeadSchema — linha da planilha', () => {
  it('aceita uma linha com as dezessete colunas preenchidas', () => {
    expect(Object.keys(linhaCompleta())).toHaveLength(17);
    const r = importLeadSchema.safeParse(linhaCompleta());
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.source).toBe('PROSPECCAO_ATIVA');
      expect(r.data.status).toBe('NOVO');
      expect(r.data.estimated_value).toBe(1234.56);
      expect(r.data.probability_go_get).toBe(70);
    }
  });

  it.each([
    ['Prospecção ativa', 'PROSPECCAO_ATIVA'],
    ['PROSPECCAO_ATIVA', 'PROSPECCAO_ATIVA'],
    ['prospeccao ativa', 'PROSPECCAO_ATIVA'],
    ['Portal de Notícias/LinkedIn', 'PORTAL_NOTICIAS_LINKEDIN'],
    ['WEBSITE', 'OUTROS'], // código legado do modelo antigo
  ])('origem %j passa e vira %s', (celula, esperado) => {
    const r = importLeadSchema.safeParse(linhaCompleta({ source: celula }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.source).toBe(esperado);
  });

  it.each([
    ['Em Andamento', 'EM_ANDAMENTO'],
    ['EM_ANDAMENTO', 'EM_ANDAMENTO'],
    ['NEW', 'NOVO'], // código legado do modelo antigo
  ])('status %j passa e vira %s', (celula, esperado) => {
    const r = importLeadSchema.safeParse(linhaCompleta({ status: celula }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.status).toBe(esperado);
  });

  it('origem e status vazios passam como ausentes (a rota assume o padrão)', () => {
    const r = importLeadSchema.safeParse(linhaCompleta({ source: '', status: '' }));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.source).toBeUndefined();
      expect(r.data.status).toBeUndefined();
    }
  });

  it('origem não reconhecida NÃO passa', () => {
    const r = importLeadSchema.safeParse(linhaCompleta({ source: 'Carta pombo' }));
    expect(r.success).toBe(false);
  });

  it('motivo aceita o rótulo da tela e o código', () => {
    const a = importLeadSchema.safeParse(linhaCompleta({ status_reason: 'Sem retorno' }));
    const b = importLeadSchema.safeParse(linhaCompleta({ status_reason: 'SEM_RETORNO' }));
    expect(a.success && a.data.status_reason).toBe('SEM_RETORNO');
    expect(b.success && b.data.status_reason).toBe('SEM_RETORNO');
    expect(importLeadSchema.safeParse(linhaCompleta({ status_reason: 'Sei lá' })).success).toBe(
      false
    );
  });

  it.each(['70%', '70,5', '101', '-1', 'abc'])('probability_go_get %j NÃO passa', (v) => {
    expect(importLeadSchema.safeParse(linhaCompleta({ probability_go_get: v })).success).toBe(
      false
    );
  });

  it.each(['0', '70', '100'])('probability_go_get %j passa', (v) => {
    const r = importLeadSchema.safeParse(linhaCompleta({ probability_go_get: v }));
    expect(r.success).toBe(true);
  });

  it.each(['R$ 1.234,56', '1234.56', '1.234,56', ' 1234,56 '])(
    'estimated_value %j passa e vira 1234.56',
    (v) => {
      const r = importLeadSchema.safeParse(linhaCompleta({ estimated_value: v }));
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.estimated_value).toBe(1234.56);
    }
  );

  it('estimated_value negativo NÃO passa; só símbolo vira ausente, não zero', () => {
    expect(importLeadSchema.safeParse(linhaCompleta({ estimated_value: '-10' })).success).toBe(
      false
    );
    const r = importLeadSchema.safeParse(linhaCompleta({ estimated_value: 'R$' }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.estimated_value).toBeUndefined();
  });

  it('o payload do modelo ANTIGO (WEBSITE/NEW) já não reprova a linha — medição 5', () => {
    const r = importLeadSchema.safeParse({
      name: 'Maria Silva',
      email: 'maria@email.com',
      phone: '(11)99999-0000',
      company: 'ABC Ltda',
      source: 'WEBSITE',
      status: 'NEW',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.source).toBe('OUTROS');
      expect(r.data.status).toBe('NOVO');
    }
  });
});
