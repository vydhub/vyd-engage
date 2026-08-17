import { useState, useEffect, useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { Header } from '../components/Header';
import { Button, buttonVariants } from '../components/ui/button';
import { LeadSourceBadge } from '../components/LeadSourceBadge';
import {
  Plus,
  Building2,
  Clock,
  Edit2,
  Trash2,
  X,
  Check,
  ChevronDown,
  Filter,
  Funnel as FunnelIcon,
  Settings,
  ArrowUp,
  ArrowDown,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { Input } from '../components/ui/input';
import { Checkbox } from '../components/ui/checkbox';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../components/ui/dialog';
import { LeadModal } from '../components/LeadModal';
import { StatusReasonDialog } from '../components/leads/StatusReasonDialog';
import { cn } from '../components/ui/utils';
import { apiClient } from '../services/api/client';
import { useFunnels, type FunnelLead } from '../hooks/useFunnels';
import {
  LEAD_SOURCE_LABELS,
  TERMINAL_LEAD_STATUSES,
  type LeadSource,
  type LeadStatus,
  type LeadStatusReason,
} from '../types';
import { PageSkeleton } from '../components/PageSkeleton';
import { CHART_PALETTE } from '@/utils/designTokens';

// Pipeline column colors — design-system chart palette tokens (var(--color-chart-*))
const PIPELINE_COLUMN_COLORS = [...CHART_PALETTE];

// Régua nova da área comercial (specs/leads-oportunidade req. 8/12): filtros de
// origem usam o enum novo diretamente (leadEnums foi removido).
const SOURCE_OPTIONS = (Object.entries(LEAD_SOURCE_LABELS) as Array<[LeadSource, string]>).map(
  ([value, label]) => ({ value, label })
);

/** Movimento de card pendente de motivo (arrasto p/ coluna terminal — req. 14). */
interface PendingTerminalMove {
  leadId: string;
  targetColumnId: string;
  position: number;
  fromColumnId: string;
  mappedStatus: LeadStatus;
}

export function Pipeline() {
  const navigate = useNavigate();
  const {
    funnels,
    currentFunnel,
    currentFunnelId,
    columns,
    loading,
    error: funnelError,
    loadFunnels: refetchFunnels,
    switchFunnel,
    createFunnel: createFunnelApi,
    updateFunnel: updateFunnelApi,
    deleteFunnel: deleteFunnelApi,
    addColumn: addColumnApi,
    updateColumn: updateColumnApi,
    deleteColumn: deleteColumnApi,
    reorderColumns: reorderColumnsApi,
    moveLead,
    loadFunnelWithLeads,
  } = useFunnels();

  // UI state
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  const [editingColumnTitle, setEditingColumnTitle] = useState('');
  const [deleteColumnId, setDeleteColumnId] = useState<string | null>(null);
  const [createColumnOpen, setCreateColumnOpen] = useState(false);
  const [newColumnTitle, setNewColumnTitle] = useState('');
  const [createFunnelOpen, setCreateFunnelOpen] = useState(false);
  const [newFunnelName, setNewFunnelName] = useState('');
  const [deleteFunnelId, setDeleteFunnelId] = useState<string | null>(null);
  const [editingFunnelId, setEditingFunnelId] = useState<string | null>(null);
  const [editingFunnelName, setEditingFunnelName] = useState('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [filterSources, setFilterSources] = useState<string[]>(
    SOURCE_OPTIONS.map((opt) => opt.value)
  );
  const [filterPopoverOpen, setFilterPopoverOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsColumnOrder, setSettingsColumnOrder] = useState<string[]>([]);
  const [activeLead, setActiveLead] = useState<FunnelLead | null>(null);
  // Arrasto para coluna terminal aguardando motivo (req. 14 + caso extremo 12)
  const [pendingMove, setPendingMove] = useState<PendingTerminalMove | null>(null);
  // Suppresses the click that may trail a drag (so a drop doesn't also open the modal).
  const justDraggedRef = useRef(false);
  const filterPopoverRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor)
  );

  // Close popover on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (filterPopoverRef.current && !filterPopoverRef.current.contains(event.target as Node)) {
        const button = (event.target as HTMLElement).closest('button[aria-haspopup="true"]');
        if (!button) {
          setFilterPopoverOpen(false);
        }
      }
    };

    if (filterPopoverOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [filterPopoverOpen]);

  // Source options — régua nova (7 origens, req. 8)
  const sourceOptions = SOURCE_OPTIONS;

  // Filter columns by selected sources
  const filteredColumns = columns.map((column) => ({
    ...column,
    leads:
      filterSources.length === 0
        ? []
        : filterSources.length === sourceOptions.length
          ? column.leads
          : column.leads.filter((lead) => filterSources.includes(lead.source)),
  }));

  const handleSourceToggle = (source: string) => {
    setFilterSources((prev) =>
      prev.includes(source) ? prev.filter((s) => s !== source) : [...prev, source]
    );
  };

  const handleSelectAll = () => {
    if (filterSources.length === sourceOptions.length) {
      setFilterSources([]);
    } else {
      setFilterSources(sourceOptions.map((opt) => opt.value));
    }
  };

  // Drag-and-drop handlers (dnd-kit: keyboard + touch accessible)
  const handleDndDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as { lead: FunnelLead } | undefined;
    setActiveLead(data?.lead ?? null);
  };

  const handleDndDragEnd = async (event: DragEndEvent) => {
    setActiveLead(null);
    const { active, over } = event;
    if (!over) return;

    const data = active.data.current as { lead: FunnelLead; columnId: string } | undefined;
    if (!data) return;

    const fromColumnId = data.columnId;
    const targetColumnId = String(over.id);
    if (fromColumnId === targetColumnId) return;

    // Suppress the trailing click so the drop doesn't also open the lead modal.
    justDraggedRef.current = true;
    setTimeout(() => {
      justDraggedRef.current = false;
    }, 50);

    const leadId = data.lead.id;
    const targetColumn = columns.find((c) => c.id === targetColumnId);
    const position = targetColumn ? targetColumn.leads.length : 0;

    // Coluna mapeada a status terminal (PAUSADO/CANCELADO/ENCERRADO) exige
    // motivo (req. 14 + caso extremo 12): NÃO move ainda — abre o diálogo. Como
    // nenhum estado foi alterado, cancelar o diálogo deixa o card exatamente na
    // coluna original, sem persistir nada.
    const mappedStatus = targetColumn?.mappedStatus as LeadStatus | null | undefined;
    if (mappedStatus && TERMINAL_LEAD_STATUSES.includes(mappedStatus)) {
      setPendingMove({ leadId, targetColumnId, position, fromColumnId, mappedStatus });
      return;
    }

    // Create interaction for status change (movimentos não-terminais)
    try {
      const fromTitle = columns.find((c) => c.id === fromColumnId)?.title || '';
      const toTitle = targetColumn?.title || '';
      await apiClient.createInteraction({
        leadId,
        type: 'STATUS_CHANGE',
        direction: 'OUTBOUND',
        content: `Status alterado de "${fromTitle}" para "${toTitle}"`,
        metadata: {
          oldColumn: fromColumnId,
          newColumn: targetColumnId,
        },
      });
    } catch {
      // Continue even if interaction creation fails
    }

    await moveLead(leadId, targetColumnId, position);
  };

  /**
   * Confirmação do motivo no arrasto para coluna terminal (req. 14).
   *
   * A ORDEM das chamadas importa e foi escolhida lendo o backend:
   * `leadService.update` só grava statusReason/statusReasonNote e gera a
   * Interaction STATUS_CHANGE quando o status MUDA (`data.status !==
   * existingLead.status`); já `funnelService.moveLead` seta o status mapeado da
   * coluna direto no Prisma, SEM motivo e sem interaction. Se o move rodasse
   * primeiro, o updateLead seguinte veria statusChanged=false e NÃO gravaria o
   * motivo nem a timeline. Por isso: `updateLead` ANTES (transição real → grava
   * motivo + interaction) e `moveLead` DEPOIS (reafirma o status e grava
   * coluna/posição). A interaction manual de mudança de coluna é dispensada
   * aqui — o backend já registrou a transição com o motivo.
   */
  const handleConfirmTerminalMove = async (reason: LeadStatusReason, note?: string) => {
    const move = pendingMove;
    setPendingMove(null);
    if (!move) return;
    try {
      await apiClient.updateLead(move.leadId, {
        status: move.mappedStatus,
        statusReason: reason,
        statusReasonNote: note,
      });
      await moveLead(move.leadId, move.targetColumnId, move.position);
    } catch (error) {
      console.error('Erro ao mover lead com motivo:', error);
      toast.error('Erro ao mover o lead. Tente novamente.');
      if (currentFunnelId) {
        await loadFunnelWithLeads(currentFunnelId);
      }
    }
  };

  /** Cancelar o diálogo desfaz o movimento (caso extremo 12): nada foi
   *  persistido nem movido — o card permanece na coluna original. */
  const handleCancelTerminalMove = () => setPendingMove(null);

  const handleCardClick = async (e: React.MouseEvent, lead: FunnelLead) => {
    if (justDraggedRef.current) return;

    try {
      // Enums novos direto do backend (req. 12) — sem camada de mapeamento.
      const fullLead = await apiClient.getLead(lead.id);
      setSelectedLead(fullLead || lead);
    } catch {
      setSelectedLead(lead);
    }
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setSelectedLead(null);
    if (currentFunnelId) {
      loadFunnelWithLeads(currentFunnelId);
    }
  };

  // Column handlers
  const handleStartEdit = (columnId: string, currentTitle: string) => {
    setEditingColumnId(columnId);
    setEditingColumnTitle(currentTitle);
  };

  const handleSaveEdit = async () => {
    if (!editingColumnId || !editingColumnTitle.trim()) return;

    const trimmedTitle = editingColumnTitle.trim();
    const duplicate = columns.find(
      (col) => col.id !== editingColumnId && col.title.toLowerCase() === trimmedTitle.toLowerCase()
    );

    if (duplicate) {
      setErrorMessage(`Já existe uma coluna com o nome "${duplicate.title}".`);
      return;
    }

    setErrorMessage('');
    try {
      await updateColumnApi(editingColumnId, { title: trimmedTitle });
    } catch {
      setErrorMessage('Erro ao renomear coluna.');
    }
    setEditingColumnId(null);
    setEditingColumnTitle('');
  };

  const handleCancelEdit = () => {
    setEditingColumnId(null);
    setEditingColumnTitle('');
    setErrorMessage('');
  };

  const handleCreateColumn = async () => {
    if (!newColumnTitle.trim()) return;

    const trimmedTitle = newColumnTitle.trim();
    const duplicate = columns.find((col) => col.title.toLowerCase() === trimmedTitle.toLowerCase());

    if (duplicate) {
      setErrorMessage(`Já existe uma coluna com o nome "${duplicate.title}".`);
      return;
    }

    setErrorMessage('');
    const randomColor =
      PIPELINE_COLUMN_COLORS[Math.floor(Math.random() * PIPELINE_COLUMN_COLORS.length)];

    try {
      await addColumnApi(trimmedTitle, randomColor);
      setNewColumnTitle('');
      setCreateColumnOpen(false);
    } catch {
      setErrorMessage('Erro ao criar coluna.');
    }
  };

  const handleDeleteColumn = async () => {
    if (!deleteColumnId) return;

    const column = columns.find((col) => col.id === deleteColumnId);
    if (!column) return;

    if (column.isDefault) {
      setErrorMessage('Não é possível deletar a coluna padrão.');
      setDeleteColumnId(null);
      return;
    }

    if (column.leads.length > 0) return;

    try {
      await deleteColumnApi(deleteColumnId);
    } catch (err: any) {
      setErrorMessage(err.message || 'Erro ao deletar coluna.');
    }
    setDeleteColumnId(null);
  };

  // Funnel handlers
  const handleCreateFunnel = async () => {
    if (!newFunnelName.trim()) return;

    const trimmedName = newFunnelName.trim();
    const duplicate = funnels.find((f) => f.name.toLowerCase() === trimmedName.toLowerCase());

    if (duplicate) {
      setErrorMessage(`Já existe um funil com o nome "${duplicate.name}".`);
      return;
    }

    setErrorMessage('');
    try {
      const newFunnel = await createFunnelApi(trimmedName);
      setNewFunnelName('');
      setCreateFunnelOpen(false);
      if (newFunnel) {
        switchFunnel(newFunnel.id);
      }
    } catch {
      setErrorMessage('Erro ao criar funil.');
    }
  };

  const handleDeleteFunnel = async () => {
    if (!deleteFunnelId) return;

    const funnel = funnels.find((f) => f.id === deleteFunnelId);
    if (!funnel) return;

    if (funnel.isDefault) {
      setErrorMessage('Não é possível deletar o Funil de Venda.');
      setDeleteFunnelId(null);
      return;
    }

    try {
      await deleteFunnelApi(deleteFunnelId);
    } catch (err: any) {
      setErrorMessage(err.message || 'Erro ao deletar funil.');
    }
    setDeleteFunnelId(null);
  };

  const handleStartEditFunnel = (funnelId: string, currentName: string) => {
    setEditingFunnelId(funnelId);
    setEditingFunnelName(currentName);
  };

  const handleSaveEditFunnel = async () => {
    if (!editingFunnelId || !editingFunnelName.trim()) return;

    const trimmedName = editingFunnelName.trim();
    const duplicate = funnels.find(
      (f) => f.id !== editingFunnelId && f.name.toLowerCase() === trimmedName.toLowerCase()
    );

    if (duplicate) {
      setErrorMessage(`Já existe um funil com o nome "${duplicate.name}".`);
      return;
    }

    setErrorMessage('');
    try {
      await updateFunnelApi(editingFunnelId, { name: trimmedName });
    } catch {
      setErrorMessage('Erro ao renomear funil.');
    }
    setEditingFunnelId(null);
    setEditingFunnelName('');
  };

  const handleCancelEditFunnel = () => {
    setEditingFunnelId(null);
    setEditingFunnelName('');
    setErrorMessage('');
  };

  const handleFunnelChange = (funnelId: string) => {
    switchFunnel(funnelId);
  };

  if (loading) {
    return <PageSkeleton type="table" />;
  }

  if (funnelError) {
    return (
      <div className="min-h-screen">
        <Header title="Funil de Vendas" subtitle="Erro ao carregar dados" />
        <div className="flex flex-col items-center justify-center p-16 text-center">
          <AlertTriangle className="h-12 w-12 text-amber-500 mb-4" />
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Erro ao carregar o pipeline</h2>
          <p className="text-gray-500 mb-4">{funnelError}</p>
          <Button variant="outline" onClick={refetchFunnels}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Tentar novamente
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header title="Funil de Vendas" subtitle="Visualize e gerencie seu pipeline" />

      <div className="p-8">
        {/* Funnel Selector */}
        <div className="mb-6 bg-card rounded-lg p-4 shadow-sm border border-gray-300">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1">
              <FunnelIcon size={20} className="text-gray-600" />
              <div className="flex items-center gap-2 flex-1">
                {editingFunnelId !== null && editingFunnelId === currentFunnelId ? (
                  <div className="flex items-center gap-2 flex-1">
                    <Input
                      value={editingFunnelName}
                      onChange={(e) => {
                        setEditingFunnelName(e.target.value);
                        setErrorMessage('');
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEditFunnel();
                        if (e.key === 'Escape') handleCancelEditFunnel();
                      }}
                      className={`h-8 text-sm flex-1 ${errorMessage ? 'border-red-500' : ''}`}
                      // eslint-disable-next-line jsx-a11y/no-autofocus -- foco inicial intencional ao entrar no modo de edição
                      autoFocus
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleSaveEditFunnel}
                      className="h-8 w-8 p-0"
                    >
                      <Check size={14} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleCancelEditFunnel}
                      className="h-8 w-8 p-0"
                    >
                      <X size={14} />
                    </Button>
                  </div>
                ) : (
                  <>
                    <select
                      value={currentFunnelId || ''}
                      onChange={(e) => handleFunnelChange(e.target.value)}
                      className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md bg-card focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                    >
                      {funnels.map((funnel) => (
                        <option key={funnel.id} value={funnel.id}>
                          {funnel.name} {funnel.isDefault ? '(Padrão)' : ''}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        handleStartEditFunnel(currentFunnelId!, currentFunnel?.name || '')
                      }
                      className="h-8 w-8 p-0 hover:bg-gray-200"
                      title="Renomear funil"
                    >
                      <Edit2 size={14} className="text-gray-600" />
                    </Button>
                    {currentFunnel && !currentFunnel.isDefault && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleteFunnelId(currentFunnelId!)}
                        className="h-8 w-8 p-0 hover:bg-gray-200"
                        title="Deletar funil"
                      >
                        <Trash2 size={14} className="text-gray-600" />
                      </Button>
                    )}
                  </>
                )}
              </div>
              {errorMessage && editingFunnelId && (
                <p className="text-xs text-red-600">{errorMessage}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => {
                  setSettingsColumnOrder(columns.map((c) => c.id));
                  setSettingsOpen(true);
                }}
              >
                <Settings size={16} />
                Configurações
              </Button>
              <Button
                variant="outline"
                className="border-2 border-primary text-primary hover:bg-primary hover:text-white gap-2"
                onClick={() => setCreateFunnelOpen(true)}
              >
                <Plus size={16} />
                Novo Funil
              </Button>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4 relative" ref={filterPopoverRef}>
            <button
              type="button"
              className={cn(
                buttonVariants({ variant: 'outline' }),
                'gap-2 border border-gray-300 bg-card hover:bg-gray-50 cursor-pointer'
              )}
              aria-expanded={filterPopoverOpen}
              aria-haspopup="true"
              onClick={(e) => {
                e.stopPropagation();
                setFilterPopoverOpen(!filterPopoverOpen);
              }}
            >
              <Filter size={16} />
              <span>
                {filterSources.length === 0
                  ? 'Nenhuma origem'
                  : filterSources.length === sourceOptions.length
                    ? 'Todas as origens'
                    : `${filterSources.length} origem${filterSources.length > 1 ? 's' : ''}`}
              </span>
              <ChevronDown
                size={16}
                className={
                  filterPopoverOpen
                    ? 'rotate-180 transition-transform duration-200'
                    : 'transition-transform duration-200'
                }
              />
            </button>
            {filterPopoverOpen && (
              <div className="absolute top-full left-0 mt-2 z-50 w-56 bg-card rounded-md border border-gray-300 shadow-lg p-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-300">
                    <span className="text-sm font-medium text-gray-900">Filtrar por Origem</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleSelectAll}
                      className="h-6 px-2 text-xs"
                    >
                      {filterSources.length === sourceOptions.length
                        ? 'Desmarcar'
                        : 'Selecionar todas'}
                    </Button>
                  </div>
                  {sourceOptions.map((option) => (
                    <div
                      key={option.value}
                      role="button"
                      tabIndex={0}
                      className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-2 rounded-md -mx-2"
                      onClick={() => handleSourceToggle(option.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleSourceToggle(option.value);
                        }
                      }}
                    >
                      <Checkbox
                        id={`source-${option.value}`}
                        checked={filterSources.includes(option.value)}
                        onCheckedChange={() => handleSourceToggle(option.value)}
                      />
                      <label
                        htmlFor={`source-${option.value}`}
                        className="text-sm text-gray-900 cursor-pointer flex-1"
                      >
                        {option.label}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              className="border-2 border-primary text-primary hover:bg-primary hover:text-white gap-2"
              onClick={() => setCreateColumnOpen(true)}
            >
              <Plus size={16} />
              Nova Coluna
            </Button>
            <Button
              className="bg-primary hover:bg-primary-dark gap-2"
              onClick={() => navigate('/app/leads/new')}
            >
              <Plus size={16} />
              Novo Lead
            </Button>
          </div>
        </div>

        {/* Kanban Board */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDndDragStart}
          onDragEnd={handleDndDragEnd}
        >
          <div className="overflow-x-auto pb-4 -mx-2 px-2 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
            <div className="flex gap-6 min-w-max">
              {filteredColumns.map((column) => (
                <DroppableColumn key={column.id} columnId={column.id} isActiveDrag={!!activeLead}>
                  {/* Column Header */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2 flex-1">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: column.color }}
                      ></div>
                      {editingColumnId === column.id ? (
                        <div className="flex flex-col gap-2 flex-1">
                          <div className="flex items-center gap-2">
                            <Input
                              value={editingColumnTitle}
                              onChange={(e) => {
                                setEditingColumnTitle(e.target.value);
                                setErrorMessage('');
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveEdit();
                                if (e.key === 'Escape') handleCancelEdit();
                              }}
                              className={`h-8 text-sm ${errorMessage ? 'border-red-500' : ''}`}
                              // eslint-disable-next-line jsx-a11y/no-autofocus -- foco inicial intencional ao entrar no modo de edição
                              autoFocus
                            />
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={handleSaveEdit}
                              className="h-8 w-8 p-0"
                            >
                              <Check size={14} />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={handleCancelEdit}
                              className="h-8 w-8 p-0"
                            >
                              <X size={14} />
                            </Button>
                          </div>
                          {errorMessage && (
                            <p className="text-xs text-red-600 mt-1">{errorMessage}</p>
                          )}
                        </div>
                      ) : (
                        <>
                          <h3 className="text-gray-900">{column.title}</h3>
                          <span className="text-sm text-gray-600 bg-card px-2 py-0.5 rounded">
                            {column.leads.length}
                          </span>
                        </>
                      )}
                    </div>
                    {editingColumnId !== column.id && (
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleStartEdit(column.id, column.title)}
                          className="h-7 w-7 p-0 hover:bg-gray-200"
                          title="Renomear coluna"
                        >
                          <Edit2 size={14} className="text-gray-600" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDeleteColumnId(column.id)}
                          disabled={column.leads.length > 0 || column.isDefault}
                          className="h-7 w-7 p-0 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                          title={
                            column.isDefault
                              ? 'Não é possível deletar a coluna padrão'
                              : column.leads.length > 0
                                ? 'Não é possível deletar coluna com leads'
                                : 'Deletar coluna'
                          }
                        >
                          <Trash2 size={14} className="text-gray-600" />
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Cards */}
                  <div className="space-y-3">
                    {column.leads.map((lead) => (
                      <DraggableLeadCard
                        key={lead.id}
                        lead={lead}
                        columnId={column.id}
                        onCardClick={handleCardClick}
                      >
                        <div className="mb-3">
                          <h4 className="font-medium text-gray-900 mb-1">{lead.name}</h4>
                          <LeadSourceBadge source={lead.source} />
                        </div>

                        {lead.company && (
                          <div className="flex items-center gap-2 text-sm text-gray-600 mb-3">
                            <Building2 size={14} className="flex-shrink-0" />
                            <span className="truncate">{lead.company}</span>
                          </div>
                        )}

                        <div className="flex items-center gap-2 text-xs text-gray-600 pt-3 border-t border-gray-300">
                          <Clock size={12} />
                          <span>{new Date(lead.createdAt).toLocaleDateString('pt-BR')}</span>
                        </div>
                      </DraggableLeadCard>
                    ))}

                    {column.leads.length === 0 && (
                      <div className="text-center py-8 text-gray-600">
                        <p className="text-sm">Nenhum lead nesta etapa</p>
                      </div>
                    )}
                  </div>
                </DroppableColumn>
              ))}
            </div>
          </div>
          <DragOverlay>
            {activeLead ? (
              <div className="bg-card rounded-lg p-4 shadow-lg border-2 border-primary w-[288px]">
                <h4 className="font-medium text-gray-900">{activeLead.name}</h4>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        {/* Stats Summary */}
        <div className="mt-8 bg-card rounded-lg p-6 shadow-sm border border-gray-300">
          <h3 className="text-gray-900 mb-4">Resumo do Funil</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <p className="text-sm text-gray-600 mb-1">Total de Leads</p>
              <p className="text-2xl font-semibold text-gray-900">
                {filteredColumns.reduce((acc, col) => acc + col.leads.length, 0)}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600 mb-1">Colunas</p>
              <p className="text-2xl font-semibold text-primary">{columns.length}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600 mb-1">Funil Ativo</p>
              <p className="text-2xl font-semibold text-gray-900">{currentFunnel?.name || '-'}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Create Column Dialog */}
      <Dialog open={createColumnOpen} onOpenChange={setCreateColumnOpen}>
        <DialogContent className="sm:max-w-md bg-card">
          <DialogHeader className="text-left space-y-0 pb-4">
            <DialogTitle className="text-lg font-semibold text-gray-900">
              Criar Nova Coluna
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label
                htmlFor="new-column-title"
                className="text-sm font-medium text-gray-900 mb-2 block"
              >
                Nome da Coluna
              </label>
              <Input
                id="new-column-title"
                value={newColumnTitle}
                onChange={(e) => {
                  setNewColumnTitle(e.target.value);
                  setErrorMessage('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateColumn();
                }}
                placeholder="Ex: Proposta Enviada"
                className={errorMessage ? 'border-red-500' : ''}
                // eslint-disable-next-line jsx-a11y/no-autofocus -- foco inicial intencional ao abrir o diálogo
                autoFocus
              />
              {errorMessage && <p className="text-xs text-red-600 mt-2">{errorMessage}</p>}
            </div>
          </div>
          <DialogFooter className="mt-6">
            <Button
              variant="outline"
              onClick={() => {
                setCreateColumnOpen(false);
                setNewColumnTitle('');
                setErrorMessage('');
              }}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleCreateColumn}
              disabled={!newColumnTitle.trim()}
              className="bg-primary hover:bg-primary-dark"
            >
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Column Alert Dialog */}
      <AlertDialog
        open={deleteColumnId !== null}
        onOpenChange={(open) => !open && setDeleteColumnId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deletar Coluna</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteColumnId &&
                (() => {
                  const column = columns.find((col) => col.id === deleteColumnId);
                  if (column?.isDefault) {
                    return (
                      <span className="text-red-600">
                        Não é possível deletar a coluna padrão &quot;{column.title}&quot;.
                      </span>
                    );
                  }
                  if (column && column.leads.length > 0) {
                    return (
                      <span className="text-red-600">
                        Não é possível deletar esta coluna pois ela contém {column.leads.length}{' '}
                        lead(s).
                      </span>
                    );
                  }
                  return `Tem certeza que deseja deletar a coluna "${column?.title}"?`;
                })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteColumnId(null)}>Cancelar</AlertDialogCancel>
            {deleteColumnId &&
              (() => {
                const column = columns.find((col) => col.id === deleteColumnId);
                return (
                  column &&
                  !column.isDefault &&
                  column.leads.length === 0 && (
                    <AlertDialogAction
                      onClick={handleDeleteColumn}
                      className="bg-red-600 hover:bg-red-700"
                    >
                      Deletar
                    </AlertDialogAction>
                  )
                );
              })()}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Create Funnel Dialog */}
      <Dialog open={createFunnelOpen} onOpenChange={setCreateFunnelOpen}>
        <DialogContent className="sm:max-w-md bg-card">
          <DialogHeader className="text-left space-y-0 pb-4">
            <DialogTitle className="text-lg font-semibold text-gray-900">
              Criar Novo Funil
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label
                htmlFor="new-funnel-name"
                className="text-sm font-medium text-gray-900 mb-2 block"
              >
                Nome do Funil
              </label>
              <Input
                id="new-funnel-name"
                value={newFunnelName}
                onChange={(e) => {
                  setNewFunnelName(e.target.value);
                  setErrorMessage('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateFunnel();
                }}
                placeholder="Ex: Funil de Marketing"
                className={errorMessage ? 'border-red-500' : ''}
                // eslint-disable-next-line jsx-a11y/no-autofocus -- foco inicial intencional ao abrir o diálogo
                autoFocus
              />
              {errorMessage && <p className="text-xs text-red-600 mt-2">{errorMessage}</p>}
              <p className="text-xs text-gray-600 mt-2">
                O funil será criado com colunas padrão baseadas no status do lead.
              </p>
            </div>
          </div>
          <DialogFooter className="mt-6">
            <Button
              variant="outline"
              onClick={() => {
                setCreateFunnelOpen(false);
                setNewFunnelName('');
                setErrorMessage('');
              }}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleCreateFunnel}
              disabled={!newFunnelName.trim()}
              className="bg-primary hover:bg-primary-dark"
            >
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Funnel Alert Dialog */}
      <AlertDialog
        open={deleteFunnelId !== null}
        onOpenChange={(open) => !open && setDeleteFunnelId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deletar Funil</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteFunnelId &&
                (() => {
                  const funnel = funnels.find((f) => f.id === deleteFunnelId);
                  if (funnel?.isDefault) {
                    return (
                      <span className="text-red-600">
                        Não é possível deletar o Funil de Venda. Ele é obrigatório no sistema.
                      </span>
                    );
                  }
                  return `Tem certeza que deseja deletar o funil "${funnel?.name}"?`;
                })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteFunnelId(null)}>Cancelar</AlertDialogCancel>
            {deleteFunnelId &&
              (() => {
                const funnel = funnels.find((f) => f.id === deleteFunnelId);
                return (
                  funnel &&
                  !funnel.isDefault && (
                    <AlertDialogAction
                      onClick={handleDeleteFunnel}
                      className="bg-red-600 hover:bg-red-700"
                    >
                      Deletar
                    </AlertDialogAction>
                  )
                );
              })()}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Lead Modal */}
      <LeadModal open={modalOpen} onClose={handleCloseModal} lead={selectedLead} />

      {/* Motivo obrigatório no arrasto p/ coluna terminal (req. 14 + caso 12):
          confirmar grava motivo + move; cancelar devolve o card à coluna original. */}
      <StatusReasonDialog
        open={pendingMove !== null}
        targetStatus={pendingMove?.mappedStatus ?? null}
        onConfirm={handleConfirmTerminalMove}
        onCancel={handleCancelTerminalMove}
      />

      {/* Pipeline Settings Dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-lg bg-card">
          <DialogHeader className="text-left space-y-0 pb-4">
            <DialogTitle className="text-lg font-semibold text-gray-900">
              Configurações do Pipeline
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-3">Ordem das Colunas</h4>
              <p className="text-xs text-gray-500 mb-3">
                Reordene as colunas do funil usando as setas
              </p>
              <div className="space-y-2">
                {settingsColumnOrder.map((colId, index) => {
                  const col = columns.find((c) => c.id === colId);
                  if (!col) return null;
                  return (
                    <div
                      key={colId}
                      className="flex items-center gap-3 bg-gray-50 rounded-lg px-4 py-3 border border-gray-200"
                    >
                      <div
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: col.color }}
                      />
                      <span className="flex-1 text-sm font-medium text-gray-900">{col.title}</span>
                      <span className="text-xs text-gray-400">{col.leads.length} leads</span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => {
                            if (index === 0) return;
                            const newOrder = [...settingsColumnOrder];
                            [newOrder[index - 1], newOrder[index]] = [
                              newOrder[index],
                              newOrder[index - 1],
                            ];
                            setSettingsColumnOrder(newOrder);
                          }}
                          disabled={index === 0}
                          className="p-1 rounded hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          onClick={() => {
                            if (index === settingsColumnOrder.length - 1) return;
                            const newOrder = [...settingsColumnOrder];
                            [newOrder[index], newOrder[index + 1]] = [
                              newOrder[index + 1],
                              newOrder[index],
                            ];
                            setSettingsColumnOrder(newOrder);
                          }}
                          disabled={index === settingsColumnOrder.length - 1}
                          className="p-1 rounded hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <ArrowDown size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">Informações do Funil</h4>
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 text-sm space-y-1">
                <p className="text-gray-600">
                  Nome: <span className="font-medium text-gray-900">{currentFunnel?.name}</span>
                </p>
                <p className="text-gray-600">
                  Colunas: <span className="font-medium text-gray-900">{columns.length}</span>
                </p>
                <p className="text-gray-600">
                  Total de leads:{' '}
                  <span className="font-medium text-gray-900">
                    {columns.reduce((acc, col) => acc + col.leads.length, 0)}
                  </span>
                </p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={async () => {
                const currentOrder = columns.map((c) => c.id);
                const hasChanged = settingsColumnOrder.some((id, i) => currentOrder[i] !== id);
                if (hasChanged) {
                  await reorderColumnsApi(settingsColumnOrder);
                  await loadFunnelWithLeads(currentFunnelId!);
                }
                setSettingsOpen(false);
              }}
            >
              Salvar Ordem
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** A lead card that can be picked up with pointer, touch or keyboard (dnd-kit). */
function DraggableLeadCard({
  lead,
  columnId,
  onCardClick,
  children,
}: {
  lead: FunnelLead;
  columnId: string;
  onCardClick: (e: React.MouseEvent, lead: FunnelLead) => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: lead.id,
    data: { lead, columnId },
  });
  const style = {
    transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- dnd-kit já fornece role/tabIndex via {...attributes} e o teclado via {...listeners} (drag por teclado); adicionar onKeyDown próprio quebraria o KeyboardSensor
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={(e) => onCardClick(e, lead)}
      className={cn(
        'bg-card rounded-lg p-4 shadow-sm border border-gray-300 cursor-grab active:cursor-grabbing hover:shadow-md transition-all duration-150',
        isDragging && 'shadow-2xl ring-2 ring-primary/60 scale-[1.02] z-50 rotate-1'
      )}
    >
      {children}
    </div>
  );
}

/** A funnel column that accepts dropped lead cards. */
function DroppableColumn({
  columnId,
  children,
  isActiveDrag,
}: {
  columnId: string;
  children: ReactNode;
  isActiveDrag?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'bg-gray-100 rounded-lg p-4 min-w-[320px] max-w-[320px] flex-shrink-0 transition-all duration-200',
        isOver && 'ring-2 ring-primary/40 bg-primary/5',
        isActiveDrag && !isOver && 'opacity-60'
      )}
    >
      {children}
    </div>
  );
}
