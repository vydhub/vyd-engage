import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../services/api/client';
import { toast } from 'sonner';
import { Lead, LeadCompanyRef, LeadContactRef } from '../types';
import { useSocket } from './useSocket';
import { handlePendingApproval } from '../lib/approvalResponse';

/**
 * Campo de texto opcional: `''` (input não preenchido) vira `undefined`.
 *
 * O backend valida `email` com `.email().optional()` e `assignedTo` com
 * `.uuid().optional()` — e `.optional()` do Zod aceita `undefined`, NÃO string
 * vazia. Mandar `''` reprovava com 400 "Validation error" ao salvar um lead sem
 * e-mail (campo que a tela trata como opcional). O backend também passou a
 * tolerar vazio; aqui é a outra ponta.
 */
function vazioComoAusente(v: unknown): string | undefined {
  if (typeof v !== 'string') return v as string | undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}

/**
 * Semântica de EDIÇÃO (spec req. 9): campo limpo na tela vira NULL explícito no
 * PUT — o backend grava a limpeza. `undefined` continua significando "não tocar".
 * (Na criação, vazio segue como ausente — vazioComoAusente.)
 */
function vazioComoNull(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') return v as string | undefined;
  const t = v.trim();
  return t === '' ? null : t;
}

/**
 * Normaliza as tags para o formato que o backend valida: `tagIds` é
 * `z.array(z.string().uuid())` — array de STRINGS (server/src/routes/leads.ts).
 *
 * Existe porque as telas montavam a lista como `[{ id }]` e o payload ia assim
 * para a API, que respondia 400 "Validation error". O erro ficou invisível por
 * muito tempo: na rota, o enforceLimit do plano roda ANTES do parse, então o 403
 * do limite mascarava este 400. Aceitar os dois formatos aqui evita que qualquer
 * chamador futuro reintroduza o problema.
 *
 * ATENÇÃO à ORDEM dos fallbacks: o lead CRU de GET /leads/:id traz linhas de
 * LeadTag `{id: <id da LINHA de junção>, tagId, tag: {id}}` — usar `t.id`
 * primeiro mandaria o id da junção (uuid válido ≠ Tag) e o PUT apagaria as
 * tags e cairia em violação de FK. Por isso: tag.id → tagId → id.
 */
function toTagIds(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((t) => {
      if (typeof t === 'string') return t;
      const o = t as { id?: string; tagId?: string; tag?: { id?: string } } | null;
      return o?.tag?.id ?? o?.tagId ?? o?.id ?? '';
    })
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

export interface LeadsFilters {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  status?: string;
  source?: string;
  search?: string;
  tagId?: string;
  assignedTo?: string;
  companyId?: string;
  isContact?: string | boolean;
}

interface ApiLeadTag {
  tag?: { id: string; name: string; color: string };
  tagId?: string;
}
interface ApiLead {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  position?: string;
  companyId?: string | null;
  companyRef?: LeadCompanyRef | null;
  contactId?: string | null;
  contactRef?: LeadContactRef | null;
  status: string;
  source: string;
  statusReason?: string | null;
  statusReasonNote?: string | null;
  estimatedValue?: number | string | null;
  estimatedTimeline?: string | null;
  probabilityGoGet?: number | null;
  score?: number;
  isContact?: boolean;
  convertedAt?: string | null;
  customFields?: Record<string, string | number | boolean | null>;
  notes?: string;
  assignedTo?: string;
  assignedUser?: { id: string; name: string; email: string } | null;
  tags?: Array<ApiLeadTag | string>;
  createdAt?: string;
  updatedAt?: string;
}

const DEFAULT_PAGINATION = { page: 1, limit: 20, total: 0, totalPages: 0 };

function buildServerParams(filters?: LeadsFilters): Record<string, string | number> {
  const serverParams: Record<string, string | number> = {};
  if (!filters) return serverParams;
  if (filters.page) serverParams.page = filters.page;
  if (filters.limit) serverParams.limit = filters.limit;
  if (filters.sort) serverParams.sort = filters.sort;
  if (filters.order) serverParams.order = filters.order;
  if (filters.status) serverParams.status = filters.status;
  if (filters.source) serverParams.source = filters.source;
  if (filters.search) serverParams.search = filters.search;
  if (filters.tagId) serverParams.tagId = filters.tagId;
  if (filters.assignedTo) serverParams.assignedTo = filters.assignedTo;
  if (filters.companyId) serverParams.companyId = filters.companyId;
  if (filters.isContact !== undefined && filters.isContact !== '')
    serverParams.isContact = String(filters.isContact);
  return serverParams;
}

// Sem camada de mapeamento: a UI usa os enums do backend diretamente (spec req. 12)
function transformLead(lead: ApiLead): Lead {
  return {
    id: lead.id,
    name: lead.name,
    email: lead.email || '',
    phone: lead.phone || '',
    company: lead.company || '',
    position: lead.position || '',
    companyId: lead.companyId ?? null,
    companyRef: lead.companyRef ?? null,
    contactId: lead.contactId ?? null,
    contactRef: lead.contactRef ?? null,
    status: lead.status as Lead['status'],
    source: lead.source as Lead['source'],
    statusReason: (lead.statusReason as Lead['statusReason']) ?? null,
    statusReasonNote: lead.statusReasonNote ?? null,
    estimatedValue: lead.estimatedValue ?? null,
    estimatedTimeline: lead.estimatedTimeline ?? null,
    probabilityGoGet: lead.probabilityGoGet ?? null,
    score: lead.score || 0,
    isContact: lead.isContact || false,
    convertedAt: lead.convertedAt || null,
    customFields: lead.customFields || {},
    notes: lead.notes || '',
    assignedTo: lead.assignedTo || '',
    assignedUser: lead.assignedUser ?? null,
    tags:
      lead.tags?.map((lt) => (typeof lt === 'string' ? lt : lt.tag?.id || lt.tagId || '')) || [],
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
  } as Lead;
}

/**
 * Leads data hook backed by TanStack Query. Public API is unchanged from the
 * previous hand-rolled version (leads/loading/error/pagination/fetchLeads/CRUD/refetch);
 * `fetchLeads(filters)` now drives the query key instead of an imperative fetch.
 */
export function useLeads() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<LeadsFilters | undefined>(undefined);

  const query = useQuery({
    queryKey: ['leads', filters],
    queryFn: async () => {
      const result = await apiClient.getLeads(buildServerParams(filters));
      return {
        leads: (result.leads as unknown as ApiLead[]).map(transformLead),
        pagination: result.pagination || { ...DEFAULT_PAGINATION },
      };
    },
  });

  useEffect(() => {
    if (query.isError) toast.error('Erro ao carregar leads');
  }, [query.isError]);

  const { on } = useSocket();

  useEffect(() => {
    const offUpdated = on('lead:updated', (data: unknown) => {
      const payload = data as { lead: Record<string, unknown> };
      queryClient.setQueryData(['leads', filters], (old: unknown) => {
        if (!old || typeof old !== 'object') return old;
        const prev = old as Record<string, unknown>;
        if (Array.isArray(prev)) {
          return prev.map((l: Record<string, unknown>) =>
            l.id === payload.lead?.id ? payload.lead : l
          );
        }
        if (Array.isArray((prev as { leads?: unknown[] }).leads)) {
          return {
            ...prev,
            leads: (prev as { leads: Record<string, unknown>[] }).leads.map((l) =>
              l.id === payload.lead?.id ? payload.lead : l
            ),
          };
        }
        return prev;
      });
    });

    const offCreated = on('lead:created', () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    });

    const offDeleted = on('lead:deleted', (data: unknown) => {
      const payload = data as { leadId: string };
      queryClient.setQueryData(['leads', filters], (old: unknown) => {
        if (!old || typeof old !== 'object') return old;
        const prev = old as Record<string, unknown>;
        if (Array.isArray(prev)) {
          return prev.filter((l: Record<string, unknown>) => l.id !== payload.leadId);
        }
        if (Array.isArray((prev as { leads?: unknown[] }).leads)) {
          return {
            ...prev,
            leads: (prev as { leads: Record<string, unknown>[] }).leads.filter(
              (l) => l.id !== payload.leadId
            ),
          };
        }
        return prev;
      });
    });

    return () => {
      offUpdated();
      offCreated();
      offDeleted();
    };
  }, [on, queryClient, filters]);

  const fetchLeads = useCallback((next?: LeadsFilters) => {
    setFilters(next);
  }, []);

  const createLead = useCallback(
    async (data: Partial<Lead>) => {
      try {
        const result = await apiClient.createLead({
          name: data.name || '',
          email: vazioComoAusente(data.email),
          phone: vazioComoAusente(data.phone),
          position: vazioComoAusente(data.position),
          companyId: data.companyId || undefined,
          contactId: data.contactId || undefined,
          status: data.status || undefined,
          source: data.source || undefined,
          statusReason: data.statusReason || undefined,
          statusReasonNote: vazioComoAusente(data.statusReasonNote ?? undefined),
          estimatedValue:
            data.estimatedValue !== undefined && data.estimatedValue !== null
              ? Number(data.estimatedValue)
              : undefined,
          estimatedTimeline: vazioComoAusente(data.estimatedTimeline ?? undefined),
          probabilityGoGet: data.probabilityGoGet ?? undefined,
          customFields: data.customFields || {},
          notes: vazioComoAusente(data.notes),
          assignedTo: vazioComoAusente(data.assignedTo),
          tagIds: toTagIds(data.tags),
        });
        const newLead = transformLead(result as unknown as ApiLead);
        toast.success('Lead criado com sucesso!');
        await queryClient.invalidateQueries({ queryKey: ['leads'] });
        return newLead;
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Erro ao criar lead');
        throw err;
      }
    },
    [queryClient]
  );

  const updateLead = useCallback(
    async (id: string, data: Partial<Lead>) => {
      try {
        const result = await apiClient.updateLead(id, {
          name: data.name,
          email: vazioComoAusente(data.email),
          phone: vazioComoAusente(data.phone),
          position: vazioComoAusente(data.position),
          companyId: data.companyId || undefined,
          contactId: data.contactId || undefined,
          status: data.status || undefined,
          source: data.source || undefined,
          statusReason: data.statusReason || undefined,
          statusReasonNote: vazioComoAusente(data.statusReasonNote ?? undefined),
          // Limpeza explícita (req. 9): campo esvaziado vai como null no PUT
          estimatedValue:
            data.estimatedValue === undefined
              ? undefined
              : data.estimatedValue === null || String(data.estimatedValue).trim() === ''
                ? null
                : Number(data.estimatedValue),
          estimatedTimeline: vazioComoNull(data.estimatedTimeline),
          probabilityGoGet:
            data.probabilityGoGet === undefined ? undefined : data.probabilityGoGet,
          customFields: data.customFields,
          notes: vazioComoNull(data.notes),
          assignedTo: vazioComoNull(data.assignedTo),
          tagIds: toTagIds(data.tags),
        });
        const updatedLead = transformLead(result as unknown as ApiLead);
        toast.success('Lead atualizado com sucesso!');
        await queryClient.invalidateQueries({ queryKey: ['leads'] });
        return updatedLead;
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Erro ao atualizar lead');
        throw err;
      }
    },
    [queryClient]
  );

  const deleteLead = useCallback(
    async (id: string) => {
      try {
        const res = await apiClient.deleteLead(id);
        // Perfil exige aprovação (req 16): backend responde 202 e NÃO exclui. Mostra
        // o toast "enviado para aprovação" e NÃO invalida a lista como sucesso.
        if (handlePendingApproval(res)) return;
        toast.success('Lead deletado com sucesso!');
        await queryClient.invalidateQueries({ queryKey: ['leads'] });
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Erro ao deletar lead');
        throw err;
      }
    },
    [queryClient]
  );

  return {
    leads: query.data?.leads ?? [],
    loading: query.isLoading,
    error: query.error ? (query.error as Error).message : null,
    pagination: query.data?.pagination ?? { ...DEFAULT_PAGINATION },
    fetchLeads,
    createLead,
    updateLead,
    deleteLead,
    refetch: fetchLeads,
  };
}
