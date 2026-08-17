import { useState } from 'react';
import { Button } from '../ui/button';
import { X, ChevronDown, Download, Trash2, Loader2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import {
  LEAD_STATUS_LABELS,
  TERMINAL_LEAD_STATUSES,
  type LeadStatus,
  type LeadStatusReason,
} from '../../types';
import { StatusReasonDialog } from './StatusReasonDialog';
import { apiClient } from '../../services/api/client';
import { handlePendingApproval } from '../../lib/approvalResponse';

interface LeadBulkActionsProps {
  selectedCount: number;
  onClearSelection: () => void;
  /**
   * Mudança de status em massa. Para PAUSADO/CANCELADO/ENCERRADO o componente
   * abre o StatusReasonDialog antes e repassa o motivo escolhido — um único
   * motivo aplicado ao lote inteiro (caso extremo 7).
   */
  onChangeStatus: (
    status: LeadStatus,
    statusReason?: LeadStatusReason,
    statusReasonNote?: string
  ) => void;
  onExportCSV: () => void;
  onDelete: () => void;
  /**
   * IDs dos leads selecionados. Quando fornecido (opcional, retrocompatível), o
   * componente executa as ações em massa (status/delete) diretamente via
   * apiClient e trata a resposta 202 de aprovação (mostra o toast "enviado para
   * aprovação do gestor" em vez de sucesso). Quando ausente, mantém o fluxo
   * legado delegando aos callbacks acima (execução imediata == hoje).
   */
  selectedLeadIds?: string[];
  /** Chamado após uma ação self-executada concluir (para refetch/limpeza). */
  onActionComplete?: () => void;
}

// Régua nova da área comercial (specs/leads-oportunidade req. 7/14). As ações
// de tag saíram da barra (req. 23 — tags ocultas nas telas de lead; a API de
// bulk add_tag/remove_tag continua existindo no backend).
const STATUS_OPTIONS = (Object.entries(LEAD_STATUS_LABELS) as Array<[LeadStatus, string]>).map(
  ([value, label]) => ({ value, label })
);

export function LeadBulkActions({
  selectedCount,
  onClearSelection,
  onChangeStatus,
  onExportCSV,
  onDelete,
  selectedLeadIds,
  onActionComplete,
}: LeadBulkActionsProps) {
  const [busy, setBusy] = useState(false);
  // Status terminal aguardando motivo no diálogo (req. 14)
  const [pendingStatus, setPendingStatus] = useState<LeadStatus | null>(null);

  // Modo self-executado: só ativa quando o consumidor passa os IDs. Roda a ação
  // em massa, detecta 202 (aprovação pendente) e delega ao callback legado apenas
  // como sinal de refresh. Sem IDs, cai no callback legado (comportamento atual).
  const canSelfExecute = Array.isArray(selectedLeadIds) && selectedLeadIds.length > 0;

  const runBulk = async (
    action: string,
    params: Record<string, unknown> | undefined,
    legacy: () => void
  ) => {
    if (!canSelfExecute) {
      legacy();
      return;
    }
    setBusy(true);
    try {
      const res = await apiClient.bulkUpdateLeads(selectedLeadIds!, action, params);
      // 202 → enfileirado para aprovação; NÃO seguimos o fluxo de sucesso.
      if (handlePendingApproval(res)) return;
      onActionComplete?.();
    } finally {
      setBusy(false);
    }
  };

  const applyChangeStatus = (
    status: LeadStatus,
    statusReason?: LeadStatusReason,
    statusReasonNote?: string
  ) =>
    runBulk('change_status', { status, statusReason, statusReasonNote }, () =>
      onChangeStatus(status, statusReason, statusReasonNote)
    );

  const handleChangeStatus = (status: LeadStatus) => {
    // Transição terminal exige motivo (req. 13-14): abre o diálogo antes de
    // enviar; um motivo vale para o lote inteiro (caso extremo 7).
    if (TERMINAL_LEAD_STATUSES.includes(status)) {
      setPendingStatus(status);
      return;
    }
    void applyChangeStatus(status);
  };

  const handleDelete = () => {
    // O delete em massa passa por um diálogo de confirmação no consumidor legado.
    // Quando self-executado, a confirmação é responsabilidade do chamador antes de
    // montar o componente; aqui apenas dispara a ação e trata o 202.
    if (!canSelfExecute) {
      onDelete();
      return;
    }
    void runBulk('delete', undefined, onDelete);
  };

  return (
    <div
      className="bg-primary text-primary-foreground rounded-lg p-4 shadow-sm border border-primary mb-4"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span className="font-medium">
            {selectedCount} lead{selectedCount > 1 ? 's' : ''} selecionado
            {selectedCount > 1 ? 's' : ''}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearSelection}
            className="text-primary-foreground hover:bg-primary-foreground/20 h-8 px-2"
          >
            <X size={14} />
          </Button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {busy && <Loader2 size={16} className="animate-spin" aria-label="Processando" />}
          {/* Status Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" className="gap-1" disabled={busy}>
                Status <ChevronDown size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {STATUS_OPTIONS.map((opt) => (
                <DropdownMenuItem key={opt.value} onClick={() => handleChangeStatus(opt.value)}>
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Export CSV */}
          <Button
            variant="secondary"
            size="sm"
            className="gap-1"
            onClick={onExportCSV}
            disabled={busy}
          >
            <Download size={14} /> Exportar CSV
          </Button>

          {/* Delete */}
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            className="gap-1"
            disabled={busy}
          >
            <Trash2 size={14} />
            Deletar
          </Button>
        </div>
      </div>

      {/* Motivo obrigatório para o lote (req. 14 + caso extremo 7): confirmar
          envia {status, statusReason, statusReasonNote}; cancelar não altera nada. */}
      <StatusReasonDialog
        open={pendingStatus !== null}
        targetStatus={pendingStatus}
        count={selectedCount}
        onConfirm={(reason, note) => {
          const status = pendingStatus;
          setPendingStatus(null);
          if (status) void applyChangeStatus(status, reason, note);
        }}
        onCancel={() => setPendingStatus(null)}
      />
    </div>
  );
}
