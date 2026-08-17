import { useNavigate, Link } from 'react-router';
import { Checkbox } from '../ui/checkbox';
import { LeadStatusBadge } from '../LeadStatusBadge';
import { LeadSourceBadge } from '../LeadSourceBadge';
import { Pencil, Trash2 } from 'lucide-react';
import { NextActionBadge } from './NextActionBadge';
import type { Lead } from '../../types';

interface LeadTableProps {
  leads: Lead[];
  selectedLeads: string[];
  onSelectAll: () => void;
  onSelectLead: (id: string) => void;
  onDeleteLead: (id: string) => void;
  onRowClick?: (leadId: string) => void;
}

const currencyBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function formatEstimatedValue(value: Lead['estimatedValue']): string {
  if (value === null || value === undefined || value === '') return '-';
  const num = Number(value);
  if (Number.isNaN(num)) return '-';
  return currencyBRL.format(num);
}

/** Badge "pendente" para lead legado sem vínculo de empresa (caso extremo 1). */
function PendingLinkBadge() {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
      pendente
    </span>
  );
}

// Régua nova "Leads como Oportunidade" (specs/leads-oportunidade reqs. 22-24):
// colunas Nome, Empresa, Contato, Status, Origem, Responsável, Valor estimado e
// Data — sem Score, Tags, Automações (mock) nem Campos Customizados.
export function LeadTable({
  leads,
  selectedLeads,
  onSelectAll,
  onSelectLead,
  onDeleteLead,
  onRowClick,
}: LeadTableProps) {
  const navigate = useNavigate();

  return (
    <div className="bg-card rounded-lg shadow-sm border border-gray-300 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full" aria-label="Lista de leads">
          <thead className="bg-gray-100 border-b border-gray-300">
            <tr>
              <th scope="col" className="px-6 py-3 text-left">
                <Checkbox
                  checked={
                    leads.length > 0 && leads.every((lead) => selectedLeads.includes(lead.id))
                  }
                  onCheckedChange={onSelectAll}
                  aria-label="Selecionar todos os leads"
                />
              </th>
              <th
                scope="col"
                className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider"
              >
                Nome
              </th>
              <th
                scope="col"
                className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider hidden md:table-cell"
              >
                Empresa
              </th>
              <th
                scope="col"
                className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider hidden md:table-cell"
              >
                Contato
              </th>
              <th
                scope="col"
                className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider"
              >
                Status
              </th>
              <th
                scope="col"
                className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider hidden lg:table-cell"
              >
                Origem
              </th>
              <th
                scope="col"
                className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider hidden lg:table-cell"
              >
                Responsável
              </th>
              <th
                scope="col"
                className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider hidden xl:table-cell"
              >
                Valor estimado
              </th>
              <th
                scope="col"
                className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider hidden lg:table-cell"
              >
                Data
              </th>
              <th
                scope="col"
                className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider"
              >
                Ações
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-300">
            {leads.map((lead) => (
              <tr
                key={lead.id}
                className={`hover:bg-gray-100 transition-colors${onRowClick ? ' cursor-pointer' : ''}`}
                onClick={onRowClick ? () => onRowClick(lead.id) : undefined}
              >
                <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selectedLeads.includes(lead.id)}
                    onCheckedChange={() => onSelectLead(lead.id)}
                    aria-label={`Selecionar ${lead.name}`}
                  />
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    {onRowClick ? (
                      <span className="font-medium text-gray-900 hover:text-primary transition-colors">
                        {lead.name}
                      </span>
                    ) : (
                      <Link
                        to={`/app/leads/${lead.id}`}
                        className="font-medium text-gray-900 hover:text-primary hover:underline transition-colors"
                      >
                        {lead.name}
                      </Link>
                    )}
                    {/* AI next-action suggestion (icon + reasoning tooltip) */}
                    {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- wrapper apenas impede a propagação do clique para a linha; não é um controle interativo */}
                    <span
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <NextActionBadge leadId={lead.id} variant="icon" />
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4 text-gray-600 hidden md:table-cell">
                  {lead.companyRef ? (
                    <span className="text-gray-900">{lead.companyRef.name}</span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      {lead.company ? <span>{lead.company}</span> : null}
                      <PendingLinkBadge />
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 text-gray-600 hidden md:table-cell">
                  {lead.contactRef?.name || '-'}
                </td>
                <td className="px-6 py-4">
                  <LeadStatusBadge status={lead.status} />
                </td>
                <td className="px-6 py-4 hidden lg:table-cell">
                  <LeadSourceBadge source={lead.source} />
                </td>
                <td className="px-6 py-4 text-gray-600 hidden lg:table-cell">
                  {lead.assignedUser?.name || '-'}
                </td>
                <td className="px-6 py-4 text-gray-600 hidden xl:table-cell">
                  {formatEstimatedValue(lead.estimatedValue)}
                </td>
                <td className="px-6 py-4 text-gray-600 hidden lg:table-cell">
                  {lead.createdAt ? new Date(lead.createdAt).toLocaleDateString('pt-BR') : '-'}
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        navigate(`/app/leads/${lead.id}/edit`);
                      }}
                      className="p-1.5 hover:bg-gray-300 rounded transition-colors"
                      type="button"
                      aria-label={`Editar ${lead.name}`}
                    >
                      <Pencil size={16} className="text-gray-600" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onDeleteLead(lead.id);
                      }}
                      className="p-1.5 hover:bg-red-50 rounded transition-colors"
                      type="button"
                      aria-label={`Deletar ${lead.name}`}
                    >
                      <Trash2 size={16} className="text-error" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
