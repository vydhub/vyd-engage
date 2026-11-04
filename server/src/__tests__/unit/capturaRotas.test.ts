import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

/**
 * Rotas de máquina da Captura com banco mockado: escopos, HMAC e validação contra as
 * fixtures do contrato. Transação e unicidade são provadas em capturaBancoReal.test.ts.
 */
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../config/database.js', () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));
vi.mock('../../services/captura/demandaService.js', () => ({
  criarDemanda: vi.fn(),
  atualizarDemanda: vi.fn(),
  aplicarEvento: vi.fn(),
  buscarClientes: vi.fn(),
}));
vi.mock('../../services/contratoService.js', () => ({
  contratoService: { listarParaApi: vi.fn() },
}));

import prisma from '../../config/database.js';
import {
  API_SCOPES,
  authenticateOrApiKey,
  requireExplicitScope,
  requireScope,
} from '../../middleware/apiKeyAuth.js';
import capturaRoutes from '../../routes/captura.js';
import contratosRoutes from '../../routes/contratos.js';
import {
  aplicarEvento,
  atualizarDemanda,
  buscarClientes,
  criarDemanda,
} from '../../services/captura/demandaService.js';
import { contratoService } from '../../services/contratoService.js';
import { assinarVyd } from '../../utils/vydHmac.js';

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const fixtures = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      'fixtures',
      'captura-contratos-fixtures.json'
    ),
    'utf8'
  )
);

const CHAVE = 'fcrm_chave_de_teste_captura';
let hash = '';
const USUARIO = {
  id: 'user-1',
  email: 'captura@k2mais.com.br',
  status: 'ACTIVE',
  tenantId: 'tenant-1',
  role: 'USER',
  isPlatformAdmin: false,
};

function chaveComEscopos(scopes: string[], userId: string | null = 'user-1') {
  prismaMock.apiKey.findMany.mockResolvedValue([
    { id: 'k1', tenantId: 'tenant-1', keyHash: hash, scopes, expiresAt: null, userId },
  ] as never);
  prismaMock.user.findUnique.mockResolvedValue(USUARIO as never);
}

function montarApp() {
  const app = express();
  app.use(
    express.json({
      verify: (req: Request & { rawBody?: string }, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    })
  );
  app.use('/api/v1/captura', capturaRoutes);
  app.use('/api/v1/contratos', contratosRoutes);
  app.post('/deals', authenticateOrApiKey('deals:read'), (_req, res) => {
    res.json({ ok: true });
  });
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.statusCode || 500).json({ error: err.message, code: err.code });
  });
  return app;
}

const SEGREDO = 'segredo-de-teste';

function postarEvento(corpo: unknown, opcoes: { ts?: string; assinatura?: string } = {}) {
  const cru = typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
  const ts = opcoes.ts ?? String(Math.floor(Date.now() / 1000));
  return request(montarApp())
    .post('/api/v1/captura/eventos')
    .set('Content-Type', 'application/json')
    .set('X-VYD-Timestamp', ts)
    .set('X-VYD-Assinatura', opcoes.assinatura ?? assinarVyd(SEGREDO, ts, cru))
    .send(cru);
}

beforeEach(async () => {
  mockReset(prismaMock);
  vi.clearAllMocks();
  if (!hash) hash = await bcrypt.hash(CHAVE, 4);
  prismaMock.apiKey.update.mockResolvedValue({} as never);
  process.env.CAPTURA_EVENTOS_HMAC = SEGREDO;
  process.env.CAPTURA_TENANT_ID = 'tenant-1';
  process.env.ENABLE_API_KEY_READ = 'true';
});

afterEach(() => {
  delete process.env.CAPTURA_EVENTOS_HMAC;
  delete process.env.CAPTURA_TENANT_ID;
  delete process.env.ENABLE_API_KEY_READ;
});

describe('escopos (E-18)', () => {
  it('API_SCOPES ganhou os dois escopos novos e manteve os antigos', () => {
    expect(API_SCOPES).toContain('contracts:read');
    expect(API_SCOPES).toContain('captura:write');
    expect(API_SCOPES).toContain('deals:read');
  });

  const req = (scopes: string[]) => ({ apiKey: { scopes } }) as unknown as Request;
  const executar = (mw: ReturnType<typeof requireScope>, r: Request) => {
    let erro: { statusCode?: number } | undefined;
    mw(r, {} as Response, (e?: unknown) => {
      erro = e as { statusCode?: number } | undefined;
    });
    return erro;
  };

  it('requireScope segue dando acesso total à chave legada: as rotas atuais não mudam', () => {
    expect(executar(requireScope('deals:read'), req([]))).toBeUndefined();
  });

  it('requireExplicitScope recusa a chave legada de escopo vazio', () => {
    expect(executar(requireExplicitScope('captura:write'), req([]))?.statusCode).toBe(403);
    expect(executar(requireExplicitScope('captura:write'), req(['deals:write']))?.statusCode).toBe(
      403
    );
    expect(executar(requireExplicitScope('captura:write'), req(['captura:write']))).toBeUndefined();
  });

  it('chave sem captura:write recebe 403 e não chega ao serviço', async () => {
    chaveComEscopos(['contracts:read']);
    const res = await request(montarApp())
      .post('/api/v1/captura/demandas')
      .set('X-API-Key', CHAVE)
      .send(fixtures.engage_criar_demanda);
    expect(res.status).toBe(403);
    expect(res.body.codigo).toBe('API_KEY_INSUFFICIENT_SCOPE');
    expect(res.body.mensagem).toBeTruthy();
    expect(criarDemanda).not.toHaveBeenCalled();
  });

  it('chave legada, de escopo vazio, recebe 403 nas rotas novas', async () => {
    chaveComEscopos([]);
    const escrita = await request(montarApp())
      .post('/api/v1/captura/demandas')
      .set('X-API-Key', CHAVE)
      .send(fixtures.engage_criar_demanda);
    expect(escrita.status).toBe(403);
    const leitura = await request(montarApp()).get('/api/v1/contratos').set('X-API-Key', CHAVE);
    expect(leitura.status).toBe(403);
    expect(contratoService.listarParaApi).not.toHaveBeenCalled();
  });

  it('chave não ligada a usuário não escreve', async () => {
    chaveComEscopos(['captura:write'], null);
    const res = await request(montarApp())
      .post('/api/v1/captura/demandas')
      .set('X-API-Key', CHAVE)
      .send(fixtures.engage_criar_demanda);
    expect(res.status).toBe(403);
    expect(res.body.codigo).toBe('API_KEY_NOT_BOUND');
  });

  it('rota comercial atual segue recusando escrita por chave', async () => {
    chaveComEscopos(['captura:write', 'deals:write']);
    const res = await request(montarApp()).post('/deals').set('X-API-Key', CHAVE).send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('API_KEY_READ_ONLY');
  });

  it('sem chave: 401 no formato do contrato', async () => {
    const res = await request(montarApp()).post('/api/v1/captura/demandas').send({});
    expect(res.status).toBe(401);
    expect(res.body.codigo).toBe('API_KEY_REQUIRED');
  });
});

describe('POST /captura/demandas (E-13)', () => {
  beforeEach(() => chaveComEscopos(['captura:write', 'contracts:read']));

  const postar = (corpo: unknown) =>
    request(montarApp())
      .post('/api/v1/captura/demandas')
      .set('X-API-Key', CHAVE)
      .send(corpo as object);

  it('a fixture passa no schema e chega ao serviço com as datas convertidas', async () => {
    vi.mocked(criarDemanda).mockResolvedValue(fixtures.engage_criar_demanda_resposta);
    const res = await postar(fixtures.engage_criar_demanda);
    expect(res.status).toBe(201);
    expect(res.body).toEqual(fixtures.engage_criar_demanda_resposta);
    const [tenant, entrada] = vi.mocked(criarDemanda).mock.calls[0];
    expect(tenant).toBe('tenant-1');
    expect(entrada.recebido_em_origem).toEqual(new Date('2026-11-20T13:58:00Z'));
    expect(entrada.valor_estimado).toBe(85000);
  });

  it('repetição responde 200', async () => {
    vi.mocked(criarDemanda).mockResolvedValue({
      ...fixtures.engage_criar_demanda_resposta,
      repetido: true,
    });
    const res = await postar(fixtures.engage_criar_demanda);
    expect(res.status).toBe(200);
    expect(res.body.repetido).toBe(true);
  });

  it.each([
    ['cliente_id', { cliente_id: undefined }],
    ['cliente_id', { cliente_id: 'nao-e-uuid' }],
    ['chave_dedup', { chave_dedup: '   ' }],
    ['cenario', { cenario: 'outro' }],
    ['recebido_em_origem', { recebido_em_origem: 'ontem' }],
    ['valor_estimado', { valor_estimado: -1 }],
    ['responsavel_email', { responsavel_email: 'não é e-mail' }],
  ])('dado inválido dá 422 com o campo %s', async (campo, trocar) => {
    const res = await postar({ ...fixtures.engage_criar_demanda, ...trocar });
    expect(res.status).toBe(422);
    expect(res.body.codigo).toBe('DADOS_INVALIDOS');
    expect(res.body.campo).toBe(campo);
    expect(criarDemanda).not.toHaveBeenCalled();
  });

  it('erro de campo do serviço sai como 422 com o campo', async () => {
    const erro = Object.assign(new Error('Chamado LTA exige contrato_id'), {
      statusCode: 422,
      code: 'DADOS_INVALIDOS',
      details: { campo: 'contrato_id' },
    });
    vi.mocked(criarDemanda).mockRejectedValue(erro);
    const res = await postar(fixtures.engage_criar_demanda);
    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      codigo: 'DADOS_INVALIDOS',
      mensagem: 'Chamado LTA exige contrato_id',
      campo: 'contrato_id',
    });
  });

  it('erro interno não vaza detalhe', async () => {
    vi.mocked(criarDemanda).mockRejectedValue(new Error('senha do banco no meio da mensagem'));
    const res = await postar(fixtures.engage_criar_demanda);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ codigo: 'ERRO_INTERNO', mensagem: 'Erro interno' });
  });
});

describe('PATCH /captura/demandas/:engage_id (E-14)', () => {
  beforeEach(() => chaveComEscopos(['captura:write']));
  const id = '55555555-5555-4555-8555-555555555555';
  const patch = (corpo: object, alvo = id) =>
    request(montarApp())
      .patch(`/api/v1/captura/demandas/${alvo}`)
      .set('X-API-Key', CHAVE)
      .send(corpo);

  it('aceita os campos do contrato e descarta o resto, inclusive estado', async () => {
    vi.mocked(atualizarDemanda).mockResolvedValue({ engage_id: id, engage_link: 'l' });
    const res = await patch({
      flow_card_id: '77777777-7777-4777-8777-777777777777',
      adendo: { texto: 'novidade', em: '2026-11-21T09:00:00Z' },
      estado: 'ganha',
    });
    expect(res.status).toBe(200);
    const entrada = vi.mocked(atualizarDemanda).mock.calls[0][2];
    expect(entrada).not.toHaveProperty('estado');
    expect(entrada.adendo?.em).toEqual(new Date('2026-11-21T09:00:00Z'));
    // O usuário de serviço da chave responde pelos movimentos desta rota (E-05).
    expect(vi.mocked(atualizarDemanda).mock.calls[0][3]).toBeTruthy();
  });

  it('id que não é uuid dá 404', async () => {
    const res = await patch({}, 'abc');
    expect(res.status).toBe(404);
    expect(res.body.codigo).toBe('DEMANDA_NAO_ENCONTRADA');
  });
});

describe('POST /captura/eventos (E-15)', () => {
  it('assinatura válida e a fixture do contrato: aplica, e o `tipo` é ignorado', async () => {
    vi.mocked(aplicarEvento).mockResolvedValue({ aplicado: true, repetido: false });
    const res = await postarEvento(fixtures.evento_estado);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ aplicado: true });
    const [tenant, evento] = vi.mocked(aplicarEvento).mock.calls[0];
    expect(tenant).toBe('tenant-1');
    expect(evento.estado).toBe('orcamento_enviado');
    expect(evento).not.toHaveProperty('tipo');
    expect(evento.ocorrido_em).toEqual(new Date('2026-11-22T14:03:00Z'));
  });

  it('fora de ordem: 200 com aplicado false', async () => {
    vi.mocked(aplicarEvento).mockResolvedValue({ aplicado: false, repetido: false });
    const res = await postarEvento(fixtures.evento_estado);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ aplicado: false });
  });

  it('demanda inexistente: 409 DEMANDA_INEXISTENTE', async () => {
    vi.mocked(aplicarEvento).mockResolvedValue(null);
    const res = await postarEvento(fixtures.evento_estado);
    expect(res.status).toBe(409);
    expect(res.body.codigo).toBe('DEMANDA_INEXISTENTE');
  });

  it('confere os bytes crus: corpo reformatado com a assinatura antiga é recusado', async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const cru = JSON.stringify(fixtures.evento_estado);
    const res = await postarEvento(JSON.stringify(fixtures.evento_estado, null, 2), {
      ts,
      assinatura: assinarVyd(SEGREDO, ts, cru),
    });
    expect(res.status).toBe(401);
    expect(res.body.codigo).toBe('ASSINATURA_INVALIDA');
    expect(aplicarEvento).not.toHaveBeenCalled();
  });

  it('fora da janela de 5 min: 401', async () => {
    const ts = String(Math.floor(Date.now() / 1000) - 301);
    const res = await postarEvento(fixtures.evento_estado, { ts });
    expect(res.status).toBe(401);
    expect(res.body.codigo).toBe('FORA_DA_JANELA');
  });

  it('sem cabeçalhos: 401, sem tocar no banco', async () => {
    const res = await request(montarApp())
      .post('/api/v1/captura/eventos')
      .send(fixtures.evento_estado);
    expect(res.status).toBe(401);
    expect(res.body.codigo).toBe('CABECALHO_AUSENTE');
    expect(aplicarEvento).not.toHaveBeenCalled();
  });

  it('sem segredo ou sem tenant configurado: 503, nunca aceita sem conferir', async () => {
    delete process.env.CAPTURA_EVENTOS_HMAC;
    expect((await postarEvento(fixtures.evento_estado)).status).toBe(503);
    process.env.CAPTURA_EVENTOS_HMAC = SEGREDO;
    delete process.env.CAPTURA_TENANT_ID;
    expect((await postarEvento(fixtures.evento_estado)).status).toBe(503);
    expect(aplicarEvento).not.toHaveBeenCalled();
  });

  it.each([
    ['evento_id', { evento_id: 'x' }],
    ['estado', { estado: 'aprovada' }],
    ['ocorrido_em', { ocorrido_em: 'agora' }],
  ])('corpo assinado mas inválido dá 422 no campo %s', async (campo, trocar) => {
    const res = await postarEvento({ ...fixtures.evento_estado, ...trocar });
    expect(res.status).toBe(422);
    expect(res.body.campo).toBe(campo);
  });

  it('as nove estados da M-04 são aceitos, e nenhum outro', async () => {
    vi.mocked(aplicarEvento).mockResolvedValue({ aplicado: true, repetido: false });
    for (const estado of [
      'recebida',
      'em_triagem',
      'em_orcamento',
      'orcamento_enviado',
      'ganha',
      'perdida',
      'declinada',
      'cancelada',
      'descartada',
    ]) {
      expect((await postarEvento({ ...fixtures.evento_estado, estado })).status).toBe(200);
    }
  });
});

describe('leitura (E-19)', () => {
  it('GET /contratos com a chave certa passa os parâmetros', async () => {
    chaveComEscopos(['contracts:read']);
    vi.mocked(contratoService.listarParaApi).mockResolvedValue(fixtures.contratos_lista);
    const res = await request(montarApp())
      .get('/api/v1/contratos?atualizado_desde=2026-11-01T00:00:00Z&limite=50&cursor=abc')
      .set('X-API-Key', CHAVE);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fixtures.contratos_lista);
    expect(contratoService.listarParaApi).toHaveBeenCalledWith('tenant-1', {
      atualizadoDesde: new Date('2026-11-01T00:00:00Z'),
      cursor: 'abc',
      limite: 50,
    });
  });

  it('limite acima de 200 dá 422', async () => {
    chaveComEscopos(['contracts:read']);
    const res = await request(montarApp())
      .get('/api/v1/contratos?limite=201')
      .set('X-API-Key', CHAVE);
    expect(res.status).toBe(422);
    expect(res.body.campo).toBe('limite');
  });

  it('busca de cliente exige ao menos um critério e devolve o formato do contrato', async () => {
    chaveComEscopos(['contracts:read']);
    vi.mocked(buscarClientes).mockResolvedValue(fixtures.clientes_busca);
    const vazio = await request(montarApp())
      .get('/api/v1/captura/clientes')
      .set('X-API-Key', CHAVE);
    expect(vazio.status).toBe(422);
    const res = await request(montarApp())
      .get('/api/v1/captura/clientes?cnpj=12345678000190')
      .set('X-API-Key', CHAVE);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fixtures.clientes_busca);
  });
});
