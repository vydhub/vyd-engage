import { Prisma } from '@prisma/client';
import prisma from '../../config/database.js';
import { type CalendarioUtil, normalizarCalendario } from './horasUteis.js';

/**
 * Calendário de horas úteis pela API de máquina (E-23, adendo 06). O Engage é a fonte, e a
 * Captura copia para calcular prazo e alertas com o mesmo calendário dos indicadores.
 */
export interface CalendarioApi {
  dias_uteis: number[];
  inicio: string;
  fim: string;
  fuso: string;
  excluir_feriados_nacionais: boolean;
  feriados_extras: string[];
}

export function calendarioParaApi(calendario: CalendarioUtil): CalendarioApi {
  return {
    dias_uteis: calendario.diasUteis,
    inicio: calendario.inicio,
    fim: calendario.fim,
    fuso: calendario.fuso,
    excluir_feriados_nacionais: calendario.excluirFeriadosNacionais,
    feriados_extras: calendario.feriadosExtras,
  };
}

export function calendarioDaApi(api: CalendarioApi): CalendarioUtil {
  return {
    diasUteis: api.dias_uteis,
    inicio: api.inicio,
    fim: api.fim,
    fuso: api.fuso,
    excluirFeriadosNacionais: api.excluir_feriados_nacionais,
    feriadosExtras: api.feriados_extras,
  };
}

async function calendarioDoTenant(cliente: Prisma.TransactionClient | typeof prisma, id: string) {
  const tenant = await cliente.tenant.findUnique({
    where: { id },
    select: { capturaCalendario: true },
  });
  return normalizarCalendario(tenant?.capturaCalendario);
}

export async function obterCalendario(tenantId: string): Promise<CalendarioApi> {
  return calendarioParaApi(await calendarioDoTenant(prisma, tenantId));
}

export async function salvarCalendario(
  tenantId: string,
  autorId: string,
  entrada: CalendarioApi
): Promise<CalendarioApi> {
  const novo = calendarioDaApi({
    ...entrada,
    dias_uteis: [...entrada.dias_uteis].sort((a, b) => a - b),
    feriados_extras: [...new Set(entrada.feriados_extras)].sort(),
  });

  await prisma.$transaction(async (tx) => {
    const anterior = await calendarioDoTenant(tx, tenantId);
    await tx.tenant.update({
      where: { id: tenantId },
      data: { capturaCalendario: novo as unknown as Prisma.InputJsonValue },
    });
    await tx.auditLog.create({
      data: {
        tenantId,
        entityType: 'captura_calendario',
        entityId: tenantId,
        userId: autorId,
        action: 'update',
        changes: [
          {
            field: 'calendario',
            oldValue: anterior as unknown as Prisma.InputJsonValue,
            newValue: novo as unknown as Prisma.InputJsonValue,
          },
        ],
      },
    });
  });

  return calendarioParaApi(novo);
}
