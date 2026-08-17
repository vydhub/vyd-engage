import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { toast } from 'sonner';
import { Header } from '../components/Header';
import { LeadStatusBadge } from '../components/LeadStatusBadge';
import { LeadSourceBadge } from '../components/LeadSourceBadge';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { PageSkeleton } from '../components/PageSkeleton';
import {
  ArrowLeft,
  ArrowRightLeft,
  ArrowUpRight,
  Calendar,
  Download,
  FileText,
  History,
  Loader2,
  Mail,
  MessageSquare,
  Pencil,
  Phone,
  Plus,
  Users,
  Zap,
  Building2,
  Clock,
  User,
  UserCheck,
  ChevronDown,
  Sparkles,
  Handshake,
} from 'lucide-react';
import { apiClient } from '../services/api/client';
import { DealStageBadge } from '../components/deals/DealStageBadge';
import { NextActionCard } from '../components/NextActionCard';
import { AIDraftDialog } from '../components/ai/AIDraftDialog';
import { SendEmailDialog } from '../components/deals/SendEmailDialog';
import { AISummaryCard } from '../components/leads/AISummaryCard';
import { NextActionBadge } from '../components/leads/NextActionBadge';
import { AIChatPanel } from '../components/leads/AIChatPanel';
import { StatusReasonDialog } from '../components/leads/StatusReasonDialog';
import { ActivityCreateModal, ActivityKind } from '../components/leads/ActivityCreateModal';
import { NextActionsCard } from '../components/leads/NextActionsCard';
import { AuditTimeline } from '../components/AuditTimeline';
import { CallButton } from '../components/phone/CallButton';
import {
  Deal,
  CALL_REASON_LABELS,
  LEAD_STATUS_LABELS,
  LEAD_STATUS_REASON_LABELS,
  LeadStatus,
  LeadStatusReason,
  TERMINAL_LEAD_STATUSES,
} from '../types';
import type { Attachment } from '../types/documents';

// Number of interactions to show per "page"
const ITEMS_PER_PAGE = 10;

interface LeadData {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  position?: string;
  companyId?: string | null;
  companyRef?: { id: string; name: string; fantasyName?: string | null } | null;
  contactId?: string | null;
  contactRef?: {
    id: string;
    name: string;
    position?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  status: string;
  statusReason?: string | null;
  statusReasonNote?: string | null;
  source: string;
  estimatedValue?: number | string | null;
  estimatedTimeline?: string | null;
  probabilityGoGet?: number | null;
  assignedTo?: string | null;
  assignedUser?: { id: string; name: string; email?: string } | null;
  isContact?: boolean;
  convertedAt?: string | null;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

interface InteractionData {
  id: string;
  leadId: string;
  type: string;
  direction?: string;
  subject?: string;
  content: string;
  createdAt: string;
  occurredAt?: string | null;
  location?: string | null;
  modality?: string | null;
  callReason?: string | null;
  participants?: Array<{ id: string; leadId: string; lead?: { id: string; name: string } }>;
  metadata?: Record<string, unknown>;
}

// Anexo com os vínculos novos (leadId/interactionId — spec req. 40); o tipo base
// ainda não os declara.
type ActivityAttachment = Attachment & {
  leadId?: string | null;
  interactionId?: string | null;
};

// Icon mapping for interaction types
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

// Icon background color per type
function getInteractionIconStyle(type: string): string {
  switch (type) {
    case 'EMAIL':
      return 'bg-blue-100 text-blue-600';
    case 'WHATSAPP':
      return 'bg-green-100 text-green-600';
    case 'CALL':
      return 'bg-purple-100 text-purple-600';
    case 'MEETING':
      return 'bg-orange-100 text-orange-600';
    case 'NOTE':
      return 'bg-gray-100 text-gray-600';
    case 'STATUS_CHANGE':
      return 'bg-yellow-100 text-yellow-600';
    case 'AUTOMATION':
      return 'bg-indigo-100 text-indigo-600';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}

// Type label mapping
function getInteractionTypeLabel(type: string): string {
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

const MODALITY_LABELS: Record<string, string> = {
  PRESENCIAL: 'Presencial',
  ONLINE: 'Online',
};

// Format relative time
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) return 'agora';
  if (diffMinutes < 60) return `${diffMinutes}min atras`;
  if (diffHours < 24) return `${diffHours}h atras`;
  if (diffDays < 7) return `${diffDays}d atras`;

  // Absolute date for older entries
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Format date for display
function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatCurrency(value: number | string): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    Number(value)
  );
}

// Badge "vínculo pendente" — lead legado sem empresa/contato (caso extremo 1)
function PendingLinkBadge() {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
      vínculo pendente
    </span>
  );
}

export function LeadDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [lead, setLead] = useState<LeadData | null>(null);
  const [interactions, setInteractions] = useState<InteractionData[]>([]);
  const [attachments, setAttachments] = useState<ActivityAttachment[]>([]);
  const [loadingLead, setLoadingLead] = useState(true);
  const [loadingInteractions, setLoadingInteractions] = useState(true);
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_PAGE);

  // Note form state
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [noteContent, setNoteContent] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Contact reversion state (leads-contato mantêm o fluxo atual — req. 26)
  const [converting, setConverting] = useState(false);

  // Conversão em oportunidade (reqs. 17-18)
  const [convertingOpp, setConvertingOpp] = useState(false);

  // Mudança de status com motivo obrigatório (reqs. 13-14)
  const [statusDialogTarget, setStatusDialogTarget] = useState<LeadStatus | null>(null);
  const [changingStatus, setChangingStatus] = useState(false);

  // Nova atividade (reqs. 35-40) + card Próximas ações (req. 43)
  const [activityModalOpen, setActivityModalOpen] = useState(false);
  const [activityModalKind, setActivityModalKind] = useState<ActivityKind>('MEETING');
  const [tasksRefreshToken, setTasksRefreshToken] = useState(0);

  // Lead-Deal integration
  const [leadDeals, setLeadDeals] = useState<Deal[]>([]);

  // AI Draft dialog
  const [aiDraftOpen, setAiDraftOpen] = useState(false);

  // E-mail 1:1 pelo lead/contato (Upgrade RD P0, req 11).
  const [sendEmailOpen, setSendEmailOpen] = useState(false);

  const fetchLead = useCallback(async () => {
    if (!id) return;
    try {
      setLoadingLead(true);
      const result = await apiClient.getLead(id);
      setLead(result as unknown as LeadData);
    } catch (error: unknown) {
      console.error('Erro ao carregar lead:', error);
      toast.error('Erro ao carregar dados do lead');
      navigate('/app/leads');
    } finally {
      setLoadingLead(false);
    }
  }, [id, navigate]);

  const fetchInteractions = useCallback(async () => {
    if (!id) return;
    try {
      setLoadingInteractions(true);
      const result = await apiClient.getLeadInteractions(id);
      setInteractions(Array.isArray(result) ? (result as unknown as InteractionData[]) : []);
    } catch (error: unknown) {
      console.error('Erro ao carregar interacoes:', error);
      toast.error('Erro ao carregar historico de atividades');
    } finally {
      setLoadingInteractions(false);
    }
  }, [id]);

  // Anexos das atividades do lead (req. 42): uma busca por leadId, agrupada por
  // interactionId no render.
  const fetchAttachments = useCallback(async () => {
    if (!id) return;
    try {
      const result = await apiClient.getAttachments({ leadId: id });
      setAttachments((result.data as ActivityAttachment[]) || []);
    } catch {
      // Silencioso: anexos são complemento da timeline
      setAttachments([]);
    }
  }, [id]);

  const fetchLeadDeals = useCallback(async () => {
    if (!id) return;
    try {
      const result = await apiClient.getDeals({ leadId: id, limit: 50 });
      setLeadDeals((result.deals || []).map((d: any) => ({ ...d, value: Number(d.value) })));
    } catch {
      // Silent fail
    }
  }, [id]);

  useEffect(() => {
    fetchLead();
    fetchInteractions();
    fetchAttachments();
    fetchLeadDeals();
  }, [fetchLead, fetchInteractions, fetchAttachments, fetchLeadDeals]);

  const handleSaveNote = async () => {
    if (!noteContent.trim() || !id) return;

    try {
      setSavingNote(true);
      const newInteraction = await apiClient.createInteraction({
        leadId: id,
        type: 'NOTE',
        direction: 'OUTBOUND',
        content: noteContent.trim(),
      });
      setInteractions((prev) => [newInteraction as unknown as InteractionData, ...prev]);
      setNoteContent('');
      setShowNoteForm(false);
      toast.success('Nota adicionada com sucesso!');
    } catch (error: unknown) {
      console.error('Erro ao salvar nota:', error);
      toast.error('Erro ao salvar nota');
    } finally {
      setSavingNote(false);
    }
  };

  const handleLoadMore = () => {
    setVisibleCount((prev) => prev + ITEMS_PER_PAGE);
  };

  const handleRevertToLead = async () => {
    if (!id) return;
    try {
      setConverting(true);
      await apiClient.revertToLead(id);
      toast.success('Contato revertido para Lead com sucesso!');
      fetchLead();
      fetchInteractions();
    } catch (error: unknown) {
      console.error('Erro ao reverter contato:', error);
      toast.error('Erro ao reverter contato para lead.');
    } finally {
      setConverting(false);
    }
  };

  // Mudança de status (reqs. 13-16): transição para status terminal abre o
  // diálogo de motivo; demais aplicam direto. Voltar para NOVO/EM_ANDAMENTO
  // limpa o motivo no backend.
  const applyStatusChange = useCallback(
    async (status: LeadStatus, reason?: LeadStatusReason, note?: string) => {
      if (!id) return;
      try {
        setChangingStatus(true);
        await apiClient.updateLead(id, {
          status,
          ...(reason ? { statusReason: reason } : {}),
          ...(note ? { statusReasonNote: note } : {}),
        });
        toast.success('Status atualizado!');
        setStatusDialogTarget(null);
        await Promise.all([fetchLead(), fetchInteractions()]);
      } catch (error: unknown) {
        toast.error(
          error instanceof Error && error.message ? error.message : 'Erro ao atualizar status'
        );
      } finally {
        setChangingStatus(false);
      }
    },
    [id, fetchLead, fetchInteractions]
  );

  const handleStatusSelect = (value: string) => {
    if (!lead || !value || value === lead.status) return;
    const target = value as LeadStatus;
    if (TERMINAL_LEAD_STATUSES.includes(target)) {
      setStatusDialogTarget(target);
    } else {
      applyStatusChange(target);
    }
  };

  // Conversão em oportunidade (reqs. 17-18, caso 13): backend idempotente —
  // segundo clique/lead já convertido devolve o deal existente.
  const handleConvertToOpportunity = async () => {
    if (!id || convertingOpp) return;
    try {
      setConvertingOpp(true);
      const res = await apiClient.convertLeadToOpportunity(id);
      const { deal, alreadyConverted } = res.data;
      toast.success(
        alreadyConverted
          ? 'Este lead já foi convertido — abrindo a oportunidade.'
          : 'Lead convertido em oportunidade!'
      );
      navigate(`/app/deals/${deal.id}`);
    } catch (error: unknown) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : 'Erro ao converter em oportunidade'
      );
      setConvertingOpp(false);
    }
  };

  const handleViewOpportunity = () => {
    if (leadDeals.length > 0) {
      navigate(`/app/deals/${leadDeals[0].id}`);
    } else {
      // Fallback: endpoint idempotente devolve o deal vinculado
      handleConvertToOpportunity();
    }
  };

  const handleActivityCreated = (kind: 'interaction' | 'task') => {
    if (kind === 'interaction') {
      fetchInteractions();
      fetchAttachments();
    } else {
      setTasksRefreshToken((t) => t + 1);
    }
  };

  const openActivityModal = (kind: ActivityKind) => {
    setActivityModalKind(kind);
    setActivityModalOpen(true);
  };

  const handleDownloadAttachment = async (attachment: ActivityAttachment) => {
    try {
      const blob = await apiClient.downloadAttachment(attachment.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = attachment.name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Erro ao baixar anexo');
    }
  };

  // Timeline ordenada por data do evento (occurredAt ?? createdAt) desc (req. 42)
  const sortedInteractions = useMemo(() => {
    return [...interactions].sort((a, b) => {
      const at = new Date(a.occurredAt || a.createdAt).getTime();
      const bt = new Date(b.occurredAt || b.createdAt).getTime();
      return bt - at;
    });
  }, [interactions]);

  // Visible interactions (client-side pagination)
  const visibleInteractions = useMemo(
    () => sortedInteractions.slice(0, visibleCount),
    [sortedInteractions, visibleCount]
  );
  const hasMore = visibleCount < sortedInteractions.length;

  // Anexos agrupados por atividade (req. 42)
  const attachmentsByInteraction = useMemo(() => {
    const map = new Map<string, ActivityAttachment[]>();
    for (const att of attachments) {
      if (!att.interactionId) continue;
      const list = map.get(att.interactionId) ?? [];
      list.push(att);
      map.set(att.interactionId, list);
    }
    return map;
  }, [attachments]);

  const isOpportunity = !!lead && !lead.isContact;
  const alreadyConverted =
    isOpportunity &&
    lead.status === 'ENCERRADO' &&
    lead.statusReason === 'CONVERTIDO_EM_OPORTUNIDADE';

  if (loadingLead) {
    return (
      <div className="min-h-screen">
        <Header title="Detalhes do Lead" />
        <PageSkeleton type="form" />
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="min-h-screen">
        <Header title="Lead nao encontrado" />
        <div className="p-8 text-center">
          <p className="text-gray-600 mb-4">O lead solicitado nao foi encontrado.</p>
          <Button onClick={() => navigate('/app/leads')}>
            <ArrowLeft size={16} className="mr-2" />
            Voltar para Leads
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header title={lead.name} subtitle="Detalhes e historico de atividades" />

      <div className="p-8">
        {/* Back button */}
        <button
          onClick={() => navigate('/app/leads')}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 transition-colors"
        >
          <ArrowLeft size={16} />
          <span className="text-sm">Voltar para Leads</span>
        </button>

        {/* AI Summary Card — top of the lead detail page */}
        {id && <AISummaryCard leadId={id} />}

        {/* Split layout: 70/30 */}
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Left: Activity Timeline (70%) */}
          <div className="lg:w-[70%]">
            <div className="bg-card rounded-lg shadow-sm border border-gray-300 p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-gray-900">Atividades</h2>
                <div className="flex items-center gap-2">
                  {/* Fluxo único de atividade estruturada (req. 35) */}
                  {isOpportunity && (
                    <Button
                      size="sm"
                      className="gap-2"
                      onClick={() => openActivityModal('MEETING')}
                    >
                      <Plus size={14} />
                      Nova atividade
                    </Button>
                  )}
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

              {/* Inline note form */}
              {showNoteForm && (
                <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <Textarea
                    placeholder="Escreva uma nota sobre este lead..."
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
                      {savingNote && <Loader2 size={14} className="mr-2 animate-spin" />}
                      Salvar nota
                    </Button>
                  </div>
                </div>
              )}

              {/* Timeline (req. 42): campos estruturados — modalidade/local,
                  direção/motivo, participantes e anexos por atividade */}
              {loadingInteractions ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={24} className="animate-spin text-gray-400" />
                </div>
              ) : interactions.length === 0 ? (
                <div className="text-center py-12">
                  <FileText size={40} className="mx-auto text-gray-300 mb-3" />
                  <p className="text-gray-500 text-sm">
                    Nenhuma atividade registrada para este lead.
                  </p>
                  <p className="text-gray-400 text-xs mt-1">
                    Adicione uma nota para iniciar o historico.
                  </p>
                </div>
              ) : (
                <div className="relative">
                  <div className="absolute left-5 top-0 bottom-0 w-px bg-border z-0" />
                  <div className="space-y-1">
                    {visibleInteractions.map((interaction) => {
                      const interactionAttachments =
                        attachmentsByInteraction.get(interaction.id) ?? [];
                      const participantNames = (interaction.participants ?? [])
                        .map((p) => p.lead?.name)
                        .filter(Boolean) as string[];
                      const isMeeting = interaction.type === 'MEETING';
                      const isCall = interaction.type === 'CALL';
                      const hasStructured =
                        (isMeeting && (interaction.modality || interaction.location)) ||
                        (isCall && (interaction.direction || interaction.callReason));
                      return (
                        <div className="relative flex gap-4 py-3" key={interaction.id}>
                          <div
                            className={`relative z-10 flex items-center justify-center w-10 h-10 rounded-full flex-shrink-0 ${getInteractionIconStyle(interaction.type)}`}
                          >
                            {getInteractionIcon(interaction.type)}
                          </div>
                          <div className="flex-1 min-w-0 pb-3">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className="text-sm font-medium text-foreground">
                                {getInteractionTypeLabel(interaction.type)}
                              </span>
                              {interaction.subject && (
                                <span className="text-xs text-muted-foreground">
                                  {interaction.subject}
                                </span>
                              )}
                              <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">
                                {formatRelativeTime(
                                  interaction.occurredAt || interaction.createdAt
                                )}
                              </span>
                            </div>

                            {hasStructured && (
                              <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                                {isMeeting && interaction.modality && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
                                    {MODALITY_LABELS[interaction.modality] ??
                                      interaction.modality}
                                  </span>
                                )}
                                {isMeeting && interaction.location && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                                    {interaction.location}
                                  </span>
                                )}
                                {isCall && interaction.direction && (
                                  <span
                                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                      interaction.direction === 'INBOUND'
                                        ? 'bg-green-100 text-green-700'
                                        : 'bg-blue-100 text-blue-700'
                                    }`}
                                  >
                                    {interaction.direction === 'INBOUND'
                                      ? 'Recebida'
                                      : 'Realizada'}
                                  </span>
                                )}
                                {isCall && interaction.callReason && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                                    {CALL_REASON_LABELS[
                                      interaction.callReason as keyof typeof CALL_REASON_LABELS
                                    ] ?? interaction.callReason}
                                  </span>
                                )}
                              </div>
                            )}

                            {interaction.content && (
                              <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">
                                {interaction.content}
                              </p>
                            )}

                            {participantNames.length > 0 && (
                              <div className="flex items-center gap-1.5 mt-1.5 text-xs text-gray-500">
                                <Users size={12} className="flex-shrink-0" />
                                <span>{participantNames.join(', ')}</span>
                              </div>
                            )}

                            {interactionAttachments.length > 0 && (
                              <div className="mt-2 space-y-1">
                                {interactionAttachments.map((attachment) => (
                                  <button
                                    key={attachment.id}
                                    type="button"
                                    onClick={() => handleDownloadAttachment(attachment)}
                                    className="flex items-center gap-2 text-xs text-blue-600 hover:underline"
                                    title="Baixar anexo"
                                  >
                                    <Download size={12} className="flex-shrink-0" />
                                    <span className="truncate">{attachment.name}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Load more */}
                  {hasMore && (
                    <div className="flex justify-center pt-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleLoadMore}
                        className="gap-2"
                      >
                        <ChevronDown size={14} />
                        Carregar mais ({sortedInteractions.length - visibleCount} restantes)
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
              <AuditTimeline entityType="lead" entityId={id || ''} />
            </div>
          </div>

          {/* Right: Lead Info Sidebar (30%) */}
          <div className="lg:w-[30%]">
            {/* Próximas ações — tarefas do lead (req. 43), acima do card de IA */}
            {id && isOpportunity && (
              <div className="mb-4">
                <NextActionsCard
                  leadId={id}
                  refreshToken={tasksRefreshToken}
                  onCreateTask={() => openActivityModal('TASK')}
                />
              </div>
            )}

            {/* Next Action Card (IA) */}
            {id && (
              <div className="mb-4">
                <NextActionCard entityType="lead" entityId={id} />
              </div>
            )}

            <div className="bg-card rounded-lg shadow-sm border border-gray-300 p-6 space-y-6 sticky top-4">
              {/* Name and basic info */}
              <div>
                <h2 className="text-xl font-bold text-gray-900 mb-1">{lead.name}</h2>
                {lead.isContact && lead.position && (
                  <p className="text-sm text-gray-500">{lead.position}</p>
                )}
                {/* AI next-action suggestion with reasoning tooltip */}
                {id && (
                  <div className="mt-2">
                    <NextActionBadge leadId={id} />
                  </div>
                )}
              </div>

              {lead.isContact ? (
                /* Leads-contato: dados de pessoa continuam visíveis (req. 20) */
                <div className="space-y-3">
                  {lead.email && (
                    <div className="flex items-center gap-3 text-sm">
                      <Mail size={14} className="text-gray-400 flex-shrink-0" />
                      <a
                        href={`mailto:${lead.email}`}
                        className="text-blue-600 hover:underline truncate"
                      >
                        {lead.email}
                      </a>
                    </div>
                  )}
                  {lead.phone && (
                    <div className="flex items-center gap-3 text-sm">
                      <Phone size={14} className="text-gray-400 flex-shrink-0" />
                      <a href={`tel:${lead.phone}`} className="text-gray-700 hover:underline">
                        {lead.phone}
                      </a>
                      {/* Click-to-call — só aparece com telefonia configurada; tel: é o fallback */}
                      <CallButton
                        phone={lead.phone}
                        leadId={lead.id}
                        onLogged={fetchInteractions}
                        className="ml-auto"
                      />
                    </div>
                  )}
                  {(lead.companyRef || lead.company) && (
                    <div className="flex items-center gap-3 text-sm">
                      <Building2 size={14} className="text-gray-400 flex-shrink-0" />
                      {lead.companyRef ? (
                        <Link
                          to={`/app/companies/${lead.companyRef.id}`}
                          className="text-blue-600 hover:underline truncate"
                        >
                          {lead.companyRef.name}
                        </Link>
                      ) : (
                        <span className="text-gray-700">{lead.company}</span>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                /* Lead-oportunidade: Empresa (link) + Contato + Responsável (req. 6/10) */
                <div className="space-y-4">
                  <div>
                    <span className="text-xs font-medium text-gray-500 uppercase tracking-wider block mb-1.5">
                      Empresa
                    </span>
                    {lead.companyRef ? (
                      <Link
                        to={`/app/companies/${lead.companyRef.id}`}
                        className="flex items-center gap-2 text-sm text-blue-600 hover:underline"
                      >
                        <Building2 size={14} className="flex-shrink-0" />
                        <span className="truncate">{lead.companyRef.name}</span>
                        <ArrowUpRight size={12} className="flex-shrink-0" />
                      </Link>
                    ) : lead.company ? (
                      <div className="flex items-center gap-2 text-sm flex-wrap">
                        <Building2 size={14} className="text-gray-400 flex-shrink-0" />
                        <span className="text-gray-700">{lead.company}</span>
                        <PendingLinkBadge />
                      </div>
                    ) : (
                      <PendingLinkBadge />
                    )}
                  </div>

                  <div>
                    <span className="text-xs font-medium text-gray-500 uppercase tracking-wider block mb-1.5">
                      Contato
                    </span>
                    {lead.contactRef ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2 text-sm">
                          <User size={14} className="text-gray-400 flex-shrink-0" />
                          <span className="font-medium text-gray-900 truncate">
                            {lead.contactRef.name}
                          </span>
                        </div>
                        {lead.contactRef.position && (
                          <p className="text-xs text-gray-500 ml-6">{lead.contactRef.position}</p>
                        )}
                        {lead.contactRef.email && (
                          <div className="flex items-center gap-2 text-sm ml-6">
                            <Mail size={12} className="text-gray-400 flex-shrink-0" />
                            <a
                              href={`mailto:${lead.contactRef.email}`}
                              className="text-blue-600 hover:underline truncate"
                            >
                              {lead.contactRef.email}
                            </a>
                          </div>
                        )}
                        {lead.contactRef.phone && (
                          <div className="flex items-center gap-2 text-sm ml-6">
                            <Phone size={12} className="text-gray-400 flex-shrink-0" />
                            <a
                              href={`tel:${lead.contactRef.phone}`}
                              className="text-gray-700 hover:underline"
                            >
                              {lead.contactRef.phone}
                            </a>
                          </div>
                        )}
                      </div>
                    ) : (
                      <PendingLinkBadge />
                    )}
                  </div>

                  <div>
                    <span className="text-xs font-medium text-gray-500 uppercase tracking-wider block mb-1.5">
                      Responsável comercial
                    </span>
                    {lead.assignedUser ? (
                      <div className="flex items-center gap-2 text-sm">
                        <UserCheck size={14} className="text-gray-400 flex-shrink-0" />
                        <span className="text-gray-700">{lead.assignedUser.name}</span>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400">Sem responsável definido</p>
                    )}
                  </div>
                </div>
              )}

              {/* Divider */}
              <hr className="border-gray-200" />

              {/* Status and Source */}
              <div className="space-y-3">
                <div>
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wider block mb-1.5">
                    Status
                  </span>
                  <LeadStatusBadge status={lead.status} />
                  {lead.statusReason && (
                    <p className="text-xs text-gray-500 mt-1.5">
                      Motivo:{' '}
                      {LEAD_STATUS_REASON_LABELS[
                        lead.statusReason as keyof typeof LEAD_STATUS_REASON_LABELS
                      ] ?? lead.statusReason}
                      {lead.statusReasonNote ? ` — ${lead.statusReasonNote}` : ''}
                    </p>
                  )}
                  {/* Alterar status: terminal exige motivo (reqs. 13-14) */}
                  {isOpportunity && (
                    <select
                      aria-label="Alterar status"
                      className="mt-2 w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                      value={lead.status}
                      disabled={changingStatus}
                      onChange={(e) => handleStatusSelect(e.target.value)}
                    >
                      {(
                        Object.entries(LEAD_STATUS_LABELS) as Array<[LeadStatus, string]>
                      ).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div>
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wider block mb-1.5">
                    Origem
                  </span>
                  <LeadSourceBadge source={lead.source} />
                </div>
              </div>

              {/* Informações da oportunidade (req. 9) */}
              {isOpportunity && (
                <>
                  <hr className="border-gray-200" />
                  <div className="space-y-3">
                    <div>
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wider block mb-1.5">
                        Informações da oportunidade
                      </span>
                      {lead.notes ? (
                        <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">
                          {lead.notes}
                        </p>
                      ) : (
                        <p className="text-xs text-gray-400">Sem informações registradas</p>
                      )}
                    </div>
                    <div>
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wider block mb-1.5">
                        Valor estimado
                      </span>
                      <p className="text-sm font-bold text-gray-700">
                        {lead.estimatedValue !== null && lead.estimatedValue !== undefined
                          ? formatCurrency(lead.estimatedValue)
                          : '—'}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wider block mb-1.5">
                        Prazo estimado
                      </span>
                      <p className="text-sm text-gray-700">{lead.estimatedTimeline || '—'}</p>
                    </div>
                    <div>
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wider block mb-1.5">
                        Probabilidade Go×Get
                      </span>
                      <p className="text-sm text-gray-700">
                        {lead.probabilityGoGet !== null && lead.probabilityGoGet !== undefined
                          ? `${lead.probabilityGoGet}%`
                          : '—'}
                      </p>
                    </div>
                  </div>
                </>
              )}

              {/* Dates */}
              <hr className="border-gray-200" />
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Clock size={12} className="flex-shrink-0" />
                  <span>Criado em: {formatDate(lead.createdAt)}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Clock size={12} className="flex-shrink-0" />
                  <span>Atualizado em: {formatDate(lead.updatedAt)}</span>
                </div>
              </div>

              {/* Deals section */}
              <hr className="border-gray-200" />
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wider flex items-center gap-1">
                    <Handshake size={12} />
                    Oportunidades
                  </span>
                </div>
                {leadDeals.length === 0 ? (
                  <p className="text-xs text-gray-400">Nenhuma oportunidade associada</p>
                ) : (
                  <div className="space-y-2">
                    {leadDeals.map((deal) => (
                      <button
                        key={deal.id}
                        onClick={() => navigate(`/app/deals/${deal.id}`)}
                        className="w-full text-left p-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-gray-900 truncate">
                            {deal.name}
                          </span>
                          <DealStageBadge stage={deal.stage} size="sm" />
                        </div>
                        <span className="text-sm font-bold text-gray-700">
                          {formatCurrency(deal.value)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {lead.isContact ? (
                /* Leads-contato mantêm o fluxo atual (req. 26): box + reverter */
                <div className="space-y-2">
                  <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
                    <UserCheck size={16} className="text-green-600" />
                    <span className="text-sm font-medium text-green-700">Contato</span>
                    {lead.convertedAt && (
                      <span className="text-xs text-green-600 ml-auto">
                        {formatDate(lead.convertedAt)}
                      </span>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    className="w-full gap-2"
                    onClick={handleRevertToLead}
                    disabled={converting}
                  >
                    <ArrowRightLeft size={14} />
                    {converting ? 'Revertendo...' : 'Reverter para Lead'}
                  </Button>
                </div>
              ) : alreadyConverted ? (
                /* Já convertido (req. 18 / caso 13): link para a oportunidade */
                <Button
                  variant="outline"
                  className="w-full gap-2 border-green-300 text-green-700 hover:bg-green-50"
                  onClick={handleViewOpportunity}
                  disabled={convertingOpp}
                >
                  <ArrowUpRight size={14} />
                  Ver oportunidade
                </Button>
              ) : (
                /* Converter em oportunidade (req. 17) — desabilitado durante o
                   request para evitar duplo clique (caso 13) */
                <Button
                  className="w-full gap-2"
                  onClick={handleConvertToOpportunity}
                  disabled={convertingOpp}
                >
                  {convertingOpp ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Handshake size={14} />
                  )}
                  {convertingOpp ? 'Convertendo...' : 'Converter em oportunidade'}
                </Button>
              )}

              {/* Enviar e-mail 1:1 por modelo (req 11) — registra Interaction na timeline */}
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={() => setSendEmailOpen(true)}
                disabled={!lead.email}
                title={lead.email ? undefined : 'Cadastre um e-mail para o contato'}
              >
                <Mail size={14} />
                Enviar e-mail
              </Button>

              {/* Generate Email button */}
              <Button
                variant="outline"
                className="w-full gap-2 border-purple-300 text-purple-700 hover:bg-purple-50"
                onClick={() => setAiDraftOpen(true)}
              >
                <Sparkles size={14} />
                Gerar Email
              </Button>

              {/* Edit button */}
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={() => navigate(`/app/leads/${id}/edit`)}
              >
                <Pencil size={14} />
                Editar
              </Button>
            </div>

            {/* AI Chat Panel */}
            {id && (
              <div className="mt-4">
                <AIChatPanel leadId={id} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Motivo obrigatório na transição para status terminal (reqs. 13-14) */}
      <StatusReasonDialog
        open={statusDialogTarget !== null}
        targetStatus={statusDialogTarget}
        onConfirm={(reason, note) => {
          if (statusDialogTarget) applyStatusChange(statusDialogTarget, reason, note);
        }}
        onCancel={() => setStatusDialogTarget(null)}
      />

      {/* Nova atividade: Reunião | Ligação | Tarefa (reqs. 35-40) */}
      {id && (
        <ActivityCreateModal
          open={activityModalOpen}
          onClose={() => setActivityModalOpen(false)}
          leadId={id}
          companyId={lead.companyId}
          initialKind={activityModalKind}
          onCreated={handleActivityCreated}
        />
      )}

      {/* AI Draft Dialog */}
      <AIDraftDialog open={aiDraftOpen} onClose={() => setAiDraftOpen(false)} leadId={id} />

      {/* E-mail 1:1 pelo lead/contato (req 11) — recarrega a timeline após o envio */}
      <SendEmailDialog
        open={sendEmailOpen}
        onClose={() => setSendEmailOpen(false)}
        lead={{
          id: lead.id,
          name: lead.name,
          email: lead.email ?? null,
          company: lead.company ?? null,
        }}
        onSent={fetchInteractions}
      />
    </div>
  );
}
