import crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prismaMock } from '../helpers/prismaMock.js';

/**
 * Via única (E-16) e entrega do espelho (E-10), com banco mockado. A prova de ponta a ponta,
 * em banco real e por HTTP, está em capturaBancoReal.test.ts.
 */
vi.mock('../../services/slackService.js', () => ({
  notifyDealWon: vi.fn(async () => {}),
  notifyDealLost: vi.fn(async () => {}),
}));
vi.mock('../../services/socketService.js', () => ({ emitToTenant: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { dealService } from '../../services/dealService.js';
import { funnelService } from '../../services/funnelService.js';
import { trashService } from '../../services/trashService.js';
import { buildOutgoingPayload, webhookDispatcher } from '../../services/webhookDispatcher.js';
import { SELECTABLE_WEBHOOK_EVENTS, WEBHOOK_EVENTS } from '../../services/webhookService.js';

const AVISO = 'Andamento controlado pelo Flow';
const tenantId = 't1';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const primeiroArg = (fn: any) => fn.mock.calls[0][0];

const dealComDemanda = {
  id: 'd1',
  tenantId,
  stage: 'PROPOSAL',
  funnelId: 'f1',
  funnelColumnId: 'c1',
  lostReason: null,
  customFields: {},
  demanda: { id: 'dem1', flowCardId: 'card1', estado: 'em_orcamento' },
};

describe('via única nos serviços (E-16)', () => {
  beforeEach(() => {
    prismaMock.deal.findFirst.mockResolvedValue(dealComDemanda as never);
  });

  it.each([
    ['etapa', { stage: 'WON' }],
    ['funil', { funnelId: 'f2' }],
    ['coluna', { funnelColumnId: 'c2' }],
    ['motivo de perda', { lostReason: 'Preço' }],
  ])('update recusa mudança de %s com 403', async (_nome, dados) => {
    await expect(
      dealService.update(tenantId, { id: 'd1', ...(dados as object) })
    ).rejects.toMatchObject({ statusCode: 403, code: 'DEAL_CONTROLADO_PELO_FLOW', message: AVISO });
    expect(prismaMock.deal.update).not.toHaveBeenCalled();
  });

  it('update aceita o formulário inteiro quando nada do andamento muda, sob a trava da demanda, e não regrava o andamento', async () => {
    prismaMock.deal.update.mockResolvedValue({ ...dealComDemanda, notes: 'x' } as never);
    prismaMock.demanda.findFirst.mockResolvedValue({ id: 'dem1' } as never);
    prismaMock.$queryRaw.mockResolvedValue([] as never);
    prismaMock.$transaction.mockImplementation((async (trabalho: (tx: unknown) => unknown) =>
      trabalho(prismaMock)) as never);
    await dealService.update(tenantId, {
      id: 'd1',
      stage: 'PROPOSAL' as never,
      funnelId: 'f1',
      funnelColumnId: 'c1',
      lostReason: '',
      notes: 'x',
    });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prismaMock.deal.update).toHaveBeenCalledTimes(1);
    expect(primeiroArg(prismaMock.deal.update).data).toEqual({ notes: 'x' });
  });

  it('marcar venda, perda, pausar e retomar são recusados', async () => {
    for (const acao of [
      () => dealService.markWon(tenantId, 'd1'),
      () => dealService.markLost(tenantId, 'd1', 'motivo'),
      () => dealService.pause(tenantId, 'd1'),
      () => dealService.resume(tenantId, 'd1'),
      () => dealService.delete(tenantId, 'd1'),
    ]) {
      await expect(acao()).rejects.toMatchObject({ statusCode: 403, message: AVISO });
    }
    expect(prismaMock.deal.update).not.toHaveBeenCalled();
  });

  it('Negócio sem Demanda segue como hoje', async () => {
    prismaMock.deal.findFirst.mockResolvedValue({ ...dealComDemanda, demanda: null } as never);
    prismaMock.deal.update.mockResolvedValue({ ...dealComDemanda, demanda: null } as never);
    await dealService.pause(tenantId, 'd1');
    expect(prismaMock.deal.update).toHaveBeenCalledTimes(1);
  });

  it('o quadro recusa mudar de coluna, mas deixa reordenar na mesma', async () => {
    prismaMock.funnelColumn.findFirst.mockResolvedValue({ id: 'c1', funnelId: 'f1' } as never);
    await expect(funnelService.moveDeal(tenantId, 'd1', 'c2', 0)).rejects.toMatchObject({
      statusCode: 403,
      message: AVISO,
    });

    prismaMock.deal.update.mockResolvedValue(dealComDemanda as never);
    prismaMock.deal.findMany.mockResolvedValue([] as never);
    prismaMock.$transaction.mockResolvedValue([] as never);
    await expect(funnelService.moveDeal(tenantId, 'd1', 'c1', 0)).resolves.toBeTruthy();
  });

  it('coluna mapeada a um estado não pode ser excluída', async () => {
    prismaMock.funnelColumn.findFirst.mockResolvedValue({
      id: 'c1',
      isDefault: false,
      capturaEstado: 'em_triagem',
      _count: { leads: 0, deals: 0 },
    } as never);
    await expect(funnelService.deleteColumn(tenantId, 'c1')).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(prismaMock.funnelColumn.delete).not.toHaveBeenCalled();
  });

  it('lixeira: Negócio com Demanda não restaura, não expurga e fica fora da lista', async () => {
    prismaMock.demanda.findFirst.mockResolvedValue({ id: 'dem1' } as never);
    await expect(trashService.restoreItem(tenantId, 'deals', 'd1')).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(trashService.purgeItem(tenantId, 'deals', 'd1')).rejects.toMatchObject({
      statusCode: 403,
    });

    prismaMock.deal.findMany.mockResolvedValue([] as never);
    prismaMock.deal.count.mockResolvedValue(0 as never);
    await trashService.listTrash(tenantId, 'deals');
    expect(primeiroArg(prismaMock.deal.findMany).where).toMatchObject({ demanda: null });

    prismaMock.deal.findMany.mockClear();
    await trashService.purgeExpiredForEntity(tenantId, 'deals', new Date());
    expect(primeiroArg(prismaMock.deal.findMany).where).toMatchObject({ demanda: null });
  });

  it('lixeira de outras entidades não muda', async () => {
    prismaMock.lead.findMany.mockResolvedValue([] as never);
    prismaMock.lead.count.mockResolvedValue(0 as never);
    await trashService.listTrash(tenantId, 'leads');
    expect(primeiroArg(prismaMock.lead.findMany).where).not.toHaveProperty('demanda');
  });
});

describe('espelho de contratos (E-10)', () => {
  const dados = {
    id: 'c1',
    flow_record_id: null,
    codigo: 'CT-0042',
    cliente: 'Cliente',
    gerente_nome: null,
    gerente_email: null,
    planejador_nome: null,
    planejador_email: null,
    ativo: true,
  };
  const segredo = 'segredo';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchFalso: any;

  const esperar = async (condicao: () => boolean) => {
    for (let i = 0; i < 200 && !condicao(); i++) await new Promise((r) => setTimeout(r, 5));
    if (!condicao()) throw new Error('não entregou a tempo');
  };

  beforeEach(() => {
    prismaMock.webhook.findMany.mockResolvedValue([{ id: 'w1' }] as never);
    prismaMock.webhook.findFirst.mockResolvedValue({
      id: 'w1',
      url: 'https://flow.exemplo.com/functions/v1/espelho-contratos',
      secret: segredo,
    } as never);
    prismaMock.webhookLog.create.mockResolvedValue({} as never);
    prismaMock.webhookLog.findMany.mockResolvedValue([] as never);
    prismaMock.webhook.update.mockResolvedValue({} as never);
    prismaMock.contrato.findFirst.mockResolvedValue({ flowRecordId: null } as never);
    prismaMock.contrato.updateMany.mockResolvedValue({ count: 1 } as never);
    fetchFalso = vi.fn(async () => ({
      status: 200,
      text: async () => JSON.stringify({ flow_record_id: 'flow-1' }),
    }));
    vi.stubGlobal('fetch', fetchFalso);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('eventos novos estão no vocabulário e são selecionáveis ao criar o webhook', () => {
    for (const evento of ['contract.created', 'contract.updated', 'contract.deleted']) {
      expect(SELECTABLE_WEBHOOK_EVENTS).toContain(evento);
      expect(WEBHOOK_EVENTS).toContain(evento);
    }
  });

  it('envelope { event, timestamp, data }; os demais eventos seguem com tenantId', () => {
    expect(Object.keys(buildOutgoingPayload('t', 'contract.updated', {})).sort()).toEqual([
      'data',
      'event',
      'timestamp',
    ]);
    expect(buildOutgoingPayload('t', 'deal.won', {}).tenantId).toBe('t');
  });

  it('entrega com os cabeçalhos do contrato e grava o id devolvido, só se o contrato não tem', async () => {
    webhookDispatcher.emit(tenantId, 'contract.created', dados);
    await esperar(() => prismaMock.contrato.updateMany.mock.calls.length === 1);

    const [url, init] = fetchFalso.mock.calls[0];
    expect(url).toBe('https://flow.exemplo.com/functions/v1/espelho-contratos');
    const corpo = init.body as string;
    const assinatura = crypto.createHmac('sha256', segredo).update(corpo).digest('hex');
    expect(init.headers['X-Webhook-Signature']).toBe(assinatura);
    expect(init.headers['X-VYD-Signature']).toBe(assinatura);
    expect(init.headers['X-Webhook-Event']).toBe('contract.created');
    expect(init.headers['X-Webhook-Delivery-Id']).toMatch(/^[0-9a-f-]{36}$/);

    expect(prismaMock.contrato.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', tenantId, flowRecordId: null },
      data: { flowRecordId: 'flow-1' },
    });
  });

  it('evento que espera na fila sai com o id que uma entrega anterior já trouxe', async () => {
    prismaMock.contrato.findFirst.mockResolvedValue({ flowRecordId: 'flow-1' } as never);
    webhookDispatcher.emit(tenantId, 'contract.updated', dados);
    await esperar(() => fetchFalso.mock.calls.length === 1);
    expect(JSON.parse(fetchFalso.mock.calls[0][1].body).data.flow_record_id).toBe('flow-1');
  });

  it('resposta sem id ou que não é JSON não grava nem derruba a entrega', async () => {
    fetchFalso.mockResolvedValue({ status: 200, text: async () => 'ok' });
    webhookDispatcher.emit(tenantId, 'contract.updated', dados);
    await esperar(() => fetchFalso.mock.calls.length === 1);
    await new Promise((r) => setTimeout(r, 20));
    expect(prismaMock.contrato.updateMany).not.toHaveBeenCalled();
  });

  it('resposta de erro não grava', async () => {
    fetchFalso.mockResolvedValue({
      status: 500,
      text: async () => JSON.stringify({ flow_record_id: 'flow-x' }),
    });
    webhookDispatcher.emit(tenantId, 'contract.updated', dados);
    await esperar(() => prismaMock.webhookLog.create.mock.calls.length >= 1);
    await new Promise((r) => setTimeout(r, 20));
    expect(prismaMock.contrato.updateMany).not.toHaveBeenCalled();
  });

  it('evento comum não consulta nem grava contrato', async () => {
    webhookDispatcher.emit(tenantId, 'deal.won', { id: 'd1' });
    await esperar(() => fetchFalso.mock.calls.length === 1);
    await new Promise((r) => setTimeout(r, 20));
    expect(prismaMock.contrato.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.contrato.updateMany).not.toHaveBeenCalled();
  });
});
