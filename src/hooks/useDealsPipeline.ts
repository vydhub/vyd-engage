import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { apiClient } from '../services/api/client';
import { Deal } from '../types';

export interface PipelineDeal {
  id: string;
  name: string;
  value: number;
  stage: string;
  probability: number;
  expectedCloseDate?: string | null;
  leadId?: string | null;
  lead?: { id: string; name: string; email?: string; company?: string | null } | null;
  company?: { id: string; name: string } | null;
  assignedTo?: string | null;
  assignedUser?: { id: string; name: string; email?: string } | null;
  notes?: string | null;
  lostReason?: string | null;
  demanda?: {
    id: string;
    flowCardId: string | null;
    valorEnviado?: number | string | null;
    valorAprovado?: number | string | null;
  } | null;
  positionInColumn: number;
  // Gestão de Negócios (RD parity) — enriquecimento do card (req 35)
  status?: string | null;
  qualification?: number | null;
  _count?: { tasks?: number };
  createdAt: string;
  updatedAt: string;
}

export interface DealFunnelColumn {
  id: string;
  title: string;
  color: string;
  order: number;
  isDefault: boolean;
  mappedStatus: string | null;
  deals: PipelineDeal[];
  _count?: { deals: number; leads: number };
}

export interface DealFunnel {
  id: string;
  name: string;
  type: string;
  isDefault: boolean;
  order: number;
  columns: DealFunnelColumn[];
}

export function useDealsPipeline() {
  const [funnels, setFunnels] = useState<DealFunnel[]>([]);
  const [currentFunnelId, setCurrentFunnelId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const currentFunnel = funnels.find((f) => f.id === currentFunnelId) || funnels[0] || null;
  const columns = currentFunnel?.columns || [];

  const loadFunnels = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Ensure default DEAL funnel exists
      await apiClient.getDefaultFunnel('DEAL');
      const allRes = await apiClient.getFunnels('DEAL');
      const rawList: DealFunnel[] = (allRes as any).data || allRes || [];

      const funnelList = rawList.map((f) => ({
        ...f,
        columns: (f.columns || []).map((c) => ({ ...c, deals: c.deals || [] })),
      }));

      setFunnels(funnelList);

      if (!currentFunnelId || !funnelList.find((f) => f.id === currentFunnelId)) {
        const defaultFunnel = funnelList.find((f) => f.isDefault) || funnelList[0];
        if (defaultFunnel) {
          setCurrentFunnelId(defaultFunnel.id);
        }
      }
    } catch (err: unknown) {
      console.error('Failed to load deal funnels:', err);
      setError(err instanceof Error ? err.message : 'Erro ao carregar pipelines de deals');
    } finally {
      setLoading(false);
    }
  }, [currentFunnelId]);

  const loadFunnelWithDeals = useCallback(async (funnelId: string) => {
    try {
      const res = await apiClient.getFunnel(funnelId);
      const funnel: DealFunnel = (res as any).data || res;

      // Normalize: ensure deals array exists on each column
      const normalized = {
        ...funnel,
        columns: (funnel.columns || []).map((c) => ({ ...c, deals: c.deals || [] })),
      };

      setFunnels((prev) => prev.map((f) => (f.id === funnelId ? normalized : f)));
      return normalized;
    } catch (err: unknown) {
      console.error('Failed to load deal funnel:', err);
      setError(err instanceof Error ? err.message : 'Erro ao carregar pipeline');
      return null;
    }
  }, []);

  const switchFunnel = useCallback(
    async (funnelId: string) => {
      setCurrentFunnelId(funnelId);
      await loadFunnelWithDeals(funnelId);
    },
    [loadFunnelWithDeals]
  );

  const createFunnel = useCallback(async (name: string) => {
    try {
      const res = await apiClient.createFunnel({ name, type: 'DEAL' });
      const newFunnel: DealFunnel = (res as any).data || res;
      const normalized = {
        ...newFunnel,
        columns: (newFunnel.columns || []).map((c) => ({ ...c, deals: [] })),
      };
      setFunnels((prev) => [...prev, normalized]);
      return normalized;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao criar pipeline');
      throw err;
    }
  }, []);

  const updateFunnel = useCallback(
    async (funnelId: string, data: { name?: string; order?: number }) => {
      try {
        const res = await apiClient.updateFunnel(funnelId, data);
        const updated: DealFunnel = (res as any).data || res;
        setFunnels((prev) =>
          prev.map((f) => (f.id === funnelId ? { ...f, ...updated, columns: f.columns } : f))
        );
        return updated;
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Erro ao atualizar pipeline');
        throw err;
      }
    },
    []
  );

  const deleteFunnel = useCallback(
    async (funnelId: string) => {
      try {
        await apiClient.deleteFunnel(funnelId);
        setFunnels((prev) => prev.filter((f) => f.id !== funnelId));
        if (currentFunnelId === funnelId) {
          const remaining = funnels.filter((f) => f.id !== funnelId);
          const defaultFunnel = remaining.find((f) => f.isDefault) || remaining[0];
          if (defaultFunnel) {
            setCurrentFunnelId(defaultFunnel.id);
          }
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Erro ao deletar pipeline');
        throw err;
      }
    },
    [currentFunnelId, funnels]
  );

  const addColumn = useCallback(
    async (title: string, color?: string) => {
      if (!currentFunnelId) return;
      try {
        const res = await apiClient.addFunnelColumn(currentFunnelId, { title, color });
        const newColumn: DealFunnelColumn = (res as any).data || res;
        setFunnels((prev) =>
          prev.map((f) => {
            if (f.id !== currentFunnelId) return f;
            return { ...f, columns: [...f.columns, { ...newColumn, deals: [] }] };
          })
        );
        return newColumn;
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Erro ao adicionar coluna');
        throw err;
      }
    },
    [currentFunnelId]
  );

  const updateColumn = useCallback(
    async (columnId: string, data: { title?: string; color?: string }) => {
      if (!currentFunnelId) return;
      try {
        await apiClient.updateFunnelColumn(currentFunnelId, columnId, data);
        setFunnels((prev) =>
          prev.map((f) => {
            if (f.id !== currentFunnelId) return f;
            return {
              ...f,
              columns: f.columns.map((c) => (c.id === columnId ? { ...c, ...data } : c)),
            };
          })
        );
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Erro ao atualizar coluna');
        throw err;
      }
    },
    [currentFunnelId]
  );

  const deleteColumn = useCallback(
    async (columnId: string) => {
      if (!currentFunnelId) return;
      try {
        await apiClient.deleteFunnelColumn(currentFunnelId, columnId);
        setFunnels((prev) =>
          prev.map((f) => {
            if (f.id !== currentFunnelId) return f;
            return { ...f, columns: f.columns.filter((c) => c.id !== columnId) };
          })
        );
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Erro ao deletar coluna');
        throw err;
      }
    },
    [currentFunnelId]
  );

  const reorderColumns = useCallback(
    async (columnIds: string[]) => {
      if (!currentFunnelId) return;
      try {
        await apiClient.reorderFunnelColumns(currentFunnelId, columnIds);
        setFunnels((prev) =>
          prev.map((f) => {
            if (f.id !== currentFunnelId) return f;
            const reordered = columnIds
              .map((id, index) => {
                const col = f.columns.find((c) => c.id === id);
                return col ? { ...col, order: index } : null;
              })
              .filter(Boolean) as DealFunnelColumn[];
            return { ...f, columns: reordered };
          })
        );
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Erro ao reordenar colunas');
        throw err;
      }
    },
    [currentFunnelId]
  );

  const moveDeal = useCallback(
    async (dealId: string, targetColumnId: string, position: number) => {
      if (!currentFunnelId) return;

      // Optimistic update
      setFunnels((prev) =>
        prev.map((f) => {
          if (f.id !== currentFunnelId) return f;

          let movedDeal: PipelineDeal | null = null;
          const newColumns = f.columns.map((col) => {
            const dealIndex = col.deals.findIndex((d) => d.id === dealId);
            if (dealIndex !== -1) {
              movedDeal = col.deals[dealIndex];
              return { ...col, deals: col.deals.filter((d) => d.id !== dealId) };
            }
            return col;
          });

          if (!movedDeal) return f;

          return {
            ...f,
            columns: newColumns.map((col) => {
              if (col.id !== targetColumnId) return col;
              const deals = [...col.deals];
              deals.splice(position, 0, movedDeal!);
              return { ...col, deals };
            }),
          };
        })
      );

      // Sync with backend
      try {
        await apiClient.moveDeal({ dealId, targetColumnId, position });
      } catch (err: unknown) {
        console.error('Failed to move deal:', err);
        // Reverte o update otimista recarregando o funil do backend.
        await loadFunnelWithDeals(currentFunnelId);
        // req 4: a mensagem do backend já lista os campos obrigatórios pendentes
        // da etapa de destino (STAGE_REQUIRED_FIELDS_MISSING) — exibe ao usuário.
        toast.error(err instanceof Error ? err.message : 'Erro ao mover negociação');
      }
    },
    [currentFunnelId, loadFunnelWithDeals]
  );

  // Initial load
  useEffect(() => {
    loadFunnels();
  }, []);

  // Load deals when funnel changes
  useEffect(() => {
    if (currentFunnelId) {
      loadFunnelWithDeals(currentFunnelId);
    }
  }, [currentFunnelId]);

  return {
    funnels,
    currentFunnel,
    currentFunnelId,
    columns,
    loading,
    error,
    loadFunnels,
    loadFunnelWithDeals,
    switchFunnel,
    createFunnel,
    updateFunnel,
    deleteFunnel,
    addColumn,
    updateColumn,
    deleteColumn,
    reorderColumns,
    moveDeal,
  };
}
