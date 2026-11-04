/**
 * Semeadura dos contratos (spec captura-demandas, filha 02, E-08 e E-09). O formato do CSV e
 * o uso estão em `server/scripts/captura-semear-contratos.ts`, que chama este módulo.
 */
import { ContractHolder, ContratoMovimentoTipo, ContratoTipo, Prisma } from '@prisma/client';
import prisma from '../../config/database.js';
import { webhookDispatcher } from '../webhookDispatcher.js';
import {
  dadosDoEspelho,
  emailOuNull,
  lacunasDoContrato,
  normalizarEmail,
  normalizarNumero,
  paraData,
} from '../contratoService.js';
import { garantirFunis } from './demandaService.js';

export const MOTIVO_ABERTURA = 'Saldo de abertura';
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
/** Teto das colunas Decimal(14, 2) de contrato e movimento. */
const TETO_DINHEIRO = '999999999999.99';

// ── Leitura do CSV ───────────────────────────────────────────────────────────────

/** Lê CSV com aspas, quebras de linha em campos e separador `,` ou `;`. */
export function lerCsv(texto: string): Array<Record<string, string>> {
  const limpo = texto.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const primeira = limpo.split('\n', 1)[0];
  const separador =
    (primeira.match(/;/g)?.length ?? 0) > (primeira.match(/,/g)?.length ?? 0) ? ';' : ',';

  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = '';
  let emAspas = false;
  for (let i = 0; i < limpo.length; i++) {
    const c = limpo[i];
    if (emAspas) {
      if (c === '"' && limpo[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') {
        emAspas = false;
      } else {
        campo += c;
      }
    } else if (c === '"') {
      emAspas = true;
    } else if (c === separador) {
      linha.push(campo);
      campo = '';
    } else if (c === '\n') {
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = '';
    } else {
      campo += c;
    }
  }
  if (campo !== '' || linha.length > 0) {
    linha.push(campo);
    linhas.push(linha);
  }

  const [cabecalho, ...corpo] = linhas.filter((l) => l.some((v) => v.trim() !== ''));
  if (!cabecalho) return [];
  const nomes = cabecalho.map((n) => n.trim().toLowerCase());
  return corpo.map((valores) => Object.fromEntries(nomes.map((n, i) => [n, valores[i] ?? ''])));
}

export function lerDinheiro(valor: string | undefined): Prisma.Decimal | null | 'invalido' {
  const bruto = (valor ?? '').trim().replace(/^R\$\s*/, '');
  if (bruto === '') return null;
  // "1.234,56" e "1234.56": a vírgula, quando existe, é o separador decimal.
  const normal = bruto.includes(',') ? bruto.replace(/\./g, '').replace(',', '.') : bruto;
  if (!/^-?\d+(\.\d+)?$/.test(normal)) return 'invalido';
  return new Prisma.Decimal(normal);
}

export function lerData(valor: string | undefined): string | null | 'invalido' {
  const bruto = (valor ?? '').trim();
  if (bruto === '') return null;
  const br = bruto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const iso = br ? `${br[3]}-${br[2]}-${br[1]}` : bruto;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(new Date(`${iso}T00:00:00Z`).getTime())) {
    return 'invalido';
  }
  return iso;
}

export function lerSolicitantes(
  valor: string | undefined
): Array<{ nome: string | null; email: string }> | 'invalido' {
  const partes = (valor ?? '')
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean);
  const unicos = new Map<string, { nome: string | null; email: string }>();
  for (const parte of partes) {
    const comNome = parte.match(/^(.*)<([^>]+)>$/);
    const email = normalizarEmail(comNome ? comNome[2] : parte);
    if (!EMAIL.test(email)) return 'invalido';
    // Mesmo solicitante com maiúsculas e minúsculas é um só.
    if (!unicos.has(email)) unicos.set(email, { nome: comNome?.[1].trim() || null, email });
  }
  return [...unicos.values()];
}

export function lerItens(
  valor: string | undefined
): Array<{ descricao: string; disciplina: string | null }> {
  return (valor ?? '')
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((parte) => {
      const [descricao, disciplina] = parte.split('|').map((v) => v.trim());
      return { descricao, disciplina: disciplina || null };
    });
}

// ── Relatório ────────────────────────────────────────────────────────────────────

export interface Relatorio {
  seco: boolean;
  linhasLidas: number;
  criados: Array<{ numero: string; flowRecordId: string | null; origem: 'planilha' | 'empresa' }>;
  atualizados: Array<{ numero: string; campos: string[] }>;
  semMudanca: string[];
  recusados: Array<{ linha: number | null; codigo: string; motivo: string }>;
  lacunas: Array<{ numero: string; lacunas: string[] }>;
  saldosDeAbertura: Array<{ numero: string; valor: string }>;
  ignorados: Array<{ numero: string; motivo: string }>;
  /** Entrega ao Flow que falhou: a rotina periódica do espelho tenta de novo (E-10). */
  espelhoFalhas: Array<{ numero: string; erro: string }>;
}

function relatorioVazio(seco: boolean): Relatorio {
  return {
    seco,
    linhasLidas: 0,
    criados: [],
    atualizados: [],
    semMudanca: [],
    recusados: [],
    lacunas: [],
    saldosDeAbertura: [],
    ignorados: [],
    espelhoFalhas: [],
  };
}

// ── Validação de uma linha ───────────────────────────────────────────────────────

interface LinhaValida {
  linha: number;
  numero: string;
  flowRecordId: string;
  companyId: string;
  colunas: {
    numeroCliente: string | null;
    /** Null quando a célula veio vazia: o padrão vale só ao criar. */
    tipo: ContratoTipo | null;
    objeto: string | null;
    escopo: string | null;
    vigenciaInicio: Date | null;
    vigenciaFim: Date | null;
    valorContratado: Prisma.Decimal | null;
    slaRespostaHoras: number | null;
    gerenteNome: string | null;
    gerenteEmail: string | null;
    planejadorNome: string | null;
    planejadorEmail: string | null;
  };
  solicitantes: Array<{ nome: string | null; email: string }>;
  itens: Array<{ descricao: string; disciplina: string | null }>;
  consumoInicial: Prisma.Decimal | null;
}

function texto(valor: string | undefined): string | null {
  const limpo = (valor ?? '').trim();
  return limpo === '' ? null : limpo;
}

export function validarLinha(bruta: Record<string, string>, linha: number): LinhaValida | string {
  const numero = normalizarNumero(bruta.codigo ?? '');
  const flowRecordId = (bruta.flow_record_id ?? '').trim();
  const companyId = (bruta.company_id ?? '').trim();
  if (!numero) return 'codigo vazio';
  if (!flowRecordId) return 'flow_record_id vazio';
  if (!companyId) return 'company_id vazio: resolva a empresa na planilha (P-06)';

  const tipoBruto = (bruta.tipo ?? '').trim().toUpperCase().replace('-', '_') || null;
  if (tipoBruto !== null && tipoBruto !== 'LTA' && tipoBruto !== 'GUARDA_CHUVA') {
    return `tipo inválido: ${bruta.tipo}`;
  }

  const inicio = lerData(bruta.vigencia_inicio);
  const fim = lerData(bruta.vigencia_fim);
  if (inicio === 'invalido') return `vigencia_inicio inválida: ${bruta.vigencia_inicio}`;
  if (fim === 'invalido') return `vigencia_fim inválida: ${bruta.vigencia_fim}`;
  if (inicio && fim && fim < inicio) return 'vigencia_fim anterior a vigencia_inicio';

  const valor = lerDinheiro(bruta.valor_contratado);
  if (valor === 'invalido') return `valor_contratado inválido: ${bruta.valor_contratado}`;
  if (valor?.isNegative()) return 'valor_contratado negativo';
  if (valor?.greaterThan(TETO_DINHEIRO)) return 'valor_contratado acima do teto';
  const consumo = lerDinheiro(bruta.consumo_inicial);
  if (consumo === 'invalido') return `consumo_inicial inválido: ${bruta.consumo_inicial}`;
  if (consumo?.isNegative()) return 'consumo_inicial negativo';
  if (consumo?.greaterThan(TETO_DINHEIRO)) return 'consumo_inicial acima do teto';

  const slaBruto = (bruta.sla_resposta_horas ?? '').trim();
  const sla = slaBruto === '' ? null : Number(slaBruto);
  if (sla !== null && (!Number.isInteger(sla) || sla <= 0 || sla > 2_147_483_647)) {
    return `sla_resposta_horas inválido: ${slaBruto}`;
  }

  for (const campo of ['gerente_email', 'planejador_email']) {
    const email = emailOuNull(bruta[campo]);
    if (email && !EMAIL.test(email)) return `${campo} inválido: ${bruta[campo]}`;
  }

  const solicitantes = lerSolicitantes(bruta.solicitantes);
  if (solicitantes === 'invalido') return `solicitantes inválidos: ${bruta.solicitantes}`;

  return {
    linha,
    numero,
    flowRecordId,
    companyId,
    colunas: {
      numeroCliente: texto(bruta.numero_cliente),
      tipo: tipoBruto,
      objeto: texto(bruta.objeto),
      escopo: texto(bruta.escopo),
      vigenciaInicio: paraData(inicio),
      vigenciaFim: paraData(fim),
      valorContratado: valor,
      slaRespostaHoras: sla,
      gerenteNome: texto(bruta.gerente_nome),
      gerenteEmail: emailOuNull(bruta.gerente_email),
      planejadorNome: texto(bruta.planejador_nome),
      planejadorEmail: emailOuNull(bruta.planejador_email),
    },
    solicitantes,
    itens: lerItens(bruta.itens),
    consumoInicial: consumo && !consumo.isZero() ? consumo : null,
  };
}

// ── Comparação: a segunda rodada não pode mudar nada ─────────────────────────────

function igual(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) {
    return (a ?? null) === (b ?? null);
  }
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Prisma.Decimal.isDecimal(a) || Prisma.Decimal.isDecimal(b)) {
    return new Prisma.Decimal(a as Prisma.Decimal.Value).equals(b as Prisma.Decimal.Value);
  }
  return a === b;
}

// ── Execução ─────────────────────────────────────────────────────────────────────

async function garantirAbertura(
  tx: Prisma.TransactionClient,
  tenantId: string,
  contratoId: string,
  numero: string,
  valor: Prisma.Decimal | null,
  autorId: string | null,
  relatorio: Relatorio
): Promise<boolean> {
  if (!valor) return false;
  const existente = await tx.contratoMovimento.findFirst({
    where: { contratoId, tipo: ContratoMovimentoTipo.CONSUMO, motivo: MOTIVO_ABERTURA },
    select: { id: true, valor: true },
  });
  if (existente) {
    // O saldo de abertura já lançado não é reescrito: correção é um ajuste, com motivo.
    if (!existente.valor.equals(valor)) {
      relatorio.ignorados.push({
        numero,
        motivo: `consumo_inicial ${valor.toFixed(2)} difere do saldo de abertura já lançado (${existente.valor.toFixed(2)}): corrija com um ajuste`,
      });
    }
    return false;
  }
  const movimento = await tx.contratoMovimento.create({
    data: {
      contratoId,
      tipo: ContratoMovimentoTipo.CONSUMO,
      valor,
      motivo: MOTIVO_ABERTURA,
      autorId,
    },
  });
  // E-05: `semear` só chega aqui com autor, porque recusa consumo_inicial sem ele.
  if (autorId) {
    await tx.auditLog.create({
      data: {
        tenantId,
        entityType: 'contrato_movimento',
        entityId: movimento.id,
        userId: autorId,
        action: 'create',
        changes: [
          { field: 'tipo', oldValue: null, newValue: ContratoMovimentoTipo.CONSUMO },
          { field: 'valor', oldValue: null, newValue: valor.toFixed(2) },
          { field: 'motivo', oldValue: null, newValue: MOTIVO_ABERTURA },
        ],
      },
    });
  }
  relatorio.saldosDeAbertura.push({ numero, valor: valor.toFixed(2) });
  return true;
}

class EnsaioSeco extends Error {}

/** Campos que o espelho leva ao Flow (`dadosDoEspelho`). Mudar outro não dispara evento. */
const CAMPOS_DO_ESPELHO = new Set([
  'numero',
  'companyId',
  'gerenteNome',
  'gerenteEmail',
  'planejadorNome',
  'planejadorEmail',
]);

/**
 * E-10: as linhas da planilha já estão no Flow, mas o contrato gerado dos campos `NOS` não
 * está, e o contrato que a planilha alterou precisa chegar alterado lá. Sem o id devolvido pelo
 * Flow, a Captura não preenche o campo Contrato do card. A entrega é aguardada porque o script
 * desconecta logo depois.
 */
async function espelhar(
  tenantId: string,
  evento: 'contract.created' | 'contract.updated',
  ids: string[],
  relatorio: Relatorio
): Promise<void> {
  if (ids.length === 0) return;
  const contratos = await prisma.contrato.findMany({
    where: { id: { in: ids } },
    include: { company: { select: { name: true } } },
  });
  for (const contrato of contratos) {
    const entregas = await webhookDispatcher.emitirEAguardar(
      tenantId,
      evento,
      dadosDoEspelho(contrato)
    );
    for (const entrega of entregas) {
      if (!entrega.ok) {
        relatorio.espelhoFalhas.push({ numero: contrato.numero, erro: entrega.erro ?? 'falha' });
      }
    }
  }
}

export async function semear(params: {
  tenantId: string;
  linhas: Array<Record<string, string>>;
  seco?: boolean;
  /** Usuário do tenant que responde pelo saldo de abertura. Obrigatório com consumo_inicial. */
  autorId?: string;
}): Promise<Relatorio> {
  const { tenantId, linhas } = params;
  const seco = params.seco ?? false;
  const autorId = params.autorId ?? null;
  const relatorio = relatorioVazio(seco);
  relatorio.linhasLidas = linhas.length;

  // E-05: todo movimento é auditado, e isso vale também para o saldo de abertura.
  if (linhas.some((l) => (l.consumo_inicial ?? '').trim() !== '')) {
    const autor = autorId
      ? await prisma.user.findFirst({ where: { id: autorId, tenantId }, select: { id: true } })
      : null;
    if (!autor) {
      throw new Error('consumo_inicial exige --autor <userId>, um usuário deste tenant (E-05)');
    }
  }

  // E-12: os funis existem antes da primeira demanda. O ensaio seco não grava nada.
  if (!seco) await garantirFunis(tenantId);

  // 1. Valida e recusa o que estiver em conflito, sem escolher sozinho.
  const validas: LinhaValida[] = [];
  linhas.forEach((bruta, i) => {
    const linha = i + 2; // +1 do cabeçalho, +1 da contagem a partir de 1
    const resultado = validarLinha(bruta, linha);
    if (typeof resultado === 'string') {
      relatorio.recusados.push({ linha, codigo: (bruta.codigo ?? '').trim(), motivo: resultado });
    } else {
      validas.push(resultado);
    }
  });

  const porChave = (chave: (l: LinhaValida) => string) => {
    const mapa = new Map<string, LinhaValida[]>();
    for (const l of validas) mapa.set(chave(l), [...(mapa.get(chave(l)) ?? []), l]);
    return mapa;
  };
  const repetidas = new Set<LinhaValida>();
  for (const [numero, grupo] of porChave((l) => l.numero)) {
    if (grupo.length > 1) {
      for (const l of grupo) {
        repetidas.add(l);
        relatorio.recusados.push({
          linha: l.linha,
          codigo: numero,
          motivo: `código repetido depois de normalizar, nas linhas ${grupo.map((g) => g.linha).join(', ')}`,
        });
      }
    }
  }
  for (const [flowRecordId, grupo] of porChave((l) => l.flowRecordId)) {
    if (grupo.length > 1) {
      for (const l of grupo) {
        if (repetidas.has(l)) continue;
        repetidas.add(l);
        relatorio.recusados.push({
          linha: l.linha,
          codigo: l.numero,
          motivo: `flow_record_id ${flowRecordId} repetido, nas linhas ${grupo.map((g) => g.linha).join(', ')}`,
        });
      }
    }
  }
  const aceitas = validas.filter((l) => !repetidas.has(l));
  const gerados: string[] = [];
  const alteradosNoEspelho: string[] = [];

  try {
    await prisma.$transaction(
      async (tx) => {
        // 2. Linhas da planilha.
        for (const linha of aceitas) {
          const empresa = await tx.company.findFirst({
            where: { id: linha.companyId, tenantId, deletedAt: null },
            select: { id: true },
          });
          if (!empresa) {
            relatorio.recusados.push({
              linha: linha.linha,
              codigo: linha.numero,
              motivo: `empresa ${linha.companyId} não encontrada neste tenant`,
            });
            continue;
          }

          const porFlow = await tx.contrato.findUnique({
            where: { flowRecordId: linha.flowRecordId },
          });
          if (porFlow && porFlow.tenantId !== tenantId) {
            relatorio.recusados.push({
              linha: linha.linha,
              codigo: linha.numero,
              motivo: `flow_record_id ${linha.flowRecordId} já está em outro tenant`,
            });
            continue;
          }
          const porNumero = await tx.contrato.findUnique({
            where: { tenantId_numero: { tenantId, numero: linha.numero } },
          });
          if (porFlow && porNumero && porFlow.id !== porNumero.id) {
            relatorio.recusados.push({
              linha: linha.linha,
              codigo: linha.numero,
              motivo: `flow_record_id aponta para ${porFlow.numero}, e o código já é de outro contrato`,
            });
            continue;
          }
          if (
            porNumero &&
            porNumero.flowRecordId &&
            porNumero.flowRecordId !== linha.flowRecordId
          ) {
            relatorio.recusados.push({
              linha: linha.linha,
              codigo: linha.numero,
              motivo: `o código já está ligado a outro registro do Flow (${porNumero.flowRecordId})`,
            });
            continue;
          }

          const existente = porFlow ?? porNumero;
          const chaves = {
            numero: linha.numero,
            companyId: linha.companyId,
            flowRecordId: linha.flowRecordId,
          };

          let contratoId: string;
          let mudou: string[] = [];
          if (!existente) {
            const criado = await tx.contrato.create({
              data: {
                ...linha.colunas,
                ...chaves,
                tipo: linha.colunas.tipo ?? ContratoTipo.LTA,
                tenantId,
              },
            });
            contratoId = criado.id;
            relatorio.criados.push({
              numero: linha.numero,
              flowRecordId: linha.flowRecordId,
              origem: 'planilha',
            });
          } else {
            contratoId = existente.id;
            // E-09: célula vazia não apaga o que foi cadastrado depois da primeira rodada.
            const preenchidas = Object.fromEntries(
              Object.entries(linha.colunas).filter(([, valor]) => valor !== null)
            ) as Partial<Record<keyof LinhaValida['colunas'], unknown>>;
            const dados = { ...preenchidas, ...chaves } as Prisma.ContratoUncheckedUpdateInput;
            mudou = Object.entries(dados)
              .filter(([campo, valor]) => !igual(existente[campo as keyof typeof existente], valor))
              .map(([campo]) => campo);
            if (mudou.length > 0)
              await tx.contrato.update({ where: { id: existente.id }, data: dados });
          }

          // Filhos: só acrescenta o que falta, e nunca apaga o que foi cadastrado à mão.
          for (const solicitante of linha.solicitantes) {
            const ja = await tx.contratoSolicitante.findUnique({
              where: { contratoId_email: { contratoId, email: solicitante.email } },
              select: { id: true },
            });
            if (!ja) {
              await tx.contratoSolicitante.create({ data: { contratoId, ...solicitante } });
              if (existente) mudou.push(`solicitante:${solicitante.email}`);
            }
          }
          for (const item of linha.itens) {
            const ja = await tx.contratoItem.findFirst({
              where: { contratoId, descricao: item.descricao, disciplina: item.disciplina },
              select: { id: true },
            });
            if (!ja) {
              await tx.contratoItem.create({ data: { contratoId, ...item } });
              if (existente) mudou.push(`item:${item.descricao}`);
            }
          }
          const abriu = await garantirAbertura(
            tx,
            tenantId,
            contratoId,
            linha.numero,
            linha.consumoInicial,
            autorId,
            relatorio
          );
          if (abriu && existente) mudou.push('saldo_de_abertura');

          if (existente && mudou.some((campo) => CAMPOS_DO_ESPELHO.has(campo))) {
            alteradosNoEspelho.push(contratoId);
          }

          // `atualizado_desde` precisa enxergar filho novo e saldo novo (K-24, E-19).
          if (existente && mudou.length > 0) {
            await tx.contrato.update({
              where: { id: contratoId },
              data: { updatedAt: new Date() },
            });
          }

          if (existente) {
            if (mudou.length > 0)
              relatorio.atualizados.push({ numero: linha.numero, campos: mudou });
            else relatorio.semMudanca.push(linha.numero);
          }
        }

        // 3. E-08: empresa NOS sem contrato na planilha ganha um, a partir dos seis campos.
        const empresasNos = await tx.company.findMany({
          where: {
            tenantId,
            deletedAt: null,
            contractHolder: ContractHolder.NOS,
            contratos: { none: {} },
          },
          select: {
            id: true,
            name: true,
            contractStartDate: true,
            contractEndDate: true,
            contractValue: true,
            contractScope: true,
          },
        });
        for (const empresa of empresasNos) {
          const numero = `ENGAGE-${empresa.id.slice(0, 8).toUpperCase()}`;
          const gerado = await tx.contrato.create({
            data: {
              tenantId,
              companyId: empresa.id,
              numero,
              tipo: ContratoTipo.GUARDA_CHUVA,
              escopo: empresa.contractScope,
              vigenciaInicio: empresa.contractStartDate,
              vigenciaFim: empresa.contractEndDate,
              valorContratado: empresa.contractValue,
            },
          });
          gerados.push(gerado.id);
          relatorio.criados.push({ numero, flowRecordId: null, origem: 'empresa' });
        }

        // 4. Lacunas do que está no cadastro, para o relatório.
        const contratos = await tx.contrato.findMany({
          where: { tenantId, deletedAt: null },
          select: {
            numero: true,
            valorContratado: true,
            slaRespostaHoras: true,
            gerenteNome: true,
            gerenteEmail: true,
            _count: { select: { solicitantes: true } },
          },
          orderBy: { numero: 'asc' },
        });
        for (const c of contratos) {
          const lacunas = lacunasDoContrato({
            ...c,
            totalSolicitantes: c._count.solicitantes,
          });
          if (lacunas.length > 0) relatorio.lacunas.push({ numero: c.numero, lacunas });
        }

        if (seco) throw new EnsaioSeco();
      },
      { timeout: 120_000, maxWait: 30_000 }
    );
  } catch (erro) {
    if (!(erro instanceof EnsaioSeco)) throw erro;
    return relatorio;
  }

  await espelhar(tenantId, 'contract.created', gerados, relatorio);
  await espelhar(tenantId, 'contract.updated', alteradosNoEspelho, relatorio);
  return relatorio;
}
