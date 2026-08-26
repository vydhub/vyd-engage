// Testes unitários (sem DB — prismaMock) da lógica crítica do módulo de Parceiros:
// detecção determinística de conflito (CNPJ forte / nome fraco / grupo econômico
// NÃO é conflito) e matemática da comissão por recebimento (split × % × papel).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

vi.mock('../../config/database.js', () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));
vi.mock('../../utils/logger.js', () => ({
  __esModule: true,
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../services/notificationService.js', () => ({
  __esModule: true,
  notificationService: { create: vi.fn().mockResolvedValue({}), getTenantAdminIds: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../../services/parceiros/configService.js', () => ({
  __esModule: true,
  parceiroConfigService: {
    get: vi.fn().mockResolvedValue({
      protecaoDiasPadrao: 90,
      updateCadenciaDias: 30,
      avisoExpiracaoDias: 7,
      splitOriginadorPadrao: 60,
      scorePesos: { novasOportunidades: 25, updatesCumpridos: 25, presencaReunioes: 25, progressaoPipeline: 25 },
      scoreLimiares: { saudavel: 75, atencao: 50, esfriando: 25 },
      decaimentoPontosPorDia: 0.5,
      decaimentoMaxPontos: 30,
      conflitoInternoUserId: null,
    }),
  },
}));

import prisma from '../../config/database.js';
import { registroService } from '../../services/parceiros/registroService.js';
import { comissaoService } from '../../services/parceiros/comissaoService.js';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
beforeEach(() => {
  mockReset(prismaMock);
});

const TENANT = 't1';

describe('detecção determinística de conflito (reqs 16-17)', () => {
  it('mesmo CNPJ de OUTRO consultor → candidato FORTE (externo×externo)', async () => {
    prismaMock.registroOportunidade.findMany.mockResolvedValue([
      { id: 'r2', clienteCnpjDigits: '12345678000100', clienteNome: 'Prefeitura X', clienteContato: null },
    ] as never);
    prismaMock.company.findMany.mockResolvedValue([] as never);

    const out = await registroService.detectConflitos(TENANT, {
      id: 'r1',
      consultorId: 'c1',
      clienteCnpjDigits: '12345678000100',
      clienteNome: 'Prefeitura Municipal X',
      clienteContato: null,
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ tipo: 'EXTERNO_EXTERNO', alvoRegistroId: 'r2', matchForca: 'FORTE' });
  });

  it('CNPJs DIFERENTES (grupo econômico/matriz-filial) → NÃO é conflito', async () => {
    prismaMock.registroOportunidade.findMany.mockResolvedValue([
      { id: 'r2', clienteCnpjDigits: '12345678000281', clienteNome: 'Prefeitura X', clienteContato: null },
    ] as never);
    prismaMock.company.findMany.mockResolvedValue([
      { id: 'co1', name: 'Prefeitura X', cnpj: '12.345.678/0002-81' },
    ] as never);

    const out = await registroService.detectConflitos(TENANT, {
      id: 'r1',
      consultorId: 'c1',
      clienteCnpjDigits: '12345678000100', // filial diferente
      clienteNome: 'Prefeitura X',
      clienteContato: null,
    });
    expect(out).toHaveLength(0);
  });

  it('sem CNPJ → match FRACO por razão social normalizada', async () => {
    prismaMock.registroOportunidade.findMany.mockResolvedValue([
      { id: 'r2', clienteCnpjDigits: null, clienteNome: 'Construtora  ALFA ', clienteContato: null },
    ] as never);
    prismaMock.company.findMany.mockResolvedValue([] as never);

    const out = await registroService.detectConflitos(TENANT, {
      id: 'r1',
      consultorId: 'c1',
      clienteCnpjDigits: null,
      clienteNome: 'construtora alfa',
      clienteContato: null,
    });
    expect(out).toHaveLength(1);
    expect(out[0].matchForca).toBe('FRACO');
  });

  it('mesmo CNPJ no pipeline INTERNO (Company + deal OPEN) → EXTERNO_INTERNO', async () => {
    prismaMock.registroOportunidade.findMany.mockResolvedValue([] as never);
    prismaMock.company.findMany.mockResolvedValue([
      { id: 'co1', name: 'Cliente Y', cnpj: '11.222.333/0001-44' },
    ] as never);
    prismaMock.deal.findFirst.mockResolvedValue({ id: 'd1' } as never);

    const out = await registroService.detectConflitos(TENANT, {
      id: 'r1',
      consultorId: 'c1',
      clienteCnpjDigits: '11222333000144',
      clienteNome: 'Cliente Y Ltda',
      clienteContato: null,
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ tipo: 'EXTERNO_INTERNO', alvoCompanyId: 'co1', alvoDealId: 'd1', matchForca: 'FORTE' });
  });
});

describe('comissão por recebimento (reqs 30-31)', () => {
  it('split 60/40 com % distintos por papel: parcelas proporcionais ao recebimento', async () => {
    prismaMock.registroOportunidade.findFirst.mockResolvedValue({
      id: 'r1',
      tenantId: TENANT,
      status: 'GANHO',
      clienteNome: 'Cliente Z',
      valorContrato: 100000,
      splitOriginador: null, // usa o padrão do tenant (60)
      atribuicoes: [
        { consultorId: 'c1', papel: 'ORIGINADOR', percentualOverride: null, consultor: { nome: 'A', userId: 'u1', comissaoBase: 5 } },
        { consultorId: 'c2', papel: 'DESENVOLVEDOR', percentualOverride: 10, consultor: { nome: 'B', userId: 'u2', comissaoBase: 3 } },
      ],
    } as never);
    const created: Array<Record<string, unknown>> = [];
    prismaMock.$transaction.mockImplementation((async (cb: (tx: unknown) => Promise<unknown>) =>
      cb(prismaMock)) as never);
    prismaMock.recebimento.create.mockResolvedValue({ id: 'rec1' } as never);
    prismaMock.comissaoParcela.create.mockImplementation((async (args: { data: Record<string, unknown> }) => {
      created.push(args.data);
      return args.data;
    }) as never);
    prismaMock.registroAuditoria.create.mockResolvedValue({} as never);
    prismaMock.recebimento.aggregate.mockResolvedValue({ _sum: { valor: 10000 } } as never);

    const result = await comissaoService.addRecebimento(TENANT, 'r1', 'gestor1', {
      data: new Date('2026-07-01'),
      valor: 10000,
      referencia: 'Medição 1',
    });

    // Originador: 10000 × 5% × 60% = 300; Desenvolvedor: 10000 × 10% × 40% = 400.
    expect(created).toHaveLength(2);
    const orig = created.find((p) => p.papel === 'ORIGINADOR');
    const dev = created.find((p) => p.papel === 'DESENVOLVEDOR');
    expect(Number(orig?.valor)).toBeCloseTo(300);
    expect(Number(orig?.fracaoPapel)).toBe(60);
    expect(Number(dev?.valor)).toBeCloseTo(400);
    expect(Number(dev?.fracaoPapel)).toBe(40);
    expect(result.excedeuContrato).toBe(false);
  });

  it('% de comissão indefinido → pendência EXPLÍCITA (nunca calcula com zero)', async () => {
    prismaMock.registroOportunidade.findFirst.mockResolvedValue({
      id: 'r1',
      tenantId: TENANT,
      status: 'GANHO',
      clienteNome: 'Cliente Z',
      valorContrato: 100000,
      splitOriginador: null,
      atribuicoes: [
        { consultorId: 'c1', papel: 'ORIGINADOR', percentualOverride: null, consultor: { nome: 'A', userId: 'u1', comissaoBase: 0 } },
      ],
    } as never);

    await expect(
      comissaoService.addRecebimento(TENANT, 'r1', 'g1', { data: new Date(), valor: 5000 })
    ).rejects.toMatchObject({ code: 'COMISSAO_PERCENTUAL_PENDENTE' });
  });

  it('recebimento em registro NÃO ganho → bloqueado', async () => {
    prismaMock.registroOportunidade.findFirst.mockResolvedValue({
      id: 'r1',
      tenantId: TENANT,
      status: 'APROVADO',
      atribuicoes: [],
    } as never);
    await expect(
      comissaoService.addRecebimento(TENANT, 'r1', 'g1', { data: new Date(), valor: 5000 })
    ).rejects.toMatchObject({ code: 'NOT_WON' });
  });
});

describe('resolução de conflito destrava origem E alvo (reqs 18, 38)', () => {
  const TENANT_C = 'tenant-conflito';

  /** Monta o conflito ABERTO que resolveConflito busca no início. */
  function mockConflito(decisaoAlvo: string | null = 'alvo-1') {
    prismaMock.conflitoCandidato.findFirst.mockResolvedValue({
      id: 'k1',
      tenantId: TENANT_C,
      registroId: 'origem-1',
      alvoRegistroId: decisaoAlvo,
      matchChave: 'CNPJ 12345678000100',
      status: 'ABERTO',
      registro: { id: 'origem-1', status: 'EM_ANALISE', consultor: { nome: 'Ana', userId: 'u9' } },
    } as never);
    prismaMock.conflitoCandidato.update.mockResolvedValue({} as never);
    prismaMock.conflitoCandidato.findMany.mockResolvedValue([] as never);
    prismaMock.registroAuditoria.create.mockResolvedValue({} as never);
    prismaMock.registroOportunidade.update.mockResolvedValue({} as never);
  }

  it('MANTER sem conflitos abertos: origem E alvo voltam para SUBMETIDO', async () => {
    mockConflito();
    // Nenhum conflito aberto sobrou para nenhum dos dois.
    prismaMock.conflitoCandidato.count.mockResolvedValue(0 as never);
    // Ambos presos em EM_ANALISE pela detecção.
    prismaMock.registroOportunidade.findFirst.mockImplementation(
      (async (args: { where: { id: string } }) => ({ id: args.where.id })) as never
    );

    await registroService.resolveConflito(TENANT_C, 'k1', 'gestor-1', {
      decisao: 'MANTER' as never,
      rationale: 'frentes independentes',
    });

    const destravados = prismaMock.registroOportunidade.update.mock.calls
      .filter((c) => (c[0] as { data?: { status?: string } }).data?.status === 'SUBMETIDO')
      .map((c) => (c[0] as { where: { id: string } }).where.id);
    // O alvo é o que regredia: sem ele, sumia da fila de aprovação e da de conflitos.
    expect(destravados).toContain('origem-1');
    expect(destravados).toContain('alvo-1');
  });

  it('ainda restando conflito aberto: ninguém é destravado', async () => {
    mockConflito();
    prismaMock.conflitoCandidato.count.mockResolvedValue(1 as never);
    prismaMock.registroOportunidade.findFirst.mockResolvedValue({ id: 'origem-1' } as never);

    await registroService.resolveConflito(TENANT_C, 'k1', 'gestor-1', {
      decisao: 'INDEPENDENTE' as never,
      rationale: 'seguem separados',
    });

    const destravados = prismaMock.registroOportunidade.update.mock.calls.filter(
      (c) => (c[0] as { data?: { status?: string } }).data?.status === 'SUBMETIDO'
    );
    expect(destravados).toHaveLength(0);
  });

  it('não destrava registro fora de EM_ANALISE (decisão posterior do gestor)', async () => {
    mockConflito();
    prismaMock.conflitoCandidato.count.mockResolvedValue(0 as never);
    // findFirst filtra por status EM_ANALISE → nada preso a destravar.
    prismaMock.registroOportunidade.findFirst.mockResolvedValue(null as never);

    await registroService.resolveConflito(TENANT_C, 'k1', 'gestor-1', {
      decisao: 'MANTER' as never,
      rationale: 'já aprovado antes',
    });

    const destravados = prismaMock.registroOportunidade.update.mock.calls.filter(
      (c) => (c[0] as { data?: { status?: string } }).data?.status === 'SUBMETIDO'
    );
    expect(destravados).toHaveLength(0);
  });
});
