import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AvisoFlow } from './AvisoFlow';
import { Deal, DealStage, CustomField } from '../../types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Loader2, Search, Star } from 'lucide-react';
import { apiClient, ConfigItem } from '../../services/api/client';
import { CustomFieldInput } from '../CustomFieldInput';
import { FieldError } from '../register/FieldError';
import { dealFormSchema } from '../../utils/validation/formSchemas';
import { useFormValidation } from '../../hooks/useFormValidation';
import { useAutoFocus, useFocusReturn } from '../../hooks/useFocusManagement';
import { useAuth } from '../../contexts/AuthContext';
import { valorControladoPeloFlow } from '../../types/captura';

const STAGES: { value: DealStage; label: string }[] = [
  { value: 'QUALIFICATION', label: 'Qualificação' },
  { value: 'PROPOSAL', label: 'Proposta' },
  { value: 'NEGOTIATION', label: 'Negociação' },
  { value: 'CLOSING', label: 'Fechamento' },
  { value: 'WON', label: 'Ganho' },
  { value: 'LOST', label: 'Perdido' },
];

interface DealFormProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: any) => Promise<void>;
  deal?: Deal | null;
  defaultLeadId?: string;
  defaultFunnelId?: string;
}

export function DealForm({
  open,
  onClose,
  onSave,
  deal,
  defaultLeadId,
  defaultFunnelId,
}: DealFormProps) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [stage, setStage] = useState<DealStage>('QUALIFICATION');
  const [probability, setProbability] = useState('20');
  const [expectedCloseDate, setExpectedCloseDate] = useState('');
  const [leadId, setLeadId] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [notes, setNotes] = useState('');
  const [lostReason, setLostReason] = useState('');
  const [funnelId, setFunnelId] = useState('');
  const [qualification, setQualification] = useState<number>(0);
  const [sourceId, setSourceId] = useState('');
  const [originCampaignId, setOriginCampaignId] = useState('');
  const [oneTimeValue, setOneTimeValue] = useState('');
  const [recurringValue, setRecurringValue] = useState('');
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomField[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});
  const [sources, setSources] = useState<ConfigItem[]>([]);
  const [campaigns, setCampaigns] = useState<ConfigItem[]>([]);
  const [saving, setSaving] = useState(false);
  // Analista (USER) só pode atribuir a si mesmo — campo Responsável travado (req 8).
  const { user: currentUser } = useAuth();
  const isAnalyst = currentUser?.role === 'USER';
  const valorDoFlow = valorControladoPeloFlow(deal?.demanda);
  const {
    fieldErrors,
    touchedFields,
    handleBlur,
    handleChange,
    validateAll,
    resetValidation,
    formRef,
  } = useFormValidation({ schema: dealFormSchema });
  const autoFocusRef = useAutoFocus<HTMLFormElement>(open, 200);
  const { saveTrigger, returnFocus } = useFocusReturn();

  const [leads, setLeads] = useState<Array<{ id: string; name: string }>>([]);
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([]);
  const [dealFunnels, setDealFunnels] = useState<
    Array<{ id: string; name: string; isDefault: boolean }>
  >([]);
  const [leadSearch, setLeadSearch] = useState('');
  const [loadingLeads, setLoadingLeads] = useState(false);
  const leadSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchLeads = useCallback(async (search?: string) => {
    try {
      setLoadingLeads(true);
      const filters: any = { limit: 50 };
      if (search?.trim()) filters.search = search.trim();
      const res = await apiClient.getLeads(filters);
      setLeads(res.leads?.map((l: any) => ({ id: l.id, name: l.name })) || []);
    } catch {
      // silent
    } finally {
      setLoadingLeads(false);
    }
  }, []);

  // Save trigger element when dialog opens, return focus when it closes
  useEffect(() => {
    if (open) {
      saveTrigger();
      resetValidation();
    } else {
      returnFocus();
    }
  }, [open, saveTrigger, returnFocus, resetValidation]);

  useEffect(() => {
    if (open) {
      // Load leads (initial), users, and deal funnels for selects
      fetchLeads();
      apiClient
        .getUsers()
        .then((res) => {
          const userList = Array.isArray(res) ? res : res.data || [];
          setUsers(userList.map((u: any) => ({ id: u.id, name: u.name })));
        })
        .catch(() => {});
      apiClient
        .getFunnels('DEAL')
        .then((res) => {
          const funnelList: any[] = (res as any).data || res || [];
          setDealFunnels(
            funnelList.map((f: any) => ({ id: f.id, name: f.name, isDefault: f.isDefault }))
          );
        })
        .catch(() => {});
    } else {
      setLeadSearch('');
    }
  }, [open, fetchLeads]);

  useEffect(() => {
    if (!open) return;
    if (leadSearchTimerRef.current) clearTimeout(leadSearchTimerRef.current);
    leadSearchTimerRef.current = setTimeout(() => {
      fetchLeads(leadSearch);
    }, 300);
    return () => {
      if (leadSearchTimerRef.current) clearTimeout(leadSearchTimerRef.current);
    };
  }, [leadSearch, open, fetchLeads]);

  useEffect(() => {
    if (deal) {
      const d = deal as unknown as Record<string, unknown>;
      setName(deal.name);
      setValue(String(deal.value));
      setStage(deal.stage);
      setProbability(String(deal.probability));
      setExpectedCloseDate(deal.expectedCloseDate ? deal.expectedCloseDate.split('T')[0] : '');
      setLeadId(deal.leadId || '');
      setAssignedTo(deal.assignedTo || '');
      setNotes(deal.notes || '');
      setLostReason(deal.lostReason || '');
      setFunnelId(deal.funnelId || '');
      setQualification(typeof d.qualification === 'number' ? (d.qualification as number) : 0);
      setSourceId((d.sourceId as string) || '');
      setOriginCampaignId((d.originCampaignId as string) || '');
      setOneTimeValue(d.oneTimeValue != null ? String(d.oneTimeValue) : '');
      setRecurringValue(d.recurringValue != null ? String(d.recurringValue) : '');
      setCustomFieldValues((d.customFields as Record<string, unknown>) || {});
    } else {
      setName('');
      setValue('');
      setStage('QUALIFICATION');
      setProbability('20');
      setExpectedCloseDate('');
      setLeadId(defaultLeadId || '');
      setAssignedTo(isAnalyst && currentUser ? currentUser.id : '');
      setNotes('');
      setLostReason('');
      setFunnelId(defaultFunnelId || '');
      setQualification(0);
      setSourceId('');
      setOriginCampaignId('');
      setOneTimeValue('');
      setRecurringValue('');
      setCustomFieldValues({});
    }
  }, [deal, open, defaultLeadId, defaultFunnelId]);

  // Carrega fontes e campanhas de origem configuráveis (reqs 14/18) quando o form abre.
  useEffect(() => {
    if (!open) return;
    apiClient
      .getDealSources(true)
      .then((r) => setSources(r.data || []))
      .catch(() => {});
    apiClient
      .getOriginCampaigns(true)
      .then((r) => setCampaigns(r.data || []))
      .catch(() => {});
    // Campos personalizados da entidade Negociação (reqs 8, 12) — render por entidade.
    apiClient
      .getCustomFields(true, 'DEAL')
      .then((raw) =>
        setCustomFieldDefs(
          (raw || []).map((f: any) => ({
            id: f.id,
            name: f.name,
            type: f.type,
            options: Array.isArray(f.options) ? f.options : undefined,
            required: !!f.required,
            entity: f.entity ?? null,
          }))
        )
      )
      .catch(() => {});
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const isValid = validateAll({
      name,
      value,
      stage,
      probability,
      expectedCloseDate,
      leadId,
      assignedTo,
      notes,
      lostReason,
      funnelId,
    });
    if (!isValid) return;

    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        value: parseFloat(value),
        stage,
        probability: parseInt(probability),
        expectedCloseDate: expectedCloseDate || undefined,
        leadId: leadId || null,
        assignedTo: assignedTo || null,
        notes: notes.trim() || undefined,
        lostReason: stage === 'LOST' ? lostReason.trim() || undefined : undefined,
        funnelId: funnelId || null,
        qualification: qualification > 0 ? qualification : null,
        sourceId: sourceId || null,
        originCampaignId: originCampaignId || null,
        oneTimeValue: oneTimeValue !== '' ? parseFloat(oneTimeValue) : null,
        recurringValue: recurringValue !== '' ? parseFloat(recurringValue) : null,
        customFields: customFieldValues,
        // Via única (E-16): o andamento do Negócio da Captura não sai deste formulário. O
        // cartão do quadro nem traz o funil, e mandar vazio seria lido como mudança.
        ...(deal?.demanda ? { stage: undefined, lostReason: undefined, funnelId: undefined } : {}),
        ...(valorDoFlow ? { value: undefined } : {}),
      });
      onClose();
    } catch {
      // Error handled by parent
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{deal ? 'Editar Deal' : 'Novo Deal'}</DialogTitle>
        </DialogHeader>
        {deal?.demanda && <AvisoFlow demanda={deal.demanda} />}
        <form
          onSubmit={handleSubmit}
          className="space-y-4"
          ref={(el) => {
            (formRef as React.MutableRefObject<HTMLFormElement | null>).current = el;
            (autoFocusRef as React.MutableRefObject<HTMLFormElement | null>).current = el;
          }}
          noValidate
        >
          <div>
            <Label htmlFor="deal-name">Nome *</Label>
            <Input
              id="deal-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                handleChange('name', e.target.value);
              }}
              onBlur={() => handleBlur('name', name)}
              placeholder="Nome do negócio"
              error={touchedFields.name ? fieldErrors.name : undefined}
              aria-describedby={
                fieldErrors.name && touchedFields.name ? 'deal-name-error' : undefined
              }
            />
            <FieldError
              id="deal-name-error"
              error={fieldErrors.name as string}
              touched={touchedFields.name}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="deal-value">Valor (R$) *</Label>
              <Input
                id="deal-value"
                type="number"
                min="0"
                step="0.01"
                value={value}
                disabled={valorDoFlow}
                title={valorDoFlow ? 'O valor deste negócio vem do Flow' : undefined}
                onChange={(e) => {
                  setValue(e.target.value);
                  handleChange('value', e.target.value);
                }}
                onBlur={() => handleBlur('value', value)}
                placeholder="0.00"
                error={touchedFields.value ? fieldErrors.value : undefined}
                aria-describedby={
                  fieldErrors.value && touchedFields.value ? 'deal-value-error' : undefined
                }
              />
              <FieldError
                id="deal-value-error"
                error={fieldErrors.value as string}
                touched={touchedFields.value}
              />
            </div>
            <div>
              <Label htmlFor="deal-stage">Stage</Label>
              <Select
                value={stage}
                onValueChange={(v) => setStage(v as DealStage)}
                disabled={!!deal?.demanda}
              >
                <SelectTrigger id="deal-stage">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STAGES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="deal-probability">Probabilidade (%)</Label>
              <Input
                id="deal-probability"
                type="number"
                min="0"
                max="100"
                value={probability}
                onChange={(e) => setProbability(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="deal-close-date">Data de Fechamento</Label>
              <Input
                id="deal-close-date"
                type="date"
                value={expectedCloseDate}
                onChange={(e) => setExpectedCloseDate(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="deal-onetime">Valor único (R$)</Label>
              <Input
                id="deal-onetime"
                type="number"
                min="0"
                step="0.01"
                value={oneTimeValue}
                onChange={(e) => setOneTimeValue(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div>
              <Label htmlFor="deal-recurring">Valor recorrente (R$)</Label>
              <Input
                id="deal-recurring"
                type="number"
                min="0"
                step="0.01"
                value={recurringValue}
                onChange={(e) => setRecurringValue(e.target.value)}
                placeholder="0.00"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Qualificação</Label>
              <div className="mt-1 flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setQualification(n === qualification ? 0 : n)}
                    aria-label={`${n} estrela${n > 1 ? 's' : ''}`}
                    className="text-amber-700 hover:opacity-90"
                  >
                    <Star size={20} fill={n <= qualification ? 'currentColor' : 'none'} />
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label htmlFor="deal-source">Fonte</Label>
              <Select
                value={sourceId || 'none'}
                onValueChange={(v) => setSourceId(v === 'none' ? '' : v)}
              >
                <SelectTrigger id="deal-source">
                  <SelectValue placeholder="Nenhuma" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhuma</SelectItem>
                  {sources.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="deal-campaign">Campanha de origem</Label>
            <Select
              value={originCampaignId || 'none'}
              onValueChange={(v) => setOriginCampaignId(v === 'none' ? '' : v)}
            >
              <SelectTrigger id="deal-campaign">
                <SelectValue placeholder="Nenhuma" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhuma</SelectItem>
                {campaigns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="deal-lead">Lead Associado</Label>
              <Select
                value={leadId || 'none'}
                onValueChange={(v) => setLeadId(v === 'none' ? '' : v)}
              >
                <SelectTrigger id="deal-lead">
                  <SelectValue placeholder="Nenhum" />
                </SelectTrigger>
                <SelectContent>
                  <div className="px-2 pb-2">
                    <div className="relative">
                      <Search
                        size={14}
                        className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"
                        aria-hidden="true"
                      />
                      <input
                        type="text"
                        placeholder="Buscar lead..."
                        value={leadSearch}
                        onChange={(e) => setLeadSearch(e.target.value)}
                        className="w-full pl-7 pr-2 py-1.5 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-primary"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                        aria-label="Buscar lead associado"
                      />
                    </div>
                  </div>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {loadingLeads ? (
                    <div className="flex items-center justify-center py-2">
                      <Loader2 size={14} className="animate-spin text-gray-400" />
                    </div>
                  ) : leads.length === 0 ? (
                    <div className="px-2 py-2 text-xs text-gray-500 text-center">
                      Nenhum lead encontrado
                    </div>
                  ) : (
                    leads.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="deal-assigned">Responsável</Label>
              <Select
                value={assignedTo || 'none'}
                onValueChange={(v) => setAssignedTo(v === 'none' ? '' : v)}
                disabled={isAnalyst}
              >
                <SelectTrigger id="deal-assigned">
                  <SelectValue placeholder="Nenhum" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {dealFunnels.length > 0 && (
            <div>
              <Label htmlFor="deal-funnel">Pipeline</Label>
              <Select
                value={funnelId || 'none'}
                onValueChange={(v) => setFunnelId(v === 'none' ? '' : v)}
                disabled={!!deal?.demanda}
              >
                <SelectTrigger id="deal-funnel">
                  <SelectValue placeholder="Selecionar pipeline" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {dealFunnels.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                      {f.isDefault ? ' (Padrão)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label htmlFor="deal-notes">Notas</Label>
            <Textarea
              id="deal-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Observações sobre o negócio..."
              rows={3}
            />
          </div>

          {/* Campos personalizados da Negociação (reqs 8, 9, 12) */}
          {customFieldDefs.length > 0 && (
            <div className="space-y-4 border-t border-gray-200 pt-4">
              <p className="text-sm font-medium text-gray-700">Campos personalizados</p>
              {customFieldDefs.map((f) => (
                <CustomFieldInput
                  key={f.id}
                  field={f}
                  value={customFieldValues[f.id]}
                  onChange={(v) =>
                    setCustomFieldValues((prev) => ({ ...prev, [f.id]: v }))
                  }
                />
              ))}
            </div>
          )}

          {stage === 'LOST' && (
            <div>
              <Label htmlFor="deal-lost-reason">Motivo da Perda</Label>
              <Input
                id="deal-lost-reason"
                value={lostReason}
                onChange={(e) => setLostReason(e.target.value)}
                placeholder="Por que o deal foi perdido?"
              />
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 size={14} className="mr-2 animate-spin" />}
              {deal ? 'Salvar' : 'Criar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
