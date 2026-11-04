import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { FileSignature } from 'lucide-react';
import { Badge } from '../ui/badge';
import { ContractHolderBadge } from './CompanyBadges';
import { apiClient } from '../../services/api/client';

/**
 * Widget "Contratos a vencer" do Dashboard (req 14): próximas empresas com
 * contrato vencendo (ordenadas por vencimento asc, janela = maior limiar do
 * tenant), com badge do detentor e navegação para a empresa.
 * 100% tokens semânticos — arquivo em STRICT_SCOPE do check:colors.
 */

// Dias civis até uma data date-only (meia-noite UTC): alvo pelo dia UTC (mesma
// convenção da data exibida) e "hoje" pelo dia civil local do usuário.
function civilDaysUntil(dateStr: string): number {
  const now = new Date();
  const target = new Date(dateStr);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const end = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  return Math.round((end - today) / 86400000);
}

export function ExpiringContractsWidget() {
  const navigate = useNavigate();

  const { data } = useQuery({
    queryKey: ['expiring-contracts'],
    queryFn: async () => {
      const result = await apiClient.getExpiringContracts();
      return result.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const companies = data?.companies ?? [];
  const windowDays = data?.windowDays ?? 90;

  return (
    <div className="bg-card rounded-lg shadow-sm border border-border">
      <div className="p-6 border-b border-border flex items-center gap-2">
        <FileSignature size={18} className="text-warning" />
        <h3 className="text-foreground font-semibold">Contratos a vencer</h3>
        {companies.length > 0 && (
          <Badge className="ml-auto bg-warning/15 text-warning border-transparent">
            {companies.length}
          </Badge>
        )}
      </div>
      {companies.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
          <p className="text-sm font-medium text-foreground">Nenhum contrato a vencer</p>
          <p className="text-xs text-muted-foreground mt-1">
            Contratos vencendo nos próximos {windowDays} dias aparecerão aqui
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {companies.map((c) => {
            const daysLeft = civilDaysUntil(c.contractEndDate);
            return (
              <button
                key={c.contrato ? c.contrato.id : c.id}
                type="button"
                onClick={() =>
                  navigate(
                    c.contrato ? `/app/contratos?contrato=${c.contrato.id}` : `/app/companies/${c.id}`
                  )
                }
                className="w-full p-4 flex items-center justify-between gap-3 text-left hover:bg-muted transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {c.name}
                    {c.contrato ? ` · ${c.contrato.numero}` : ''}
                  </p>
                  <div className="mt-1">
                    <ContractHolderBadge
                      holder={c.contractHolder}
                      competitor={c.contractCompetitor}
                    />
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm text-foreground">
                    {new Date(c.contractEndDate).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}
                  </p>
                  <p className="text-xs font-semibold text-warning">
                    {daysLeft === 0 ? 'vence hoje' : `${daysLeft} dias restantes`}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
