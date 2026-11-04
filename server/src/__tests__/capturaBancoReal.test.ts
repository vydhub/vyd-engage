import { Agent, createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import crypto from 'crypto';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Prova em Postgres de verdade (spec captura-demandas, filha 02): transação, unicidade,
 * trava de linha, idempotência, saldo, indicadores e semeadura. Nada disso se prova com
 * mock. Só roda com CAPTURA_BANCO_DESCARTAVEL=1 e DATABASE_URL em localhost; sem isso,
 * fica pulado, e a suíte comum não precisa de banco.
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

const ligado =
  process.env.CAPTURA_BANCO_DESCARTAVEL === '1' &&
  /^postgres(ql)?:\/\/[^@]*@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? '');

// No CI, a prova é exigida: se a guarda acima não casar, o arquivo falha, em vez de pular os
// testes e sair com 0 sem ter provado nada.
if (process.env.CAPTURA_BANCO_EXIGIR === '1' && !ligado) {
  describe('Captura de Demandas em banco real (exigida)', () => {
    it('roda com CAPTURA_BANCO_DESCARTAVEL=1 e DATABASE_URL em localhost ou 127.0.0.1', () => {
      throw new Error(
        'CAPTURA_BANCO_EXIGIR=1, mas a prova em banco real seria pulada: confira ' +
          'CAPTURA_BANCO_DESCARTAVEL e o host de DATABASE_URL.'
      );
    });
  });
}

const SEGREDO_EVENTOS = 'segredo-dos-eventos-de-teste';

/** O que o Flow de mentira recebe do espelho. */
interface EventoRecebido {
  event: string;
  data: Record<string, unknown>;
}

describe.runIf(ligado)('Captura de Demandas em banco real', () => {
  // Importados aqui dentro para a suíte sem banco nem tocar no Prisma.
  let prisma: typeof import('../config/database.js').default;
  let app: express.Express;
  let servicos: {
    garantirFunis: typeof import('../services/captura/demandaService.js').garantirFunis;
    obterIndicadores: typeof import('../services/captura/indicadoresService.js').obterIndicadores;
    semear: typeof import('../services/captura/semeadura.js').semear;
    lerCsv: typeof import('../services/captura/semeadura.js').lerCsv;
    dealService: typeof import('../services/dealService.js').dealService;
    funnelService: typeof import('../services/funnelService.js').funnelService;
    companyService: typeof import('../services/companyService.js').companyService;
    trash: typeof import('../services/trashService.js').trashService;
    checarContratos: typeof import('../jobs/clientFollowUpChecker.js').checkClientFollowUpsAndContracts;
    token: typeof import('../utils/jwt.js').generateAccessToken;
  };

  const fixtures = JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'captura-contratos-fixtures.json'),
      'utf8'
    )
  );

  let seq = 0;
  const unico = (prefixo: string) => `${prefixo}-${Date.now()}-${++seq}`;

  async function novoTenant() {
    const tenant = await prisma.tenant.create({
      data: { name: unico('Tenant'), slug: unico('tenant') },
    });
    const admin = await prisma.user.create({
      data: {
        email: `${unico('admin')}@exemplo.com`,
        passwordHash: 'x',
        name: 'Admin',
        role: 'ADMIN',
        status: 'ACTIVE',
        tenantId: tenant.id,
      },
    });
    const leitor = await prisma.user.create({
      data: {
        email: `${unico('leitor')}@exemplo.com`,
        passwordHash: 'x',
        name: 'Leitor',
        role: 'VIEWER',
        status: 'ACTIVE',
        tenantId: tenant.id,
      },
    });
    const servico = await prisma.user.create({
      data: {
        email: `${unico('captura')}@exemplo.com`,
        passwordHash: 'x',
        name: 'Captura',
        role: 'USER',
        status: 'ACTIVE',
        tenantId: tenant.id,
      },
    });
    const sessao = (u: { id: string; email: string; role: string }) =>
      `Bearer ${servicos.token({ userId: u.id, tenantId: tenant.id, email: u.email, role: u.role } as never)}`;
    return {
      tenant,
      admin,
      leitor,
      servico,
      sessaoAdmin: sessao(admin),
      sessaoLeitor: sessao(leitor),
    };
  }

  async function novaChave(
    tenantId: string,
    scopes: string[],
    userId: string | null
  ): Promise<string> {
    const chave = `fcrm_${crypto.randomUUID().replace(/-/g, '')}`;
    await prisma.apiKey.create({
      data: {
        tenantId,
        name: unico('chave'),
        key: `fcrm_****${chave.slice(-8)}`,
        keyHash: await bcrypt.hash(chave, 4),
        scopes,
        userId,
      },
    });
    return chave;
  }

  const novaEmpresa = (tenantId: string, extra: Record<string, unknown> = {}) =>
    prisma.company.create({ data: { tenantId, name: unico('Empresa'), ...extra } });

  async function assinarEPostar(corpo: Record<string, unknown>) {
    const cru = JSON.stringify(corpo);
    const { assinarVyd } = await import('../utils/vydHmac.js');
    const ts = String(Math.floor(Date.now() / 1000));
    return request(app)
      .post('/api/v1/captura/eventos')
      .set('Content-Type', 'application/json')
      .set('X-VYD-Timestamp', ts)
      .set('X-VYD-Assinatura', assinarVyd(SEGREDO_EVENTOS, ts, cru))
      .send(cru);
  }

  const evento = (chave: string, estado: string, ocorridoEm: string, extra = {}) => ({
    evento_id: crypto.randomUUID(),
    chave_dedup: chave,
    flow_card_id: crypto.randomUUID(),
    estado,
    ocorrido_em: ocorridoEm,
    valor_enviado: null,
    valor_aprovado: null,
    motivo: null,
    autor_email: null,
    ...extra,
  });

  // Tenant que recebe os eventos: CAPTURA_TENANT_ID é único por processo, como em produção.
  let base: Awaited<ReturnType<typeof novoTenant>>;
  let chaveEscrita: string;
  let empresa: { id: string; name: string };

  function corpoDemanda(extra: Record<string, unknown> = {}) {
    return {
      chave_dedup: `email:<${unico('msg')}@exemplo.com>`,
      id_captura: crypto.randomUUID(),
      cenario: 'contrato_novo',
      fonte: 'demandas@',
      nivel: 1,
      recebido_em_origem: '2026-11-20T13:58:00Z',
      capturado_em: '2026-11-20T14:00:10Z',
      cliente_id: empresa.id,
      contrato_id: null,
      objeto: 'Título curto do pedido',
      valor_estimado: null,
      flow_card_id: null,
      link_original: null,
      responsavel_email: null,
      ...extra,
    };
  }

  const criarDemanda = (corpo: Record<string, unknown>) =>
    request(app).post('/api/v1/captura/demandas').set('X-API-Key', chaveEscrita).send(corpo);

  async function novoContrato(extra: Record<string, unknown> = {}) {
    const res = await request(app)
      .post('/api/v1/gestao-contratos')
      .set('Authorization', base.sessaoAdmin)
      .send({ companyId: empresa.id, numero: unico('CT'), valorContratado: 1000, ...extra });
    expect(res.status).toBe(201);
    return res.body.data as { id: string; numero: string };
  }

  async function saldoDe(id: string) {
    const res = await request(app)
      .get(`/api/v1/gestao-contratos/${id}`)
      .set('Authorization', base.sessaoAdmin);
    expect(res.status).toBe(200);
    return res.body.data.saldo as number | null;
  }

  beforeAll(async () => {
    process.env.CAPTURA_EVENTOS_HMAC = SEGREDO_EVENTOS;
    process.env.ENABLE_API_KEY_READ = 'true';
    process.env.FRONTEND_URL = 'https://engage.vydhub.com';

    prisma = (await import('../config/database.js')).default;
    const { errorHandler } = await import('../middleware/errorHandler.js');
    const rotas = await Promise.all([
      import('../routes/captura.js'),
      import('../routes/contratos.js'),
      import('../routes/gestaoContratos.js'),
      import('../routes/capturaRelatorio.js'),
      import('../routes/deals.js'),
      import('../routes/funnels.js'),
      import('../routes/goals.js'),
    ]);

    servicos = {
      garantirFunis: (await import('../services/captura/demandaService.js')).garantirFunis,
      obterIndicadores: (await import('../services/captura/indicadoresService.js'))
        .obterIndicadores,
      semear: (await import('../services/captura/semeadura.js')).semear,
      lerCsv: (await import('../services/captura/semeadura.js')).lerCsv,
      dealService: (await import('../services/dealService.js')).dealService,
      funnelService: (await import('../services/funnelService.js')).funnelService,
      companyService: (await import('../services/companyService.js')).companyService,
      trash: (await import('../services/trashService.js')).trashService,
      checarContratos: (await import('../jobs/clientFollowUpChecker.js'))
        .checkClientFollowUpsAndContracts,
      token: (await import('../utils/jwt.js')).generateAccessToken,
    };

    app = express();
    app.use(cookieParser());
    app.use(
      express.json({
        verify: (req: express.Request & { rawBody?: string }, _res, buf) => {
          req.rawBody = buf.toString('utf8');
        },
      })
    );
    app.use('/api/v1/captura', rotas[0].default);
    app.use('/api/v1/contratos', rotas[1].default);
    app.use('/api/v1/gestao-contratos', rotas[2].default);
    app.use('/api/v1/captura-relatorio', rotas[3].default);
    app.use('/api/v1/deals', rotas[4].default);
    app.use('/api/v1/funnels', rotas[5].default);
    app.use('/api/v1/goals', rotas[6].default);
    app.use(errorHandler);

    base = await novoTenant();
    process.env.CAPTURA_TENANT_ID = base.tenant.id;
    chaveEscrita = await novaChave(
      base.tenant.id,
      ['captura:write', 'contracts:read'],
      base.servico.id
    );
    empresa = await novaEmpresa(base.tenant.id, {
      cnpj: '12.345.678/0001-90',
      domain: 'www.cliente.com.br',
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  // ── Funis (E-12) ─────────────────────────────────────────────────────────────

  it('E-12: criar os funis é idempotente, mesmo com chamadas simultâneas', async () => {
    const { tenant } = await novoTenant();
    await Promise.all(Array.from({ length: 5 }, () => servicos.garantirFunis(tenant.id)));
    await servicos.garantirFunis(tenant.id);

    const funis = await prisma.funnel.findMany({
      where: { tenantId: tenant.id, type: 'DEAL' },
      include: { columns: true },
      orderBy: { name: 'asc' },
    });
    expect(funis.map((f) => f.name)).toEqual(['Chamados', 'Contrato novo']);
    for (const funil of funis) {
      expect(funil.columns).toHaveLength(8);
      expect(new Set(funil.columns.map((c) => c.capturaEstado)).size).toBe(8);
      expect(funil.isDefault).toBe(false);
    }
    const iniciacao = funis[1].columns.find((c) => c.capturaEstado === 'recebida');
    expect(iniciacao?.title).toBe('Iniciação');
    expect(await prisma.dealSource.count({ where: { tenantId: tenant.id, name: 'Radar' } })).toBe(
      1
    );
    expect(await prisma.lostReason.count({ where: { tenantId: tenant.id } })).toBe(2);
  });

  // ── Criar demanda (E-13) ─────────────────────────────────────────────────────

  it('E-13: 10 chamadas simultâneas com a mesma chave_dedup geram um Negócio só', async () => {
    const corpo = corpoDemanda();
    const respostas = await Promise.all(Array.from({ length: 10 }, () => criarDemanda(corpo)));

    expect(respostas.filter((r) => r.status === 201)).toHaveLength(1);
    expect(respostas.filter((r) => r.status === 200)).toHaveLength(9);
    const ids = new Set(respostas.map((r) => r.body.engage_id));
    expect(ids.size).toBe(1);
    expect(respostas.filter((r) => r.body.repetido === true)).toHaveLength(9);

    const demandas = await prisma.demanda.findMany({
      where: { tenantId: base.tenant.id, chaveDedup: corpo.chave_dedup },
    });
    expect(demandas).toHaveLength(1);
    const [engageId] = [...ids];
    expect(demandas[0].dealId).toBe(engageId);
    // Nenhum Negócio órfão das transações perdedoras.
    const negocios = await prisma.deal.count({
      where: {
        tenantId: base.tenant.id,
        name: corpo.objeto,
        demanda: { chaveDedup: corpo.chave_dedup },
      },
    });
    expect(negocios).toBe(1);
    expect(await prisma.dealStageHistory.count({ where: { dealId: engageId as string } })).toBe(1);
  });

  it('E-13: cria Negócio e Demanda no funil do cenário, com os campos do contrato', async () => {
    const usuario = base.admin;
    const corpo = corpoDemanda({
      objeto: 'Orçamento para troca de bomba',
      valor_estimado: 85000,
      responsavel_email: usuario.email.toUpperCase(),
      link_original: 'https://sharepoint.exemplo.com/original.eml',
    });
    const res = await criarDemanda(corpo);
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(
      Object.keys(fixtures.engage_criar_demanda_resposta).sort()
    );
    expect(res.body.repetido).toBe(false);
    expect(res.body.engage_link).toBe(`https://engage.vydhub.com/app/deals/${res.body.engage_id}`);

    const deal = await prisma.deal.findUniqueOrThrow({
      where: { id: res.body.engage_id },
      include: { funnel: true, funnelColumn: true, source: true, demanda: true },
    });
    expect(deal.name).toBe('Orçamento para troca de bomba');
    expect(deal.value.toNumber()).toBe(85000);
    expect(deal.companyId).toBe(empresa.id);
    expect(deal.assignedTo).toBe(usuario.id);
    expect(deal.status).toBe('OPEN');
    expect(deal.funnel?.name).toBe('Contrato novo');
    expect(deal.funnelColumn?.capturaEstado).toBe('recebida');
    expect(deal.source?.name).toBe('Radar');
    expect(deal.demanda?.estado).toBe('recebida');
    expect(deal.demanda?.recebidoEmOrigem.toISOString()).toBe('2026-11-20T13:58:00.000Z');
    expect(deal.demanda?.capturadoEm.toISOString()).toBe('2026-11-20T14:00:10.000Z');
  });

  it('E-13: sem valor estimado, value = 0; sem usuário com o e-mail, sem responsável', async () => {
    const res = await criarDemanda(corpoDemanda({ responsavel_email: 'ninguem@exemplo.com' }));
    const deal = await prisma.deal.findUniqueOrThrow({ where: { id: res.body.engage_id } });
    expect(deal.value.toNumber()).toBe(0);
    expect(deal.assignedTo).toBeNull();
  });

  it('E-13: chamado_lta sem contrato_id dá 422 com o campo; dados inválidos também', async () => {
    const semContrato = await criarDemanda(corpoDemanda({ cenario: 'chamado_lta' }));
    expect(semContrato.status).toBe(422);
    expect(semContrato.body.campo).toBe('contrato_id');
    expect(semContrato.body.codigo).toBe('DADOS_INVALIDOS');
    expect(semContrato.body.mensagem).toBeTruthy();

    const semCliente = await criarDemanda({ ...corpoDemanda(), cliente_id: undefined });
    expect(semCliente.status).toBe(422);
    expect(semCliente.body.campo).toBe('cliente_id');

    const clienteDeOutro = await criarDemanda(corpoDemanda({ cliente_id: crypto.randomUUID() }));
    expect(clienteDeOutro.status).toBe(422);
    expect(clienteDeOutro.body.campo).toBe('cliente_id');
  });

  it('fixture engage_criar_demanda é aceita', async () => {
    const contrato = await novoContrato();
    const res = await criarDemanda({
      ...fixtures.engage_criar_demanda,
      chave_dedup: `email:<${unico('fixture')}@exemplo.com>`,
      cliente_id: empresa.id,
      contrato_id: contrato.id,
    });
    expect(res.status).toBe(201);
    const deal = await prisma.deal.findUniqueOrThrow({
      where: { id: res.body.engage_id },
      include: { funnel: true },
    });
    expect(deal.funnel?.name).toBe('Chamados');
  });

  // ── Escopos (E-18) ───────────────────────────────────────────────────────────

  describe('escopos (E-18)', () => {
    it('chave sem captura:write recebe 403, e chave legada de escopo vazio também', async () => {
      const soLeitura = await novaChave(base.tenant.id, ['contracts:read'], base.servico.id);
      const legada = await novaChave(base.tenant.id, [], base.servico.id);
      for (const chave of [soLeitura, legada]) {
        const res = await request(app)
          .post('/api/v1/captura/demandas')
          .set('X-API-Key', chave)
          .send(corpoDemanda());
        expect(res.status).toBe(403);
        expect(res.body.codigo).toBe('API_KEY_INSUFFICIENT_SCOPE');
      }
    });

    it('chave sem contracts:read não lê contratos nem clientes', async () => {
      const soEscrita = await novaChave(base.tenant.id, ['captura:write'], base.servico.id);
      const legada = await novaChave(base.tenant.id, [], null);
      for (const chave of [soEscrita, legada]) {
        expect((await request(app).get('/api/v1/contratos').set('X-API-Key', chave)).status).toBe(
          403
        );
        expect(
          (await request(app).get('/api/v1/captura/clientes?nome=x').set('X-API-Key', chave)).status
        ).toBe(403);
      }
    });

    it('sem chave dá 401; chave não ligada a usuário não escreve', async () => {
      expect((await request(app).post('/api/v1/captura/demandas').send({})).status).toBe(401);
      const semUsuario = await novaChave(base.tenant.id, ['captura:write'], null);
      const res = await request(app)
        .post('/api/v1/captura/demandas')
        .set('X-API-Key', semUsuario)
        .send(corpoDemanda());
      expect(res.status).toBe(403);
      expect(res.body.codigo).toBe('API_KEY_NOT_BOUND');
    });

    it('rota comercial atual segue recusando escrita por chave, mesmo com captura:write', async () => {
      const res = await request(app)
        .post('/api/v1/deals')
        .set('X-API-Key', chaveEscrita)
        .send({ name: 'x', value: 1 });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('API keys are read-only here');
    });
  });

  // ── Eventos (E-15) ───────────────────────────────────────────────────────────

  describe('eventos (E-15)', () => {
    it('HMAC: sem cabeçalho, assinatura errada ou fora da janela dão 401', async () => {
      const cru = JSON.stringify(evento('x', 'em_triagem', '2026-11-20T15:00:00Z'));
      const envia = () =>
        request(app).post('/api/v1/captura/eventos').set('Content-Type', 'application/json');

      expect((await envia().send(cru)).status).toBe(401);

      const agora = String(Math.floor(Date.now() / 1000));
      const errada = await envia()
        .set('X-VYD-Timestamp', agora)
        .set('X-VYD-Assinatura', `sha256=${'0'.repeat(64)}`)
        .send(cru);
      expect(errada.status).toBe(401);
      expect(errada.body.codigo).toBe('ASSINATURA_INVALIDA');

      const { assinarVyd } = await import('../utils/vydHmac.js');
      const velho = String(Math.floor(Date.now() / 1000) - 301);
      const fora = await envia()
        .set('X-VYD-Timestamp', velho)
        .set('X-VYD-Assinatura', assinarVyd(SEGREDO_EVENTOS, velho, cru))
        .send(cru);
      expect(fora.status).toBe(401);
      expect(fora.body.codigo).toBe('FORA_DA_JANELA');
    });

    it('autor ou motivo malformados não seguram o evento', async () => {
      const corpo = corpoDemanda();
      await criarDemanda(corpo);
      const res = await assinarEPostar(
        evento(corpo.chave_dedup, 'em_triagem', '2026-11-20T15:00:00Z', {
          autor_email: 'Não é E-mail',
          motivo: '   ',
        })
      );
      expect(res.status).toBe(200);
      expect(res.body.aplicado).toBe(true);
    });

    it('renomear o funil não quebra o evento: a coluna vem do funil atual', async () => {
      const { tenant } = await novoTenant();
      await servicos.garantirFunis(tenant.id);
      const funil = await prisma.funnel.findFirstOrThrow({
        where: { tenantId: tenant.id, name: 'Contrato novo' },
      });
      await prisma.funnel.update({ where: { id: funil.id }, data: { name: 'Funil renomeado' } });
      const { aplicarEvento, criarDemanda: criar } =
        await import('../services/captura/demandaService.js');
      const cliente = await novaEmpresa(tenant.id);
      const chave = unico('renomeado');
      // O primeiro create recria o funil pelo nome, mas o Negócio movido para o renomeado segue nele.
      const { engage_id } = await criar(tenant.id, {
        chave_dedup: chave,
        id_captura: crypto.randomUUID(),
        cenario: 'contrato_novo',
        fonte: 'x',
        nivel: 1,
        recebido_em_origem: new Date('2026-11-20T13:00:00Z'),
        capturado_em: new Date('2026-11-20T13:00:00Z'),
        cliente_id: cliente.id,
        objeto: 'x',
      });
      const colunaDoRenomeado = await prisma.funnelColumn.findFirstOrThrow({
        where: { funnelId: funil.id, capturaEstado: 'recebida' },
      });
      await prisma.deal.update({
        where: { id: engage_id },
        data: { funnelId: funil.id, funnelColumnId: colunaDoRenomeado.id },
      });
      await aplicarEvento(tenant.id, {
        evento_id: crypto.randomUUID(),
        chave_dedup: chave,
        estado: 'em_triagem',
        ocorrido_em: new Date('2026-11-20T15:00:00Z'),
      });
      const deal = await prisma.deal.findUniqueOrThrow({
        where: { id: engage_id },
        include: { funnelColumn: true },
      });
      expect(deal.funnelId).toBe(funil.id);
      expect(deal.funnelColumn?.capturaEstado).toBe('em_triagem');
    });

    it('demanda inexistente dá 409 com o código do contrato', async () => {
      const res = await assinarEPostar(
        evento('email:<nao-existe>', 'em_triagem', '2026-11-20T15:00:00Z')
      );
      expect(res.status).toBe(409);
      expect(res.body.codigo).toBe('DEMANDA_INEXISTENTE');
    });

    it('aplica a tabela M-04 estado a estado, e a fixture evento_estado é aceita', async () => {
      const corpo = corpoDemanda();
      const { body } = await criarDemanda(corpo);
      const id = body.engage_id as string;
      const chave = corpo.chave_dedup;

      const triagem = await assinarEPostar(evento(chave, 'em_triagem', '2026-11-20T15:00:00Z'));
      expect(triagem.status).toBe(200);
      expect(triagem.body).toEqual({ aplicado: true });

      let deal = await prisma.deal.findUniqueOrThrow({
        where: { id },
        include: { demanda: true, funnelColumn: true },
      });
      expect(deal.status).toBe('OPEN');
      expect(deal.demanda?.estado).toBe('em_triagem');
      expect(deal.demanda?.triagemEm?.toISOString()).toBe('2026-11-20T15:00:00.000Z');
      expect(deal.funnelColumn?.capturaEstado).toBe('em_triagem');

      await assinarEPostar(evento(chave, 'em_orcamento', '2026-11-21T10:00:00Z'));
      deal = await prisma.deal.findUniqueOrThrow({
        where: { id },
        include: { demanda: true, funnelColumn: true },
      });
      expect(deal.demanda?.orcamentoEm?.toISOString()).toBe('2026-11-21T10:00:00.000Z');
      expect(deal.stage).toBe('PROPOSAL');

      // Fixture do contrato, com `tipo`, que o Engage ignora.
      const doContrato = await assinarEPostar({
        ...fixtures.evento_estado,
        evento_id: crypto.randomUUID(),
        chave_dedup: chave,
      });
      expect(doContrato.status).toBe(200);
      expect(doContrato.body.aplicado).toBe(true);
      deal = await prisma.deal.findUniqueOrThrow({
        where: { id },
        include: { demanda: true, funnelColumn: true },
      });
      expect(deal.demanda?.estado).toBe('orcamento_enviado');
      expect(deal.demanda?.valorEnviado?.toNumber()).toBe(125000);
      expect(deal.demanda?.enviadoEm?.toISOString()).toBe('2026-11-22T14:03:00.000Z');
      expect(deal.demanda?.flowCardId).toBe(fixtures.evento_estado.flow_card_id);
      expect(deal.status).toBe('OPEN');

      await assinarEPostar(
        evento(chave, 'perdida', '2026-11-23T14:00:00Z', { motivo: 'Preço acima do concorrente' })
      );
      deal = await prisma.deal.findUniqueOrThrow({
        where: { id },
        include: { demanda: true, funnelColumn: true },
      });
      expect(deal.status).toBe('LOST');
      expect(deal.stage).toBe('LOST');
      expect(deal.lostReason).toBe('Preço acima do concorrente');
      expect(deal.lostAt?.toISOString()).toBe('2026-11-23T14:00:00.000Z');
      expect(deal.demanda?.encerradoEm?.toISOString()).toBe('2026-11-23T14:00:00.000Z');
      expect(deal.demanda?.motivo).toBe('Preço acima do concorrente');

      const historico = await prisma.dealStageHistory.findMany({
        where: { dealId: id },
        orderBy: { enteredAt: 'asc' },
      });
      expect(historico.map((h) => h.stage)).toEqual([
        'recebida',
        'em_triagem',
        'em_orcamento',
        'orcamento_enviado',
        'perdida',
      ]);
      expect(historico.filter((h) => h.exitedAt === null)).toHaveLength(1);
      expect(historico[historico.length - 1].exitedAt).toBeNull();
    });

    it('M-04: declinada e cancelada dão LOST com o motivo fixo; voltar a ativo limpa tudo', async () => {
      const corpo = corpoDemanda();
      const { body } = await criarDemanda(corpo);
      await assinarEPostar(
        evento(corpo.chave_dedup, 'declinada', '2026-11-20T15:00:00Z', { motivo: 'Fora da região' })
      );
      let deal = await prisma.deal.findUniqueOrThrow({
        where: { id: body.engage_id },
        include: { demanda: true, lostReasonRef: true },
      });
      expect(deal.status).toBe('LOST');
      expect(deal.lostReason).toBe('Declinada');
      expect(deal.lostReasonRef?.label).toBe('Declinada');
      expect(deal.demanda?.motivo).toBe('Fora da região');

      await assinarEPostar(evento(corpo.chave_dedup, 'cancelada', '2026-11-20T16:00:00Z'));
      deal = await prisma.deal.findUniqueOrThrow({
        where: { id: body.engage_id },
        include: { demanda: true, lostReasonRef: true },
      });
      expect(deal.lostReason).toBe('Cliente cancelou');

      await assinarEPostar(evento(corpo.chave_dedup, 'em_orcamento', '2026-11-20T17:00:00Z'));
      deal = await prisma.deal.findUniqueOrThrow({
        where: { id: body.engage_id },
        include: { demanda: true, lostReasonRef: true },
      });
      expect(deal.status).toBe('OPEN');
      expect(deal.lostReason).toBeNull();
      expect(deal.lostReasonId).toBeNull();
      expect(deal.lostAt).toBeNull();
      expect(deal.closedAt).toBeNull();
      expect(deal.demanda?.motivo).toBeNull();
      expect(deal.demanda?.encerradoEm).toBeNull();
    });

    it('evento fora de ordem entra no histórico e não regride o estado', async () => {
      const corpo = corpoDemanda();
      const { body } = await criarDemanda(corpo);
      await assinarEPostar(
        evento(corpo.chave_dedup, 'orcamento_enviado', '2026-11-22T14:00:00Z', {
          valor_enviado: 1000,
        })
      );

      const atrasado = await assinarEPostar(
        evento(corpo.chave_dedup, 'em_triagem', '2026-11-20T15:00:00Z')
      );
      expect(atrasado.status).toBe(200);
      expect(atrasado.body).toEqual({ aplicado: false });

      const deal = await prisma.deal.findUniqueOrThrow({
        where: { id: body.engage_id },
        include: { demanda: { include: { eventos: true } }, funnelColumn: true },
      });
      expect(deal.demanda?.estado).toBe('orcamento_enviado');
      expect(deal.funnelColumn?.capturaEstado).toBe('orcamento_enviado');
      expect(deal.demanda?.ultimoEventoEm?.toISOString()).toBe('2026-11-22T14:00:00.000Z');
      // A data de início não se perde: é a base da taxa de go.
      expect(deal.demanda?.triagemEm?.toISOString()).toBe('2026-11-20T15:00:00.000Z');
      expect(deal.demanda?.eventos).toHaveLength(2);
      expect(deal.demanda?.eventos.filter((e) => e.aplicado)).toHaveLength(1);
      // O atrasado não apaga nem troca o vínculo com o card que já existe.
      expect(deal.demanda?.flowCardId).not.toBeNull();

      const historico = await prisma.dealStageHistory.findMany({
        where: { dealId: body.engage_id },
        orderBy: { enteredAt: 'asc' },
      });
      expect(historico.map((h) => h.stage)).toEqual([
        'recebida',
        'em_triagem',
        'orcamento_enviado',
      ]);
      expect(historico[0].exitedAt?.toISOString()).toBe('2026-11-20T15:00:00.000Z');
      expect(historico[1].exitedAt?.toISOString()).toBe('2026-11-22T14:00:00.000Z');
      expect(historico[2].exitedAt).toBeNull();
    });

    it('evento repetido, em série e simultâneo, não duplica nem consome saldo duas vezes', async () => {
      const contrato = await novoContrato({ valorContratado: 500000 });
      const corpo = corpoDemanda({ cenario: 'chamado_lta', contrato_id: contrato.id });
      const { body } = await criarDemanda(corpo);

      const ganha = evento(corpo.chave_dedup, 'ganha', '2026-11-25T12:00:00Z', {
        valor_aprovado: 100000,
      });
      const respostas = await Promise.all(Array.from({ length: 8 }, () => assinarEPostar(ganha)));
      expect(respostas.every((r) => r.status === 200 && r.body.aplicado === true)).toBe(true);
      expect((await assinarEPostar(ganha)).body.aplicado).toBe(true);

      const movimentos = await prisma.contratoMovimento.findMany({
        where: { contratoId: contrato.id },
      });
      expect(movimentos).toHaveLength(1);
      expect(movimentos[0].tipo).toBe('CONSUMO');
      expect(movimentos[0].valor.toNumber()).toBe(100000);
      expect(movimentos[0].dealId).toBe(body.engage_id);
      expect(await saldoDe(contrato.id)).toBe(400000);

      const eventos = await prisma.demandaEvento.count({
        where: { tenantId: base.tenant.id, eventoId: ganha.evento_id },
      });
      expect(eventos).toBe(1);
    });

    it('E-17: descartada some dos relatórios e dos indicadores; a Demanda fica; voltar limpa', async () => {
      const { tenant } = base;
      const corpo = corpoDemanda({ objeto: `Descartável ${unico('x')}` });
      const { body } = await criarDemanda(corpo);
      const id = body.engage_id as string;

      await assinarEPostar(evento(corpo.chave_dedup, 'descartada', '2026-11-20T15:00:00Z'));

      const deal = await prisma.deal.findUniqueOrThrow({
        where: { id },
        include: { demanda: true },
      });
      expect(deal.deletedAt?.toISOString()).toBe('2026-11-20T15:00:00.000Z');
      expect(deal.funnelColumnId).toBeNull();
      expect(deal.demanda?.estado).toBe('descartada');

      // Relatórios comerciais: lista, estatísticas e quadro do funil.
      const lista = await servicos.dealService.findAll(tenant.id, { search: corpo.objeto });
      expect(lista.deals).toHaveLength(0);
      const quadro = await servicos.funnelService.findById(tenant.id, deal.funnelId as string);
      expect(quadro.columns.flatMap((c) => c.deals).map((d) => d.id)).not.toContain(id);
      await expect(servicos.dealService.findById(tenant.id, id)).rejects.toThrow('Deal not found');

      // Detalhe da empresa também não mostra o Negócio descartado.
      const daEmpresa = await servicos.companyService.findById(tenant.id, empresa.id);
      expect(daEmpresa.deals.map((d) => d.id)).not.toContain(id);

      // Lixeira: não aparece, não restaura, não expurga.
      const lixeira = await servicos.trash.listTrash(tenant.id, 'deals');
      expect(lixeira.items.map((i) => i.id)).not.toContain(id);
      await expect(servicos.trash.restoreItem(tenant.id, 'deals', id)).rejects.toThrow(
        'Andamento controlado pelo Flow'
      );
      await servicos.trash.purgeExpiredForEntity(tenant.id, 'deals', new Date('2030-01-01'));
      expect(await prisma.deal.count({ where: { id } })).toBe(1);

      // Volta a estado ativo.
      await assinarEPostar(evento(corpo.chave_dedup, 'em_triagem', '2026-11-20T16:00:00Z'));
      const voltou = await prisma.deal.findUniqueOrThrow({
        where: { id },
        include: { funnelColumn: true },
      });
      expect(voltou.deletedAt).toBeNull();
      expect(voltou.funnelColumn?.capturaEstado).toBe('em_triagem');
      expect(
        (await servicos.dealService.findAll(tenant.id, { search: corpo.objeto })).deals
      ).toHaveLength(1);
    });
  });

  // ── Saldo (E-06) ─────────────────────────────────────────────────────────────

  it('E-06: saldo com aditivo, ajuste negativo, consumo, reversão e novo valor', async () => {
    const contrato = await novoContrato({ valorContratado: 100000 });
    const movimento = (corpo: Record<string, unknown>) =>
      request(app)
        .post(`/api/v1/gestao-contratos/${contrato.id}/movimentos`)
        .set('Authorization', base.sessaoAdmin)
        .send(corpo);

    expect(await saldoDe(contrato.id)).toBe(100000);

    expect((await movimento({ tipo: 'ADITIVO', valor: 20000, motivo: 'Aditivo 1' })).status).toBe(
      201
    );
    expect(await saldoDe(contrato.id)).toBe(120000);

    // AJUSTE exige motivo e aceita negativo.
    const semMotivo = await movimento({ tipo: 'AJUSTE', valor: -5000 });
    expect(semMotivo.status).toBe(422);
    expect((await movimento({ tipo: 'AJUSTE', valor: -5000, motivo: 'Correção' })).status).toBe(
      201
    );
    expect(await saldoDe(contrato.id)).toBe(115000);

    // CONSUMO à mão é recusado: nasce do evento.
    expect((await movimento({ tipo: 'CONSUMO', valor: 1 })).status).toBe(422);

    const corpo = corpoDemanda({ cenario: 'chamado_lta', contrato_id: contrato.id });
    await criarDemanda(corpo);
    const chave = corpo.chave_dedup;

    // Consumo.
    await assinarEPostar(evento(chave, 'ganha', '2026-11-25T10:00:00Z', { valor_aprovado: 30000 }));
    expect(await saldoDe(contrato.id)).toBe(85000);

    // Saiu de ganha: compensa.
    await assinarEPostar(evento(chave, 'em_orcamento', '2026-11-25T11:00:00Z'));
    expect(await saldoDe(contrato.id)).toBe(115000);

    // Novo ganha com outro valor.
    await assinarEPostar(evento(chave, 'ganha', '2026-11-25T12:00:00Z', { valor_aprovado: 40000 }));
    expect(await saldoDe(contrato.id)).toBe(75000);

    // Ganha de novo, com valor diferente: ajusta só a diferença.
    await assinarEPostar(evento(chave, 'ganha', '2026-11-25T13:00:00Z', { valor_aprovado: 45000 }));
    expect(await saldoDe(contrato.id)).toBe(70000);

    // Valor acima do saldo: aceito, saldo negativo. Só alerta (D3).
    await assinarEPostar(
      evento(chave, 'ganha', '2026-11-25T14:00:00Z', { valor_aprovado: 200000 })
    );
    expect(await saldoDe(contrato.id)).toBe(-85000);

    const consumos = await prisma.contratoMovimento.findMany({
      where: { contratoId: contrato.id, tipo: 'CONSUMO' },
      orderBy: { createdAt: 'asc' },
    });
    expect(consumos.map((m) => m.valor.toNumber())).toEqual([30000, -30000, 40000, 5000, 155000]);
    // Movimento manual foi auditado.
    const auditoria = await prisma.auditLog.count({
      where: { tenantId: base.tenant.id, entityType: 'contrato_movimento' },
    });
    expect(auditoria).toBeGreaterThanOrEqual(2);
  });

  it('E-06: ganha sem valor não consome; ganha sem contrato não gera movimento', async () => {
    const contrato = await novoContrato({ valorContratado: 1000 });
    const lta = corpoDemanda({ cenario: 'chamado_lta', contrato_id: contrato.id });
    await criarDemanda(lta);
    const res = await assinarEPostar(evento(lta.chave_dedup, 'ganha', '2026-11-25T10:00:00Z'));
    expect(res.body.aplicado).toBe(true);
    expect(await prisma.contratoMovimento.count({ where: { contratoId: contrato.id } })).toBe(0);
    expect(await saldoDe(contrato.id)).toBe(1000);

    const novo = corpoDemanda();
    const { body } = await criarDemanda(novo);
    await assinarEPostar(
      evento(novo.chave_dedup, 'ganha', '2026-11-25T10:00:00Z', { valor_aprovado: 500 })
    );
    expect(await prisma.contratoMovimento.count({ where: { dealId: body.engage_id } })).toBe(0);
    const deal = await prisma.deal.findUniqueOrThrow({ where: { id: body.engage_id } });
    expect(deal.status).toBe('WON');
  });

  it('contrato sem valor: saldo não disponível', async () => {
    const contrato = await novoContrato({ valorContratado: null });
    const res = await request(app)
      .get(`/api/v1/gestao-contratos/${contrato.id}`)
      .set('Authorization', base.sessaoAdmin);
    expect(res.body.data.saldo).toBeNull();
    expect(res.body.data.saldoDisponivel).toBe(false);
    expect(res.body.data.lacunas).toContain('sem_valor');
  });

  // ── Atualizar demanda (E-14) ─────────────────────────────────────────────────

  describe('atualizar demanda (E-14)', () => {
    const patch = (id: string, corpo: Record<string, unknown>) =>
      request(app)
        .patch(`/api/v1/captura/demandas/${id}`)
        .set('X-API-Key', chaveEscrita)
        .send(corpo);

    it('grava vínculos, registra adendo sem repetir e não muda estado', async () => {
      const corpo = corpoDemanda();
      const { body } = await criarDemanda(corpo);
      const id = body.engage_id as string;
      const card = crypto.randomUUID();
      const adendo = { texto: 'Cliente reenviou com novo prazo', em: '2026-11-21T09:00:00Z' };

      const res = await patch(id, {
        flow_card_id: card,
        link_original: 'https://sharepoint.exemplo.com/original.eml',
        adendo,
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ engage_id: id, engage_link: body.engage_link });
      await patch(id, { adendo });

      const deal = await prisma.deal.findUniqueOrThrow({
        where: { id },
        include: { demanda: true, interactions: true },
      });
      expect(deal.demanda?.flowCardId).toBe(card);
      expect(deal.demanda?.linkOriginal).toBe('https://sharepoint.exemplo.com/original.eml');
      expect(deal.demanda?.estado).toBe('recebida');
      expect(deal.interactions.filter((i) => i.subject === 'Adendo do Radar')).toHaveLength(1);
    });

    it('não aceita estado: campos fora do contrato são ignorados', async () => {
      const { body } = await criarDemanda(corpoDemanda());
      const res = await patch(body.engage_id, { estado: 'ganha' });
      expect(res.status).toBe(200);
      const demanda = await prisma.demanda.findUniqueOrThrow({ where: { dealId: body.engage_id } });
      expect(demanda.estado).toBe('recebida');
    });

    it('reclassificação leva o mesmo Negócio ao outro funil, mantendo o histórico', async () => {
      const contrato = await novoContrato();
      const corpo = corpoDemanda();
      const { body } = await criarDemanda(corpo);
      const id = body.engage_id as string;
      await assinarEPostar(evento(corpo.chave_dedup, 'em_triagem', '2026-11-20T15:00:00Z'));

      // Chamado LTA precisa de contrato.
      const semContrato = await patch(id, { cenario: 'chamado_lta' });
      expect(semContrato.status).toBe(422);
      expect(semContrato.body.campo).toBe('contrato_id');

      const novoCard = crypto.randomUUID();
      const res = await patch(id, {
        cenario: 'chamado_lta',
        contrato_id: contrato.id,
        flow_card_id: novoCard,
      });
      expect(res.status).toBe(200);
      expect(res.body.engage_id).toBe(id);

      const deal = await prisma.deal.findUniqueOrThrow({
        where: { id },
        include: { demanda: true, funnel: true, funnelColumn: true, stageHistory: true },
      });
      expect(deal.funnel?.name).toBe('Chamados');
      expect(deal.funnelColumn?.capturaEstado).toBe('em_triagem');
      expect(deal.demanda?.cenario).toBe('chamado_lta');
      expect(deal.demanda?.contratoId).toBe(contrato.id);
      expect(deal.demanda?.flowCardId).toBe(novoCard);
      expect(deal.demanda?.estado).toBe('em_triagem');
      expect(deal.stageHistory.map((h) => h.stage).sort()).toEqual(['em_triagem', 'recebida']);
    });

    it('trocar o contrato de uma demanda ganha move o consumo; trocar o cliente fica no histórico', async () => {
      const a = await novoContrato({ valorContratado: 1000 });
      const b = await novoContrato({ valorContratado: 1000 });
      const corpo = corpoDemanda({ cenario: 'chamado_lta', contrato_id: a.id });
      const { body } = await criarDemanda(corpo);
      await assinarEPostar(
        evento(corpo.chave_dedup, 'ganha', '2026-11-25T10:00:00Z', { valor_aprovado: 300 })
      );
      expect(await saldoDe(a.id)).toBe(700);

      await patch(body.engage_id, { contrato_id: b.id });
      expect(await saldoDe(a.id)).toBe(1000);
      expect(await saldoDe(b.id)).toBe(700);

      const outra = await novaEmpresa(base.tenant.id);
      await patch(body.engage_id, { cliente_id: outra.id });
      const deal = await prisma.deal.findUniqueOrThrow({
        where: { id: body.engage_id },
        include: { interactions: true },
      });
      expect(deal.companyId).toBe(outra.id);
      expect(deal.interactions.some((i) => i.subject === 'Mudança de cliente')).toBe(true);
    });

    it('funciona também com demanda descartada, sem devolver coluna', async () => {
      const contrato = await novoContrato();
      const corpo = corpoDemanda();
      const { body } = await criarDemanda(corpo);
      await assinarEPostar(evento(corpo.chave_dedup, 'descartada', '2026-11-20T15:00:00Z'));
      const res = await patch(body.engage_id, { cenario: 'chamado_lta', contrato_id: contrato.id });
      expect(res.status).toBe(200);
      const deal = await prisma.deal.findUniqueOrThrow({ where: { id: body.engage_id } });
      expect(deal.funnelColumnId).toBeNull();
      expect(deal.deletedAt).not.toBeNull();
    });

    it('id desconhecido dá 404 com código', async () => {
      const res = await patch(crypto.randomUUID(), { flow_card_id: crypto.randomUUID() });
      expect(res.status).toBe(404);
      expect(res.body.codigo).toBe('DEMANDA_NAO_ENCONTRADA');
    });
  });

  // ── Via única (E-16) ─────────────────────────────────────────────────────────

  describe('via única (E-16)', () => {
    let id: string;
    let funilId: string;
    let colunaAtual: string;
    let outraColuna: string;

    beforeAll(async () => {
      const { body } = await criarDemanda(corpoDemanda({ valor_estimado: 10 }));
      id = body.engage_id;
      const deal = await prisma.deal.findUniqueOrThrow({
        where: { id },
        include: { funnel: { include: { columns: true } } },
      });
      funilId = deal.funnelId as string;
      colunaAtual = deal.funnelColumnId as string;
      outraColuna = (deal.funnel?.columns.find((c) => c.id !== colunaAtual) as { id: string }).id;
    });

    const sessao = (req: request.Test) => req.set('Authorization', base.sessaoAdmin);

    it('API recusa com 403 toda mudança de etapa, status e exclusão', async () => {
      const tentativas: Array<request.Test> = [
        sessao(request(app).put(`/api/v1/deals/${id}`)).send({ stage: 'WON' }),
        sessao(request(app).put(`/api/v1/deals/${id}`)).send({ funnelColumnId: outraColuna }),
        sessao(request(app).post(`/api/v1/deals/${id}/win`)).send(),
        sessao(request(app).post(`/api/v1/deals/${id}/lose`)).send({
          lostReasonId: crypto.randomUUID(),
        }),
        sessao(request(app).post(`/api/v1/deals/${id}/pause`)).send(),
        sessao(request(app).post(`/api/v1/deals/${id}/resume`)).send(),
        sessao(request(app).delete(`/api/v1/deals/${id}`)).send(),
        sessao(request(app).post('/api/v1/funnels/move-deal')).send({
          dealId: id,
          targetColumnId: outraColuna,
          position: 0,
        }),
      ];
      for (const tentativa of tentativas) {
        const res = await tentativa;
        expect(res.status).toBe(403);
        expect(res.body.error).toBe('Andamento controlado pelo Flow');
      }
      const deal = await prisma.deal.findUniqueOrThrow({ where: { id } });
      expect(deal.status).toBe('OPEN');
      expect(deal.funnelColumnId).toBe(colunaAtual);
      expect(deal.deletedAt).toBeNull();
    });

    it('marcar perdida sem motivo também recebe a recusa da via única', async () => {
      const res = await sessao(request(app).put(`/api/v1/deals/${id}`)).send({ stage: 'LOST' });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Andamento controlado pelo Flow');
    });

    it('o formulário inteiro, sem mudar a etapa, passa; notas continuam livres', async () => {
      const deal = await prisma.deal.findUniqueOrThrow({ where: { id } });
      const res = await sessao(request(app).put(`/api/v1/deals/${id}`)).send({
        name: deal.name,
        value: 10,
        stage: deal.stage,
        funnelId: funilId,
        notes: 'Anotação livre',
      });
      expect(res.status).toBe(200);
      expect(res.body.notes).toBe('Anotação livre');
    });

    it('reordenar na mesma coluna é livre', async () => {
      const res = await sessao(request(app).post('/api/v1/funnels/move-deal')).send({
        dealId: id,
        targetColumnId: colunaAtual,
        position: 0,
      });
      expect(res.status).toBe(200);
    });

    it('a tela recebe o que precisa para o aviso', async () => {
      const res = await sessao(request(app).get(`/api/v1/deals/${id}`));
      expect(res.body.demanda.estado).toBe('recebida');
    });

    it('Negócio comum não muda de comportamento', async () => {
      const comum = await servicos.dealService.create(base.tenant.id, { name: 'Comum', value: 1 });
      const res = await sessao(request(app).post(`/api/v1/deals/${comum.id}/win`)).send();
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('WON');
    });
  });

  // ── Cadastro de contratos (E-01 a E-07) ──────────────────────────────────────

  describe('cadastro de contratos', () => {
    const post = (caminho: string, corpo: Record<string, unknown>, sessao = base.sessaoAdmin) =>
      request(app)
        .post(`/api/v1/gestao-contratos${caminho}`)
        .set('Authorization', sessao)
        .send(corpo);

    it('dois contratos no mesmo cliente, com solicitantes e itens', async () => {
      const cliente = await novaEmpresa(base.tenant.id);
      const a = await post('', {
        companyId: cliente.id,
        numero: unico('CT-A'),
        tipo: 'LTA',
        vigenciaInicio: '2026-01-01',
        vigenciaFim: '2027-12-31',
        valorContratado: 2000000,
        slaRespostaHoras: 24,
        gerenteNome: 'Gerente',
        gerenteEmail: 'GERENTE@Exemplo.com',
      });
      const b = await post('', {
        companyId: cliente.id,
        numero: unico('CT-B'),
        tipo: 'GUARDA_CHUVA',
      });
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(a.body.data.gerenteEmail).toBe('gerente@exemplo.com');

      const idA = a.body.data.id as string;
      expect(
        (await post(`/${idA}/solicitantes`, { nome: 'Fiscal', email: 'Fiscal@Cliente.com.br' }))
          .status
      ).toBe(201);
      // Mesmo solicitante com maiúsculas e minúsculas: normalizado e recusado.
      const repetido = await post(`/${idA}/solicitantes`, { email: 'FISCAL@cliente.com.BR' });
      expect(repetido.status).toBe(409);
      expect(
        (await post(`/${idA}/itens`, { descricao: 'Mecânica', disciplina: 'Mecânica' })).status
      ).toBe(201);

      const lista = await request(app)
        .get(`/api/v1/gestao-contratos?companyId=${cliente.id}`)
        .set('Authorization', base.sessaoAdmin);
      expect(lista.body.data.itens).toHaveLength(2);
      const detalhe = await request(app)
        .get(`/api/v1/gestao-contratos/${idA}`)
        .set('Authorization', base.sessaoAdmin);
      expect(detalhe.body.data.solicitantes).toHaveLength(1);
      expect(detalhe.body.data.solicitantes[0].email).toBe('fiscal@cliente.com.br');
      expect(detalhe.body.data.itens).toHaveLength(1);
      expect(detalhe.body.data.lacunas).toEqual([]);

      const semNada = lista.body.data.itens.find((c: { id: string }) => c.id === b.body.data.id);
      expect(semNada.lacunas).toEqual(['sem_solicitantes', 'sem_sla', 'sem_valor', 'sem_gerente']);
    });

    it('numero é normalizado e o repetido dá 409 com o contrato existente', async () => {
      const cliente = await novaEmpresa(base.tenant.id);
      const numero = unico('E2180');
      const a = await post('', { companyId: cliente.id, numero: `${numero}          ` });
      expect(a.body.data.numero).toBe(numero);
      const b = await post('', { companyId: cliente.id, numero: `\t${numero}\t` });
      expect(b.status).toBe(409);
      expect(b.body.code).toBe('CONTRATO_NUMERO_REPETIDO');
      expect(b.body.error).toContain(numero);
      expect(b.body.existente.id).toBe(a.body.data.id);
      expect(b.body.existente.company.id).toBe(cliente.id);
    });

    it('só ADMIN e GESTOR editam; os demais só leem', async () => {
      const cliente = await novaEmpresa(base.tenant.id);
      const contrato = await novoContrato({ companyId: cliente.id });
      const negado = await post(
        '',
        { companyId: cliente.id, numero: unico('N') },
        base.sessaoLeitor
      );
      expect(negado.status).toBe(403);
      const lido = await request(app)
        .get(`/api/v1/gestao-contratos/${contrato.id}`)
        .set('Authorization', base.sessaoLeitor);
      expect(lido.status).toBe(200);
      const movimentoNegado = await post(
        `/${contrato.id}/movimentos`,
        { tipo: 'ADITIVO', valor: 1 },
        base.sessaoLeitor
      );
      expect(movimentoNegado.status).toBe(403);
    });

    it('empresa com contrato não é excluída; apagar o tenant inteiro segue funcionando', async () => {
      const t = await novoTenant();
      const cliente = await novaEmpresa(t.tenant.id);
      await request(app)
        .post('/api/v1/gestao-contratos')
        .set('Authorization', t.sessaoAdmin)
        .send({ companyId: cliente.id, numero: 'C-1', valorContratado: 100 });
      await expect(servicos.companyService.delete(t.tenant.id, cliente.id)).rejects.toMatchObject({
        statusCode: 400,
        code: 'COMPANY_HAS_RELATIONS',
      });

      // A FK de Demanda para Deal não cascateia, mas a do tenant apaga tudo no mesmo comando.
      const { criarDemanda: criar } = await import('../services/captura/demandaService.js');
      const contrato = await prisma.contrato.findFirstOrThrow({ where: { tenantId: t.tenant.id } });
      await criar(t.tenant.id, {
        chave_dedup: unico('apaga'),
        id_captura: crypto.randomUUID(),
        cenario: 'chamado_lta',
        fonte: 'x',
        nivel: 1,
        recebido_em_origem: new Date('2026-11-20T13:00:00Z'),
        capturado_em: new Date('2026-11-20T13:00:00Z'),
        cliente_id: cliente.id,
        contrato_id: contrato.id,
        objeto: 'x',
      });
      await prisma.tenant.delete({ where: { id: t.tenant.id } });
      expect(await prisma.contrato.count({ where: { tenantId: t.tenant.id } })).toBe(0);
      expect(await prisma.demanda.count({ where: { tenantId: t.tenant.id } })).toBe(0);
    });

    it('filtro por lacuna; contrato excluído mantém o vínculo das demandas', async () => {
      const cliente = await novaEmpresa(base.tenant.id);
      const contrato = await novoContrato({ companyId: cliente.id, valorContratado: null });
      const filtrado = await request(app)
        .get(`/api/v1/gestao-contratos?companyId=${cliente.id}&lacuna=sem_valor`)
        .set('Authorization', base.sessaoAdmin);
      expect(filtrado.body.data.itens.map((c: { id: string }) => c.id)).toContain(contrato.id);

      const corpo = corpoDemanda({
        cenario: 'chamado_lta',
        contrato_id: contrato.id,
        cliente_id: cliente.id,
      });
      const { body } = await criarDemanda(corpo);
      const excluiu = await request(app)
        .delete(`/api/v1/gestao-contratos/${contrato.id}`)
        .set('Authorization', base.sessaoAdmin);
      expect(excluiu.status).toBe(200);
      const demanda = await prisma.demanda.findUniqueOrThrow({ where: { dealId: body.engage_id } });
      expect(demanda.contratoId).toBe(contrato.id);
      // Demanda nova não aponta para contrato excluído.
      const nova = await criarDemanda(
        corpoDemanda({ cenario: 'chamado_lta', contrato_id: contrato.id })
      );
      expect(nova.status).toBe(422);
    });
  });

  // ── Leitura (E-19) ───────────────────────────────────────────────────────────

  describe('leitura de máquina (E-19)', () => {
    it('lista com saldo, solicitantes, itens, empresa, excluídos e paginação', async () => {
      const { tenant, admin, sessaoAdmin, servico } = await novoTenant();
      const chave = await novaChave(tenant.id, ['contracts:read'], servico.id);
      const cliente = await novaEmpresa(tenant.id, {
        cnpj: '12.345.678/0001-90',
        domain: 'cliente.com.br',
      });
      const criar = (numero: string, extra = {}) =>
        request(app)
          .post('/api/v1/gestao-contratos')
          .set('Authorization', sessaoAdmin)
          .send({ companyId: cliente.id, numero, ...extra });

      const a = (await criar('A', { valorContratado: 100, numeroCliente: '46', tipo: 'LTA' })).body
        .data;
      await request(app)
        .post(`/api/v1/gestao-contratos/${a.id}/solicitantes`)
        .set('Authorization', sessaoAdmin)
        .send({ nome: 'F', email: 'f@cliente.com.br' });
      await request(app)
        .post(`/api/v1/gestao-contratos/${a.id}/itens`)
        .set('Authorization', sessaoAdmin)
        .send({ descricao: 'Item', disciplina: 'Mecânica' });
      const b = (await criar('B')).body.data;
      const c = (await criar('C')).body.data;
      await request(app)
        .delete(`/api/v1/gestao-contratos/${c.id}`)
        .set('Authorization', sessaoAdmin);
      expect(admin.id).toBeTruthy();

      const pagina1 = await request(app).get('/api/v1/contratos?limite=2').set('X-API-Key', chave);
      expect(pagina1.status).toBe(200);
      expect(pagina1.body.itens).toHaveLength(2);
      expect(pagina1.body.proximo_cursor).toBeTruthy();
      const pagina2 = await request(app)
        .get(`/api/v1/contratos?limite=2&cursor=${pagina1.body.proximo_cursor}`)
        .set('X-API-Key', chave);
      expect(pagina2.body.itens).toHaveLength(1);
      expect(pagina2.body.proximo_cursor).toBeNull();

      const todos = [...pagina1.body.itens, ...pagina2.body.itens];
      expect(new Set(todos.map((i) => i.id)).size).toBe(3);

      const itemA = todos.find((i) => i.id === a.id);
      expect(Object.keys(itemA).sort()).toEqual(
        Object.keys(fixtures.contratos_lista.itens[0]).sort()
      );
      expect(Object.keys(itemA.cliente).sort()).toEqual(
        Object.keys(fixtures.contratos_lista.itens[0].cliente).sort()
      );
      expect(itemA.saldo).toBe(100);
      expect(itemA.saldo_disponivel).toBe(true);
      expect(itemA.cliente.cnpj).toBe('12345678000190');
      expect(itemA.solicitantes).toEqual([{ nome: 'F', email: 'f@cliente.com.br' }]);
      expect(itemA.itens).toEqual([{ descricao: 'Item', disciplina: 'Mecânica' }]);

      const itemB = todos.find((i) => i.id === b.id);
      expect(itemB.saldo).toBeNull();
      expect(itemB.saldo_disponivel).toBe(false);
      expect(todos.find((i) => i.id === c.id).excluido_em).toBeTruthy();

      // atualizado_desde enxerga a mudança de saldo.
      const corte = new Date(Date.now() + 1000);
      await new Promise((r) => setTimeout(r, 1100));
      await request(app)
        .post(`/api/v1/gestao-contratos/${a.id}/movimentos`)
        .set('Authorization', sessaoAdmin)
        .send({ tipo: 'ADITIVO', valor: 50, motivo: 'x' });
      const depois = await request(app)
        .get(`/api/v1/contratos?atualizado_desde=${corte.toISOString()}`)
        .set('X-API-Key', chave);
      expect(depois.body.itens.map((i: { id: string }) => i.id)).toEqual([a.id]);
      expect(depois.body.itens[0].saldo).toBe(150);

      // Não vaza contrato de outro tenant.
      expect(
        (await request(app).get('/api/v1/contratos').set('X-API-Key', chaveEscrita)).body.itens.map(
          (i: { id: string }) => i.id
        )
      ).not.toContain(a.id);
    });

    it('busca de cliente: do casamento mais forte para o mais fraco, com o motivo', async () => {
      const { tenant, servico } = await novoTenant();
      const chave = await novaChave(tenant.id, ['contracts:read'], servico.id);
      const porCnpj = await novaEmpresa(tenant.id, { name: 'Alfa', cnpj: '12.345.678/0001-90' });
      const porDominio = await novaEmpresa(tenant.id, {
        name: 'Beta',
        website: 'https://www.beta.com.br/x',
      });
      const porNome = await novaEmpresa(tenant.id, { name: 'Gama Alfa' });
      await novaEmpresa(tenant.id, { name: 'Excluída Alfa', deletedAt: new Date() });

      const res = await request(app)
        .get('/api/v1/captura/clientes')
        .query({ cnpj: '12345678000190', dominio: 'contato@beta.com.br', nome: 'alfa' })
        .set('X-API-Key', chave);
      expect(res.status).toBe(200);
      expect(
        res.body.candidatos.map((c: { id: string; motivo: string }) => [c.id, c.motivo])
      ).toEqual([
        [porCnpj.id, 'cnpj'],
        [porDominio.id, 'dominio'],
        [porNome.id, 'nome'],
      ]);
      expect(Object.keys(res.body.candidatos[0]).sort()).toEqual(
        Object.keys(fixtures.clientes_busca.candidatos[0]).sort()
      );

      const vazio = await request(app).get('/api/v1/captura/clientes').set('X-API-Key', chave);
      expect(vazio.status).toBe(422);
    });
  });

  // ── Espelho (E-10) ───────────────────────────────────────────────────────────

  describe('espelho para o Flow (E-10)', () => {
    let servidor: Server;
    let recebidos: Array<{ headers: IncomingMessage['headers']; corpo: string }>;
    const FLOW_ID = crypto.randomUUID();

    beforeAll(async () => {
      recebidos = [];
      servidor = createServer((req: IncomingMessage, res: ServerResponse) => {
        let corpo = '';
        req.on('data', (p) => (corpo += p));
        req.on('end', () => {
          recebidos.push({ headers: req.headers, corpo });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ flow_record_id: FLOW_ID }));
        });
      });
      await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
    });

    afterAll(async () => {
      await new Promise((r) => servidor.close(r));
    });

    async function esperar(condicao: () => Promise<boolean> | boolean, ms = 5000) {
      const limite = Date.now() + ms;
      while (Date.now() < limite) {
        if (await condicao()) return;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error('tempo esgotado esperando a entrega do espelho');
    }

    it('criar, alterar e excluir atualizam o mesmo registro, com a assinatura do contrato', async () => {
      const { tenant, sessaoAdmin } = await novoTenant();
      const segredo = 'segredo-do-espelho';
      await prisma.webhook.create({
        data: {
          tenantId: tenant.id,
          url: `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/espelho`,
          events: ['contract.created', 'contract.updated', 'contract.deleted'],
          secret: segredo,
        },
      });
      const cliente = await novaEmpresa(tenant.id, { name: 'Cliente do Espelho' });

      const criado = await request(app)
        .post('/api/v1/gestao-contratos')
        .set('Authorization', sessaoAdmin)
        .send({
          companyId: cliente.id,
          numero: 'CT-0042',
          gerenteNome: 'G',
          gerenteEmail: 'g@e.com',
        });
      const id = criado.body.data.id as string;
      await esperar(() => recebidos.length === 1);
      await esperar(async () => {
        const c = await prisma.contrato.findUniqueOrThrow({ where: { id } });
        return c.flowRecordId === FLOW_ID;
      });

      const primeiro = recebidos[0];
      const corpo = JSON.parse(primeiro.corpo);
      expect(primeiro.headers['x-webhook-event']).toBe('contract.created');
      expect(primeiro.headers['x-webhook-delivery-id']).toBeTruthy();
      expect(primeiro.headers['x-webhook-signature']).toBe(
        crypto.createHmac('sha256', segredo).update(primeiro.corpo).digest('hex')
      );
      expect(Object.keys(corpo).sort()).toEqual(['data', 'event', 'timestamp']);
      expect(Object.keys(corpo.data).sort()).toEqual(
        Object.keys(fixtures.espelho_contrato.data).sort()
      );
      expect(corpo.data).toMatchObject({
        id,
        flow_record_id: null,
        codigo: 'CT-0042',
        cliente: 'Cliente do Espelho',
        gerente_email: 'g@e.com',
        ativo: true,
      });

      await request(app)
        .put(`/api/v1/gestao-contratos/${id}`)
        .set('Authorization', sessaoAdmin)
        .send({ gerenteNome: 'Outro' });
      await esperar(() => recebidos.length === 2);
      const segundo = JSON.parse(recebidos[1].corpo);
      expect(segundo.event).toBe('contract.updated');
      expect(segundo.data.flow_record_id).toBe(FLOW_ID);
      expect(segundo.data.gerente_nome).toBe('Outro');

      // Renomear a empresa propaga, porque o espelho leva o nome do cliente.
      await servicos.companyService.update(tenant.id, { id: cliente.id, name: 'Novo Nome' });
      await esperar(() => recebidos.length === 3);
      expect(JSON.parse(recebidos[2].corpo).data.cliente).toBe('Novo Nome');

      await request(app).delete(`/api/v1/gestao-contratos/${id}`).set('Authorization', sessaoAdmin);
      await esperar(() => recebidos.length === 4);
      const ultimo = JSON.parse(recebidos[3].corpo);
      expect(ultimo.event).toBe('contract.deleted');
      expect(ultimo.data.ativo).toBe(false);
      expect(ultimo.data.flow_record_id).toBe(FLOW_ID);

      const final = await prisma.contrato.findUniqueOrThrow({ where: { id } });
      expect(final.flowRecordId).toBe(FLOW_ID);
    });

    it('contrato que já tem flowRecordId não troca pelo que o Flow devolver', async () => {
      const { tenant, sessaoAdmin } = await novoTenant();
      await prisma.webhook.create({
        data: {
          tenantId: tenant.id,
          url: `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/espelho`,
          events: ['contract.updated'],
          secret: 's',
        },
      });
      const cliente = await novaEmpresa(tenant.id);
      const original = crypto.randomUUID();
      const contrato = await prisma.contrato.create({
        data: { tenantId: tenant.id, companyId: cliente.id, numero: 'X', flowRecordId: original },
      });
      const antes = recebidos.length;
      await request(app)
        .put(`/api/v1/gestao-contratos/${contrato.id}`)
        .set('Authorization', sessaoAdmin)
        .send({ objeto: 'novo' });
      await esperar(() => recebidos.length === antes + 1);
      await new Promise((r) => setTimeout(r, 100));
      const final = await prisma.contrato.findUniqueOrThrow({ where: { id: contrato.id } });
      expect(final.flowRecordId).toBe(original);
    });
  });

  // ── Campos da empresa (E-08) ─────────────────────────────────────────────────

  describe('alertas e campos da empresa (E-08)', () => {
    const emDias = (dias: number) => {
      const agora = new Date();
      return new Date(
        Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate() + dias)
      );
    };
    const alertas = (tenantId: string, companyId: string) =>
      prisma.notification
        .findMany({ where: { tenantId, type: 'CONTRACT_EXPIRING' } })
        .then((lista) =>
          lista.filter(
            (n) => (n.metadata as { companyId?: string } | null)?.companyId === companyId
          )
        );

    it('CONCORRENTE segue igual; contrato NOS não alerta duas vezes', async () => {
      const { tenant, admin } = await novoTenant();
      const concorrente = await novaEmpresa(tenant.id, {
        contractHolder: 'CONCORRENTE',
        contractCompetitor: 'Rival',
        contractEndDate: emDias(20),
      });
      const nosSemContrato = await novaEmpresa(tenant.id, {
        contractHolder: 'NOS',
        contractEndDate: emDias(20),
      });
      const nosComContrato = await novaEmpresa(tenant.id, {
        contractHolder: 'NOS',
        contractEndDate: emDias(20),
      });
      const contrato = await prisma.contrato.create({
        data: {
          tenantId: tenant.id,
          companyId: nosComContrato.id,
          numero: 'NOS-1',
          vigenciaFim: emDias(20),
        },
      });

      await servicos.checarContratos();
      await servicos.checarContratos();

      const doConcorrente = await alertas(tenant.id, concorrente.id);
      expect(doConcorrente).toHaveLength(1); // um gestor no tenant e nenhum dono: 1 alerta, sem repetir
      expect((doConcorrente[0].metadata as { contratoId?: string }).contratoId).toBeUndefined();
      expect(doConcorrente.every((n) => n.link === `/app/companies/${concorrente.id}`)).toBe(true);

      expect(await alertas(tenant.id, nosSemContrato.id)).toHaveLength(1);

      const doContrato = await alertas(tenant.id, nosComContrato.id);
      expect(doContrato).toHaveLength(1);
      expect(
        doContrato.every((n) => (n.metadata as { contratoId?: string }).contratoId === contrato.id)
      ).toBe(true);
      expect(doContrato.map((n) => n.userId)).toContain(admin.id);

      // Widget: cada contrato aparece uma vez, e a empresa NOS com contrato sai por um lado só.
      const { companies } = await servicos.companyService.findExpiringContracts(tenant.id);
      expect(companies.filter((c) => c.id === nosComContrato.id)).toHaveLength(1);
      expect(companies.find((c) => c.id === nosComContrato.id)?.contrato?.numero).toBe('NOS-1');
      expect(companies.find((c) => c.id === concorrente.id)?.contrato).toBeNull();
      expect(companies.find((c) => c.id === nosSemContrato.id)?.contrato).toBeNull();
    });

    it('contrato sem vigência não silencia os campos antigos', async () => {
      const { tenant } = await novoTenant();
      const nos = await novaEmpresa(tenant.id, {
        contractHolder: 'NOS',
        contractEndDate: emDias(20),
      });
      await prisma.contrato.create({
        data: { tenantId: tenant.id, companyId: nos.id, numero: 'SEM-VIGENCIA' },
      });
      await servicos.checarContratos();
      const lista = await alertas(tenant.id, nos.id);
      expect(lista).toHaveLength(1);
      expect((lista[0].metadata as { contratoId?: string }).contratoId).toBeUndefined();
      const { companies } = await servicos.companyService.findExpiringContracts(tenant.id);
      expect(companies.filter((c) => c.id === nos.id)).toHaveLength(1);
    });

    it('alerta já dado pelos campos da empresa não repete depois da semeadura', async () => {
      const { tenant } = await novoTenant();
      const empresaNos = await novaEmpresa(tenant.id, {
        contractHolder: 'NOS',
        contractEndDate: emDias(20),
      });
      await servicos.checarContratos();
      const antes = (await alertas(tenant.id, empresaNos.id)).length;
      expect(antes).toBeGreaterThan(0);

      await prisma.contrato.create({
        data: {
          tenantId: tenant.id,
          companyId: empresaNos.id,
          numero: 'SEM-1',
          vigenciaFim: emDias(20),
        },
      });
      await servicos.checarContratos();
      expect(await alertas(tenant.id, empresaNos.id)).toHaveLength(antes);
    });
  });

  // ── Semeadura (E-09) ─────────────────────────────────────────────────────────

  describe('semeadura (E-09)', () => {
    it('duas rodadas: a segunda não muda nada; relatório conferido; conflitos recusados', async () => {
      const { tenant, admin } = await novoTenant();
      const a = await novaEmpresa(tenant.id, { name: 'SAMARCO - UBU' });
      const b = await novaEmpresa(tenant.id);
      const nos = await novaEmpresa(tenant.id, {
        contractHolder: 'NOS',
        contractStartDate: new Date('2026-01-01'),
        contractEndDate: new Date('2027-01-01'),
        contractValue: 5000,
        contractScope: 'Escopo antigo',
      });
      await novaEmpresa(tenant.id, { contractHolder: 'CONCORRENTE', contractCompetitor: 'Rival' });

      const flow1 = crypto.randomUUID();
      const flow2 = crypto.randomUUID();
      const flow3 = crypto.randomUUID();
      const flow4 = crypto.randomUUID();
      const flow5 = crypto.randomUUID();
      const csv = [
        'flow_record_id;codigo;company_id;tipo;vigencia_inicio;vigencia_fim;valor_contratado;consumo_inicial;sla_resposta_horas;gerente_nome;gerente_email;planejador_nome;planejador_email;solicitantes;itens',
        `${flow1};"E2180          ";${a.id};LTA;01/04/2025;2027-03-31;"2.000.000,00";"1.940.000,00";24;Gerente;GERENTE@Exemplo.com;;;"Fiscal <FISCAL@cliente.com.br>; outro@cliente.com.br; fiscal@cliente.com.br";"Manutenção mecânica | Mecânica; Elétrica"`,
        // Sem gerente: aceito, com lacuna. Código com tabulação no fim.
        `${flow2};"G0025\t";${b.id};;;;;;;;;;;;`,
        // Conflito depois de normalizar: os dois são recusados, sem escolher.
        `${flow3};"X100 ";${a.id};;;;;;;;;;;;`,
        `${flow4};" X100";${b.id};;;;;;;;;;;;`,
        // Empresa que não existe neste tenant.
        `${flow5};Z1;${crypto.randomUUID()};;;;;;;;;;;;`,
        // E-mail inválido e empresa em branco.
        `${crypto.randomUUID()};Z2;${a.id};;;;;;;;bad-email;;;;`,
        `${crypto.randomUUID()};Z3;;;;;;;;;;;;;`,
      ].join('\n');

      const fotografia = async () =>
        JSON.stringify(
          await prisma.contrato.findMany({
            where: { tenantId: tenant.id },
            orderBy: { numero: 'asc' },
            include: {
              solicitantes: { orderBy: { email: 'asc' } },
              itens: { orderBy: { descricao: 'asc' } },
              movimentos: { orderBy: { createdAt: 'asc' } },
            },
          })
        );

      // Ensaio seco não grava.
      const seco = await servicos.semear({
        tenantId: tenant.id,
        linhas: servicos.lerCsv(csv),
        seco: true,
        autorId: admin.id,
      });
      expect(seco.criados.length).toBeGreaterThan(0);
      expect(await prisma.contrato.count({ where: { tenantId: tenant.id } })).toBe(0);

      const r1 = await servicos.semear({
        tenantId: tenant.id,
        linhas: servicos.lerCsv(csv),
        autorId: admin.id,
      });
      expect(r1.linhasLidas).toBe(7);
      expect(r1.criados.map((c) => [c.numero, c.origem]).sort()).toEqual(
        [
          ['E2180', 'planilha'],
          ['G0025', 'planilha'],
          [`ENGAGE-${nos.id.slice(0, 8).toUpperCase()}`, 'empresa'],
        ].sort()
      );
      const motivos = Object.fromEntries(r1.recusados.map((m) => [`${m.linha}`, m.motivo]));
      expect(r1.recusados).toHaveLength(5);
      expect(motivos['4']).toContain('repetido');
      expect(motivos['5']).toContain('repetido');
      expect(motivos['6']).toContain('não encontrada');
      expect(motivos['7']).toContain('gerente_email');
      expect(motivos['8']).toContain('company_id vazio');
      expect(r1.saldosDeAbertura).toEqual([{ numero: 'E2180', valor: '1940000.00' }]);
      expect(r1.lacunas.find((l) => l.numero === 'G0025')?.lacunas).toEqual([
        'sem_solicitantes',
        'sem_sla',
        'sem_valor',
        'sem_gerente',
      ]);
      expect(r1.lacunas.find((l) => l.numero === 'E2180')).toBeUndefined();

      const e2180 = await prisma.contrato.findFirstOrThrow({
        where: { tenantId: tenant.id, numero: 'E2180' },
        include: { solicitantes: true, itens: true, movimentos: true },
      });
      expect(e2180.flowRecordId).toBe(flow1);
      expect(e2180.gerenteEmail).toBe('gerente@exemplo.com');
      expect(e2180.vigenciaInicio?.toISOString().slice(0, 10)).toBe('2025-04-01');
      expect(e2180.valorContratado?.toNumber()).toBe(2000000);
      expect(e2180.solicitantes.map((s) => s.email).sort()).toEqual([
        'fiscal@cliente.com.br',
        'outro@cliente.com.br',
      ]);
      expect(e2180.itens.map((i) => [i.descricao, i.disciplina])).toEqual(
        expect.arrayContaining([
          ['Manutenção mecânica', 'Mecânica'],
          ['Elétrica', null],
        ])
      );
      expect(e2180.movimentos).toHaveLength(1);
      expect(e2180.movimentos[0].tipo).toBe('CONSUMO');
      expect(e2180.movimentos[0].motivo).toBe('Saldo de abertura');
      expect(e2180.movimentos[0].valor.toNumber()).toBe(1940000);

      const doLegado = await prisma.contrato.findFirstOrThrow({
        where: { tenantId: tenant.id, companyId: nos.id },
      });
      expect(doLegado.tipo).toBe('GUARDA_CHUVA');
      expect(doLegado.escopo).toBe('Escopo antigo');
      expect(doLegado.valorContratado?.toNumber()).toBe(5000);

      // Segunda rodada: nada muda, nem updatedAt.
      const antes = await fotografia();
      const r2 = await servicos.semear({
        tenantId: tenant.id,
        linhas: servicos.lerCsv(csv),
        autorId: admin.id,
      });
      expect(await fotografia()).toBe(antes);
      expect(r2.criados).toEqual([]);
      expect(r2.atualizados).toEqual([]);
      expect(r2.saldosDeAbertura).toEqual([]);
      expect(r2.semMudanca.sort()).toEqual(['E2180', 'G0025']);
      expect(r2.recusados).toHaveLength(5);

      // Empresa CONCORRENTE não vira contrato.
      expect(await prisma.contrato.count({ where: { tenantId: tenant.id } })).toBe(3);
    });

    it('terceira rodada com dado novo atualiza; abertura diferente não reescreve', async () => {
      const { tenant, admin } = await novoTenant();
      const a = await novaEmpresa(tenant.id);
      const flow = crypto.randomUUID();
      const linha = (valor: string, consumo: string, sla: string) =>
        `flow_record_id,codigo,company_id,valor_contratado,consumo_inicial,sla_resposta_horas\n${flow},C1,${a.id},${valor},${consumo},${sla}`;

      await servicos.semear({
        tenantId: tenant.id,
        linhas: servicos.lerCsv(linha('100', '10', '')),
        autorId: admin.id,
      });
      const r = await servicos.semear({
        tenantId: tenant.id,
        linhas: servicos.lerCsv(linha('200', '20', '48')),
        autorId: admin.id,
      });
      expect(r.atualizados).toEqual([
        { numero: 'C1', campos: expect.arrayContaining(['valorContratado', 'slaRespostaHoras']) },
      ]);
      expect(r.ignorados[0].motivo).toContain('saldo de abertura');
      const c = await prisma.contrato.findFirstOrThrow({
        where: { tenantId: tenant.id, numero: 'C1' },
        include: { movimentos: true },
      });
      expect(c.valorContratado?.toNumber()).toBe(200);
      expect(c.movimentos).toHaveLength(1);
      expect(c.movimentos[0].valor.toNumber()).toBe(10);
    });
  });

  // ── Indicadores conferidos à mão (E-21, E-22) ────────────────────────────────

  describe('indicadores (E-21, E-22)', () => {
    it('conjunto com todos os estados, conferido à mão', async () => {
      // Tenant próprio não serve aqui: eventos vão para CAPTURA_TENANT_ID. Para não misturar
      // com as demandas dos outros testes, o filtro é pelo cliente deste conjunto.
      const cliente = await novaEmpresa(base.tenant.id, { name: 'Cliente dos Indicadores' });
      const clienteOutro = await novaEmpresa(base.tenant.id, { name: 'Outro Cliente' });
      const sla24 = await novoContrato({
        companyId: cliente.id,
        slaRespostaHoras: 24,
        numero: unico('SLA24'),
      });
      const sla8 = await novoContrato({
        companyId: cliente.id,
        slaRespostaHoras: 8,
        numero: unico('SLA8'),
      });
      const semSla = await novoContrato({ companyId: cliente.id, numero: unico('SEMSLA') });

      // Horários em Brasília (UTC-3). 23/11/2026 é segunda-feira.
      const br = (dia: number, hora: number, minuto = 0) =>
        new Date(Date.UTC(2026, 10, dia, hora + 3, minuto)).toISOString();

      interface Caso {
        cenario?: string;
        contrato?: string;
        cliente?: string;
        recebido: string;
        eventos: Array<[string, string, Record<string, unknown>?]>;
      }
      const casos: Caso[] = [
        // 1 recebida: nada conta.
        { recebido: br(23, 9), eventos: [] },
        // 2 em triagem: não é triada (sem decisão).
        { recebido: br(23, 9), eventos: [['em_triagem', br(23, 10)]] },
        // 3 em orçamento: Go.
        { recebido: br(23, 9), eventos: [['em_orcamento', br(24, 9)]] },
        // 4 enviada: Go; 10 h úteis (ter 10-18 = 8 + qua 8-10 = 2); R$ 100 mil.
        {
          recebido: br(24, 10),
          eventos: [
            ['em_orcamento', br(24, 11)],
            ['orcamento_enviado', br(25, 10), { valor_enviado: 100000 }],
          ],
        },
        // 5 ganha: Go; 4 h; enviou 200 mil, aprovou 180 mil.
        {
          recebido: br(25, 8),
          eventos: [
            ['em_orcamento', br(25, 9)],
            ['orcamento_enviado', br(25, 12), { valor_enviado: 200000 }],
            ['ganha', br(26, 10), { valor_aprovado: 180000 }],
          ],
        },
        // 6 perdida: Go; 10 h; enviou 300 mil.
        {
          recebido: br(25, 8),
          eventos: [
            ['em_orcamento', br(25, 9)],
            ['orcamento_enviado', br(25, 18), { valor_enviado: 300000 }],
            ['perdida', br(27, 10), { motivo: 'Preço' }],
          ],
        },
        // 7 declinada na triagem: No-go.
        {
          recebido: br(23, 9),
          eventos: [
            ['em_triagem', br(23, 10)],
            ['declinada', br(24, 10), { motivo: 'Fora da região' }],
          ],
        },
        // 8 cancelada: fora da conversão e não é triada.
        { recebido: br(23, 9), eventos: [['cancelada', br(24, 10)]] },
        // 9 descartada depois de enviada: fora de tudo.
        {
          recebido: br(23, 9),
          eventos: [
            ['em_orcamento', br(24, 9)],
            ['orcamento_enviado', br(25, 9), { valor_enviado: 999999 }],
            ['descartada', br(26, 9)],
          ],
        },
        // 10 chamado enviado dentro do SLA de 24: 10 h (seg 9-18 = 9 + ter 8-9 = 1); 50 mil.
        {
          cenario: 'chamado_lta',
          contrato: sla24.id,
          recebido: br(23, 9),
          eventos: [['orcamento_enviado', br(24, 9), { valor_enviado: 50000 }]],
        },
        // 11 chamado ganho, fora do SLA de 8: 18 h (seg 9 + ter 8-17 = 9); 70 mil e 60 mil.
        {
          cenario: 'chamado_lta',
          contrato: sla8.id,
          recebido: br(23, 9),
          eventos: [
            ['orcamento_enviado', br(24, 17), { valor_enviado: 70000 }],
            ['ganha', br(26, 11), { valor_aprovado: 60000 }],
          ],
        },
        // 12 chamado perdido, contrato sem SLA, enviado sem valor: 2 h.
        {
          cenario: 'chamado_lta',
          contrato: semSla.id,
          recebido: br(23, 9),
          eventos: [
            ['orcamento_enviado', br(23, 11)],
            ['perdida', br(27, 11), { motivo: 'Escopo' }],
          ],
        },
        // 13 chamado ganho sem valor aprovado: conta como ganha e aparece como lacuna.
        {
          cenario: 'chamado_lta',
          contrato: sla24.id,
          recebido: br(23, 9),
          eventos: [['ganha', br(26, 12)]],
        },
        // 14 ganha em outubro: fora do período.
        {
          recebido: new Date(Date.UTC(2026, 9, 5, 12)).toISOString(),
          eventos: [
            ['em_orcamento', new Date(Date.UTC(2026, 9, 6, 12)).toISOString()],
            [
              'orcamento_enviado',
              new Date(Date.UTC(2026, 9, 7, 12)).toISOString(),
              { valor_enviado: 777777 },
            ],
            [
              'ganha',
              new Date(Date.UTC(2026, 9, 10, 12)).toISOString(),
              { valor_aprovado: 777777 },
            ],
          ],
        },
        // 15 outro cliente, fora do filtro por cliente.
        {
          cliente: clienteOutro.id,
          recebido: br(23, 9),
          eventos: [
            ['em_orcamento', br(24, 9)],
            ['ganha', br(26, 9), { valor_aprovado: 123 }],
          ],
        },
      ];

      for (const caso of casos) {
        const corpo = corpoDemanda({
          cenario: caso.cenario ?? 'contrato_novo',
          contrato_id: caso.contrato ?? null,
          cliente_id: caso.cliente ?? cliente.id,
          recebido_em_origem: caso.recebido,
          capturado_em: caso.recebido,
        });
        expect((await criarDemanda(corpo)).status).toBe(201);
        for (const [estado, em, extra] of caso.eventos) {
          const res = await assinarEPostar(evento(corpo.chave_dedup, estado, em, extra));
          expect(res.body).toEqual({ aplicado: true });
        }
      }

      const consulta = (extra: Record<string, string> = {}) =>
        request(app)
          .get('/api/v1/captura-relatorio/indicadores')
          .query({ de: '2026-11-01', ate: '2026-11-30', clienteId: cliente.id, ...extra })
          .set('Authorization', base.sessaoAdmin);

      const res = await consulta();
      expect(res.status).toBe(200);
      const i = res.body.data.indicadores;

      // Go = 3, 4, 5, 6. No-go = 7. Triadas = 5.
      expect(i.taxaGo).toEqual({ go: 4, triadas: 5, taxa: 0.8 });
      // Só orçamentos: ganhas = 5, 11; perdidas = 6, 12. O 13 foi ganho sem orçamento.
      expect(i.conversao).toEqual({ ganhas: 2, perdidas: 2, taxa: 0.5 });
      // 4=10 h, 5=4 h, 6=10 h, 10=10 h, 11=18 h, 12=2 h. 54 ÷ 6 = 9.
      expect(i.tempoAtendimento).toEqual({ enviadas: 6, mediaHorasUteis: 9 });
      // Avaliados = 10 (dentro) e 11 (fora). 12 não tem SLA.
      expect(i.sla).toEqual({ dentro: 1, avaliados: 2, taxa: 0.5, semSla: 1 });
      // E-21: soma ÷ nº de orçamentos enviados. 720 mil ÷ 6; o 12 foi sem valor e conta.
      expect(i.ticketEnviado).toEqual({ soma: 720000, quantidade: 6, media: 120000, semValor: 1 });
      // E-21: soma ÷ nº de aprovados. 240 mil ÷ 3; o 13 foi sem valor e conta.
      expect(i.ticketAprovado).toEqual({ soma: 240000, quantidade: 3, media: 80000, semValor: 1 });

      expect(res.body.data.lacunas.ganhasSemValor).toHaveLength(1);
      expect(res.body.data.dataInicio).toBeTruthy();
      expect(res.body.data.calendario.fuso).toBe('America/Sao_Paulo');

      // Filtro por cenário.
      const soNovo = (await consulta({ cenario: 'contrato_novo' })).body.data.indicadores;
      expect(soNovo.conversao).toEqual({ ganhas: 1, perdidas: 1, taxa: 0.5 });
      expect(soNovo.sla.avaliados).toBe(0);

      // Filtro por contrato.
      const soSla8 = (await consulta({ contratoId: sla8.id })).body.data.indicadores;
      expect(soSla8.sla).toEqual({ dentro: 0, avaliados: 1, taxa: 0, semSla: 0 });

      // Sem filtro de período, a ganha de outubro entra.
      const semPeriodo = await request(app)
        .get('/api/v1/captura-relatorio/indicadores')
        .query({ clienteId: cliente.id })
        .set('Authorization', base.sessaoAdmin);
      expect(semPeriodo.body.data.indicadores.conversao.ganhas).toBe(3);
      expect(semPeriodo.body.data.indicadores.taxaGo.go).toBe(5);

      // Agrupar por cenário bate com o total.
      const grupos = (await consulta({ agrupar: 'cenario' })).body.data.grupos as Array<{
        id: string;
        indicadores: { conversao: { ganhas: number } };
      }>;
      expect(grupos.map((g) => g.id).sort()).toEqual(['chamado_lta', 'contrato_novo']);
      expect(grupos.reduce((s, g) => s + g.indicadores.conversao.ganhas, 0)).toBe(2);

      // Agrupar por mês, no período de outubro a novembro.
      const porMes = await request(app)
        .get('/api/v1/captura-relatorio/indicadores')
        .query({ de: '2026-10-01', ate: '2026-11-30', clienteId: cliente.id, agrupar: 'mes' })
        .set('Authorization', base.sessaoAdmin);
      const meses = porMes.body.data.grupos as Array<{
        id: string;
        indicadores: { conversao: { ganhas: number } };
      }>;
      expect(meses.map((m) => [m.id, m.indicadores.conversao.ganhas])).toEqual([
        ['2026-10', 1],
        ['2026-11', 2],
      ]);

      // Agrupar por contrato e por cliente.
      const porContrato = (await consulta({ agrupar: 'contrato' })).body.data.grupos as Array<{
        id: string;
      }>;
      expect(porContrato.map((g) => g.id)).toEqual(
        expect.arrayContaining(['sem-contrato', sla24.id, sla8.id, semSla.id])
      );
      const porCliente = await request(app)
        .get('/api/v1/captura-relatorio/indicadores')
        .query({ de: '2026-11-01', ate: '2026-11-30', agrupar: 'cliente' })
        .set('Authorization', base.sessaoAdmin);
      expect((porCliente.body.data.grupos as Array<{ id: string }>).map((g) => g.id)).toEqual(
        expect.arrayContaining([cliente.id, clienteOutro.id])
      );

      // Opções de filtro da tela.
      const filtros = await request(app)
        .get('/api/v1/captura-relatorio/filtros')
        .set('Authorization', base.sessaoAdmin);
      expect(filtros.body.data.clientes.map((c: { id: string }) => c.id)).toContain(cliente.id);

      // O cumprimento de SLA e o consumo do contrato batem com o saldo do chamado ganho.
      expect(await saldoDe(sla8.id)).toBe(1000 - 60000);
      // Leva ~2,3 s sozinho; com a máquina carregada passou dos 5 s padrão (rodada 6).
    }, 30_000);

    it('calendário é configuração do tenant: mudar o expediente muda as horas', async () => {
      const { tenant } = await novoTenant();
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: { capturaCalendario: { diasUteis: [1, 2, 3, 4, 5], inicio: '09:00', fim: '17:00' } },
      });
      const cliente = await novaEmpresa(tenant.id);
      const { funnelService } = servicos;
      expect(funnelService).toBeTruthy();
      await servicos.garantirFunis(tenant.id);
      const coluna = await prisma.funnelColumn.findFirstOrThrow({
        where: {
          capturaEstado: 'orcamento_enviado',
          funnel: { tenantId: tenant.id, name: 'Contrato novo' },
        },
      });
      const deal = await prisma.deal.create({
        data: {
          tenantId: tenant.id,
          name: 'x',
          value: 0,
          funnelColumnId: coluna.id,
          companyId: cliente.id,
        },
      });
      await prisma.demanda.create({
        data: {
          tenantId: tenant.id,
          dealId: deal.id,
          chaveDedup: unico('cal'),
          idCaptura: crypto.randomUUID(),
          cenario: 'contrato_novo',
          fonte: 'x',
          nivel: 1,
          estado: 'orcamento_enviado',
          // Segunda 8h às 18h em Brasília: com expediente de 9h às 17h, são 8 horas úteis.
          recebidoEmOrigem: new Date('2026-11-23T11:00:00Z'),
          capturadoEm: new Date('2026-11-23T11:00:00Z'),
          enviadoEm: new Date('2026-11-23T21:00:00Z'),
        },
      });
      const r = await servicos.obterIndicadores(tenant.id, {});
      expect(r.calendario.inicio).toBe('09:00');
      expect(r.indicadores.tempoAtendimento.mediaHorasUteis).toBe(8);
    });
  });

  // ── Rodada 1 da revisão: valor do Negócio, auditoria, corridas, semeadura e calendário ──

  describe('valor do Negócio acompanha o Flow (E-15, emenda)', () => {
    const valorDe = async (id: string) =>
      Number((await prisma.deal.findUniqueOrThrow({ where: { id } })).value);

    it('estimado, depois enviado, depois aprovado; ao sair de ganha volta ao enviado', async () => {
      const corpo = corpoDemanda({ valor_estimado: 85000 });
      const id = (await criarDemanda(corpo)).body.engage_id as string;
      expect(await valorDe(id)).toBe(85000);

      await assinarEPostar(
        evento(corpo.chave_dedup, 'orcamento_enviado', '2026-11-21T12:00:00Z', {
          valor_enviado: 125000,
        })
      );
      expect(await valorDe(id)).toBe(125000);

      await assinarEPostar(
        evento(corpo.chave_dedup, 'ganha', '2026-11-22T12:00:00Z', { valor_aprovado: 100000 })
      );
      expect(await valorDe(id)).toBe(100000);

      await assinarEPostar(evento(corpo.chave_dedup, 'em_orcamento', '2026-11-23T12:00:00Z'));
      expect(await valorDe(id)).toBe(125000);
    });

    it('evento sem valor não mexe; ganha sem valor fica no enviado', async () => {
      const corpo = corpoDemanda({ valor_estimado: 85000 });
      const id = (await criarDemanda(corpo)).body.engage_id as string;
      await assinarEPostar(evento(corpo.chave_dedup, 'em_triagem', '2026-11-21T12:00:00Z'));
      expect(await valorDe(id)).toBe(85000);
      await assinarEPostar(
        evento(corpo.chave_dedup, 'orcamento_enviado', '2026-11-21T13:00:00Z', {
          valor_enviado: 300,
        })
      );
      await assinarEPostar(evento(corpo.chave_dedup, 'ganha', '2026-11-21T14:00:00Z'));
      expect(await valorDe(id)).toBe(300);
    });

    it('evento atrasado leva o enviado ao Negócio só quando não há aprovado', async () => {
      const sem = corpoDemanda({ valor_estimado: 85000 });
      const idSem = (await criarDemanda(sem)).body.engage_id as string;
      await assinarEPostar(evento(sem.chave_dedup, 'em_orcamento', '2026-11-22T12:00:00Z'));
      const atrasado = await assinarEPostar(
        evento(sem.chave_dedup, 'orcamento_enviado', '2026-11-21T12:00:00Z', {
          valor_enviado: 125000,
        })
      );
      expect(atrasado.body).toEqual({ aplicado: false });
      expect(await valorDe(idSem)).toBe(125000);

      const com = corpoDemanda({ valor_estimado: 85000 });
      const idCom = (await criarDemanda(com)).body.engage_id as string;
      await assinarEPostar(
        evento(com.chave_dedup, 'ganha', '2026-11-22T12:00:00Z', { valor_aprovado: 100000 })
      );
      await assinarEPostar(
        evento(com.chave_dedup, 'orcamento_enviado', '2026-11-21T12:00:00Z', {
          valor_enviado: 125000,
        })
      );
      expect(await valorDe(idCom)).toBe(100000);
      await assinarEPostar(evento(com.chave_dedup, 'em_orcamento', '2026-11-23T12:00:00Z'));
      expect(await valorDe(idCom)).toBe(125000);
    });
  });

  describe('valor controlado pelo Flow não muda à mão (E-16, emenda)', () => {
    const sessao = (req: request.Test) => req.set('Authorization', base.sessaoAdmin);

    async function produtoDoCatalogo() {
      return prisma.product.create({
        data: { tenantId: base.tenant.id, name: unico('Produto'), unitPrice: 777 },
      });
    }

    it('PUT: livre antes do Flow informar; depois recusa mudar, e o mesmo valor passa', async () => {
      const corpo = corpoDemanda({ valor_estimado: 10 });
      const id = (await criarDemanda(corpo)).body.engage_id as string;

      const antes = await sessao(request(app).put(`/api/v1/deals/${id}`)).send({ value: 20 });
      expect(antes.status).toBe(200);
      expect(Number(antes.body.value)).toBe(20);

      await assinarEPostar(
        evento(corpo.chave_dedup, 'orcamento_enviado', '2026-11-21T12:00:00Z', {
          valor_enviado: 500,
        })
      );
      const recusado = await sessao(request(app).put(`/api/v1/deals/${id}`)).send({ value: 1 });
      expect(recusado.status).toBe(403);
      expect(recusado.body.error).toBe('Andamento controlado pelo Flow');

      const mesmo = await sessao(request(app).put(`/api/v1/deals/${id}`)).send({
        value: 500,
        notes: 'Formulário inteiro',
      });
      expect(mesmo.status).toBe(200);

      await assinarEPostar(
        evento(corpo.chave_dedup, 'ganha', '2026-11-22T12:00:00Z', { valor_aprovado: 400 })
      );
      const ganho = await sessao(request(app).put(`/api/v1/deals/${id}`)).send({ value: 1 });
      expect(ganho.status).toBe(403);
      const deal = await prisma.deal.findUniqueOrThrow({ where: { id } });
      expect(Number(deal.value)).toBe(400);
    });

    it('produtos: POST e DELETE recusados depois que o Flow informou o valor', async () => {
      const corpo = corpoDemanda({ valor_estimado: 10 });
      const id = (await criarDemanda(corpo)).body.engage_id as string;
      const produto = await produtoDoCatalogo();
      const item = { productId: produto.id, quantity: 2, unitPrice: 777 };

      const livre = await sessao(request(app).post(`/api/v1/deals/${id}/products`)).send(item);
      expect(livre.status).toBe(201);

      await assinarEPostar(
        evento(corpo.chave_dedup, 'ganha', '2026-11-22T12:00:00Z', { valor_aprovado: 400 })
      );
      const post = await sessao(request(app).post(`/api/v1/deals/${id}/products`)).send(item);
      expect(post.status).toBe(403);
      expect(post.body.error).toBe('Andamento controlado pelo Flow');
      const del = await sessao(
        request(app).delete(`/api/v1/deals/${id}/products/${livre.body.data.id}`)
      );
      expect(del.status).toBe(403);

      expect(await prisma.dealProduct.count({ where: { dealId: id } })).toBe(1);
      const deal = await prisma.deal.findUniqueOrThrow({ where: { id } });
      expect(Number(deal.value)).toBe(400);
    });

    it('reunião aplica notas e deixa de lado valor e etapa sugeridos', async () => {
      const corpo = corpoDemanda({ valor_estimado: 10 });
      const id = (await criarDemanda(corpo)).body.engage_id as string;
      await assinarEPostar(
        evento(corpo.chave_dedup, 'orcamento_enviado', '2026-11-21T12:00:00Z', {
          valor_enviado: 500,
        })
      );
      const { meetingService } = await import('../services/meetingService.js');
      const reuniao = await prisma.interaction.create({
        data: {
          tenantId: base.tenant.id,
          dealId: id,
          type: 'MEETING',
          direction: 'OUTBOUND',
          content: 'Reunião',
          metadata: {
            suggestedFields: [
              { key: 'value', label: 'Valor', value: 1 },
              { key: 'stage', label: 'Etapa', value: 'QUALIFICATION' },
              { key: 'notes', label: 'Notas', value: 'Decidido na reunião' },
            ],
          },
        },
      });
      await meetingService.applyMeeting(
        base.tenant.id,
        id,
        reuniao.id,
        {
          taskIds: [],
          fieldUpdates: { value: '1', stage: 'QUALIFICATION', notes: 'Decidido na reunião' },
        },
        base.admin.id
      );
      const deal = await prisma.deal.findUniqueOrThrow({ where: { id } });
      expect(Number(deal.value)).toBe(500);
      expect(deal.stage).toBe('NEGOTIATION');
      expect(deal.notes).toContain('Decidido na reunião');
    });

    it('PUT devolve a demanda, para a tela não perder a trava (E-16)', async () => {
      const id = (await criarDemanda(corpoDemanda())).body.engage_id as string;
      const res = await sessao(request(app).put(`/api/v1/deals/${id}`)).send({ notes: 'x' });
      expect(res.status).toBe(200);
      expect(res.body.demanda).toMatchObject({ estado: 'recebida', cenario: 'contrato_novo' });
    });

    it('lista e quadro trazem os dois valores, para a tela travar também por lá', async () => {
      const corpo = corpoDemanda({ objeto: unico('Lista') });
      const id = (await criarDemanda(corpo)).body.engage_id as string;
      await assinarEPostar(
        evento(corpo.chave_dedup, 'orcamento_enviado', '2026-11-21T12:00:00Z', {
          valor_enviado: 500,
        })
      );
      const { deals } = await servicos.dealService.findAll(base.tenant.id, {
        search: corpo.objeto,
      });
      const naLista = deals.find((d) => d.id === id);
      expect(Number(naLista?.demanda?.valorEnviado)).toBe(500);
      const deal = await prisma.deal.findUniqueOrThrow({ where: { id } });
      const quadro = await servicos.funnelService.findById(base.tenant.id, deal.funnelId as string);
      const noQuadro = quadro.columns.flatMap((c) => c.deals).find((d) => d.id === id);
      expect(Number(noQuadro?.demanda?.valorEnviado)).toBe(500);
    });
  });

  describe('dado fora de faixa dá 422 com o campo (mãe, Criar demanda)', () => {
    it.each([
      ['valor_estimado', { valor_estimado: 1e15 }],
      ['nivel', { nivel: 3e9 }],
      ['objeto', { objeto: 'com\u0000nul' }],
      ['fonte', { fonte: 'com\u0000nul' }],
      ['chave_dedup', { chave_dedup: 'com\u0000nul' }],
      ['link_original', { link_original: 'javascript:alert(1)' }],
    ])('criar: %s', async (campo, extra) => {
      const res = await criarDemanda(corpoDemanda(extra));
      expect(res.status).toBe(422);
      expect(res.body.campo).toBe(campo);
    });

    it.each([
      ['valor_enviado', { valor_enviado: 1e15 }],
      ['valor_aprovado', { valor_aprovado: 1e15 }],
    ])('evento: %s', async (campo, extra) => {
      const corpo = corpoDemanda();
      await criarDemanda(corpo);
      const res = await assinarEPostar(
        evento(corpo.chave_dedup, 'ganha', '2026-11-22T12:00:00Z', extra)
      );
      expect(res.status).toBe(422);
      expect(res.body.campo).toBe(campo);
    });

    it('o teto de Deal.value passa inteiro', async () => {
      const corpo = corpoDemanda({ valor_estimado: 9_999_999_999.99 });
      const res = await criarDemanda(corpo);
      expect(res.status).toBe(201);
      const fim = await assinarEPostar(
        evento(corpo.chave_dedup, 'ganha', '2026-11-22T12:00:00Z', {
          valor_aprovado: 9_999_999_999.99,
        })
      );
      expect(fim.body).toEqual({ aplicado: true });
    });

    it('NUL em campo acessório é tirado e não segura o evento nem o adendo', async () => {
      const corpo = corpoDemanda();
      const { body } = await criarDemanda(corpo);
      const res = await assinarEPostar(
        evento(corpo.chave_dedup, 'perdida', '2026-11-22T12:00:00Z', {
          motivo: 'Pre\u0000ço',
          autor_email: 'a\u0000@exemplo.com',
        })
      );
      expect(res.body).toEqual({ aplicado: true });
      const demanda = await prisma.demanda.findFirstOrThrow({ where: { dealId: body.engage_id } });
      expect(demanda.motivo).toBe('Preço');

      const adendo = await request(app)
        .patch(`/api/v1/captura/demandas/${body.engage_id}`)
        .set('X-API-Key', chaveEscrita)
        .send({ adendo: { texto: 'te\u0000xto' } });
      expect(adendo.status).toBe(200);
      const nota = await prisma.interaction.findFirstOrThrow({
        where: { dealId: body.engage_id, subject: 'Adendo do Radar' },
      });
      expect(nota.content).toBe('texto');
    });

    it('busca de cliente com NUL não derruba a rota', async () => {
      const chave = await novaChave(base.tenant.id, ['contracts:read'], null);
      const res = await request(app)
        .get('/api/v1/captura/clientes')
        .query({ nome: 'cli\u0000ente' })
        .set('X-API-Key', chave);
      expect(res.status).toBe(200);
    });

    it('link_original só aceita http e https, também no PATCH', async () => {
      const { body } = await criarDemanda(corpoDemanda());
      const res = await request(app)
        .patch(`/api/v1/captura/demandas/${body.engage_id}`)
        .set('X-API-Key', chaveEscrita)
        .send({ link_original: 'javascript:alert(1)' });
      expect(res.status).toBe(422);
      expect(res.body.campo).toBe('link_original');
      const ok = await request(app)
        .patch(`/api/v1/captura/demandas/${body.engage_id}`)
        .set('X-API-Key', chaveEscrita)
        .send({ link_original: 'https://exemplo.com/x' });
      expect(ok.status).toBe(200);
    });

    it('tela de contratos: valor e SLA fora da faixa dão 400, não 500', async () => {
      const cases = [{ valorContratado: 1e15 }, { slaRespostaHoras: 3e9 }];
      for (const extra of cases) {
        const res = await request(app)
          .post('/api/v1/gestao-contratos')
          .set('Authorization', base.sessaoAdmin)
          .send({ companyId: empresa.id, numero: unico('FAIXA'), ...extra });
        expect(res.status).toBe(400);
      }
      const contrato = await novoContrato();
      const mov = await request(app)
        .post(`/api/v1/gestao-contratos/${contrato.id}/movimentos`)
        .set('Authorization', base.sessaoAdmin)
        .send({ tipo: 'ADITIVO', valor: 1e15, motivo: 'x' });
      expect(mov.status).toBe(400);
    });
  });

  describe('auditoria do movimento (E-05, emenda)', () => {
    it('evento de quem tem login vai ao AuditLog; de quem não tem, fica em DemandaEvento', async () => {
      const contrato = await novoContrato({ valorContratado: 1000 });
      const semLogin = corpoDemanda({ cenario: 'chamado_lta', contrato_id: contrato.id });
      const idSem = (await criarDemanda(semLogin)).body.engage_id as string;
      await assinarEPostar(
        evento(semLogin.chave_dedup, 'ganha', '2026-11-22T12:00:00Z', {
          valor_aprovado: 100,
          autor_email: 'gerente.sem.login@cliente.com',
        })
      );
      const movSem = await prisma.contratoMovimento.findFirstOrThrow({ where: { dealId: idSem } });
      expect(movSem.demandaEventoId).toBeTruthy();
      expect(movSem.autorId).toBeNull();
      const eventoDele = await prisma.demandaEvento.findUniqueOrThrow({
        where: { id: movSem.demandaEventoId as string },
      });
      expect(eventoDele.autorEmail).toBe('gerente.sem.login@cliente.com');
      expect(await prisma.auditLog.count({ where: { entityId: movSem.id } })).toBe(0);

      const comLogin = corpoDemanda({ cenario: 'chamado_lta', contrato_id: contrato.id });
      const idCom = (await criarDemanda(comLogin)).body.engage_id as string;
      await assinarEPostar(
        evento(comLogin.chave_dedup, 'ganha', '2026-11-22T12:00:00Z', {
          valor_aprovado: 100,
          autor_email: base.admin.email,
        })
      );
      const movCom = await prisma.contratoMovimento.findFirstOrThrow({ where: { dealId: idCom } });
      expect(movCom.autorId).toBe(base.admin.id);
      expect(movCom.demandaEventoId).toBeTruthy();
      expect(
        await prisma.auditLog.count({ where: { entityId: movCom.id, userId: base.admin.id } })
      ).toBe(1);
    });

    it('troca de contrato pela rota grava autor e AuditLog nos dois movimentos', async () => {
      const a = await novoContrato({ valorContratado: 1000 });
      const b = await novoContrato({ valorContratado: 1000 });
      const corpo = corpoDemanda({ cenario: 'chamado_lta', contrato_id: a.id });
      const id = (await criarDemanda(corpo)).body.engage_id as string;
      await assinarEPostar(
        evento(corpo.chave_dedup, 'ganha', '2026-11-22T12:00:00Z', { valor_aprovado: 300 })
      );
      const res = await request(app)
        .patch(`/api/v1/captura/demandas/${id}`)
        .set('X-API-Key', chaveEscrita)
        .send({ contrato_id: b.id });
      expect(res.status).toBe(200);

      const daTroca = await prisma.contratoMovimento.findMany({
        where: { dealId: id, demandaEventoId: null },
      });
      expect(daTroca.map((m) => Number(m.valor)).sort((x, y) => x - y)).toEqual([-300, 300]);
      for (const movimento of daTroca) {
        expect(movimento.autorId).toBe(base.servico.id);
        expect(
          await prisma.auditLog.count({
            where: { entityId: movimento.id, userId: base.servico.id },
          })
        ).toBe(1);
      }
    });

    it('semeadura: saldo de abertura exige autor, grava e audita', async () => {
      const { tenant, admin, leitor } = await novoTenant();
      const outro = await novoTenant();
      const a = await novaEmpresa(tenant.id);
      const linha = {
        flow_record_id: crypto.randomUUID(),
        codigo: 'AB-1',
        company_id: a.id,
        valor_contratado: '1000',
        consumo_inicial: '200',
      };
      await expect(servicos.semear({ tenantId: tenant.id, linhas: [linha] })).rejects.toThrow(
        /--autor/
      );
      await expect(
        servicos.semear({ tenantId: tenant.id, linhas: [linha], autorId: outro.admin.id })
      ).rejects.toThrow(/--autor/);
      expect(await prisma.contrato.count({ where: { tenantId: tenant.id } })).toBe(0);

      await servicos.semear({ tenantId: tenant.id, linhas: [linha], autorId: admin.id });
      const movimento = await prisma.contratoMovimento.findFirstOrThrow({
        where: { contrato: { tenantId: tenant.id } },
      });
      expect(movimento.autorId).toBe(admin.id);
      expect(
        await prisma.auditLog.count({
          where: { tenantId: tenant.id, entityId: movimento.id, userId: admin.id },
        })
      ).toBe(1);

      // Sem consumo inicial, o autor não é exigido.
      const semConsumo = { ...linha, flow_record_id: crypto.randomUUID(), codigo: 'AB-2' };
      delete (semConsumo as Partial<typeof semConsumo>).consumo_inicial;
      await expect(
        servicos.semear({ tenantId: tenant.id, linhas: [semConsumo] })
      ).resolves.toBeTruthy();
      expect(leitor.id).toBeTruthy();
    });
  });

  it('reclassificação refaz a coluna sob a trava, com o estado que o evento acabou de gravar', async () => {
    const { atualizarDemanda } = await import('../services/captura/demandaService.js');
    const corpo = corpoDemanda();
    const id = (await criarDemanda(corpo)).body.engage_id as string;
    await assinarEPostar(evento(corpo.chave_dedup, 'em_triagem', '2026-11-20T15:00:00Z'));
    const contrato = await novoContrato();
    const demanda = await prisma.demanda.findFirstOrThrow({ where: { dealId: id } });

    let patch: Promise<unknown> | undefined;
    await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Demanda" WHERE id = ${demanda.id} FOR UPDATE`;
        patch = atualizarDemanda(
          base.tenant.id,
          id,
          { cenario: 'chamado_lta', contrato_id: contrato.id },
          base.servico.id
        );
        await new Promise((r) => setTimeout(r, 800));
        await tx.$executeRaw`UPDATE "Demanda" SET estado = 'em_orcamento', "ultimoEventoEm" = '2026-11-20T16:00:00Z' WHERE id = ${demanda.id}`;
      },
      { timeout: 20_000 }
    );
    await patch;

    const deal = await prisma.deal.findUniqueOrThrow({
      where: { id },
      include: { funnel: true, funnelColumn: true },
    });
    expect(deal.funnel?.name).toBe('Chamados');
    expect(deal.funnelColumn?.capturaEstado).toBe('em_orcamento');
  });

  it('novo evento de fechamento não muda a data de fechamento do Negócio (M-04)', async () => {
    const corpo = corpoDemanda();
    const id = (await criarDemanda(corpo)).body.engage_id as string;
    await assinarEPostar(
      evento(corpo.chave_dedup, 'ganha', '2026-11-23T12:00:00Z', { valor_aprovado: 100 })
    );
    await assinarEPostar(
      evento(corpo.chave_dedup, 'ganha', '2026-12-20T12:00:00Z', { valor_aprovado: 90 })
    );
    let deal = await prisma.deal.findUniqueOrThrow({ where: { id } });
    expect(deal.closedAt?.toISOString()).toBe('2026-11-23T12:00:00.000Z');
    expect(deal.wonAt?.toISOString()).toBe('2026-11-23T12:00:00.000Z');
    expect(Number(deal.value)).toBe(90);

    const outra = corpoDemanda();
    const idOutra = (await criarDemanda(outra)).body.engage_id as string;
    await assinarEPostar(
      evento(outra.chave_dedup, 'perdida', '2026-11-23T12:00:00Z', { motivo: 'Preço' })
    );
    await assinarEPostar(
      evento(outra.chave_dedup, 'perdida', '2026-12-20T12:00:00Z', { motivo: 'Prazo' })
    );
    deal = await prisma.deal.findUniqueOrThrow({ where: { id: idOutra } });
    expect(deal.closedAt?.toISOString()).toBe('2026-11-23T12:00:00.000Z');

    // Sair e voltar é mudança de verdade: a data acompanha.
    await assinarEPostar(evento(outra.chave_dedup, 'em_orcamento', '2026-12-21T12:00:00Z'));
    deal = await prisma.deal.findUniqueOrThrow({ where: { id: idOutra } });
    expect(deal.closedAt).toBeNull();
    await assinarEPostar(
      evento(outra.chave_dedup, 'ganha', '2026-12-22T12:00:00Z', { valor_aprovado: 1 })
    );
    deal = await prisma.deal.findUniqueOrThrow({ where: { id: idOutra } });
    expect(deal.closedAt?.toISOString()).toBe('2026-12-22T12:00:00.000Z');
  });

  describe('alerta único entre os campos da empresa e o contrato (E-08)', () => {
    const emDias = (dias: number) => {
      const agora = new Date();
      return new Date(
        Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate() + dias)
      );
    };

    it('alerta dado pelo contrato não repete pelos campos depois de excluir o contrato', async () => {
      const { tenant } = await novoTenant();
      const nos = await novaEmpresa(tenant.id, {
        contractHolder: 'NOS',
        contractEndDate: emDias(20),
      });
      const contrato = await prisma.contrato.create({
        data: { tenantId: tenant.id, companyId: nos.id, numero: 'C', vigenciaFim: emDias(20) },
      });
      const conta = () =>
        prisma.notification.count({ where: { tenantId: tenant.id, type: 'CONTRACT_EXPIRING' } });
      await servicos.checarContratos();
      expect(await conta()).toBe(1);
      await servicos.checarContratos();
      expect(await conta()).toBe(1);
      await prisma.contrato.update({
        where: { id: contrato.id },
        data: { deletedAt: new Date() },
      });
      await servicos.checarContratos();
      expect(await conta()).toBe(1);
    });

    it('alerta antigo dos campos silencia um contrato só, e o outro alerta uma vez', async () => {
      const { tenant } = await novoTenant();
      const nos = await novaEmpresa(tenant.id, {
        contractHolder: 'NOS',
        contractEndDate: emDias(20),
      });
      const conta = () =>
        prisma.notification.count({ where: { tenantId: tenant.id, type: 'CONTRACT_EXPIRING' } });
      await servicos.checarContratos();
      expect(await conta()).toBe(1);
      for (const numero of ['A', 'B']) {
        await prisma.contrato.create({
          data: { tenantId: tenant.id, companyId: nos.id, numero, vigenciaFim: emDias(20) },
        });
      }
      await servicos.checarContratos();
      expect(await conta()).toBe(2);
      await servicos.checarContratos();
      expect(await conta()).toBe(2);
    });
  });

  describe('empresa e contratos', () => {
    it('contador de Negócios não inclui a demanda descartada (E-17)', async () => {
      const { criarDemanda: criar, aplicarEvento } =
        await import('../services/captura/demandaService.js');
      const { tenant } = await novoTenant();
      const cliente = await novaEmpresa(tenant.id);
      const dados = {
        id_captura: crypto.randomUUID(),
        cenario: 'contrato_novo' as const,
        fonte: 'x',
        nivel: 1,
        recebido_em_origem: new Date('2026-11-20T13:00:00Z'),
        capturado_em: new Date('2026-11-20T13:00:00Z'),
        cliente_id: cliente.id,
        objeto: 'x',
      };
      await criar(tenant.id, { ...dados, chave_dedup: 'mantida' });
      await criar(tenant.id, { ...dados, chave_dedup: 'descartada' });
      await aplicarEvento(tenant.id, {
        evento_id: crypto.randomUUID(),
        chave_dedup: 'descartada',
        estado: 'descartada',
        ocorrido_em: new Date('2026-11-21T13:00:00Z'),
      });
      const detalhe = await servicos.companyService.findById(tenant.id, cliente.id);
      expect(detalhe._count.deals).toBe(1);
      const { companies } = await servicos.companyService.findAll(tenant.id, {});
      expect(companies.find((c) => c.id === cliente.id)?._count.deals).toBe(1);
    });

    it('empresa cujos contratos foram excluídos pode ser excluída; o expurgo recusa com clareza', async () => {
      const t = await novoTenant();
      const cliente = await novaEmpresa(t.tenant.id);
      const contrato = await prisma.contrato.create({
        data: { tenantId: t.tenant.id, companyId: cliente.id, numero: 'C' },
      });
      await prisma.contrato.update({
        where: { id: contrato.id },
        data: { deletedAt: new Date() },
      });
      await servicos.companyService.delete(t.tenant.id, cliente.id);
      const excluida = await prisma.company.findUniqueOrThrow({ where: { id: cliente.id } });
      expect(excluida.deletedAt).not.toBeNull();

      await expect(
        servicos.trash.purgeItem(t.tenant.id, 'companies', cliente.id)
      ).rejects.toMatchObject({ statusCode: 400, code: 'COMPANY_HAS_RELATIONS' });
      const purgados = await servicos.trash.purgeExpiredForEntity(
        t.tenant.id,
        'companies',
        new Date(Date.now() + 60_000)
      );
      expect(purgados).toBe(0);
      expect(await prisma.company.count({ where: { id: cliente.id } })).toBe(1);

      // Empresa sem contrato segue sendo expurgada.
      const livre = await novaEmpresa(t.tenant.id, { deletedAt: new Date() });
      await servicos.trash.purgeItem(t.tenant.id, 'companies', livre.id);
      expect(await prisma.company.count({ where: { id: livre.id } })).toBe(0);
    });

    it('mudar CNPJ ou domínio põe os contratos em atualizado_desde, sem novo evento de espelho', async () => {
      const { contratoService } = await import('../services/contratoService.js');
      const { tenant } = await novoTenant();
      const cliente = await novaEmpresa(tenant.id, {
        cnpj: '11111111000111',
        domain: 'antigo.com',
      });
      await prisma.contrato.create({
        data: { tenantId: tenant.id, companyId: cliente.id, numero: 'C' },
      });
      await new Promise((r) => setTimeout(r, 30));
      const marco = new Date();
      await new Promise((r) => setTimeout(r, 30));

      await servicos.companyService.update(tenant.id, {
        id: cliente.id,
        cnpj: '22222222000122',
        domain: 'novo.com',
      } as never);

      const limite = Date.now() + 3000;
      let itens: Array<{ cliente: { cnpj: string | null; dominio: string | null } }> = [];
      while (Date.now() < limite && itens.length === 0) {
        itens = (await contratoService.listarParaApi(tenant.id, { atualizadoDesde: marco }))
          .itens as never;
        if (itens.length === 0) await new Promise((r) => setTimeout(r, 25));
      }
      expect(itens).toHaveLength(1);
      expect(itens[0].cliente).toMatchObject({ cnpj: '22222222000122', dominio: 'novo.com' });
    });
  });

  describe('semeadura, rodada 1 da revisão', () => {
    let servidor: Server;
    let recebidos: Array<{ corpo: EventoRecebido }>;
    let falhar = false;

    beforeAll(async () => {
      recebidos = [];
      servidor = createServer((req: IncomingMessage, res: ServerResponse) => {
        let corpo = '';
        req.on('data', (p) => (corpo += p));
        req.on('end', () => {
          recebidos.push({ corpo: JSON.parse(corpo) });
          if (falhar) {
            res.writeHead(500);
            res.end('erro');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ flow_record_id: crypto.randomUUID() }));
        });
      });
      await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
    });

    afterAll(async () => {
      await new Promise((r) => servidor.close(r));
    });

    const webhookDoFlow = (tenantId: string, eventos: string[]) =>
      prisma.webhook.create({
        data: {
          tenantId,
          url: `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/espelho`,
          events: eventos,
          secret: 's',
        },
      });

    it('contrato gerado dos campos NOS vai ao Flow e volta com o id, antes de semear terminar', async () => {
      const { tenant } = await novoTenant();
      const nos = await novaEmpresa(tenant.id, { contractHolder: 'NOS', name: 'Cliente NOS' });
      await webhookDoFlow(tenant.id, ['contract.created']);
      recebidos.length = 0;

      const seco = await servicos.semear({ tenantId: tenant.id, linhas: [], seco: true });
      expect(seco.criados).toHaveLength(1);
      expect(recebidos).toHaveLength(0);

      const relatorio = await servicos.semear({ tenantId: tenant.id, linhas: [] });
      expect(relatorio.criados).toHaveLength(1);
      expect(relatorio.espelhoFalhas).toEqual([]);
      expect(recebidos).toHaveLength(1);
      expect(recebidos[0].corpo.event).toBe('contract.created');
      expect(recebidos[0].corpo.data.cliente).toBe('Cliente NOS');
      const contrato = await prisma.contrato.findFirstOrThrow({ where: { companyId: nos.id } });
      expect(contrato.flowRecordId).toBeTruthy();
    });

    it('linha da planilha não dispara; falha na entrega vai para o relatório', async () => {
      const { tenant } = await novoTenant();
      const a = await novaEmpresa(tenant.id);
      await novaEmpresa(tenant.id, { contractHolder: 'NOS' });
      await webhookDoFlow(tenant.id, ['contract.created']);
      recebidos.length = 0;
      falhar = true;
      try {
        const relatorio = await servicos.semear({
          tenantId: tenant.id,
          linhas: [{ flow_record_id: crypto.randomUUID(), codigo: 'P-1', company_id: a.id }],
        });
        expect(recebidos).toHaveLength(1);
        expect(relatorio.espelhoFalhas).toHaveLength(1);
        expect(relatorio.espelhoFalhas[0].erro).toContain('500');
      } finally {
        falhar = false;
      }
    });

    it('rodada que só acrescenta filhos anda updatedAt e aparece em atualizado_desde', async () => {
      const { contratoService } = await import('../services/contratoService.js');
      const { tenant, admin } = await novoTenant();
      const a = await novaEmpresa(tenant.id);
      const linha = {
        flow_record_id: crypto.randomUUID(),
        codigo: 'F-1',
        company_id: a.id,
        valor_contratado: '1000',
      };
      await servicos.semear({ tenantId: tenant.id, linhas: [linha] });
      await new Promise((r) => setTimeout(r, 30));
      const marco = new Date();
      await new Promise((r) => setTimeout(r, 30));

      const r = await servicos.semear({
        tenantId: tenant.id,
        autorId: admin.id,
        linhas: [
          {
            ...linha,
            solicitantes: 'Fiscal <fiscal@cliente.com>',
            consumo_inicial: '200',
            itens: 'Item X',
          },
        ],
      });
      expect(r.atualizados).toHaveLength(1);
      const api = await contratoService.listarParaApi(tenant.id, { atualizadoDesde: marco });
      expect(api.itens).toHaveLength(1);
      expect(api.itens[0].saldo).toBe(800);
    });

    it('célula vazia não apaga dado já cadastrado (E-09, emenda)', async () => {
      const { tenant } = await novoTenant();
      const a = await novaEmpresa(tenant.id);
      const flow = crypto.randomUUID();
      const cheia = {
        flow_record_id: flow,
        codigo: 'V-1',
        company_id: a.id,
        tipo: 'GUARDA_CHUVA',
        valor_contratado: '1000',
        vigencia_fim: '2027-01-01',
        gerente_nome: 'Gerente',
        gerente_email: 'g@e.com',
        sla_resposta_horas: '48',
      };
      await servicos.semear({ tenantId: tenant.id, linhas: [cheia] });
      const antes = await prisma.contrato.findFirstOrThrow({ where: { tenantId: tenant.id } });

      const r = await servicos.semear({
        tenantId: tenant.id,
        linhas: [
          { flow_record_id: flow, codigo: 'V-1', company_id: a.id, tipo: '', gerente_nome: '  ' },
        ],
      });
      expect(r.atualizados).toEqual([]);
      expect(r.semMudanca).toEqual(['V-1']);
      const depois = await prisma.contrato.findFirstOrThrow({ where: { tenantId: tenant.id } });
      expect(depois).toEqual(antes);
      expect(depois.tipo).toBe('GUARDA_CHUVA');

      // Célula preenchida continua atualizando, e o que nasce em branco segue com o padrão.
      const r2 = await servicos.semear({
        tenantId: tenant.id,
        linhas: [
          { flow_record_id: flow, codigo: 'V-1', company_id: a.id, valor_contratado: '2000' },
        ],
      });
      expect(r2.atualizados).toEqual([{ numero: 'V-1', campos: ['valorContratado'] }]);
      await servicos.semear({
        tenantId: tenant.id,
        linhas: [{ flow_record_id: crypto.randomUUID(), codigo: 'V-2', company_id: a.id }],
      });
      const novo = await prisma.contrato.findFirstOrThrow({
        where: { tenantId: tenant.id, numero: 'V-2' },
      });
      expect(novo.tipo).toBe('LTA');
    });
  });

  describe('rotina do espelho sem flowRecordId (E-10, emenda)', () => {
    let servidor: Server;
    let recebidos: EventoRecebido[];
    let responder: (corpo: EventoRecebido) => { status: number; texto: string };

    beforeAll(async () => {
      servidor = createServer((req: IncomingMessage, res: ServerResponse) => {
        let corpo = '';
        req.on('data', (p) => (corpo += p));
        req.on('end', () => {
          const dados = JSON.parse(corpo);
          recebidos.push(dados);
          const r = responder(dados);
          res.writeHead(r.status, { 'Content-Type': 'application/json' });
          res.end(r.texto);
        });
      });
      await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
    });

    afterAll(async () => {
      await new Promise((r) => servidor.close(r));
    });

    const devolveId = () => ({
      status: 200,
      texto: JSON.stringify({ flow_record_id: crypto.randomUUID() }),
    });

    /**
     * Roda só para este tenant, para não reenviar o que outros testes deixaram sem id. A
     * carência negativa evita o empate de milissegundos com o contrato que acabou de nascer.
     */
    const rodar = async (tenantId: string, limite = 50) => {
      const { reenviarContratosSemFlowRecordId } =
        await import('../jobs/contratoEspelhoChecker.js');
      return reenviarContratosSemFlowRecordId({ limite, carenciaMs: -60_000, tenantId });
    };

    async function preparar() {
      const { tenant } = await novoTenant();
      await prisma.webhook.create({
        data: {
          tenantId: tenant.id,
          url: `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/functions/v1/espelho-contratos`,
          events: ['contract.updated'],
          secret: 's',
        },
      });
      const cliente = await novaEmpresa(tenant.id, { name: 'Cliente da Rotina' });
      recebidos = [];
      responder = devolveId;
      return { tenant, cliente };
    }

    it('reenvia contract.updated e grava o id; excluído e com id ficam de fora', async () => {
      const { tenant, cliente } = await preparar();
      const semId = await prisma.contrato.create({
        data: { tenantId: tenant.id, companyId: cliente.id, numero: 'SEM' },
      });
      const original = crypto.randomUUID();
      await prisma.contrato.create({
        data: { tenantId: tenant.id, companyId: cliente.id, numero: 'COM', flowRecordId: original },
      });
      await prisma.contrato.create({
        data: {
          tenantId: tenant.id,
          companyId: cliente.id,
          numero: 'EXC',
          deletedAt: new Date(),
        },
      });

      const r = await rodar(tenant.id);
      expect(r).toMatchObject({ enviados: 1, falhas: 0 });
      expect(recebidos).toHaveLength(1);
      expect(recebidos[0].event).toBe('contract.updated');
      expect(recebidos[0].data).toMatchObject({
        id: semId.id,
        codigo: 'SEM',
        cliente: 'Cliente da Rotina',
      });
      const final = await prisma.contrato.findUniqueOrThrow({ where: { id: semId.id } });
      expect(final.flowRecordId).toBeTruthy();

      // Com o id gravado, a rodada seguinte não tem o que fazer.
      recebidos = [];
      expect(await rodar(tenant.id)).toMatchObject({ enviados: 0, falhas: 0 });
      expect(recebidos).toHaveLength(0);
    });

    it('respeita o limite por rodada e dá a vez aos demais na rodada seguinte', async () => {
      const { tenant, cliente } = await preparar();
      for (const numero of ['A', 'B', 'C']) {
        await prisma.contrato.create({
          data: { tenantId: tenant.id, companyId: cliente.id, numero },
        });
      }
      responder = () => ({ status: 500, texto: 'erro' });
      expect(await rodar(tenant.id, 2)).toMatchObject({ enviados: 2, falhas: 2 });
      expect(recebidos).toHaveLength(2);
      expect(await rodar(tenant.id, 2)).toMatchObject({ enviados: 2, falhas: 2 });
      const vistos = new Set(recebidos.map((c) => c.data.codigo));
      expect(vistos).toEqual(new Set(['A', 'B', 'C']));
    });

    it('falha fica registrada, o id segue nulo, e a rodada seguinte resolve', async () => {
      const { tenant, cliente } = await preparar();
      const contrato = await prisma.contrato.create({
        data: { tenantId: tenant.id, companyId: cliente.id, numero: 'F' },
      });
      responder = () => ({ status: 500, texto: 'erro' });
      expect(await rodar(tenant.id)).toMatchObject({ enviados: 1, falhas: 1 });
      expect(
        (await prisma.contrato.findUniqueOrThrow({ where: { id: contrato.id } })).flowRecordId
      ).toBeNull();
      const logs = await prisma.webhookLog.findMany({
        where: { webhook: { tenantId: tenant.id } },
      });
      expect(logs.map((l) => l.status)).toEqual(['FAILED']);

      responder = devolveId;
      expect(await rodar(tenant.id)).toMatchObject({ enviados: 1, falhas: 0 });
      expect(
        (await prisma.contrato.findUniqueOrThrow({ where: { id: contrato.id } })).flowRecordId
      ).toBeTruthy();
    });

    it('carência: contrato recém-alterado espera a entrega normal', async () => {
      const { tenant, cliente } = await preparar();
      await prisma.contrato.create({
        data: { tenantId: tenant.id, companyId: cliente.id, numero: 'N' },
      });
      const { reenviarContratosSemFlowRecordId } =
        await import('../jobs/contratoEspelhoChecker.js');
      const r = await reenviarContratosSemFlowRecordId({
        tenantId: tenant.id,
        carenciaMs: 60_000,
      });
      expect(r).toMatchObject({ enviados: 0, falhas: 0 });
      expect(recebidos).toHaveLength(0);
    });
  });

  describe('calendário (E-23, adendo 06)', () => {
    const chave = (escopos: string[]) => novaChave(base.tenant.id, escopos, base.servico.id);
    const padrao = fixtures.calendario as Record<string, unknown>;

    it('GET devolve o exemplo das fixtures, e PUT com o exemplo fica igual', async () => {
      const leitura = await chave(['contracts:read']);
      const escrita = await chave(['captura:write']);
      const lido = await request(app).get('/api/v1/captura/calendario').set('X-API-Key', leitura);
      expect(lido.status).toBe(200);
      expect(lido.body).toEqual(padrao);

      const gravado = await request(app)
        .put('/api/v1/captura/calendario')
        .set('X-API-Key', escrita)
        .send(padrao);
      expect(gravado.status).toBe(200);
      expect(gravado.body).toEqual(padrao);
    });

    it('escopos: GET exige contracts:read, e PUT exige captura:write', async () => {
      const leitura = await chave(['contracts:read']);
      const escrita = await chave(['captura:write']);
      expect(
        (await request(app).get('/api/v1/captura/calendario').set('X-API-Key', escrita)).status
      ).toBe(403);
      expect(
        (
          await request(app)
            .put('/api/v1/captura/calendario')
            .set('X-API-Key', leitura)
            .send(padrao)
        ).status
      ).toBe(403);
      expect((await request(app).get('/api/v1/captura/calendario')).status).toBe(401);
    });

    it.each([
      ['dias_uteis', { dias_uteis: [] }],
      ['dias_uteis.0', { dias_uteis: [7] }],
      ['dias_uteis', { dias_uteis: [1, 1] }],
      ['inicio', { inicio: '8h' }],
      ['fim', { fim: '25:00' }],
      ['fim', { inicio: '18:00', fim: '08:00' }],
      ['fuso', { fuso: 'Marte/Olympus' }],
      ['excluir_feriados_nacionais', { excluir_feriados_nacionais: 'sim' }],
      ['feriados_extras.0', { feriados_extras: ['2026-13-40'] }],
      ['inicio', { inicio: undefined }],
    ])('PUT inválido dá 422 com o campo: %s', async (campo, extra) => {
      const escrita = await chave(['captura:write']);
      const res = await request(app)
        .put('/api/v1/captura/calendario')
        .set('X-API-Key', escrita)
        .send({ ...padrao, ...extra });
      expect(res.status).toBe(422);
      expect(res.body.campo).toBe(campo);
    });

    it('o calendário gravado muda o indicador, e a mudança fica auditada', async () => {
      const t = await novoTenant();
      const escrita = await novaChave(
        t.tenant.id,
        ['captura:write', 'contracts:read'],
        t.servico.id
      );
      const res = await request(app)
        .put('/api/v1/captura/calendario')
        .set('X-API-Key', escrita)
        .send({
          dias_uteis: [5, 1, 2, 3, 4],
          inicio: '09:00',
          fim: '17:00',
          fuso: 'America/Sao_Paulo',
          excluir_feriados_nacionais: false,
          feriados_extras: ['2026-12-24'],
        });
      expect(res.status).toBe(200);
      expect(res.body.dias_uteis).toEqual([1, 2, 3, 4, 5]);

      const lido = await request(app).get('/api/v1/captura/calendario').set('X-API-Key', escrita);
      expect(lido.body).toMatchObject({
        inicio: '09:00',
        excluir_feriados_nacionais: false,
        feriados_extras: ['2026-12-24'],
      });
      const r = await servicos.obterIndicadores(t.tenant.id, {});
      expect(r.calendario).toMatchObject({ inicio: '09:00', excluirFeriadosNacionais: false });
      expect(
        await prisma.auditLog.count({
          where: {
            tenantId: t.tenant.id,
            entityType: 'captura_calendario',
            userId: t.servico.id,
          },
        })
      ).toBe(1);

      // O outro tenant não muda.
      const outro = await request(app)
        .get('/api/v1/captura/calendario')
        .set('X-API-Key', await chave(['contracts:read']));
      expect(outro.body.inicio).toBe('08:00');
    });
  });

  it('taxa de go: contrato novo que pulou a etapa de orçamento conta como triado e como Go (E-21, emenda)', async () => {
    const cliente = await novaEmpresa(base.tenant.id, { name: 'Cliente da Taxa de Go' });
    const casos: Array<Array<[string, string, Record<string, unknown>?]>> = [
      // Direto da triagem para enviado.
      [
        ['em_triagem', '2026-11-05T12:00:00Z'],
        ['orcamento_enviado', '2026-11-06T12:00:00Z', { valor_enviado: 10 }],
      ],
      // Direto da triagem para ganha.
      [
        ['em_triagem', '2026-11-05T12:00:00Z'],
        ['ganha', '2026-11-07T12:00:00Z', { valor_aprovado: 10 }],
      ],
      // Pelo caminho normal.
      [['em_orcamento', '2026-11-08T12:00:00Z']],
      // Declinada: No-go.
      [
        ['em_triagem', '2026-11-05T12:00:00Z'],
        ['declinada', '2026-11-09T12:00:00Z', { motivo: 'Fora' }],
      ],
      // Em triagem: nem Go nem triada.
      [['em_triagem', '2026-11-05T12:00:00Z']],
      // Chegou a enviado em outubro: fora do período de novembro.
      [['orcamento_enviado', '2026-10-06T12:00:00Z', { valor_enviado: 10 }]],
    ];
    for (const eventos of casos) {
      const corpo = corpoDemanda({ cliente_id: cliente.id });
      await criarDemanda(corpo);
      for (const [estado, em, extra] of eventos) {
        await assinarEPostar(evento(corpo.chave_dedup, estado, em, extra));
      }
    }
    const res = await request(app)
      .get('/api/v1/captura-relatorio/indicadores')
      .query({ de: '2026-11-01', ate: '2026-11-30', clienteId: cliente.id })
      .set('Authorization', base.sessaoAdmin);
    expect(res.body.data.indicadores.taxaGo).toEqual({ go: 3, triadas: 4, taxa: 0.75 });
  });

  // ── Rodada 2 da revisão ───────────────────────────────────────────────────────

  it('evento atrasado depois da última entrada do histórico mantém uma entrada aberta, com o estado atual (E-15)', async () => {
    const corpo = corpoDemanda({
      recebido_em_origem: '2026-11-20T10:00:00Z',
      capturado_em: '2026-11-20T10:00:00Z',
    });
    const id = (await criarDemanda(corpo)).body.engage_id as string;
    await assinarEPostar(evento(corpo.chave_dedup, 'em_orcamento', '2026-11-20T12:00:00Z'));
    await assinarEPostar(
      evento(corpo.chave_dedup, 'orcamento_enviado', '2026-11-20T13:00:00Z', { valor_enviado: 100 })
    );
    await assinarEPostar(
      evento(corpo.chave_dedup, 'orcamento_enviado', '2026-11-20T15:00:00Z', { valor_enviado: 120 })
    );
    const atrasado = await assinarEPostar(
      evento(corpo.chave_dedup, 'em_orcamento', '2026-11-20T14:00:00Z')
    );
    expect(atrasado.body).toEqual({ aplicado: false });

    const historico = async () =>
      (
        await prisma.dealStageHistory.findMany({
          where: { dealId: id },
          orderBy: [{ enteredAt: 'asc' }, { exitedAt: 'asc' }],
        })
      ).map((h) => [
        h.stage,
        h.enteredAt.toISOString().slice(11, 16),
        h.exitedAt ? h.exitedAt.toISOString().slice(11, 16) : 'ABERTA',
      ]);
    expect(await historico()).toEqual([
      ['recebida', '10:00', '12:00'],
      ['em_orcamento', '12:00', '13:00'],
      ['orcamento_enviado', '13:00', '14:00'],
      ['em_orcamento', '14:00', '15:00'],
      ['orcamento_enviado', '15:00', 'ABERTA'],
    ]);
    const demanda = await prisma.demanda.findFirstOrThrow({ where: { dealId: id } });
    expect(demanda.estado).toBe('orcamento_enviado');

    // O próximo evento em ordem fecha a entrada aberta, como sempre.
    await assinarEPostar(
      evento(corpo.chave_dedup, 'ganha', '2026-11-21T12:00:00Z', { valor_aprovado: 110 })
    );
    const depois = await historico();
    expect(depois.filter((h) => h[2] === 'ABERTA')).toEqual([['ganha', '12:00', 'ABERTA']]);
    expect(depois[4]).toEqual(['orcamento_enviado', '15:00', '12:00']);
  });

  it('evento atrasado que repete o estado atual dá o mesmo histórico da chegada em ordem (E-15)', async () => {
    const historicoDe = async (ordem: string[]) => {
      const corpo = corpoDemanda({
        recebido_em_origem: '2026-11-20T10:00:00Z',
        capturado_em: '2026-11-20T10:00:00Z',
      });
      const id = (await criarDemanda(corpo)).body.engage_id as string;
      const respostas = [];
      for (const [estado, hora] of ordem.map((e) => e.split('@'))) {
        respostas.push(
          (
            await assinarEPostar(
              evento(corpo.chave_dedup, estado, `2026-11-20T${hora}:00Z`, {
                valor_enviado: estado === 'orcamento_enviado' ? 100 : null,
              })
            )
          ).body
        );
      }
      const linhas = (
        await prisma.dealStageHistory.findMany({
          where: { dealId: id },
          orderBy: [{ enteredAt: 'asc' }, { exitedAt: 'asc' }],
        })
      ).map((h) => [
        h.stage,
        h.enteredAt.toISOString().slice(11, 16),
        h.exitedAt ? h.exitedAt.toISOString().slice(11, 16) : 'ABERTA',
      ]);
      return { respostas, linhas };
    };

    const emOrdem = await historicoDe([
      'em_orcamento@12:00',
      'orcamento_enviado@13:00',
      'orcamento_enviado@14:00',
      'orcamento_enviado@15:00',
    ]);
    const foraDeOrdem = await historicoDe([
      'em_orcamento@12:00',
      'orcamento_enviado@13:00',
      'orcamento_enviado@15:00',
      'orcamento_enviado@14:00',
    ]);
    expect(foraDeOrdem.respostas[3]).toEqual({ aplicado: false });
    const esperado = [
      ['recebida', '10:00', '12:00'],
      ['em_orcamento', '12:00', '13:00'],
      ['orcamento_enviado', '13:00', 'ABERTA'],
    ];
    expect(emOrdem.linhas).toEqual(esperado);
    expect(foraDeOrdem.linhas).toEqual(esperado);
  });

  it('sair de ganha sem valor enviado volta ao valor da criação, o estimado ou 0 (decisão 2)', async () => {
    const valorDe = async (id: string) =>
      Number((await prisma.deal.findUniqueOrThrow({ where: { id } })).value);

    const comEstimado = corpoDemanda({ valor_estimado: 85000 });
    const idCom = (await criarDemanda(comEstimado)).body.engage_id as string;
    await assinarEPostar(
      evento(comEstimado.chave_dedup, 'ganha', '2026-11-22T12:00:00Z', { valor_aprovado: 100 })
    );
    expect(await valorDe(idCom)).toBe(100);
    await assinarEPostar(
      evento(comEstimado.chave_dedup, 'perdida', '2026-11-23T12:00:00Z', { motivo: 'Preço' })
    );
    expect(await valorDe(idCom)).toBe(85000);

    const semEstimado = corpoDemanda();
    const idSem = (await criarDemanda(semEstimado)).body.engage_id as string;
    await assinarEPostar(
      evento(semEstimado.chave_dedup, 'ganha', '2026-11-22T12:00:00Z', { valor_aprovado: 100 })
    );
    await assinarEPostar(evento(semEstimado.chave_dedup, 'em_orcamento', '2026-11-23T12:00:00Z'));
    expect(await valorDe(idSem)).toBe(0);
  });

  describe('metas e contadores: Negócio comum na lixeira fica como antes (decisão 3)', () => {
    it('metas: Negócio comum na lixeira fica como antes, e demanda descartada sai', async () => {
      const t = await novoTenant();
      const agora = new Date();
      const mes = { month: agora.getMonth() + 1, year: agora.getFullYear() };
      await prisma.goal.create({
        data: { tenantId: t.tenant.id, userId: t.admin.id, ...mes, targetRevenue: 1000 },
      });
      const ganho = (nome: string, valor: number, deletedAt: Date | null) =>
        prisma.deal.create({
          data: {
            tenantId: t.tenant.id,
            name: nome,
            value: valor,
            stage: 'WON',
            status: 'WON',
            closedAt: agora,
            assignedTo: t.admin.id,
            deletedAt,
          },
        });
      await ganho('Comum ativo', 300, null);
      await ganho('Comum na lixeira', 200, agora);

      // Demanda ganha e depois descartada: sai das metas (E-17).
      const cliente = await novaEmpresa(t.tenant.id);
      const { criarDemanda: criar, aplicarEvento } =
        await import('../services/captura/demandaService.js');
      const { engage_id } = await criar(t.tenant.id, {
        chave_dedup: unico('meta'),
        id_captura: crypto.randomUUID(),
        cenario: 'contrato_novo',
        fonte: 'x',
        nivel: 1,
        recebido_em_origem: agora,
        capturado_em: agora,
        cliente_id: cliente.id,
        objeto: 'x',
        responsavel_email: t.admin.email,
      });
      const demanda = await prisma.demanda.findFirstOrThrow({ where: { dealId: engage_id } });
      for (const [estado, valor] of [
        ['ganha', 50],
        ['descartada', null],
      ] as const) {
        await aplicarEvento(t.tenant.id, {
          evento_id: crypto.randomUUID(),
          chave_dedup: demanda.chaveDedup,
          estado,
          ocorrido_em: new Date(),
          valor_aprovado: valor,
        });
      }

      // "Como antes": a consulta de `e997ec2`, sem filtro de exclusão, já não trazia Negócio na
      // lixeira, porque o cliente Prisma acrescenta `deletedAt: null` a toda leitura de Deal
      // (`server/src/config/database.ts`). A rota de metas é a mesma da base.
      const daBase = await prisma.deal.findMany({
        where: {
          tenantId: t.tenant.id,
          stage: 'WON',
          closedAt: {
            gte: new Date(mes.year, mes.month - 1, 1),
            lt: new Date(mes.year, mes.month, 1),
          },
        },
        select: { name: true },
      });
      expect(daBase.map((d) => d.name)).toEqual(['Comum ativo']);

      const res = await request(app)
        .get('/api/v1/goals/progress')
        .query(mes)
        .set('Authorization', t.sessaoAdmin);
      expect(res.status).toBe(200);
      const meu = (
        res.body.data as Array<{ userId: string; actual: { revenue: number; deals: number } }>
      ).find((g) => g.userId === t.admin.id);
      expect(meu?.actual).toMatchObject({ revenue: 300, deals: 1 });
    });

    it('contadores da empresa: Negócio comum na lixeira conta como antes', async () => {
      const { tenant } = await novoTenant();
      const cliente = await novaEmpresa(tenant.id);
      await prisma.deal.create({
        data: {
          tenantId: tenant.id,
          name: 'Comum',
          value: 1,
          companyId: cliente.id,
          deletedAt: new Date(),
        },
      });
      await prisma.deal.create({
        data: { tenantId: tenant.id, name: 'Ativo', value: 1, companyId: cliente.id },
      });
      const detalhe = await servicos.companyService.findById(tenant.id, cliente.id);
      expect(detalhe._count.deals).toBe(2);
      const { companies } = await servicos.companyService.findAll(tenant.id, {});
      expect(companies.find((c) => c.id === cliente.id)?._count.deals).toBe(2);
    });
  });

  describe('espelho, rodada 2 da revisão', () => {
    let servidor: Server;
    let recebidos: Array<{ rota: string; corpo: EventoRecebido }>;
    let respostaDoFlow: () => { status: number; texto: string };

    beforeAll(async () => {
      servidor = createServer((req: IncomingMessage, res: ServerResponse) => {
        let corpo = '';
        req.on('data', (p) => (corpo += p));
        req.on('end', () => {
          const rota = req.url ?? '';
          recebidos.push({ rota, corpo: JSON.parse(corpo) });
          const r = rota.endsWith('/functions/v1/espelho-contratos')
            ? respostaDoFlow()
            : { status: 200, texto: '{}' };
          res.writeHead(r.status, { 'Content-Type': 'application/json' });
          res.end(r.texto);
        });
      });
      await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
    });

    afterAll(async () => {
      await new Promise((r) => servidor.close(r));
    });

    const base = () => `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
    const colisao = () => ({
      status: 409,
      texto: JSON.stringify({ codigo: 'ESPELHO_COLISAO', mensagem: 'disputa' }),
    });

    async function preparar(eventos = ['contract.updated']) {
      const t = await novoTenant();
      await prisma.webhook.create({
        data: {
          tenantId: t.tenant.id,
          url: `${base()}/functions/v1/espelho-contratos`,
          events: eventos,
          secret: 's',
        },
      });
      // Outro assinante, que não é o Flow.
      await prisma.webhook.create({
        data: { tenantId: t.tenant.id, url: `${base()}/outro`, events: eventos, secret: 's' },
      });
      recebidos = [];
      respostaDoFlow = () => ({
        status: 200,
        texto: JSON.stringify({ flow_record_id: crypto.randomUUID() }),
      });
      return t;
    }

    const rodar = async (tenantId: string) => {
      const { reenviarContratosSemFlowRecordId } =
        await import('../jobs/contratoEspelhoChecker.js');
      return reenviarContratosSemFlowRecordId({ carenciaMs: -60_000, tenantId });
    };

    it('a rotina entrega só ao webhook do espelho do Flow (E-10, emenda)', async () => {
      const t = await preparar();
      const cliente = await novaEmpresa(t.tenant.id);
      const contrato = await prisma.contrato.create({
        data: { tenantId: t.tenant.id, companyId: cliente.id, numero: 'SO-FLOW' },
      });
      expect(await rodar(t.tenant.id)).toMatchObject({ enviados: 1, falhas: 0 });
      expect(recebidos.map((r) => r.rota)).toEqual(['/functions/v1/espelho-contratos']);
      const final = await prisma.contrato.findUniqueOrThrow({ where: { id: contrato.id } });
      expect(final.flowRecordId).toBeTruthy();
    });

    it('409 do Flow: marca o contrato, para de reenviar, avisa ADMIN e GESTOR uma vez por código recusado e volta quando o contrato muda (decisão 1)', async () => {
      const t = await preparar();
      const usuario = (role: string, status: string) =>
        prisma.user.create({
          data: {
            email: `${unico(role.toLowerCase())}@exemplo.com`,
            passwordHash: 'x',
            name: role,
            role: role as never,
            status: status as never,
            tenantId: t.tenant.id,
          },
        });
      const gestor = await usuario('GESTOR', 'ACTIVE');
      await usuario('GESTOR', 'INACTIVE');
      await usuario('ADMIN', 'INACTIVE');
      const cliente = await novaEmpresa(t.tenant.id);
      const contrato = await prisma.contrato.create({
        data: { tenantId: t.tenant.id, companyId: cliente.id, numero: 'DISPUTADO' },
      });
      respostaDoFlow = colisao;

      expect(await rodar(t.tenant.id)).toMatchObject({ enviados: 1, falhas: 1, recusados: 1 });
      const marcado = await prisma.contrato.findUniqueOrThrow({ where: { id: contrato.id } });
      expect(marcado.espelhoRecusadoNaVersao?.getTime()).toBe(contrato.updatedAt.getTime());
      // A marca não é mudança do contrato: `atualizado_desde` não o devolve por causa dela.
      expect(marcado.updatedAt.getTime()).toBe(contrato.updatedAt.getTime());

      const avisos = () =>
        prisma.notification.findMany({ where: { tenantId: t.tenant.id, type: 'SYSTEM' } });
      const primeiros = await avisos();
      // Quem pode corrigir o contrato (E-07): ADMIN e GESTOR ativos. Leitor e serviço, não.
      expect(primeiros.map((n) => n.userId).sort()).toEqual([t.admin.id, gestor.id].sort());
      expect(primeiros[0].title).toContain('DISPUTADO');
      expect(primeiros[0].message).toMatch(/Flow/);
      expect(primeiros[0].link).toBe(`/app/contratos?contrato=${contrato.id}`);

      // Parado até mudar.
      recebidos = [];
      expect(await rodar(t.tenant.id)).toMatchObject({ enviados: 0, falhas: 0 });
      expect(recebidos).toHaveLength(0);

      // Mudou no Engage sem mudar o código, como num movimento de saldo: volta a tentar, e a
      // nova recusa do mesmo código não repete o aviso.
      await new Promise((r) => setTimeout(r, 5));
      await prisma.contrato.update({ where: { id: contrato.id }, data: { objeto: 'corrigido' } });
      expect(await rodar(t.tenant.id)).toMatchObject({ enviados: 1, recusados: 1 });
      expect(recebidos.map((r) => r.rota)).toEqual(['/functions/v1/espelho-contratos']);
      expect(await avisos()).toHaveLength(2);
      // Código novo recusado: avisa de novo, uma vez por pessoa.
      await new Promise((r) => setTimeout(r, 5));
      await prisma.contrato.update({ where: { id: contrato.id }, data: { numero: 'DISPUTADO-2' } });
      expect(await rodar(t.tenant.id)).toMatchObject({ enviados: 1, recusados: 1 });
      const depois = await avisos();
      expect(depois).toHaveLength(4);
      expect(depois.filter((n) => n.title.includes('DISPUTADO-2'))).toHaveLength(2);
      // Voltar a um código já recusado não avisa de novo.
      await new Promise((r) => setTimeout(r, 5));
      await prisma.contrato.update({ where: { id: contrato.id }, data: { numero: 'DISPUTADO' } });
      expect(await rodar(t.tenant.id)).toMatchObject({ enviados: 1, recusados: 1 });
      expect(await avisos()).toHaveLength(4);

      // Resolvido no Flow e alterado aqui: o id é gravado.
      respostaDoFlow = () => ({
        status: 200,
        texto: JSON.stringify({ flow_record_id: crypto.randomUUID() }),
      });
      await new Promise((r) => setTimeout(r, 5));
      await prisma.contrato.update({ where: { id: contrato.id }, data: { objeto: 'de novo' } });
      expect(await rodar(t.tenant.id)).toMatchObject({ enviados: 1, falhas: 0 });
      expect(
        (await prisma.contrato.findUniqueOrThrow({ where: { id: contrato.id } })).flowRecordId
      ).toBeTruthy();
    });

    it('semeadura que muda campo do espelho em contrato existente dispara contract.updated (E-10)', async () => {
      const t = await preparar(['contract.created', 'contract.updated']);
      const cliente = await novaEmpresa(t.tenant.id);
      const flow = crypto.randomUUID();
      const linha = {
        flow_record_id: flow,
        codigo: 'SM-1',
        company_id: cliente.id,
        gerente_nome: 'Antigo',
        gerente_email: 'antigo@e.com',
        valor_contratado: '100',
      };
      await servicos.semear({ tenantId: t.tenant.id, linhas: [linha] });
      expect(recebidos).toHaveLength(0);

      // Só o valor muda: o espelho não leva valor, e nada é enviado.
      const soValor = await servicos.semear({
        tenantId: t.tenant.id,
        linhas: [{ ...linha, valor_contratado: '200' }],
      });
      expect(soValor.atualizados).toEqual([{ numero: 'SM-1', campos: ['valorContratado'] }]);
      expect(recebidos).toHaveLength(0);

      const r = await servicos.semear({
        tenantId: t.tenant.id,
        linhas: [
          { ...linha, valor_contratado: '200', gerente_nome: 'Novo', gerente_email: 'novo@e.com' },
        ],
      });
      expect(r.atualizados[0].campos).toEqual(['gerenteNome', 'gerenteEmail']);
      expect(r.espelhoFalhas).toEqual([]);
      // Alteração real vai a todo assinante, como pela tela.
      expect(recebidos.map((x) => x.rota).sort()).toEqual([
        '/functions/v1/espelho-contratos',
        '/outro',
      ]);
      const doFlow = recebidos.find((x) => x.rota.endsWith('espelho-contratos'))?.corpo;
      expect(doFlow?.event).toBe('contract.updated');
      expect(doFlow?.data).toMatchObject({
        flow_record_id: flow,
        codigo: 'SM-1',
        gerente_nome: 'Novo',
        gerente_email: 'novo@e.com',
      });

      // Falha na entrega vai para o relatório.
      recebidos = [];
      respostaDoFlow = () => ({ status: 500, texto: 'erro' });
      const falha = await servicos.semear({
        tenantId: t.tenant.id,
        linhas: [{ ...linha, valor_contratado: '200', planejador_nome: 'P' }],
      });
      expect(falha.espelhoFalhas).toEqual([
        { numero: 'SM-1', erro: expect.stringContaining('500') },
      ]);
    });
  });

  describe('nome Radar no texto visível (emenda de 03/11)', () => {
    it('origem do Negócio é "Radar"; a fonte "Captura" criada pelo cliente e os Negócios dela ficam como estavam', async () => {
      const { tenant } = await novoTenant();
      const doCliente = await prisma.dealSource.create({
        data: { tenantId: tenant.id, name: 'Captura' },
      });
      const comum = await prisma.deal.create({
        data: { tenantId: tenant.id, name: 'Lead da landing', value: 1, sourceId: doCliente.id },
      });
      // Duas primeiras chamadas simultâneas, como na primeira demanda e na semeadura.
      await Promise.all([servicos.garantirFunis(tenant.id), servicos.garantirFunis(tenant.id)]);

      const fontes = await prisma.dealSource.findMany({
        where: { tenantId: tenant.id },
        orderBy: { name: 'asc' },
      });
      expect(fontes.map((f) => f.name)).toEqual(['Captura', 'Radar']);
      expect(fontes.find((f) => f.name === 'Captura')?.id).toBe(doCliente.id);
      const depois = await prisma.deal.findUniqueOrThrow({
        where: { id: comum.id },
        include: { source: true },
      });
      expect(depois.source?.name).toBe('Captura');

      const nova = await novoTenant();
      await servicos.garantirFunis(nova.tenant.id);
      expect(
        (await prisma.dealSource.findMany({ where: { tenantId: nova.tenant.id } })).map(
          (f) => f.name
        )
      ).toEqual(['Radar']);
    });

    it('adendo aparece como "Adendo do Radar", sem repetir', async () => {
      const { body } = await criarDemanda(corpoDemanda());
      for (let i = 0; i < 2; i++) {
        await request(app)
          .patch(`/api/v1/captura/demandas/${body.engage_id}`)
          .set('X-API-Key', chaveEscrita)
          .send({ adendo: { texto: 'novidade do Radar', em: '2026-11-21T09:00:00Z' } });
      }
      const notas = await prisma.interaction.findMany({
        where: { dealId: body.engage_id, type: 'NOTE' },
      });
      expect(notas.map((n) => n.subject)).toEqual(['Adendo do Radar']);
    });

    it('coluna do funil do Radar não se exclui, e a mensagem diz isso', async () => {
      await servicos.garantirFunis(base.tenant.id);
      const coluna = await prisma.funnelColumn.findFirstOrThrow({
        where: { capturaEstado: 'ganha', funnel: { tenantId: base.tenant.id } },
      });
      const res = await request(app)
        .delete(`/api/v1/funnels/${coluna.funnelId}/columns/${coluna.id}`)
        .set('Authorization', base.sessaoAdmin);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Esta coluna é usada pelo Radar e não pode ser excluída');
    });
  });

  // ── Rodada 4 da revisão: o estado da demanda é função do conjunto de eventos ─────────

  describe('ordem de chegada não muda nada (E-15, rodada 4)', () => {
    type Passo = { estado: string; hora: string; extra?: Record<string, unknown>; id?: string };

    /** Uma fotografia de tudo o que os eventos determinam, para comparar chegadas. */
    async function fotografia(dealId: string) {
      const deal = await prisma.deal.findUniqueOrThrow({
        where: { id: dealId },
        select: {
          status: true,
          stage: true,
          probability: true,
          wonAt: true,
          lostAt: true,
          closedAt: true,
          deletedAt: true,
          pausedAt: true,
          value: true,
          lostReason: true,
          funnelId: true,
          funnelColumn: { select: { capturaEstado: true } },
        },
      });
      const demanda = await prisma.demanda.findFirstOrThrow({
        where: { dealId },
        select: {
          estado: true,
          ultimoEventoEm: true,
          triagemEm: true,
          orcamentoEm: true,
          enviadoEm: true,
          valorEnviado: true,
          aprovadoEm: true,
          valorAprovado: true,
          encerradoEm: true,
          motivo: true,
        },
      });
      const historico = await prisma.dealStageHistory.findMany({
        where: { dealId },
        orderBy: [{ enteredAt: 'asc' }, { exitedAt: 'asc' }],
        select: { stage: true, enteredAt: true, exitedAt: true },
      });
      const consumo = await prisma.contratoMovimento.groupBy({
        by: ['contratoId'],
        where: { dealId, tipo: 'CONSUMO' },
        _sum: { valor: true },
      });
      return JSON.parse(
        JSON.stringify({
          deal,
          demanda,
          historico,
          consumo: consumo
            .map((c) => [c.contratoId, String(c._sum.valor)])
            .filter(([, v]) => Number(v) !== 0),
        })
      );
    }

    const horaIso = (hora: string) => `2026-11-20T${hora}:00Z`;

    function permutacoesUnicas(n: number): number[][] {
      const todas: number[][] = [];
      const gerar = (resto: number[], feita: number[]) => {
        if (resto.length === 0) todas.push(feita);
        resto.forEach((x, i) =>
          gerar([...resto.slice(0, i), ...resto.slice(i + 1)], [...feita, x])
        );
      };
      gerar(
        Array.from({ length: n }, (_, i) => i),
        []
      );
      return todas;
    }

    async function emLotes<T>(tarefas: Array<() => Promise<T>>, tamanho = 8): Promise<T[]> {
      const saida: T[] = [];
      for (let i = 0; i < tarefas.length; i += tamanho) {
        saida.push(...(await Promise.all(tarefas.slice(i, i + tamanho).map((t) => t()))));
      }
      return saida;
    }

    let contratoDaVarredura: { id: string };
    let clienteDaVarredura: { id: string };

    beforeAll(async () => {
      clienteDaVarredura = await novaEmpresa(base.tenant.id, { name: 'Cliente da varredura' });
      contratoDaVarredura = await prisma.contrato.create({
        data: {
          tenantId: base.tenant.id,
          companyId: clienteDaVarredura.id,
          numero: unico('VARREDURA'),
          valorContratado: 100_000_000,
        },
      });
    });

    /** Cria uma demanda e aplica os passos na ordem de chegada dada, pelo serviço. */
    async function chegar(passos: Passo[], ordem: number[]) {
      const { criarDemanda: criar, aplicarEvento } =
        await import('../services/captura/demandaService.js');
      const { engage_id } = await criar(base.tenant.id, {
        chave_dedup: unico('ordem'),
        id_captura: crypto.randomUUID(),
        cenario: 'chamado_lta',
        fonte: 'x',
        nivel: 1,
        recebido_em_origem: new Date(horaIso('10:00')),
        capturado_em: new Date(horaIso('10:00')),
        cliente_id: clienteDaVarredura.id,
        contrato_id: contratoDaVarredura.id,
        objeto: 'Varredura',
        valor_estimado: 85000,
      });
      const demanda = await prisma.demanda.findFirstOrThrow({ where: { dealId: engage_id } });
      // `evento_id` é único no tenant: cada chegada usa ids novos, e o reenvio dentro dela
      // repete o mesmo id.
      const ids = new Map<string, string>();
      const idDe = (p: Passo) => {
        const chave = p.id as string;
        if (!ids.has(chave)) ids.set(chave, crypto.randomUUID());
        return ids.get(chave) as string;
      };
      for (const i of ordem) {
        const p = passos[i];
        await aplicarEvento(base.tenant.id, {
          evento_id: idDe(p),
          chave_dedup: demanda.chaveDedup,
          estado: p.estado as never,
          ocorrido_em: new Date(horaIso(p.hora)),
          ...(p.extra ?? {}),
        });
      }
      return fotografia(engage_id);
    }

    /**
     * Todas as ordens de chegada de uma sequência dão a fotografia da chegada em ordem. Passos
     * com o mesmo `id` são o mesmo evento reenviado.
     */
    async function conferirTodasAsOrdens(sequencia: Passo[]) {
      const passos = sequencia.map((p) => ({ ...p, id: p.id ?? crypto.randomUUID() }));
      const emOrdem = passos
        .map((_, i) => i)
        .sort((a, b) => passos[a].hora.localeCompare(passos[b].hora) || a - b);
      const vistas = new Set<string>();
      const ordens = [emOrdem, ...permutacoesUnicas(passos.length)].filter((o) => {
        const chave = o.map((i) => passos[i].id).join(',');
        if (vistas.has(chave)) return false;
        vistas.add(chave);
        return true;
      });
      const fotos = await emLotes(ordens.map((o) => () => chegar(passos, o)));
      const referencia = fotos[0];
      const divergentes = fotos
        .map((f, i) => ({ f, ordem: ordens[i] }))
        .filter(({ f }) => JSON.stringify(f) !== JSON.stringify(referencia))
        .map(({ ordem }) => ordem.map((i) => `${passos[i].estado}@${passos[i].hora}`).join(', '));
      return { ordens: ordens.length, divergentes, referencia };
    }

    const extraDe = (estado: string, i: number): Record<string, unknown> =>
      estado === 'orcamento_enviado'
        ? { valor_enviado: 100 + i }
        : estado === 'ganha'
          ? { valor_aprovado: 200 + i }
          : estado === 'perdida' || estado === 'declinada'
            ? { motivo: `Motivo ${i}` }
            : {};
    const ESTADOS = [
      'recebida',
      'em_triagem',
      'em_orcamento',
      'orcamento_enviado',
      'ganha',
      'perdida',
      'declinada',
      'cancelada',
      'descartada',
    ];
    const HORAS = ['12:00', '13:00', '14:00', '15:00', '16:00'];

    it('propriedade: de 1 a 5 eventos, toda ordem de chegada dá o mesmo resultado da chegada em ordem', async () => {
      const sequencias: Passo[][] = [];
      // 1 e 2 eventos: todos os estados e todos os pares.
      for (const a of ESTADOS)
        sequencias.push([{ estado: a, hora: HORAS[0], extra: extraDe(a, 0) }]);
      for (const a of ESTADOS) {
        for (const b of ESTADOS) {
          sequencias.push([
            { estado: a, hora: HORAS[0], extra: extraDe(a, 0) },
            { estado: b, hora: HORAS[1], extra: extraDe(b, 1) },
          ]);
        }
      }
      // 3 eventos: a varredura da revisão (62 sequências), como piso.
      const conjuntos = [
        ['em_triagem', 'em_orcamento', 'orcamento_enviado'],
        ['orcamento_enviado', 'ganha', 'perdida'],
        ['em_orcamento', 'descartada'],
      ];
      for (const estados of conjuntos) {
        for (const a of estados) {
          for (const b of estados) {
            for (const c of estados) {
              sequencias.push(
                [a, b, c].map((estado, i) => ({
                  estado,
                  hora: HORAS[i],
                  extra: extraDe(estado, i),
                }))
              );
            }
          }
        }
      }
      // 4 e 5 eventos: retrabalho, reversões, mesmo estado seguido, reenvio do mesmo evento.
      const reenviado = crypto.randomUUID();
      const ganhaReenviada = crypto.randomUUID();
      sequencias.push(
        [
          { estado: 'orcamento_enviado', hora: '13:00', extra: { valor_enviado: 100 } },
          { estado: 'em_orcamento', hora: '14:00' },
          { estado: 'orcamento_enviado', hora: '15:00', extra: { valor_enviado: 120 } },
          { estado: 'orcamento_enviado', hora: '16:00', extra: { valor_enviado: 130 } },
        ],
        [
          { estado: 'em_orcamento', hora: '12:00' },
          { estado: 'em_triagem', hora: '12:30' },
          { estado: 'em_orcamento', hora: '13:00' },
          { estado: 'orcamento_enviado', hora: '14:00', extra: { valor_enviado: 100 } },
        ],
        [
          { estado: 'em_orcamento', hora: '12:00' },
          {
            estado: 'orcamento_enviado',
            hora: '13:00',
            extra: { valor_enviado: 100 },
            id: reenviado,
          },
          { estado: 'orcamento_enviado', hora: '15:00', extra: { valor_enviado: 110 } },
          {
            estado: 'orcamento_enviado',
            hora: '13:00',
            extra: { valor_enviado: 100 },
            id: reenviado,
          },
        ],
        [
          { estado: 'orcamento_enviado', hora: '12:00', extra: { valor_enviado: 100 } },
          { estado: 'ganha', hora: '13:00', extra: { valor_aprovado: 200 } },
          { estado: 'orcamento_enviado', hora: '14:00', extra: { valor_enviado: 110 } },
          { estado: 'ganha', hora: '15:00', extra: { valor_aprovado: 190 } },
          { estado: 'perdida', hora: '16:00', extra: { motivo: 'Preço' } },
        ],
        [
          { estado: 'em_orcamento', hora: '12:00' },
          { estado: 'descartada', hora: '13:00' },
          { estado: 'descartada', hora: '14:00' },
          { estado: 'em_orcamento', hora: '15:00' },
          { estado: 'ganha', hora: '16:00', extra: { valor_aprovado: 50 } },
        ],
        [
          { estado: 'ganha', hora: '12:00', extra: { valor_aprovado: 100 } },
          { estado: 'ganha', hora: '13:00' },
          { estado: 'perdida', hora: '14:00' },
          { estado: 'perdida', hora: '15:00', extra: { motivo: 'Prazo' } },
          { estado: 'ganha', hora: '16:00', extra: { valor_aprovado: 80 } },
        ],
        [
          { estado: 'ganha', hora: '12:00', extra: { valor_aprovado: 100 }, id: ganhaReenviada },
          { estado: 'perdida', hora: '13:00', extra: { motivo: 'Preço' } },
          { estado: 'ganha', hora: '14:00', extra: { valor_aprovado: 90 } },
          { estado: 'ganha', hora: '12:00', extra: { valor_aprovado: 100 }, id: ganhaReenviada },
          { estado: 'declinada', hora: '15:00' },
        ]
      );

      let ordens = 0;
      const divergencias: string[] = [];
      for (const sequencia of sequencias) {
        const r = await conferirTodasAsOrdens(sequencia);
        ordens += r.ordens;
        for (const d of r.divergentes) {
          divergencias.push(`${sequencia.map((p) => `${p.estado}@${p.hora}`).join(' → ')} :: ${d}`);
        }
      }
      expect(divergencias).toEqual([]);
      // Piso: as 62 sequências de 3 eventos da revisão, nas 6 ordens, mais as de 1, 2, 4 e 5.
      // Ordens distintas: 9 + 81 × 2 + 62 × 6 + (24 + 24 + 12) + (120 × 3 + 60) = 1023.
      expect(sequencias.length).toBe(9 + 81 + 62 + 3 + 4);
      expect(ordens).toBe(1023);
    }, 900_000);

    const viaRota = async (passos: Passo[], ordem: number[]) => {
      const corpo = corpoDemanda({
        recebido_em_origem: horaIso('10:00'),
        capturado_em: horaIso('10:00'),
        valor_estimado: 85000,
      });
      const id = (await criarDemanda(corpo)).body.engage_id as string;
      const respostas: unknown[] = [];
      for (const i of ordem) {
        const p = passos[i];
        respostas.push(
          (
            await assinarEPostar(
              evento(corpo.chave_dedup, p.estado, horaIso(p.hora), p.extra ?? {})
            )
          ).body
        );
      }
      return { id, respostas, foto: await fotografia(id) };
    };
    const linhas = (foto: {
      historico: Array<{ stage: string; enteredAt: string; exitedAt: string | null }>;
    }) =>
      foto.historico.map((h) => [
        h.stage,
        h.enteredAt.slice(11, 16),
        h.exitedAt ? h.exitedAt.slice(11, 16) : 'ABERTA',
      ]);

    it.each([
      [
        'B1: mesmo estado, o primeiro chega por último',
        [
          { estado: 'em_orcamento', hora: '12:00' },
          { estado: 'orcamento_enviado', hora: '13:00', extra: { valor_enviado: 100 } },
          { estado: 'orcamento_enviado', hora: '15:00', extra: { valor_enviado: 120 } },
        ],
        [0, 2, 1],
        [
          ['recebida', '10:00', '12:00'],
          ['em_orcamento', '12:00', '13:00'],
          ['orcamento_enviado', '13:00', 'ABERTA'],
        ],
      ],
      [
        'B2: atrasado repete o estado em que cai',
        [
          { estado: 'em_orcamento', hora: '12:00' },
          { estado: 'em_orcamento', hora: '13:00' },
          { estado: 'orcamento_enviado', hora: '14:00', extra: { valor_enviado: 100 } },
        ],
        [0, 2, 1],
        [
          ['recebida', '10:00', '12:00'],
          ['em_orcamento', '12:00', '14:00'],
          ['orcamento_enviado', '14:00', 'ABERTA'],
        ],
      ],
      [
        'U1: retrabalho, a volta chega por último',
        [
          { estado: 'orcamento_enviado', hora: '13:00', extra: { valor_enviado: 100 } },
          { estado: 'em_orcamento', hora: '14:00' },
          { estado: 'orcamento_enviado', hora: '15:00', extra: { valor_enviado: 120 } },
          { estado: 'orcamento_enviado', hora: '16:00', extra: { valor_enviado: 130 } },
        ],
        [0, 2, 3, 1],
        [
          ['recebida', '10:00', '13:00'],
          ['orcamento_enviado', '13:00', '14:00'],
          ['em_orcamento', '14:00', '15:00'],
          ['orcamento_enviado', '15:00', 'ABERTA'],
        ],
      ],
      [
        'U2: atrasado com entrada seguinte do mesmo estado da anterior',
        [
          { estado: 'em_orcamento', hora: '12:00' },
          { estado: 'em_triagem', hora: '12:30' },
          { estado: 'em_orcamento', hora: '13:00' },
          { estado: 'orcamento_enviado', hora: '14:00', extra: { valor_enviado: 100 } },
        ],
        [0, 2, 3, 1],
        [
          ['recebida', '10:00', '12:00'],
          ['em_orcamento', '12:00', '12:30'],
          ['em_triagem', '12:30', '13:00'],
          ['em_orcamento', '13:00', '14:00'],
          ['orcamento_enviado', '14:00', 'ABERTA'],
        ],
      ],
    ] as Array<[string, Passo[], number[], string[][]]>)(
      '%s: as duas ordens dão o histórico esperado',
      async (_nome, passos, foraDeOrdem, esperado) => {
        const emOrdem = await viaRota(
          passos,
          passos.map((_, i) => i)
        );
        const atrasado = await viaRota(passos, foraDeOrdem);
        expect(atrasado.respostas[atrasado.respostas.length - 1]).toEqual({ aplicado: false });
        expect(linhas(emOrdem.foto)).toEqual(esperado);
        expect(atrasado.foto).toEqual(emOrdem.foto);
      }
    );

    it.each([
      [
        'M1: ganha repetida, a primeira chega por último',
        [
          { estado: 'orcamento_enviado', hora: '12:00', extra: { valor_enviado: 100 } },
          { estado: 'ganha', hora: '13:00', extra: { valor_aprovado: 90 } },
          { estado: 'ganha', hora: '14:00', extra: { valor_aprovado: 80 } },
        ],
        [0, 2, 1],
        { aprovadoEm: '13:00', encerradoEm: '13:00', wonAt: '13:00', closedAt: '13:00' },
      ],
      [
        'M2: perdida repetida, a primeira chega por último',
        [
          { estado: 'orcamento_enviado', hora: '12:00', extra: { valor_enviado: 100 } },
          { estado: 'perdida', hora: '13:00', extra: { motivo: 'Preço' } },
          { estado: 'perdida', hora: '14:00', extra: { motivo: 'Prazo' } },
        ],
        [0, 2, 1],
        { encerradoEm: '13:00', lostAt: '13:00', closedAt: '13:00' },
      ],
      [
        'M3: reversão, o envio do meio chega por último',
        [
          { estado: 'ganha', hora: '12:00', extra: { valor_aprovado: 90 } },
          { estado: 'orcamento_enviado', hora: '13:00', extra: { valor_enviado: 100 } },
          { estado: 'ganha', hora: '14:00', extra: { valor_aprovado: 80 } },
        ],
        [0, 2, 1],
        { aprovadoEm: '14:00', encerradoEm: '14:00', wonAt: '14:00', closedAt: '14:00' },
      ],
      [
        'M4: descartada repetida, a primeira chega por último',
        [
          { estado: 'em_orcamento', hora: '12:00' },
          { estado: 'descartada', hora: '13:00' },
          { estado: 'descartada', hora: '14:00' },
        ],
        [0, 2, 1],
        { encerradoEm: '13:00', deletedAt: '13:00' },
      ],
    ] as Array<[string, Passo[], number[], Record<string, string>]>)(
      '%s: as datas de fechamento são as da chegada em ordem',
      async (_nome, passos, foraDeOrdem, esperado) => {
        const emOrdem = await viaRota(
          passos,
          passos.map((_, i) => i)
        );
        const atrasado = await viaRota(passos, foraDeOrdem);
        const horas = (foto: Record<string, Record<string, string | null>>) =>
          Object.fromEntries(
            Object.keys(esperado).map((k) => {
              const v = foto.demanda[k] ?? foto.deal[k];
              return [k, v ? String(v).slice(11, 16) : null];
            })
          );
        expect(horas(emOrdem.foto)).toEqual(esperado);
        expect(atrasado.foto).toEqual(emOrdem.foto);
      }
    );
  });

  it('origem "Radar" que já existe é reaproveitada, e a desativação é respeitada na criação e na reclassificação (decisões de 03/11)', async () => {
    const { tenant, servico } = await novoTenant();
    const inativa = await prisma.dealSource.create({
      data: { tenantId: tenant.id, name: 'Radar', active: false },
    });
    await Promise.all([servicos.garantirFunis(tenant.id), servicos.garantirFunis(tenant.id)]);
    const fontes = () => prisma.dealSource.findMany({ where: { tenantId: tenant.id } });
    expect((await fontes()).map((f) => [f.id, f.name, f.active])).toEqual([
      [inativa.id, 'Radar', false],
    ]);

    // A demanda nasce na "Radar" existente, e a reclassificação também não a reativa.
    const { criarDemanda: criar, atualizarDemanda } =
      await import('../services/captura/demandaService.js');
    const cliente = await novaEmpresa(tenant.id);
    const { engage_id } = await criar(tenant.id, {
      chave_dedup: unico('radar'),
      id_captura: crypto.randomUUID(),
      cenario: 'contrato_novo',
      fonte: 'x',
      nivel: 1,
      recebido_em_origem: new Date('2026-11-20T10:00:00Z'),
      capturado_em: new Date('2026-11-20T10:00:00Z'),
      cliente_id: cliente.id,
      objeto: 'x',
    });
    const contrato = await prisma.contrato.create({
      data: { tenantId: tenant.id, companyId: cliente.id, numero: 'R-1' },
    });
    await atualizarDemanda(
      tenant.id,
      engage_id,
      { cenario: 'chamado_lta', contrato_id: contrato.id },
      servico.id
    );
    const deal = await prisma.deal.findUniqueOrThrow({ where: { id: engage_id } });
    expect(deal.sourceId).toBe(inativa.id);
    expect((await fontes()).map((f) => [f.id, f.active])).toEqual([[inativa.id, false]]);
  });

  // ── Rodada 5 da revisão ───────────────────────────────────────────────────────────

  describe('rodada 5 da revisão', () => {
    const horaR5 = (hora: string) => `2026-11-20T${hora}:00Z`;
    const sessao = (req: request.Test) => req.set('Authorization', base.sessaoAdmin);

    async function nova(extra: Record<string, unknown> = {}) {
      const corpo = corpoDemanda({
        recebido_em_origem: horaR5('10:00'),
        capturado_em: horaR5('10:00'),
        valor_estimado: 85000,
        ...extra,
      });
      const id = (await criarDemanda(corpo)).body.engage_id as string;
      return { corpo, id };
    }
    const postar = (chave: string, estado: string, hora: string, extra = {}) =>
      assinarEPostar(evento(chave, estado, horaR5(hora), extra));
    const valorDe = async (id: string) =>
      Number((await prisma.deal.findUniqueOrThrow({ where: { id } })).value);

    it('valor editado à mão, quando permitido, não é apagado por evento sem valor, em ordem ou atrasado (decisão 1)', async () => {
      const { corpo, id } = await nova();
      await postar(corpo.chave_dedup, 'ganha', '12:00');
      expect(await valorDe(id)).toBe(85000);
      await postar(corpo.chave_dedup, 'orcamento_enviado', '13:00');
      expect(await valorDe(id)).toBe(85000);

      // Sem valor do Flow, a tela deixa editar.
      const edicao = await sessao(request(app).put(`/api/v1/deals/${id}`)).send({ value: 500 });
      expect(edicao.status).toBe(200);
      expect(await valorDe(id)).toBe(500);

      // Em ordem e sem valor: a edição fica.
      await postar(corpo.chave_dedup, 'em_orcamento', '14:00');
      expect(await valorDe(id)).toBe(500);

      // Nova edição e um atrasado sem valor: a edição fica.
      expect(
        (await sessao(request(app).put(`/api/v1/deals/${id}`)).send({ value: 600 })).status
      ).toBe(200);
      const atrasado = await postar(corpo.chave_dedup, 'em_triagem', '11:00');
      expect(atrasado.body).toEqual({ aplicado: false });
      expect(await valorDe(id)).toBe(600);

      // Saída de ganha sem enviado: volta ao último valor fora do Flow.
      await postar(corpo.chave_dedup, 'ganha', '15:00', { valor_aprovado: 90 });
      expect(await valorDe(id)).toBe(90);
      await postar(corpo.chave_dedup, 'perdida', '16:00', { motivo: 'Preço' });
      expect(await valorDe(id)).toBe(600);

      // Com valor do Flow, ele manda.
      await postar(corpo.chave_dedup, 'orcamento_enviado', '17:00', { valor_enviado: 300 });
      expect(await valorDe(id)).toBe(300);
    });

    it('valor dos produtos, quando permitido, também é o valor fora do Flow (decisão 1)', async () => {
      const { corpo, id } = await nova();
      const produto = await prisma.product.create({
        data: { tenantId: base.tenant.id, name: unico('Produto'), unitPrice: 10 },
      });
      const add = await sessao(request(app).post(`/api/v1/deals/${id}/products`)).send({
        productId: produto.id,
        quantity: 3,
        unitPrice: 10,
      });
      expect(add.status).toBe(201);
      expect(await valorDe(id)).toBe(30);
      await postar(corpo.chave_dedup, 'em_triagem', '12:00');
      expect(await valorDe(id)).toBe(30);
    });

    it.each([
      [
        'ganha → descartada → ganha',
        [
          ['ganha', '12:00', { valor_aprovado: 70 }],
          ['descartada', '13:00', {}],
          ['ganha', '14:00', { valor_aprovado: 80 }],
        ],
        ['aprovadoEm', 'encerradoEm', 'wonAt', 'closedAt'],
      ],
      [
        'perdida → descartada → perdida',
        [
          ['perdida', '12:00', { motivo: 'Preço' }],
          ['descartada', '13:00', {}],
          ['perdida', '14:00', { motivo: 'Prazo' }],
        ],
        ['encerradoEm', 'lostAt', 'closedAt'],
      ],
    ] as Array<[string, Array<[string, string, Record<string, unknown>]>, string[]]>)(
      'datas de fechamento na última entrada no estado final: %s, nas duas ordens (decisão 2)',
      async (_nome, passos, campos) => {
        const horas = async (ordem: number[]) => {
          const { corpo, id } = await nova();
          for (const i of ordem) await postar(corpo.chave_dedup, ...passos[i]);
          const deal = (await prisma.deal.findUniqueOrThrow({
            where: { id },
          })) as unknown as Record<string, Date | null>;
          const demanda = (await prisma.demanda.findFirstOrThrow({
            where: { dealId: id },
          })) as unknown as Record<string, Date | null>;
          return Object.fromEntries(
            campos.map((c) => [c, (demanda[c] ?? deal[c])?.toISOString().slice(11, 16) ?? null])
          );
        };
        const esperado = Object.fromEntries(campos.map((c) => [c, '14:00']));
        expect(await horas([0, 1, 2])).toEqual(esperado);
        expect(await horas([0, 2, 1])).toEqual(esperado);
      }
    );

    it('perdida repetida sem motivo mantém o último motivo informado, nas duas ordens (decisão 3)', async () => {
      for (const ordem of [
        [0, 1],
        [1, 0],
      ]) {
        const { corpo, id } = await nova();
        const passos: Array<[string, string, Record<string, unknown>]> = [
          ['perdida', '12:00', { motivo: 'Preço' }],
          ['perdida', '13:00', {}],
        ];
        for (const i of ordem) await postar(corpo.chave_dedup, ...passos[i]);
        const deal = await prisma.deal.findUniqueOrThrow({ where: { id } });
        const demanda = await prisma.demanda.findFirstOrThrow({ where: { dealId: id } });
        expect([deal.lostReason, demanda.motivo]).toEqual(['Preço', 'Preço']);
      }
    });

    it('trocas de contrato cruzadas e simultâneas: as 80 terminam em 200, com o saldo certo (decisão 4)', async () => {
      const c1 = await novoContrato({ valorContratado: 1_000_000 });
      const c2 = await novoContrato({ valorContratado: 1_000_000 });
      const ganhaNo = async (contratoId: string, valor: number) => {
        const { corpo, id } = await nova({ cenario: 'chamado_lta', contrato_id: contratoId });
        await postar(corpo.chave_dedup, 'ganha', '12:00', { valor_aprovado: valor });
        return id;
      };
      const trocar = (id: string, contratoId: string) =>
        request(app)
          .patch(`/api/v1/captura/demandas/${id}`)
          .set('X-API-Key', chaveEscrita)
          .send({ contrato_id: contratoId });

      const status: number[] = [];
      const noC1: number[] = [];
      const noC2: number[] = [];
      for (let par = 0; par < 40; par++) {
        const a = await ganhaNo(c1.id, 10 + par);
        const b = await ganhaNo(c2.id, 100 + par);
        const [ra, rb] = await Promise.all([trocar(a, c2.id), trocar(b, c1.id)]);
        status.push(ra.status, rb.status);
        noC2.push(10 + par);
        noC1.push(100 + par);
      }
      expect(status.filter((s) => s !== 200)).toEqual([]);
      expect(status).toHaveLength(80);
      const soma = (xs: number[]) => xs.reduce((x, y) => x + y, 0);
      expect(await saldoDe(c1.id)).toBe(1_000_000 - soma(noC1));
      expect(await saldoDe(c2.id)).toBe(1_000_000 - soma(noC2));
    }, 120_000);
  });

  // ── Rodada 6 da revisão ───────────────────────────────────────────────────────────

  describe('rodada 6 da revisão', () => {
    const horaR6 = (hora: string) => `2026-11-20T${hora}:00Z`;
    const sessao = (req: request.Test) => req.set('Authorization', base.sessaoAdmin);
    const iniciar = (req: request.Test) => req.then((r) => r); // supertest só dispara no then
    // Conexões de controle num pool próprio: seguram travas sem tirar conexão do pool do Engage.
    let controle: import('@prisma/client').PrismaClient;

    // Pausa injetada só neste processo de teste: segura a edição da tela depois da guarda,
    // na leitura que confere o tenant (`dealService.update`), antes de qualquer gravação. Leituras
    // de Negócio sem `include` fora de transação, no PUT: a da auditoria na rota (o middleware
    // troca o findUnique por findFirst) e essa; a do meio (`findById`) tem `include`.
    let portao: {
      dealId: string;
      pular: number;
      chegou: () => void;
      espera: Promise<void>;
    } | null = null;
    function abrirPortao(dealId: string) {
      let chegou!: () => void;
      let liberar!: () => void;
      const chegada = new Promise<void>((r) => (chegou = r));
      const espera = new Promise<void>((r) => (liberar = r));
      portao = { dealId, pular: 1, chegou, espera };
      return { chegada, liberar };
    }

    beforeAll(async () => {
      const { PrismaClient } = await import('@prisma/client');
      controle = new PrismaClient();
      prisma.$use(async (params, next) => {
        const p = portao;
        if (
          p &&
          params.model === 'Deal' &&
          params.action === 'findFirst' &&
          !params.runInTransaction &&
          !params.args?.include &&
          params.args?.where?.id === p.dealId &&
          p.pular-- === 0
        ) {
          portao = null;
          p.chegou();
          await p.espera;
        }
        return next(params);
      });
    });

    afterAll(async () => {
      await controle?.$disconnect();
    });

    async function nova(extra: Record<string, unknown> = {}) {
      const corpo = corpoDemanda({
        recebido_em_origem: horaR6('10:00'),
        capturado_em: horaR6('10:00'),
        valor_estimado: 85000,
        ...extra,
      });
      const id = (await criarDemanda(corpo)).body.engage_id as string;
      return { corpo, id };
    }
    const postar = (chave: string, estado: string, hora: string, extra = {}) =>
      assinarEPostar(evento(chave, estado, horaR6(hora), extra));
    async function foto(id: string) {
      const deal = await prisma.deal.findUniqueOrThrow({ where: { id } });
      const demanda = await prisma.demanda.findFirstOrThrow({ where: { dealId: id } });
      return {
        value: Number(deal.value),
        name: deal.name,
        valorEstimado: demanda.valorEstimado === null ? null : Number(demanda.valorEstimado),
        itens: await prisma.dealProduct.count({ where: { dealId: id } }),
      };
    }
    /** Espera até `n` conexões deste banco estarem paradas na fila de alguma trava. */
    async function esperarNaFila(n: number) {
      for (let i = 0; i < 800; i++) {
        const [{ k }] = await controle.$queryRaw<Array<{ k: number }>>`
          SELECT count(*)::int AS k FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'`;
        if (k >= n) return;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error(`esperava ${n} conexão(ões) na fila de trava`);
    }
    /** Transação de outra conexão que trava `sql` e só termina quando `soltar` for chamado. */
    function segurar(
      travar: (t: import('@prisma/client').Prisma.TransactionClient) => Promise<unknown>
    ) {
      let travou!: () => void;
      let soltar!: () => void;
      const travada = new Promise<void>((r) => (travou = r));
      const solta = new Promise<void>((r) => (soltar = r));
      const fim = controle.$transaction(
        async (t) => {
          await travar(t);
          travou();
          await solta;
        },
        { timeout: 60_000, maxWait: 10_000 }
      );
      return { travada, soltar, fim };
    }
    async function novoProduto() {
      return prisma.product.create({
        data: { tenantId: base.tenant.id, name: unico('Produto'), unitPrice: 10 },
      });
    }

    it('corrida na tela: a edição passa da guarda, um evento com valor grava antes, e a edição recebe 403 com o valor do Flow (Lacuna 1)', async () => {
      const { corpo, id } = await nova();
      const { chegada, liberar } = abrirPortao(id);
      const put = iniciar(sessao(request(app).put(`/api/v1/deals/${id}`)).send({ value: 500 }));
      await chegada; // a edição já passou da guarda, sem valor do Flow à vista
      const ev = await postar(corpo.chave_dedup, 'orcamento_enviado', '13:00', {
        valor_enviado: 300,
      });
      expect(ev.body).toEqual({ aplicado: true });
      expect((await foto(id)).value).toBe(300);
      liberar();
      const resposta = await put;
      expect(resposta.status).toBe(403);
      expect(resposta.body.error ?? resposta.body.message).toBe('Andamento controlado pelo Flow');
      expect(await foto(id)).toMatchObject({ value: 300, valorEstimado: 85000 });
    });

    it('corrida na tela com o formulário inteiro: o valor que não mudou não é regravado por cima do valor do Flow (Lacuna 1)', async () => {
      const { corpo, id } = await nova();
      const { chegada, liberar } = abrirPortao(id);
      // A tela manda o valor que mostrou (85.000) junto com o resto do formulário.
      const put = iniciar(
        sessao(request(app).put(`/api/v1/deals/${id}`)).send({ name: 'Nome novo', value: 85000 })
      );
      await chegada;
      await postar(corpo.chave_dedup, 'orcamento_enviado', '13:00', { valor_enviado: 300 });
      liberar();
      expect((await put).status).toBe(200);
      expect(await foto(id)).toMatchObject({ value: 300, name: 'Nome novo', valorEstimado: 85000 });
    });

    // Desde a rodada 7, os produtos começam travando a demanda. Com o Produto travado por outra
    // conexão, o item espera segurando a demanda, e o evento com valor espera na fila dela: a
    // edição grava primeiro e o evento depois, com o valor do Flow por cima. O caso "evento antes"
    // está no teste da rodada 7, com a pausa antes da trava (403 e o item desfeito).
    it('corrida nos produtos: o item espera a trava do Produto segurando a demanda, e o evento com valor grava depois (Lacuna 1, r7)', async () => {
      const { corpo, id } = await nova();
      const produto = await novoProduto();
      const outra = segurar(
        (t) => t.$queryRaw`SELECT id FROM "products" WHERE id = ${produto.id} FOR UPDATE`
      );
      await outra.travada;
      const post = iniciar(
        sessao(request(app).post(`/api/v1/deals/${id}/products`)).send({
          productId: produto.id,
          quantity: 3,
          unitPrice: 10,
        })
      );
      await esperarNaFila(1); // o item espera a checagem de chave estrangeira do Produto
      const ev = postar(corpo.chave_dedup, 'orcamento_enviado', '13:00', { valor_enviado: 300 });
      await esperarNaFila(2); // o evento espera a trava da demanda, que o item segura
      outra.soltar();
      await outra.fim;
      expect((await post).status).toBe(201);
      expect((await ev).body).toEqual({ aplicado: true });
      expect(await foto(id)).toMatchObject({ value: 300, valorEstimado: 30, itens: 1 });
    });

    it('corrida ao apagar produto: o item travado por outra conexão, a exclusão segura a demanda, e o evento com valor grava depois (Lacuna 1, r7)', async () => {
      const { corpo, id } = await nova();
      const produto = await novoProduto();
      const add = await sessao(request(app).post(`/api/v1/deals/${id}/products`)).send({
        productId: produto.id,
        quantity: 3,
        unitPrice: 10,
      });
      expect(add.status).toBe(201);
      const itemId = add.body.data.id as string;
      const outra = segurar(
        (t) => t.$queryRaw`SELECT id FROM "deal_products" WHERE id = ${itemId} FOR UPDATE`
      );
      await outra.travada;
      const del = iniciar(sessao(request(app).delete(`/api/v1/deals/${id}/products/${itemId}`)));
      await esperarNaFila(1);
      const ev = postar(corpo.chave_dedup, 'orcamento_enviado', '13:00', { valor_enviado: 300 });
      await esperarNaFila(2);
      outra.soltar();
      await outra.fim;
      expect((await del).status).toBe(204);
      expect((await ev).body).toEqual({ aplicado: true });
      expect(await foto(id)).toMatchObject({ value: 300, valorEstimado: 0, itens: 0 });
    });

    it('80 rodadas simultâneas de edição e evento, na tela e nos produtos: com valor do Flow, o valor final é sempre o do Flow (Lacuna 1)', async () => {
      const produto = await novoProduto();
      const errados: Record<string, unknown[]> = {};
      const contagem: Record<string, number> = {};
      const casos: Array<[string, number]> = [
        ['tela_com_valor', 80],
        ['produtos_com_valor', 80],
        ['tela_sem_valor', 20],
        ['produtos_sem_valor', 20],
      ];
      for (const [caso, rodadas] of casos) {
        errados[caso] = [];
        for (let i = 0; i < rodadas; i++) {
          const { corpo, id } = await nova();
          const comValor = caso.endsWith('com_valor');
          const naTela = caso.startsWith('tela');
          // Atrasos escalonados para as duas ordens acontecerem: edição antes e evento antes.
          const [edicao, ev] = await Promise.all([
            (async () => {
              await new Promise((r) => setTimeout(r, (i * 7) % 6));
              return naTela
                ? sessao(request(app).put(`/api/v1/deals/${id}`)).send({ value: 500 })
                : sessao(request(app).post(`/api/v1/deals/${id}/products`)).send({
                    productId: produto.id,
                    quantity: 50,
                    unitPrice: 10,
                  });
            })(),
            (async () => {
              await new Promise((r) => setTimeout(r, (i % 10) * 6));
              return comValor
                ? postar(corpo.chave_dedup, 'orcamento_enviado', '13:00', { valor_enviado: 300 })
                : postar(corpo.chave_dedup, 'em_triagem', '13:00');
            })(),
          ]);
          const f = await foto(id);
          const aceita = edicao.status === 200 || edicao.status === 201;
          const certo =
            ev.status === 200 &&
            (aceita || edicao.status === 403) &&
            (comValor ? f.value === 300 : aceita && f.value === 500) &&
            // Recusada, a edição não deixa rastro; aceita, vira o valor fora do Flow.
            f.valorEstimado === (aceita ? 500 : 85000) &&
            f.itens === (!naTela && aceita ? 1 : 0);
          const chave = `${caso}: edicao_${edicao.status}`;
          contagem[chave] = (contagem[chave] ?? 0) + 1;
          if (comValor && f.value !== 300) {
            contagem[`${caso}: valor_final_errado`] =
              (contagem[`${caso}: valor_final_errado`] ?? 0) + 1;
          }
          if (!certo) errados[caso].push({ i, edicao: edicao.status, evento: ev.status, ...f });
        }
      }
      // eslint-disable-next-line no-console
      console.info(
        'rodadas simultâneas, por resposta da edição:',
        contagem,
        'primeiros errados:',
        JSON.stringify(
          Object.fromEntries(Object.entries(errados).map(([k, v]) => [k, v.slice(0, 3)]))
        )
      );
      expect(Object.fromEntries(Object.entries(errados).map(([k, v]) => [k, v.length]))).toEqual({
        tela_com_valor: 0,
        produtos_com_valor: 0,
        tela_sem_valor: 0,
        produtos_sem_valor: 0,
      });
    }, 300_000);

    // Lacuna 4: a repetição em impasse, provocada de propósito. Uma conexão de fora segura o
    // contrato; a transação do Engage trava a demanda e para na fila do contrato; a conexão de
    // fora pede a demanda. O Postgres desfaz quem esperava primeiro: a transação do Engage. Com a
    // máquina carregada, a conexão de fora pode pedir a demanda mais de 1 s (o `deadlock_timeout`)
    // depois de o Engage entrar na fila; aí a vítima é ela, e o teste repete a provocação.
    async function provocarImpasse(
      contratoId: string,
      demandaId: string,
      disparar: () => Promise<request.Response>,
      naRepeticao?: () => Promise<request.Response>
    ) {
      const { logger } = await import('../utils/logger.js');
      const aviso = vi.spyOn(logger, 'warn');
      let pediuDemanda!: () => void;
      const pedir = new Promise<void>((r) => (pediuDemanda = r));
      let pegou!: (erro: unknown) => void;
      const pegouDemanda = new Promise<unknown>((r) => (pegou = r));
      const outra = segurar(async (t) => {
        await t.$queryRaw`SELECT id FROM "Contrato" WHERE id = ${contratoId} FOR UPDATE`;
        // Segura o contrato e devolve o controle; a demanda é pedida quando o Engage estiver na fila.
        void pedir
          .then(() => t.$queryRaw`SELECT id FROM "Demanda" WHERE id = ${demandaId} FOR UPDATE`)
          .then(
            () => pegou(null),
            (erro) => pegou(erro)
          );
      });
      await outra.travada;
      const primeira = disparar();
      await esperarNaFila(1); // o Engage segura a demanda e espera o contrato
      pediuDemanda();
      // O Postgres desfez a transação do Engage, e a demanda passou para a conexão de fora.
      const erroDeFora = await pegouDemanda;
      if (erroDeFora) {
        outra.soltar();
        await outra.fim.catch(() => {});
        await primeira;
        aviso.mockRestore();
        return { vitimaDeFora: true as const };
      }
      let segunda: Promise<request.Response> | null = null;
      if (naRepeticao) {
        segunda = naRepeticao();
        await esperarNaFila(2); // a repetição e o reenvio esperam a demanda
      } else {
        await esperarNaFila(1); // a repetição espera a demanda
      }
      outra.soltar();
      await outra.fim; // a conexão de fora não foi a vítima
      const respostas = [await primeira, ...(segunda ? [await segunda] : [])];
      const repeticoes = aviso.mock.calls.filter((c) => String(c[0]).includes('impasse')).length;
      aviso.mockRestore();
      return { vitimaDeFora: false as const, respostas, repeticoes };
    }
    /**
     * Monta o cenário e provoca o impasse; repete, até 3 vezes, se a vítima for a de fora
     * (`provocar` devolve null nesse caso).
     */
    async function comImpasse<T>(provocar: () => Promise<T | null>): Promise<T> {
      for (let tentativa = 1; tentativa <= 3; tentativa++) {
        const r = await provocar();
        if (r) return r;
      }
      throw new Error('em 3 tentativas, a vítima do impasse foi a conexão de fora');
    }

    it('impasse provocado no evento, com reenvio do mesmo evento_id durante a repetição: grava uma vez só (Lacuna 4)', async () => {
      const { webhookDispatcher } = await import('../services/webhookDispatcher.js');
      const { contrato, id, ganha, respostas, repeticoes, doNegocio } = await comImpasse(
        async () => {
          const contrato = await novoContrato();
          const { corpo, id } = await nova({ cenario: 'chamado_lta', contrato_id: contrato.id });
          const demanda = await prisma.demanda.findFirstOrThrow({ where: { dealId: id } });
          const ganha = evento(corpo.chave_dedup, 'ganha', horaR6('12:00'), {
            valor_aprovado: 100,
          });
          const hook = vi.spyOn(webhookDispatcher, 'emitDealEvent');
          const r = await provocarImpasse(
            contrato.id,
            demanda.id,
            () => assinarEPostar(ganha),
            () => assinarEPostar(ganha)
          );
          const doNegocio = hook.mock.calls
            .filter((c) => (c[2] as { id?: string })?.id === id)
            .map((c) => c[1]);
          hook.mockRestore();
          return r.vitimaDeFora ? null : { ...r, contrato, id, ganha, doNegocio };
        }
      );

      expect(repeticoes).toBe(1);
      expect(respostas.map((r) => r.status)).toEqual([200, 200]);
      expect(respostas.map((r) => r.body.aplicado)).toEqual([true, true]);
      expect(
        await prisma.demandaEvento.count({
          where: { tenantId: base.tenant.id, eventoId: ganha.evento_id },
        })
      ).toBe(1);
      const movimentos = await prisma.contratoMovimento.findMany({ where: { dealId: id } });
      expect(movimentos.map((m) => [m.tipo, Number(m.valor)])).toEqual([['CONSUMO', 100]]);
      expect(await saldoDe(contrato.id)).toBe(900);
      expect(doNegocio.sort()).toEqual(['deal.stage_changed', 'deal.updated', 'deal.won']);
      expect(await foto(id)).toMatchObject({ value: 100 });
    }, 60_000);

    it('impasse provocado na troca de contrato pelo PATCH, com adendo: grava uma vez só (Lacuna 4)', async () => {
      const { c1, c2, id, demanda, respostas, repeticoes } = await comImpasse(async () => {
        const c1 = await novoContrato();
        const c2 = await novoContrato();
        const { corpo, id } = await nova({ cenario: 'chamado_lta', contrato_id: c1.id });
        await postar(corpo.chave_dedup, 'ganha', '12:00', { valor_aprovado: 100 });
        expect(await saldoDe(c1.id)).toBe(900);
        const demanda = await prisma.demanda.findFirstOrThrow({ where: { dealId: id } });
        const r = await provocarImpasse(c2.id, demanda.id, () =>
          iniciar(
            request(app)
              .patch(`/api/v1/captura/demandas/${id}`)
              .set('X-API-Key', chaveEscrita)
              .send({
                contrato_id: c2.id,
                adendo: { texto: 'adendo do impasse', em: horaR6('15:00') },
              })
          )
        );
        return r.vitimaDeFora ? null : { ...r, c1, c2, id, demanda };
      });

      expect(repeticoes).toBe(1);
      expect(respostas.map((r) => r.status)).toEqual([200]);
      expect(
        (await prisma.demanda.findUniqueOrThrow({ where: { id: demanda.id } })).contratoId
      ).toBe(c2.id);
      expect(await saldoDe(c1.id)).toBe(1000);
      expect(await saldoDe(c2.id)).toBe(900);
      expect(
        await prisma.interaction.count({ where: { dealId: id, subject: 'Adendo do Radar' } })
      ).toBe(1);
    }, 60_000);
  });

  // ── Rodada 7 da revisão ───────────────────────────────────────────────────────────

  describe('rodada 7 da revisão: toda escrita em Negócio com Demanda contra os eventos do Flow', () => {
    const horaR7 = (hora: string) => `2026-11-20T${hora}:00Z`;
    const iniciar = (req: request.Test) => req.then((r) => r);
    const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
    type Resposta = { status: number; body?: Record<string, unknown> };

    // Tenant próprio: os eventos vão para CAPTURA_TENANT_ID, trocado só durante este bloco.
    let t7: Awaited<ReturnType<typeof novoTenant>>;
    let chave7: string;
    let empresa7: { id: string };
    let automacaoId: string;
    let produtoId: string;
    let motivoId: string;
    let controle: import('@prisma/client').PrismaClient;
    const sessao = (req: request.Test) => req.set('Authorization', t7.sessaoAdmin);
    // Um servidor só, com conexões reaproveitadas: centenas de rodadas com `request(app)` abririam
    // um servidor e uma conexão por chamada e esgotariam as portas efêmeras do Windows.
    let servidor: Server;
    const agente = new Agent({ keepAlive: true });
    const chamada = (metodo: 'post' | 'put' | 'delete', caminho: string) =>
      request(servidor)[metodo](caminho).agent(agente);

    // Pausa injetada só neste processo de teste, no ponto que o caminho define.
    type Parametros = {
      model?: string;
      action: string;
      runInTransaction: boolean;
      args?: { where?: Record<string, unknown>; include?: Record<string, unknown> };
    };
    type Ponto = { casa: (p: Parametros) => boolean; pular?: number };
    let portao: {
      casa: (p: Parametros) => boolean;
      pular: number;
      chegou: () => void;
      espera: Promise<void>;
    } | null = null;
    function abrirPortao(ponto: Ponto) {
      let chegou!: () => void;
      let liberar!: () => void;
      const chegada = new Promise<void>((r) => (chegou = r));
      const espera = new Promise<void>((r) => (liberar = r));
      portao = { casa: ponto.casa, pular: ponto.pular ?? 0, chegou, espera };
      return { chegada, liberar };
    }

    beforeAll(async () => {
      const { PrismaClient } = await import('@prisma/client');
      controle = new PrismaClient();
      prisma.$use(async (params, next) => {
        const p = portao;
        if (p && p.casa(params as Parametros)) {
          if (p.pular > 0) p.pular--;
          else {
            portao = null;
            p.chegou();
            await p.espera;
          }
        }
        return next(params);
      });

      servidor = createServer(app).listen(0);
      t7 = await novoTenant();
      process.env.CAPTURA_TENANT_ID = t7.tenant.id;
      chave7 = await novaChave(t7.tenant.id, ['captura:write', 'contracts:read'], t7.servico.id);
      empresa7 = await novaEmpresa(t7.tenant.id);
      await servicos.garantirFunis(t7.tenant.id);
      // Uma tarefa automática em cada coluna dos funis do Radar e uma automação de troca de etapa:
      // se a edição tratasse a mudança do evento como dela, apareceriam aqui.
      const colunas = await prisma.funnelColumn.findMany({
        where: { funnel: { tenantId: t7.tenant.id }, capturaEstado: { not: null } },
      });
      await prisma.stageTaskTemplate.createMany({
        data: colunas.map((c) => ({
          tenantId: t7.tenant.id,
          funnelColumnId: c.id,
          taskTitle: 'Tarefa automática da coluna',
        })),
      });
      automacaoId = (
        await prisma.automation.create({
          data: {
            tenantId: t7.tenant.id,
            name: unico('Ao mudar etapa'),
            status: 'ACTIVE',
            trigger: { type: 'deal_stage_changed' },
            steps: [],
          },
        })
      ).id;
      produtoId = (
        await prisma.product.create({
          data: { tenantId: t7.tenant.id, name: unico('Produto'), unitPrice: 10 },
        })
      ).id;
      motivoId = (await prisma.lostReason.findFirstOrThrow({ where: { tenantId: t7.tenant.id } }))
        .id;
    });

    afterAll(async () => {
      process.env.CAPTURA_TENANT_ID = base.tenant.id;
      await controle?.$disconnect();
      agente.destroy();
      await new Promise((r) => servidor?.close(r));
    });

    async function nova() {
      const corpo = corpoDemanda({
        cliente_id: empresa7.id,
        recebido_em_origem: horaR7('10:00'),
        capturado_em: horaR7('10:00'),
        valor_estimado: 85000,
      });
      const res = await chamada('post', '/api/v1/captura/demandas')
        .set('X-API-Key', chave7)
        .send(corpo);
      expect(res.status).toBe(201);
      return { corpo, id: res.body.engage_id as string };
    }
    async function postar(chave: string, estado: string, hora: string, extra = {}) {
      const cru = JSON.stringify(evento(chave, estado, horaR7(hora), extra));
      const { assinarVyd } = await import('../utils/vydHmac.js');
      const ts = String(Math.floor(Date.now() / 1000));
      return chamada('post', '/api/v1/captura/eventos')
        .set('Content-Type', 'application/json')
        .set('X-VYD-Timestamp', ts)
        .set('X-VYD-Assinatura', assinarVyd(SEGREDO_EVENTOS, ts, cru))
        .send(cru);
    }

    /** O andamento do Negócio: o que só os eventos do Flow escrevem. */
    async function andamento(id: string) {
      const d = await prisma.deal.findFirstOrThrow({ where: { id } });
      const historico = await prisma.dealStageHistory.findMany({
        where: { dealId: id },
        orderBy: { enteredAt: 'asc' },
      });
      const iso = (v: Date | null) => v?.toISOString() ?? null;
      return {
        stage: d.stage,
        status: d.status,
        funnelId: d.funnelId,
        funnelColumnId: d.funnelColumnId,
        closedAt: iso(d.closedAt),
        wonAt: iso(d.wonAt),
        lostAt: iso(d.lostAt),
        lostReason: d.lostReason,
        pausedAt: iso(d.pausedAt),
        historico: historico.map((h) => [h.stage, iso(h.enteredAt), iso(h.exitedAt)]),
      };
    }

    // Os eventos de cada rodada: um em série antes (em_triagem) e um simultâneo à edição.
    const ROTEIROS: Record<string, [string, string, Record<string, unknown>]> = {
      em_orcamento: ['em_orcamento', '13:00', {}],
      ganha: ['ganha', '13:00', { valor_aprovado: 900 }],
      perdida: ['perdida', '13:00', { motivo: 'Preço' }],
      enviado: ['orcamento_enviado', '13:00', { valor_enviado: 300 }],
    };
    const NOMES = Object.keys(ROTEIROS);
    const VALOR_DO_FLOW: Record<string, number | null> = {
      em_orcamento: null,
      ganha: 900,
      perdida: null,
      enviado: 300,
    };

    // A aplicação em série: um Negócio gêmeo só com os eventos. Como nenhuma edição muda o
    // andamento, qualquer ordem em série de edição e evento dá este andamento.
    const oraculos = new Map<
      string,
      Awaited<ReturnType<typeof andamento>> & { probability: number }
    >();
    const gemeos = new Map<string, string>();
    async function oraculo(roteiro: string) {
      if (!oraculos.has(roteiro)) {
        const { corpo, id } = await nova();
        await postar(corpo.chave_dedup, 'em_triagem', '12:00');
        await postar(corpo.chave_dedup, ...ROTEIROS[roteiro]);
        const d = await prisma.deal.findFirstOrThrow({ where: { id } });
        oraculos.set(roteiro, { ...(await andamento(id)), probability: d.probability });
        gemeos.set(roteiro, id);
      }
      return oraculos.get(roteiro)!;
    }

    type Contexto = {
      stage: string;
      funnelId: string | null;
      funnelColumnId: string | null;
      probability: number;
      sourceId: string | null;
      itemId?: string;
    };
    type Caminho = {
      nome: string;
      /** Status aceitos; o 403 só quando `recusa` diz que a ordem justifica. */
      editar: (id: string, ctx: Contexto) => Promise<Resposta>;
      antes: (id: string, ctx: Contexto) => Ponto;
      /** Pausa antes de a edição ler o Negócio: o formulário foi aberto antes do evento. */
      leitura?: (id: string, ctx: Contexto) => Ponto;
      depois?: (id: string, ctx: Contexto) => Ponto;
      preparar?: (id: string, ctx: Contexto) => Promise<void>;
      conferir: (r: {
        id: string;
        status: number;
        roteiro: string;
        modo: string;
        ctx: Contexto;
        probabilidadeDoFlow: number;
      }) => Promise<string[]>;
      /** Campos que a auditoria da edição pode registrar, com o valor novo esperado. */
      auditoria?: (ctx: Contexto) => Record<string, unknown>;
    };

    const http = (req: request.Test) => iniciar(req) as Promise<Resposta>;
    async function direto(f: () => Promise<unknown>): Promise<Resposta> {
      try {
        await f();
        return { status: 200 };
      } catch (erro) {
        return { status: (erro as { statusCode?: number }).statusCode ?? 500 };
      }
    }
    const lerNegocio = (id: string) => prisma.deal.findFirstOrThrow({ where: { id } });

    // Pontos de pausa. "antes da leitura": antes de a edição ler o Negócio (a leitura da rota, a
    // 1ª sem `include`); "antes da trava": depois da guarda (a leitura `verified`, a 2ª) e antes
    // da trava; "depois da trava": já sob a trava.
    const leituraDoTenant = (id: string, pular: number): Ponto => ({
      casa: (p) =>
        p.model === 'Deal' &&
        p.action === 'findFirst' &&
        !p.runInTransaction &&
        !p.args?.include &&
        p.args?.where?.id === id,
      pular,
    });
    const leituraDoNegocioSobATrava = (id: string): Ponto => ({
      casa: (p) =>
        p.model === 'Deal' &&
        p.action === 'findFirst' &&
        p.runInTransaction &&
        p.args?.where?.id === id,
    });
    const leituraDaGuarda = (id: string): Ponto => ({
      casa: (p) =>
        p.model === 'Deal' &&
        p.action === 'findFirst' &&
        !p.runInTransaction &&
        !!p.args?.include &&
        p.args?.where?.id === id,
    });
    const recusado = (nome: string): Caminho => ({
      nome,
      editar: (id) => {
        const rota = { ganhar: 'win', perder: 'lose', pausar: 'pause', retomar: 'resume' }[nome];
        return rota
          ? http(
              sessao(chamada('post', `/api/v1/deals/${id}/${rota}`)).send(
                rota === 'lose' ? { lostReasonId: motivoId } : {}
              )
            )
          : http(sessao(chamada('delete', `/api/v1/deals/${id}`)));
      },
      antes: (id) =>
        nome === 'excluir'
          ? {
              casa: (p) =>
                p.model === 'Demanda' &&
                p.action === 'findFirst' &&
                !p.runInTransaction &&
                p.args?.where?.dealId === id,
            }
          : leituraDaGuarda(id),
      conferir: async ({ status }) => (status === 403 ? [] : [`respondeu ${status}`]),
    });
    /** A auditoria da edição só registra o que ela mesma gravou, nunca o que um evento mudou. */
    const auditoriaSo = async (id: string, permitidos: Record<string, unknown>) => {
      const logs = await prisma.auditLog.findMany({ where: { entityType: 'deal', entityId: id } });
      const mudancas = logs.flatMap(
        (l) => l.changes as Array<{ field: string; oldValue: unknown; newValue: unknown }>
      );
      return mudancas
        .filter(
          (m) =>
            !(m.field in permitidos) ||
            JSON.stringify(m.newValue) !== JSON.stringify(permitidos[m.field])
        )
        .map(
          (m) =>
            `auditoria: ${m.field} ${JSON.stringify(m.oldValue)} → ${JSON.stringify(m.newValue)}`
        );
    };

    const CAMINHOS: Caminho[] = [
      {
        nome: 'tela: o formulário do Radar',
        editar: (id, ctx) =>
          http(
            sessao(chamada('put', `/api/v1/deals/${id}`)).send({
              name: 'Nome da tela',
              value: 85000,
              probability: ctx.probability,
              notes: 'Nota da tela',
              leadId: null,
              assignedTo: null,
              sourceId: ctx.sourceId,
              originCampaignId: null,
              qualification: null,
              oneTimeValue: null,
              recurringValue: null,
              customFields: {},
            })
          ),
        antes: (id) => leituraDoTenant(id, 1),
        leitura: (id) => leituraDoTenant(id, 0),
        depois: leituraDoNegocioSobATrava,
        auditoria: (ctx) => ({
          name: 'Nome da tela',
          notes: 'Nota da tela',
          probability: ctx.probability,
        }),
        conferir: async ({ id, status, roteiro, modo, ctx, probabilidadeDoFlow }) => {
          const d = await lerNegocio(id);
          // Sem pausa, o evento pode chegar antes da leitura da edição. Aí o formulário é velho:
          // com valor do Flow, o valor de 85.000 é recusado; sem ele, a probabilidade que o
          // formulário mostrava é gravada como edição à mão (decisão da r7). Os dois são em série.
          // Com a pausa antes da leitura, essa ordem é certa: 403 com valor do Flow; sem ele, 200
          // com a probabilidade do formulário.
          const eventoAntes = modo === 'antes da leitura';
          if (VALOR_DO_FLOW[roteiro] !== null && (eventoAntes || status === 403)) {
            if (modo !== 'sem pausa' && !eventoAntes) return [`respondeu ${status}`];
            return status === 403 && d.name === 'Título curto do pedido'
              ? []
              : [`respondeu ${status}; nome ${d.name}`];
          }
          const erros = status === 200 ? [] : [`respondeu ${status}`];
          if (d.name !== 'Nome da tela' || d.notes !== 'Nota da tela')
            erros.push('edição não ficou');
          const certas = eventoAntes
            ? [ctx.probability]
            : modo === 'sem pausa'
              ? [probabilidadeDoFlow, ctx.probability]
              : [probabilidadeDoFlow];
          if (!certas.includes(d.probability)) erros.push(`probabilidade ${d.probability}`);
          return erros;
        },
      },
      {
        nome: 'API: etapa, funil e coluna iguais aos lidos',
        editar: (id, ctx) =>
          http(
            sessao(chamada('put', `/api/v1/deals/${id}`)).send({
              name: 'Nome pela API',
              stage: ctx.stage,
              funnelId: ctx.funnelId,
              funnelColumnId: ctx.funnelColumnId,
            })
          ),
        antes: (id) => leituraDoTenant(id, 1),
        leitura: (id) => leituraDoTenant(id, 0),
        depois: leituraDoNegocioSobATrava,
        auditoria: () => ({ name: 'Nome pela API' }),
        conferir: async ({ id, status, modo, probabilidadeDoFlow }) => {
          const d = await lerNegocio(id);
          // 403 quando o evento chegou antes da leitura: a etapa pedida já não era a atual. Com a
          // pausa antes da leitura, é obrigatório, e nada da edição fica.
          if (modo === 'antes da leitura') {
            return status === 403 && d.name === 'Título curto do pedido'
              ? []
              : [`respondeu ${status}; nome ${d.name}`];
          }
          if (status === 403 && modo === 'sem pausa')
            return d.name === 'Título curto do pedido' ? [] : ['403 com a edição gravada'];
          const erros = status === 200 ? [] : [`respondeu ${status}`];
          if (d.name !== 'Nome pela API') erros.push('edição não ficou');
          if (d.probability !== probabilidadeDoFlow) erros.push(`probabilidade ${d.probability}`);
          return erros;
        },
      },
      {
        nome: 'API: probabilidade, editável à mão (decisão da r7)',
        editar: (id) =>
          http(sessao(chamada('put', `/api/v1/deals/${id}`)).send({ probability: 55 })),
        antes: (id) => leituraDoTenant(id, 1),
        depois: leituraDoNegocioSobATrava,
        auditoria: () => ({ probability: 55 }),
        conferir: async ({ id, status, modo, probabilidadeDoFlow }) => {
          const d = await lerNegocio(id);
          const erros = status === 200 ? [] : [`respondeu ${status}`];
          // Em série: a edição depois do evento deixa 55; o evento depois da edição, a da etapa.
          const certas =
            modo === 'antes da trava'
              ? [55]
              : modo === 'depois da trava'
                ? [probabilidadeDoFlow]
                : [55, probabilidadeDoFlow];
          if (!certas.includes(d.probability)) erros.push(`probabilidade ${d.probability}`);
          return erros;
        },
      },
      {
        nome: 'quadro: reordenar na mesma coluna',
        editar: (id, ctx) =>
          http(
            sessao(chamada('post', '/api/v1/funnels/move-deal')).send({
              dealId: id,
              targetColumnId: ctx.funnelColumnId,
              position: 3,
            })
          ),
        antes: (_id, ctx) => ({
          casa: (p) =>
            p.model === 'FunnelColumn' &&
            p.action === 'findFirst' &&
            !p.runInTransaction &&
            p.args?.where?.id === ctx.funnelColumnId,
        }),
        depois: leituraDoNegocioSobATrava,
        conferir: async ({ id, status, modo }) => {
          // Sob a trava, a coluna é conferida de novo: se o evento já levou o Negócio para outra,
          // reordenar na coluna pedida seria mudar de coluna, e a resposta é 403 (evento antes).
          if (modo === 'antes da trava') return status === 403 ? [] : [`respondeu ${status}`];
          if (status === 403 && modo === 'sem pausa') return [];
          const d = await lerNegocio(id);
          const erros = status === 200 ? [] : [`respondeu ${status}`];
          if (d.positionInColumn !== 3) erros.push('posição não ficou');
          return erros;
        },
      },
      {
        nome: 'produtos: incluir',
        editar: (id) =>
          http(
            sessao(chamada('post', `/api/v1/deals/${id}/products`)).send({
              productId: produtoId,
              quantity: 7,
              unitPrice: 10,
            })
          ),
        antes: (id) => ({
          casa: (p) =>
            p.model === 'Demanda' &&
            p.action === 'findFirst' &&
            p.runInTransaction &&
            p.args?.where?.dealId === id,
        }),
        depois: () => ({
          casa: (p) => p.model === 'DealProduct' && p.action === 'create' && p.runInTransaction,
        }),
        conferir: async ({ id, status, roteiro, modo }) => {
          const itens = await prisma.dealProduct.count({ where: { dealId: id } });
          const flowAntes = VALOR_DO_FLOW[roteiro] !== null && modo !== 'depois da trava';
          if (status === 403) {
            return flowAntes && itens === 0
              ? []
              : [`403 com ${itens} item(ns), roteiro ${roteiro}`];
          }
          return status === 201 && itens === 1 && !(flowAntes && modo === 'antes da trava')
            ? []
            : [`respondeu ${status} com ${itens} item(ns), roteiro ${roteiro}`];
        },
      },
      {
        nome: 'produtos: apagar',
        preparar: async (id, ctx) => {
          const add = await sessao(chamada('post', `/api/v1/deals/${id}/products`)).send({
            productId: produtoId,
            quantity: 7,
            unitPrice: 10,
          });
          expect(add.status).toBe(201);
          ctx.itemId = add.body.data.id as string;
        },
        editar: (id, ctx) =>
          http(sessao(chamada('delete', `/api/v1/deals/${id}/products/${ctx.itemId}`))),
        antes: (id) => ({
          casa: (p) =>
            p.model === 'Demanda' &&
            p.action === 'findFirst' &&
            p.runInTransaction &&
            p.args?.where?.dealId === id,
        }),
        depois: () => ({
          casa: (p) => p.model === 'DealProduct' && p.action === 'delete' && p.runInTransaction,
        }),
        conferir: async ({ id, status, roteiro, modo }) => {
          const itens = await prisma.dealProduct.count({ where: { dealId: id } });
          const flowAntes = VALOR_DO_FLOW[roteiro] !== null && modo !== 'depois da trava';
          if (status === 403) {
            return flowAntes && itens === 1
              ? []
              : [`403 com ${itens} item(ns), roteiro ${roteiro}`];
          }
          return status === 204 && itens === 0 && !(flowAntes && modo === 'antes da trava')
            ? []
            : [`respondeu ${status} com ${itens} item(ns), roteiro ${roteiro}`];
        },
      },
      recusado('ganhar'),
      recusado('perder'),
      recusado('pausar'),
      recusado('retomar'),
      recusado('excluir'),
      {
        nome: 'copiloto: dealService.update com valor e notas',
        editar: (id) =>
          direto(() =>
            servicos.dealService.update(t7.tenant.id, {
              id,
              value: 500,
              notes: 'Nota do copiloto',
            })
          ),
        antes: (id) => leituraDoTenant(id, 0),
        depois: leituraDoNegocioSobATrava,
        conferir: async ({ id, status, roteiro, modo }) => {
          const d = await lerNegocio(id);
          const doFlow = VALOR_DO_FLOW[roteiro];
          const flowAntes = doFlow !== null && modo !== 'depois da trava';
          if (status === 403) {
            return flowAntes && d.notes === null ? [] : [`403 indevido, roteiro ${roteiro}`];
          }
          const erros = status === 200 ? [] : [`respondeu ${status}`];
          if (flowAntes && modo === 'antes da trava') erros.push('aceitou com valor do Flow');
          if (d.notes !== 'Nota do copiloto') erros.push('notas não ficaram');
          if (Number(d.value) !== (doFlow ?? 500)) erros.push(`valor ${Number(d.value)}`);
          return erros;
        },
      },
      {
        nome: 'reunião: dealService.update com notas',
        editar: (id) =>
          direto(() => servicos.dealService.update(t7.tenant.id, { id, notes: 'Nota da reunião' })),
        antes: (id) => leituraDoTenant(id, 0),
        depois: leituraDoNegocioSobATrava,
        conferir: async ({ id, status, probabilidadeDoFlow }) => {
          const d = await lerNegocio(id);
          const erros = status === 200 ? [] : [`respondeu ${status}`];
          if (d.notes !== 'Nota da reunião') erros.push('notas não ficaram');
          if (d.probability !== probabilidadeDoFlow) erros.push(`probabilidade ${d.probability}`);
          return erros;
        },
      },
    ];

    async function esperarNaFila(n: number, limiteMs: number) {
      for (const fim = Date.now() + limiteMs; Date.now() < fim; ) {
        const [{ k }] = await controle.$queryRaw<Array<{ k: number }>>`
          SELECT count(*)::int AS k FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'`;
        if (k >= n) return;
        await dormir(25);
      }
      throw new Error(`esperava ${n} conexão(ões) na fila de trava`);
    }

    async function rodada(c: Caminho, modo: string, i: number) {
      const roteiro = NOMES[i % NOMES.length];
      const esperado = await oraculo(roteiro);
      const { corpo, id } = await nova();
      await postar(corpo.chave_dedup, 'em_triagem', '12:00');
      const lido = await lerNegocio(id);
      const ctx: Contexto = {
        stage: lido.stage,
        funnelId: lido.funnelId,
        funnelColumnId: lido.funnelColumnId,
        probability: lido.probability,
        sourceId: lido.sourceId,
      };
      await c.preparar?.(id, ctx);
      const disparar = () => postar(corpo.chave_dedup, ...ROTEIROS[roteiro]);
      const erros: string[] = [];
      let edicao: Resposta;
      let ev: request.Response;
      if (modo === 'sem pausa') {
        [edicao, ev] = await Promise.all([
          (async () => {
            await dormir((i * 7) % 6);
            return c.editar(id, ctx);
          })(),
          (async () => {
            await dormir((i % 10) * 6);
            return disparar();
          })(),
        ]);
      } else {
        const ponto =
          modo === 'antes da leitura'
            ? c.leitura!(id, ctx)
            : modo === 'antes da trava'
              ? c.antes(id, ctx)
              : c.depois!(id, ctx);
        const { chegada, liberar } = abrirPortao(ponto);
        const edicaoP = c.editar(id, ctx);
        const chegou = await Promise.race([
          chegada.then(() => true),
          dormir(3000).then(() => false),
        ]);
        if (!chegou) {
          portao = null;
          erros.push('a pausa não disparou');
          [edicao, ev] = await Promise.all([edicaoP, disparar()]);
        } else if (modo === 'antes da leitura' || modo === 'antes da trava') {
          ev = await disparar(); // o evento grava inteiro antes da edição seguir
          liberar();
          edicao = await edicaoP;
        } else {
          const evP = disparar(); // o evento entra na fila da trava que a edição segura
          const naFila = await esperarNaFila(1, 5000).then(
            () => true,
            () => false
          );
          if (!naFila) erros.push('o evento não esperou a trava da edição');
          liberar();
          [edicao, ev] = await Promise.all([edicaoP, evP]);
        }
      }
      if (ev.status !== 200 || ev.body.aplicado !== true) erros.push(`evento ${ev.status}`);
      const { probability, ...andamentoEsperado } = esperado;
      const obtido = await andamento(id);
      if (JSON.stringify(obtido) !== JSON.stringify(andamentoEsperado)) {
        erros.push(`andamento ${JSON.stringify(obtido)}`);
      }
      erros.push(
        ...(await c.conferir({
          id,
          status: edicao.status,
          roteiro,
          modo,
          ctx,
          probabilidadeDoFlow: probability,
        }))
      );
      return { id, ctx, status: edicao.status, roteiro, erros };
    }

    it('para cada caminho de escrita, com e sem pausa: andamento, histórico, tarefas, gatilho e auditoria iguais aos da aplicação em série', async () => {
      const resumo: Record<string, Record<string, number>> = {};
      const errados: Record<string, unknown[]> = {};
      for (const c of CAMINHOS) {
        const modos: Array<[string, number]> = [
          ['sem pausa', 40],
          ...(c.leitura ? ([['antes da leitura', NOMES.length]] as Array<[string, number]>) : []),
          ['antes da trava', NOMES.length],
          ...(c.depois ? ([['depois da trava', NOMES.length]] as Array<[string, number]>) : []),
        ];
        const ids: string[] = [];
        const contextos = new Map<string, Contexto>();
        resumo[c.nome] = {};
        errados[c.nome] = [];
        for (const [modo, rodadas] of modos) {
          for (let i = 0; i < rodadas; i++) {
            const r = await rodada(c, modo, i);
            ids.push(r.id);
            contextos.set(r.id, r.ctx);
            const k = `${modo}: ${r.status}`;
            resumo[c.nome][k] = (resumo[c.nome][k] ?? 0) + 1;
            if (r.erros.length)
              errados[c.nome].push({ modo, i, roteiro: r.roteiro, erros: r.erros });
          }
        }
        // Efeitos assíncronos da edição: tarefas automáticas, gatilho e auditoria.
        await dormir(400);
        const tarefas = await prisma.task.count({ where: { dealId: { in: ids } } });
        if (tarefas) errados[c.nome].push(`${tarefas} tarefa(s) automática(s)`);
        const gatilhos = (
          await prisma.automationLog.findMany({ where: { automationId: automacaoId } })
        ).filter((l) => ids.includes((l.data as { dealId?: string } | null)?.dealId ?? ''));
        if (gatilhos.length) errados[c.nome].push(`${gatilhos.length} gatilho(s) de etapa`);
        if (c.auditoria) {
          for (const id of ids) {
            const fora = await auditoriaSo(id, c.auditoria(contextos.get(id)!));
            if (fora.length) errados[c.nome].push({ id, fora });
          }
        }
      }
      // eslint-disable-next-line no-console
      console.info(
        'rodada 7, respostas por caminho e modo:',
        JSON.stringify(resumo, null, 1),
        'errados por caminho:',
        JSON.stringify(Object.fromEntries(Object.entries(errados).map(([k, v]) => [k, v.length]))),
        'rodadas erradas por caminho e modo:',
        JSON.stringify(
          Object.fromEntries(
            Object.entries(errados).map(([k, v]) => [
              k,
              v.reduce<Record<string, number>>((acc, e) => {
                const modo = (e as { modo?: string }).modo ?? 'depois das rodadas';
                acc[modo] = (acc[modo] ?? 0) + 1;
                return acc;
              }, {}),
            ])
          )
        ),
        'primeiros errados:',
        JSON.stringify(
          Object.fromEntries(Object.entries(errados).map(([k, v]) => [k, v.slice(0, 2)]))
        )
      );
      expect(Object.fromEntries(Object.entries(errados).map(([k, v]) => [k, v.length]))).toEqual(
        Object.fromEntries(CAMINHOS.map((c) => [c.nome, 0]))
      );
      // Os gêmeos da aplicação em série, só com os eventos, também não têm tarefa.
      expect(await prisma.task.count({ where: { dealId: { in: [...gemeos.values()] } } })).toBe(0);
    }, 900_000);

    it('etapa, funil e coluna iguais num PUT não trocam a probabilidade editada à mão (recorte do andamento, r8)', async () => {
      const { id } = await nova();
      const manual = await sessao(chamada('put', `/api/v1/deals/${id}`)).send({ probability: 55 });
      expect(manual.status).toBe(200);
      const lido = await lerNegocio(id);
      expect(lido.probability).toBe(55);
      const res = await sessao(chamada('put', `/api/v1/deals/${id}`)).send({
        name: 'Nome com etapa igual',
        stage: lido.stage,
        funnelId: lido.funnelId,
        funnelColumnId: lido.funnelColumnId,
      });
      expect(res.status).toBe(200);
      const d = await lerNegocio(id);
      expect([d.name, d.probability, d.stage, d.funnelColumnId]).toEqual([
        'Nome com etapa igual',
        55,
        lido.stage,
        lido.funnelColumnId,
      ]);
      await dormir(400);
      const auditoria = await prisma.auditLog.findMany({
        where: { entityType: 'deal', entityId: id },
        orderBy: { createdAt: 'asc' },
      });
      expect(
        auditoria.map((l) => (l.changes as Array<{ field: string }>).map((c) => c.field))
      ).toEqual([['probability'], ['name']]);
    }, 60_000);

    it('Negócio comum segue como na base: a troca de etapa pela tela grava histórico, cria a tarefa e dispara o gatilho', async () => {
      const funil = await prisma.funnel.create({
        data: { tenantId: t7.tenant.id, name: unico('Funil comum'), type: 'DEAL' },
      });
      const [col1, col2] = await Promise.all([
        prisma.funnelColumn.create({ data: { funnelId: funil.id, title: 'Primeira', order: 0 } }),
        prisma.funnelColumn.create({ data: { funnelId: funil.id, title: 'Segunda', order: 1 } }),
      ]);
      await prisma.stageTaskTemplate.create({
        data: { tenantId: t7.tenant.id, funnelColumnId: col2.id, taskTitle: 'Tarefa da segunda' },
      });
      const deal = await prisma.deal.create({
        data: {
          tenantId: t7.tenant.id,
          name: unico('Negócio comum'),
          value: 100,
          stage: 'QUALIFICATION',
          funnelId: funil.id,
          funnelColumnId: col1.id,
        },
      });
      const res = await sessao(chamada('put', `/api/v1/deals/${deal.id}`)).send({
        stage: 'PROPOSAL',
        funnelId: funil.id,
        funnelColumnId: col2.id,
      });
      expect(res.status).toBe(200);
      await dormir(400);
      const historico = await prisma.dealStageHistory.findMany({ where: { dealId: deal.id } });
      expect(historico.map((h) => h.stage)).toEqual(['PROPOSAL']);
      expect(await prisma.task.count({ where: { dealId: deal.id } })).toBe(1);
      const gatilhos = (
        await prisma.automationLog.findMany({ where: { automationId: automacaoId } })
      ).filter((l) => (l.data as { dealId?: string } | null)?.dealId === deal.id);
      expect(gatilhos).toHaveLength(1);
      const auditoria = await prisma.auditLog.findMany({
        where: { entityType: 'deal', entityId: deal.id },
      });
      expect(
        auditoria.flatMap((l) => (l.changes as Array<{ field: string }>).map((c) => c.field))
      ).toEqual(['stage', 'probability']);
    }, 60_000);
  });
});
