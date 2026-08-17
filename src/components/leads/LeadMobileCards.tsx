import { useNavigate, Link } from 'react-router';
import { Checkbox } from '../ui/checkbox';
import { LeadStatusBadge } from '../LeadStatusBadge';
import { LeadSourceBadge } from '../LeadSourceBadge';
import { Pencil, Trash2, Building2, User } from 'lucide-react';
import { NextActionBadge } from './NextActionBadge';
import type { Lead } from '../../types';

interface LeadMobileCardsProps {
  leads: Lead[];
  selectedLeads: string[];
  onSelectLead: (id: string) => void;
  onDeleteLead: (id: string) => void;
}

// Régua nova "Leads como Oportunidade" (specs/leads-oportunidade reqs. 22-24):
// cards mostram empresa, status, origem e responsável — sem score nem tags.
export function LeadMobileCards({
  leads,
  selectedLeads,
  onSelectLead,
  onDeleteLead,
}: LeadMobileCardsProps) {
  const navigate = useNavigate();

  return (
    <div className="space-y-3 mb-4">
      {leads.map((lead) => (
        <div key={lead.id} className="bg-card rounded-lg shadow-sm border border-gray-300 p-4">
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <Checkbox
                checked={selectedLeads.includes(lead.id)}
                onCheckedChange={() => onSelectLead(lead.id)}
                aria-label={`Selecionar ${lead.name}`}
              />
              <Link
                to={`/app/leads/${lead.id}`}
                className="font-medium text-gray-900 hover:text-primary hover:underline transition-colors truncate"
              >
                {lead.name}
              </Link>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0 ml-2">
              <button
                onClick={() => navigate(`/app/leads/${lead.id}/edit`)}
                className="p-1.5 hover:bg-gray-100 rounded transition-colors"
                type="button"
                aria-label={`Editar ${lead.name}`}
              >
                <Pencil size={14} className="text-gray-600" />
              </button>
              <button
                onClick={() => onDeleteLead(lead.id)}
                className="p-1.5 hover:bg-red-50 rounded transition-colors"
                type="button"
                aria-label={`Deletar ${lead.name}`}
              >
                <Trash2 size={14} className="text-error" />
              </button>
            </div>
          </div>
          <div className="ml-7 space-y-1.5">
            <div className="flex items-center gap-1.5 text-sm text-gray-600">
              <Building2 size={13} className="shrink-0 text-gray-400" />
              {lead.companyRef ? (
                <span className="truncate">{lead.companyRef.name}</span>
              ) : (
                <span className="inline-flex items-center gap-1.5 min-w-0">
                  {lead.company ? <span className="truncate">{lead.company}</span> : null}
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                    pendente
                  </span>
                </span>
              )}
            </div>
            {lead.assignedUser && (
              <div className="flex items-center gap-1.5 text-sm text-gray-600">
                <User size={13} className="shrink-0 text-gray-400" />
                <span className="truncate">{lead.assignedUser.name}</span>
              </div>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <LeadStatusBadge status={lead.status} />
              <LeadSourceBadge source={lead.source} />
              {/* AI next-action suggestion (icon + reasoning tooltip) */}
              <NextActionBadge leadId={lead.id} variant="icon" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
