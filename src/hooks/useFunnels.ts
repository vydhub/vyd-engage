import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../services/api/client';

export interface FunnelLead {
  id: string;
  name: string;
  email: string;
  phone: string;
  company?: string;
  /** Empresa vinculada (régua nova) — o texto livre `company` é fallback legado */
  companyRef?: { id: string; name: string } | null;
  score: number;
  source: string;
  status: string;
  positionInColumn: number;
  createdAt: string;
  tags: Array<{ tag: { id: string; name: string; color: string } }>;
}

export interface FunnelColumn {
  id: string;
  title: string;
  color: string;
  order: number;
  isDefault: boolean;
  mappedStatus: string | null;
  leads: FunnelLead[];
  _count?: { leads: number };
}

export interface Funnel {
  id: string;
  name: string;
  isDefault: boolean;
  order: number;
  columns: FunnelColumn[];
}

export function useFunnels() {
  const [funnels, setFunnels] = useState<Funnel[]>([]);
  const [currentFunnelId, setCurrentFunnelId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const currentFunnel = funnels.find((f) => f.id === currentFunnelId) || funnels[0] || null;
  const columns = currentFunnel?.columns || [];

  // Load all funnels on mount
  const loadFunnels = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Ensure default LEAD funnel exists and get all LEAD funnels
      const defaultRes = await apiClient.getDefaultFunnel('LEAD');
      const allRes = await apiClient.getFunnels('LEAD');
      const rawList: Funnel[] = allRes.data || allRes || [];

      // Normalize: findAll returns columns without leads, ensure leads defaults to []
      const funnelList = rawList.map((f) => ({
        ...f,
        columns: (f.columns || []).map((c) => ({ ...c, leads: c.leads || [] })),
      }));

      setFunnels(funnelList);

      // Set current funnel to default or first
      if (!currentFunnelId || !funnelList.find((f) => f.id === currentFunnelId)) {
        const defaultFunnel = funnelList.find((f) => f.isDefault) || funnelList[0];
        if (defaultFunnel) {
          setCurrentFunnelId(defaultFunnel.id);
        }
      }
    } catch (err: unknown) {
      console.error('Failed to load funnels:', err);
      setError(err instanceof Error ? err.message : 'Erro ao carregar funis');
    } finally {
      setLoading(false);
    }
  }, [currentFunnelId]);

  // Load funnel with leads (full data)
  const loadFunnelWithLeads = useCallback(async (funnelId: string) => {
    try {
      const res = await apiClient.getFunnel(funnelId);
      const funnel: Funnel = res.data || res;

      setFunnels((prev) => prev.map((f) => (f.id === funnelId ? funnel : f)));
      return funnel;
    } catch (err: unknown) {
      console.error('Failed to load funnel:', err);
      setError(err instanceof Error ? err.message : 'Erro ao carregar funil');
      return null;
    }
  }, []);

  // Switch current funnel
  const switchFunnel = useCallback(
    async (funnelId: string) => {
      setCurrentFunnelId(funnelId);
      await loadFunnelWithLeads(funnelId);
    },
    [loadFunnelWithLeads]
  );

  // Create new funnel (always LEAD type for this hook)
  const createFunnel = useCallback(async (name: string) => {
    try {
      const res = await apiClient.createFunnel({ name, type: 'LEAD' });
      const newFunnel: Funnel = res.data || res;
      setFunnels((prev) => [...prev, newFunnel]);
      return newFunnel;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao criar funil');
      throw err;
    }
  }, []);

  // Update funnel
  const updateFunnel = useCallback(
    async (funnelId: string, data: { name?: string; order?: number }) => {
      try {
        const res = await apiClient.updateFunnel(funnelId, data);
        const updated: Funnel = res.data || res;
        setFunnels((prev) => prev.map((f) => (f.id === funnelId ? updated : f)));
        return updated;
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Erro ao atualizar funil');
        throw err;
      }
    },
    []
  );

  // Delete funnel
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
        setError(err instanceof Error ? err.message : 'Erro ao deletar funil');
        throw err;
      }
    },
    [currentFunnelId, funnels]
  );

  // Add column
  const addColumn = useCallback(
    async (title: string, color?: string) => {
      if (!currentFunnelId) return;
      try {
        const res = await apiClient.addFunnelColumn(currentFunnelId, { title, color });
        const newColumn: FunnelColumn = res.data || res;
        setFunnels((prev) =>
          prev.map((f) => {
            if (f.id !== currentFunnelId) return f;
            return { ...f, columns: [...f.columns, { ...newColumn, leads: [] }] };
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

  // Update column
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

  // Delete column
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

  // Reorder columns
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
              .filter(Boolean) as FunnelColumn[];
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

  // Move lead between columns (drag-and-drop)
  const moveLead = useCallback(
    async (leadId: string, targetColumnId: string, position: number) => {
      if (!currentFunnelId) return;

      // Optimistic update
      setFunnels((prev) =>
        prev.map((f) => {
          if (f.id !== currentFunnelId) return f;

          let movedLead: FunnelLead | null = null;
          const newColumns = f.columns.map((col) => {
            const leadIndex = col.leads.findIndex((l) => l.id === leadId);
            if (leadIndex !== -1) {
              movedLead = col.leads[leadIndex];
              return { ...col, leads: col.leads.filter((l) => l.id !== leadId) };
            }
            return col;
          });

          if (!movedLead) return f;

          return {
            ...f,
            columns: newColumns.map((col) => {
              if (col.id !== targetColumnId) return col;
              const leads = [...col.leads];
              leads.splice(position, 0, movedLead!);
              return { ...col, leads };
            }),
          };
        })
      );

      // Sync with backend
      try {
        await apiClient.moveLead({ leadId, targetColumnId, position });
      } catch (err: unknown) {
        // Revert on error - reload funnel
        console.error('Failed to move lead:', err);
        await loadFunnelWithLeads(currentFunnelId);
      }
    },
    [currentFunnelId, loadFunnelWithLeads]
  );

  // Initial load
  useEffect(() => {
    loadFunnels();
  }, []);

  // Load leads when funnel changes
  useEffect(() => {
    if (currentFunnelId) {
      loadFunnelWithLeads(currentFunnelId);
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
    loadFunnelWithLeads,
    switchFunnel,
    createFunnel,
    updateFunnel,
    deleteFunnel,
    addColumn,
    updateColumn,
    deleteColumn,
    reorderColumns,
    moveLead,
  };
}
