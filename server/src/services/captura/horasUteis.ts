/**
 * Horas úteis (E-23): função única usada por todos os indicadores da Captura.
 *
 * O calendário é configuração do tenant (`Tenant.capturaCalendario`). O valor provisório
 * da spec-mãe é segunda a sexta, das 8h às 18h (horário de Brasília), sem contar os
 * feriados nacionais. As datas são calculadas no fuso do calendário, com a base de fusos
 * do runtime, para continuar correto se o horário de verão voltar.
 */
export interface CalendarioUtil {
  /** Dias da semana que contam: 0 = domingo … 6 = sábado. */
  diasUteis: number[];
  /** Início do expediente, "HH:MM". */
  inicio: string;
  /** Fim do expediente, "HH:MM". */
  fim: string;
  /** Fuso IANA. */
  fuso: string;
  /** Feriados nacionais fixos em lei deixam de contar. */
  excluirFeriadosNacionais: boolean;
  /** Dias adicionais que não contam, "YYYY-MM-DD". */
  feriadosExtras: string[];
}

export const CALENDARIO_PROVISORIO: CalendarioUtil = {
  diasUteis: [1, 2, 3, 4, 5],
  inicio: '08:00',
  fim: '18:00',
  fuso: 'America/Sao_Paulo',
  excluirFeriadosNacionais: true,
  feriadosExtras: [],
};

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Lê o JSON do tenant; o que estiver inválido cai no valor provisório. */
export function normalizarCalendario(bruto: unknown): CalendarioUtil {
  const c = (bruto && typeof bruto === 'object' ? bruto : {}) as Partial<CalendarioUtil>;
  const dias = Array.isArray(c.diasUteis)
    ? c.diasUteis.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    : CALENDARIO_PROVISORIO.diasUteis;
  const inicio =
    typeof c.inicio === 'string' && HORA.test(c.inicio) ? c.inicio : CALENDARIO_PROVISORIO.inicio;
  const fim = typeof c.fim === 'string' && HORA.test(c.fim) ? c.fim : CALENDARIO_PROVISORIO.fim;
  let fuso = CALENDARIO_PROVISORIO.fuso;
  if (typeof c.fuso === 'string') {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: c.fuso });
      fuso = c.fuso;
    } catch {
      // Fuso desconhecido: fica o provisório.
    }
  }
  return {
    diasUteis: dias,
    inicio,
    fim,
    fuso,
    excluirFeriadosNacionais:
      typeof c.excluirFeriadosNacionais === 'boolean'
        ? c.excluirFeriadosNacionais
        : CALENDARIO_PROVISORIO.excluirFeriadosNacionais,
    feriadosExtras: Array.isArray(c.feriadosExtras)
      ? c.feriadosExtras.filter((d): d is string => typeof d === 'string')
      : [],
  };
}

// ── Fuso ─────────────────────────────────────────────────────────────────────

const formatadores = new Map<string, Intl.DateTimeFormat>();

function formatador(fuso: string): Intl.DateTimeFormat {
  let f = formatadores.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: fuso,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatadores.set(fuso, f);
  }
  return f;
}

export interface PartesLocais {
  ano: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
}

export function partesLocais(instanteMs: number, fuso: string): PartesLocais {
  const partes: Record<string, number> = {};
  for (const p of formatador(fuso).formatToParts(new Date(instanteMs))) {
    if (p.type !== 'literal') partes[p.type] = Number(p.value);
  }
  return {
    ano: partes.year,
    mes: partes.month,
    dia: partes.day,
    hora: partes.hour,
    minuto: partes.minute,
    segundo: partes.second,
  };
}

function deslocamentoMs(instanteMs: number, fuso: string): number {
  const p = partesLocais(instanteMs, fuso);
  const comoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return comoUtc - Math.floor(instanteMs / 1000) * 1000;
}

/** Instante UTC de uma hora local no fuso do calendário. */
export function instanteLocal(
  ano: number,
  mes: number,
  dia: number,
  hora: number,
  minuto: number,
  fuso: string
): Date {
  const palpite = Date.UTC(ano, mes - 1, dia, hora, minuto);
  let resultado = palpite - deslocamentoMs(palpite, fuso);
  // Segunda passada: acerta quando o palpite caiu do outro lado de uma troca de horário.
  resultado = palpite - deslocamentoMs(resultado, fuso);
  return new Date(resultado);
}

// ── Feriados ─────────────────────────────────────────────────────────────────

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher). */
function pascoa(ano: number): { mes: number; dia: number } {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return { mes, dia };
}

function chaveData(ano: number, mes: number, dia: number): string {
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/**
 * Feriados nacionais em lei (Leis 662/49, 6.802/80 e 14.759/23), mais a Sexta-feira
 * Santa. Carnaval e Corpus Christi são ponto facultativo, não feriado nacional, e ficam
 * em `feriadosExtras` se o tenant quiser excluí-los.
 */
export function feriadosNacionais(ano: number): string[] {
  const fixos: Array<[number, number]> = [
    [1, 1],
    [4, 21],
    [5, 1],
    [9, 7],
    [10, 12],
    [11, 2],
    [11, 15],
    [11, 20],
    [12, 25],
  ];
  const p = pascoa(ano);
  const sexta = new Date(Date.UTC(ano, p.mes - 1, p.dia - 2));
  return [
    ...fixos.map(([m, d]) => chaveData(ano, m, d)),
    chaveData(sexta.getUTCFullYear(), sexta.getUTCMonth() + 1, sexta.getUTCDate()),
  ];
}

// ── Cálculo ──────────────────────────────────────────────────────────────────

const MS_POR_HORA = 3_600_000;

/** Horas úteis entre dois instantes. Fim antes do início dá 0. */
export function horasUteisEntre(de: Date, ate: Date, calendario: CalendarioUtil): number {
  if (ate.getTime() <= de.getTime()) return 0;

  const [hIni, mIni] = calendario.inicio.split(':').map(Number);
  const [hFim, mFim] = calendario.fim.split(':').map(Number);
  const inicial = partesLocais(de.getTime(), calendario.fuso);
  const final = partesLocais(ate.getTime(), calendario.fuso);

  const feriadosPorAno = new Map<number, Set<string>>();
  const feriados = (ano: number): Set<string> => {
    let s = feriadosPorAno.get(ano);
    if (!s) {
      s = new Set(calendario.excluirFeriadosNacionais ? feriadosNacionais(ano) : []);
      for (const extra of calendario.feriadosExtras) s.add(extra);
      feriadosPorAno.set(ano, s);
    }
    return s;
  };

  let totalMs = 0;
  let cursor = Date.UTC(inicial.ano, inicial.mes - 1, inicial.dia);
  const ultimo = Date.UTC(final.ano, final.mes - 1, final.dia);

  while (cursor <= ultimo) {
    const dia = new Date(cursor);
    const ano = dia.getUTCFullYear();
    const mes = dia.getUTCMonth() + 1;
    const diaDoMes = dia.getUTCDate();

    if (
      calendario.diasUteis.includes(dia.getUTCDay()) &&
      !feriados(ano).has(chaveData(ano, mes, diaDoMes))
    ) {
      const abre = instanteLocal(ano, mes, diaDoMes, hIni, mIni, calendario.fuso).getTime();
      const fecha = instanteLocal(ano, mes, diaDoMes, hFim, mFim, calendario.fuso).getTime();
      const comeco = Math.max(abre, de.getTime());
      const termino = Math.min(fecha, ate.getTime());
      if (termino > comeco) totalMs += termino - comeco;
    }
    cursor += 86_400_000;
  }

  return totalMs / MS_POR_HORA;
}
