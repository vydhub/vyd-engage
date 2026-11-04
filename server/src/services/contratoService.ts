import { ContratoMovimentoTipo, ContratoTipo, Prisma } from '@prisma/client';
import prisma from '../config/database.js';
import { createError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { webhookDispatcher } from './webhookDispatcher.js';

/**
 * Contratos LTA e guarda-chuva (spec captura-demandas, filha 02, E-01 a E-10, E-19).
 *
 * O saldo nunca é gravado: sai sempre de `calcularSaldo`, sobre os movimentos.
 */

type Decimal = Prisma.Decimal;
type Cliente = Prisma.TransactionClient | typeof prisma;

// ── Normalização (fato medido: códigos do Flow vêm com espaços e tabulações) ─────

export function normalizarNumero(numero: string): string {
  return numero.trim();
}

export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

function textoOuNull(valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
}

export function emailOuNull(valor: string | null | undefined): string | null {
  const limpo = textoOuNull(valor);
  return limpo ? limpo.toLowerCase() : null;
}

/** "YYYY-MM-DD" para Date à meia-noite UTC (coluna @db.Date). */
export function paraData(valor: string | null | undefined): Date | null {
  if (!valor) return null;
  return new Date(`${valor.slice(0, 10)}T00:00:00.000Z`);
}

function dataIso(valor: Date | null | undefined): string | null {
  return valor ? valor.toISOString().slice(0, 10) : null;
}

export function dinheiro(valor: Decimal | number | string | null | undefined): number | null {
  if (valor === null || valor === undefined) return null;
  return Number(new Prisma.Decimal(valor).toFixed(2));
}

// ── Saldo (E-06, D3) ─────────────────────────────────────────────────────────────

/** Saldo = valor contratado + aditivos + ajustes − consumos. Sem valor, não há saldo. */
export function calcularSaldo(
  valorContratado: Decimal | number | string | null | undefined,
  movimentos: Array<{ tipo: ContratoMovimentoTipo; valor: Decimal | number | string }>
): Decimal | null {
  if (valorContratado === null || valorContratado === undefined) return null;
  return movimentos.reduce((saldo, m) => {
    const valor = new Prisma.Decimal(m.valor);
    return m.tipo === ContratoMovimentoTipo.CONSUMO ? saldo.minus(valor) : saldo.plus(valor);
  }, new Prisma.Decimal(valorContratado));
}

/** Somas por tipo de vários contratos, para não fazer uma consulta por linha. */
async function movimentosPorContrato(
  contratoIds: string[],
  cliente: Cliente = prisma
): Promise<Map<string, Array<{ tipo: ContratoMovimentoTipo; valor: Decimal }>>> {
  const mapa = new Map<string, Array<{ tipo: ContratoMovimentoTipo; valor: Decimal }>>();
  if (contratoIds.length === 0) return mapa;
  const grupos = await cliente.contratoMovimento.groupBy({
    by: ['contratoId', 'tipo'],
    where: { contratoId: { in: contratoIds } },
    _sum: { valor: true },
  });
  for (const g of grupos) {
    const lista = mapa.get(g.contratoId) ?? [];
    lista.push({ tipo: g.tipo, valor: g._sum.valor ?? new Prisma.Decimal(0) });
    mapa.set(g.contratoId, lista);
  }
  return mapa;
}

// ── Lacunas (E-07) ───────────────────────────────────────────────────────────────

export type LacunaContrato = 'sem_solicitantes' | 'sem_sla' | 'sem_valor' | 'sem_gerente';

export function lacunasDoContrato(contrato: {
  valorContratado: unknown;
  slaRespostaHoras: number | null;
  gerenteNome: string | null;
  gerenteEmail: string | null;
  totalSolicitantes: number;
}): LacunaContrato[] {
  const lacunas: LacunaContrato[] = [];
  if (contrato.totalSolicitantes === 0) lacunas.push('sem_solicitantes');
  if (contrato.slaRespostaHoras === null) lacunas.push('sem_sla');
  if (contrato.valorContratado === null || contrato.valorContratado === undefined) {
    lacunas.push('sem_valor');
  }
  if (!contrato.gerenteNome && !contrato.gerenteEmail) lacunas.push('sem_gerente');
  return lacunas;
}

const FILTRO_DA_LACUNA: Record<LacunaContrato, Prisma.ContratoWhereInput> = {
  sem_solicitantes: { solicitantes: { none: {} } },
  sem_sla: { slaRespostaHoras: null },
  sem_valor: { valorContratado: null },
  sem_gerente: { gerenteNome: null, gerenteEmail: null },
};

// ── Espelho para o Flow (E-10) ───────────────────────────────────────────────────

export type EventoEspelho = 'contract.created' | 'contract.updated' | 'contract.deleted';

export function dadosDoEspelho(contrato: {
  id: string;
  flowRecordId: string | null;
  numero: string;
  gerenteNome: string | null;
  gerenteEmail: string | null;
  planejadorNome: string | null;
  planejadorEmail: string | null;
  deletedAt: Date | null;
  company: { name: string };
}) {
  return {
    id: contrato.id,
    flow_record_id: contrato.flowRecordId,
    codigo: contrato.numero,
    cliente: contrato.company.name,
    gerente_nome: contrato.gerenteNome,
    gerente_email: contrato.gerenteEmail,
    planejador_nome: contrato.planejadorNome,
    planejador_email: contrato.planejadorEmail,
    ativo: contrato.deletedAt === null,
  };
}

function emitirEspelho(
  tenantId: string,
  evento: EventoEspelho,
  contrato: Parameters<typeof dadosDoEspelho>[0]
): void {
  webhookDispatcher.emit(tenantId, evento, dadosDoEspelho(contrato));
}

// ── Formato da API de máquina (contrato 06, exemplo contratos_lista) ─────────────

const incluirParaApi = {
  company: { select: { id: true, name: true, cnpj: true, domain: true } },
  solicitantes: { select: { nome: true, email: true }, orderBy: { email: 'asc' as const } },
  itens: { select: { descricao: true, disciplina: true }, orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.ContratoInclude;

type ContratoParaApi = Prisma.ContratoGetPayload<{ include: typeof incluirParaApi }>;

export function soDigitos(valor: string | null | undefined): string | null {
  const digitos = (valor ?? '').replace(/\D/g, '');
  return digitos === '' ? null : digitos;
}

function itemDaApi(contrato: ContratoParaApi, saldo: Decimal | null) {
  return {
    id: contrato.id,
    numero: contrato.numero,
    numero_cliente: contrato.numeroCliente,
    tipo: contrato.tipo,
    objeto: contrato.objeto,
    escopo: contrato.escopo,
    vigencia_inicio: dataIso(contrato.vigenciaInicio),
    vigencia_fim: dataIso(contrato.vigenciaFim),
    valor_contratado: dinheiro(contrato.valorContratado),
    saldo: dinheiro(saldo),
    saldo_disponivel: saldo !== null,
    sla_resposta_horas: contrato.slaRespostaHoras,
    gerente_nome: contrato.gerenteNome,
    gerente_email: contrato.gerenteEmail,
    planejador_nome: contrato.planejadorNome,
    planejador_email: contrato.planejadorEmail,
    flow_record_id: contrato.flowRecordId,
    atualizado_em: contrato.updatedAt.toISOString(),
    excluido_em: contrato.deletedAt ? contrato.deletedAt.toISOString() : null,
    cliente: {
      id: contrato.company.id,
      nome: contrato.company.name,
      cnpj: soDigitos(contrato.company.cnpj),
      dominio: contrato.company.domain,
    },
    solicitantes: contrato.solicitantes.map((s) => ({ nome: s.nome, email: s.email })),
    itens: contrato.itens.map((i) => ({ descricao: i.descricao, disciplina: i.disciplina })),
  };
}

function codificarCursor(contrato: { updatedAt: Date; id: string }): string {
  return Buffer.from(`${contrato.updatedAt.toISOString()}|${contrato.id}`, 'utf8').toString(
    'base64url'
  );
}

function decodificarCursor(cursor: string): { updatedAt: Date; id: string } | null {
  const [quando, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const data = new Date(quando);
  if (!id || Number.isNaN(data.getTime())) return null;
  return { updatedAt: data, id };
}

// ── Entradas ─────────────────────────────────────────────────────────────────────

export interface DadosContrato {
  companyId: string;
  numero: string;
  numeroCliente?: string | null;
  tipo?: ContratoTipo;
  objeto?: string | null;
  escopo?: string | null;
  vigenciaInicio?: string | null;
  vigenciaFim?: string | null;
  valorContratado?: number | null;
  slaRespostaHoras?: number | null;
  gerenteNome?: string | null;
  gerenteEmail?: string | null;
  planejadorNome?: string | null;
  planejadorEmail?: string | null;
}

function colunasDoContrato(dados: Partial<DadosContrato>) {
  const colunas: Prisma.ContratoUncheckedUpdateInput = {};
  if (dados.companyId !== undefined) colunas.companyId = dados.companyId;
  if (dados.numero !== undefined) colunas.numero = normalizarNumero(dados.numero);
  if (dados.numeroCliente !== undefined) colunas.numeroCliente = textoOuNull(dados.numeroCliente);
  if (dados.tipo !== undefined) colunas.tipo = dados.tipo;
  if (dados.objeto !== undefined) colunas.objeto = textoOuNull(dados.objeto);
  if (dados.escopo !== undefined) colunas.escopo = textoOuNull(dados.escopo);
  if (dados.vigenciaInicio !== undefined) colunas.vigenciaInicio = paraData(dados.vigenciaInicio);
  if (dados.vigenciaFim !== undefined) colunas.vigenciaFim = paraData(dados.vigenciaFim);
  if (dados.valorContratado !== undefined) colunas.valorContratado = dados.valorContratado;
  if (dados.slaRespostaHoras !== undefined) colunas.slaRespostaHoras = dados.slaRespostaHoras;
  if (dados.gerenteNome !== undefined) colunas.gerenteNome = textoOuNull(dados.gerenteNome);
  if (dados.gerenteEmail !== undefined) colunas.gerenteEmail = emailOuNull(dados.gerenteEmail);
  if (dados.planejadorNome !== undefined)
    colunas.planejadorNome = textoOuNull(dados.planejadorNome);
  if (dados.planejadorEmail !== undefined) {
    colunas.planejadorEmail = emailOuNull(dados.planejadorEmail);
  }
  return colunas;
}

function ehUnicidade(erro: unknown): boolean {
  return (erro as { code?: string })?.code === 'P2002';
}

/** Monta a resposta 409 de `numero` repetido, com o contrato existente. */
async function erroDeNumeroRepetido(tenantId: string, numero: string) {
  const existente = await prisma.contrato.findFirst({
    where: { tenantId, numero },
    select: {
      id: true,
      numero: true,
      deletedAt: true,
      company: { select: { id: true, name: true } },
    },
  });
  const quem = existente
    ? ` (${existente.company.name}${existente.deletedAt ? ', excluído' : ''})`
    : '';
  const erro = createError(
    `Já existe o contrato ${numero}${quem}.`,
    409,
    'CONTRATO_NUMERO_REPETIDO',
    existente
  ) as Error & { existente?: unknown };
  erro.existente = existente;
  return erro;
}

async function exigirEmpresa(tenantId: string, companyId: string) {
  const empresa = await prisma.company.findFirst({
    where: { id: companyId, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!empresa) throw createError('Empresa não encontrada', 400, 'EMPRESA_INVALIDA');
}

async function exigirContrato(tenantId: string, id: string, cliente: Cliente = prisma) {
  const contrato = await cliente.contrato.findFirst({
    where: { id, tenantId, deletedAt: null },
    include: { company: { select: { name: true } } },
  });
  if (!contrato) throw createError('Contrato não encontrado', 404, 'CONTRATO_NAO_ENCONTRADO');
  return contrato;
}

/** Saldo e `atualizado_desde` dependem dos filhos: toda mudança neles toca o contrato. */
async function tocarContrato(contratoId: string, cliente: Cliente = prisma) {
  await cliente.contrato.update({ where: { id: contratoId }, data: { updatedAt: new Date() } });
}

async function auditar(
  cliente: Cliente,
  params: {
    tenantId: string;
    entityType: string;
    entityId: string;
    userId: string;
    action: string;
    changes: Prisma.InputJsonValue;
  }
) {
  await cliente.auditLog.create({ data: params });
}

const incluirNaLista = {
  company: { select: { id: true, name: true } },
  _count: { select: { solicitantes: true, itens: true, demandas: true } },
} satisfies Prisma.ContratoInclude;

const incluirNoDetalhe = {
  company: { select: { id: true, name: true } },
  solicitantes: { orderBy: { email: 'asc' as const } },
  itens: { orderBy: { createdAt: 'asc' as const } },
  movimentos: {
    orderBy: { createdAt: 'desc' as const },
    include: {
      autor: { select: { id: true, name: true } },
      deal: { select: { id: true, name: true } },
    },
  },
  _count: { select: { demandas: true } },
} satisfies Prisma.ContratoInclude;

function comSaldoELacunas<
  T extends {
    valorContratado: Decimal | null;
    slaRespostaHoras: number | null;
    gerenteNome: string | null;
    gerenteEmail: string | null;
  },
>(
  contrato: T,
  movimentos: Array<{ tipo: ContratoMovimentoTipo; valor: Decimal }>,
  totalSolicitantes: number
) {
  const saldo = calcularSaldo(contrato.valorContratado, movimentos);
  return {
    ...contrato,
    valorContratado: dinheiro(contrato.valorContratado),
    saldo: dinheiro(saldo),
    saldoDisponivel: saldo !== null,
    lacunas: lacunasDoContrato({ ...contrato, totalSolicitantes }),
  };
}

export const contratoService = {
  // ── Tela ───────────────────────────────────────────────────────────────────────

  async listar(
    tenantId: string,
    filtros: {
      busca?: string;
      companyId?: string;
      lacuna?: LacunaContrato;
      page?: number;
      limit?: number;
    } = {}
  ) {
    const page = filtros.page ?? 1;
    const limit = filtros.limit ?? 25;
    const where: Prisma.ContratoWhereInput = { tenantId, deletedAt: null };
    if (filtros.companyId) where.companyId = filtros.companyId;
    if (filtros.busca) {
      where.OR = [
        { numero: { contains: filtros.busca, mode: 'insensitive' } },
        { numeroCliente: { contains: filtros.busca, mode: 'insensitive' } },
        { objeto: { contains: filtros.busca, mode: 'insensitive' } },
        { company: { name: { contains: filtros.busca, mode: 'insensitive' } } },
      ];
    }
    if (filtros.lacuna) Object.assign(where, FILTRO_DA_LACUNA[filtros.lacuna]);

    const [contratos, total] = await Promise.all([
      prisma.contrato.findMany({
        where,
        include: incluirNaLista,
        orderBy: { numero: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.contrato.count({ where }),
    ]);

    const movimentos = await movimentosPorContrato(contratos.map((c) => c.id));
    return {
      itens: contratos.map((c) =>
        comSaldoELacunas(c, movimentos.get(c.id) ?? [], c._count.solicitantes)
      ),
      paginacao: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  },

  async obter(tenantId: string, id: string) {
    const contrato = await prisma.contrato.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: incluirNoDetalhe,
    });
    if (!contrato) throw createError('Contrato não encontrado', 404, 'CONTRATO_NAO_ENCONTRADO');
    return {
      ...comSaldoELacunas(contrato, contrato.movimentos, contrato.solicitantes.length),
      movimentos: contrato.movimentos.map((m) => ({ ...m, valor: dinheiro(m.valor) })),
    };
  },

  async criar(tenantId: string, dados: DadosContrato, userId: string) {
    await exigirEmpresa(tenantId, dados.companyId);
    const numero = normalizarNumero(dados.numero);
    try {
      const contrato = await prisma.$transaction(async (tx) => {
        const criado = await tx.contrato.create({
          data: {
            ...(colunasDoContrato(dados) as Prisma.ContratoUncheckedCreateInput),
            tenantId,
            numero,
            companyId: dados.companyId,
          },
          include: { company: { select: { name: true } } },
        });
        await auditar(tx, {
          tenantId,
          entityType: 'contrato',
          entityId: criado.id,
          userId,
          action: 'create',
          changes: [{ field: 'numero', oldValue: null, newValue: numero }],
        });
        return criado;
      });
      emitirEspelho(tenantId, 'contract.created', contrato);
      return contrato;
    } catch (erro) {
      if (ehUnicidade(erro)) throw await erroDeNumeroRepetido(tenantId, numero);
      throw erro;
    }
  },

  async atualizar(tenantId: string, id: string, dados: Partial<DadosContrato>, userId: string) {
    const atual = await exigirContrato(tenantId, id);
    if (dados.companyId && dados.companyId !== atual.companyId) {
      await exigirEmpresa(tenantId, dados.companyId);
    }
    const colunas = colunasDoContrato(dados);
    try {
      const contrato = await prisma.$transaction(async (tx) => {
        const atualizado = await tx.contrato.update({
          where: { id },
          data: colunas,
          include: { company: { select: { name: true } } },
        });
        await auditar(tx, {
          tenantId,
          entityType: 'contrato',
          entityId: id,
          userId,
          action: 'update',
          changes: JSON.parse(
            JSON.stringify(
              Object.keys(colunas).map((field) => ({
                field,
                oldValue: (atual as Record<string, unknown>)[field] ?? null,
                newValue: (atualizado as Record<string, unknown>)[field] ?? null,
              }))
            )
          ),
        });
        return atualizado;
      });
      emitirEspelho(tenantId, 'contract.updated', contrato);
      return contrato;
    } catch (erro) {
      if (ehUnicidade(erro)) {
        throw await erroDeNumeroRepetido(tenantId, normalizarNumero(dados.numero ?? atual.numero));
      }
      throw erro;
    }
  },

  /** Exclusão lógica: chamados mantêm o vínculo e o espelho marca o registro como inativo. */
  async excluir(tenantId: string, id: string, userId: string) {
    await exigirContrato(tenantId, id);
    const contrato = await prisma.$transaction(async (tx) => {
      const excluido = await tx.contrato.update({
        where: { id },
        data: { deletedAt: new Date() },
        include: { company: { select: { name: true } } },
      });
      await auditar(tx, {
        tenantId,
        entityType: 'contrato',
        entityId: id,
        userId,
        action: 'delete',
        changes: [],
      });
      return excluido;
    });
    emitirEspelho(tenantId, 'contract.deleted', contrato);
    return { excluido: true };
  },

  // ── Solicitantes ───────────────────────────────────────────────────────────────

  async adicionarSolicitante(
    tenantId: string,
    contratoId: string,
    dados: { nome?: string | null; email: string }
  ) {
    await exigirContrato(tenantId, contratoId);
    const email = normalizarEmail(dados.email);
    try {
      return await prisma.$transaction(async (tx) => {
        const criado = await tx.contratoSolicitante.create({
          data: { contratoId, email, nome: textoOuNull(dados.nome) },
        });
        await tocarContrato(contratoId, tx);
        return criado;
      });
    } catch (erro) {
      if (ehUnicidade(erro)) {
        throw createError(
          `O solicitante ${email} já está neste contrato.`,
          409,
          'SOLICITANTE_REPETIDO'
        );
      }
      throw erro;
    }
  },

  async atualizarSolicitante(
    tenantId: string,
    contratoId: string,
    id: string,
    dados: { nome?: string | null; email?: string }
  ) {
    await exigirContrato(tenantId, contratoId);
    const existente = await prisma.contratoSolicitante.findFirst({ where: { id, contratoId } });
    if (!existente)
      throw createError('Solicitante não encontrado', 404, 'SOLICITANTE_NAO_ENCONTRADO');
    try {
      return await prisma.$transaction(async (tx) => {
        const atualizado = await tx.contratoSolicitante.update({
          where: { id },
          data: {
            ...(dados.email !== undefined ? { email: normalizarEmail(dados.email) } : {}),
            ...(dados.nome !== undefined ? { nome: textoOuNull(dados.nome) } : {}),
          },
        });
        await tocarContrato(contratoId, tx);
        return atualizado;
      });
    } catch (erro) {
      if (ehUnicidade(erro)) {
        throw createError('Esse e-mail já está neste contrato.', 409, 'SOLICITANTE_REPETIDO');
      }
      throw erro;
    }
  },

  async removerSolicitante(tenantId: string, contratoId: string, id: string) {
    await exigirContrato(tenantId, contratoId);
    const existente = await prisma.contratoSolicitante.findFirst({ where: { id, contratoId } });
    if (!existente)
      throw createError('Solicitante não encontrado', 404, 'SOLICITANTE_NAO_ENCONTRADO');
    await prisma.$transaction(async (tx) => {
      await tx.contratoSolicitante.delete({ where: { id } });
      await tocarContrato(contratoId, tx);
    });
    return { removido: true };
  },

  // ── Itens ──────────────────────────────────────────────────────────────────────

  async adicionarItem(
    tenantId: string,
    contratoId: string,
    dados: { descricao: string; disciplina?: string | null }
  ) {
    await exigirContrato(tenantId, contratoId);
    return prisma.$transaction(async (tx) => {
      const criado = await tx.contratoItem.create({
        data: {
          contratoId,
          descricao: dados.descricao.trim(),
          disciplina: textoOuNull(dados.disciplina),
        },
      });
      await tocarContrato(contratoId, tx);
      return criado;
    });
  },

  async atualizarItem(
    tenantId: string,
    contratoId: string,
    id: string,
    dados: { descricao?: string; disciplina?: string | null }
  ) {
    await exigirContrato(tenantId, contratoId);
    const existente = await prisma.contratoItem.findFirst({ where: { id, contratoId } });
    if (!existente) throw createError('Item não encontrado', 404, 'ITEM_NAO_ENCONTRADO');
    return prisma.$transaction(async (tx) => {
      const atualizado = await tx.contratoItem.update({
        where: { id },
        data: {
          ...(dados.descricao !== undefined ? { descricao: dados.descricao.trim() } : {}),
          ...(dados.disciplina !== undefined ? { disciplina: textoOuNull(dados.disciplina) } : {}),
        },
      });
      await tocarContrato(contratoId, tx);
      return atualizado;
    });
  },

  async removerItem(tenantId: string, contratoId: string, id: string) {
    await exigirContrato(tenantId, contratoId);
    const existente = await prisma.contratoItem.findFirst({ where: { id, contratoId } });
    if (!existente) throw createError('Item não encontrado', 404, 'ITEM_NAO_ENCONTRADO');
    await prisma.$transaction(async (tx) => {
      await tx.contratoItem.delete({ where: { id } });
      await tocarContrato(contratoId, tx);
    });
    return { removido: true };
  },

  // ── Movimentos: só se inserem (E-05) ──────────────────────────────────────────

  async registrarMovimento(
    tenantId: string,
    contratoId: string,
    dados: { tipo: ContratoMovimentoTipo; valor: number; motivo?: string | null },
    autorId: string
  ) {
    await exigirContrato(tenantId, contratoId);
    const motivo = textoOuNull(dados.motivo);

    // CONSUMO nasce do evento `ganha` do Flow (E-06) ou da semeadura (E-09), nunca à mão.
    if (dados.tipo === ContratoMovimentoTipo.CONSUMO) {
      throw createError(
        'Consumo nasce do evento do Flow. Para corrigir o saldo, registre um ajuste.',
        422,
        'CONSUMO_MANUAL_RECUSADO'
      );
    }
    if (dados.tipo === ContratoMovimentoTipo.AJUSTE && !motivo) {
      throw createError('Ajuste exige motivo.', 422, 'AJUSTE_SEM_MOTIVO');
    }
    if (dados.tipo === ContratoMovimentoTipo.ADITIVO && dados.valor <= 0) {
      throw createError('Aditivo deve ter valor positivo.', 422, 'ADITIVO_VALOR_INVALIDO');
    }
    if (dados.valor === 0) {
      throw createError('Movimento não pode ter valor zero.', 422, 'MOVIMENTO_VALOR_ZERO');
    }

    return prisma.$transaction(async (tx) => {
      const movimento = await tx.contratoMovimento.create({
        data: { contratoId, tipo: dados.tipo, valor: dados.valor, motivo, autorId },
      });
      await tocarContrato(contratoId, tx);
      await auditar(tx, {
        tenantId,
        entityType: 'contrato_movimento',
        entityId: movimento.id,
        userId: autorId,
        action: 'create',
        changes: [
          { field: 'tipo', oldValue: null, newValue: dados.tipo },
          { field: 'valor', oldValue: null, newValue: dados.valor },
          { field: 'motivo', oldValue: null, newValue: motivo },
          { field: 'contratoId', oldValue: null, newValue: contratoId },
        ],
      });
      return { ...movimento, valor: dinheiro(movimento.valor) };
    });
  },

  // ── API de máquina (E-19) ─────────────────────────────────────────────────────

  async listarParaApi(
    tenantId: string,
    params: { atualizadoDesde?: Date; cursor?: string; limite?: number }
  ) {
    const limite = Math.min(params.limite ?? 100, 200);
    const filtros: Prisma.ContratoWhereInput[] = [{ tenantId }];
    if (params.atualizadoDesde) filtros.push({ updatedAt: { gte: params.atualizadoDesde } });
    if (params.cursor) {
      const cursor = decodificarCursor(params.cursor);
      if (!cursor) throw createError('Cursor inválido', 422, 'CURSOR_INVALIDO');
      filtros.push({
        OR: [
          { updatedAt: { gt: cursor.updatedAt } },
          { updatedAt: cursor.updatedAt, id: { gt: cursor.id } },
        ],
      });
    }

    const contratos = await prisma.contrato.findMany({
      where: { AND: filtros },
      include: incluirParaApi,
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: limite + 1,
    });

    const pagina = contratos.slice(0, limite);
    const movimentos = await movimentosPorContrato(pagina.map((c) => c.id));
    const ultimo = pagina[pagina.length - 1];
    return {
      itens: pagina.map((c) =>
        itemDaApi(c, calcularSaldo(c.valorContratado, movimentos.get(c.id) ?? []))
      ),
      proximo_cursor: contratos.length > limite && ultimo ? codificarCursor(ultimo) : null,
    };
  },

  // ── Campos atuais da empresa (E-08) ───────────────────────────────────────────

  /**
   * Empresas com contrato que já tem vencimento: nelas, os campos NOS deixam de alertar. O
   * contrato sem vigência não alerta, então os campos antigos seguem valendo até ele ter uma.
   */
  async empresasComVencimentoProprio(tenantId: string): Promise<Set<string>> {
    const linhas = await prisma.contrato.findMany({
      where: { tenantId, deletedAt: null, vigenciaFim: { not: null } },
      select: { companyId: true },
      distinct: ['companyId'],
    });
    return new Set(linhas.map((l) => l.companyId));
  },

  /**
   * A lista de contratos leva nome, CNPJ e domínio do cliente, e a Captura lê por
   * `atualizado_desde`. O espelho para o Flow leva só o nome: `espelhar` vale só para ele.
   */
  async empresaAlterada(
    tenantId: string,
    companyId: string,
    opcoes: { espelhar: boolean }
  ): Promise<void> {
    const contratos = await prisma.contrato.findMany({
      where: { tenantId, companyId, deletedAt: null },
      include: { company: { select: { name: true } } },
    });
    if (contratos.length === 0) return;
    await prisma.contrato.updateMany({
      where: { tenantId, companyId, deletedAt: null },
      data: { updatedAt: new Date() },
    });
    if (opcoes.espelhar) {
      for (const contrato of contratos) emitirEspelho(tenantId, 'contract.updated', contrato);
    }
    logger.info('Contratos atualizados por mudança na empresa', {
      tenantId,
      companyId,
      total: contratos.length,
    });
  },
};
