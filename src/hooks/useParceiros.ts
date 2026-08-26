// Hooks de dados do módulo de Parceiros Comerciais (TanStack Query + apiClient).
// Componentes consomem só estes hooks — nunca chamam apiClient direto no JSX.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toast } from 'sonner';
import { apiClient } from '@/services/api/client';
import type {
  ConsultorInput,
  RegistroInput,
  ConflitoDecisao,
  PapelAtribuicao,
  ParceiroConfig,
} from '@/types/parceiros';

function errMsg(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

// ── Queries ───────────────────────────────────────────────────────────────
export function useParceirosPainel() {
  return useQuery({ queryKey: ['parceiros-painel'], queryFn: () => apiClient.getParceirosPainel() });
}
export function useConsultores(filters: Record<string, string> = {}) {
  return useQuery({ queryKey: ['consultores', filters], queryFn: () => apiClient.listConsultores(filters) });
}
export function useConsultorScoreHistory(id: string | null) {
  return useQuery({
    queryKey: ['consultor-score', id],
    queryFn: () => apiClient.getConsultorScoreHistory(id as string),
    enabled: !!id,
  });
}
export function useRegistros(filters: Record<string, string> = {}) {
  return useQuery({ queryKey: ['registros', filters], queryFn: () => apiClient.listRegistros(filters) });
}
export function useRegistro(id: string | null) {
  return useQuery({
    queryKey: ['registro', id],
    queryFn: () => apiClient.getRegistro(id as string),
    enabled: !!id,
  });
}
export function useConflitos(status: 'ABERTO' | 'RESOLVIDO' = 'ABERTO') {
  return useQuery({ queryKey: ['conflitos', status], queryFn: () => apiClient.listConflitos(status) });
}
export function useSobreposicao() {
  return useQuery({ queryKey: ['sobreposicao'], queryFn: () => apiClient.getSobreposicao() });
}
export function useExtensoes(status = 'PENDENTE') {
  return useQuery({ queryKey: ['extensoes', status], queryFn: () => apiClient.listExtensoes(status) });
}
export function useExtratoComissoes(filters: Record<string, string> = {}) {
  return useQuery({ queryKey: ['comissoes', filters], queryFn: () => apiClient.getExtratoComissoes(filters) });
}
export function useReunioesParceiros(filters: Record<string, string> = {}) {
  return useQuery({ queryKey: ['parceiro-reunioes', filters], queryFn: () => apiClient.listReunioesParceiros(filters) });
}
export function useMetasParceiros(consultorId?: string) {
  return useQuery({ queryKey: ['parceiro-metas', consultorId ?? ''], queryFn: () => apiClient.listMetasParceiros(consultorId) });
}
export function useDocumentosParceiros() {
  return useQuery({ queryKey: ['parceiro-documentos'], queryFn: () => apiClient.listDocumentosParceiros() });
}
export function useParceiroConfig() {
  return useQuery({ queryKey: ['parceiro-config'], queryFn: () => apiClient.getParceiroConfig() });
}

// ── Actions ─────────────────────────────────────────────────────────────────
export function useParceirosActions() {
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
    // Consultores
    createConsultor: (data: ConsultorInput) => wrap(() => apiClient.createConsultor(data), 'Consultor criado', ['consultores', 'parceiros-painel']),
    updateConsultor: (id: string, data: Partial<ConsultorInput>) => wrap(() => apiClient.updateConsultor(id, data), 'Consultor atualizado', ['consultores', 'parceiros-painel']),
    deleteConsultor: (id: string) => wrap(() => apiClient.deleteConsultor(id), 'Consultor removido', ['consultores', 'parceiros-painel']),
    enviarNda: (id: string, file: File) => wrap(() => apiClient.enviarNda(id, file), 'NDA enviado para assinatura', ['consultores']),
    uploadNdaManual: (id: string, file: File) => wrap(() => apiClient.uploadNdaManual(id, file), 'NDA registrado — portal liberado', ['consultores']),
    // Registros
    createRegistroInterno: (data: RegistroInput & { consultorId: string }) => wrap(() => apiClient.createRegistroInterno(data), 'Registro criado', ['registros', 'parceiros-painel']),
    aprovarRegistro: (id: string, data: { protecaoDias?: number; motivo?: string } = {}) => wrap(() => apiClient.aprovarRegistro(id, data), 'Registro aprovado', ['registros', 'registro', 'parceiros-painel']),
    rejeitarRegistro: (id: string, motivo: string) => wrap(() => apiClient.rejeitarRegistro(id, motivo), 'Registro rejeitado', ['registros', 'registro', 'parceiros-painel']),
    marcarGanho: (id: string, valorContrato: number) => wrap(() => apiClient.marcarGanho(id, valorContrato), 'Oportunidade ganha!', ['registros', 'registro', 'parceiros-painel']),
    marcarPerdido: (id: string, motivo?: string) => wrap(() => apiClient.marcarPerdido(id, motivo), 'Oportunidade marcada como perdida', ['registros', 'registro']),
    reativarRegistro: (id: string, data: { protecaoDias?: number; motivo?: string } = {}) => wrap(() => apiClient.reativarRegistro(id, data), 'Registro reativado', ['registros', 'registro', 'parceiros-painel']),
    ajustarProtecao: (id: string, data: { dias?: number; novoFim?: string; motivo: string }) => wrap(() => apiClient.ajustarProtecao(id, data), 'Janela de proteção ajustada', ['registros', 'registro']),
    atualizarCliente: (id: string, data: { clienteNome?: string; clienteCnpj?: string | null; clienteContato?: string | null }) => wrap(() => apiClient.atualizarCliente(id, data), 'Dados do cliente atualizados', ['registros', 'registro', 'conflitos']),
    addUpdate: (id: string, texto: string) => wrap(() => apiClient.addRegistroUpdate(id, texto), 'Atualização registrada', ['registros', 'registro']),
    // Plano de ação
    createPlanoItem: (registroId: string, data: { descricao: string; responsavelConsultor: boolean; responsavelUserId?: string | null; dueDate?: string | null }) =>
      wrap(() => apiClient.createPlanoItem(registroId, data), 'Ação adicionada', ['registro']),
    updatePlanoItem: (id: string, data: Parameters<typeof apiClient.updatePlanoItem>[1]) => wrap(() => apiClient.updatePlanoItem(id, data), null, ['registro']),
    deletePlanoItem: (id: string) => wrap(() => apiClient.deletePlanoItem(id), 'Ação removida', ['registro']),
    // Extensões
    decidirExtensao: (id: string, data: { aprovar: boolean; dias?: number; motivo?: string }) =>
      wrap(() => apiClient.decidirExtensao(id, data), 'Decisão registrada', ['extensoes', 'registros', 'registro']),
    // Conflitos
    resolverConflito: (id: string, data: { decisao: ConflitoDecisao; rationale: string }) =>
      wrap(() => apiClient.resolverConflito(id, data), 'Conflito resolvido', ['conflitos', 'registros', 'registro', 'parceiros-painel']),
    // Comissão
    setAtribuicao: (registroId: string, data: { consultorId: string; papel: PapelAtribuicao; percentualOverride?: number | null }) =>
      wrap(() => apiClient.setAtribuicao(registroId, data), 'Atribuição salva', ['registro']),
    removeAtribuicao: (id: string) => wrap(() => apiClient.removeAtribuicao(id), 'Atribuição removida', ['registro']),
    setSplit: (registroId: string, splitOriginador: number) => wrap(() => apiClient.setSplit(registroId, splitOriginador), 'Split atualizado', ['registro']),
    addRecebimento: (registroId: string, data: { data: string; valor: number; referencia?: string | null }) =>
      wrap(() => apiClient.addRecebimento(registroId, data), 'Recebimento registrado — comissões liberadas', ['registro', 'comissoes']),
    removeRecebimento: (id: string) => wrap(() => apiClient.removeRecebimento(id), 'Recebimento removido', ['registro', 'comissoes']),
    marcarParcelaPaga: (id: string, paga: boolean) => wrap(() => apiClient.marcarParcelaPaga(id, paga), null, ['comissoes']),
    // Reuniões
    createReuniao: (data: { consultorId: string; dataHora: string; pauta?: string | null; participantes?: string[] | null }) => wrap(() => apiClient.createReuniao(data), 'Reunião agendada', ['parceiro-reunioes']),
    updateReuniao: (id: string, data: Parameters<typeof apiClient.updateReuniao>[1]) => wrap(() => apiClient.updateReuniao(id, data), 'Reunião atualizada', ['parceiro-reunioes']),
    registrarPresenca: (id: string, presenca: 'PRESENTE' | 'FALTOU', observacoes?: string) =>
      wrap(() => apiClient.registrarPresenca(id, presenca, observacoes), 'Presença registrada', ['parceiro-reunioes', 'parceiros-painel']),
    deleteReuniao: (id: string) => wrap(() => apiClient.deleteReuniao(id), 'Reunião removida', ['parceiro-reunioes']),
    // Metas
    upsertMeta: (data: { consultorId: string; month: number; year: number; alvoRegistros?: number; alvoPipeline?: number; alvoGanho?: number }) =>
      wrap(() => apiClient.upsertMeta(data), 'Meta salva', ['parceiro-metas']),
    deleteMeta: (id: string) => wrap(() => apiClient.deleteMeta(id), 'Meta removida', ['parceiro-metas']),
    // Documentos
    uploadDocumento: (titulo: string, file: File) => wrap(() => apiClient.uploadDocumentoParceiro(titulo, file), 'Documento publicado', ['parceiro-documentos']),
    updateDocumento: (id: string, data: { titulo?: string; ativo?: boolean }) => wrap(() => apiClient.updateDocumentoParceiro(id, data), null, ['parceiro-documentos']),
    deleteDocumento: (id: string) => wrap(() => apiClient.deleteDocumentoParceiro(id), 'Documento removido', ['parceiro-documentos']),
    // Config + relatório
    updateConfig: (data: Partial<ParceiroConfig>) => wrap(() => apiClient.updateParceiroConfig(data), 'Configuração salva', ['parceiro-config']),
    gerarRelatorio: (params?: { periodo?: string; inicio?: string; fim?: string }) =>
      wrap(() => apiClient.gerarRelatorioParceiros(params), 'Relatório gerado', []),
  };
}
