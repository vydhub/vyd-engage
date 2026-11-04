import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Header } from '../components/Header';
import { DealStageBadge } from '../components/deals/DealStageBadge';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { PageSkeleton } from '../components/PageSkeleton';
import { Deal, DealStage } from '../types';
import {
  ArrowLeft,
  ArrowRightLeft,
  Calendar,
  FileText,
  History,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  Plus,
  Zap,
  DollarSign,
  User,
  Users,
  Clock,
  ChevronDown,
  Link as LinkIcon,
  Pencil,
  Sparkles,
  Flame,
  Trash2,
  FileSignature,
  CheckSquare,
  Building2,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { apiClient, ConfigItem, DealContact } from '../services/api/client';
import { DealForm } from '../components/deals/DealForm';
import { DealProducts } from '../components/deals/DealProducts';
import { DealAIScore } from '../components/deals/DealAIScore';
import {
  QualificationStars,
  qualificationLevelName,
  useQualificationConfig,
} from '../components/deals/QualificationStars';
import { QuestionnaireSection } from '../components/deals/QuestionnaireSection';
import { SendEmailDialog } from '../components/deals/SendEmailDialog';
import { MultiSaleDialog } from '../components/deals/MultiSaleDialog';
import { CelebrationModal } from '../components/deals/CelebrationModal';
import { ScheduledDealsSection } from '../components/deals/ScheduledDealsSection';
import { ProposalsSection } from '../components/deals/ProposalsSection';
import { AttachmentsTab } from '../components/attachments/AttachmentsTab';
import { MeetingsSection } from '../components/deals/MeetingsSection';
import { WhatsAppSendPanel } from '../components/lead/WhatsAppSendPanel';
import { useAIStatus } from '../hooks/useAIStatus';
import { NextActionCard } from '../components/NextActionCard';
import { AIDraftDialog } from '../components/ai/AIDraftDialog';
import { AvisoFlow } from '../components/deals/AvisoFlow';
import { ROTULO_ESTADO, valorControladoPeloFlow, type DemandaEstado } from '../types/captura';
import { AuditTimeline } from '../components/AuditTimeline';
import { formatCurrency } from '../utils/format';
import { Timeline, TimelineItem } from '../components/ui/timeline';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';

const ITEMS_PER_PAGE = 10;

interface InteractionData {
  id: string;
  type: string;
  direction: string;
  subject?: string;
  content: string;
  createdAt: string;
  metadata?: Record<string, any>;
}

function getInteractionIcon(type: string) {
  switch (type) {
    case 'EMAIL':
      return <Mail size={16} />;
    case 'WHATSAPP':
      return <MessageSquare size={16} />;
    case 'CALL':
      return <Phone size={16} />;
    case 'MEETING':
      return <Calendar size={16} />;
    case 'NOTE':
      return <FileText size={16} />;
    case 'STATUS_CHANGE':
      return <ArrowRightLeft size={16} />;
    case 'AUTOMATION':
      return <Zap size={16} />;
    default:
      return <FileText size={16} />;
  }
}

function getInteractionIconStyle(type: string): string {
  const styles: Record<string, string> = {
    EMAIL: 'bg-blue-100 text-blue-600',
    WHATSAPP: 'bg-green-100 text-green-600',
    CALL: 'bg-purple-100 text-purple-600',
    MEETING: 'bg-orange-100 text-orange-600',
    NOTE: 'bg-gray-100 text-gray-600',
    STATUS_CHANGE: 'bg-yellow-100 text-yellow-600',
    AUTOMATION: 'bg-indigo-100 text-indigo-600',
  };
  return styles[type] || 'bg-gray-100 text-gray-600';
}

function getTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    EMAIL: 'E-mail',
    WHATSAPP: 'WhatsApp',
    CALL: 'Ligação',
    MEETING: 'Reunião',
    NOTE: 'Nota',
    STATUS_CHANGE: 'Mudança de Status',
    AUTOMATION: 'Automação',
  };
  return labels[type] || type;
}

function formatRelativeTime(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `${mins}min atrás`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h atrás`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d atrás`;
  return new Date(dateStr).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function DealDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [deal, setDeal] = useState<Deal | null>(null);
  const [interactions, setInteractions] = useState<InteractionData[]>([]);
  const [loadingDeal, setLoadingDeal] = useState(true);
  const [loadingInteractions, setLoadingInteractions] = useState(true);
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_PAGE);
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [noteContent, setNoteContent] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [editFormOpen, setEditFormOpen] = useState(false);
  const [aiDraftOpen, setAiDraftOpen] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [showLostModal, setShowLostModal] = useState(false);
  const [lostReasonId, setLostReasonId] = useState('');
  const [lostReasonsList, setLostReasonsList] = useState<ConfigItem[]>([]);
  const [lostCompetitor, setLostCompetitor] = useState('');
  const [stageHistoryOpen, setStageHistoryOpen] = useState(false);

  // ── Upgrade RD P0: qualificação, e-mail 1:1, celebração e multi-vendas ──
  const [sendEmailOpen, setSendEmailOpen] = useState(false);
  const [celebrationOpen, setCelebrationOpen] = useState(false);
  const [multiSaleOpen, setMultiSaleOpen] = useState(false);

  // Nomes dos níveis de qualificação da config do tenant (req 1).
  const { data: qualConfig } = useQualificationConfig();

  // Gating gracioso da IA (req 26): a aba "Reuniões" só aparece com IA configurada.
  const { enabled: aiEnabled } = useAIStatus();

  // Flags do tenant (celebração opt-out; multi-vendas opt-in) — reqs 4 e 11.
  const { data: salesFlags } = useQuery({
    queryKey: ['sales-flags'],
    queryFn: () => apiClient.getSalesFlags().then((r) => r.data),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const celebrationEnabled = salesFlags?.celebrationEnabled ?? true;
  const multiSalesEnabled = salesFlags?.multiSalesEnabled ?? false;

  // Carrega os motivos de perda configuráveis (req 22) quando o modal de perda abre.
  useEffect(() => {
    if (showLostModal && lostReasonsList.length === 0) {
      apiClient
        .getLostReasons(true)
        .then((res) => setLostReasonsList(res.data || []))
        .catch(() => {});
    }
  }, [showLostModal, lostReasonsList.length]);

  const fetchDeal = useCallback(async () => {
    if (!id) return;
    try {
      setLoadingDeal(true);
      const result = await apiClient.getDeal(id);
      setDeal({ ...result, value: Number(result.value) });
    } catch {
      toast.error('Erro ao carregar deal');
      navigate('/app/deals');
    } finally {
      setLoadingDeal(false);
    }
  }, [id, navigate]);

  const fetchInteractions = useCallback(async () => {
    if (!id) return;
    try {
      setLoadingInteractions(true);
      const result = await apiClient.getDealInteractions(id);
      setInteractions(Array.isArray(result) ? result : (result as any)?.interactions || []);
    } catch {
      // Silent fail — deal may have no interactions
    } finally {
      setLoadingInteractions(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDeal();
    fetchInteractions();
  }, [fetchDeal, fetchInteractions]);

  const { data: stageHistory = [] } = useQuery({
    queryKey: ['deal-stage-history', id],
    queryFn: async () => {
      if (!id) return [];
      const response = await fetch(`${apiClient.getApiUrl()}/api/v1/deals/${id}/stage-history`, {
        credentials: 'include',
      });
      if (!response.ok) return [];
      const json = await response.json();
      return Array.isArray(json) ? json : json?.data || [];
    },
    enabled: !!id,
  });

  // ── Funil/etapas ricas para o stepper, playbook e esfriamento (reqs 24-26) ──
  const { data: funnelData } = useQuery({
    queryKey: ['deal-funnel', deal?.funnelId],
    queryFn: async () => {
      if (!deal?.funnelId) return null;
      const res = await apiClient.getFunnel(deal.funnelId);
      return ((res as Record<string, unknown>)?.data ?? res) as Record<string, unknown> | null;
    },
    enabled: !!deal?.funnelId,
  });

  const funnelColumns = useMemo(() => {
    const cols = (funnelData?.columns as Array<Record<string, unknown>> | undefined) || [];
    return [...cols].sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));
  }, [funnelData]);

  const currentColumn = useMemo(
    () => funnelColumns.find((c) => c.id === deal?.funnelColumnId) || null,
    [funnelColumns, deal?.funnelColumnId]
  );

  // Tempo na etapa atual: usa o registro de stage-history aberto (sem exitedAt),
  // com fallback para updatedAt do deal.
  const daysInStage = useMemo(() => {
    const current = (stageHistory as Array<Record<string, unknown>>).find((e) => !e.exitedAt);
    const since = (current?.enteredAt as string | undefined) ?? deal?.updatedAt;
    if (!since) return null;
    return Math.floor((Date.now() - new Date(since).getTime()) / 86400000);
  }, [stageHistory, deal?.updatedAt]);

  // Esfriamento por etapa (req 26): dias sem interação acima do limite da etapa.
  const coolingDaysOver = useMemo(() => {
    const enabled = currentColumn?.coolingEnabled as boolean | undefined;
    const limit = currentColumn?.coolingDays as number | undefined;
    if (!enabled || !limit) return null;
    const lastActivity = interactions[0]?.createdAt ?? deal?.updatedAt;
    if (!lastActivity) return null;
    const days = Math.floor((Date.now() - new Date(lastActivity).getTime()) / 86400000);
    return days > limit ? days : null;
  }, [currentColumn, interactions, deal?.updatedAt]);

  // Via única (E-16): Negócio da Captura não muda de etapa nem de status nesta tela.
  const controladoPeloFlow = !!deal?.demanda;

  const [movingColumn, setMovingColumn] = useState(false);
  const handleMoveToColumn = async (colId: string) => {
    if (!id || colId === deal?.funnelColumnId || movingColumn || controladoPeloFlow) return;
    setMovingColumn(true);
    try {
      const result = await apiClient.updateDeal(id, { funnelColumnId: colId });
      setDeal({
        ...(result as unknown as Deal),
        value: Number((result as Record<string, unknown>).value),
      });
      toast.success('Etapa atualizada');
    } catch (err) {
      // A mensagem do backend lista os campos obrigatórios pendentes (reqs 4/10).
      toast.error(err instanceof Error ? err.message : 'Erro ao mover etapa');
    } finally {
      setMovingColumn(false);
    }
  };

  // ── Múltiplos contatos da negociação (req 16) ──
  const [contacts, setContacts] = useState<DealContact[]>([]);
  const [showContactSearch, setShowContactSearch] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [contactResults, setContactResults] = useState<Array<{ id: string; name: string }>>([]);

  const fetchContacts = useCallback(async () => {
    if (!id) return;
    try {
      const res = await apiClient.getDealContacts(id);
      setContacts(res.data || []);
    } catch {
      // silencioso — negociação pode não ter contatos
    }
  }, [id]);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  useEffect(() => {
    if (!showContactSearch) return;
    const t = setTimeout(async () => {
      try {
        const res = await apiClient.getLeads({
          limit: 20,
          search: contactSearch.trim() || undefined,
        });
        setContactResults(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          res.leads?.map((l: any) => ({ id: l.id, name: l.name })) || []
        );
      } catch {
        // silencioso
      }
    }, 300);
    return () => clearTimeout(t);
  }, [contactSearch, showContactSearch]);

  const handleAddContact = async (leadId: string) => {
    if (!id) return;
    try {
      await apiClient.addDealContact(id, { leadId });
      await fetchContacts();
      setShowContactSearch(false);
      setContactSearch('');
      toast.success('Contato adicionado');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao adicionar contato');
    }
  };

  const handleRemoveContact = async (contactId: string) => {
    if (!id) return;
    try {
      await apiClient.removeDealContact(id, contactId);
      setContacts((prev) => prev.filter((c) => c.id !== contactId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao remover contato');
    }
  };

  // Filtro por tipo de evento na aba Histórico (req 28).
  const [historyTypeFilter, setHistoryTypeFilter] = useState<string>('ALL');

  const handleDownloadPdf = async () => {
    if (!id) return;
    setDownloadingPdf(true);
    try {
      const url = `${apiClient.getApiUrl()}/api/v1/deals/${id}/proposal.pdf`;
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error('Erro ao gerar PDF');
      const blob = await response.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `proposta-${id}.pdf`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch {
      toast.error('Erro ao exportar proposta');
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleConfirmLost = async () => {
    if (!id || !lostReasonId) return;
    try {
      const res = await apiClient.markDealLost(id, lostReasonId);
      const updated = (res.data ?? res) as Record<string, unknown>;
      if (lostCompetitor.trim()) {
        await apiClient.updateDeal(id, { lostCompetitor: lostCompetitor.trim() }).catch(() => {});
      }
      setDeal({ ...(updated as unknown as Deal), value: Number(updated.value) });
      toast.success('Negociação marcada como perdida');
      // Multi-vendas (req 4): também após PERDA, oferecer agendar a próxima negociação.
      if (multiSalesEnabled) setMultiSaleOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao marcar perda');
    } finally {
      setShowLostModal(false);
      setLostReasonId('');
      setLostCompetitor('');
    }
  };

  const applyDealAction = (res: { data?: unknown }) => {
    const updated = (res.data ?? res) as Record<string, unknown>;
    setDeal({ ...(updated as unknown as Deal), value: Number(updated.value) });
  };

  const handleMarkWon = async () => {
    if (!id) return;
    try {
      applyDealAction(await apiClient.markDealWon(id));
      toast.success('Negociação marcada como ganha');
      // Fluxo pós-GANHO (reqs 4 e 11): celebração (se habilitada) e, em seguida,
      // oferta de multi-venda (se habilitada). Sem celebração, multi-venda direto.
      if (celebrationEnabled) {
        setCelebrationOpen(true);
      } else if (multiSalesEnabled) {
        setMultiSaleOpen(true);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao marcar ganho');
    }
  };

  // Qualificação editável inline (req 1): clicar na estrela atualiza via PUT.
  const handleQualificationChange = async (value: number | null) => {
    if (!id) return;
    try {
      const result = await apiClient.updateDeal(id, { qualification: value });
      setDeal({
        ...(result as unknown as Deal),
        value: Number((result as Record<string, unknown>).value),
      });
      toast.success(value ? 'Qualificação atualizada' : 'Qualificação removida');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao atualizar qualificação');
    }
  };

  const handleTogglePause = async () => {
    if (!id) return;
    const paused = (deal as unknown as Record<string, unknown>)?.status === 'PAUSED';
    try {
      applyDealAction(paused ? await apiClient.resumeDeal(id) : await apiClient.pauseDeal(id));
      toast.success(paused ? 'Negociação retomada' : 'Negociação pausada');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao atualizar');
    }
  };

  const handleSaveNote = async () => {
    if (!noteContent.trim() || !id) return;
    try {
      setSavingNote(true);
      const newInteraction = await apiClient.createInteraction({
        dealId: id,
        type: 'NOTE',
        direction: 'OUTBOUND',
        content: noteContent.trim(),
      });
      setInteractions((prev) => [newInteraction, ...prev]);
      setNoteContent('');
      setShowNoteForm(false);
      toast.success('Nota adicionada!');
    } catch {
      toast.error('Erro ao salvar nota');
    } finally {
      setSavingNote(false);
    }
  };

  const handleEditSave = async (data: any) => {
    if (!id) return;
    const result = await apiClient.updateDeal(id, data);
    setDeal({ ...result, value: Number(result.value) });
    toast.success('Deal atualizado!');
  };

  const filteredInteractions = useMemo(
    () =>
      historyTypeFilter === 'ALL'
        ? interactions
        : interactions.filter((i) => i.type === historyTypeFilter),
    [interactions, historyTypeFilter]
  );
  const visibleInteractions = useMemo(
    () => filteredInteractions.slice(0, visibleCount),
    [filteredInteractions, visibleCount]
  );
  const hasMore = visibleCount < filteredInteractions.length;

  if (loadingDeal) {
    return (
      <div className="min-h-screen">
        <Header title="Deal" />
        <PageSkeleton type="form" />
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="min-h-screen">
        <Header title="Deal não encontrado" />
        <div className="p-8 text-center">
          <p className="text-gray-600 mb-4">O deal solicitado não foi encontrado.</p>
          <Button onClick={() => navigate('/app/deals')}>
            <ArrowLeft size={16} className="mr-2" />
            Voltar para Deals
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header title={deal.name} subtitle="Detalhes do negócio" />

      <div className="p-8">
        <button
          onClick={() => navigate('/app/deals')}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 transition-colors"
        >
          <ArrowLeft size={16} />
          <span className="text-sm">Voltar para Deals</span>
        </button>

        {deal.demanda && <AvisoFlow demanda={deal.demanda} />}

        {/* Stepper de etapas (req 24) — clicável, com tempo na etapa e badge de esfriamento (req 26) */}
        {funnelColumns.length > 0 && (
          <div className="mb-6 bg-card rounded-lg shadow-sm border border-gray-300 p-4">
            <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-gray-900">Etapas do funil</h3>
              <div className="flex items-center gap-2 flex-wrap">
                {daysInStage !== null && (
                  <span className="text-xs text-gray-500 flex items-center gap-1">
                    <Clock size={12} /> {daysInStage} dia{daysInStage !== 1 ? 's' : ''} nesta etapa
                  </span>
                )}
                {coolingDaysOver !== null && (
                  <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 flex items-center gap-1">
                    <Flame size={12} /> Esfriando há {coolingDaysOver} dias
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {funnelColumns.map((col) => {
                const isCurrent = col.id === deal.funnelColumnId;
                return (
                  <button
                    key={col.id as string}
                    type="button"
                    onClick={() => handleMoveToColumn(col.id as string)}
                    disabled={movingColumn || controladoPeloFlow}
                    title={
                      controladoPeloFlow
                        ? 'Andamento controlado pelo Flow'
                        : (col.objective as string) || (col.title as string)
                    }
                    className={`text-xs px-3 py-1.5 rounded-full border border-gray-300 transition-colors ${
                      isCurrent
                        ? 'bg-primary text-white'
                        : 'bg-card text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {(col.abbreviation as string) || (col.title as string)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Playbook da etapa atual (req 25) */}
        {currentColumn &&
          ((currentColumn.objective as string) || (currentColumn.playbook as string)) && (
            <div className="mb-6 bg-gray-50 rounded-lg border border-gray-300 p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-1 flex items-center gap-2">
                <FileText size={14} /> Playbook — {currentColumn.title as string}
              </h3>
              {currentColumn.objective ? (
                <p className="text-sm text-gray-700 font-medium">
                  {currentColumn.objective as string}
                </p>
              ) : null}
              {currentColumn.playbook ? (
                <p className="text-sm text-gray-600 whitespace-pre-line mt-1">
                  {currentColumn.playbook as string}
                </p>
              ) : null}
            </div>
          )}

        <div className="flex flex-col lg:flex-row gap-6">
          {/* Left: conteúdo em abas (req 27) */}
          <div className="lg:w-[70%]">
            <Tabs defaultValue="historico">
              <TabsList className="flex-wrap h-auto justify-start gap-1 mb-4">
                <TabsTrigger value="historico">Histórico</TabsTrigger>
                <TabsTrigger value="email">E-mail</TabsTrigger>
                <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
                {/* Reuniões só quando a IA está configurada (gating gracioso, req 26) */}
                {aiEnabled && <TabsTrigger value="reunioes">Reuniões</TabsTrigger>}
                <TabsTrigger value="tarefas">Tarefas</TabsTrigger>
                <TabsTrigger value="produtos">Produtos</TabsTrigger>
                <TabsTrigger value="arquivos">Arquivos</TabsTrigger>
                <TabsTrigger value="propostas">Propostas</TabsTrigger>
                <TabsTrigger value="questionarios">Questionários</TabsTrigger>
              </TabsList>

              {/* Aba Histórico — timeline + filtro por tipo + criar anotação (reqs 27, 28) */}
              <TabsContent value="historico" className="space-y-4">
                <div className="bg-card rounded-lg shadow-sm border border-gray-300 p-6">
                  <div className="flex items-center justify-between mb-6 gap-2 flex-wrap">
                    <h2 className="text-lg font-semibold text-gray-900">Atividades</h2>
                    <div className="flex items-center gap-2 flex-wrap">
                      <select
                        value={historyTypeFilter}
                        onChange={(e) => {
                          setHistoryTypeFilter(e.target.value);
                          setVisibleCount(ITEMS_PER_PAGE);
                        }}
                        aria-label="Filtrar por tipo de evento"
                        className="text-sm border border-gray-300 rounded px-2 py-1.5 text-gray-700"
                      >
                        <option value="ALL">Todos os tipos</option>
                        <option value="NOTE">Nota</option>
                        <option value="EMAIL">E-mail</option>
                        <option value="WHATSAPP">WhatsApp</option>
                        <option value="CALL">Ligação</option>
                        <option value="MEETING">Reunião</option>
                        <option value="STATUS_CHANGE">Mudança de Status</option>
                        <option value="AUTOMATION">Automação</option>
                      </select>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={() => setShowNoteForm(!showNoteForm)}
                      >
                        <Plus size={14} />
                        Adicionar nota
                      </Button>
                    </div>
                  </div>

                  {showNoteForm && (
                <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <Textarea
                    placeholder="Escreva uma nota sobre este deal..."
                    value={noteContent}
                    onChange={(e) => setNoteContent(e.target.value)}
                    rows={3}
                    className="mb-3"
                  />
                  <div className="flex items-center gap-2 justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setShowNoteForm(false);
                        setNoteContent('');
                      }}
                    >
                      Cancelar
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSaveNote}
                      disabled={!noteContent.trim() || savingNote}
                    >
                      {savingNote && <Loader2 size={14} className="mr-2 animate-spin" />}Salvar
                    </Button>
                  </div>
                </div>
              )}

              {loadingInteractions ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={24} className="animate-spin text-gray-400" />
                </div>
              ) : filteredInteractions.length === 0 ? (
                <div className="text-center py-12">
                  <FileText size={40} className="mx-auto text-gray-300 mb-3" />
                  <p className="text-gray-500 text-sm">
                    {historyTypeFilter === 'ALL'
                      ? 'Nenhuma atividade registrada.'
                      : 'Nenhuma atividade desse tipo.'}
                  </p>
                  <p className="text-gray-400 text-xs mt-1">
                    Adicione uma nota para iniciar o histórico.
                  </p>
                </div>
              ) : (
                <div className="relative">
                  <Timeline>
                    {visibleInteractions.map((interaction) => (
                      <TimelineItem
                        key={interaction.id}
                        id={interaction.id}
                        title={getTypeLabel(interaction.type)}
                        subtitle={interaction.subject || undefined}
                        description={interaction.content}
                        date={formatRelativeTime(interaction.createdAt)}
                        icon={getInteractionIcon(interaction.type)}
                        iconClassName={getInteractionIconStyle(interaction.type)}
                      />
                    ))}
                  </Timeline>
                  {hasMore && (
                    <div className="flex justify-center pt-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setVisibleCount((prev) => prev + ITEMS_PER_PAGE)}
                        className="gap-2"
                      >
                        <ChevronDown size={14} />
                        Carregar mais ({filteredInteractions.length - visibleCount} restantes)
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Audit Trail */}
            <div className="bg-card rounded-lg shadow-sm border border-gray-300 p-6 mt-4">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <History size={18} />
                Histórico de alterações
              </h2>
              <AuditTimeline entityType="deal" entityId={id || ''} />
            </div>

            {/* Stage History */}
            {stageHistory.length > 0 && (
              <div className="bg-card rounded-lg shadow-sm border border-gray-300 p-6 mt-4">
                <button
                  className="w-full flex items-center justify-between text-left"
                  onClick={() => setStageHistoryOpen((v) => !v)}
                >
                  <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    <ArrowRightLeft size={18} />
                    Histórico de Estágios
                  </h2>
                  <ChevronDown
                    size={16}
                    className={`text-gray-400 transition-transform ${stageHistoryOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {stageHistoryOpen && (
                  <ul className="mt-4 space-y-2">
                    {stageHistory.map((entry: any) => {
                      const entered = new Date(entry.enteredAt);
                      const exitedMs = entry.exitedAt ? new Date(entry.exitedAt).getTime() : null;
                      const durationDays = exitedMs
                        ? Math.round((exitedMs - entered.getTime()) / 86400000)
                        : null;
                      return (
                        <li
                          key={entry.id}
                          className="flex items-center justify-between text-sm border-b border-gray-100 pb-2 last:border-0 last:pb-0"
                        >
                          <span className="font-medium text-gray-900">
                            {ROTULO_ESTADO[entry.stage as DemandaEstado] ?? entry.stage}
                          </span>
                          <span className="text-gray-500 text-xs">
                            {entered.toLocaleDateString('pt-BR')} &mdash;{' '}
                            {durationDays !== null
                              ? `${durationDays} dia${durationDays !== 1 ? 's' : ''}`
                              : 'em andamento'}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
              </TabsContent>

              {/* Aba E-mail — enviar e-mail 1:1 por modelo (Upgrade RD P0, req 10) + rascunho IA */}
              <TabsContent value="email">
                <div className="bg-card rounded-lg shadow-sm border border-gray-300 p-6 space-y-4">
                  <p className="text-sm text-gray-600">
                    Envie um e-mail para o contato desta negociação usando um modelo (com as
                    variáveis resolvidas) ou escrevendo livremente. O envio fica registrado na
                    timeline.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button className="gap-2" onClick={() => setSendEmailOpen(true)}>
                      <Mail size={14} />
                      Enviar e-mail
                    </Button>
                    <Button
                      variant="outline"
                      className="gap-2 border-purple-300 text-purple-700 hover:bg-purple-50"
                      onClick={() => setAiDraftOpen(true)}
                    >
                      <Sparkles size={14} />
                      Gerar Email
                    </Button>
                  </div>
                </div>
              </TabsContent>

              {/* Aba WhatsApp (req 23) — envia mensagem vinculada à timeline do deal.
                  O painel do F1 resolve conexão/fallback wa.me; passamos o telefone do lead. */}
              <TabsContent value="whatsapp">
                <div className="bg-card rounded-lg shadow-sm border border-default">
                  <WhatsAppSendPanel
                    dealId={deal.id}
                    leadId={deal.leadId || undefined}
                    phone={deal.lead?.phone || deal.company?.phone || undefined}
                    name={deal.lead?.name || deal.company?.name || deal.name}
                    onSent={fetchInteractions}
                  />
                </div>
              </TabsContent>

              {/* Aba Reuniões (req 26) — só montada com IA configurada (aiEnabled) */}
              {aiEnabled && (
                <TabsContent value="reunioes">
                  <MeetingsSection dealId={deal.id} />
                </TabsContent>
              )}

              {/* Aba Tarefas (req 29, P1) */}
              <TabsContent value="tarefas">
                <div className="bg-card rounded-lg shadow-sm border border-gray-300 p-6 text-center">
                  <CheckSquare size={36} className="mx-auto text-gray-300 mb-3" />
                  <p className="text-sm text-gray-500">
                    As tarefas vinculadas a esta negociação aparecerão aqui.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 gap-2"
                    onClick={() => navigate('/app/tasks')}
                  >
                    Ir para Tarefas
                  </Button>
                </div>
              </TabsContent>

              {/* Aba Produtos (reqs 17, 27) */}
              <TabsContent value="produtos">
                <div className="bg-card rounded-lg shadow-sm border border-gray-300 p-6">
                  <DealProducts
                    dealId={deal.id}
                    currentValue={Number(deal.value)}
                    somenteLeitura={valorControladoPeloFlow(deal.demanda)}
                    onValueChange={async (v) => {
                      if (!id) return;
                      const result = await apiClient.updateDeal(id, { value: v });
                      setDeal({ ...result, value: Number(result.value) });
                    }}
                  />
                </div>
              </TabsContent>

              {/* Aba Arquivos — central de anexos do deal (Upgrade RD P2, req 22) */}
              <TabsContent value="arquivos">{id && <AttachmentsTab dealId={id} />}</TabsContent>

              {/* Aba Propostas — modelos → gerar versão em PDF + assinatura (reqs 17-19) */}
              <TabsContent value="propostas" className="space-y-4">
                {id && <ProposalsSection dealId={id} />}
                {/* Exportação rápida em PDF (P1) — atalho preservado */}
                <div className="bg-card rounded-lg shadow-sm border border-gray-300 p-4">
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={handleDownloadPdf}
                    disabled={downloadingPdf}
                  >
                    {downloadingPdf ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <FileSignature size={14} />
                    )}
                    Exportar proposta rápida (PDF)
                  </Button>
                </div>
              </TabsContent>

              {/* Aba Questionários (Upgrade RD P0, reqs 2-3) */}
              <TabsContent value="questionarios">
                {id && (
                  <QuestionnaireSection
                    dealId={id}
                    onQualified={(q) =>
                      setDeal((prev) =>
                        prev ? ({ ...prev, qualification: q } as Deal) : prev
                      )
                    }
                  />
                )}
              </TabsContent>
            </Tabs>
          </div>

          {/* Right: Info Sidebar (30%) */}
          <div className="lg:w-[30%]">
            {/* Next Action Card */}
            {id && (
              <div className="mb-4">
                <NextActionCard entityType="deal" entityId={id} />
              </div>
            )}

            <div className="bg-card rounded-lg shadow-sm border border-gray-300 p-6 space-y-6 sticky top-4">
              {/* Value highlight + AI close-propensity score */}
              <div className="flex items-center justify-between gap-4">
                <p className="text-3xl font-bold text-gray-900">{formatCurrency(deal.value)}</p>
                {id && (
                  <div className="flex flex-col items-center gap-1">
                    <DealAIScore dealId={id} size="md" />
                    <span className="text-[10px] uppercase tracking-wider text-gray-400">
                      Propensão IA
                    </span>
                  </div>
                )}
              </div>

              {/* Ações de status — Ganho / Perda / Pausar-Retomar (reqs 19-23) */}
              {(() => {
                const status = (deal as unknown as Record<string, unknown>).status as
                  | string
                  | undefined;
                const closed = status === 'WON' || status === 'LOST';
                const paused = status === 'PAUSED';
                if (controladoPeloFlow) return null;
                return (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={handleMarkWon} disabled={status === 'WON'}>
                      Marcar venda
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowLostModal(true)}
                      disabled={status === 'LOST'}
                    >
                      Marcar perda
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleTogglePause} disabled={closed}>
                      {paused ? 'Retomar' : 'Pausar'}
                    </Button>
                  </div>
                );
              })()}

              {/* Qualificação (Upgrade RD P0, req 1) — estrelas editáveis inline,
                  tooltip com o nome do nível vindo da config do tenant */}
              {(() => {
                const q = (deal as unknown as Record<string, unknown>).qualification as
                  | number
                  | undefined;
                return (
                  <div>
                    <span className="text-xs font-medium text-gray-500 uppercase tracking-wider block mb-1.5">
                      Qualificação
                    </span>
                    <div className="flex items-center gap-2">
                      <QualificationStars
                        value={q ?? null}
                        levels={qualConfig?.levels}
                        size={16}
                        editable
                        onChange={handleQualificationChange}
                      />
                      {q ? (
                        <span className="text-xs text-muted-foreground">
                          {qualificationLevelName(qualConfig?.levels, q)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })()}

              {/* Múltiplos contatos (req 16) */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wider flex items-center gap-1">
                    <Users size={12} /> Contatos
                  </span>
                  <button
                    onClick={() => setShowContactSearch((v) => !v)}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    {showContactSearch ? 'Fechar' : '+ Adicionar'}
                  </button>
                </div>
                {showContactSearch && (
                  <div className="mb-2">
                    <Input
                      placeholder="Buscar contato..."
                      value={contactSearch}
                      onChange={(e) => setContactSearch(e.target.value)}
                      className="mb-1"
                    />
                    {contactResults.length > 0 && (
                      <ul className="border border-gray-200 rounded max-h-40 overflow-y-auto">
                        {contactResults.map((r) => (
                          <li key={r.id}>
                            <button
                              onClick={() => handleAddContact(r.id)}
                              className="w-full text-left px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                            >
                              {r.name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {contacts.length === 0 ? (
                  <p className="text-xs text-gray-400">Nenhum contato vinculado.</p>
                ) : (
                  <ul className="space-y-2">
                    {contacts.map((c) => (
                      <li key={c.id} className="flex items-start justify-between gap-2 text-sm">
                        <div className="min-w-0">
                          <p className="text-gray-900 truncate">{c.lead?.name || 'Contato'}</p>
                          {c.lead?.position && (
                            <p className="text-xs text-gray-500 truncate">{c.lead.position}</p>
                          )}
                          {c.lead?.email && (
                            <p className="text-xs text-gray-500 truncate">{c.lead.email}</p>
                          )}
                          {c.lead?.phone && (
                            <p className="text-xs text-gray-500 truncate">{c.lead.phone}</p>
                          )}
                        </div>
                        <button
                          onClick={() => handleRemoveContact(c.id)}
                          aria-label="Remover contato"
                          className="text-gray-400 hover:text-red-600 flex-shrink-0"
                        >
                          <Trash2 size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Stage and probability */}
              <div className="space-y-3">
                <div>
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wider block mb-1.5">
                    Stage
                  </span>
                  <DealStageBadge stage={deal.stage} size="md" />
                </div>
                <div>
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wider block mb-1.5">
                    Probabilidade
                  </span>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${deal.probability}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium text-gray-700">{deal.probability}%</span>
                  </div>
                </div>
              </div>

              <hr className="border-gray-200" />

              {/* Details */}
              <div className="space-y-3">
                {deal.company && (
                  <div className="flex items-center gap-3 text-sm">
                    <Building2 size={14} className="text-gray-400 flex-shrink-0" />
                    <div>
                      <span className="text-xs text-gray-500 block">Empresa</span>
                      <span className="text-gray-700">{deal.company.name}</span>
                    </div>
                  </div>
                )}
                {deal.expectedCloseDate && (
                  <div className="flex items-center gap-3 text-sm">
                    <Calendar size={14} className="text-gray-400 flex-shrink-0" />
                    <div>
                      <span className="text-xs text-gray-500 block">Previsão de Fechamento</span>
                      <span className="text-gray-700">
                        {new Date(deal.expectedCloseDate).toLocaleDateString('pt-BR')}
                      </span>
                    </div>
                  </div>
                )}
                {deal.lead && (
                  <div className="flex items-center gap-3 text-sm">
                    <LinkIcon size={14} className="text-gray-400 flex-shrink-0" />
                    <div>
                      <span className="text-xs text-gray-500 block">Lead Associado</span>
                      <button
                        onClick={() => navigate(`/app/leads/${deal.lead!.id}`)}
                        className="text-blue-600 hover:underline"
                      >
                        {deal.lead.name}
                      </button>
                    </div>
                  </div>
                )}
                {deal.assignedUser && (
                  <div className="flex items-center gap-3 text-sm">
                    <User size={14} className="text-gray-400 flex-shrink-0" />
                    <div>
                      <span className="text-xs text-gray-500 block">Responsável</span>
                      <span className="text-gray-700">{deal.assignedUser.name}</span>
                    </div>
                  </div>
                )}
              </div>

              {deal.notes && (
                <>
                  <hr className="border-gray-200" />
                  <div>
                    <span className="text-xs font-medium text-gray-500 uppercase tracking-wider block mb-1.5">
                      Notas
                    </span>
                    <p className="text-sm text-gray-600 whitespace-pre-wrap">{deal.notes}</p>
                  </div>
                </>
              )}

              {deal.lostReason && (
                <>
                  <hr className="border-gray-200" />
                  <div>
                    <span className="text-xs font-medium text-red-500 uppercase tracking-wider block mb-1.5">
                      Motivo da Perda
                    </span>
                    <p className="text-sm text-red-600">{deal.lostReason}</p>
                  </div>
                </>
              )}

              <hr className="border-gray-200" />
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Clock size={12} className="flex-shrink-0" />
                  <span>Criado em: {formatDate(deal.createdAt)}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Clock size={12} className="flex-shrink-0" />
                  <span>Atualizado em: {formatDate(deal.updatedAt)}</span>
                </div>
                {deal.closedAt && (
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <DollarSign size={12} className="flex-shrink-0" />
                    <span>Fechado em: {formatDate(deal.closedAt)}</span>
                  </div>
                )}
              </div>

              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={() => setEditFormOpen(true)}
              >
                <Pencil size={14} />
                Editar
              </Button>
            </div>

            {/* Próximas negociações agendadas (multi-vendas, req 4) — seção discreta */}
            {id && (
              <div className="mt-4">
                <ScheduledDealsSection dealId={id} />
              </div>
            )}
          </div>
        </div>
      </div>

      <DealForm
        open={editFormOpen}
        onClose={() => setEditFormOpen(false)}
        onSave={async (data) => {
          // Perda pelo formulário: delega ao modal de motivo (que encadeia multi-venda).
          if (data.stage === 'LOST' && deal?.stage !== 'LOST') {
            setEditFormOpen(false);
            setShowLostModal(true);
            return;
          }
          // Ganho pelo formulário (reqs 3, 11, 12): salva e encadeia celebração/multi-venda.
          const closingWon = data.stage === 'WON' && deal?.stage !== 'WON';
          await handleEditSave(data);
          if (closingWon) {
            if (celebrationEnabled) setCelebrationOpen(true);
            else if (multiSalesEnabled) setMultiSaleOpen(true);
          }
        }}
        deal={deal}
      />

      {/* Win/Loss Modal */}
      <Dialog open={showLostModal} onOpenChange={setShowLostModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Motivo da Perda</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Motivo</Label>
              <Select value={lostReasonId} onValueChange={setLostReasonId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o motivo" />
                </SelectTrigger>
                <SelectContent>
                  {lostReasonsList.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.label ?? r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Concorrente (opcional)</Label>
              <Input
                placeholder="Nome do concorrente"
                value={lostCompetitor}
                onChange={(e) => setLostCompetitor(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setShowLostModal(false)}>
                Cancelar
              </Button>
              <Button onClick={handleConfirmLost} disabled={!lostReasonId}>
                Confirmar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AIDraftDialog
        open={aiDraftOpen}
        onClose={() => setAiDraftOpen(false)}
        dealId={id}
        leadId={deal?.leadId || undefined}
      />

      {/* E-mail 1:1 por modelo (req 10) — registra Interaction na timeline */}
      <SendEmailDialog
        open={sendEmailOpen}
        onClose={() => setSendEmailOpen(false)}
        deal={deal}
        contacts={contacts}
        onSent={fetchInteractions}
      />

      {/* Celebração de venda (req 11) — ao fechar, oferece multi-venda (req 4) */}
      <CelebrationModal
        open={celebrationOpen}
        onClose={() => {
          setCelebrationOpen(false);
          if (multiSalesEnabled) setMultiSaleOpen(true);
        }}
      />

      {/* Multi-vendas (req 4) — agendar próxima negociação após ganho/perda */}
      <MultiSaleDialog open={multiSaleOpen} onClose={() => setMultiSaleOpen(false)} deal={deal} />
    </div>
  );
}
