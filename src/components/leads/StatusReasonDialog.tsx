import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import {
  LEAD_STATUS_LABELS,
  LEAD_STATUS_REASON_LABELS,
  LeadStatus,
  LeadStatusReason,
} from '../../types';

/**
 * Diálogo de motivo obrigatório ao mover um lead para PAUSADO/CANCELADO/
 * ENCERRADO (specs/leads-oportunidade req. 13-14). Usado pelo detalhe do lead,
 * pelo Kanban (arrasto para coluna terminal) e pelas ações em massa.
 * Cancelar chama onCancel (o chamador desfaz o movimento — caso extremo 12).
 */
interface StatusReasonDialogProps {
  open: boolean;
  /** Status terminal de destino (define o título do diálogo) */
  targetStatus: LeadStatus | null;
  /** Quantos leads serão afetados (para o texto do lote em bulk) */
  count?: number;
  onConfirm: (reason: LeadStatusReason, note?: string) => void;
  onCancel: () => void;
}

const REASON_OPTIONS = Object.entries(LEAD_STATUS_REASON_LABELS) as Array<
  [LeadStatusReason, string]
>;

export function StatusReasonDialog({
  open,
  targetStatus,
  count,
  onConfirm,
  onCancel,
}: StatusReasonDialogProps) {
  const [reason, setReason] = useState<LeadStatusReason | ''>('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (open) {
      setReason('');
      setNote('');
    }
  }, [open]);

  const statusLabel = targetStatus ? LEAD_STATUS_LABELS[targetStatus] : '';
  const noteRequired = reason === 'OUTRO';
  const canConfirm = reason !== '' && (!noteRequired || note.trim().length > 0);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Informe o motivo — {statusLabel}</DialogTitle>
          <DialogDescription>
            {count && count > 1
              ? `O motivo será aplicado aos ${count} leads selecionados.`
              : 'A mudança de status para este estado exige um motivo.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="status-reason">Motivo *</Label>
            <select
              id="status-reason"
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={reason}
              onChange={(e) => setReason(e.target.value as LeadStatusReason | '')}
            >
              <option value="">Selecione o motivo…</option>
              {REASON_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="status-reason-note">
              Nota {noteRequired ? '*' : '(opcional)'}
            </Label>
            <Textarea
              id="status-reason-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                noteRequired ? 'Descreva o motivo (obrigatório para "Outro")' : 'Detalhes adicionais'
              }
              rows={3}
              maxLength={2000}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button disabled={!canConfirm} onClick={() => reason && onConfirm(reason, note.trim() || undefined)}>
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
