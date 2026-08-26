// Job leve (setInterval, sem Redis) do módulo de Parceiros (reqs 13, 15, 20, 26, 28, 36-37):
//   - lembretes de update obrigatório em atraso (consultor);
//   - ações do plano de ação vencendo/vencida (responsável: consultor ou interno);
//   - aviso de expiração com antecedência configurável + expiração efetiva;
//   - reuniões AGENDADAS vencidas sem registro + cadência de reunião não agendada;
//   - re-detecção de conflitos supervenientes;
//   - score de saúde por consultor + alerta por PIORA de faixa OU queda >= limiar;
//   - digest diário ao gestor (in-app + e-mail best-effort).
// Notificação de evento ao consultor/gestor via notifyParceiro (in-app + e-mail +
// WhatsApp gated). Dedup diária via Notification.metadata (padrão do repo). Nunca lança.

import prisma from '../config/database.js';
import { logger } from '../utils/logger.js';
import { notificationService } from '../services/notificationService.js';
import { notifyParceiro } from '../services/parceiros/notifyParceiroService.js';
import { NotificationType } from '@prisma/client';

const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12h
const INITIAL_DELAY_MS = 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;

let intervalId: ReturnType<typeof setInterval> | null = null;

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function appUrl(path: string): string {
  const base = process.env.FRONTEND_URL || 'https://engage.vydhub.com';
  return `${base.replace(/\/$/, '')}${path}`;
}

async function getGestorIds(tenantId: string): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { tenantId, role: { in: ['ADMIN', 'GESTOR'] }, status: 'ACTIVE' },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/** Dedup diária: chaves `type:entityId` já notificadas hoje. */
async function notifiedToday(tenantId: string, types: NotificationType[]): Promise<Set<string>> {
  const rows = await prisma.notification.findMany({
    where: { tenantId, type: { in: types }, createdAt: { gte: startOfToday() } },
    select: { type: true, metadata: true },
  });
  const out = new Set<string>();
  for (const n of rows) {
    const meta = n.metadata as Record<string, unknown> | null;
    const key = (meta?.registroId ?? meta?.reuniaoId ?? meta?.acaoId ?? meta?.consultorId) as
      | string
      | undefined;
    if (key) out.add(`${n.type}:${key}`);
  }
  return out;
}

async function checkTenant(tenantId: string): Promise<void> {
  const { registroService } = await import('../services/parceiros/registroService.js');
  const { reuniaoService } = await import('../services/parceiros/reuniaoService.js');
  const { scoreService } = await import('../services/parceiros/scoreService.js');
  const { parceiroConfigService } = await import('../services/parceiros/configService.js');

  const config = await parceiroConfigService.get(tenantId);
  const dedup = await notifiedToday(tenantId, [
    NotificationType.PARCEIRO_UPDATE_PENDENTE,
    NotificationType.PARCEIRO_EXPIRACAO,
    NotificationType.PARCEIRO_REUNIAO,
    NotificationType.PARCEIRO_SCORE,
    NotificationType.PARCEIRO_ACAO_VENCIDA,
  ]);
  const gestorIds = await getGestorIds(tenantId);
  const digest: string[] = [];

  // 1) Updates obrigatórios em atraso → lembrete ao consultor (cobrança pela regra).
  const atrasados = await registroService.findUpdatesAtrasados(tenantId);
  for (const r of atrasados) {
    if (dedup.has(`${NotificationType.PARCEIRO_UPDATE_PENDENTE}:${r.id}`)) continue;
    await notifyParceiro(tenantId, {
      userIds: [r.consultor.userId],
      type: NotificationType.PARCEIRO_UPDATE_PENDENTE,
      title: 'Atualização pendente',
      message: `A oportunidade "${r.clienteNome}" está sem atualização — atualize para manter o registro ativo.`,
      link: '/portal',
      metadata: { registroId: r.id },
      whatsappConsultorIds: [r.consultorId],
    }).catch((err) => logger.error('parceiroChecker: notif update', err));
  }
  if (atrasados.length > 0) digest.push(`${atrasados.length} oportunidade(s) com atualização em atraso`);

  // 2) Ações do plano de ação vencendo/vencida → responsável (consultor ou interno) — req 20.
  const acaoLimite = new Date(Date.now() + 2 * DIA_MS);
  const acoesPendentes = await prisma.planoAcaoItem.findMany({
    where: {
      tenantId,
      status: 'PENDENTE',
      dueDate: { not: null, lt: acaoLimite },
      registro: { deletedAt: null },
    },
    include: { registro: { select: { clienteNome: true, consultor: { select: { id: true, userId: true } } } } },
  });
  const now0 = new Date();
  for (const a of acoesPendentes) {
    if (dedup.has(`${NotificationType.PARCEIRO_ACAO_VENCIDA}:${a.id}`)) continue;
    const vencida = a.dueDate !== null && a.dueDate < now0;
    const quando = vencida ? 'venceu' : 'vence em breve';
    const dataStr = a.dueDate ? a.dueDate.toLocaleDateString('pt-BR') : '';
    if (a.responsavelConsultor) {
      await notifyParceiro(tenantId, {
        userIds: [a.registro.consultor.userId],
        type: NotificationType.PARCEIRO_ACAO_VENCIDA,
        title: vencida ? 'Ação do plano vencida' : 'Ação do plano vencendo',
        message: `Ação "${a.descricao}" da oportunidade "${a.registro.clienteNome}" ${quando} (${dataStr}).`,
        link: '/portal',
        metadata: { acaoId: a.id, registroId: a.registroId },
        whatsappConsultorIds: [a.registro.consultor.id],
      }).catch((err) => logger.error('parceiroChecker: notif ação (consultor)', err));
    } else if (a.responsavelUserId) {
      await notifyParceiro(tenantId, {
        userIds: [a.responsavelUserId],
        type: NotificationType.PARCEIRO_ACAO_VENCIDA,
        title: vencida ? 'Ação do plano vencida' : 'Ação do plano vencendo',
        message: `Ação "${a.descricao}" da oportunidade "${a.registro.clienteNome}" ${quando} (${dataStr}).`,
        link: '/app/parceiros',
        metadata: { acaoId: a.id, registroId: a.registroId },
      }).catch((err) => logger.error('parceiroChecker: notif ação (interno)', err));
    }
  }

  // 3) Aviso de expiração (antecedência configurável) — consultor + gestor.
  const paraAvisar = await registroService.findParaAvisoExpiracao(tenantId, config.avisoExpiracaoDias);
  for (const r of paraAvisar) {
    const destinos = [r.consultor.userId, ...gestorIds];
    await notifyParceiro(tenantId, {
      userIds: [...new Set(destinos)],
      type: NotificationType.PARCEIRO_EXPIRACAO,
      title: 'Registro expira em breve',
      message: `A janela de proteção de "${r.clienteNome}" expira em ${r.protecaoFim?.toLocaleDateString('pt-BR')}. Atualize ou peça extensão.`,
      link: '/app/parceiros',
      metadata: { registroId: r.id, evento: 'AVISO' },
      whatsappConsultorIds: [r.consultorId],
    }).catch((err) => logger.error('parceiroChecker: notif aviso expiração', err));
    await registroService.markAvisoEnviado(r.id);
  }
  if (paraAvisar.length > 0) digest.push(`${paraAvisar.length} registro(s) expirando em ${config.avisoExpiracaoDias} dias`);

  // 4) Expiração efetiva — sinaliza EXPIRADO (gestor decide caso a caso).
  const vencidos = await registroService.findVencidos(tenantId);
  for (const r of vencidos) {
    await registroService.expire(tenantId, r.id).catch((err) => logger.error('parceiroChecker: expire', err));
  }
  if (vencidos.length > 0) digest.push(`${vencidos.length} registro(s) expirado(s)`);

  // 5) Re-detecção de conflitos supervenientes (deal/company interno criado depois — req superveniente).
  try {
    await registroService.redetectConflitosSupervenientes(tenantId);
  } catch (err) {
    logger.error('parceiroChecker: redetecção de conflitos supervenientes', err as Error);
  }

  // 6) Reuniões AGENDADAS vencidas sem registro de presença → pendência do gestor.
  const reunioesVencidas = await reuniaoService.vencidas(tenantId);
  for (const m of reunioesVencidas) {
    if (dedup.has(`${NotificationType.PARCEIRO_REUNIAO}:${m.id}`)) continue;
    await notifyParceiro(tenantId, {
      userIds: gestorIds,
      type: NotificationType.PARCEIRO_REUNIAO,
      title: 'Reunião de cadência pendente',
      message: `Reunião com ${m.consultor.nome} (${m.dataHora.toLocaleDateString('pt-BR')}) sem registro de presença.`,
      link: '/app/parceiros',
      metadata: { reuniaoId: m.id },
    }).catch((err) => logger.error('parceiroChecker: notif reunião', err));
  }
  if (reunioesVencidas.length > 0) digest.push(`${reunioesVencidas.length} reunião(ões) sem registro`);

  // 7) Cadência de reuniões: consultor ATIVO cuja última reunião REALIZADA/AGENDADA-futura
  //    é mais antiga que a cadência efetiva (ou inexistente) → alerta ao gestor (req H/28).
  const consultoresAtivos = await prisma.consultor.findMany({
    where: { tenantId, deletedAt: null, status: 'ATIVO' },
    select: { id: true, nome: true, cadenciaReuniaoDias: true },
  });
  const now = new Date();
  for (const c of consultoresAtivos) {
    if (dedup.has(`${NotificationType.PARCEIRO_REUNIAO}:${c.id}`)) continue;
    const cadenciaDias = c.cadenciaReuniaoDias ?? config.reuniaoCadenciaDias;
    const limiteCadencia = new Date(now.getTime() - cadenciaDias * DIA_MS);
    // Referência mais recente: reunião REALIZADA ou AGENDADA (inclui futuras).
    const referencia = await prisma.consultorReuniao.findFirst({
      where: { tenantId, consultorId: c.id, status: { in: ['REALIZADA', 'AGENDADA'] } },
      orderBy: { dataHora: 'desc' },
      select: { dataHora: true },
    });
    const semCadencia = !referencia || referencia.dataHora < limiteCadencia;
    if (!semCadencia) continue;
    await notifyParceiro(tenantId, {
      userIds: gestorIds,
      type: NotificationType.PARCEIRO_REUNIAO,
      title: 'Cadência de reunião pendente',
      message: `Reunião de cadência não agendada para ${c.nome} (cadência de ${cadenciaDias} dias). Agende um encontro.`,
      link: '/app/parceiros',
      metadata: { consultorId: c.id },
    }).catch((err) => logger.error('parceiroChecker: notif cadência reunião', err));
  }

  // 8) Score + alerta por PIORA de faixa OU queda >= limiar (tendência — req 26).
  const resultados = await scoreService.computeTenant(tenantId);
  for (const r of resultados) {
    if (dedup.has(`${NotificationType.PARCEIRO_SCORE}:${r.consultorId}`)) continue;

    // Queda de score >= limiar vs. o snapshot ANTERIOR (o atual já foi gravado no compute).
    const anteriores = await prisma.consultorScoreSnapshot.findMany({
      where: { tenantId, consultorId: r.consultorId },
      orderBy: { data: 'desc' },
      take: 2,
      select: { score: true },
    });
    const scoreAnterior = anteriores.length >= 2 ? anteriores[1].score : null;
    const caiuLimiar = scoreAnterior !== null && scoreAnterior - r.score >= config.quedaLimiarPontos;

    if (!r.pioroou && !caiuLimiar) continue;

    const consultor = await prisma.consultor.findUnique({
      where: { id: r.consultorId },
      select: { nome: true },
    });
    const motivo = r.pioroou
      ? `caiu para a faixa ${r.faixa} (score ${r.score})`
      : `teve queda de ${Math.round((scoreAnterior as number) - r.score)} pontos (score ${r.score}, faixa ${r.faixa})`;
    await notifyParceiro(tenantId, {
      userIds: gestorIds,
      type: NotificationType.PARCEIRO_SCORE,
      title: 'Consultor esfriando',
      message: `${consultor?.nome ?? 'Consultor'} ${motivo}. Vale um contato.`,
      link: '/app/parceiros',
      metadata: { consultorId: r.consultorId, faixa: r.faixa, score: r.score },
    }).catch((err) => logger.error('parceiroChecker: notif score', err));
  }
  const alertadosScore = resultados.filter((r) => r.pioroou).length;
  if (alertadosScore > 0) digest.push(`${alertadosScore} consultor(es) mudaram de faixa para pior`);

  // 9) Distribuição por faixa dos consultores ATIVOS (composição do digest).
  const porFaixa = await prisma.consultor.groupBy({
    by: ['scoreFaixa'],
    where: { tenantId, deletedAt: null, status: 'ATIVO' },
    _count: true,
  });
  const faixaCount = (f: string) => porFaixa.find((g) => g.scoreFaixa === f)?._count ?? 0;
  digest.push(
    `Saudável ${faixaCount('SAUDAVEL')} · Atenção ${faixaCount('ATENCAO')} · Esfriando ${faixaCount('ESFRIANDO')} · Frio ${faixaCount('FRIO')}`
  );

  // 10) Registros aguardando aprovação + conflitos abertos + expirando na semana + ações em atraso.
  const aguardando = await prisma.registroOportunidade.count({
    where: { tenantId, deletedAt: null, status: 'SUBMETIDO' },
  });
  if (aguardando > 0) digest.push(`${aguardando} registro(s) aguardando aprovação`);
  const conflitos = await prisma.conflitoCandidato.count({ where: { tenantId, status: 'ABERTO' } });
  if (conflitos > 0) digest.push(`${conflitos} conflito(s) em aberto`);

  const fimSemana = new Date(now.getTime() + 7 * DIA_MS);
  const expirandoSemana = await prisma.registroOportunidade.count({
    where: { tenantId, deletedAt: null, status: 'APROVADO', protecaoFim: { gte: now, lte: fimSemana } },
  });
  if (expirandoSemana > 0) digest.push(`${expirandoSemana} registro(s) expirando na semana`);

  const acoesAtraso = await prisma.planoAcaoItem.count({
    where: { tenantId, status: 'PENDENTE', dueDate: { lt: now }, registro: { deletedAt: null } },
  });
  if (acoesAtraso > 0) digest.push(`${acoesAtraso} ação(ões) do plano em atraso`);

  // 11) Digest diário ao gestor (dedup por marcador SYSTEM; e-mail best-effort).
  if (digest.length > 0) {
    const sent = await prisma.notification.findFirst({
      where: {
        tenantId,
        type: NotificationType.SYSTEM,
        createdAt: { gte: startOfToday() },
        metadata: { path: ['parceiroDigest'], equals: true },
      },
      select: { id: true },
    });
    if (!sent) {
      const gestores = await prisma.user.findMany({
        where: { id: { in: gestorIds } },
        select: { id: true, email: true },
      });
      for (const g of gestores) {
        await prisma.notification
          .create({
            data: {
              tenantId,
              userId: g.id,
              type: NotificationType.SYSTEM,
              title: 'Resumo diário — Parceiros',
              message: digest.join(' · '),
              link: '/app/parceiros',
              metadata: { parceiroDigest: true },
            },
          })
          .catch((err) => logger.error('parceiroChecker: digest in-app', err));
        if (g.email) {
          try {
            const { sendEmail, emailTemplates } = await import('../services/emailService.js');
            await sendEmail({
              to: g.email,
              ...(await emailTemplates.parceiroNotificacao('Resumo diário — Parceiros', digest, appUrl('/app/parceiros'))),
            });
          } catch (err) {
            logger.warn('parceiroChecker: digest e-mail falhou (best-effort)', { err: (err as Error)?.message });
            // Baixa severidade: sinaliza a falha do canal ao gestor (in-app, dedup diário).
            await notifyFalhaCanal(tenantId, g.id).catch((e) =>
              logger.error('parceiroChecker: notif falha de canal', e)
            );
          }
        }
      }
    }
  }
}

/** Alerta in-app (SYSTEM) de baixa severidade quando o canal e-mail/WhatsApp do digest falha. Dedup diário por usuário. */
async function notifyFalhaCanal(tenantId: string, userId: string): Promise<void> {
  const jaAvisado = await prisma.notification.findFirst({
    where: {
      tenantId,
      userId,
      type: NotificationType.SYSTEM,
      createdAt: { gte: startOfToday() },
      metadata: { path: ['parceiroDigestCanalFalhou'], equals: true },
    },
    select: { id: true },
  });
  if (jaAvisado) return;
  await notificationService.create(tenantId, {
    userId,
    type: NotificationType.SYSTEM,
    title: 'Falha no envio do resumo de Parceiros',
    message: 'Não foi possível enviar o resumo diário de Parceiros por e-mail. Consulte o resumo aqui no app.',
    link: '/app/parceiros',
    metadata: { parceiroDigestCanalFalhou: true } as never,
  });
}

async function run(): Promise<void> {
  try {
    const tenants = await prisma.tenant.findMany({ select: { id: true } });
    for (const tenant of tenants) {
      try {
        await checkTenant(tenant.id);
      } catch (err) {
        logger.error(`parceiroChecker: falha no tenant ${tenant.id}`, err as Error);
      }
    }
  } catch (err) {
    logger.error('parceiroChecker: falha geral', err as Error);
  }
}

export function initializeParceiroChecker(): void {
  setTimeout(() => {
    run().catch((err) => logger.error('parceiroChecker: erro inicial', err));
  }, INITIAL_DELAY_MS);
  intervalId = setInterval(() => {
    run().catch((err) => logger.error('parceiroChecker: erro no ciclo', err));
  }, CHECK_INTERVAL_MS);
  logger.info('Parceiro checker initialized');
}

export function stopParceiroChecker(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
