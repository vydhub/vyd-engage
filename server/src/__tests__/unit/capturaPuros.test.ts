import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { DemandaCenario, DemandaEstado, Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/database.js', () => ({ __esModule: true, default: {} }));
vi.mock('../../services/webhookDispatcher.js', () => ({
  webhookDispatcher: { emit: vi.fn(), emitirEAguardar: vi.fn() },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { assinarVyd, conferirAssinaturaVyd } from '../../utils/vydHmac.js';
import {
  CALENDARIO_PROVISORIO,
  feriadosNacionais,
  horasUteisEntre,
  normalizarCalendario,
} from '../../services/captura/horasUteis.js';
import { calendarioDaApi, calendarioParaApi } from '../../services/captura/calendarioService.js';
import {
  calcularSaldo,
  dadosDoEspelho,
  lacunasDoContrato,
  normalizarEmail,
  normalizarNumero,
  soDigitos,
} from '../../services/contratoService.js';
import {
  calcularIndicadores,
  type LinhaIndicador,
} from '../../services/captura/indicadoresService.js';
import { normalizarDominio } from '../../services/captura/demandaService.js';
import { derivarDosEventos, type EventoDaDemanda } from '../../services/captura/derivacao.js';
import {
  lerCsv,
  lerData,
  lerDinheiro,
  lerItens,
  lerSolicitantes,
  validarLinha,
} from '../../services/captura/semeadura.js';

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

// Brasília é UTC-3. 23/11/2026 é segunda-feira; 20/11/2026 (sexta) é feriado nacional.
const br = (dia: number, hora: number, minuto = 0) =>
  new Date(Date.UTC(2026, 10, dia, hora + 3, minuto));

describe('HMAC (contrato 06, §1)', () => {
  const { segredo, timestamp, corpo, assinatura } = fixtures.hmac_vetor;
  const agoraMs = Number(timestamp) * 1000;

  it('bate com o vetor de teste obrigatório', () => {
    expect(assinarVyd(segredo, timestamp, corpo)).toBe(assinatura);
    expect(
      conferirAssinaturaVyd({ segredo, timestamp, assinatura, corpoCru: corpo, agoraMs })
    ).toBeNull();
  });

  it('recusa corpo alterado, mesmo que só um espaço', () => {
    expect(
      conferirAssinaturaVyd({ segredo, timestamp, assinatura, corpoCru: `${corpo} `, agoraMs })
    ).toBe('ASSINATURA_INVALIDA');
  });

  it('recusa segredo errado e assinatura sem o prefixo', () => {
    expect(
      conferirAssinaturaVyd({ segredo: 'outro', timestamp, assinatura, corpoCru: corpo, agoraMs })
    ).toBe('ASSINATURA_INVALIDA');
    expect(
      conferirAssinaturaVyd({
        segredo,
        timestamp,
        assinatura: assinatura.replace('sha256=', ''),
        corpoCru: corpo,
        agoraMs,
      })
    ).toBe('ASSINATURA_INVALIDA');
  });

  it('recusa cabeçalho ausente e timestamp que não é número', () => {
    expect(
      conferirAssinaturaVyd({ segredo, timestamp: undefined, assinatura, corpoCru: corpo, agoraMs })
    ).toBe('CABECALHO_AUSENTE');
    expect(
      conferirAssinaturaVyd({ segredo, timestamp, assinatura: undefined, corpoCru: corpo, agoraMs })
    ).toBe('CABECALHO_AUSENTE');
    expect(
      conferirAssinaturaVyd({ segredo, timestamp: 'ontem', assinatura, corpoCru: corpo, agoraMs })
    ).toBe('TIMESTAMP_INVALIDO');
  });

  it('janela de 300 s: 300 passa, 301 não, nos dois sentidos', () => {
    const conferir = (deslocamentoS: number) =>
      conferirAssinaturaVyd({
        segredo,
        timestamp,
        assinatura,
        corpoCru: corpo,
        agoraMs: agoraMs + deslocamentoS * 1000,
      });
    expect(conferir(300)).toBeNull();
    expect(conferir(-300)).toBeNull();
    expect(conferir(301)).toBe('FORA_DA_JANELA');
    expect(conferir(-301)).toBe('FORA_DA_JANELA');
  });
});

describe('calendário nas fixtures do adendo 06 (E-23)', () => {
  it('o provisório da spec é o exemplo das fixtures, nos dois sentidos', () => {
    expect(calendarioParaApi(CALENDARIO_PROVISORIO)).toEqual(fixtures.calendario);
    expect(calendarioDaApi(fixtures.calendario)).toEqual(CALENDARIO_PROVISORIO);
  });

  it.each(
    fixtures.horas_uteis_casos as Array<{ nome: string; de: string; ate: string; horas: number }>
  )('caso das fixtures: $nome', ({ de, ate, horas }) => {
    const calendario = calendarioDaApi(fixtures.calendario);
    expect(horasUteisEntre(new Date(de), new Date(ate), calendario)).toBe(horas);
  });
});

describe('horas úteis (E-23), conferidas à mão', () => {
  const cal = CALENDARIO_PROVISORIO;

  it('dentro do mesmo dia', () => {
    expect(horasUteisEntre(br(23, 9), br(23, 17, 30), cal)).toBe(8.5);
  });

  it('atravessa o fim de semana: sexta 17h a segunda 9h = 2 h', () => {
    expect(horasUteisEntre(br(27, 17), br(30, 9), cal)).toBe(2);
  });

  it('fim de semana inteiro não conta', () => {
    expect(horasUteisEntre(br(28, 10), br(29, 15), cal)).toBe(0);
  });

  it('feriado nacional não conta: quinta 17h a segunda 9h, com sexta 20/11 = 2 h', () => {
    expect(horasUteisEntre(br(19, 17), br(23, 9), cal)).toBe(2);
    // Sem excluir feriados, a sexta inteira entra.
    expect(
      horasUteisEntre(br(19, 17), br(23, 9), { ...cal, excluirFeriadosNacionais: false })
    ).toBe(12);
  });

  it('antes do expediente não conta', () => {
    expect(horasUteisEntre(br(24, 6), br(24, 8, 30), cal)).toBe(0.5);
  });

  it('depois do expediente não conta', () => {
    expect(horasUteisEntre(br(24, 17), br(24, 22), cal)).toBe(1);
  });

  it('fim antes do início dá 0', () => {
    expect(horasUteisEntre(br(24, 12), br(24, 9), cal)).toBe(0);
  });

  it('feriado extra do tenant não conta', () => {
    const extra = { ...cal, feriadosExtras: ['2026-11-24'] };
    expect(horasUteisEntre(br(24, 9), br(24, 17), extra)).toBe(0);
  });

  it('feriados nacionais de 2026, com a Sexta-feira Santa móvel', () => {
    const lista = feriadosNacionais(2026);
    expect(lista).toContain('2026-04-03');
    expect(lista).toContain('2026-11-20');
    expect(lista).toHaveLength(10);
    expect(feriadosNacionais(2027)).toContain('2027-03-26');
  });

  it('calendário inválido cai no valor provisório da spec-mãe', () => {
    expect(normalizarCalendario(null)).toEqual(CALENDARIO_PROVISORIO);
    const c = normalizarCalendario({ inicio: 'manhã', fuso: 'Marte/Olympus', diasUteis: [9] });
    expect(c.inicio).toBe('08:00');
    expect(c.fuso).toBe('America/Sao_Paulo');
    expect(c.diasUteis).toEqual([]);
  });
});

describe('saldo (E-06)', () => {
  const m = (tipo: 'ADITIVO' | 'AJUSTE' | 'CONSUMO', valor: number) => ({ tipo, valor });

  it('valor + aditivo + ajuste − consumo', () => {
    const saldo = calcularSaldo(100000, [
      m('ADITIVO', 20000),
      m('AJUSTE', -5000),
      m('CONSUMO', 30000),
    ]);
    expect(saldo?.toNumber()).toBe(85000);
  });

  it('reversão: CONSUMO negativo devolve o saldo', () => {
    const saldo = calcularSaldo(100000, [m('CONSUMO', 30000), m('CONSUMO', -30000)]);
    expect(saldo?.toNumber()).toBe(100000);
  });

  it('novo ganha com outro valor ajusta pela diferença', () => {
    const saldo = calcularSaldo(100000, [
      m('CONSUMO', 30000),
      m('CONSUMO', -30000),
      m('CONSUMO', 40000),
      m('CONSUMO', 5000),
    ]);
    expect(saldo?.toNumber()).toBe(55000);
  });

  it('valor acima do saldo: fica negativo, sem erro', () => {
    expect(calcularSaldo(1000, [m('CONSUMO', 2500)])?.toNumber()).toBe(-1500);
  });

  it('contrato sem valor: saldo não disponível', () => {
    expect(calcularSaldo(null, [m('ADITIVO', 100)])).toBeNull();
  });

  it('não acumula erro de ponto flutuante', () => {
    const saldo = calcularSaldo('0.30', [m('CONSUMO', 0.1), m('CONSUMO', 0.2)]);
    expect(saldo?.equals(new Prisma.Decimal(0))).toBe(true);
  });
});

describe('normalização e lacunas', () => {
  it('numero sem espaço nem tabulação nas pontas (fato medido no Flow)', () => {
    expect(normalizarNumero('E2180          ')).toBe('E2180');
    expect(normalizarNumero('G0025\t')).toBe('G0025');
    expect(normalizarNumero(' \tE 2180\n')).toBe('E 2180');
  });

  it('e-mail em minúsculas', () => {
    expect(normalizarEmail(' Fiscal@Cliente.COM.br ')).toBe('fiscal@cliente.com.br');
  });

  it('CNPJ só com dígitos; domínio sem protocolo, www, caminho ou usuário', () => {
    expect(soDigitos('12.345.678/0001-90')).toBe('12345678000190');
    expect(soDigitos('')).toBeNull();
    expect(normalizarDominio('https://www.Cliente.com.br/contato?x=1')).toBe('cliente.com.br');
    expect(normalizarDominio('contato@cliente.com.br')).toBe('cliente.com.br');
    expect(normalizarDominio('   ')).toBeNull();
  });

  it('marca sem solicitantes, sem SLA, sem valor e sem gerente', () => {
    expect(
      lacunasDoContrato({
        valorContratado: null,
        slaRespostaHoras: null,
        gerenteNome: null,
        gerenteEmail: null,
        totalSolicitantes: 0,
      })
    ).toEqual(['sem_solicitantes', 'sem_sla', 'sem_valor', 'sem_gerente']);
    expect(
      lacunasDoContrato({
        valorContratado: 1,
        slaRespostaHoras: 24,
        gerenteNome: 'G',
        gerenteEmail: null,
        totalSolicitantes: 1,
      })
    ).toEqual([]);
  });

  it('o espelho tem os campos da fixture espelho_contrato', () => {
    const dados = dadosDoEspelho({
      id: fixtures.espelho_contrato.data.id,
      flowRecordId: fixtures.espelho_contrato.data.flow_record_id,
      numero: 'CT-0042',
      gerenteNome: 'Gerente Exemplo',
      gerenteEmail: 'gerente@exemplo.com',
      planejadorNome: null,
      planejadorEmail: null,
      deletedAt: null,
      company: { name: 'Cliente Exemplo' },
    });
    expect(dados).toEqual(fixtures.espelho_contrato.data);
    expect(
      dadosDoEspelho({
        id: 'x',
        flowRecordId: null,
        numero: 'y',
        gerenteNome: null,
        gerenteEmail: null,
        planejadorNome: null,
        planejadorEmail: null,
        deletedAt: new Date(),
        company: { name: 'z' },
      }).ativo
    ).toBe(false);
  });
});

describe('indicadores (E-21, E-22), conferidos à mão', () => {
  const base = (extra: Partial<LinhaIndicador>): LinhaIndicador => ({
    engageId: 'id',
    objeto: 'o',
    cenario: DemandaCenario.contrato_novo,
    estado: DemandaEstado.recebida,
    recebidoEmOrigem: br(23, 9),
    orcamentoEm: null,
    enviadoEm: null,
    valorEnviado: null,
    aprovadoEm: null,
    valorAprovado: null,
    encerradoEm: null,
    slaRespostaHoras: null,
    clienteId: 'c',
    clienteNome: 'C',
    contratoId: null,
    contratoNumero: null,
    ...extra,
  });
  const lta = DemandaCenario.chamado_lta;

  const linhas: LinhaIndicador[] = [
    base({}), // 1 recebida
    base({ estado: 'em_triagem' }), // 2 em triagem: não é triada
    base({ estado: 'em_orcamento', orcamentoEm: br(24, 9) }), // 3 Go
    base({
      // 4 Go, 10 h
      estado: 'orcamento_enviado',
      recebidoEmOrigem: br(24, 10),
      orcamentoEm: br(24, 11),
      enviadoEm: br(25, 10),
      valorEnviado: 100000,
    }),
    base({
      // 5 Go, 4 h, ganha
      estado: 'ganha',
      recebidoEmOrigem: br(25, 8),
      orcamentoEm: br(25, 9),
      enviadoEm: br(25, 12),
      valorEnviado: 200000,
      aprovadoEm: br(26, 10),
      valorAprovado: 180000,
      encerradoEm: br(26, 10),
    }),
    base({
      // 6 Go, 10 h, perdida
      estado: 'perdida',
      recebidoEmOrigem: br(25, 8),
      orcamentoEm: br(25, 9),
      enviadoEm: br(25, 18),
      valorEnviado: 300000,
      encerradoEm: br(27, 10),
    }),
    base({ estado: 'declinada', encerradoEm: br(24, 10) }), // 7 No-go
    base({ estado: 'cancelada', encerradoEm: br(24, 10) }), // 8 fora
    base({
      // 9 descartada: fora de tudo, mesmo com datas e valor
      estado: 'descartada',
      orcamentoEm: br(24, 9),
      enviadoEm: br(25, 9),
      valorEnviado: 999999,
      encerradoEm: br(26, 9),
    }),
    base({
      // 10 chamado dentro do SLA de 24: 10 h
      cenario: lta,
      estado: 'orcamento_enviado',
      enviadoEm: br(24, 9),
      valorEnviado: 50000,
      slaRespostaHoras: 24,
    }),
    base({
      // 11 chamado fora do SLA de 8: 18 h
      cenario: lta,
      estado: 'ganha',
      enviadoEm: br(24, 17),
      valorEnviado: 70000,
      aprovadoEm: br(26, 11),
      valorAprovado: 60000,
      encerradoEm: br(26, 11),
      slaRespostaHoras: 8,
    }),
    base({
      // 12 chamado sem SLA, enviado sem valor, 2 h, perdido
      cenario: lta,
      estado: 'perdida',
      enviadoEm: br(23, 11),
      encerradoEm: br(27, 11),
    }),
    base({
      // 13 chamado ganho sem valor aprovado
      cenario: lta,
      estado: 'ganha',
      aprovadoEm: br(26, 12),
      encerradoEm: br(26, 12),
      slaRespostaHoras: 24,
    }),
    base({
      // 14 fora do período
      estado: 'ganha',
      recebidoEmOrigem: new Date('2026-10-05T12:00:00Z'),
      orcamentoEm: new Date('2026-10-06T12:00:00Z'),
      enviadoEm: new Date('2026-10-07T12:00:00Z'),
      valorEnviado: 777777,
      aprovadoEm: new Date('2026-10-10T12:00:00Z'),
      valorAprovado: 777777,
      encerradoEm: new Date('2026-10-10T12:00:00Z'),
    }),
  ];

  const periodo = { de: br(1, 0), ate: br(30, 23) };
  const r = calcularIndicadores(linhas, CALENDARIO_PROVISORIO, periodo);

  it('taxa de go: 4 Go de 5 triadas', () => {
    expect(r.taxaGo).toEqual({ go: 4, triadas: 5, taxa: 0.8 });
  });

  it('conversão: só orçamentos, 2 ganhas e 2 perdidas; declinada, cancelada e o 13 fora', () => {
    expect(r.conversao).toEqual({ ganhas: 2, perdidas: 2, taxa: 0.5 });
  });

  it('conversão: perdida sem orçamento não entra no denominador (E-21)', () => {
    const c = calcularIndicadores(
      [
        base({
          estado: 'ganha',
          orcamentoEm: br(24, 9),
          aprovadoEm: br(26, 9),
          valorAprovado: 1,
        }),
        base({ estado: 'ganha', enviadoEm: br(24, 9), aprovadoEm: br(26, 9), valorAprovado: 1 }),
        base({ estado: 'perdida', encerradoEm: br(26, 9) }),
      ],
      CALENDARIO_PROVISORIO,
      periodo
    );
    expect(c.conversao).toEqual({ ganhas: 2, perdidas: 0, taxa: 1 });
  });

  it('taxa de go: quem chegou a enviado ou a ganha sem passar por orçamento é triado e Go', () => {
    const c = calcularIndicadores(
      [
        base({ estado: 'orcamento_enviado', enviadoEm: br(24, 9) }),
        base({ estado: 'ganha', aprovadoEm: br(24, 9), valorAprovado: 1 }),
        base({ estado: 'em_orcamento', orcamentoEm: br(24, 9) }),
        // No-go só quando não chegou a nenhum dos três.
        base({ estado: 'declinada', encerradoEm: br(25, 9) }),
        base({ estado: 'declinada', enviadoEm: br(24, 9), encerradoEm: br(25, 9) }),
        // Contrato novo que chegou a enviado fora do período: não conta.
        base({
          estado: 'orcamento_enviado',
          enviadoEm: new Date('2026-10-07T12:00:00Z'),
        }),
        // Chamado não entra.
        base({ cenario: lta, estado: 'orcamento_enviado', enviadoEm: br(24, 9) }),
      ],
      CALENDARIO_PROVISORIO,
      periodo
    );
    expect(c.taxaGo).toEqual({ go: 4, triadas: 5, taxa: 0.8 });
  });

  it('taxa de go: vale a primeira das datas, para o mês certo', () => {
    const c = calcularIndicadores(
      [
        base({
          estado: 'ganha',
          enviadoEm: new Date('2026-10-07T12:00:00Z'),
          aprovadoEm: br(24, 9),
          valorAprovado: 1,
        }),
      ],
      CALENDARIO_PROVISORIO,
      periodo
    );
    expect(c.taxaGo.go).toBe(0);
  });

  it('tempo de atendimento: 54 h em 6 envios = 9 h', () => {
    expect(r.tempoAtendimento).toEqual({ enviadas: 6, mediaHorasUteis: 9 });
  });

  it('SLA: 1 de 2, com 1 fora da conta por não ter SLA', () => {
    expect(r.sla).toEqual({ dentro: 1, avaliados: 2, taxa: 0.5, semSla: 1 });
  });

  it('ticket enviado: soma ÷ nº de orçamentos enviados, 720 mil ÷ 6, com 1 sem valor', () => {
    expect(r.ticketEnviado).toEqual({ soma: 720000, quantidade: 6, media: 120000, semValor: 1 });
  });

  it('ticket aprovado: soma ÷ nº de aprovados, 240 mil ÷ 3, com 1 sem valor', () => {
    expect(r.ticketAprovado).toEqual({ soma: 240000, quantidade: 3, media: 80000, semValor: 1 });
  });

  it('ticket: enviados [100, 200, sem valor, 300] dão 150; aprovados [100, sem valor] dão 50', () => {
    const c = calcularIndicadores(
      [
        ...[100, 200, null, 300].map((valorEnviado) =>
          base({ estado: 'orcamento_enviado', enviadoEm: br(24, 9), valorEnviado })
        ),
        ...[100, null].map((valorAprovado) =>
          base({ estado: 'ganha', aprovadoEm: br(24, 9), valorAprovado })
        ),
      ],
      CALENDARIO_PROVISORIO,
      periodo
    );
    expect(c.ticketEnviado.media).toBe(150);
    expect(c.ticketAprovado.media).toBe(50);
  });

  it('sem nada para medir, as taxas ficam vazias em vez de dividir por zero', () => {
    const vazio = calcularIndicadores([], CALENDARIO_PROVISORIO, periodo);
    expect(vazio.taxaGo.taxa).toBeNull();
    expect(vazio.conversao.taxa).toBeNull();
    expect(vazio.tempoAtendimento.mediaHorasUteis).toBeNull();
    expect(vazio.sla.taxa).toBeNull();
    expect(vazio.ticketEnviado.media).toBeNull();
  });

  it('descartada não entra nem quando é a única linha', () => {
    const so = calcularIndicadores([linhas[8]], CALENDARIO_PROVISORIO, periodo);
    expect(so.taxaGo.go).toBe(0);
    expect(so.tempoAtendimento.enviadas).toBe(0);
    expect(so.ticketEnviado.quantidade).toBe(0);
  });
});

describe('derivação pelo conjunto de eventos (E-15)', () => {
  const ev = (
    estado: DemandaEstado,
    hora: string,
    extra: Partial<EventoDaDemanda> = {}
  ): EventoDaDemanda => ({
    eventoId: `${estado}-${hora}`,
    estado,
    ocorridoEm: new Date(`2026-11-20T${hora}:00Z`),
    recebidoEm: new Date('2026-11-21T00:00:00Z'),
    valorEnviado: null,
    valorAprovado: null,
    motivo: null,
    ...extra,
  });
  const baseDemanda = {
    recebidoEmOrigem: new Date('2026-11-20T10:00:00Z'),
    valorEstimado: new Prisma.Decimal(85000),
  };
  const permutar = <T>(xs: T[]): T[][] =>
    xs.length <= 1
      ? [xs]
      : xs.flatMap((x, i) =>
          permutar([...xs.slice(0, i), ...xs.slice(i + 1)]).map((r) => [x, ...r])
        );

  it('qualquer ordem de entrada dá o mesmo resultado (5 eventos, 120 ordens)', () => {
    const eventos = [
      ev(DemandaEstado.orcamento_enviado, '12:00', { valorEnviado: new Prisma.Decimal(100) }),
      ev(DemandaEstado.ganha, '13:00', { valorAprovado: new Prisma.Decimal(200) }),
      ev(DemandaEstado.orcamento_enviado, '14:00', { valorEnviado: new Prisma.Decimal(110) }),
      ev(DemandaEstado.ganha, '15:00'),
      ev(DemandaEstado.perdida, '16:00', { motivo: 'Preço' }),
    ];
    const referencia = JSON.stringify(derivarDosEventos(eventos, baseDemanda));
    for (const ordem of permutar(eventos)) {
      expect(JSON.stringify(derivarDosEventos(ordem, baseDemanda))).toBe(referencia);
    }
    const r = derivarDosEventos(eventos, baseDemanda);
    expect(r.demanda.estado).toBe('perdida');
    expect(r.demanda.encerradoEm?.toISOString()).toBe('2026-11-20T16:00:00.000Z');
    expect(r.negocio.value?.toString()).toBe('110');
    expect(r.historico.map((h) => h.stage)).toEqual([
      'recebida',
      'orcamento_enviado',
      'ganha',
      'orcamento_enviado',
      'ganha',
      'perdida',
    ]);
    expect(r.historico.filter((h) => h.exitedAt === null)).toHaveLength(1);
  });

  it('empate em ocorrido_em: vale a ordem de recebimento, e depois o evento_id', () => {
    const cedo = new Date('2026-11-21T00:00:00Z');
    const tarde = new Date('2026-11-21T00:00:01Z');
    const a = ev(DemandaEstado.ganha, '13:00', { eventoId: 'b', recebidoEm: cedo });
    const b = ev(DemandaEstado.perdida, '13:00', { eventoId: 'a', recebidoEm: tarde });
    expect(derivarDosEventos([b, a], baseDemanda).demanda.estado).toBe('perdida');
    const c = { ...b, recebidoEm: cedo };
    // Mesmo instante e mesmo recebimento: `evento_id` "a" vem antes de "b".
    expect(derivarDosEventos([a, c], baseDemanda).demanda.estado).toBe('ganha');
  });

  it('sem valor do Flow, o Negócio fica com o último valor definido fora dele, ou 0', () => {
    expect(
      derivarDosEventos(
        [ev(DemandaEstado.em_triagem, '12:00')],
        baseDemanda
      ).negocio.value.toString()
    ).toBe('85000');
    expect(
      derivarDosEventos([ev(DemandaEstado.ganha, '12:00')], {
        ...baseDemanda,
        valorEstimado: null,
      }).negocio.value.toString()
    ).toBe('0');
  });
});

describe('leitura da planilha da semeadura (E-09)', () => {
  it('lê separador ; e , com aspas e BOM', () => {
    expect(lerCsv('﻿a;b\n"1;2";"x ""y"""\n')).toEqual([{ a: '1;2', b: 'x "y"' }]);
    expect(lerCsv('a,b\n1,2\n\n3,4')).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
    expect(lerCsv('')).toEqual([]);
  });

  it('dinheiro em formato brasileiro e com ponto', () => {
    expect(lerDinheiro('R$ 1.234,56')?.toString()).toBe('1234.56');
    expect(lerDinheiro('1234.56')?.toString()).toBe('1234.56');
    expect(lerDinheiro('')).toBeNull();
    expect(lerDinheiro('mil')).toBe('invalido');
  });

  it('datas em ISO e no formato brasileiro', () => {
    expect(lerData('2026-04-01')).toBe('2026-04-01');
    expect(lerData('01/04/2026')).toBe('2026-04-01');
    expect(lerData('')).toBeNull();
    expect(lerData('abril')).toBe('invalido');
  });

  it('solicitantes: minúsculas, sem repetir; e-mail inválido recusa', () => {
    expect(lerSolicitantes('Fiscal <FISCAL@a.com>; fiscal@a.com; b@a.com')).toEqual([
      { nome: 'Fiscal', email: 'fiscal@a.com' },
      { nome: null, email: 'b@a.com' },
    ]);
    expect(lerSolicitantes('nada')).toBe('invalido');
    expect(lerSolicitantes('')).toEqual([]);
  });

  it('itens com e sem disciplina', () => {
    expect(lerItens('Manutenção | Mecânica; Elétrica')).toEqual([
      { descricao: 'Manutenção', disciplina: 'Mecânica' },
      { descricao: 'Elétrica', disciplina: null },
    ]);
  });

  it('validarLinha normaliza o código e aceita linha sem gerente', () => {
    const v = validarLinha(
      { flow_record_id: ' f1 ', codigo: 'E2180          ', company_id: 'c1' },
      2
    );
    if (typeof v === 'string') throw new Error(v);
    expect(v.numero).toBe('E2180');
    expect(v.flowRecordId).toBe('f1');
    expect(v.colunas.gerenteEmail).toBeNull();
    // Em branco fica nulo: o padrão LTA vale só ao criar, e rodar de novo não sobrescreve.
    expect(v.colunas.tipo).toBeNull();
  });

  it('validarLinha recusa valor e SLA fora da faixa das colunas', () => {
    const linha = { flow_record_id: 'f', codigo: 'x', company_id: 'c' };
    expect(validarLinha({ ...linha, valor_contratado: '1000000000000' }, 2)).toContain('teto');
    expect(validarLinha({ ...linha, consumo_inicial: '1000000000000' }, 2)).toContain('teto');
    expect(validarLinha({ ...linha, sla_resposta_horas: '3000000000' }, 2)).toContain(
      'sla_resposta_horas'
    );
    expect(typeof validarLinha({ ...linha, valor_contratado: '999999999999.99' }, 2)).toBe(
      'object'
    );
  });

  it('validarLinha recusa o que está errado, dizendo o quê', () => {
    expect(validarLinha({ flow_record_id: 'f', codigo: '  \t', company_id: 'c' }, 2)).toBe(
      'codigo vazio'
    );
    expect(validarLinha({ codigo: 'x', company_id: 'c' }, 2)).toBe('flow_record_id vazio');
    expect(validarLinha({ flow_record_id: 'f', codigo: 'x' }, 2)).toContain('company_id vazio');
    expect(
      validarLinha({ flow_record_id: 'f', codigo: 'x', company_id: 'c', tipo: 'OUTRO' }, 2)
    ).toContain('tipo inválido');
    expect(
      validarLinha(
        {
          flow_record_id: 'f',
          codigo: 'x',
          company_id: 'c',
          vigencia_inicio: '2027-01-01',
          vigencia_fim: '2026-01-01',
        },
        2
      )
    ).toContain('anterior');
    expect(
      validarLinha(
        { flow_record_id: 'f', codigo: 'x', company_id: 'c', sla_resposta_horas: '-2' },
        2
      )
    ).toContain('sla_resposta_horas');
  });
});
