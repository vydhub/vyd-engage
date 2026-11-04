import { useState, useRef } from 'react';
import { Button } from '../ui/button';
import {
  Upload,
  X,
  Loader2,
  CheckCircle,
  AlertTriangle,
  FileSpreadsheet,
  Download,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { apiClient } from '../../services/api/client';
import { toast } from 'sonner';

interface LeadImportModalProps {
  open: boolean;
  onClose: () => void;
  onImportComplete: () => void;
}

/** Teto de linhas por arquivo (importSchema da rota POST /leads/import). */
const MAX_LINHAS = 1000;

/** Campos da planilha, na ordem em que aparecem no mapeamento (= tela de criação manual). */
const FIELDS = [
  'name',
  'company',
  'company_cnpj',
  'contact_email',
  'contact_name',
  'status',
  'source',
  'status_reason',
  'status_reason_note',
  'notes',
  'estimated_value',
  'estimated_timeline',
  'probability_go_get',
  'assigned_to_email',
  'email',
  'phone',
  'position',
] as const;

type FieldKey = (typeof FIELDS)[number];
type ColumnMapping = Record<FieldKey, number>;
type ParsedLead = { name: string } & Partial<Record<FieldKey, string>>;

interface ImportRowError {
  row: number;
  error: string;
}

const FIELD_LABELS: Record<FieldKey, string> = {
  name: 'Nome da oportunidade *',
  company: 'Empresa * (nome)',
  company_cnpj: 'Empresa * (CNPJ)',
  contact_email: 'Contato * (e-mail)',
  contact_name: 'Contato * (nome)',
  status: 'Status',
  source: 'Origem',
  status_reason: 'Motivo',
  status_reason_note: 'Nota do motivo',
  notes: 'Informações da oportunidade',
  estimated_value: 'Valor estimado (Budget)',
  estimated_timeline: 'Prazo estimado',
  probability_go_get: 'Probabilidade Go×Get',
  assigned_to_email: 'Responsável comercial (e-mail)',
  email: 'E-mail do lead',
  phone: 'Telefone do lead',
  position: 'Cargo',
};

/** Títulos reconhecidos sozinhos (título do modelo e rótulo da tela), sem acento/caixa. */
const ALIASES: Record<FieldKey, string[]> = {
  name: ['name', 'nome', 'nomedaoportunidade'],
  company: ['company', 'empresa'],
  company_cnpj: ['companycnpj', 'cnpj', 'cnpjdaempresa'],
  contact_email: ['contactemail', 'emaildocontato'],
  contact_name: ['contactname', 'contato', 'nomedocontato'],
  status: ['status'],
  source: ['source', 'origem'],
  status_reason: ['statusreason', 'motivo'],
  status_reason_note: ['statusreasonnote', 'notadomotivo', 'notamotivo'],
  notes: ['notes', 'notas', 'informacoesdaoportunidade'],
  estimated_value: ['estimatedvalue', 'valorestimado', 'valorestimadobudget', 'budget'],
  estimated_timeline: ['estimatedtimeline', 'prazoestimado', 'prazo'],
  probability_go_get: ['probabilitygoget', 'probabilidadegoget', 'probabilidade'],
  assigned_to_email: ['assignedtoemail', 'responsavelcomercial', 'responsavel'],
  email: ['email'],
  phone: ['phone', 'telefone'],
  position: ['position', 'cargo'],
};

const dobrar = (v: string) =>
  v
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

function parseCSV(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  return lines.map((line) => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if ((ch === ',' || ch === ';') && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  });
}

function emptyMapping(): ColumnMapping {
  return Object.fromEntries(FIELDS.map((f) => [f, -1])) as ColumnMapping;
}

function autoDetectMapping(headers: string[]): ColumnMapping {
  const mapping = emptyMapping();
  const lower = headers.map((h) => h.toLowerCase().trim());

  // 1) Título exato (modelo novo ou rótulo da tela). Vem primeiro para que
  //    "contact_email" não seja engolido pela regra antiga de "email".
  const exato = new Set<number>();
  headers.forEach((h, i) => {
    const chave = dobrar(h);
    const campo = FIELDS.find((f) => ALIASES[f].includes(chave));
    if (campo && mapping[campo] === -1) {
      mapping[campo] = i;
      exato.add(i);
    }
  });

  // 2) Regras antigas, exatamente como eram, para as colunas que sobraram.
  for (let i = 0; i < lower.length; i++) {
    if (exato.has(i)) continue;
    const h = lower[i];
    if (h.includes('nome') || h === 'name' || h === 'full name') mapping.name = i;
    else if (h.includes('email') || h.includes('e-mail')) mapping.email = i;
    else if (
      h.includes('telefone') ||
      h.includes('phone') ||
      h.includes('celular') ||
      h.includes('whatsapp')
    )
      mapping.phone = i;
    else if (h.includes('empresa') || h.includes('company') || h.includes('organizacao'))
      mapping.company = i;
    else if (
      h.includes('cargo') ||
      h.includes('position') ||
      h.includes('titulo') ||
      h.includes('job')
    )
      mapping.position = i;
    else if (h.includes('origem') || h.includes('source') || h.includes('canal'))
      mapping.source = i;
    else if (h.includes('nota') || h.includes('notes') || h.includes('observacao'))
      mapping.notes = i;
  }

  // If name wasn't detected, use first column
  if (mapping.name === -1) mapping.name = 0;

  return mapping;
}

function downloadTemplate() {
  const headers =
    'name,email,phone,company,source,status,company_cnpj,contact_email,contact_name,position,status_reason,status_reason_note,notes,estimated_value,estimated_timeline,probability_go_get,assigned_to_email';
  const example =
    'Maria Silva,maria@email.com,(11)99999-0000,ABC Ltda,Prospecção ativa,Novo,12.345.678/0001-90,joao@abc.com.br,João Souza,Diretor Comercial,,,"Cliente pediu proposta até dezembro","50000,00",2º semestre de 2026,70,vendedor@suaempresa.com';
  // BOM: o Excel só lê os acentos do exemplo como UTF-8 com ele.
  const csvContent = `\uFEFF${headers}\n${example}\n`;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'template-leads.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function LeadImportModal({ open, onClose, onImportComplete }: LeadImportModalProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<'upload' | 'mapping' | 'preview' | 'importing' | 'done'>(
    'upload'
  );
  const [rawData, setRawData] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>(emptyMapping());
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [result, setResult] = useState<{
    imported: number;
    skipped: number;
    failed: number;
    errors: ImportRowError[];
  } | null>(null);
  const [fileName, setFileName] = useState('');

  if (!open) return null;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const rows = parseCSV(text);
      if (rows.length < 2) {
        toast.error('Arquivo deve ter pelo menos um cabecalho e uma linha de dados');
        return;
      }
      setHeaders(rows[0]);
      setRawData(rows.slice(1));
      setMapping(autoDetectMapping(rows[0]));
      setStep('mapping');
    };
    reader.readAsText(file, 'utf-8');
  };

  const handleMappingChange = (field: FieldKey, colIndex: number) => {
    setMapping((prev) => ({ ...prev, [field]: colIndex }));
  };

  const parsedLeads: ParsedLead[] = rawData.map((row) => {
    const lead: ParsedLead = {
      name: mapping.name >= 0 ? row[mapping.name] || '' : '',
    };
    for (const field of FIELDS) {
      if (field === 'name') continue;
      const col = mapping[field];
      // Coluna deixada em "Ignorar" ou célula vazia: o campo não é enviado.
      if (col >= 0 && row[col]) lead[field] = row[col];
    }
    return lead;
  });

  // Sem empresa e contato mapeados nenhuma linha entra (Empresa e Contato são obrigatórios).
  const faltaEmpresa = mapping.company < 0 && mapping.company_cnpj < 0;
  const faltaContato = mapping.contact_email < 0 && mapping.contact_name < 0;
  const acimaDoTeto = parsedLeads.length > MAX_LINHAS;

  // Separate valid and invalid leads for display
  const validLeads = parsedLeads.filter((l) => l.name.trim());
  const invalidCount = parsedLeads.length - validLeads.length;

  const handleImport = async () => {
    if (validLeads.length === 0) {
      toast.error('Nenhum lead valido para importar');
      return;
    }
    if (validLeads.length > MAX_LINHAS) {
      toast.error(
        `O arquivo tem mais de ${MAX_LINHAS} linhas. Divida a planilha e envie em partes.`
      );
      return;
    }

    setStep('importing');
    try {
      const response = await apiClient.importLeads({
        leads: validLeads,
        skipDuplicateEmails: skipDuplicates,
      });
      const data = response;
      setResult({
        imported: data.imported || 0,
        skipped: data.skipped || 0,
        failed: data.failed || 0,
        errors: Array.isArray(data.errors) ? data.errors : [],
      });
      setStep('done');
      if (data.imported > 0) {
        toast.success(
          `${data.imported} lead${data.imported !== 1 ? 's' : ''} importado${data.imported !== 1 ? 's' : ''}`
        );
      }
    } catch (error: any) {
      toast.error(error.message || 'Erro na importacao');
      setStep('preview');
    }
  };

  const handleClose = () => {
    setStep('upload');
    setRawData([]);
    setHeaders([]);
    setResult(null);
    setFileName('');
    if (result && result.imported > 0) onImportComplete();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Upload size={20} /> Importar Leads
          </h2>
          <button onClick={handleClose} className="p-1 rounded hover:bg-gray-100">
            <X size={20} className="text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {step === 'upload' && (
            <div className="text-center py-12">
              <FileSpreadsheet className="h-16 w-16 mx-auto mb-4 text-gray-300" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Selecione um arquivo CSV</h3>
              <p className="text-sm text-gray-500 mb-6">
                Formatos aceitos: CSV (separado por virgula ou ponto-e-virgula).
                <br />A primeira linha deve conter os cabecalhos das colunas.
                <br />
                Máximo de {MAX_LINHAS} linhas por arquivo.
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.txt"
                onChange={handleFileSelect}
                className="hidden"
              />
              <div className="flex items-center justify-center gap-3 mb-6">
                <Button onClick={() => fileRef.current?.click()} className="gap-2">
                  <Upload size={16} /> Escolher Arquivo
                </Button>
                <Button variant="outline" onClick={downloadTemplate} className="gap-2">
                  <Download size={16} /> Baixar Template
                </Button>
              </div>
              <div className="bg-blue-50 rounded-lg p-4 text-left">
                <p className="text-sm text-blue-800 font-medium mb-2">Exemplo de formato:</p>
                <code className="text-xs text-blue-700 block">
                  name,email,phone,company,source,status,company_cnpj,contact_email,...
                  <br />
                  Maria Silva,maria@email.com,(11)99999-0000,ABC Ltda,Prospecção ativa,Novo,...
                </code>
                <p className="text-xs text-blue-700 mt-2">
                  Empresa e Contato precisam já estar cadastrados: baixe o template para ver as 17
                  colunas.
                </p>
              </div>
            </div>
          )}

          {step === 'mapping' && (
            <div>
              <p className="text-sm text-gray-600 mb-4">
                Arquivo: <strong>{fileName}</strong> ({rawData.length} linhas)
              </p>
              <h3 className="font-medium text-gray-900 mb-3">Mapeamento de colunas</h3>
              <div className="space-y-3">
                {FIELDS.map((field) => (
                  <div key={field} className="flex items-center gap-3">
                    <label className="w-56 shrink-0 text-sm font-medium text-gray-700">
                      {FIELD_LABELS[field]}
                    </label>
                    <select
                      className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                      value={mapping[field]}
                      onChange={(e) => handleMappingChange(field, parseInt(e.target.value))}
                    >
                      <option value={-1}>-- Ignorar --</option>
                      {headers.map((h, i) => (
                        <option key={i} value={i}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              <div className="mt-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={skipDuplicates}
                    onChange={(e) => setSkipDuplicates(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  Pular leads com email ja existente (deduplicacao)
                </label>
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <Button variant="outline" onClick={() => setStep('upload')}>
                  Voltar
                </Button>
                <Button onClick={() => setStep('preview')} disabled={mapping.name === -1}>
                  Continuar
                </Button>
              </div>
            </div>
          )}

          {step === 'preview' && (
            <div>
              <h3 className="font-medium text-gray-900 mb-1">
                Preview - {validLeads.length} leads validos
              </h3>
              {(faltaEmpresa || faltaContato) && (
                <div
                  role="alert"
                  data-testid="aviso-vinculos"
                  className="mb-3 rounded-md border border-[var(--vyd-warning)] bg-[var(--vyd-bg-panel)] p-3 text-sm text-[var(--vyd-text-primary)]"
                >
                  <strong>Nenhuma linha vai entrar.</strong> Empresa e Contato são obrigatórios e
                  precisam já estar cadastrados, mas a planilha não tem{' '}
                  {faltaEmpresa && faltaContato
                    ? 'as colunas de empresa nem as de contato'
                    : faltaEmpresa
                      ? 'a coluna de empresa (company ou company_cnpj)'
                      : 'a coluna de contato (contact_email ou contact_name)'}{' '}
                  mapeadas. Volte ao mapeamento ou use o template novo.
                </div>
              )}
              {acimaDoTeto && (
                <div
                  role="alert"
                  className="mb-3 rounded-md border border-[var(--vyd-danger)] bg-[var(--vyd-bg-panel)] p-3 text-sm text-[var(--vyd-text-primary)]"
                >
                  O arquivo tem {parsedLeads.length} linhas e o máximo é {MAX_LINHAS} por
                  importação. Divida a planilha e envie em partes.
                </div>
              )}
              {invalidCount > 0 && (
                <p className="text-sm text-red-600 mb-3">
                  {invalidCount} linha(s) sem nome (campo obrigatório) serão ignoradas.
                </p>
              )}
              <div className="border border-gray-300 rounded-lg max-h-[300px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 w-8"></th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">#</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                        Nome
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                        Email
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                        Telefone
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                        Empresa
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedLeads.slice(0, 50).map((lead, i) => {
                      const isValid = lead.name.trim().length > 0;
                      return (
                        <tr
                          key={i}
                          className={`border-t border-gray-100 ${!isValid ? 'bg-red-50' : ''}`}
                        >
                          <td className="px-3 py-1.5">
                            {isValid ? (
                              <CheckCircle2 size={16} className="text-green-500" />
                            ) : (
                              <XCircle size={16} className="text-red-500" />
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-gray-400">{i + 1}</td>
                          <td
                            className={`px-3 py-1.5 font-medium ${!isValid ? 'text-red-600' : ''}`}
                          >
                            {lead.name || <span className="italic text-red-400">Nome vazio</span>}
                          </td>
                          <td className="px-3 py-1.5 text-gray-600">{lead.email || '--'}</td>
                          <td className="px-3 py-1.5 text-gray-600">{lead.phone || '--'}</td>
                          <td className="px-3 py-1.5 text-gray-600">{lead.company || '--'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {parsedLeads.length > 50 && (
                  <p className="text-center text-xs text-gray-400 py-2">
                    ... e mais {parsedLeads.length - 50} leads
                  </p>
                )}
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <Button variant="outline" onClick={() => setStep('mapping')}>
                  Voltar
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={validLeads.length === 0 || acimaDoTeto}
                  className="gap-2"
                >
                  <Upload size={16} /> Confirmar Importacao ({validLeads.length})
                </Button>
              </div>
            </div>
          )}

          {step === 'importing' && (
            <div className="text-center py-12">
              <Loader2 className="h-12 w-12 mx-auto mb-4 text-primary animate-spin" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Importando leads...</h3>
              <p className="text-sm text-gray-500">Isso pode levar alguns segundos.</p>
            </div>
          )}

          {step === 'done' && result && (
            <div className="text-center py-8">
              {result.imported > 0 ? (
                <CheckCircle className="h-16 w-16 mx-auto mb-4 text-green-500" />
              ) : (
                <AlertTriangle className="h-16 w-16 mx-auto mb-4 text-yellow-500" />
              )}
              <h3 className="text-lg font-medium text-gray-900 mb-4">Importacao Concluida</h3>
              <div className="grid grid-cols-3 gap-4 max-w-sm mx-auto mb-6">
                <div className="bg-green-50 rounded-lg p-3">
                  <p className="text-2xl font-bold text-green-700">{result.imported}</p>
                  <p className="text-xs text-green-600">Importados</p>
                </div>
                <div className="bg-yellow-50 rounded-lg p-3">
                  <p className="text-2xl font-bold text-yellow-700">{result.skipped}</p>
                  <p className="text-xs text-yellow-600">Duplicados</p>
                </div>
                <div className="bg-red-50 rounded-lg p-3">
                  <p className="text-2xl font-bold text-red-700">{result.failed}</p>
                  <p className="text-xs text-red-600">Erros</p>
                </div>
              </div>
              {result.errors.length > 0 && (
                <div
                  data-testid="relatorio-de-erros"
                  className="mx-auto mb-6 max-w-lg rounded-md border border-[var(--vyd-border-default)] bg-[var(--vyd-bg-panel)] text-left"
                >
                  <p className="border-b border-[var(--vyd-border-default)] px-3 py-2 text-sm font-medium text-[var(--vyd-text-primary)]">
                    Linhas recusadas
                  </p>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-[var(--vyd-text-secondary)]">
                        <th className="px-3 py-1.5 text-left font-medium">Linha</th>
                        <th className="px-3 py-1.5 text-left font-medium">Motivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.errors.map((err, i) => (
                        <tr key={i} className="border-t border-[var(--vyd-border-default)]">
                          <td className="px-3 py-1.5 align-top text-[var(--vyd-text-primary)]">
                            {err.row}
                          </td>
                          <td className="px-3 py-1.5 text-[var(--vyd-text-primary)]">
                            {err.error}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="border-t border-[var(--vyd-border-default)] px-3 py-2 text-xs text-[var(--vyd-text-secondary)]">
                    {result.failed > result.errors.length
                      ? `Mostrando os primeiros ${result.errors.length} de ${result.failed} erros. `
                      : ''}
                    A linha conta as linhas enviadas, depois do cabeçalho.
                  </p>
                </div>
              )}
              <Button onClick={handleClose}>Fechar</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
