import { formatCurrency } from '../../utils/format';
import type { ContratoResumo } from '../../types/captura';

/** Saldo do contrato. Negativo é aceito e destacado: só alerta, nunca bloqueia (D3). */
export function SaldoContrato({
  contrato,
}: {
  contrato: Pick<ContratoResumo, 'saldo' | 'saldoDisponivel'>;
}) {
  if (!contrato.saldoDisponivel || contrato.saldo === null) {
    return <span className="text-xs text-muted-foreground">Não disponível</span>;
  }
  return (
    <span className={contrato.saldo < 0 ? 'text-destructive font-medium' : 'text-foreground'}>
      {formatCurrency(contrato.saldo)}
    </span>
  );
}
