import React, { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { ClientStatus, Company, CompanySize, ContractHolder } from '../types';
import type { CompanySegment } from '../types/sales';
import { Loader2, Sparkles } from 'lucide-react';
import { FieldError } from './register/FieldError';
import { companyFormSchema } from '../utils/validation/formSchemas';
import { useFormValidation } from '../hooks/useFormValidation';
import { useAutoFocus } from '../hooks/useFocusManagement';
import { apiClient } from '../services/api/client';
import { PresetField } from './settings/PresetField';
import { CnpjEnrichDialog } from './companies/CnpjEnrichDialog';

const SIZE_OPTIONS: { value: CompanySize; label: string }[] = [
  { value: 'MICRO', label: 'Micro' },
  { value: 'SMALL', label: 'Pequena' },
  { value: 'MEDIUM', label: 'Media' },
  { value: 'LARGE', label: 'Grande' },
  { value: 'ENTERPRISE', label: 'Enterprise' },
];

export const CLIENT_STATUS_OPTIONS: { value: ClientStatus; label: string }[] = [
  { value: 'PROSPECT', label: 'Prospect' },
  { value: 'CLIENTE_ATIVO', label: 'Cliente ativo' },
  { value: 'INATIVO', label: 'Inativo' },
];

const CONTRACT_HOLDER_OPTIONS: { value: ContractHolder; label: string }[] = [
  { value: 'NENHUM', label: 'Nenhum' },
  { value: 'NOS', label: 'Nós' },
  { value: 'CONCORRENTE', label: 'Concorrente' },
];

// Valor "sem dono" para o Select (Radix não aceita item com value vazio).
const UNASSIGNED = 'UNASSIGNED';
// Valor "sem segmento" para o Select de segmento (upgrade-rd-parity, req 6).
const NO_SEGMENT = 'NO_SEGMENT';

function toDateInputValue(value?: string | null): string {
  if (!value) return '';
  return value.slice(0, 10);
}

interface CompanyFormProps {
  company?: Company | null;
  /** Dados pré-preenchidos na criação, vindos do link do Flow (spec captura-demandas, E-20). */
  valoresIniciais?: { name?: string; cnpj?: string; domain?: string };
  onSave: (data: Partial<Company>) => Promise<void>;
  onCancel: () => void;
}

export function CompanyForm({ company, valoresIniciais, onSave, onCancel }: CompanyFormProps) {
  const [name, setName] = useState(company?.name || valoresIniciais?.name || '');
  const [fantasyName, setFantasyName] = useState(company?.fantasyName || '');
  const [cnpj, setCnpj] = useState(company?.cnpj || valoresIniciais?.cnpj || '');
  const [domain, setDomain] = useState(company?.domain || valoresIniciais?.domain || '');
  const [industry, setIndustry] = useState(company?.industry || '');
  const [size, setSize] = useState<CompanySize | ''>(company?.size || '');

  // Enriquecimento por CNPJ (req 20) — diff campo a campo antes de aplicar.
  const [enrichOpen, setEnrichOpen] = useState(false);
  const [segmentId, setSegmentId] = useState<string>(company?.segmentId || NO_SEGMENT);
  const [segments, setSegments] = useState<CompanySegment[]>([]);
  const [phone, setPhone] = useState(company?.phone || '');
  const [address, setAddress] = useState(company?.address || '');
  const [website, setWebsite] = useState(company?.website || '');
  const [notes, setNotes] = useState(company?.notes || '');

  // Follow-up de clientes — status, dono da conta e cadência própria (reqs 5, 1).
  const [clientStatus, setClientStatus] = useState<ClientStatus>(
    company?.clientStatus || 'PROSPECT'
  );
  const [assignedTo, setAssignedTo] = useState<string>(company?.assignedTo || UNASSIGNED);
  const [followUpIntervalDays, setFollowUpIntervalDays] = useState<string>(
    company?.followUpIntervalDays ? String(company.followUpIntervalDays) : ''
  );

  // Contrato guarda-chuva (req 1/4).
  const [contractHolder, setContractHolder] = useState<ContractHolder>(
    company?.contractHolder || 'NENHUM'
  );
  const [contractCompetitor, setContractCompetitor] = useState(company?.contractCompetitor || '');
  const [contractStartDate, setContractStartDate] = useState(
    toDateInputValue(company?.contractStartDate)
  );
  const [contractEndDate, setContractEndDate] = useState(
    toDateInputValue(company?.contractEndDate)
  );
  const [contractValue, setContractValue] = useState(
    company?.contractValue != null ? String(company.contractValue) : ''
  );
  const [contractScope, setContractScope] = useState(company?.contractScope || '');
  const [contractErrors, setContractErrors] = useState<Record<string, string>>({});

  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const { fieldErrors, touchedFields, handleBlur, handleChange, validateAll, formRef } =
    useFormValidation({ schema: companyFormSchema });
  const autoFocusRef = useAutoFocus<HTMLFormElement>();

  useEffect(() => {
    apiClient
      .getUsers()
      .then((res) => {
        const userList = Array.isArray(res) ? res : (res as { data?: unknown[] }).data || [];
        setUsers(
          (userList as Array<{ id: string; name: string }>).map((u) => ({
            id: u.id,
            name: u.name,
          }))
        );
      })
      .catch(() => {});
  }, []);

  // Segmentos do tenant (upgrade-rd-parity, req 6): ativos + o já selecionado
  // (mesmo inativo, para não perder o valor ao editar).
  useEffect(() => {
    apiClient
      .getCompanySegments()
      .then((res) => setSegments(res.data || []))
      .catch(() => {});
  }, []);

  const segmentOptions = segments.filter((s) => s.active || s.id === company?.segmentId);

  // Validações do contrato (espelham o backend, req 4): concorrente obrigatório
  // quando detentor = CONCORRENTE; vencimento >= início quando ambas presentes.
  const validateContract = (): boolean => {
    const errors: Record<string, string> = {};
    if (contractHolder === 'CONCORRENTE' && !contractCompetitor.trim()) {
      errors.contractCompetitor = 'Informe o nome do concorrente detentor do contrato';
    }
    if (
      contractStartDate &&
      contractEndDate &&
      new Date(contractEndDate) < new Date(contractStartDate)
    ) {
      errors.contractEndDate = 'O vencimento deve ser igual ou posterior ao início';
    }
    setContractErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Aplica ao formulário apenas os campos que o usuário marcou no diff de CNPJ.
  // As chaves espelham o backend (cnpjService): name, fantasyName, address,
  // industry, size. Nunca sobrescreve silenciosamente — só o que veio marcado.
  const applyEnrichment = (fields: Record<string, string | null>) => {
    if ('name' in fields) setName(fields.name ?? '');
    if ('fantasyName' in fields) setFantasyName(fields.fantasyName ?? '');
    if ('address' in fields) setAddress(fields.address ?? '');
    if ('industry' in fields) setIndustry(fields.industry ?? '');
    if ('size' in fields) {
      const s = fields.size ?? '';
      setSize((SIZE_OPTIONS.some((o) => o.value === s) ? s : '') as CompanySize | '');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const isValid = validateAll({
      name,
      domain,
      industry,
      size,
      phone,
      address,
      website,
      notes,
    });
    const contractValid = validateContract();
    if (!isValid || !contractValid) return;

    try {
      setSaving(true);
      await onSave({
        name: name.trim(),
        fantasyName: fantasyName.trim() || null,
        cnpj: cnpj.trim() || null,
        domain: domain.trim() || null,
        industry: industry.trim() || null,
        size: size || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
        website: website.trim() || null,
        notes: notes.trim() || null,
        segmentId: segmentId === NO_SEGMENT ? null : segmentId,
        clientStatus,
        assignedTo: assignedTo === UNASSIGNED ? null : assignedTo,
        followUpIntervalDays: followUpIntervalDays ? Number(followUpIntervalDays) : null,
        contractHolder,
        contractCompetitor:
          contractHolder === 'CONCORRENTE' ? contractCompetitor.trim() || null : null,
        contractStartDate: contractStartDate || null,
        contractEndDate: contractEndDate || null,
        contractValue: contractValue ? Number(contractValue) : null,
        contractScope: contractScope.trim() || null,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
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
        <Label htmlFor="company-name">Nome *</Label>
        <Input
          id="company-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            handleChange('name', e.target.value);
          }}
          onBlur={() => handleBlur('name', name)}
          placeholder="Nome da empresa"
          className="mt-1"
          error={touchedFields.name ? fieldErrors.name : undefined}
          aria-describedby={
            fieldErrors.name && touchedFields.name ? 'company-name-error' : undefined
          }
        />
        <FieldError
          id="company-name-error"
          error={fieldErrors.name as string}
          touched={touchedFields.name}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="company-fantasy-name">Nome fantasia</Label>
          <Input
            id="company-fantasy-name"
            value={fantasyName}
            onChange={(e) => setFantasyName(e.target.value)}
            placeholder="Nome fantasia"
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="company-cnpj">CNPJ</Label>
          <div className="mt-1 flex gap-2">
            <Input
              id="company-cnpj"
              value={cnpj}
              onChange={(e) => setCnpj(e.target.value)}
              placeholder="00.000.000/0000-00"
              maxLength={18}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => setEnrichOpen(true)}
              disabled={cnpj.replace(/\D/g, '').length !== 14}
              className="shrink-0 gap-2"
              title="Consultar dados na Receita Federal pelo CNPJ"
            >
              <Sparkles size={16} />
              Enriquecer
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Preencha 14 dígitos para buscar razão social, endereço e mais.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="company-domain">Dominio</Label>
          <Input
            id="company-domain"
            value={domain}
            onChange={(e) => {
              setDomain(e.target.value);
              handleChange('domain', e.target.value);
            }}
            onBlur={() => handleBlur('domain', domain)}
            placeholder="exemplo.com.br"
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="company-industry">Industria</Label>
          {/* Preset de setor (reqs 7, 16): vira seleção quando o admin cadastra
              valores pré-definidos p/ COMPANY.industry; senão, Input livre. */}
          <PresetField
            id="company-industry"
            entity="COMPANY"
            field="industry"
            value={industry}
            onChange={(v) => {
              setIndustry(v);
              handleChange('industry', v);
            }}
            placeholder="Tecnologia, Saude..."
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="company-size">Porte</Label>
          <Select value={size} onValueChange={(v) => setSize(v as CompanySize)}>
            <SelectTrigger id="company-size" className="mt-1">
              <SelectValue placeholder="Selecione..." />
            </SelectTrigger>
            <SelectContent>
              {SIZE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="company-segment">Segmento</Label>
          <Select value={segmentId} onValueChange={setSegmentId}>
            <SelectTrigger id="company-segment" className="mt-1">
              <SelectValue placeholder="Sem segmento" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_SEGMENT}>Sem segmento</SelectItem>
              {segmentOptions.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {segments.length === 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              Cadastre segmentos em Configurações de vendas.
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="company-phone">Telefone</Label>
          <Input
            id="company-phone"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              handleChange('phone', e.target.value);
            }}
            onBlur={() => handleBlur('phone', phone)}
            placeholder="(11) 99999-9999"
            className="mt-1"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="company-website">Website</Label>
        <Input
          id="company-website"
          value={website}
          onChange={(e) => {
            setWebsite(e.target.value);
            handleChange('website', e.target.value);
          }}
          onBlur={() => handleBlur('website', website)}
          placeholder="https://exemplo.com.br"
          className="mt-1"
          error={touchedFields.website ? fieldErrors.website : undefined}
          aria-describedby={
            fieldErrors.website && touchedFields.website ? 'company-website-error' : undefined
          }
        />
        <FieldError
          id="company-website-error"
          error={fieldErrors.website as string}
          touched={touchedFields.website}
        />
      </div>

      <div>
        <Label htmlFor="company-address">Endereco</Label>
        <Input
          id="company-address"
          value={address}
          onChange={(e) => {
            setAddress(e.target.value);
            handleChange('address', e.target.value);
          }}
          onBlur={() => handleBlur('address', address)}
          placeholder="Rua, Cidade, Estado"
          className="mt-1"
        />
      </div>

      {/* Relacionamento — status de cliente, dono da conta e cadência de follow-up */}
      <div className="border-t border-border pt-4 space-y-4">
        <p className="text-sm font-semibold text-foreground">Relacionamento</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="company-client-status">Status de cliente</Label>
            <Select
              value={clientStatus}
              onValueChange={(v) => setClientStatus(v as ClientStatus)}
            >
              <SelectTrigger id="company-client-status" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLIENT_STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="company-assigned-to">Dono da conta</Label>
            <Select value={assignedTo} onValueChange={setAssignedTo}>
              <SelectTrigger id="company-assigned-to" className="mt-1">
                <SelectValue placeholder="Sem dono" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>Sem dono</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor="company-followup-interval">Cadência de follow-up (dias)</Label>
          <Input
            id="company-followup-interval"
            type="number"
            min={1}
            value={followUpIntervalDays}
            onChange={(e) => setFollowUpIntervalDays(e.target.value)}
            placeholder="Vazio = padrão do tenant"
            className="mt-1"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Clientes ativos sem contato além deste intervalo geram tarefa de follow-up.
          </p>
        </div>
      </div>

      {/* Contrato guarda-chuva — detentor, vigência, valor e escopo */}
      <div className="border-t border-border pt-4 space-y-4">
        <p className="text-sm font-semibold text-foreground">Contrato guarda-chuva</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="company-contract-holder">Detentor</Label>
            <Select
              value={contractHolder}
              onValueChange={(v) => setContractHolder(v as ContractHolder)}
            >
              <SelectTrigger id="company-contract-holder" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONTRACT_HOLDER_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {contractHolder === 'CONCORRENTE' && (
            <div>
              <Label htmlFor="company-contract-competitor">Concorrente *</Label>
              <Input
                id="company-contract-competitor"
                value={contractCompetitor}
                onChange={(e) => setContractCompetitor(e.target.value)}
                placeholder="Nome do concorrente"
                className="mt-1"
                error={contractErrors.contractCompetitor}
              />
              <FieldError
                id="company-contract-competitor-error"
                error={contractErrors.contractCompetitor}
                touched
              />
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="company-contract-start">Início da vigência</Label>
            <Input
              id="company-contract-start"
              type="date"
              value={contractStartDate}
              onChange={(e) => setContractStartDate(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="company-contract-end">Vencimento</Label>
            <Input
              id="company-contract-end"
              type="date"
              value={contractEndDate}
              onChange={(e) => setContractEndDate(e.target.value)}
              className="mt-1"
              error={contractErrors.contractEndDate}
            />
            <FieldError
              id="company-contract-end-error"
              error={contractErrors.contractEndDate}
              touched
            />
          </div>
        </div>
        <div>
          <Label htmlFor="company-contract-value">Valor do contrato (R$)</Label>
          <Input
            id="company-contract-value"
            type="number"
            min={0}
            step="0.01"
            value={contractValue}
            onChange={(e) => setContractValue(e.target.value)}
            placeholder="0,00"
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="company-contract-scope">Escopo / cardápio resumido</Label>
          <Textarea
            id="company-contract-scope"
            value={contractScope}
            onChange={(e) => setContractScope(e.target.value)}
            placeholder="Resumo do escopo do contrato-quadro..."
            rows={3}
            className="mt-1"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="company-notes">Notas</Label>
        <Textarea
          id="company-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Observacoes sobre a empresa..."
          rows={3}
          className="mt-1"
        />
      </div>

      <div className="flex items-center gap-2 justify-end pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 size={14} className="mr-2 animate-spin" />}
          {company ? 'Salvar' : 'Criar'}
        </Button>
      </div>

      <CnpjEnrichDialog
        open={enrichOpen}
        onOpenChange={setEnrichOpen}
        cnpj={cnpj}
        companyId={company?.id}
        onApply={applyEnrichment}
      />
    </form>
  );
}
