// Atribuição (originador/desenvolvedor) e comissão por RECEBIMENTO (reqs 29-32).
// A comissão é devida conforme o cliente paga a Tenax: cada recebimento libera a
// parcela proporcional de cada consultor (valor × %efetivo × fração do papel).
// % efetivo = override da atribuição ?? comissaoBase do consultor. Alterações de
// % são auditadas. O pagamento efetivo fica fora — aqui calcula/rastreia/marca.

import prisma from '../../config/database.js';
import { createError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { parceiroConfigService } from './configService.js';
import { notifyParceiro } from './notifyParceiroService.js';
import type { PapelAtribuicao } from '@prisma/client';

// RegistroAuditoria (registro-escopo) só tem `detalhe` livre — não há colunas
// dedicadas valorAntigo/valorNovo (essas ficam em ConsultorAuditoria, para a
// comissaoBase do consultor, editada em consultorService). Portanto o par
// ANTES→DEPOIS de %/split/pagamento é codificado no próprio `detalhe`, para que
// a trilha registre o que mudou e para qual valor (req 30).
async function auditRegistro(
  tenantId: string,
  registroId: string,
  evento: string,
  detalhe: string,
  autorId?: string,
  change?: { antigo: string; novo: string }
) {
  const detalheFinal = change ? `${detalhe} [${change.antigo} → ${change.novo}]` : detalhe;
  await prisma.registroAuditoria
    .create({ data: { tenantId, registroId, evento, detalhe: detalheFinal, autorId: autorId ?? null } })
    .catch((err) => logger.error('Falha ao auditar comissão', err));
}

export const comissaoService = {
  // ── Atribuições (papéis) ────────────────────────────────────────────────────

  /**
   * Define/atualiza uma atribuição (req 29). `percentualOverride` null usa a
   * comissaoBase do consultor. Mudanças de % são auditadas (req 30).
   */
  async setAtribuicao(
    tenantId: string,
    registroId: string,
    userId: string,
    data: { consultorId: string; papel: PapelAtribuicao; percentualOverride?: number | null }
  ) {
    const registro = await prisma.registroOportunidade.findFirst({
      where: { id: registroId, tenantId, deletedAt: null },
    });
    if (!registro) throw createError('Registro não encontrado', 404, 'REGISTRO_NOT_FOUND');
    const consultor = await prisma.consultor.findFirst({
      where: { id: data.consultorId, tenantId, deletedAt: null },
    });
    if (!consultor) throw createError('Consultor não encontrado', 404, 'CONSULTOR_NOT_FOUND');

    // % ANTES (para a trilha ANTES→DEPOIS, req 30): override anterior ou "base N".
    const anterior = await prisma.registroAtribuicao.findUnique({
      where: {
        registroId_consultorId_papel: { registroId, consultorId: data.consultorId, papel: data.papel },
      },
      select: { percentualOverride: true },
    });
    const pctAntigo =
      anterior == null
        ? '—'
        : anterior.percentualOverride != null
          ? `${anterior.percentualOverride}%`
          : `base ${consultor.comissaoBase}`;
    const pctNovo =
      data.percentualOverride != null ? `${data.percentualOverride}%` : `base ${consultor.comissaoBase}`;

    const atribuicao = await prisma.registroAtribuicao.upsert({
      where: {
        registroId_consultorId_papel: { registroId, consultorId: data.consultorId, papel: data.papel },
      },
      create: {
        tenantId,
        registroId,
        consultorId: data.consultorId,
        papel: data.papel,
        percentualOverride: data.percentualOverride ?? null,
      },
      update: { percentualOverride: data.percentualOverride ?? null },
    });
    await auditRegistro(
      tenantId,
      registroId,
      'COMISSAO_ALTERADA',
      `Atribuição ${data.papel} → ${consultor.nome}`,
      userId,
      { antigo: pctAntigo, novo: pctNovo }
    );
    return atribuicao;
  },

  async removeAtribuicao(tenantId: string, atribuicaoId: string, userId: string) {
    const atribuicao = await prisma.registroAtribuicao.findFirst({
      where: { id: atribuicaoId, tenantId },
      include: { registro: { select: { id: true } }, consultor: { select: { nome: true } } },
    });
    if (!atribuicao) throw createError('Atribuição não encontrada', 404, 'ATRIBUICAO_NOT_FOUND');
    // Sempre resta ao menos um ORIGINADOR (req 29).
    if (atribuicao.papel === 'ORIGINADOR') {
      const originadores = await prisma.registroAtribuicao.count({
        where: { tenantId, registroId: atribuicao.registroId, papel: 'ORIGINADOR' },
      });
      if (originadores <= 1) {
        throw createError('A oportunidade precisa de ao menos um originador', 400, 'ORIGINADOR_REQUIRED');
      }
    }
    await prisma.registroAtribuicao.delete({ where: { id: atribuicaoId } });
    await auditRegistro(tenantId, atribuicao.registroId, 'COMISSAO_ALTERADA', `Atribuição removida: ${atribuicao.papel} ${atribuicao.consultor.nome}`, userId);
    return { id: atribuicaoId };
  },

  /** Split entre papéis por oportunidade (override do padrão do tenant). */
  async setSplit(tenantId: string, registroId: string, userId: string, splitOriginador: number) {
    if (splitOriginador < 0 || splitOriginador > 100) {
      throw createError('Split deve estar entre 0 e 100', 400, 'VALIDATION_ERROR');
    }
    const registro = await prisma.registroOportunidade.findFirst({
      where: { id: registroId, tenantId, deletedAt: null },
    });
    if (!registro) throw createError('Registro não encontrado', 404, 'REGISTRO_NOT_FOUND');
    // Split ANTES (para a trilha ANTES→DEPOIS, req 30). `null` = herdava o padrão do tenant.
    const splitAntigo =
      registro.splitOriginador != null
        ? `${registro.splitOriginador}/${100 - registro.splitOriginador}`
        : 'padrão do tenant';
    await prisma.registroOportunidade.update({ where: { id: registroId }, data: { splitOriginador } });
    await auditRegistro(
      tenantId,
      registroId,
      'COMISSAO_ALTERADA',
      'Split originador/desenvolvedor',
      userId,
      { antigo: splitAntigo, novo: `${splitOriginador}/${100 - splitOriginador}` }
    );
    return { registroId, splitOriginador };
  },

  // ── Recebimentos → parcelas (req 31) ────────────────────────────────────────

  /**
   * Registra um recebimento do cliente na oportunidade GANHA e libera as parcelas
   * proporcionais. EXIGE % definível para cada atribuição (override ou base > 0) —
   * pendência explícita, nunca calcula com % zero implícito (caso extremo).
   */
  async addRecebimento(
    tenantId: string,
    registroId: string,
    userId: string,
    data: { data: Date; valor: number; referencia?: string | null }
  ) {
    const registro = await prisma.registroOportunidade.findFirst({
      where: { id: registroId, tenantId, deletedAt: null },
      include: { atribuicoes: { include: { consultor: true } } },
    });
    if (!registro) throw createError('Registro não encontrado', 404, 'REGISTRO_NOT_FOUND');
    if (registro.status !== 'GANHO') {
      throw createError('Recebimentos só podem ser registrados em oportunidades ganhas', 400, 'NOT_WON');
    }
    if (data.valor <= 0) throw createError('Valor do recebimento deve ser positivo', 400, 'VALIDATION_ERROR');
    if (registro.atribuicoes.length === 0) {
      throw createError('Defina as atribuições (originador/desenvolvedor) antes de registrar recebimentos', 400, 'ATRIBUICAO_REQUIRED');
    }
    // Exige ao menos um ORIGINADOR: sem ele, `temOriginador=false` → fracaoPapel=100
    // e o DESENVOLVEDOR levaria 100% (split silenciosamente ignorado). Pendência
    // explícita — a oportunidade tem de ter quem a originou antes de liberar comissão.
    if (!registro.atribuicoes.some((a) => a.papel === 'ORIGINADOR')) {
      throw createError(
        'Defina ao menos um consultor ORIGINADOR antes de registrar recebimentos',
        400,
        'ORIGINADOR_REQUIRED'
      );
    }

    // % efetivo por atribuição — pendência explícita quando indefinido/zero.
    const semPercentual = registro.atribuicoes.filter(
      (a) => Number(a.percentualOverride ?? a.consultor.comissaoBase) <= 0
    );
    if (semPercentual.length > 0) {
      throw createError(
        `Defina o % de comissão de: ${semPercentual.map((a) => `${a.consultor.nome} (${a.papel})`).join(', ')} antes de registrar o recebimento`,
        400,
        'COMISSAO_PERCENTUAL_PENDENTE'
      );
    }

    // Aviso (não bloqueia): recebimentos podem exceder o contrato (aditivos).
    const config = await parceiroConfigService.get(tenantId);
    const splitOriginador = registro.splitOriginador ?? config.splitOriginadorPadrao;

    const temOriginador = registro.atribuicoes.some((a) => a.papel === 'ORIGINADOR');
    const temDesenvolvedor = registro.atribuicoes.some((a) => a.papel === 'DESENVOLVEDOR');

    const recebimento = await prisma.$transaction(async (tx) => {
      const rec = await tx.recebimento.create({
        data: { tenantId, registroId, data: data.data, valor: data.valor, referencia: data.referencia ?? null, criadoPorId: userId },
      });
      for (const a of registro.atribuicoes) {
        const percentual = Number(a.percentualOverride ?? a.consultor.comissaoBase);
        // Fração do papel: com os DOIS papéis presentes aplica o split (60/40); com
        // um só, aquele papel recebe 100%. `fracaoPapel` grava SEMPRE a fração CHEIA
        // do papel (60/40/100 como inteiro) — NÃO a fração já dividida. Quando há
        // vários consultores no MESMO papel, o VALOR da parcela é dividido por `n`
        // (doMesmoPapel), mas cada parcela mantém `fracaoPapel` cheia; é o frontend
        // que exibe a fração do papel e, se preciso, o rateio entre coautores.
        const doMesmoPapel = registro.atribuicoes.filter((x) => x.papel === a.papel).length;
        const fracaoPapel =
          temOriginador && temDesenvolvedor ? (a.papel === 'ORIGINADOR' ? splitOriginador : 100 - splitOriginador) : 100;
        const valor = (data.valor * (percentual / 100) * (fracaoPapel / 100)) / doMesmoPapel;
        await tx.comissaoParcela.create({
          data: {
            tenantId,
            registroId,
            consultorId: a.consultorId,
            recebimentoId: rec.id,
            papel: a.papel,
            percentualAplicado: percentual,
            fracaoPapel,
            valor: Math.round(valor * 100) / 100,
          },
        });
      }
      return rec;
    });

    await auditRegistro(tenantId, registroId, 'RECEBIMENTO', `R$ ${data.valor.toLocaleString('pt-BR')}${data.referencia ? ` (${data.referencia})` : ''} — parcelas de comissão liberadas`, userId);

    // Notifica cada consultor da parcela liberada (req 36): in-app + e-mail
    // (best-effort) + WhatsApp gated ao próprio consultor. Um envio por consultor,
    // deduplicando quando o mesmo consultor tem mais de uma atribuição no registro.
    const consultoresNotificar = new Map<string, { userId: string }>();
    for (const a of registro.atribuicoes) {
      if (a.consultor.userId) {
        consultoresNotificar.set(a.consultorId, { userId: a.consultor.userId });
      }
    }
    for (const [consultorId, { userId: consultorUserId }] of consultoresNotificar) {
      await notifyParceiro(tenantId, {
        userIds: [consultorUserId],
        type: 'PARCEIRO_COMISSAO',
        title: 'Comissão liberada',
        message: `Novo recebimento em "${registro.clienteNome}" liberou uma parcela de comissão para você.`,
        link: '/portal',
        metadata: { registroId, recebimentoId: recebimento.id },
        whatsappConsultorIds: [consultorId],
      }).catch((err) => logger.error('Falha ao notificar comissão', err));
    }

    // Aviso de ultrapassagem (caso extremo — permitido, mas explícito).
    const totalRecebido = await prisma.recebimento.aggregate({
      where: { tenantId, registroId },
      _sum: { valor: true },
    });
    const excedeu =
      registro.valorContrato != null && Number(totalRecebido._sum.valor ?? 0) > Number(registro.valorContrato);

    return { recebimento, excedeuContrato: excedeu };
  },

  async removeRecebimento(tenantId: string, recebimentoId: string, userId: string) {
    const rec = await prisma.recebimento.findFirst({ where: { id: recebimentoId, tenantId } });
    if (!rec) throw createError('Recebimento não encontrado', 404, 'RECEBIMENTO_NOT_FOUND');
    const pagas = await prisma.comissaoParcela.count({
      where: { tenantId, recebimentoId, status: 'PAGA' },
    });
    if (pagas > 0) {
      throw createError('Recebimento tem parcelas já pagas — não pode ser removido', 400, 'PARCELA_PAGA');
    }
    await prisma.recebimento.delete({ where: { id: recebimentoId } }); // cascade nas parcelas
    await auditRegistro(tenantId, rec.registroId, 'RECEBIMENTO_REMOVIDO', `R$ ${Number(rec.valor).toLocaleString('pt-BR')}`, userId);
    return { id: recebimentoId };
  },

  // ── Extrato / marcação (req 32) ─────────────────────────────────────────────

  async extrato(tenantId: string, filters: { consultorId?: string; status?: 'A_PAGAR' | 'PAGA' } = {}) {
    const parcelas = await prisma.comissaoParcela.findMany({
      where: {
        tenantId,
        ...(filters.consultorId ? { consultorId: filters.consultorId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
      include: {
        consultor: { select: { id: true, nome: true } },
        registro: { select: { id: true, clienteNome: true } },
        recebimento: { select: { data: true, valor: true, referencia: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const totais = await prisma.comissaoParcela.groupBy({
      by: ['status'],
      where: { tenantId, ...(filters.consultorId ? { consultorId: filters.consultorId } : {}) },
      _sum: { valor: true },
    });
    return {
      parcelas,
      totais: {
        aPagar: Number(totais.find((t) => t.status === 'A_PAGAR')?._sum.valor ?? 0),
        pagas: Number(totais.find((t) => t.status === 'PAGA')?._sum.valor ?? 0),
      },
    };
  },

  async marcarPaga(tenantId: string, parcelaId: string, userId: string, paga: boolean) {
    const parcela = await prisma.comissaoParcela.findFirst({ where: { id: parcelaId, tenantId } });
    if (!parcela) throw createError('Parcela não encontrada', 404, 'PARCELA_NOT_FOUND');
    const updated = await prisma.comissaoParcela.update({
      where: { id: parcelaId },
      data: paga
        ? { status: 'PAGA', marcadaPagaPorId: userId, marcadaPagaEm: new Date() }
        : { status: 'A_PAGAR', marcadaPagaPorId: null, marcadaPagaEm: null },
    });
    await auditRegistro(
      tenantId,
      parcela.registroId,
      'COMISSAO_ALTERADA',
      `Parcela ${paga ? 'marcada como PAGA' : 'reaberta'} — R$ ${Number(parcela.valor).toLocaleString('pt-BR')}`,
      userId,
      { antigo: parcela.status, novo: updated.status }
    );
    return updated;
  },
};
