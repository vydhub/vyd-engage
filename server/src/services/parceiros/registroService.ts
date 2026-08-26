// Registro de Oportunidade (deal registration) — o núcleo do módulo de Parceiros.
// Reqs 6-19 da spec gestao-parceiros-comerciais: submissão com timestamp imutável,
// detecção DETERMINÍSTICA de conflito (CNPJ forte; razão social/contato fraco),
// aprovação com janela de proteção, updates obrigatórios, extensão, expiração
// sinalizada (gestor decide), ganho/perdido e matriz de sobreposição.

import prisma from '../../config/database.js';
import { createError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { notificationService } from '../notificationService.js';
import { dealService } from '../dealService.js';
import { notifyParceiro } from './notifyParceiroService.js';
import { onlyDigits, normalizeName, collapseSpaces } from '../atestados/normalize.js';
import { parceiroConfigService } from './configService.js';
import type { ConflitoDecisao, Prisma, RegistroStatus } from '@prisma/client';

// Registros "ativos" para fins de conflito (GANHO conta: incumbência).
const ACTIVE_STATUSES: RegistroStatus[] = ['SUBMETIDO', 'EM_ANALISE', 'APROVADO', 'GANHO'];
// Registros ATIVOS do PRÓPRIO consultor para fins de DUPLICATA (GANHO não conta —
// duplicata é sobre demanda em aberto do mesmo parceiro).
const DUP_STATUSES: RegistroStatus[] = ['SUBMETIDO', 'EM_ANALISE', 'APROVADO'];

export interface RegistroData {
  clienteNome: string;
  clienteCnpj?: string | null;
  clienteContato?: string | null;
  descricao: string;
  valorEstimado?: number | null;
  observacoes?: string | null;
}

/** CNPJ leniente p/ MATCH: só conta como chave forte com exatamente 14 dígitos. */
function cnpjKey(raw: string | null | undefined): string | null {
  const digits = onlyDigits(raw ?? '');
  return digits.length === 14 ? digits : null;
}

async function getGestorIds(tenantId: string): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { tenantId, role: { in: ['ADMIN', 'GESTOR'] }, status: 'ACTIVE' },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

async function notifyUsers(
  tenantId: string,
  userIds: string[],
  data: { type: Parameters<typeof notificationService.create>[1]['type']; title: string; message: string; link?: string; metadata?: unknown }
): Promise<void> {
  for (const userId of [...new Set(userIds)]) {
    await notificationService
      .create(tenantId, { userId, ...data, metadata: data.metadata as never })
      .catch((err) => logger.error('Falha ao notificar (parceiros)', err));
  }
}

async function audit(
  tenantId: string,
  registroId: string,
  evento: string,
  detalhe?: string | null,
  autorId?: string | null
): Promise<void> {
  await prisma.registroAuditoria
    .create({ data: { tenantId, registroId, evento, detalhe: detalhe ?? null, autorId: autorId ?? null } })
    .catch((err) => logger.error('Falha ao auditar registro', err));
}

/**
 * Muda o status de um registro e grava a auditoria correspondente DENTRO da mesma
 * transação (atômico — nunca status sem trilha nem trilha sem status). Campos
 * extras do update são mesclados; o autorId é gravado na auditoria.
 */
async function updateStatusWithAudit(
  tenantId: string,
  id: string,
  status: RegistroStatus,
  extraData: Prisma.RegistroOportunidadeUpdateInput,
  evento: string,
  detalhe: string | null,
  autorId: string | null
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.registroOportunidade.update({ where: { id }, data: { status, ...extraData } });
    await tx.registroAuditoria.create({
      data: { tenantId, registroId: id, evento, detalhe: detalhe ?? null, autorId: autorId ?? null },
    });
  });
}

/**
 * Devolve à fila de aprovação (SUBMETIDO) os registros que a detecção de conflito
 * prendeu em EM_ANALISE e que não têm mais nenhum conflito ABERTO.
 *
 * Avalia origem E alvo: `create()` move os dois para EM_ANALISE, mas o
 * ConflitoCandidato guarda o alvo em `alvoRegistroId`, não em `registroId` —
 * então olhar só por `registroId` deixaria o alvo preso para sempre, fora da fila
 * de aprovações e fora da fila de conflitos ao mesmo tempo.
 */
async function destravarSemConflitoAberto(
  tenantId: string,
  registroIds: (string | null | undefined)[],
  userId: string | null
): Promise<void> {
  const ids = [...new Set(registroIds.filter((id): id is string => !!id))];
  for (const registroId of ids) {
    const abertos = await prisma.conflitoCandidato.count({
      where: { tenantId, status: 'ABERTO', OR: [{ registroId }, { alvoRegistroId: registroId }] },
    });
    if (abertos > 0) continue;
    // Só destrava o que a detecção prendeu. Qualquer outro status é decisão
    // posterior do gestor (aprovado, rejeitado, ganho…) e não deve ser revertido.
    const preso = await prisma.registroOportunidade.findFirst({
      where: { id: registroId, tenantId, deletedAt: null, status: 'EM_ANALISE' },
      select: { id: true },
    });
    if (!preso) continue;
    await prisma.registroOportunidade.update({ where: { id: registroId }, data: { status: 'SUBMETIDO' } });
    await audit(
      tenantId,
      registroId,
      'CONFLITO_LIBERADO',
      'Sem conflitos abertos — volta para a fila de aprovação',
      userId
    );
  }
}

const detailInclude = {
  consultor: { select: { id: true, nome: true, email: true, status: true } },
  updates: { orderBy: { createdAt: 'desc' as const } },
  extensoes: { orderBy: { createdAt: 'desc' as const } },
  planoAcao: { orderBy: { dueDate: 'asc' as const } },
  atribuicoes: { include: { consultor: { select: { id: true, nome: true, comissaoBase: true } } } },
  recebimentos: { orderBy: { data: 'desc' as const } },
  auditoria: { orderBy: { createdAt: 'desc' as const } },
  conflitos: true,
} satisfies Prisma.RegistroOportunidadeInclude;

type ConflitoAlvo = {
  tipo: 'EXTERNO_EXTERNO' | 'EXTERNO_INTERNO';
  alvoRegistroId?: string;
  alvoDealId?: string;
  alvoCompanyId?: string;
  matchForca: 'FORTE' | 'FRACO';
  matchChave: string;
};

/**
 * Detecção determinística de candidatos a conflito (req 16-17).
 * FORTE = mesmo CNPJ (14 dígitos). FRACO = razão social normalizada igual (o
 * contato só REFORÇA, nunca sozinho). Assimetria de CNPJ: quando o registro NOVO
 * tem CNPJ mas o alvo NÃO tem, cai no match FRACO por nome. EXTERNO_INTERNO só
 * gera candidato quando a Company tiver deal OPEN (alinhado com overlapMatrix).
 * Cruza: (a) registros ATIVOS de OUTROS consultores; (b) pipeline interno. A
 * decisão "mesma demanda?" é SEMPRE humana — aqui só sinalizamos candidatos.
 */
async function detectConflitos(
  tenantId: string,
  registro: { id: string; consultorId: string; clienteCnpjDigits: string | null; clienteNome: string; clienteContato: string | null }
): Promise<ConflitoAlvo[]> {
  const out: ConflitoAlvo[] = [];
  const nomeNorm = normalizeName(registro.clienteNome);
  const contatoNorm = normalizeName(registro.clienteContato ?? '');

  // (a) Registros ativos de OUTROS consultores.
  const outros = await prisma.registroOportunidade.findMany({
    where: {
      tenantId,
      deletedAt: null,
      id: { not: registro.id },
      consultorId: { not: registro.consultorId },
      status: { in: ACTIVE_STATUSES },
    },
    select: { id: true, clienteCnpjDigits: true, clienteNome: true, clienteContato: true },
  });
  for (const o of outros) {
    // FORTE: ambos têm CNPJ e são iguais.
    if (registro.clienteCnpjDigits && o.clienteCnpjDigits && o.clienteCnpjDigits === registro.clienteCnpjDigits) {
      out.push({ tipo: 'EXTERNO_EXTERNO', alvoRegistroId: o.id, matchForca: 'FORTE', matchChave: `CNPJ ${registro.clienteCnpjDigits}` });
      continue;
    }
    // FRACO por nome normalizado igual. Cabe quando: o novo não tem CNPJ; OU o
    // novo tem CNPJ mas o alvo NÃO tem (assimetria) — nunca contra CNPJ diferente.
    const cnpjBloqueia = registro.clienteCnpjDigits && o.clienteCnpjDigits && o.clienteCnpjDigits !== registro.clienteCnpjDigits;
    if (!cnpjBloqueia && nomeNorm && normalizeName(o.clienteNome) === nomeNorm) {
      const contatoIgual = contatoNorm && normalizeName(o.clienteContato ?? '') === contatoNorm;
      out.push({
        tipo: 'EXTERNO_EXTERNO',
        alvoRegistroId: o.id,
        matchForca: 'FRACO',
        matchChave: `NOME "${collapseSpaces(registro.clienteNome)}"${contatoIgual ? ' (contato confere)' : ''}`,
      });
    }
  }

  // (b) Pipeline interno: Companies (CNPJ normalizado em memória — dado legado é
  // gravado cru) + Deals OPEN da company. Company SEM deal OPEN NÃO gera conflito.
  const companies = await prisma.company.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, name: true, cnpj: true },
  });
  for (const c of companies) {
    const companyCnpj = cnpjKey(c.cnpj);
    let forca: 'FORTE' | 'FRACO' | null = null;
    let chave = '';
    if (registro.clienteCnpjDigits && companyCnpj && companyCnpj === registro.clienteCnpjDigits) {
      forca = 'FORTE';
      chave = `CNPJ ${registro.clienteCnpjDigits}`;
    } else {
      // FRACO por nome — cabe quando o novo não tem CNPJ, ou quando tem CNPJ mas a
      // company não tem (assimetria). Nunca contra CNPJ diferente.
      const cnpjBloqueia = registro.clienteCnpjDigits && companyCnpj && companyCnpj !== registro.clienteCnpjDigits;
      if (!cnpjBloqueia && nomeNorm && normalizeName(c.name) === nomeNorm) {
        forca = 'FRACO';
        chave = `NOME "${collapseSpaces(registro.clienteNome)}"`;
      }
    }
    if (!forca) continue;
    // EXTERNO_INTERNO só existe se a company tiver deal OPEN (alinha com overlapMatrix).
    const openDeal = await prisma.deal.findFirst({
      where: { tenantId, companyId: c.id, deletedAt: null, status: 'OPEN' },
      select: { id: true },
    });
    if (!openDeal) continue;
    out.push({
      tipo: 'EXTERNO_INTERNO',
      alvoCompanyId: c.id,
      alvoDealId: openDeal.id,
      matchForca: forca,
      matchChave: chave,
    });
  }

  return out;
}

/**
 * Detecta DUPLICATA do MESMO consultor: mesmo critério de match (CNPJ forte /
 * nome normalizado fraco) contra registros ATIVOS do próprio consultor. NÃO é
 * conflito — apenas sinaliza possível registro duplicado a unificar.
 */
async function detectDuplicatasDoConsultor(
  tenantId: string,
  registro: { id: string; consultorId: string; clienteCnpjDigits: string | null; clienteNome: string }
): Promise<Array<{ registroId: string; clienteNome: string }>> {
  const nomeNorm = normalizeName(registro.clienteNome);
  const meus = await prisma.registroOportunidade.findMany({
    where: {
      tenantId,
      deletedAt: null,
      id: { not: registro.id },
      consultorId: registro.consultorId,
      status: { in: DUP_STATUSES },
    },
    select: { id: true, clienteCnpjDigits: true, clienteNome: true },
  });
  const hits: Array<{ registroId: string; clienteNome: string }> = [];
  for (const m of meus) {
    const forte = registro.clienteCnpjDigits && m.clienteCnpjDigits && m.clienteCnpjDigits === registro.clienteCnpjDigits;
    const cnpjBloqueia = registro.clienteCnpjDigits && m.clienteCnpjDigits && m.clienteCnpjDigits !== registro.clienteCnpjDigits;
    const fraco = !cnpjBloqueia && nomeNorm && normalizeName(m.clienteNome) === nomeNorm;
    if (forte || fraco) hits.push({ registroId: m.id, clienteNome: m.clienteNome });
  }
  return hits;
}

/** Garante o DealSource "Parceiro" do tenant (tag sourced — req 10). */
async function ensureParceiroSource(tenantId: string): Promise<string> {
  const existing = await prisma.dealSource.findFirst({ where: { tenantId, name: 'Parceiro' } });
  if (existing) return existing.id;
  const created = await prisma.dealSource.create({ data: { tenantId, name: 'Parceiro', active: true, order: 999 } });
  return created.id;
}

/** Funil default do tenant (p/ posicionar o deal do parceiro no kanban). */
async function defaultFunnelId(tenantId: string): Promise<string | null> {
  const funnel =
    (await prisma.funnel.findFirst({ where: { tenantId, isDefault: true }, select: { id: true } })) ??
    (await prisma.funnel.findFirst({ where: { tenantId }, orderBy: { createdAt: 'asc' }, select: { id: true } }));
  return funnel?.id ?? null;
}

/**
 * Persiste candidatos a conflito com DEDUP contra os candidatos já existentes do
 * mesmo registro para o MESMO alvo. Retorna quantos NOVOS foram criados.
 */
async function persistConflitos(
  tenantId: string,
  registroId: string,
  candidatos: ConflitoAlvo[]
): Promise<number> {
  if (candidatos.length === 0) return 0;
  const existentes = await prisma.conflitoCandidato.findMany({
    where: { tenantId, registroId },
    select: { alvoRegistroId: true, alvoDealId: true, alvoCompanyId: true },
  });
  const chaveAlvo = (c: { alvoRegistroId?: string | null; alvoDealId?: string | null; alvoCompanyId?: string | null }) =>
    `${c.alvoRegistroId ?? ''}|${c.alvoDealId ?? ''}|${c.alvoCompanyId ?? ''}`;
  const jaExistem = new Set(existentes.map(chaveAlvo));
  let criados = 0;
  for (const c of candidatos) {
    const chave = chaveAlvo({ alvoRegistroId: c.alvoRegistroId, alvoDealId: c.alvoDealId, alvoCompanyId: c.alvoCompanyId });
    if (jaExistem.has(chave)) continue;
    await prisma.conflitoCandidato.create({
      data: {
        tenantId,
        registroId,
        tipo: c.tipo,
        alvoRegistroId: c.alvoRegistroId ?? null,
        alvoDealId: c.alvoDealId ?? null,
        alvoCompanyId: c.alvoCompanyId ?? null,
        matchForca: c.matchForca,
        matchChave: c.matchChave,
      },
    });
    jaExistem.add(chave);
    criados++;
  }
  return criados;
}

/** Notifica gestores + designado de resolução de conflito interno. */
async function notifyResolutoresConflito(
  tenantId: string,
  candidatos: ConflitoAlvo[],
  message: string,
  registroId: string
): Promise<void> {
  const config = await parceiroConfigService.get(tenantId);
  const temInterno = candidatos.some((c) => c.tipo === 'EXTERNO_INTERNO');
  const gestorIds = await getGestorIds(tenantId);
  const destinatarios = new Set<string>(gestorIds);
  if (temInterno && config.conflitoInternoUserId) destinatarios.add(config.conflitoInternoUserId);
  await notifyParceiro(tenantId, {
    userIds: [...destinatarios],
    type: 'PARCEIRO_CONFLITO',
    title: 'Candidato a conflito detectado',
    message,
    link: '/app/parceiros',
    metadata: { registroId },
  });
}

export const registroService = {
  detectConflitos,

  async list(
    tenantId: string,
    filters: { status?: RegistroStatus; consultorId?: string; search?: string } = {}
  ) {
    return prisma.registroOportunidade.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.consultorId ? { consultorId: filters.consultorId } : {}),
        ...(filters.search
          ? {
              OR: [
                { clienteNome: { contains: filters.search, mode: 'insensitive' } },
                { descricao: { contains: filters.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        consultor: { select: { id: true, nome: true, status: true } },
        _count: { select: { conflitos: { where: { status: 'ABERTO' } }, planoAcao: true, updates: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  },

  async get(tenantId: string, id: string) {
    const registro = await prisma.registroOportunidade.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: detailInclude,
    });
    if (!registro) throw createError('Registro não encontrado', 404, 'REGISTRO_NOT_FOUND');
    const deal = registro.dealId
      ? await prisma.deal.findFirst({
          where: { id: registro.dealId, tenantId },
          select: { id: true, name: true, stage: true, status: true, value: true },
        })
      : null;
    return { ...registro, deal };
  },

  /**
   * Cria um registro (portal: consultorId do vínculo; interno: em nome de um
   * consultor). createdAt é o timestamp imutável (first-to-register). Roda a
   * detecção de conflito na submissão; candidatos → EM_ANALISE + fila de resolução.
   * Também detecta DUPLICATA do próprio consultor (não é conflito — sinaliza).
   */
  async create(
    tenantId: string,
    consultorId: string,
    data: RegistroData,
    opts: { criadoPorId?: string } = {}
  ) {
    const consultor = await prisma.consultor.findFirst({
      where: { id: consultorId, tenantId, deletedAt: null },
    });
    if (!consultor) throw createError('Consultor não encontrado', 404, 'CONSULTOR_NOT_FOUND');
    if (consultor.status !== 'ATIVO') {
      throw createError('Consultor suspenso/inativo não pode registrar oportunidades', 403, 'CONSULTOR_NOT_ACTIVE');
    }

    const clienteCnpjDigits = cnpjKey(data.clienteCnpj);
    const registro = await prisma.registroOportunidade.create({
      data: {
        tenantId,
        consultorId,
        criadoPorId: opts.criadoPorId ?? null,
        clienteNome: collapseSpaces(data.clienteNome),
        clienteCnpj: data.clienteCnpj ?? null,
        clienteCnpjDigits,
        clienteContato: data.clienteContato ?? null,
        descricao: data.descricao,
        valorEstimado: data.valorEstimado ?? null,
        observacoes: data.observacoes ?? null,
        // Atribuição mínima: o registrante é o ORIGINADOR (req 29).
        atribuicoes: { create: { tenantId, consultorId, papel: 'ORIGINADOR' } },
      },
    });
    await audit(tenantId, registro.id, 'SUBMETIDO', null, opts.criadoPorId ?? consultor.userId);

    // Detecção determinística de conflito na submissão (req 16).
    const candidatos = await detectConflitos(tenantId, {
      id: registro.id,
      consultorId,
      clienteCnpjDigits,
      clienteNome: registro.clienteNome,
      clienteContato: registro.clienteContato,
    });

    // Duplicata do PRÓPRIO consultor (não é conflito — apenas sinaliza).
    const possivelDuplicata = await detectDuplicatasDoConsultor(tenantId, {
      id: registro.id,
      consultorId,
      clienteCnpjDigits,
      clienteNome: registro.clienteNome,
    });
    if (possivelDuplicata.length > 0) {
      await audit(
        tenantId,
        registro.id,
        'DUPLICATA_DETECTADA',
        `${possivelDuplicata.length} possível(is) duplicata(s) do mesmo consultor: ${possivelDuplicata.map((d) => d.clienteNome).join('; ')}`
      );
      const gestorIds = await getGestorIds(tenantId);
      await notifyParceiro(tenantId, {
        userIds: gestorIds,
        type: 'PARCEIRO_REGISTRO_SUBMETIDO',
        title: 'Possível registro duplicado',
        message: `${consultor.nome} registrou "${registro.clienteNome}" — possível duplicata de registro do próprio consultor. Considere unificar.`,
        link: '/app/parceiros',
        metadata: { registroId: registro.id, possivelDuplicata },
        skipEmail: true,
      });
    }

    if (candidatos.length > 0) {
      await persistConflitos(tenantId, registro.id, candidatos);
      await updateStatusWithAudit(
        tenantId,
        registro.id,
        'EM_ANALISE',
        {},
        'CONFLITO_DETECTADO',
        `${candidatos.length} candidato(s): ${candidatos.map((c) => c.matchChave).join('; ')}`,
        null
      );

      // Empate/simultâneos: mover TAMBÉM os alvos EXTERNO_EXTERNO ainda pendentes
      // (SUBMETIDO/EM_ANALISE) para EM_ANALISE, para que o gestor os resolva juntos.
      const alvoRegistroIds = [
        ...new Set(candidatos.filter((c) => c.tipo === 'EXTERNO_EXTERNO' && c.alvoRegistroId).map((c) => c.alvoRegistroId as string)),
      ];
      for (const alvoId of alvoRegistroIds) {
        const alvo = await prisma.registroOportunidade.findFirst({
          where: { id: alvoId, tenantId, deletedAt: null, status: { in: ['SUBMETIDO', 'EM_ANALISE'] } },
          select: { id: true, status: true },
        });
        if (alvo && alvo.status === 'SUBMETIDO') {
          await updateStatusWithAudit(
            tenantId,
            alvo.id,
            'EM_ANALISE',
            {},
            'CONFLITO_DETECTADO',
            `Conflito simultâneo com registro ${registro.id}`,
            null
          );
        }
      }

      // Notifica quem resolve: gestores (externo×externo) e/ou usuário designado
      // (externo×interno) — req 18/36. Consultor NÃO é notificado do conflito.
      await notifyResolutoresConflito(
        tenantId,
        candidatos,
        `Registro de ${consultor.nome} para "${registro.clienteNome}" colide com outra frente. Resolução manual necessária.`,
        registro.id
      );
    } else {
      const gestorIds = await getGestorIds(tenantId);
      await notifyParceiro(tenantId, {
        userIds: gestorIds,
        type: 'PARCEIRO_REGISTRO_SUBMETIDO',
        title: 'Novo registro de oportunidade',
        message: `${consultor.nome} registrou "${registro.clienteNome}" — aguardando aprovação.`,
        link: '/app/parceiros',
        metadata: { registroId: registro.id },
      });
    }

    // Confirmação ao CONSULTOR (portal e interno-em-nome): sempre avisa quem
    // registrou que o registro foi recebido (in-app + e-mail + WhatsApp) — req 29.
    await notifyParceiro(tenantId, {
      userIds: [consultor.userId],
      type: 'PARCEIRO_REGISTRO_SUBMETIDO',
      title: 'Registro recebido',
      message: `Recebemos seu registro para "${registro.clienteNome}". Você será avisado sobre a decisão.`,
      link: '/portal',
      metadata: { registroId: registro.id },
      whatsappConsultorIds: [consultorId],
    });

    await prisma.consultor.update({ where: { id: consultorId }, data: { ultimaAtividadeEm: new Date() } }).catch(() => {});
    const full = await this.get(tenantId, registro.id);
    return { ...full, possivelDuplicata };
  },

  /**
   * Aprova o registro (req 9/11): exige conflitos resolvidos (como origem OU
   * alvo), concede a janela de proteção (padrão do tenant, ajustável), agenda o 1º
   * update obrigatório e cria/vincula o Deal no pipeline via dealService (funil
   * default → 1ª coluna) com DealSource "Parceiro" (req 10).
   */
  async approve(tenantId: string, id: string, userId: string, opts: { protecaoDias?: number; motivo?: string } = {}) {
    const registro = await prisma.registroOportunidade.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { consultor: true, conflitos: true },
    });
    if (!registro) throw createError('Registro não encontrado', 404, 'REGISTRO_NOT_FOUND');
    if (registro.status !== 'SUBMETIDO' && registro.status !== 'EM_ANALISE') {
      throw createError('Registro não está aguardando decisão', 400, 'INVALID_STATUS');
    }
    // Bloqueia se houver conflito ABERTO em que o registro seja ORIGEM OU ALVO.
    const conflitoAberto = await prisma.conflitoCandidato.findFirst({
      where: { tenantId, status: 'ABERTO', OR: [{ registroId: id }, { alvoRegistroId: id }] },
      select: { id: true },
    });
    if (conflitoAberto) {
      throw createError('Há conflito em aberto — resolva antes de aprovar', 400, 'CONFLITO_ABERTO');
    }

    const config = await parceiroConfigService.get(tenantId);
    const protecaoDias = opts.protecaoDias ?? config.protecaoDiasPadrao;
    const updateCadencia = registro.updateCadenciaDias ?? config.updateCadenciaDias;
    const now = new Date();
    const protecaoFim = new Date(now.getTime() + protecaoDias * 24 * 60 * 60 * 1000);
    const proximoUpdateEm = new Date(now.getTime() + updateCadencia * 24 * 60 * 60 * 1000);

    // Vincula ao pipeline (tag sourced=Parceiro). Company por CNPJ quando houver.
    let companyId: string | null = null;
    if (registro.clienteCnpjDigits) {
      const companies = await prisma.company.findMany({
        where: { tenantId, deletedAt: null, cnpj: { not: null } },
        select: { id: true, cnpj: true },
      });
      companyId = companies.find((c) => cnpjKey(c.cnpj) === registro.clienteCnpjDigits)?.id ?? null;
    }
    const sourceId = await ensureParceiroSource(tenantId);
    // Cria via dealService p/ posicionar no funil default/1ª coluna (não órfão).
    const funnelId = await defaultFunnelId(tenantId);
    const deal = await dealService.create(tenantId, {
      name: `[Parceiro] ${registro.clienteNome}`,
      value: registro.valorEstimado ? Number(registro.valorEstimado) : 0,
      companyId,
      notes: registro.descricao,
      sourceId,
      assignedTo: userId,
      ...(funnelId ? { funnelId } : {}),
    });

    await updateStatusWithAudit(
      tenantId,
      id,
      'APROVADO',
      {
        decididoPorId: userId,
        decididoEm: now,
        motivoDecisao: opts.motivo ?? null,
        protecaoDias,
        protecaoFim,
        proximoUpdateEm,
        avisoExpiracaoEnviadoEm: null,
        dealId: deal.id,
        ultimaAtividadeEm: now,
      },
      'APROVADO',
      `Janela de proteção: ${protecaoDias} dias${opts.motivo ? ` — ${opts.motivo}` : ''}`,
      userId
    );

    await notifyParceiro(tenantId, {
      userIds: [registro.consultor.userId],
      type: 'PARCEIRO_REGISTRO_DECIDIDO',
      title: 'Oportunidade aprovada',
      message: `Seu registro "${registro.clienteNome}" foi aprovado. Exclusividade até ${protecaoFim.toLocaleDateString('pt-BR')}.`,
      link: '/portal',
      metadata: { registroId: id, decisao: 'APROVADO' },
      whatsappConsultorIds: [registro.consultorId],
    });
    return this.get(tenantId, id);
  },

  /** Rejeita com justificativa obrigatória (req 9), visível ao consultor. */
  async reject(tenantId: string, id: string, userId: string, motivo: string) {
    const registro = await prisma.registroOportunidade.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { consultor: true },
    });
    if (!registro) throw createError('Registro não encontrado', 404, 'REGISTRO_NOT_FOUND');
    if (registro.status !== 'SUBMETIDO' && registro.status !== 'EM_ANALISE') {
      throw createError('Registro não está aguardando decisão', 400, 'INVALID_STATUS');
    }
    await updateStatusWithAudit(
      tenantId,
      id,
      'REJEITADO',
      { decididoPorId: userId, decididoEm: new Date(), motivoDecisao: motivo },
      'REJEITADO',
      motivo,
      userId
    );
    await notifyParceiro(tenantId, {
      userIds: [registro.consultor.userId],
      type: 'PARCEIRO_REGISTRO_DECIDIDO',
      title: 'Registro não aprovado',
      message: `Seu registro "${registro.clienteNome}" não foi aprovado: ${motivo}`,
      link: '/portal',
      metadata: { registroId: id, decisao: 'REJEITADO' },
      whatsappConsultorIds: [registro.consultorId],
    });
    return this.get(tenantId, id);
  },

  /** Update de progresso ("prova de trabalho", req 12) — renova o próximo prazo. */
  async addUpdate(tenantId: string, registroId: string, autorId: string, texto: string) {
    const registro = await prisma.registroOportunidade.findFirst({
      where: { id: registroId, tenantId, deletedAt: null },
    });
    if (!registro) throw createError('Registro não encontrado', 404, 'REGISTRO_NOT_FOUND');
    const config = await parceiroConfigService.get(tenantId);
    const cadencia = registro.updateCadenciaDias ?? config.updateCadenciaDias;
    const now = new Date();
    const update = await prisma.registroUpdate.create({
      data: { tenantId, registroId, autorId, texto },
    });
    await prisma.registroOportunidade.update({
      where: { id: registroId },
      data: {
        ultimaAtividadeEm: now,
        ...(registro.status === 'APROVADO'
          ? { proximoUpdateEm: new Date(now.getTime() + cadencia * 24 * 60 * 60 * 1000) }
          : {}),
      },
    });
    await prisma.consultor
      .update({ where: { id: registro.consultorId }, data: { ultimaAtividadeEm: now } })
      .catch(() => {});
    return update;
  },

  // ── Reativação / ajuste de janela (gestor) ─────────────────────────────────

  /**
   * Reativa um registro EXPIRADO → volta a APROVADO, re-concede a janela de
   * proteção a partir de agora e re-agenda o próximo update. Auditado + notifica.
   */
  async reativar(tenantId: string, id: string, userId: string, opts: { protecaoDias?: number; motivo?: string } = {}) {
    const registro = await prisma.registroOportunidade.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { consultor: true },
    });
    if (!registro) throw createError('Registro não encontrado', 404, 'REGISTRO_NOT_FOUND');
    if (registro.status !== 'EXPIRADO') {
      throw createError('Só registros expirados podem ser reativados', 400, 'REGISTRO_NOT_EXPIRED');
    }
    const config = await parceiroConfigService.get(tenantId);
    const protecaoDias = opts.protecaoDias ?? registro.protecaoDias ?? config.protecaoDiasPadrao;
    const updateCadencia = registro.updateCadenciaDias ?? config.updateCadenciaDias;
    const now = new Date();
    const protecaoFim = new Date(now.getTime() + protecaoDias * 24 * 60 * 60 * 1000);
    const proximoUpdateEm = new Date(now.getTime() + updateCadencia * 24 * 60 * 60 * 1000);

    await updateStatusWithAudit(
      tenantId,
      id,
      'APROVADO',
      {
        protecaoDias,
        protecaoFim,
        proximoUpdateEm,
        avisoExpiracaoEnviadoEm: null,
        ultimaAtividadeEm: now,
      },
      'REATIVADO',
      `Reativado por ${protecaoDias} dias${opts.motivo ? ` — ${opts.motivo}` : ''}`,
      userId
    );

    await notifyParceiro(tenantId, {
      userIds: [registro.consultor.userId],
      type: 'PARCEIRO_REGISTRO_DECIDIDO',
      title: 'Oportunidade reativada',
      message: `Seu registro "${registro.clienteNome}" foi reativado. Exclusividade até ${protecaoFim.toLocaleDateString('pt-BR')}.`,
      link: '/portal',
      metadata: { registroId: id, evento: 'REATIVADO' },
      whatsappConsultorIds: [registro.consultorId],
    });
    return this.get(tenantId, id);
  },

  /**
   * Ajusta a janela de proteção de um registro APROVADO — por nº de dias a partir
   * de agora OU por uma data absoluta. Zera o dedup de aviso. Auditado (motivo).
   */
  async ajustarProtecao(
    tenantId: string,
    id: string,
    userId: string,
    opts: { dias?: number; novoFim?: string | Date; motivo: string }
  ) {
    const registro = await prisma.registroOportunidade.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!registro) throw createError('Registro não encontrado', 404, 'REGISTRO_NOT_FOUND');
    if (registro.status !== 'APROVADO') {
      throw createError('Só registros aprovados têm janela para ajustar', 400, 'INVALID_STATUS');
    }
    const now = new Date();
    let protecaoFim: Date;
    if (opts.novoFim !== undefined && opts.novoFim !== null) {
      protecaoFim = opts.novoFim instanceof Date ? opts.novoFim : new Date(opts.novoFim);
      if (Number.isNaN(protecaoFim.getTime())) {
        throw createError('Data de fim inválida', 400, 'VALIDATION_ERROR');
      }
    } else if (opts.dias !== undefined && opts.dias !== null) {
      protecaoFim = new Date(now.getTime() + opts.dias * 24 * 60 * 60 * 1000);
    } else {
      throw createError('Informe dias ou novoFim para ajustar a proteção', 400, 'VALIDATION_ERROR');
    }

    await prisma.$transaction(async (tx) => {
      await tx.registroOportunidade.update({
        where: { id },
        data: { protecaoFim, avisoExpiracaoEnviadoEm: null, ultimaAtividadeEm: now },
      });
      await tx.registroAuditoria.create({
        data: {
          tenantId,
          registroId: id,
          evento: 'PROTECAO_AJUSTADA',
          detalhe: `Nova expiração ${protecaoFim.toLocaleDateString('pt-BR')} — ${opts.motivo}`,
          autorId: userId,
        },
      });
    });
    return this.get(tenantId, id);
  },

  /**
   * Atualiza os dados do cliente de um registro (nome/CNPJ/contato), recomputa a
   * chave de CNPJ e re-roda a detecção de conflito, criando NOVOS candidatos
   * (dedup contra existentes). Se APROVADO/GANHO, NÃO muda o status (conflito
   * superveniente sinalizado); se SUBMETIDO e achou conflito, move p/ EM_ANALISE.
   */
  async updateCliente(
    tenantId: string,
    id: string,
    userId: string,
    data: { clienteNome?: string; clienteCnpj?: string | null; clienteContato?: string | null }
  ) {
    const registro = await prisma.registroOportunidade.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { consultor: true },
    });
    if (!registro) throw createError('Registro não encontrado', 404, 'REGISTRO_NOT_FOUND');

    const clienteNome = data.clienteNome !== undefined ? collapseSpaces(data.clienteNome) : registro.clienteNome;
    const clienteCnpj = data.clienteCnpj !== undefined ? data.clienteCnpj : registro.clienteCnpj;
    const clienteContato = data.clienteContato !== undefined ? data.clienteContato : registro.clienteContato;
    const clienteCnpjDigits = cnpjKey(clienteCnpj);

    const updated = await prisma.registroOportunidade.update({
      where: { id },
      data: { clienteNome, clienteCnpj: clienteCnpj ?? null, clienteCnpjDigits, clienteContato: clienteContato ?? null },
    });
    await audit(
      tenantId,
      id,
      'CLIENTE_ATUALIZADO',
      `Cliente atualizado para "${clienteNome}"${clienteCnpjDigits ? ` (CNPJ ${clienteCnpjDigits})` : ''}`,
      userId
    );

    // Re-roda a detecção com os novos dados.
    const candidatos = await detectConflitos(tenantId, {
      id: updated.id,
      consultorId: updated.consultorId,
      clienteCnpjDigits,
      clienteNome: updated.clienteNome,
      clienteContato: updated.clienteContato,
    });
    const criados = await persistConflitos(tenantId, id, candidatos);

    if (criados > 0) {
      await audit(tenantId, id, 'CONFLITO_DETECTADO', `${criados} novo(s) candidato(s) após atualização de cliente`, userId);
      // APROVADO/GANHO: NÃO muda status — conflito superveniente só sinaliza.
      // SUBMETIDO: move p/ EM_ANALISE (EM_ANALISE já está em análise).
      if (updated.status === 'SUBMETIDO') {
        await updateStatusWithAudit(
          tenantId,
          id,
          'EM_ANALISE',
          {},
          'CONFLITO_DETECTADO',
          'Conflito detectado após atualização de cliente',
          userId
        );
      }
      await notifyResolutoresConflito(
        tenantId,
        candidatos,
        `Atualização de "${updated.clienteNome}" (${registro.consultor.nome}) gerou candidato a conflito. Resolução manual necessária.`,
        id
      );
    }
    return this.get(tenantId, id);
  },

  /**
   * Re-roda a detecção de conflito para todos os registros APROVADOS/GANHO ativos
   * do tenant e cria NOVOS candidatos supervenientes (dedup contra existentes).
   * NÃO altera status. Notifica gestores/designado. Retorna quantos criou.
   * Chamado pelo job periódico.
   */
  async redetectConflitosSupervenientes(tenantId: string): Promise<number> {
    const registros = await prisma.registroOportunidade.findMany({
      where: { tenantId, deletedAt: null, status: { in: ['APROVADO', 'GANHO'] } },
      select: {
        id: true,
        consultorId: true,
        clienteCnpjDigits: true,
        clienteNome: true,
        clienteContato: true,
        consultor: { select: { nome: true } },
      },
    });
    let totalCriados = 0;
    for (const r of registros) {
      const candidatos = await detectConflitos(tenantId, {
        id: r.id,
        consultorId: r.consultorId,
        clienteCnpjDigits: r.clienteCnpjDigits,
        clienteNome: r.clienteNome,
        clienteContato: r.clienteContato,
      });
      const criados = await persistConflitos(tenantId, r.id, candidatos);
      if (criados > 0) {
        totalCriados += criados;
        await audit(tenantId, r.id, 'CONFLITO_SUPERVENIENTE', `${criados} novo(s) candidato(s) detectado(s) supervenientemente`);
        await notifyResolutoresConflito(
          tenantId,
          candidatos,
          `Conflito superveniente detectado em "${r.clienteNome}" (${r.consultor.nome}). Resolução manual necessária.`,
          r.id
        );
      }
    }
    return totalCriados;
  },

  // ── Extensão da janela (req 14) ─────────────────────────────────────────────

  async requestExtensao(
    tenantId: string,
    consultorId: string,
    registroId: string,
    data: { justificativa: string; diasSolicitados?: number }
  ) {
    const registro = await prisma.registroOportunidade.findFirst({
      where: { id: registroId, tenantId, consultorId, deletedAt: null },
      include: { consultor: { select: { nome: true } } },
    });
    if (!registro) throw createError('Registro não encontrado', 404, 'REGISTRO_NOT_FOUND');
    if (registro.status !== 'APROVADO') {
      throw createError('Só registros aprovados têm janela para estender', 400, 'INVALID_STATUS');
    }
    const pendente = await prisma.registroExtensao.findFirst({
      where: { tenantId, registroId, status: 'PENDENTE' },
    });
    if (pendente) throw createError('Já existe um pedido de extensão pendente', 400, 'EXTENSAO_PENDENTE');

    const extensao = await prisma.registroExtensao.create({
      data: { tenantId, registroId, justificativa: data.justificativa, diasSolicitados: data.diasSolicitados ?? null },
    });
    await audit(tenantId, registroId, 'EXTENSAO_SOLICITADA', data.justificativa);
    const gestorIds = await getGestorIds(tenantId);
    await notifyUsers(tenantId, gestorIds, {
      type: 'PARCEIRO_EXTENSAO',
      title: 'Pedido de extensão de janela',
      message: `${registro.consultor.nome} pediu extensão para "${registro.clienteNome}".`,
      link: '/app/parceiros',
      metadata: { registroId, extensaoId: extensao.id },
    });
    return extensao;
  },

  async decideExtensao(
    tenantId: string,
    extensaoId: string,
    userId: string,
    data: { aprovar: boolean; dias?: number; motivo?: string }
  ) {
    const extensao = await prisma.registroExtensao.findFirst({
      where: { id: extensaoId, tenantId, status: 'PENDENTE' },
      include: { registro: { include: { consultor: true } } },
    });
    if (!extensao) throw createError('Pedido de extensão não encontrado', 404, 'EXTENSAO_NOT_FOUND');

    const now = new Date();
    if (data.aprovar) {
      const dias = data.dias ?? extensao.diasSolicitados ?? 30;
      const base = extensao.registro.protecaoFim && extensao.registro.protecaoFim > now ? extensao.registro.protecaoFim : now;
      const novoFim = new Date(base.getTime() + dias * 24 * 60 * 60 * 1000);
      await prisma.registroExtensao.update({
        where: { id: extensaoId },
        data: { status: 'APROVADA', decididoPorId: userId, decididoEm: now, motivoDecisao: data.motivo ?? null },
      });
      await prisma.registroOportunidade.update({
        where: { id: extensao.registroId },
        data: { protecaoFim: novoFim, avisoExpiracaoEnviadoEm: null, ultimaAtividadeEm: now },
      });
      await audit(tenantId, extensao.registroId, 'EXTENSAO_APROVADA', `${dias} dias — nova expiração ${novoFim.toLocaleDateString('pt-BR')}`, userId);
    } else {
      await prisma.registroExtensao.update({
        where: { id: extensaoId },
        data: { status: 'NEGADA', decididoPorId: userId, decididoEm: now, motivoDecisao: data.motivo ?? null },
      });
      await audit(tenantId, extensao.registroId, 'EXTENSAO_NEGADA', data.motivo ?? null, userId);
    }
    await notifyParceiro(tenantId, {
      userIds: [extensao.registro.consultor.userId],
      type: 'PARCEIRO_EXTENSAO',
      title: data.aprovar ? 'Extensão aprovada' : 'Extensão negada',
      message: `Seu pedido de extensão para "${extensao.registro.clienteNome}" foi ${data.aprovar ? 'aprovado' : 'negado'}${data.motivo ? `: ${data.motivo}` : '.'}`,
      link: '/portal',
      metadata: { registroId: extensao.registroId, extensaoId },
      whatsappConsultorIds: [extensao.registro.consultorId],
    });
    return this.get(tenantId, extensao.registroId);
  },

  // ── Resultado (ganho/perdido) ───────────────────────────────────────────────

  /** Marca GANHO com o valor do contrato — habilita recebimentos/comissão (req 31). */
  async marcarGanho(tenantId: string, id: string, userId: string, valorContrato: number) {
    const registro = await prisma.registroOportunidade.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!registro) throw createError('Registro não encontrado', 404, 'REGISTRO_NOT_FOUND');
    if (registro.status === 'GANHO') throw createError('Registro já marcado como ganho', 400, 'ALREADY_WON');
    if (registro.status !== 'APROVADO' && registro.status !== 'EXPIRADO') {
      throw createError('Só registros aprovados (ou expirados, a critério do gestor) podem ser ganhos', 400, 'INVALID_STATUS');
    }
    const now = new Date();
    await updateStatusWithAudit(
      tenantId,
      id,
      'GANHO',
      { ganhoEm: now, valorContrato, ultimaAtividadeEm: now },
      'GANHO',
      `Valor do contrato: R$ ${valorContrato.toLocaleString('pt-BR')}`,
      userId
    );
    // Alinha o deal vinculado (stage E status — gotcha do repo) na transição real.
    if (registro.dealId) {
      await prisma.deal
        .update({
          where: { id: registro.dealId },
          data: { status: 'WON', stage: 'WON', probability: 100, wonAt: now, value: valorContrato },
        })
        .catch((err) => logger.error('Falha ao alinhar deal GANHO', err));
    }
    return this.get(tenantId, id);
  },

  /**
   * Marca PERDIDO (req: gestor descarta a oportunidade). Permitido apenas a partir
   * de APROVADO | EXPIRADO | SUBMETIDO | EM_ANALISE. De SUBMETIDO/EM_ANALISE exige
   * motivo não-vazio. Bloqueia se houver conflito ABERTO (origem OU alvo).
   */
  async marcarPerdido(tenantId: string, id: string, userId: string, motivo?: string) {
    const registro = await prisma.registroOportunidade.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!registro) throw createError('Registro não encontrado', 404, 'REGISTRO_NOT_FOUND');
    if (registro.status === 'REJEITADO' || registro.status === 'GANHO' || registro.status === 'PERDIDO') {
      throw createError('Registro já finalizado', 400, 'INVALID_STATUS');
    }
    if (
      registro.status !== 'APROVADO' &&
      registro.status !== 'EXPIRADO' &&
      registro.status !== 'SUBMETIDO' &&
      registro.status !== 'EM_ANALISE'
    ) {
      throw createError('Registro não pode ser marcado como perdido neste status', 400, 'INVALID_STATUS');
    }
    // De SUBMETIDO/EM_ANALISE, o motivo é obrigatório (descarte antes da decisão).
    if ((registro.status === 'SUBMETIDO' || registro.status === 'EM_ANALISE') && !motivo?.trim()) {
      throw createError('Motivo é obrigatório para descartar um registro em análise', 400, 'MOTIVO_REQUIRED');
    }
    // Bloqueia se houver conflito ABERTO em que o registro seja ORIGEM OU ALVO.
    const conflitoAberto = await prisma.conflitoCandidato.findFirst({
      where: { tenantId, status: 'ABERTO', OR: [{ registroId: id }, { alvoRegistroId: id }] },
      select: { id: true },
    });
    if (conflitoAberto) {
      throw createError('Há conflito em aberto — resolva antes de marcar como perdido', 400, 'CONFLITO_ABERTO');
    }
    const now = new Date();
    await updateStatusWithAudit(
      tenantId,
      id,
      'PERDIDO',
      { ultimaAtividadeEm: now, motivoDecisao: motivo ?? registro.motivoDecisao },
      'PERDIDO',
      motivo ?? null,
      userId
    );
    if (registro.dealId) {
      await prisma.deal
        .update({ where: { id: registro.dealId }, data: { status: 'LOST', stage: 'LOST', lostAt: now } })
        .catch((err) => logger.error('Falha ao alinhar deal PERDIDO', err));
    }
    return this.get(tenantId, id);
  },

  // ── Conflitos (req 18) ──────────────────────────────────────────────────────

  async listConflitos(tenantId: string, status: 'ABERTO' | 'RESOLVIDO' = 'ABERTO') {
    const conflitos = await prisma.conflitoCandidato.findMany({
      where: { tenantId, status },
      include: {
        registro: { include: { consultor: { select: { id: true, nome: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    // Resolve os alvos (outro registro / deal / company) para o resolutor ver os dois
    // lados — inclui descricao/valorEstimado (registro) e notes/value (deal) para
    // comparar a "mesma demanda".
    return Promise.all(
      conflitos.map(async (c) => {
        const alvoRegistro = c.alvoRegistroId
          ? await prisma.registroOportunidade.findFirst({
              where: { id: c.alvoRegistroId, tenantId },
              select: {
                id: true,
                clienteNome: true,
                status: true,
                createdAt: true,
                descricao: true,
                valorEstimado: true,
                consultor: { select: { id: true, nome: true } },
              },
            })
          : null;
        const alvoDeal = c.alvoDealId
          ? await prisma.deal.findFirst({
              where: { id: c.alvoDealId, tenantId },
              select: { id: true, name: true, stage: true, status: true, notes: true, value: true },
            })
          : null;
        const alvoCompany = c.alvoCompanyId
          ? await prisma.company.findFirst({ where: { id: c.alvoCompanyId, tenantId }, select: { id: true, name: true, cnpj: true } })
          : null;
        return { ...c, alvoRegistro, alvoDeal, alvoCompany };
      })
    );
  },

  /**
   * Resolve um candidato a conflito (decisão SEMPRE manual — req 17/18):
   * MANTER/INDEPENDENTE liberam o registro p/ aprovação; REJEITAR rejeita o
   * registro (sem revelar a outra frente ao consultor). Tudo auditado.
   */
  async resolveConflito(
    tenantId: string,
    conflitoId: string,
    userId: string,
    data: { decisao: ConflitoDecisao; rationale: string }
  ) {
    const conflito = await prisma.conflitoCandidato.findFirst({
      where: { id: conflitoId, tenantId, status: 'ABERTO' },
      include: { registro: { include: { consultor: true } } },
    });
    if (!conflito) throw createError('Conflito não encontrado ou já resolvido', 404, 'CONFLITO_NOT_FOUND');

    const now = new Date();
    await prisma.conflitoCandidato.update({
      where: { id: conflitoId },
      data: { status: 'RESOLVIDO', decisao: data.decisao, rationale: data.rationale, resolvidoPorId: userId, resolvidoEm: now },
    });
    await audit(
      tenantId,
      conflito.registroId,
      'CONFLITO_RESOLVIDO',
      `Decisão: ${data.decisao} — ${data.rationale} (chave: ${conflito.matchChave})`,
      userId
    );

    if (data.decisao === 'REJEITAR') {
      // Rejeita em favor da outra frente — mensagem NEUTRA ao consultor (req 5).
      await this.reject(tenantId, conflito.registroId, userId, 'Oportunidade já em desenvolvimento por outra frente da empresa');
      // A origem foi rejeitada, mas o alvo também ficou preso em EM_ANALISE na
      // detecção — se não sobrou conflito aberto, ele volta para a fila.
      await destravarSemConflitoAberto(tenantId, [conflito.alvoRegistroId], userId);
      return this.listConflitos(tenantId, 'ABERTO');
    }

    // MANTER/INDEPENDENTE: destrava origem e alvo que não têm mais conflito aberto.
    await destravarSemConflitoAberto(tenantId, [conflito.registroId, conflito.alvoRegistroId], userId);
    return this.listConflitos(tenantId, 'ABERTO');
  },

  /** Matriz de sobreposição (req 19): CNPJs tocados por mais de uma frente. */
  async overlapMatrix(tenantId: string) {
    const registros = await prisma.registroOportunidade.findMany({
      where: { tenantId, deletedAt: null, status: { in: ACTIVE_STATUSES }, clienteCnpjDigits: { not: null } },
      select: { clienteCnpjDigits: true, clienteNome: true, consultor: { select: { id: true, nome: true } } },
    });
    const companies = await prisma.company.findMany({
      where: { tenantId, deletedAt: null, cnpj: { not: null } },
      select: { id: true, name: true, cnpj: true },
    });
    const companyByCnpj = new Map<string, { id: string; name: string }>();
    for (const c of companies) {
      const key = cnpjKey(c.cnpj);
      if (key) companyByCnpj.set(key, { id: c.id, name: c.name });
    }

    const porCnpj = new Map<string, { clienteNome: string; frentes: Array<{ tipo: 'CONSULTOR' | 'INTERNO'; nome: string }> }>();
    for (const r of registros) {
      const key = r.clienteCnpjDigits as string;
      const row = porCnpj.get(key) ?? { clienteNome: r.clienteNome, frentes: [] };
      if (!row.frentes.some((f) => f.tipo === 'CONSULTOR' && f.nome === r.consultor.nome)) {
        row.frentes.push({ tipo: 'CONSULTOR', nome: r.consultor.nome });
      }
      porCnpj.set(key, row);
    }
    for (const [key, row] of porCnpj) {
      const interna = companyByCnpj.get(key);
      if (interna) {
        const temDealAberto = await prisma.deal.findFirst({
          where: { tenantId, companyId: interna.id, deletedAt: null, status: 'OPEN' },
          select: { id: true },
        });
        if (temDealAberto) row.frentes.push({ tipo: 'INTERNO', nome: `Pipeline interno (${interna.name})` });
      }
    }
    return [...porCnpj.entries()]
      .filter(([, row]) => row.frentes.length > 1)
      .map(([cnpj, row]) => ({ cnpj, ...row }));
  },

  // ── Portal (consultor — visibilidade restrita, reqs 4-5) ──────────────────

  async listDoConsultor(tenantId: string, consultorId: string) {
    const registros = await prisma.registroOportunidade.findMany({
      where: { tenantId, consultorId, deletedAt: null },
      include: {
        planoAcao: { where: { responsavelConsultor: true, status: 'PENDENTE' }, orderBy: { dueDate: 'asc' } },
        _count: { select: { updates: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    // NUNCA expõe conflitos/identidades — só o status ("Em análise" é neutro).
    return registros;
  },

  async getDoConsultor(tenantId: string, consultorId: string, id: string) {
    const registro = await prisma.registroOportunidade.findFirst({
      where: { id, tenantId, consultorId, deletedAt: null },
      include: {
        updates: { orderBy: { createdAt: 'desc' } },
        extensoes: { orderBy: { createdAt: 'desc' } },
        planoAcao: { where: { responsavelConsultor: true }, orderBy: { dueDate: 'asc' } },
      },
    });
    if (!registro) throw createError('Registro não encontrado', 404, 'REGISTRO_NOT_FOUND');
    const deal = registro.dealId
      ? await prisma.deal.findFirst({ where: { id: registro.dealId, tenantId }, select: { stage: true, status: true } })
      : null;
    return { ...registro, deal };
  },

  // ── Helpers do job (expiração/lembretes — reqs 13/15) ─────────────────────

  async findParaAvisoExpiracao(tenantId: string, avisoDias: number) {
    const now = new Date();
    const limite = new Date(now.getTime() + avisoDias * 24 * 60 * 60 * 1000);
    return prisma.registroOportunidade.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: 'APROVADO',
        avisoExpiracaoEnviadoEm: null,
        protecaoFim: { gt: now, lte: limite },
      },
      include: { consultor: true },
    });
  },

  async markAvisoEnviado(id: string) {
    await prisma.registroOportunidade.update({ where: { id }, data: { avisoExpiracaoEnviadoEm: new Date() } });
  },

  async findVencidos(tenantId: string) {
    return prisma.registroOportunidade.findMany({
      where: { tenantId, deletedAt: null, status: 'APROVADO', protecaoFim: { lt: new Date() } },
      include: { consultor: true },
    });
  },

  /** Expira (req 15): sinaliza EXPIRADO e notifica — o gestor decide caso a caso. */
  async expire(tenantId: string, id: string) {
    const registro = await prisma.registroOportunidade.findFirst({
      where: { id, tenantId, status: 'APROVADO' },
      include: { consultor: true },
    });
    if (!registro) return;
    await updateStatusWithAudit(
      tenantId,
      id,
      'EXPIRADO',
      {},
      'EXPIRADO',
      'Janela de proteção venceu sem atualização/extensão',
      null
    );
    const gestorIds = await getGestorIds(tenantId);
    await notifyUsers(tenantId, [...gestorIds, registro.consultor.userId], {
      type: 'PARCEIRO_EXPIRACAO',
      title: 'Registro expirado',
      message: `A janela de proteção de "${registro.clienteNome}" (${registro.consultor.nome}) expirou. O gestor decidirá o próximo passo.`,
      link: '/app/parceiros',
      metadata: { registroId: id, evento: 'EXPIRADO' },
    });
  },

  async findUpdatesAtrasados(tenantId: string) {
    return prisma.registroOportunidade.findMany({
      where: { tenantId, deletedAt: null, status: 'APROVADO', proximoUpdateEm: { lt: new Date() } },
      include: { consultor: true },
    });
  },
};
