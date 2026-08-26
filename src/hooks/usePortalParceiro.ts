// Hooks do Portal do Parceiro (consultor externo).

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toast } from 'sonner';
import { apiClient } from '@/services/api/client';
import type { RegistroInput } from '@/types/parceiros';

function errMsg(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

export function usePortalPerfil() {
  return useQuery({ queryKey: ['portal-perfil'], queryFn: () => apiClient.portalPerfil() });
}
export function usePortalRegistros() {
  return useQuery({ queryKey: ['portal-registros'], queryFn: () => apiClient.portalRegistros() });
}
export function usePortalRegistro(id: string | null) {
  return useQuery({
    queryKey: ['portal-registro', id],
    queryFn: () => apiClient.portalRegistro(id as string),
    enabled: !!id,
  });
}
export function usePortalComissoes() {
  return useQuery({ queryKey: ['portal-comissoes'], queryFn: () => apiClient.portalComissoes() });
}
export function usePortalMetas() {
  return useQuery({ queryKey: ['portal-metas'], queryFn: () => apiClient.portalMetas() });
}
export function usePortalReunioes() {
  return useQuery({ queryKey: ['portal-reunioes'], queryFn: () => apiClient.portalReunioes() });
}
export function usePortalDocumentos() {
  return useQuery({ queryKey: ['portal-documentos'], queryFn: () => apiClient.portalDocumentos() });
}

export function usePortalActions() {
  const qc = useQueryClient();
  const invalidate = useCallback(
    (keys: string[]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] }))),
    [qc]
  );
  const wrap = useCallback(
    async <T>(fn: () => Promise<T>, okMsg: string | null, keys: string[]): Promise<T> => {
      try {
        const res = await fn();
        if (okMsg) toast.success(okMsg);
        await invalidate(keys);
        return res;
      } catch (err) {
        toast.error(errMsg(err, 'Ocorreu um erro'));
        throw err;
      }
    },
    [invalidate]
  );

  return {
    criarRegistro: (data: RegistroInput) =>
      wrap(() => apiClient.portalCriarRegistro(data), 'Oportunidade registrada — aguardando aprovação', ['portal-registros']),
    addUpdate: (id: string, texto: string) =>
      wrap(() => apiClient.portalAddUpdate(id, texto), 'Atualização registrada', ['portal-registros', 'portal-registro']),
    pedirExtensao: (id: string, data: { justificativa: string; diasSolicitados?: number }) =>
      wrap(() => apiClient.portalPedirExtensao(id, data), 'Pedido de extensão enviado', ['portal-registro']),
    concluirAcao: (id: string) =>
      wrap(() => apiClient.portalConcluirAcao(id), 'Ação concluída', ['portal-registros', 'portal-registro']),
  };
}
