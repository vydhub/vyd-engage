import { useState, useCallback, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { DataTable } from '../components/ui/data-table';
import { getCompanyColumns } from '../components/companies/companyColumns';
import { Header } from '../components/Header';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { PageSkeleton } from '../components/PageSkeleton';
import { EmptyState } from '../components/EmptyState';
import { useCompanies } from '../hooks/useCompanies';
import { Company, CompanySize } from '../types';
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Building2,
  Users,
  Handshake,
  Globe,
  BellRing,
} from 'lucide-react';
import { CompanyForm } from '../components/CompanyForm';
import { apiClient } from '../services/api/client';
import { handlePendingApproval } from '../lib/approvalResponse';
import { toast } from 'sonner';

const SIZE_LABELS: Record<CompanySize, string> = {
  MICRO: 'Micro',
  SMALL: 'Pequena',
  MEDIUM: 'Média',
  LARGE: 'Grande',
  ENTERPRISE: 'Enterprise',
};

const SIZE_OPTIONS: { value: string; label: string }[] = [
  { value: 'ALL', label: 'Todos os Portes' },
  { value: 'MICRO', label: 'Micro' },
  { value: 'SMALL', label: 'Pequena' },
  { value: 'MEDIUM', label: 'Média' },
  { value: 'LARGE', label: 'Grande' },
  { value: 'ENTERPRISE', label: 'Enterprise' },
];

const CLIENT_STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'ALL', label: 'Todos os Status' },
  { value: 'PROSPECT', label: 'Prospect' },
  { value: 'CLIENTE_ATIVO', label: 'Cliente ativo' },
  { value: 'INATIVO', label: 'Inativo' },
];

// Situação de contrato (req 15) — visão "Contratos a vencer" filtrável.
const CONTRACT_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'ALL', label: 'Contrato: todos' },
  { value: 'EXPIRING_30', label: 'Vence em até 30 dias' },
  { value: 'EXPIRING_60', label: 'Vence em até 60 dias' },
  { value: 'EXPIRING_90', label: 'Vence em até 90 dias' },
  { value: 'EXPIRED', label: 'Vencido' },
  { value: 'COMPETITOR', label: 'Com concorrente' },
  { value: 'OURS', label: 'Conosco' },
  { value: 'NONE', label: 'Sem contrato' },
];

function formatDate(date: string | null | undefined): string {
  if (!date) return '\u2014';
  return new Date(date).toLocaleDateString('pt-BR');
}

export function Companies() {
  const navigate = useNavigate();
  const {
    companies,
    loading,
    pagination,
    fetchCompanies,
    createCompany,
    updateCompany,
    refetch,
  } = useCompanies();

  const [search, setSearch] = useState('');
  const [sizeFilter, setSizeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [segmentFilter, setSegmentFilter] = useState('ALL');
  const [contractFilter, setContractFilter] = useState('ALL');
  const [followUpPending, setFollowUpPending] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);

  // Link do Flow para criar o cliente na triagem (spec captura-demandas, E-20):
  // /app/companies?novo=1&nome=&cnpj=&dominio= abre o formulário preenchido.
  const [urlParams, setUrlParams] = useSearchParams();
  const [valoresIniciais, setValoresIniciais] = useState<
    { name?: string; cnpj?: string; domain?: string } | undefined
  >(undefined);
  useEffect(() => {
    if (urlParams.get('novo') !== '1') return;
    setValoresIniciais({
      name: urlParams.get('nome') ?? undefined,
      cnpj: urlParams.get('cnpj') ?? undefined,
      domain: urlParams.get('dominio') ?? undefined,
    });
    setEditingCompany(null);
    setFormOpen(true);
    setUrlParams({}, { replace: true });
  }, [urlParams, setUrlParams]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [companyToDelete, setCompanyToDelete] = useState<Company | null>(null);

  // Segmentos ativos do tenant (upgrade-rd-parity, req 6) — filtro por segmento.
  const { data: segmentsData } = useQuery({
    queryKey: ['company-segments', 'active'],
    queryFn: () => apiClient.getCompanySegments(true),
    staleTime: 5 * 60 * 1000,
  });
  const segments = segmentsData?.data ?? [];

  // Monta os filtros server-side a partir do estado da toolbar (reqs 10 e 15).
  const buildFilters = useCallback(
    (overrides?: {
      page?: number;
      size?: string;
      status?: string;
      segment?: string;
      contract?: string;
      followUp?: boolean;
    }) => {
      const size = overrides?.size ?? sizeFilter;
      const status = overrides?.status ?? statusFilter;
      const segment = overrides?.segment ?? segmentFilter;
      const contract = overrides?.contract ?? contractFilter;
      const followUp = overrides?.followUp ?? followUpPending;
      const filters: Record<string, string | number | undefined> = {
        page: overrides?.page ?? 1,
      };
      if (search.trim()) filters.search = search.trim();
      if (size !== 'ALL') filters.size = size;
      if (status !== 'ALL') filters.clientStatus = status;
      if (segment !== 'ALL') filters.segmentId = segment;
      if (followUp) filters.followUpPending = 'true';
      if (contract.startsWith('EXPIRING_')) {
        filters.contract = 'expiring';
        filters.contractExpiringDays = Number(contract.split('_')[1]);
      } else if (contract !== 'ALL') {
        filters.contract = contract.toLowerCase();
      }
      return filters;
    },
    [search, sizeFilter, statusFilter, segmentFilter, contractFilter, followUpPending]
  );

  const handleSearch = useCallback(() => {
    fetchCompanies(buildFilters());
  }, [buildFilters, fetchCompanies]);

  const handleSizeChange = useCallback(
    (value: string) => {
      setSizeFilter(value);
      fetchCompanies(buildFilters({ size: value }));
    },
    [buildFilters, fetchCompanies]
  );

  const handleStatusChange = useCallback(
    (value: string) => {
      setStatusFilter(value);
      fetchCompanies(buildFilters({ status: value }));
    },
    [buildFilters, fetchCompanies]
  );

  const handleSegmentChange = useCallback(
    (value: string) => {
      setSegmentFilter(value);
      fetchCompanies(buildFilters({ segment: value }));
    },
    [buildFilters, fetchCompanies]
  );

  const handleContractChange = useCallback(
    (value: string) => {
      setContractFilter(value);
      fetchCompanies(buildFilters({ contract: value }));
    },
    [buildFilters, fetchCompanies]
  );

  const handleFollowUpToggle = useCallback(() => {
    const next = !followUpPending;
    setFollowUpPending(next);
    fetchCompanies(buildFilters({ followUp: next }));
  }, [followUpPending, buildFilters, fetchCompanies]);

  const handlePageChange = useCallback(
    (page: number) => {
      fetchCompanies(buildFilters({ page }));
    },
    [buildFilters, fetchCompanies]
  );

  // Filtrar ao digitar: refaz a busca (server-side) com debounce ao alterar o texto.
  useEffect(() => {
    const t = setTimeout(() => handleSearch(), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const handleSave = async (data: Partial<Company>) => {
    if (editingCompany) {
      await updateCompany(editingCompany.id, data);
    } else {
      await createCompany(data);
    }
    setFormOpen(false);
    setEditingCompany(null);
    setValoresIniciais(undefined);
  };

  const handleEdit = (company: Company) => {
    setEditingCompany(company);
    setFormOpen(true);
  };

  const handleDelete = async () => {
    if (!companyToDelete) return;
    try {
      const res = await apiClient.deleteCompany(companyToDelete.id);
      // Perfil exige aprovação (req 16): backend responde 202 e NÃO exclui. Mostra o
      // toast "enviado para aprovação" e NÃO recarrega a lista como sucesso.
      if (handlePendingApproval(res)) {
        setDeleteDialogOpen(false);
        setCompanyToDelete(null);
        return;
      }
      toast.success('Empresa removida com sucesso!');
      refetch();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erro ao remover empresa');
    } finally {
      setDeleteDialogOpen(false);
      setCompanyToDelete(null);
    }
  };

  // Column defs for the companies list table (handlers use stable setters)
  const companyTableColumns = useMemo(
    () =>
      getCompanyColumns({
        onEdit: handleEdit,
        onDelete: (company: Company) => {
          setCompanyToDelete(company);
          setDeleteDialogOpen(true);
        },
      }),

    []
  );

  if (loading && companies.length === 0) {
    return (
      <div className="min-h-screen">
        <Header title="Empresas" subtitle="Gerenciamento de empresas" />
        <PageSkeleton type="table" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header title="Empresas" subtitle="Gerenciamento de empresas" />

      <div className="p-8">
        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3 flex-1 w-full sm:w-auto">
            <div className="relative flex-1 max-w-sm">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                aria-hidden="true"
              />
              <Input
                placeholder="Buscar empresas..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="pl-10"
                aria-label="Buscar empresas"
              />
            </div>
            <Select value={sizeFilter} onValueChange={handleSizeChange}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SIZE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={handleStatusChange}>
              <SelectTrigger className="w-[180px]" aria-label="Filtrar por status de cliente">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLIENT_STATUS_FILTER_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {segments.length > 0 && (
              <Select value={segmentFilter} onValueChange={handleSegmentChange}>
                <SelectTrigger className="w-[180px]" aria-label="Filtrar por segmento">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos os segmentos</SelectItem>
                  {segments.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={contractFilter} onValueChange={handleContractChange}>
              <SelectTrigger className="w-[190px]" aria-label="Filtrar por situação de contrato">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONTRACT_FILTER_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant={followUpPending ? 'default' : 'outline'}
              size="sm"
              onClick={handleFollowUpToggle}
              aria-pressed={followUpPending}
              className="gap-2 whitespace-nowrap"
            >
              <BellRing size={14} />
              Follow-up pendente
            </Button>
          </div>

          <Button
            onClick={() => {
              setEditingCompany(null);
              setFormOpen(true);
            }}
            className="gap-2"
          >
            <Plus size={16} />
            Nova Empresa
          </Button>
        </div>

        {/* Table */}
        <div className="bg-gray-50 rounded-lg shadow-sm border border-gray-300 overflow-hidden">
          <div className="overflow-x-auto">
            <DataTable
              columns={companyTableColumns}
              data={companies}
              onRowClick={(company) => navigate(`/app/companies/${company.id}`)}
              emptyState={
                <EmptyState
                  icon={Building2}
                  title={
                    search.trim() ||
                    sizeFilter !== 'ALL' ||
                    statusFilter !== 'ALL' ||
                    segmentFilter !== 'ALL' ||
                    contractFilter !== 'ALL' ||
                    followUpPending
                      ? 'Nenhuma empresa encontrada'
                      : 'Nenhuma empresa criada'
                  }
                  description={
                    search.trim() ||
                    sizeFilter !== 'ALL' ||
                    statusFilter !== 'ALL' ||
                    segmentFilter !== 'ALL' ||
                    contractFilter !== 'ALL' ||
                    followUpPending
                      ? 'Tente ajustar os filtros ou termos de busca'
                      : 'Comece adicionando sua primeira empresa para organizar seus leads e deals'
                  }
                  actionLabel="Nova Empresa"
                  onAction={() => {
                    setEditingCompany(null);
                    setFormOpen(true);
                  }}
                />
              }
            />
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
              <span className="text-sm text-gray-600">
                {pagination.total} empresa{pagination.total !== 1 ? 's' : ''} &bull; Pagina{' '}
                {pagination.page} de {pagination.totalPages}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page <= 1}
                  onClick={() => handlePageChange(pagination.page - 1)}
                >
                  <ChevronLeft size={14} />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => handlePageChange(pagination.page + 1)}
                >
                  <ChevronRight size={14} />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Company Form Modal */}
      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) {
            setFormOpen(false);
            setEditingCompany(null);
            setValoresIniciais(undefined);
          }
        }}
      >
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editingCompany ? 'Editar Empresa' : 'Nova Empresa'}</DialogTitle>
          </DialogHeader>
          <CompanyForm
            company={editingCompany}
            valoresIniciais={editingCompany ? undefined : valoresIniciais}
            onSave={handleSave}
            onCancel={() => {
              setFormOpen(false);
              setEditingCompany(null);
              setValoresIniciais(undefined);
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Empresa</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir a empresa "{companyToDelete?.name}"? Esta acao nao pode
              ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
