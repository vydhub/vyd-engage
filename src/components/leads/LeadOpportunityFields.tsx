import { useQuery } from '@tanstack/react-query';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { apiClient } from '../../services/api/client';
import { AudioTranscribeButton } from '../AudioTranscribeButton';
import { CompanyQuickSelect } from './CompanyQuickSelect';
import { ContactQuickSelect } from './ContactQuickSelect';
import {
  GO_GET_STEPS,
  LEAD_SOURCE_LABELS,
  LEAD_STATUS_LABELS,
  LEAD_STATUS_REASON_LABELS,
  Lead,
  LeadSource,
  LeadStatus,
  LeadStatusReason,
  TERMINAL_LEAD_STATUSES,
} from '../../types';

/**
 * Conjunto ÚNICO de campos do lead-oportunidade (specs/leads-oportunidade
 * req. 11), compartilhado pela página LeadForm e pelo LeadModal do Kanban:
 * Nome (título da oportunidade), Empresa*, Contato*, Status, Origem,
 * Informações da oportunidade (com entrada por áudio — req. 44), Valor
 * estimado, Prazo estimado, Probabilidade Go×Get e Responsável comercial.
 *
 * Componente controlado (value/onChange — estado vive no pai). Regras:
 * - Trocar a empresa limpa o contato selecionado (caso extremo 2).
 * - Status terminal (PAUSADO/CANCELADO/ENCERRADO) exibe inline Motivo* e Nota
 *   (obrigatória quando o motivo é OUTRO) — reqs. 13-14; valide no submit com
 *   `validateLeadOpportunityValues`.
 * - Em edição de lead legado sem empresa/contato, exibe o aviso "Vínculo
 *   pendente" sem bloquear o salvamento (caso extremo 1).
 */

export interface LeadOpportunityValues {
  name: string;
  companyId: string;
  contactId: string;
  status: LeadStatus;
  source: LeadSource;
  /** Informações da oportunidade (persistidas em Lead.notes — req. 9). */
  notes: string;
  /** Valor estimado mascarado em pt-BR (ex.: "1.234,56"); converta com parseCurrencyBRL. */
  estimatedValue: string;
  estimatedTimeline: string;
  probabilityGoGet: number | null;
  assignedTo: string;
  statusReason: LeadStatusReason | '';
  statusReasonNote: string;
}

const NENHUM = '__none__';
const MAX_DIGITOS_MOEDA = 12; // Decimal(12,2) no banco

/** Máscara simples de moeda: dígitos → "1.234,56" (centavos implícitos). */
export function maskCurrencyBRL(raw: string): string {
  const digits = raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, MAX_DIGITOS_MOEDA);
  if (!digits) return '';
  const n = Number(digits) / 100;
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Converte o valor mascarado ("1.234,56") em número para a API; vazio → null. */
export function parseCurrencyBRL(masked: string): number | null {
  const t = masked.trim();
  if (!t) return null;
  const n = Number(t.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Formata um valor vindo da API (number|string) para a máscara pt-BR. */
export function formatCurrencyBRL(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const STATUS_VALIDOS = Object.keys(LEAD_STATUS_LABELS) as LeadStatus[];
const ORIGENS_VALIDAS = Object.keys(LEAD_SOURCE_LABELS) as LeadSource[];

export function emptyLeadOpportunityValues(): LeadOpportunityValues {
  return {
    name: '',
    companyId: '',
    contactId: '',
    status: 'NOVO',
    source: 'PROSPECCAO_ATIVA',
    notes: '',
    estimatedValue: '',
    estimatedTimeline: '',
    probabilityGoGet: null,
    assignedTo: '',
    statusReason: '',
    statusReasonNote: '',
  };
}

/** Inicializa os valores do formulário a partir de um lead existente. */
export function leadToOpportunityValues(lead: Partial<Lead>): LeadOpportunityValues {
  const status = STATUS_VALIDOS.includes(lead.status as LeadStatus)
    ? (lead.status as LeadStatus)
    : 'NOVO';
  const source = ORIGENS_VALIDAS.includes(lead.source as LeadSource)
    ? (lead.source as LeadSource)
    : 'OUTROS';
  return {
    name: lead.name || '',
    companyId: lead.companyId || '',
    contactId: lead.contactId || '',
    status,
    source,
    notes: lead.notes || '',
    estimatedValue: formatCurrencyBRL(lead.estimatedValue),
    estimatedTimeline: lead.estimatedTimeline || '',
    probabilityGoGet: lead.probabilityGoGet ?? null,
    assignedTo: lead.assignedTo || '',
    statusReason: (lead.statusReason as LeadStatusReason) || '',
    statusReasonNote: lead.statusReasonNote || '',
  };
}

/**
 * Validação de submit. Em 'create' Empresa e Contato são obrigatórios (req. 1);
 * em 'edit' não são (lead legado permanece editável — caso extremo 1). Status
 * terminal sempre exige motivo (e nota quando OUTRO) — reqs. 13-14.
 */
export function validateLeadOpportunityValues(
  values: LeadOpportunityValues,
  mode: 'create' | 'edit'
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!values.name.trim()) errors.name = 'Informe o nome da oportunidade';
  if (mode === 'create') {
    if (!values.companyId) errors.companyId = 'Selecione a empresa';
    if (!values.contactId) errors.contactId = 'Selecione o contato';
  }
  if (TERMINAL_LEAD_STATUSES.includes(values.status)) {
    if (!values.statusReason) {
      errors.statusReason = `Informe o motivo para ${LEAD_STATUS_LABELS[values.status]}`;
    } else if (values.statusReason === 'OUTRO' && !values.statusReasonNote.trim()) {
      errors.statusReasonNote = 'A nota é obrigatória quando o motivo é "Outro"';
    }
  }
  return errors;
}

/** Monta o payload de create/update (useLeads.createLead/updateLead). */
export function opportunityValuesToLeadPayload(values: LeadOpportunityValues): Partial<Lead> {
  const terminal = TERMINAL_LEAD_STATUSES.includes(values.status);
  return {
    name: values.name.trim(),
    companyId: values.companyId || undefined,
    contactId: values.contactId || undefined,
    status: values.status,
    source: values.source,
    notes: values.notes,
    estimatedValue: parseCurrencyBRL(values.estimatedValue),
    estimatedTimeline: values.estimatedTimeline,
    probabilityGoGet: values.probabilityGoGet,
    assignedTo: values.assignedTo || undefined,
    statusReason: terminal && values.statusReason ? values.statusReason : undefined,
    statusReasonNote:
      terminal && values.statusReasonNote.trim() ? values.statusReasonNote.trim() : undefined,
  };
}

interface LeadOpportunityFieldsProps {
  value: LeadOpportunityValues;
  onChange: (value: LeadOpportunityValues) => void;
  /** 'create' exige Empresa/Contato; 'edit' mostra "Vínculo pendente" sem bloquear. */
  mode: 'create' | 'edit';
  errors?: Record<string, string>;
  /** Prefixo dos ids dos campos (evita colisão página × modal). */
  idPrefix?: string;
}

function FieldMsg({ id, error }: { id: string; error?: string }) {
  if (!error) return null;
  return (
    <p id={id} className="mt-1 text-xs text-destructive">
      {error}
    </p>
  );
}

const REASON_OPTIONS = Object.entries(LEAD_STATUS_REASON_LABELS) as Array<
  [LeadStatusReason, string]
>;

export function LeadOpportunityFields({
  value,
  onChange,
  mode,
  errors = {},
  idPrefix = 'lead',
}: LeadOpportunityFieldsProps) {
  const set = (patch: Partial<LeadOpportunityValues>) => onChange({ ...value, ...patch });

  const terminal = TERMINAL_LEAD_STATUSES.includes(value.status);
  const vinculoPendente = mode === 'edit' && (!value.companyId || !value.contactId);

  const usersQuery = useQuery({
    queryKey: ['users', 'assign-select'],
    queryFn: async () => {
      const raw = (await apiClient.getUsers()) as unknown;
      const list = Array.isArray(raw)
        ? raw
        : (((raw as { data?: unknown[] })?.data ?? []) as unknown[]);
      return (list as Array<{ id: string; name: string }>).map((u) => ({
        id: u.id,
        name: u.name,
      }));
    },
    staleTime: 5 * 60_000,
  });
  const users = usersQuery.data ?? [];

  const handleCompanyChange = (companyId: string) => {
    // Trocar a empresa limpa o contato (caso extremo 2): o contato pertence à empresa.
    if (companyId !== value.companyId) set({ companyId, contactId: '' });
    else set({ companyId });
  };

  const handleStatusChange = (status: LeadStatus) => {
    if (TERMINAL_LEAD_STATUSES.includes(status)) {
      set({ status });
    } else {
      // Voltar para NOVO/EM_ANDAMENTO limpa o motivo (req. 16).
      set({ status, statusReason: '', statusReasonNote: '' });
    }
  };

  const appendTranscricao = (texto: string) => {
    const atual = value.notes.replace(/\s+$/, '');
    set({ notes: atual ? `${atual}\n${texto}` : texto });
  };

  return (
    <div className="space-y-4">
      {vinculoPendente && (
        <div className="flex items-start gap-3 rounded-md border border-border bg-muted/50 p-3">
          <Badge variant="outline" className="shrink-0">
            Vínculo pendente
          </Badge>
          <p className="text-xs text-muted-foreground">
            Este lead ainda não tem empresa e contato vinculados. Você pode salvar as demais
            alterações normalmente — vincular é recomendado.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor={`${idPrefix}-name`}>Nome da oportunidade *</Label>
          <Input
            id={`${idPrefix}-name`}
            value={value.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="Ex.: Expansão da planta de beneficiamento"
            className="mt-1.5"
            aria-describedby={errors.name ? `${idPrefix}-name-error` : undefined}
          />
          <FieldMsg id={`${idPrefix}-name-error`} error={errors.name} />
        </div>

        <div>
          <Label htmlFor={`${idPrefix}-company`}>
            Empresa {mode === 'create' ? '*' : ''}
          </Label>
          <div className="mt-1.5">
            <CompanyQuickSelect
              id={`${idPrefix}-company`}
              value={value.companyId || undefined}
              onChange={handleCompanyChange}
            />
          </div>
          <FieldMsg id={`${idPrefix}-company-error`} error={errors.companyId} />
        </div>

        <div>
          <Label htmlFor={`${idPrefix}-contact`}>
            Contato {mode === 'create' ? '*' : ''}
          </Label>
          <div className="mt-1.5">
            <ContactQuickSelect
              id={`${idPrefix}-contact`}
              companyId={value.companyId || undefined}
              value={value.contactId || undefined}
              onChange={(contactId) => set({ contactId })}
            />
          </div>
          <FieldMsg id={`${idPrefix}-contact-error`} error={errors.contactId} />
        </div>

        <div>
          <Label htmlFor={`${idPrefix}-status`}>Status</Label>
          <Select value={value.status} onValueChange={(v) => handleStatusChange(v as LeadStatus)}>
            <SelectTrigger id={`${idPrefix}-status`} className="mt-1.5 w-full">
              <SelectValue placeholder="Selecione o status" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_VALIDOS.map((s) => (
                <SelectItem key={s} value={s}>
                  {LEAD_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor={`${idPrefix}-source`}>Origem</Label>
          <Select value={value.source} onValueChange={(v) => set({ source: v as LeadSource })}>
            <SelectTrigger id={`${idPrefix}-source`} className="mt-1.5 w-full">
              <SelectValue placeholder="Selecione a origem" />
            </SelectTrigger>
            <SelectContent>
              {ORIGENS_VALIDAS.map((s) => (
                <SelectItem key={s} value={s}>
                  {LEAD_SOURCE_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {terminal && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-md border border-border bg-muted/50 p-3">
          <div>
            <Label htmlFor={`${idPrefix}-status-reason`}>Motivo *</Label>
            <Select
              value={value.statusReason || undefined}
              onValueChange={(v) => set({ statusReason: v as LeadStatusReason })}
            >
              <SelectTrigger id={`${idPrefix}-status-reason`} className="mt-1.5 w-full">
                <SelectValue
                  placeholder={`Motivo para ${LEAD_STATUS_LABELS[value.status]}`}
                />
              </SelectTrigger>
              <SelectContent>
                {REASON_OPTIONS.map(([v, label]) => (
                  <SelectItem key={v} value={v}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldMsg id={`${idPrefix}-status-reason-error`} error={errors.statusReason} />
          </div>
          <div>
            <Label htmlFor={`${idPrefix}-status-reason-note`}>
              Nota {value.statusReason === 'OUTRO' ? '*' : '(opcional)'}
            </Label>
            <Textarea
              id={`${idPrefix}-status-reason-note`}
              value={value.statusReasonNote}
              onChange={(e) => set({ statusReasonNote: e.target.value })}
              placeholder={
                value.statusReason === 'OUTRO'
                  ? 'Descreva o motivo (obrigatório para "Outro")'
                  : 'Detalhes adicionais'
              }
              rows={2}
              maxLength={2000}
              className="mt-1.5"
            />
            <FieldMsg
              id={`${idPrefix}-status-reason-note-error`}
              error={errors.statusReasonNote}
            />
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={`${idPrefix}-notes`}>Informações da oportunidade</Label>
          <AudioTranscribeButton onTranscribed={appendTranscricao} />
        </div>
        <Textarea
          id={`${idPrefix}-notes`}
          value={value.notes}
          onChange={(e) => set({ notes: e.target.value })}
          placeholder="Contexto, escopo, dores do cliente, próximos passos…"
          className="mt-1.5"
          rows={4}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor={`${idPrefix}-estimated-value`}>Valor estimado (Budget)</Label>
          <div className="relative mt-1.5">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
              R$
            </span>
            <Input
              id={`${idPrefix}-estimated-value`}
              inputMode="numeric"
              value={value.estimatedValue}
              onChange={(e) => set({ estimatedValue: maskCurrencyBRL(e.target.value) })}
              placeholder="0,00"
              className="pl-9"
            />
          </div>
        </div>

        <div>
          <Label htmlFor={`${idPrefix}-estimated-timeline`}>Prazo estimado</Label>
          <Input
            id={`${idPrefix}-estimated-timeline`}
            value={value.estimatedTimeline}
            onChange={(e) => set({ estimatedTimeline: e.target.value })}
            placeholder="Ex.: 6 meses, 2º semestre de 2027"
            className="mt-1.5"
          />
        </div>

        <div>
          <Label htmlFor={`${idPrefix}-probability`}>Probabilidade Go×Get</Label>
          <Select
            value={value.probabilityGoGet != null ? String(value.probabilityGoGet) : NENHUM}
            onValueChange={(v) => set({ probabilityGoGet: v === NENHUM ? null : Number(v) })}
          >
            <SelectTrigger id={`${idPrefix}-probability`} className="mt-1.5 w-full">
              <SelectValue placeholder="Não definida" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NENHUM}>Não definida</SelectItem>
              {GO_GET_STEPS.map((p) => (
                <SelectItem key={p} value={String(p)}>
                  {p}%
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor={`${idPrefix}-assigned`}>Responsável comercial</Label>
          <Select
            value={value.assignedTo || NENHUM}
            onValueChange={(v) => set({ assignedTo: v === NENHUM ? '' : v })}
          >
            <SelectTrigger id={`${idPrefix}-assigned`} className="mt-1.5 w-full">
              <SelectValue placeholder="Nenhum" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NENHUM}>Nenhum</SelectItem>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
