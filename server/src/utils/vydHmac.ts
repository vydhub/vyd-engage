import crypto from 'crypto';

/**
 * Assinatura HMAC das integrações Flow → Engage (contrato 06, §1).
 *
 *   X-VYD-Timestamp:  segundos Unix, em texto
 *   X-VYD-Assinatura: "sha256=" + hex minúsculo de HMAC-SHA256(segredo, timestamp + "." + corpo_cru)
 *
 * Recusa se faltar cabeçalho, se a diferença de relógio passar de 300 s ou se a
 * assinatura não bater. A comparação é em tempo constante e usa os bytes crus do corpo.
 */
export const JANELA_HMAC_SEGUNDOS = 300;
const PREFIXO = 'sha256=';

export function assinarVyd(segredo: string, timestamp: string, corpoCru: string): string {
  const hex = crypto
    .createHmac('sha256', segredo)
    .update(`${timestamp}.${corpoCru}`, 'utf8')
    .digest('hex');
  return `${PREFIXO}${hex}`;
}

export type RecusaHmac =
  | 'CABECALHO_AUSENTE'
  | 'TIMESTAMP_INVALIDO'
  | 'FORA_DA_JANELA'
  | 'ASSINATURA_INVALIDA';

/** Devolve o motivo da recusa, ou null quando a assinatura confere. */
export function conferirAssinaturaVyd(params: {
  segredo: string;
  timestamp: string | undefined;
  assinatura: string | undefined;
  corpoCru: string;
  agoraMs?: number;
}): RecusaHmac | null {
  const { segredo, timestamp, assinatura, corpoCru } = params;
  if (!timestamp || !assinatura) return 'CABECALHO_AUSENTE';
  if (!/^\d+$/.test(timestamp)) return 'TIMESTAMP_INVALIDO';

  const agoraSegundos = (params.agoraMs ?? Date.now()) / 1000;
  if (Math.abs(agoraSegundos - Number(timestamp)) > JANELA_HMAC_SEGUNDOS) return 'FORA_DA_JANELA';

  const esperada = Buffer.from(assinarVyd(segredo, timestamp, corpoCru), 'utf8');
  const recebida = Buffer.from(assinatura, 'utf8');
  if (esperada.length !== recebida.length) return 'ASSINATURA_INVALIDA';
  return crypto.timingSafeEqual(esperada, recebida) ? null : 'ASSINATURA_INVALIDA';
}
