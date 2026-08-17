import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../services/api/client';
import type {
  Capability,
  EffectivePermissions,
  EntityAction,
  VisibilityLevel,
} from '../types/governance';

/**
 * usePermissions — perfil efetivo do usuário logado (Upgrade RD P1, reqs 13/14).
 *
 * Lê `GET /api/v1/permission-profiles/me` (getEffective no backend) e expõe
 * helpers para a UI ESCONDER ações que o usuário não pode executar (ex.: botão
 * exportar/excluir/ação em massa). É apenas conveniência de UI — o enforcement
 * real é 100% no backend; esconder um botão nunca substitui a guarda de rota.
 *
 * NÃO-REGRESSÃO (DEFAULT = HOJE): enquanto o perfil não carregou (ou se a
 * chamada falhar), `can()` responde `true` — comportamento otimista idêntico ao
 * de hoje, em que nenhuma ação é escondida na UI. A UI só passa a esconder algo
 * quando o perfil efetivo carregar e negar a capability explicitamente. Assim a
 * camada nova é ADITIVA: só restringe a UI por configuração explícita, nunca por
 * omissão/erro.
 *
 * Cache: dado de nível de configuração — carregado uma vez por sessão, sem
 * refetch em foco.
 */
export function usePermissions() {
  const query = useQuery({
    queryKey: ['my-permissions'],
    queryFn: async (): Promise<EffectivePermissions> => {
      const res = await apiClient.getMyPermissions();
      return res.data;
    },
    staleTime: Infinity,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const permissions = query.data;

  /**
   * `true` se o usuário PODE executar a capability. Otimista durante o load/erro
   * (retorna `true`) para não esconder ações por omissão — o backend é o gate.
   */
  function can(cap: Capability): boolean {
    if (!permissions) return true;
    return permissions.capabilities[cap] === true;
  }

  /**
   * Nível de visibilidade efetivo para a entidade (PROPRIA | EQUIPE | GERAL).
   * Durante o load/erro assume GERAL (== hoje: sem filtro extra na UI).
   */
  function visibility(entity: keyof EffectivePermissions['visibility']): VisibilityLevel {
    if (!permissions) return 'GERAL';
    return permissions.visibility[entity];
  }

  /**
   * `true` se o usuário pode executar a ação na ENTIDADE (eixo `entities` do
   * perfil efetivo — ex.: canEntity('companies','create')). Otimista durante o
   * load/erro e quando o eixo não vem no payload: só esconde quando o backend
   * negar explicitamente (mesma filosofia do can()).
   */
  function canEntity(entity: string, action: EntityAction): boolean {
    const entry = permissions?.entities?.[entity];
    if (!entry) return true;
    return entry[action] === true;
  }

  return {
    /** Perfil efetivo cru (undefined enquanto carrega). */
    permissions,
    /** `can(cap)` — esconder ações na UI conforme capabilities (UI-only). */
    can,
    /** `canEntity(entity, action)` — permissão por entidade (create/edit/delete). */
    canEntity,
    /** `visibility(entity)` — nível de visibilidade por entidade. */
    visibility,
    /** True enquanto o perfil efetivo está em carregamento. */
    isLoading: query.isLoading,
    /** True se a chamada ao perfil efetivo falhou. */
    isError: query.isError,
  };
}
