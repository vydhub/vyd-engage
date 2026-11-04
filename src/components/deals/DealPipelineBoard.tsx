import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  closestCenter,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { Deal, DealStage } from '../../types';
import { DealCard } from './DealCard';
import { formatCurrency } from '../../utils/format';
import type { DealFunnelColumn, PipelineDeal } from '../../hooks/useDealsPipeline';
import { cn } from '../ui/utils';

// Fallback stages used when no funnel columns are provided (legacy mode)
const PIPELINE_STAGES: { stage: DealStage; label: string; color: string }[] = [
  {
    stage: 'QUALIFICATION',
    label: 'Qualificação',
    color: 'var(--color-stage-qualification-accent)',
  },
  { stage: 'PROPOSAL', label: 'Proposta', color: 'var(--color-stage-proposal-accent)' },
  { stage: 'NEGOTIATION', label: 'Negociação', color: 'var(--color-stage-negotiation-accent)' },
  { stage: 'CLOSING', label: 'Fechamento', color: 'var(--color-stage-closing-accent)' },
];

interface DealPipelineBoardProps {
  deals: Deal[];
  onStageChange: (dealId: string, stage: DealStage) => Promise<void>;
  onEdit: (deal: Deal) => void;
  onClick: (deal: Deal) => void;
  funnelColumns?: DealFunnelColumn[];
  onMoveDeal?: (dealId: string, targetColumnId: string, position: number) => Promise<void>;
}

// Droppable column shell — highlights when a card is dragged over it
function DroppableColumn({
  id,
  children,
  isEmpty,
}: {
  id: string;
  children: ReactNode;
  isEmpty: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'p-2 space-y-2 min-h-[200px] rounded-b-lg transition-colors duration-150',
        isOver && isEmpty && 'border-2 border-dashed border-primary bg-primary/5',
        isOver && !isEmpty && 'bg-primary/5'
      )}
    >
      {children}
      {isEmpty && !isOver && (
        <div className="flex items-center justify-center h-20 text-xs text-gray-400">
          Arraste deals aqui
        </div>
      )}
      {isEmpty && isOver && (
        <div className="flex items-center justify-center h-20 text-xs text-primary font-medium">
          Solte aqui
        </div>
      )}
    </div>
  );
}

// Draggable card wrapper — handles drag state and renders the ghost placeholder
function DraggableCard({
  deal,
  onClick,
  onEdit,
  isStale,
}: {
  deal: Deal;
  onClick: () => void;
  onEdit: () => void;
  isStale?: boolean;
}) {
  // Via única (E-16): Negócio da Captura não muda de etapa pelo quadro.
  const controlado = !!deal.demanda;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
    data: { deal },
    disabled: controlado,
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn('touch-none', isDragging && 'opacity-40')}
      style={{ transition: 'opacity 200ms ease-out' }}
    >
      <DealCard deal={deal} onClick={onClick} onEdit={onEdit} isStale={isStale} />
      {controlado && (
        <p className="mt-1 px-1 text-xs text-muted-foreground">Andamento controlado pelo Flow</p>
      )}
    </div>
  );
}

// Convert PipelineDeal to Deal-like for DealCard
function pipelineDealToDeal(d: PipelineDeal): Deal {
  return {
    id: d.id,
    tenantId: '',
    name: d.name,
    value: typeof d.value === 'number' ? d.value : Number(d.value),
    stage: (d.stage as DealStage) || 'QUALIFICATION',
    probability: d.probability,
    expectedCloseDate: d.expectedCloseDate,
    leadId: d.leadId,
    lead: d.lead ? { ...d.lead, phone: undefined, company: d.lead.company ?? undefined } : null,
    company: d.company ?? null,
    assignedTo: d.assignedTo,
    assignedUser: d.assignedUser || null,
    notes: d.notes,
    customFields: {},
    lostReason: d.lostReason,
    status: d.status ?? null,
    qualification: d.qualification ?? null,
    taskCount: d._count?.tasks ?? 0,
    demanda: d.demanda ?? null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export function DealPipelineBoard({
  deals,
  onStageChange,
  onEdit,
  onClick,
  funnelColumns,
  onMoveDeal,
}: DealPipelineBoardProps) {
  const [activeDeal, setActiveDeal] = useState<Deal | null>(null);

  const useFunnelMode = !!funnelColumns && funnelColumns.length > 0;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = ({ active }: DragStartEvent) => {
    const id = active.id as string;
    if (useFunnelMode) {
      const pd = funnelColumns!.flatMap((c) => c.deals).find((d) => d.id === id);
      if (pd) setActiveDeal(pipelineDealToDeal(pd));
    } else {
      const d = deals.find((d) => d.id === id);
      if (d) setActiveDeal(d);
    }
  };

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    setActiveDeal(null);
    if (!over) return;

    const dealId = active.id as string;
    const targetId = over.id as string;

    if (useFunnelMode) {
      const sourceColumn = funnelColumns!.find((c) => c.deals.some((d) => d.id === dealId));
      if (!sourceColumn || sourceColumn.id === targetId) return;
      const targetColumn = funnelColumns!.find((c) => c.id === targetId);
      if (!targetColumn || !onMoveDeal) return;
      try {
        await onMoveDeal(dealId, targetId, targetColumn.deals.length);
      } catch {
        toast.error('Erro ao mover deal. Tente novamente.');
      }
    } else {
      const deal = deals.find((d) => d.id === dealId);
      if (!deal || deal.stage === targetId) return;
      try {
        await onStageChange(dealId, targetId as DealStage);
      } catch {
        toast.error('Erro ao mover deal. Tente novamente.');
      }
    }
  };

  const wonDeals = deals.filter((d) => d.stage === 'WON');
  const lostDeals = deals.filter((d) => d.stage === 'LOST');
  const wonTotal = wonDeals.reduce((s, d) => s + d.value, 0);
  const lostTotal = lostDeals.reduce((s, d) => s + d.value, 0);

  if (useFunnelMode) {
    const allColumnDeals = funnelColumns!.flatMap((c) => c.deals);
    const funnelWonTotal = allColumnDeals
      .filter((d) => d.stage === 'WON')
      .reduce((s, d) => s + Number(d.value), 0);
    const funnelLostTotal = allColumnDeals
      .filter((d) => d.stage === 'LOST')
      .reduce((s, d) => s + Number(d.value), 0);
    const funnelWonCount = allColumnDeals.filter((d) => d.stage === 'WON').length;
    const funnelLostCount = allColumnDeals.filter((d) => d.stage === 'LOST').length;

    return (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {/* WON / LOST summary */}
        <div className="flex gap-4 mb-4">
          <div className="flex-1 bg-green-50 border border-green-200 rounded-lg p-3 flex items-center justify-between">
            <span className="text-sm font-medium text-green-700">Ganhos ({funnelWonCount})</span>
            <span className="text-sm font-bold text-green-700">
              {formatCurrency(funnelWonTotal)}
            </span>
          </div>
          <div className="flex-1 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center justify-between">
            <span className="text-sm font-medium text-red-700">Perdidos ({funnelLostCount})</span>
            <span className="text-sm font-bold text-red-700">
              {formatCurrency(funnelLostTotal)}
            </span>
          </div>
        </div>

        {/* Kanban Board with Funnel Columns */}
        <div className="flex gap-4 overflow-x-auto pb-4">
          {funnelColumns!.map((column) => {
            const columnTotal = column.deals.reduce((s, d) => s + Number(d.value), 0);

            return (
              <div
                key={column.id}
                className="flex-shrink-0 w-72 bg-gray-50 rounded-lg border border-gray-200"
              >
                {/* Column header */}
                <div className="p-3 border-b border-gray-200">
                  <div className="flex items-center gap-2 mb-1">
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: column.color }}
                    />
                    <span className="text-sm font-semibold text-gray-900">{column.title}</span>
                    <span className="ml-auto text-xs text-gray-500 bg-gray-200 rounded-full px-2 py-0.5">
                      {column.deals.length}
                    </span>
                  </div>
                  <span className="text-xs text-gray-500">{formatCurrency(columnTotal)}</span>
                </div>

                <DroppableColumn id={column.id} isEmpty={column.deals.length === 0}>
                  {column.deals.map((deal) => {
                    const dealAsDeal = pipelineDealToDeal(deal);
                    return (
                      <DraggableCard
                        key={deal.id}
                        deal={dealAsDeal}
                        onClick={() => onClick(dealAsDeal)}
                        onEdit={() => onEdit(dealAsDeal)}
                      />
                    );
                  })}
                </DroppableColumn>
              </div>
            );
          })}
        </div>

        {/* Ghost card follows cursor during drag */}
        <DragOverlay dropAnimation={{ duration: 200, easing: 'ease-out' }}>
          {activeDeal ? (
            <DealCard deal={activeDeal} onClick={() => {}} onEdit={() => {}} isOverlay />
          ) : null}
        </DragOverlay>
      </DndContext>
    );
  }

  // Legacy enum-based board
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {/* WON / LOST summary */}
      <div className="flex gap-4 mb-4">
        <div className="flex-1 bg-green-50 border border-green-200 rounded-lg p-3 flex items-center justify-between">
          <span className="text-sm font-medium text-green-700">Ganhos ({wonDeals.length})</span>
          <span className="text-sm font-bold text-green-700">{formatCurrency(wonTotal)}</span>
        </div>
        <div className="flex-1 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center justify-between">
          <span className="text-sm font-medium text-red-700">Perdidos ({lostDeals.length})</span>
          <span className="text-sm font-bold text-red-700">{formatCurrency(lostTotal)}</span>
        </div>
      </div>

      {/* Kanban Board */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {PIPELINE_STAGES.map(({ stage, label, color }) => {
          const stageDeals = deals.filter((d) => d.stage === stage);
          const stageTotal = stageDeals.reduce((s, d) => s + d.value, 0);

          return (
            <div
              key={stage}
              className="flex-shrink-0 w-72 bg-gray-50 rounded-lg border border-gray-200"
            >
              {/* Column header */}
              <div className="p-3 border-b border-gray-200">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-sm font-semibold text-gray-900">{label}</span>
                  <span className="ml-auto text-xs text-gray-500 bg-gray-200 rounded-full px-2 py-0.5">
                    {stageDeals.length}
                  </span>
                </div>
                <span className="text-xs text-gray-500">{formatCurrency(stageTotal)}</span>
              </div>

              <DroppableColumn id={stage} isEmpty={stageDeals.length === 0}>
                {stageDeals.map((deal) => (
                  <DraggableCard
                    key={deal.id}
                    deal={deal}
                    onClick={() => onClick(deal)}
                    onEdit={() => onEdit(deal)}
                  />
                ))}
              </DroppableColumn>
            </div>
          );
        })}
      </div>

      {/* Ghost card follows cursor during drag */}
      <DragOverlay dropAnimation={{ duration: 200, easing: 'ease-out' }}>
        {activeDeal ? (
          <DealCard deal={activeDeal} onClick={() => {}} onEdit={() => {}} isOverlay />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
