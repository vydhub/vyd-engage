import { useState } from 'react';
import { toast } from 'sonner';
import { CalendarClock, FileSignature, Flame, Loader2, Pencil } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { ContractExpiredBadge, ContractHolderBadge } from './CompanyBadges';
import { RoadmapCreateDialog } from '../comercial/RoadmapCreateDialog';
import { ContratosDaEmpresa, useContratosDaEmpresa } from './ContratosDaEmpresa';
import { apiClient } from '../../services/api/client';
import { Company, ContractHolder } from '../../types';

/**
 * Seção "Contrato guarda-chuva" do CompanyDetail (reqs 11 e 13):
 * detentor, vigência, valor, escopo, contagem regressiva/badge "Vencido",
 * edição via dialog (grava na rota de empresa) e aquecimento em 1 clique
 * (abre o fluxo de desdobramento pré-preenchido).
 */

const HOLDER_OPTIONS: { value: ContractHolder; label: string }[] = [
  { value: 'NENHUM', label: 'Nenhum' },
  { value: 'NOS', label: 'Nós' },
  { value: 'CONCORRENTE', label: 'Concorrente' },
];

// Dias civis até uma data date-only (gravada como meia-noite UTC): o alvo usa o
// dia UTC (mesma convenção de formatDate) e "hoje" o dia civil local do usuário —
// evita off-by-one entre o badge e a data exibida.
function civilDaysUntil(dateStr: string): number {
  const now = new Date();
  const target = new Date(dateStr);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const end = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  return Math.round((end - today) / 86400000);
}

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '—';
  // Datas de contrato são date-only; usar o dia UTC evita recuo de um dia no fuso local.
  return new Date(dateStr).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

function toDateInputValue(value?: string | null): string {
  if (!value) return '';
  return value.slice(0, 10);
}

export function ContractCard({
  company,
  onUpdated,
}: {
  company: Company;
  onUpdated: (company: Company) => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [warmupOpen, setWarmupOpen] = useState(false);

  const holder = company.contractHolder ?? 'NENHUM';
  const hasContract = holder !== 'NENHUM' || !!company.contractEndDate;
  // E-08: empresa NOS cujo contrato já tem vencimento é acompanhada por ele, e a contagem
  // regressiva dos campos antigos não repete o mesmo aviso.
  const { data: contratos = [] } = useContratosDaEmpresa(company.id);
  const vencimentoPeloContrato = holder === 'NOS' && contratos.some((c) => c.vigenciaFim);
  const daysLeft =
    company.contractEndDate && !vencimentoPeloContrato
      ? civilDaysUntil(company.contractEndDate)
      : null;

  return (
    <>
    <ContratosDaEmpresa companyId={company.id} />
    <div className="bg-card rounded-lg shadow-sm border border-border p-6 mb-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <FileSignature size={18} className="text-primary" />
          <h3 className="font-semibold text-foreground">Contrato guarda-chuva</h3>
          {daysLeft !== null &&
            (daysLeft < 0 ? (
              <ContractExpiredBadge />
            ) : (
              <Badge className="bg-warning/15 text-warning border-transparent gap-1">
                <CalendarClock size={12} />
                {daysLeft === 0 ? 'Vence hoje' : `Vence em ${daysLeft} dias`}
              </Badge>
            ))}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setEditOpen(true)}>
            <Pencil size={14} />
            Editar
          </Button>
          <Button size="sm" className="gap-2" onClick={() => setWarmupOpen(true)}>
            <Flame size={14} />
            Iniciar aquecimento
          </Button>
        </div>
      </div>

      {!hasContract ? (
        <p className="text-sm text-muted-foreground mt-4">
          Nenhum contrato mapeado para esta empresa. Registre quem detém o contrato-quadro e
          quando vence para receber os alertas de renovação.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
          <div>
            <span className="text-xs text-muted-foreground block mb-1">Detentor</span>
            <ContractHolderBadge holder={holder} competitor={company.contractCompetitor} />
          </div>
          <div>
            <span className="text-xs text-muted-foreground block mb-1">Vigência</span>
            <span className="text-sm text-foreground">
              {formatDate(company.contractStartDate)} – {formatDate(company.contractEndDate)}
            </span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block mb-1">Valor</span>
            <span className="text-sm text-foreground">
              {company.contractValue != null && company.contractValue !== ''
                ? Number(company.contractValue).toLocaleString('pt-BR', {
                    style: 'currency',
                    currency: 'BRL',
                  })
                : '—'}
            </span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block mb-1">Escopo</span>
            <span className="text-sm text-foreground whitespace-pre-wrap">
              {company.contractScope || '—'}
            </span>
          </div>
        </div>
      )}

      {/* key remonta o dialog quando a empresa muda, re-sincronizando o formulário. */}
      <ContractEditDialog
        key={`${company.id}-${company.updatedAt}`}
        open={editOpen}
        onOpenChange={setEditOpen}
        company={company}
        onUpdated={onUpdated}
      />

      {/* Aquecimento em 1 clique (req 13): fluxo existente de desdobramento,
          pré-preenchido com a empresa e título sugerido. */}
      <RoadmapCreateDialog
        open={warmupOpen}
        onOpenChange={setWarmupOpen}
        defaultCompanyId={company.id}
        defaultTitle={`Aquecimento — ${company.name}`}
        onCreated={() => toast.success('Cadência de aquecimento iniciada!')}
      />
    </div>
    </>
  );
}

function ContractEditDialog({
  open,
  onOpenChange,
  company,
  onUpdated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company: Company;
  onUpdated: (company: Company) => void;
}) {
  const [holder, setHolder] = useState<ContractHolder>(company.contractHolder ?? 'NENHUM');
  const [competitor, setCompetitor] = useState(company.contractCompetitor || '');
  const [startDate, setStartDate] = useState(toDateInputValue(company.contractStartDate));
  const [endDate, setEndDate] = useState(toDateInputValue(company.contractEndDate));
  const [value, setValue] = useState(
    company.contractValue != null ? String(company.contractValue) : ''
  );
  const [scope, setScope] = useState(company.contractScope || '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (holder === 'CONCORRENTE' && !competitor.trim()) {
      next.competitor = 'Informe o nome do concorrente detentor do contrato';
    }
    if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
      next.endDate = 'O vencimento deve ser igual ou posterior ao início';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    try {
      setSaving(true);
      const result = await apiClient.updateCompany(company.id, {
        contractHolder: holder,
        contractCompetitor: holder === 'CONCORRENTE' ? competitor.trim() || null : null,
        contractStartDate: startDate || null,
        contractEndDate: endDate || null,
        contractValue: value ? Number(value) : null,
        contractScope: scope.trim() || null,
      });
      onUpdated(result as unknown as Company);
      onOpenChange(false);
      toast.success('Contrato atualizado!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar contrato');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Contrato guarda-chuva</DialogTitle>
          <DialogDescription>
            Registre quem detém o contrato-quadro desta empresa e a vigência para receber os
            alertas de renovação.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="contract-holder">Detentor</Label>
              <Select value={holder} onValueChange={(v) => setHolder(v as ContractHolder)}>
                <SelectTrigger id="contract-holder" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOLDER_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {holder === 'CONCORRENTE' && (
              <div>
                <Label htmlFor="contract-competitor">Concorrente *</Label>
                <Input
                  id="contract-competitor"
                  value={competitor}
                  onChange={(e) => setCompetitor(e.target.value)}
                  placeholder="Nome do concorrente"
                  className="mt-1"
                  error={errors.competitor}
                />
                {errors.competitor && (
                  <p className="text-xs text-destructive mt-1">{errors.competitor}</p>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="contract-start">Início da vigência</Label>
              <Input
                id="contract-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="contract-end">Vencimento</Label>
              <Input
                id="contract-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1"
                error={errors.endDate}
              />
              {errors.endDate && <p className="text-xs text-destructive mt-1">{errors.endDate}</p>}
            </div>
          </div>

          <div>
            <Label htmlFor="contract-value">Valor do contrato (R$)</Label>
            <Input
              id="contract-value"
              type="number"
              min={0}
              step="0.01"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="0,00"
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="contract-scope">Escopo / cardápio resumido</Label>
            <Textarea
              id="contract-scope"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              placeholder="Resumo do escopo do contrato-quadro..."
              rows={3}
              className="mt-1"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
