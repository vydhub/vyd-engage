import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { CalendarClock, FileText } from 'lucide-react';
import { Badge } from '../ui/badge';
import { apiClient } from '../../services/api/client';
import { ROTULO_LACUNA, ROTULO_TIPO_CONTRATO } from '../../types/captura';
import { ContractExpiredBadge } from './CompanyBadges';
import { SaldoContrato } from './SaldoContrato';

/**
 * Contratos do cliente na página da empresa (spec captura-demandas, E-07, E-08). Os seis
 * campos antigos seguem no card ao lado, porque concorrente e "nenhum" são dado de mercado.
 */
function dataCivil(valor: string | null): string {
  if (!valor) return '—';
  return new Date(`${valor.slice(0, 10)}T00:00:00Z`).toLocaleDateString('pt-BR', {
    timeZone: 'UTC',
  });
}

// Dias civis até a data date-only, com a mesma convenção do ContractCard.
function diasCivisAte(valor: string): number {
  const agora = new Date();
  const alvo = new Date(valor);
  const hoje = Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const fim = Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth(), alvo.getUTCDate());
  return Math.round((fim - hoje) / 86400000);
}

/** E-08: o aviso de vencimento mora no contrato, e o card dos campos antigos não o repete. */
function SeloDeVencimento({ vigenciaFim }: { vigenciaFim: string | null }) {
  if (!vigenciaFim) return null;
  const dias = diasCivisAte(vigenciaFim);
  if (dias < 0) return <ContractExpiredBadge />;
  return (
    <Badge className="bg-warning/15 text-warning border-transparent gap-1">
      <CalendarClock size={12} aria-hidden="true" />
      {dias === 0 ? 'Vence hoje' : `Vence em ${dias} dias`}
    </Badge>
  );
}

export function useContratosDaEmpresa(companyId: string) {
  return useQuery({
    queryKey: ['contratos-da-empresa', companyId],
    queryFn: async () => (await apiClient.getContratos({ companyId, limit: 100 })).data.itens,
    staleTime: 60 * 1000,
  });
}

export function ContratosDaEmpresa({ companyId }: { companyId: string }) {
  const { data: contratos = [] } = useContratosDaEmpresa(companyId);
  if (contratos.length === 0) return null;

  return (
    <div className="bg-card rounded-lg shadow-sm border border-border p-6 mb-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <FileText size={18} className="text-primary" aria-hidden="true" />
          <h3 className="font-semibold text-foreground">Contratos LTA</h3>
        </div>
        <Link
          to={`/app/contratos?empresa=${companyId}`}
          className="text-sm text-primary hover:underline"
        >
          Ver todos
        </Link>
      </div>
      <ul className="divide-y divide-border">
        {contratos.map((c) => (
          <li
            key={c.id}
            className="py-3 first:pt-0 last:pb-0 flex flex-wrap items-center gap-x-4 gap-y-1"
          >
            <Link
              to={`/app/contratos?contrato=${c.id}`}
              className="text-sm font-medium text-foreground hover:underline"
            >
              {c.numero}
            </Link>
            <span className="text-xs text-muted-foreground">{ROTULO_TIPO_CONTRATO[c.tipo]}</span>
            <span className="text-xs text-muted-foreground">
              {dataCivil(c.vigenciaInicio)} – {dataCivil(c.vigenciaFim)}
            </span>
            <SeloDeVencimento vigenciaFim={c.vigenciaFim} />
            <span className="text-xs text-foreground">
              Saldo: <SaldoContrato contrato={c} />
            </span>
            {c.lacunas.map((l) => (
              <Badge key={l} variant="outline">
                {ROTULO_LACUNA[l]}
              </Badge>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
