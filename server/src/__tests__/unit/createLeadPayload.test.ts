import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { LeadStatus, LeadSource, LeadStatusReason } from '@prisma/client';

/**
 * Reproduz o payload REAL que a tela de novo lead envia (LeadForm → useLeads)
 * contra o schema REAL da rota (server/src/routes/leads.ts), para pegar
 * regressões de contrato no POST /leads ("Validation error" silencioso).
 *
 * Atualizado para a régua "Leads como Oportunidade"
 * (specs/leads-oportunidade-inteligencia-mercado.md): companyId/contactId
 * OBRIGATÓRIOS na criação manual + campos de oportunidade.
 */
const vazioComoAusente = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema);

const GO_GET_STEPS = [10, 25, 50, 75, 90] as const;

const createLeadSchema = z.object({
  name: z.string().min(1),
  email: vazioComoAusente(z.string().email().optional()),
  phone: z.string().optional(),
  company: z.string().optional(),
  position: z.string().optional(),
  companyId: z.string().uuid(),
  contactId: z.string().uuid(),
  status: z.nativeEnum(LeadStatus).optional(),
  source: z.nativeEnum(LeadSource).optional(),
  statusReason: z.nativeEnum(LeadStatusReason).optional(),
  statusReasonNote: z.string().max(2000).optional(),
  estimatedValue: z.number().nonnegative().optional(),
  estimatedTimeline: z.string().max(500).optional(),
  probabilityGoGet: z
    .number()
    .int()
    .refine((v): v is (typeof GO_GET_STEPS)[number] => GO_GET_STEPS.includes(v as any))
    .optional(),
  score: z.number().int().min(0).max(100).optional(),
  customFields: z.record(z.any()).optional(),
  notes: z.string().optional(),
  assignedTo: vazioComoAusente(z.string().uuid().optional()),
  tagIds: z.array(z.string().uuid()).optional(),
});

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

describe('POST /leads — payload da tela vs schema da rota', () => {
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
});
