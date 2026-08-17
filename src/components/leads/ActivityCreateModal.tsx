import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Paperclip, UserPlus, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { AudioTranscribeButton } from '../AudioTranscribeButton';
import { apiClient } from '../../services/api/client';
import { CALL_REASON_LABELS, CallReason, MeetingModality } from '../../types';

/**
 * "+ Nova atividade" do detalhe do lead (specs/leads-oportunidade reqs. 35-40):
 * um único fluxo com seletor de tipo — Reunião (local, modalidade,
 * participantes, data/hora, assuntos, anexos), Ligação (direção, motivo,
 * participantes, data/hora, assuntos) e Tarefa (título, prioridade,
 * vencimento, responsável, status, tipo).
 *
 * Participantes = contatos (isContact=true) da MESMA empresa do lead, com
 * cadastro rápido inline (req. 36 / caso 4); lead sem empresa lista todos os
 * contatos do tenant (caso extremo 1). "Assuntos tratados" aceita entrada por
 * áudio (req. 44) — erros de transcrição nunca apagam o texto digitado (caso 8).
 */

export type ActivityKind = 'MEETING' | 'CALL' | 'TASK';

const KIND_LABELS: Record<ActivityKind, string> = {
  MEETING: 'Reunião',
  CALL: 'Ligação',
  TASK: 'Tarefa',
};

const MODALITY_LABELS: Record<MeetingModality, string> = {
  PRESENCIAL: 'Presencial',
  ONLINE: 'Online',
};

const TASK_PRIORITY_OPTIONS: Array<[string, string]> = [
  ['LOW', 'Baixa'],
  ['MEDIUM', 'Média'],
  ['HIGH', 'Alta'],
  ['URGENT', 'Urgente'],
];

const TASK_STATUS_OPTIONS: Array<[string, string]> = [
  ['PENDING', 'A fazer'],
  ['IN_PROGRESS', 'Em andamento'],
  ['COMPLETED', 'Concluída'],
];

// Tipos de tarefa (req. 39): novos valores da área comercial primeiro + demais
// do enum TaskType existente.
const TASK_TYPE_OPTIONS: Array<[string, string]> = [
  ['FOLLOW_UP', 'Follow-up'],
  ['PREPARACAO_DOCUMENTO', 'Preparação de documento'],
  ['VISITA_TECNICA', 'Visita técnica'],
  ['EMAIL', 'E-mail'],
  ['LIGACAO', 'Ligação'],
  ['REUNIAO', 'Reunião'],
  ['VISITA', 'Visita'],
  ['APRESENTACAO', 'Apresentação'],
  ['PROPOSTA', 'Proposta'],
  ['OUTRO', 'Outro'],
];

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB — mesmo teto do backend (req. 40)

const SELECT_CLASS =
  'w-full h-9 rounded-md border border-input bg-background px-3 text-sm';

interface ContactOption {
  id: string;
  name: string;
  position?: string | null;
}

interface UserOption {
  id: string;
  name: string;
}

interface ActivityCreateModalProps {
  open: boolean;
  onClose: () => void;
  leadId: string;
  /** Empresa vinculada ao lead — filtra os contatos elegíveis a participante. */
  companyId?: string | null;
  /** Tipo pré-selecionado ao abrir (ex.: "+ Tarefa" do card Próximas ações). */
  initialKind?: ActivityKind;
  /** Notifica o pai para recarregar timeline ('interaction') ou tarefas ('task'). */
  onCreated: (kind: 'interaction' | 'task') => void;
}

function nowLocalInput(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function ActivityCreateModal({
  open,
  onClose,
  leadId,
  companyId,
  initialKind,
  onCreated,
}: ActivityCreateModalProps) {
  const [kind, setKind] = useState<ActivityKind>('MEETING');
  const [saving, setSaving] = useState(false);

  // Reunião / Ligação
  const [location, setLocation] = useState('');
  const [modality, setModality] = useState<MeetingModality | ''>('');
  const [direction, setDirection] = useState<'INBOUND' | 'OUTBOUND'>('OUTBOUND');
  const [callReason, setCallReason] = useState<CallReason | ''>('');
  const [occurredAt, setOccurredAt] = useState(nowLocalInput());
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Participantes
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [showNewContact, setShowNewContact] = useState(false);
  const [creatingContact, setCreatingContact] = useState(false);
  const [newContact, setNewContact] = useState({ name: '', position: '', email: '', phone: '' });

  // Tarefa
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [dueDate, setDueDate] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [taskStatus, setTaskStatus] = useState('PENDING');
  const [taskType, setTaskType] = useState('');
  const [users, setUsers] = useState<UserOption[]>([]);

  // Reset ao abrir
  useEffect(() => {
    if (open) {
      setKind(initialKind ?? 'MEETING');
      setLocation('');
      setModality('');
      setDirection('OUTBOUND');
      setCallReason('');
      setOccurredAt(nowLocalInput());
      setContent('');
      setFiles([]);
      setParticipantIds([]);
      setShowNewContact(false);
      setNewContact({ name: '', position: '', email: '', phone: '' });
      setTitle('');
      setPriority('MEDIUM');
      setDueDate('');
      setAssignedTo('');
      setTaskStatus('PENDING');
      setTaskType('');
    }
  }, [open, initialKind]);

  // Contatos da empresa do lead (participantes). Lead sem empresa: todos os
  // contatos do tenant (caso extremo 1 da spec).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        setLoadingContacts(true);
        const filters: Record<string, string | number> = { isContact: 'true', limit: 100 };
        if (companyId) filters.companyId = companyId;
        const result = await apiClient.getLeads(filters);
        if (!cancelled) {
          setContacts(
            ((result.leads as unknown as ContactOption[]) || []).map((c) => ({
              id: c.id,
              name: c.name,
              position: c.position ?? null,
            }))
          );
        }
      } catch {
        if (!cancelled) setContacts([]);
      } finally {
        if (!cancelled) setLoadingContacts(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, companyId]);

  // Usuários do tenant (responsável da tarefa)
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiClient
      .getUsers()
      .then((list) => {
        if (!cancelled) setUsers(list.map((u) => ({ id: u.id, name: u.name })));
      })
      .catch(() => {
        if (!cancelled) setUsers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const toggleParticipant = (contactId: string) => {
    setParticipantIds((prev) =>
      prev.includes(contactId) ? prev.filter((p) => p !== contactId) : [...prev, contactId]
    );
  };

  const handleCreateContact = async () => {
    if (!companyId || !newContact.name.trim() || creatingContact) return;
    try {
      setCreatingContact(true);
      const res = await apiClient.createLeadContact({
        name: newContact.name.trim(),
        companyId,
        position: newContact.position.trim() || undefined,
        email: newContact.email.trim() || undefined,
        phone: newContact.phone.trim() || undefined,
      });
      const contact = res.data as { id: string; name: string; position?: string | null };
      setContacts((prev) => [...prev, { id: contact.id, name: contact.name, position: contact.position ?? null }]);
      setParticipantIds((prev) => [...prev, contact.id]);
      setShowNewContact(false);
      setNewContact({ name: '', position: '', email: '', phone: '' });
      toast.success('Contato criado e adicionado aos participantes.');
    } catch (err: unknown) {
      // Limite do plano / permissão: mostra o erro sem perder o estado do
      // formulário principal (caso extremo 6 da spec).
      toast.error(err instanceof Error && err.message ? err.message : 'Erro ao criar contato');
    } finally {
      setCreatingContact(false);
    }
  };

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    e.target.value = '';
    const accepted: File[] = [];
    for (const f of list) {
      if (f.size > MAX_FILE_BYTES) {
        toast.error(`"${f.name}" excede o limite de 25 MB.`);
        continue;
      }
      accepted.push(f);
    }
    if (accepted.length > 0) setFiles((prev) => [...prev, ...accepted]);
  };

  const canSubmit =
    kind === 'TASK'
      ? title.trim().length > 0
      : content.trim().length > 0 &&
        occurredAt.length > 0 &&
        (kind !== 'CALL' || callReason !== '');

  const handleSubmit = async () => {
    if (saving || !canSubmit) return;
    try {
      setSaving(true);

      if (kind === 'TASK') {
        await apiClient.createTask({
          leadId,
          title: title.trim(),
          priority,
          status: taskStatus,
          dueDate: dueDate ? new Date(`${dueDate}T12:00:00`).toISOString() : undefined,
          assignedTo: assignedTo || undefined,
          type: taskType || undefined,
        });
        toast.success('Tarefa criada!');
        onCreated('task');
        onClose();
        return;
      }

      const payload: Record<string, unknown> = {
        leadId,
        type: kind,
        direction: kind === 'CALL' ? direction : 'OUTBOUND',
        content: content.trim(),
        occurredAt: new Date(occurredAt).toISOString(),
      };
      if (kind === 'MEETING') {
        if (location.trim()) payload.location = location.trim();
        if (modality) payload.modality = modality;
      } else if (callReason) {
        payload.callReason = callReason;
      }
      if (participantIds.length > 0) payload.participantIds = participantIds;

      const created = await apiClient.createInteraction(payload);
      const interactionId = (created as { id?: string }).id;

      // Anexos da reunião vinculados à atividade criada (req. 40)
      if (kind === 'MEETING' && files.length > 0 && interactionId) {
        for (const file of files) {
          try {
            await apiClient.uploadAttachment(file, { interactionId });
          } catch (err: unknown) {
            toast.error(
              `Falha ao anexar "${file.name}"${
                err instanceof Error && err.message ? `: ${err.message}` : ''
              }`
            );
          }
        }
      }

      toast.success(kind === 'MEETING' ? 'Reunião registrada!' : 'Ligação registrada!');
      onCreated('interaction');
      onClose();
    } catch (err: unknown) {
      // 400 de validação Zod do backend chega aqui com a mensagem da API —
      // o modal permanece aberto e nenhum campo é perdido.
      toast.error(err instanceof Error && err.message ? err.message : 'Erro ao salvar atividade');
    } finally {
      setSaving(false);
    }
  };

  const participantsBlock = (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Participantes</Label>
        {companyId && (
          <button
            type="button"
            onClick={() => setShowNewContact((v) => !v)}
            className="text-xs text-primary hover:underline font-medium inline-flex items-center gap-1"
          >
            <UserPlus size={12} aria-hidden="true" />
            {showNewContact ? 'Fechar cadastro' : 'Novo contato'}
          </button>
        )}
      </div>
      {!companyId && (
        <p className="text-xs text-gray-400">
          Lead sem empresa vinculada — exibindo todos os contatos.
        </p>
      )}
      {showNewContact && companyId && (
        <div className="p-3 rounded-lg border border-gray-200 bg-gray-50 space-y-2">
          <Input
            placeholder="Nome do contato *"
            value={newContact.name}
            onChange={(e) => setNewContact((c) => ({ ...c, name: e.target.value }))}
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="Cargo"
              value={newContact.position}
              onChange={(e) => setNewContact((c) => ({ ...c, position: e.target.value }))}
            />
            <Input
              placeholder="Telefone"
              value={newContact.phone}
              onChange={(e) => setNewContact((c) => ({ ...c, phone: e.target.value }))}
            />
          </div>
          <Input
            type="email"
            placeholder="E-mail"
            value={newContact.email}
            onChange={(e) => setNewContact((c) => ({ ...c, email: e.target.value }))}
          />
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              onClick={handleCreateContact}
              disabled={!newContact.name.trim() || creatingContact}
            >
              {creatingContact && <Loader2 size={14} className="mr-2 animate-spin" />}
              Salvar contato
            </Button>
          </div>
        </div>
      )}
      {loadingContacts ? (
        <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
          <Loader2 size={14} className="animate-spin" /> Carregando contatos…
        </div>
      ) : contacts.length === 0 ? (
        <p className="text-xs text-gray-400">Nenhum contato disponível.</p>
      ) : (
        <div className="max-h-36 overflow-y-auto rounded-md border border-input divide-y divide-gray-100">
          {contacts.map((contact) => (
            <label
              key={contact.id}
              className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-50"
            >
              <input
                type="checkbox"
                checked={participantIds.includes(contact.id)}
                onChange={() => toggleParticipant(contact.id)}
                className="rounded border-gray-300"
              />
              <span className="truncate">{contact.name}</span>
              {contact.position && (
                <span className="text-xs text-gray-400 truncate">· {contact.position}</span>
              )}
            </label>
          ))}
        </div>
      )}
    </div>
  );

  const occurredAtBlock = (
    <div className="space-y-2">
      <Label htmlFor="activity-occurred-at">Data/hora do evento</Label>
      <Input
        id="activity-occurred-at"
        type="datetime-local"
        value={occurredAt}
        onChange={(e) => setOccurredAt(e.target.value)}
      />
    </div>
  );

  const contentBlock = (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor="activity-content">Assuntos tratados *</Label>
        {/* Entrada por áudio (req. 44) — texto transcrito é ADITIVO ao digitado */}
        <AudioTranscribeButton
          disabled={saving}
          onTranscribed={(text) => setContent((prev) => (prev ? `${prev}\n${text}` : text))}
        />
      </div>
      <Textarea
        id="activity-content"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Resumo do que foi tratado…"
        rows={4}
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova atividade</DialogTitle>
          <DialogDescription>
            Registre uma reunião, uma ligação ou crie uma tarefa para este lead.
          </DialogDescription>
        </DialogHeader>

        {/* Seletor de tipo (req. 35) */}
        <div className="grid grid-cols-3 gap-1 rounded-md border border-input p-1 bg-background">
          {(Object.keys(KIND_LABELS) as ActivityKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`h-8 rounded text-sm font-medium transition-colors ${
                kind === k
                  ? 'bg-primary text-primary-foreground'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {KIND_LABELS[k]}
            </button>
          ))}
        </div>

        {kind === 'MEETING' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="meeting-location">Local</Label>
                <Input
                  id="meeting-location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Ex.: escritório do cliente"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="meeting-modality">Modalidade</Label>
                <select
                  id="meeting-modality"
                  className={SELECT_CLASS}
                  value={modality}
                  onChange={(e) => setModality(e.target.value as MeetingModality | '')}
                >
                  <option value="">Selecione…</option>
                  {(Object.entries(MODALITY_LABELS) as Array<[MeetingModality, string]>).map(
                    ([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    )
                  )}
                </select>
              </div>
            </div>
            {participantsBlock}
            {occurredAtBlock}
            {contentBlock}
            {/* Anexos (req. 40) */}
            <div className="space-y-2">
              <Label>Anexos</Label>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFiles}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip size={14} />
                Adicionar arquivos
              </Button>
              {files.length > 0 && (
                <ul className="space-y-1">
                  {files.map((file, index) => (
                    <li
                      key={`${file.name}-${index}`}
                      className="flex items-center gap-2 text-xs text-gray-600 px-2 py-1 rounded border border-gray-200"
                    >
                      <Paperclip size={12} className="text-gray-400 flex-shrink-0" />
                      <span className="truncate flex-1">{file.name}</span>
                      <span className="text-gray-400 flex-shrink-0">
                        {(file.size / (1024 * 1024)).toFixed(1)} MB
                      </span>
                      <button
                        type="button"
                        onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
                        className="text-gray-400 hover:text-red-600"
                        title="Remover anexo"
                      >
                        <X size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {kind === 'CALL' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="call-direction">Direção</Label>
                <select
                  id="call-direction"
                  className={SELECT_CLASS}
                  value={direction}
                  onChange={(e) => setDirection(e.target.value as 'INBOUND' | 'OUTBOUND')}
                >
                  <option value="OUTBOUND">Realizada</option>
                  <option value="INBOUND">Recebida</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="call-reason">Motivo da ligação *</Label>
                <select
                  id="call-reason"
                  className={SELECT_CLASS}
                  value={callReason}
                  onChange={(e) => setCallReason(e.target.value as CallReason | '')}
                >
                  <option value="">Selecione…</option>
                  {(Object.entries(CALL_REASON_LABELS) as Array<[CallReason, string]>).map(
                    ([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    )
                  )}
                </select>
              </div>
            </div>
            {participantsBlock}
            {occurredAtBlock}
            {contentBlock}
          </div>
        )}

        {kind === 'TASK' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="task-title">Título *</Label>
              <Input
                id="task-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex.: enviar proposta comercial"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="task-priority">Prioridade</Label>
                <select
                  id="task-priority"
                  className={SELECT_CLASS}
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                >
                  {TASK_PRIORITY_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="task-due-date">Vencimento</Label>
                <Input
                  id="task-due-date"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="task-assigned">Responsável</Label>
                <select
                  id="task-assigned"
                  className={SELECT_CLASS}
                  value={assignedTo}
                  onChange={(e) => setAssignedTo(e.target.value)}
                >
                  <option value="">Sem responsável</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="task-status">Status</Label>
                <select
                  id="task-status"
                  className={SELECT_CLASS}
                  value={taskStatus}
                  onChange={(e) => setTaskStatus(e.target.value)}
                >
                  {TASK_STATUS_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-type">Tipo da tarefa</Label>
              <select
                id="task-type"
                className={SELECT_CLASS}
                value={taskType}
                onChange={(e) => setTaskType(e.target.value)}
              >
                <option value="">Selecione…</option>
                {TASK_TYPE_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit || saving}>
            {saving && <Loader2 size={14} className="mr-2 animate-spin" />}
            {kind === 'TASK' ? 'Criar tarefa' : 'Registrar atividade'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
