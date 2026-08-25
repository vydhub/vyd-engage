import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Header } from '../components/Header';
import { LeadModal } from '../components/LeadModal';
import { EmptyState } from '../components/EmptyState';
import { PageSkeleton } from '../components/PageSkeleton';
import { Users, UserCheck, Plus } from 'lucide-react';
import { Button } from '../components/ui/button';
import { LeadImportModal } from '../components/leads/LeadImportModal';
import { LeadBulkActions } from '../components/leads/LeadBulkActions';
import { LeadFilters } from '../components/leads/LeadFilters';
import { LeadTable } from '../components/leads/LeadTable';
import { LeadMobileCards } from '../components/leads/LeadMobileCards';
import { Pagination } from '../components/Pagination';
import { useSidePanel } from '../contexts/SidePanelContext';
import {
  Lead,
  LEAD_STATUS_LABELS,
  LEAD_SOURCE_LABELS,
  type LeadStatus,
  type LeadSource,
  type LeadStatusReason,
} from '../types';
import { apiClient } from '../services/api/client';
import {
  handlePendingApproval,
  extractPendingApprovalFromBlob,
  notifyPendingApproval,
} from '../lib/approvalResponse';
import { useLeads } from '../hooks/useLeads';
import { DraftResumeBanner } from '../components/DraftResumeBanner';
import { LEAD_DRAFT_PREFIX } from '../utils/draftKeys';
import { useSavedViews } from '../hooks/useSavedViews';
import { SavedViewsBar } from '../components/filters/SavedViewsBar';
import {
  AdvancedFilterPanel,
  type FilterCondition,
  type FieldDefinition,
} from '../components/filters/AdvancedFilterPanel';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';

// --- Constants ---

// Régua nova da área comercial (specs/leads-oportunidade req. 12): filtros usam
// os enums do backend diretamente, sem camada de mapeamento (leadEnums removido).
const STATUS_FILTER_OPTIONS = (
  Object.entries(LEAD_STATUS_LABELS) as Array<[LeadStatus, string]>
).map(([value, label]) => ({ value, label }));

const SOURCE_FILTER_OPTIONS = (
  Object.entries(LEAD_SOURCE_LABELS) as Array<[LeadSource, string]>
).map(([value, label]) => ({ value, label }));

// --- Component ---

type ViewTab = 'leads' | 'contacts' | 'all';

export function Leads() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { openPanel } = useSidePanel();
  const {
    leads: leadsData,
    loading,
    pagination,
    deleteLead: deleteLeadAPI,
    fetchLeads,
    refetch,
  } = useLeads();
  const {
    views: savedViews,
    activeView,
    activeViewId,
    selectView: selectSavedView,
    saveView,
    updateView: updateSavedView,
    deleteView: deleteSavedView,
  } = useSavedViews('leads');

  // Usuários do tenant — opções do filtro "Responsável comercial" (req. 34)
  const { data: tenantUsers } = useQuery({
    queryKey: ['users'],
    queryFn: () => apiClient.getUsers(),
    staleTime: 5 * 60_000,
  });

  // View tab state from URL
  const viewParam = searchParams.get('view');
  const activeTab: ViewTab =
    viewParam === 'contacts' ? 'contacts' : viewParam === 'all' ? 'all' : 'leads';

  // Convert/revert dialog state
  const [convertLeadId, setConvertLeadId] = useState<string | null>(null);
  const [revertLeadId, setRevertLeadId] = useState<string | null>(null);

  // Selection state
  const [selectedLeads, setSelectedLeads] = useState<string[]>([]);

  // Filter state
  const [filterStatus, setFilterStatus] = useState<string[]>([]);
  const [filterSource, setFilterSource] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Advanced filter state
  const [advancedConditions, setAdvancedConditions] = useState<FilterCondition[]>([]);
  const [advancedLogic, setAdvancedLogic] = useState<'AND' | 'OR'>('AND');

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteSingleLeadId, setDeleteSingleLeadId] = useState<string | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Server filter params ---

  const buildServerFilters = useCallback(
    (page: number = 1) => {
      const serverFilters: Record<string, string | number | undefined> = {
        page,
        limit: pagination.limit,
      };
      if (filterStatus.length === 1) {
        serverFilters.status = filterStatus[0];
      }
      if (filterSource.length === 1) {
        serverFilters.source = filterSource[0];
      }
      if (debouncedSearch) {
        serverFilters.search = debouncedSearch;
      }
      // Apply isContact filter based on active tab
      if (activeTab === 'leads') {
        serverFilters.isContact = 'false';
      } else if (activeTab === 'contacts') {
        serverFilters.isContact = 'true';
      }
      return serverFilters;
    },
    [filterStatus, filterSource, debouncedSearch, pagination.limit, activeTab]
  );

  // Debounce search input
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 400);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery]);

  // Fetch on filter change (including tab change)
  useEffect(() => {
    fetchLeads(buildServerFilters(1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus, filterSource, debouncedSearch, activeTab]);

  // --- Client-side filtering (multi-seleção — o servidor filtra 1 valor) ---

  const filteredLeads = leadsData.filter((lead) => {
    const matchesStatus = filterStatus.length <= 1 || filterStatus.includes(lead.status);
    const matchesSource = filterSource.length <= 1 || filterSource.includes(lead.source);
    return matchesStatus && matchesSource;
  });

  // --- Handlers ---

  const handleSelectAll = () => {
    const filteredLeadIds = filteredLeads.map((l) => l.id);
    const allFilteredSelected = filteredLeadIds.every((id) => selectedLeads.includes(id));
    if (allFilteredSelected && filteredLeadIds.length > 0) {
      setSelectedLeads(selectedLeads.filter((id) => !filteredLeadIds.includes(id)));
    } else {
      setSelectedLeads([...new Set([...selectedLeads, ...filteredLeadIds])]);
    }
  };

  const handleSelectLead = (id: string) => {
    if (selectedLeads.includes(id)) {
      setSelectedLeads(selectedLeads.filter((l) => l !== id));
    } else {
      setSelectedLeads([...selectedLeads, id]);
    }
  };

  // Export de leads via ENDPOINT DO SERVIDOR (Upgrade RD P1, req 15): passa pelo gate de
  // permissão/aprovação (requireApprovalFor.export) em vez de gerar o CSV no cliente (que
  // burlava o gate). Exporta os leads dos filtros ativos (o backend não escopa por IDs
  // avulsos); se o perfil exige aprovação, responde 202 → "enviado para aprovação".
  const handleServerExport = async (format: 'json' | 'csv' | 'xlsx' = 'csv') => {
    try {
      const filters: { status?: string; source?: string; search?: string } = {};
      if (filterStatus.length === 1) filters.status = filterStatus[0];
      if (filterSource.length === 1) filters.source = filterSource[0];
      if (searchQuery) filters.search = searchQuery;

      toast.info('Exportando leads…');
      const blob = await apiClient.exportLeadsDownload(format, filters);
      const pending = await extractPendingApprovalFromBlob(blob);
      if (pending) {
        notifyPendingApproval();
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `leads-export-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
      toast.success('Leads exportados com sucesso!');
    } catch (error) {
      console.error('Erro ao exportar leads:', error);
      toast.error('Erro ao exportar leads. Tente novamente.');
    }
  };

  // Upgrade RD P1, req 15: exportação de leads SEMPRE pelo servidor (passa pelo gate de
  // permissão/aprovação). As duas superfícies antigas (página atual / todos filtrados)
  // que geravam o arquivo no cliente foram redirecionadas para `handleServerExport`,
  // eliminando a geração client-side de CSV/XLSX de leads que burlava o gate.
  const handleExportAllFiltered = () => handleServerExport('xlsx');

  const handleDeleteLead = async (leadId: string) => {
    try {
      await deleteLeadAPI(leadId);
      setSelectedLeads((prev) => prev.filter((id) => id !== leadId));
      if (selectedLead?.id === leadId) {
        setModalOpen(false);
        setSelectedLead(null);
      }
      setDeleteSingleLeadId(null);
    } catch (error) {
      console.error('Erro ao deletar lead:', error);
    }
  };

  const handleDeleteSelectedLeads = async () => {
    if (selectedLeads.length === 0) return;
    const leadToDeleteCount = selectedLeads.length;
    try {
      const res = await apiClient.bulkUpdateLeads(selectedLeads, 'delete');
      // Perfil exige aprovação (reqs 15/16): backend responde 202 e NÃO aplica.
      // Mostra "enviado para aprovação", mantém a seleção e NÃO recarrega como sucesso.
      if (handlePendingApproval(res)) {
        setDeleteDialogOpen(false);
        return;
      }
      if (selectedLead && selectedLeads.includes(selectedLead.id)) {
        setModalOpen(false);
        setSelectedLead(null);
      }
      setSelectedLeads([]);
      setDeleteDialogOpen(false);
      refetch();
      toast.success(`${leadToDeleteCount} lead(s) deletado(s) com sucesso!`);
    } catch (error) {
      console.error('Erro ao deletar leads:', error);
      toast.error('Erro ao deletar leads. Tente novamente.');
    }
  };

  // Mudança de status em massa (specs/leads-oportunidade req. 14 + caso 7): para
  // PAUSADO/CANCELADO/ENCERRADO o LeadBulkActions abre o StatusReasonDialog e
  // repassa o motivo — o payload {status, statusReason, statusReasonNote} vale
  // para o lote inteiro (o backend valida e gera as interactions).
  const handleBulkChangeStatus = async (
    status: LeadStatus,
    statusReason?: LeadStatusReason,
    statusReasonNote?: string
  ) => {
    if (selectedLeads.length === 0) return;
    try {
      const res = await apiClient.bulkUpdateLeads(selectedLeads, 'change_status', {
        status,
        statusReason,
        statusReasonNote,
      });
      // 202 → enviado para aprovação: mantém a seleção e NÃO recarrega como sucesso.
      if (handlePendingApproval(res)) return;
      setSelectedLeads([]);
      refetch();
      toast.success(`Status atualizado para ${selectedLeads.length} lead(s)!`);
    } catch (error) {
      console.error('Erro ao alterar status:', error);
      toast.error('Erro ao alterar status. Tente novamente.');
    }
  };

  const handleBulkExportCSV = () => handleServerExport('csv');

  // --- Tab switching ---
  const handleTabChange = (tab: ViewTab) => {
    if (tab === 'leads') {
      setSearchParams({});
    } else {
      setSearchParams({ view: tab });
    }
    setSelectedLeads([]);
  };

  // --- Advanced Filter Fields (req. 34: sem score/custom fields; com responsável e empresa) ---
  const advancedFilterFields: FieldDefinition[] = [
    { key: 'name', label: 'Nome', type: 'text' },
    { key: 'company', label: 'Empresa', type: 'text' },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      options: STATUS_FILTER_OPTIONS,
    },
    {
      key: 'source',
      label: 'Origem',
      type: 'select',
      options: SOURCE_FILTER_OPTIONS,
    },
    {
      key: 'assignedTo',
      label: 'Responsável comercial',
      type: 'select',
      options: (tenantUsers || []).map((u) => ({ value: u.id, label: u.name })),
    },
    { key: 'createdAt', label: 'Data de criação', type: 'date' },
    { key: 'isContact', label: 'Contato', type: 'boolean' },
  ];

  // --- Saved Views ---
  const getCurrentFilters = useCallback(
    () => ({
      filterStatus,
      filterSource,
      searchQuery,
      advancedConditions,
      advancedLogic,
    }),
    [filterStatus, filterSource, searchQuery, advancedConditions, advancedLogic]
  );

  const applySavedViewFilters = useCallback((filters: Record<string, any>) => {
    setFilterStatus(filters.filterStatus || []);
    setFilterSource(filters.filterSource || []);
    setSearchQuery(filters.searchQuery || '');
    setAdvancedConditions(filters.advancedConditions || []);
    setAdvancedLogic(filters.advancedLogic || 'AND');
  }, []);

  const handleSavedViewSelect = useCallback(
    (viewId: string | null) => {
      selectSavedView(viewId);
      if (viewId === null) {
        setFilterStatus([]);
        setFilterSource([]);
        setSearchQuery('');
        setAdvancedConditions([]);
        setAdvancedLogic('AND');
      } else {
        const view = savedViews.find((v) => v.id === viewId);
        if (view) applySavedViewFilters(view.filters);
      }
    },
    [selectSavedView, savedViews, applySavedViewFilters]
  );

  const handleSaveCurrentView = useCallback(
    async (name: string, options?: { isDefault?: boolean; isShared?: boolean }) => {
      await saveView(name, getCurrentFilters(), options);
    },
    [saveView, getCurrentFilters]
  );

  const handleUpdateSavedView = useCallback(
    async (id: string, data: { name?: string; isDefault?: boolean; isShared?: boolean }) => {
      await updateSavedView(id, data);
    },
    [updateSavedView]
  );

  const handleDeleteSavedView = useCallback(
    async (id: string) => {
      await deleteSavedView(id);
    },
    [deleteSavedView]
  );

  // --- Convert / Revert ---
  const handleConvertToContact = async (leadId: string) => {
    try {
      await apiClient.convertToContact(leadId);
      toast.success('Lead convertido para Contato com sucesso!');
      setConvertLeadId(null);
      refetch();
    } catch (error) {
      console.error('Erro ao converter lead:', error);
      toast.error('Erro ao converter lead para contato.');
    }
  };

  const handleRevertToLead = async (leadId: string) => {
    try {
      await apiClient.revertToLead(leadId);
      toast.success('Contato revertido para Lead com sucesso!');
      setRevertLeadId(null);
      refetch();
    } catch (error) {
      console.error('Erro ao reverter contato:', error);
      toast.error('Erro ao reverter contato para lead.');
    }
  };

  // --- Render ---

  const headerTitle =
    activeTab === 'contacts' ? 'Contatos' : activeTab === 'all' ? 'Leads & Contatos' : 'Leads';
  const headerSubtitle =
    activeTab === 'contacts'
      ? 'Contatos qualificados convertidos de leads'
      : activeTab === 'all'
        ? 'Todos os leads e contatos em um só lugar'
        : 'Gerencie todos os seus leads em um só lugar';

  if (loading) {
    return (
      <div className="min-h-screen">
        <Header title={headerTitle} subtitle={headerSubtitle} />
        <PageSkeleton type="table" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header title={headerTitle} subtitle={headerSubtitle} />

      <div className="p-4 md:p-8">
        {/* View Tabs + ação primária "Novo lead" */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 w-fit">
            <button
              onClick={() => handleTabChange('leads')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'leads'
                  ? 'bg-card text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Users size={16} />
              Leads
            </button>
            <button
              onClick={() => handleTabChange('contacts')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'contacts'
                  ? 'bg-card text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <UserCheck size={16} />
              Contatos
            </button>
            <button
              onClick={() => handleTabChange('all')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'all'
                  ? 'bg-card text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Todos
            </button>
          </div>
          <Button onClick={() => navigate('/app/leads/new')} className="gap-2">
            <Plus size={16} />
            Novo lead
          </Button>
        </div>
        {/* Bulk Actions Bar */}
        {selectedLeads.length > 0 && (
          <LeadBulkActions
            selectedCount={selectedLeads.length}
            onClearSelection={() => setSelectedLeads([])}
            onChangeStatus={handleBulkChangeStatus}
            onExportCSV={handleBulkExportCSV}
            onDelete={() => setDeleteDialogOpen(true)}
          />
        )}

        <DraftResumeBanner
          prefix={LEAD_DRAFT_PREFIX}
          entityLabel="lead"
          toRoute={(key) => {
            const draftId = key.slice(LEAD_DRAFT_PREFIX.length);
            return draftId === 'new' ? '/app/leads/new' : `/app/leads/${draftId}/edit`;
          }}
          describe={(v) => (v.name as string) || undefined}
        />

        {/* Saved Views Bar */}
        <SavedViewsBar
          views={savedViews}
          activeViewId={activeViewId}
          onSelectView={handleSavedViewSelect}
          onSaveView={handleSaveCurrentView}
          onUpdateView={handleUpdateSavedView}
          onDeleteView={handleDeleteSavedView}
        />

        {/* Advanced Filter Panel */}
        <AdvancedFilterPanel
          conditions={advancedConditions}
          onConditionsChange={setAdvancedConditions}
          logic={advancedLogic}
          onLogicChange={setAdvancedLogic}
          fields={advancedFilterFields}
          onApply={() => fetchLeads(buildServerFilters(1))}
          onClear={() => {
            setAdvancedConditions([]);
            fetchLeads(buildServerFilters(1));
          }}
        />

        {/* Filters Bar */}
        <LeadFilters
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          filterStatus={filterStatus}
          onFilterStatusChange={setFilterStatus}
          filterSource={filterSource}
          onFilterSourceChange={setFilterSource}
          onImportClick={() => setImportModalOpen(true)}
          onExportAllFiltered={handleExportAllFiltered}
          onExportServer={async (format) => {
            const filters: Record<string, string> = {};
            if (filterStatus.length === 1) filters.status = filterStatus[0];
            if (filterSource.length === 1) filters.source = filterSource[0];
            if (searchQuery) filters.search = searchQuery;
            return apiClient.exportLeadsDownload(format, filters);
          }}
        />

        {/* Mobile Card View */}
        {filteredLeads.length > 0 && (
          <div className="block md:hidden">
            <LeadMobileCards
              leads={filteredLeads}
              selectedLeads={selectedLeads}
              onSelectLead={handleSelectLead}
              onDeleteLead={(id) => setDeleteSingleLeadId(id)}
            />
            <Pagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              total={pagination.total}
              limit={pagination.limit}
              onPageChange={(newPage) => fetchLeads(buildServerFilters(newPage))}
            />
          </div>
        )}

        {/* Desktop Table */}
        {filteredLeads.length > 0 ? (
          <div className="hidden md:block">
            <LeadTable
              leads={filteredLeads}
              selectedLeads={selectedLeads}
              onSelectAll={handleSelectAll}
              onSelectLead={handleSelectLead}
              onDeleteLead={(id) => setDeleteSingleLeadId(id)}
              onRowClick={(id) => openPanel('lead', id)}
            />
            <Pagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              total={pagination.total}
              limit={pagination.limit}
              onPageChange={(newPage) => fetchLeads(buildServerFilters(newPage))}
            />
          </div>
        ) : null}

        {/* Empty State */}
        {filteredLeads.length === 0 && (
          <div className="bg-card rounded-lg shadow-sm border border-gray-300">
            <EmptyState
              icon={Users}
              title="Nenhum lead encontrado"
              description="Comece adicionando seu primeiro lead ou ajuste os filtros de busca"
              actionLabel="Adicionar Lead"
              onAction={() => navigate('/app/leads/new')}
            />
          </div>
        )}
      </div>

      <LeadModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setSelectedLead(null);
          refetch();
        }}
        lead={selectedLead || undefined}
      />

      {/* Delete Multiple Leads Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deletar Leads Selecionados</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja deletar {selectedLeads.length} lead
              {selectedLeads.length > 1 ? 's' : ''}? Esta ação não pode ser desfeita e os leads
              serão removidos permanentemente do sistema.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteDialogOpen(false)}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteSelectedLeads}
              className="bg-red-600 hover:bg-red-700"
            >
              Deletar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Single Lead Dialog */}
      <AlertDialog
        open={deleteSingleLeadId !== null}
        onOpenChange={(open) => !open && setDeleteSingleLeadId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deletar Lead</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja deletar este lead? Esta ação não pode ser desfeita e o lead
              será removido permanentemente do sistema.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteSingleLeadId(null)}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteSingleLeadId !== null) handleDeleteLead(deleteSingleLeadId);
              }}
              className="bg-red-600 hover:bg-red-700"
            >
              Deletar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Import Modal */}
      <LeadImportModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImportComplete={() => refetch()}
      />

      {/* Convert to Contact Dialog */}
      <AlertDialog
        open={convertLeadId !== null}
        onOpenChange={(open) => !open && setConvertLeadId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Converter para Contato</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja converter este lead para contato? Ele aparecera na aba
              &quot;Contatos&quot;.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConvertLeadId(null)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (convertLeadId) handleConvertToContact(convertLeadId);
              }}
              className="bg-green-600 hover:bg-green-700"
            >
              Converter
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Revert to Lead Dialog */}
      <AlertDialog
        open={revertLeadId !== null}
        onOpenChange={(open) => !open && setRevertLeadId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reverter para Lead</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja reverter este contato para lead? Ele deixara de aparecer na aba
              &quot;Contatos&quot;.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setRevertLeadId(null)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (revertLeadId) handleRevertToLead(revertLeadId);
              }}
            >
              Reverter
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
