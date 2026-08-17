import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Phone, Mail, User, Calendar, Building2, Contact } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { LeadStatusBadge } from '@/components/LeadStatusBadge';
import { LeadSourceBadge } from '@/components/LeadSourceBadge';
import { useSidePanel } from '@/contexts/SidePanelContext';
import { apiClient } from '@/services/api/client';

const currencyBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

// Painel do lead na régua "Leads como Oportunidade" (specs/leads-oportunidade
// reqs. 9-10, 22-23): valor estimado + probabilidade Go×Get no lugar do score,
// empresa/contato/responsável vindos do backend, sem contagem de tags.
function LeadPanelContent({ id }: { id: string }) {
  const navigate = useNavigate();
  const { closePanel } = useSidePanel();

  const { data: lead, isLoading } = useQuery({
    queryKey: ['lead', id],
    queryFn: () => apiClient.getLead(id) as Promise<any>,
    enabled: !!id,
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  }

  if (!lead) return null;

  const companyName = lead.companyRef?.name || lead.company || null;
  const hasCompanyLink = Boolean(lead.companyRef || lead.companyId);
  const estimatedValue =
    lead.estimatedValue !== null && lead.estimatedValue !== undefined && lead.estimatedValue !== ''
      ? Number(lead.estimatedValue)
      : null;

  return (
    <div className="p-6 space-y-5">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 leading-snug">{lead.name}</h3>
        {companyName && (
          <p className="text-sm text-gray-500 mt-0.5 flex items-center gap-1.5">
            <Building2 size={13} className="shrink-0 text-gray-400" />
            {companyName}
          </p>
        )}
        {/* Lead legado sem vínculo de empresa/contato (caso extremo 1) */}
        {!hasCompanyLink && (
          <Badge
            variant="outline"
            className="mt-1.5 text-xs bg-amber-50 text-amber-700 border-amber-200"
          >
            Vínculo pendente
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <LeadStatusBadge status={lead.status} />
        <LeadSourceBadge source={lead.source} />
      </div>

      {/* Oportunidade: valor estimado + probabilidade Go×Get (req. 9) */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-gray-200 p-3">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">
            Valor estimado
          </p>
          <p className="text-sm font-semibold text-gray-900">
            {estimatedValue !== null && !Number.isNaN(estimatedValue)
              ? currencyBRL.format(estimatedValue)
              : '—'}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 p-3">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">
            Prob. Go×Get
          </p>
          <p className="text-sm font-semibold text-gray-900">
            {lead.probabilityGoGet != null ? `${lead.probabilityGoGet}%` : '—'}
          </p>
        </div>
      </div>

      {/* Contato vinculado — dados de pessoa vêm do Lead-contato (req. 20) */}
      {lead.contactRef && (
        <div className="rounded-lg border border-gray-200 p-3 space-y-1.5">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Contato</p>
          <div className="flex items-center gap-2 text-sm text-gray-900">
            <Contact size={14} className="shrink-0 text-gray-400" />
            <span className="font-medium">{lead.contactRef.name}</span>
            {lead.contactRef.position && (
              <span className="text-gray-500">· {lead.contactRef.position}</span>
            )}
          </div>
          {lead.contactRef.phone && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Phone size={13} className="shrink-0 text-gray-400" />
              <span>{lead.contactRef.phone}</span>
            </div>
          )}
          {lead.contactRef.email && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Mail size={13} className="shrink-0 text-gray-400" />
              <span className="truncate">{lead.contactRef.email}</span>
            </div>
          )}
        </div>
      )}

      {/* Responsável comercial (req. 10 — assignedUser vem do backend) */}
      {lead.assignedUser && (
        <div className="flex items-center gap-2.5 text-sm text-gray-600">
          <User size={14} className="shrink-0 text-gray-400" />
          <span>{lead.assignedUser.name}</span>
        </div>
      )}

      {lead.interactions && lead.interactions.length > 0 && (
        <div className="text-sm border-t border-gray-100 pt-4">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
            Última Interação
          </p>
          <p className="text-gray-600 line-clamp-2">{lead.interactions[0].content}</p>
          <p className="text-xs text-gray-400 mt-1">
            {new Date(
              lead.interactions[0].occurredAt || lead.interactions[0].createdAt
            ).toLocaleDateString('pt-BR')}
          </p>
        </div>
      )}

      <div className="border-t border-gray-100 pt-4">
        <Button
          className="w-full"
          variant="outline"
          size="sm"
          onClick={() => {
            closePanel();
            navigate(`/app/leads/${id}`);
          }}
        >
          <ExternalLink size={14} className="mr-2" />
          Ver completo
        </Button>
      </div>
    </div>
  );
}

function DealPanelContent({ id }: { id: string }) {
  const navigate = useNavigate();
  const { closePanel } = useSidePanel();

  const { data: deal, isLoading } = useQuery({
    queryKey: ['deal', id],
    queryFn: () => apiClient.getDeal(id) as Promise<any>,
    enabled: !!id,
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  }

  if (!deal) return null;

  const valueFormatted = currencyBRL.format(deal.value || 0);

  return (
    <div className="p-6 space-y-5">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 leading-snug">{deal.name}</h3>
        <p className="text-xl font-bold text-primary mt-1">{valueFormatted}</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline">{deal.stage}</Badge>
        {deal.probability != null && (
          <Badge variant="secondary" className="text-xs">
            {deal.probability}% chance
          </Badge>
        )}
      </div>

      <div className="space-y-2.5">
        {deal.expectedCloseDate && (
          <div className="flex items-center gap-2.5 text-sm text-gray-600">
            <Calendar size={14} className="shrink-0 text-gray-400" />
            <span>Fecha em {new Date(deal.expectedCloseDate).toLocaleDateString('pt-BR')}</span>
          </div>
        )}
        {deal.assignedUser && (
          <div className="flex items-center gap-2.5 text-sm text-gray-600">
            <User size={14} className="shrink-0 text-gray-400" />
            <span>{deal.assignedUser.name}</span>
          </div>
        )}
        {deal.lead && (
          <div className="flex items-center gap-2.5 text-sm text-gray-600">
            <User size={14} className="shrink-0 text-gray-400" />
            <span className="text-gray-400">Lead:</span>
            <span>{deal.lead.name}</span>
          </div>
        )}
      </div>

      <div className="border-t border-gray-100 pt-4">
        <Button
          className="w-full"
          variant="outline"
          size="sm"
          onClick={() => {
            closePanel();
            navigate(`/app/deals/${id}`);
          }}
        >
          <ExternalLink size={14} className="mr-2" />
          Ver completo
        </Button>
      </div>
    </div>
  );
}

export function SidePanel() {
  const { open, type, id, closePanel } = useSidePanel();

  return (
    <Sheet open={open} onOpenChange={(v) => !v && closePanel()}>
      <SheetContent side="right" className="w-full sm:w-[480px] p-0 flex flex-col">
        <SheetHeader className="px-6 py-4 border-b border-gray-200 shrink-0">
          <SheetTitle className="text-sm font-medium text-gray-500">
            {type === 'lead' ? 'Detalhes do Lead' : 'Detalhes do Deal'}
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto">
          {type === 'lead' && id ? (
            <LeadPanelContent id={id} />
          ) : type === 'deal' && id ? (
            <DealPanelContent id={id} />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
