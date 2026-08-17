import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import prisma from '../config/database.js';
import { logger } from '../utils/logger.js';
import {
  ImportType,
  ImportStatus,
  LeadStatus,
  LeadSource,
  DealStage,
  InteractionType,
  InteractionDirection,
  CustomFieldType,
} from '@prisma/client';

// ────────────────────────────────────────────────────────────────────
// Constants (mirror spec restrictions)
// ────────────────────────────────────────────────────────────────────

/** Max rows per import (spec req 4 / restriction). */
export const MAX_IMPORT_ROWS = 10_000;
/** Files at/below this size are processed synchronously (spec reqs 30-31). */
export const SYNC_ROW_THRESHOLD = 500;
/** Insert batch size to avoid blocking the event loop (spec req 9). */
export const BATCH_SIZE = 100;
/** Rollback is only allowed within this window (spec req 26). */
export const ROLLBACK_WINDOW_MS = 24 * 60 * 60 * 1000;

// Lead destination fields available for column mapping (spec req 6).
export const LEAD_TARGET_FIELDS = [
  'name',
  'email',
  'phone',
  'company',
  'position',
  'source',
  'notes',
  'status',
] as const;

// ────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────

export type ColumnMapping = Record<string, string>; // fileColumn -> targetField

export type DuplicateStrategy = 'skip' | 'update';

/** Per-row duplicate decisions keyed by 1-based row number (Gap 4). */
export type DuplicateActionMap = Record<string, DuplicateStrategy>;

export interface ParsedFile {
  headers: string[];
  rows: Record<string, string>[];
}

export interface ValidationError {
  row: number; // 1-based data row number (excludes header)
  field: string;
  message: string;
}

/**
 * Duplicate detected during analysis. Shape matches the frontend contract
 * (Gap 2): `matchedBy`/`value` plus the file row's name/email/phone. The
 * existing record id is kept internal-only (not part of the response) so the
 * writer can re-derive the update target — see `writeLeads`.
 */
export interface DuplicateInfo {
  row: number;
  matchedBy: 'email' | 'phone' | 'externalId' | 'cnpj' | 'name';
  value: string;
  name?: string;
  email?: string;
  phone?: string;
}

export interface ImportAnalysis {
  totalRows: number;
  newCount: number;
  duplicateCount: number;
  errorCount: number;
  duplicates: DuplicateInfo[];
  errors: ValidationError[];
  previewRows: Record<string, unknown>[]; // first 5 rows with mapping applied
}

export class ImportError extends Error {
  statusCode: number;
  code: string;
  constructor(message: string, code: string, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

// ────────────────────────────────────────────────────────────────────
// File parsing
// ────────────────────────────────────────────────────────────────────

const VALID_SEPARATORS = [',', ';'] as const;

/**
 * Detect the CSV delimiter by inspecting the header line. Only comma and
 * semicolon are supported (spec restriction). If the line contains neither but
 * looks delimited by something else (e.g. tab), the separator is ambiguous and
 * we reject (spec edge case "separador ambíguo").
 */
function detectCsvDelimiter(firstLine: string): ',' | ';' {
  const counts = VALID_SEPARATORS.map((sep) => ({
    sep,
    count: firstLine.split(sep).length - 1,
  }));
  const best = counts.reduce((a, b) => (b.count > a.count ? b : a));

  if (best.count === 0) {
    // No supported separator. If there is a single column (no other delimiter
    // either) treat it as a one-column comma file; otherwise it's ambiguous.
    if (/\t/.test(firstLine)) {
      throw new ImportError(
        'Separador de colunas não reconhecido. Salve o arquivo com separador vírgula (,) ou ponto-e-vírgula (;).',
        'AMBIGUOUS_SEPARATOR'
      );
    }
    return ',';
  }
  return best.sep;
}

/**
 * Reject buffers that are not valid UTF-8 (spec edge case "codificação não-UTF-8").
 * UTF-16 BOM or replacement characters from a lossy decode are the signal.
 */
function assertUtf8(buffer: Buffer): void {
  // UTF-16 LE / BE BOMs
  if (
    buffer.length >= 2 &&
    ((buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff))
  ) {
    throw new ImportError(
      'Arquivo não está em UTF-8. Salve o CSV com codificação UTF-8 e tente novamente.',
      'NON_UTF8'
    );
  }
  const decoded = buffer.toString('utf-8');
  // U+FFFD replacement char indicates invalid UTF-8 byte sequences.
  if (decoded.includes('�')) {
    throw new ImportError(
      'Arquivo não está em UTF-8. Salve o CSV com codificação UTF-8 e tente novamente.',
      'NON_UTF8'
    );
  }
}

/** Strip a UTF-8 BOM if present. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parseCsvBuffer(buffer: Buffer): ParsedFile {
  assertUtf8(buffer);
  const text = stripBom(buffer.toString('utf-8'));
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const delimiter = detectCsvDelimiter(firstLine);

  let records: Record<string, string>[];
  try {
    records = parseCsv(text, {
      columns: (header: string[]) => header.map((h) => h.trim()),
      delimiter,
      skip_empty_lines: true,
      trim: true,
      relax_quotes: true,
      bom: true,
    }) as Record<string, string>[];
  } catch (err) {
    throw new ImportError(
      'Não foi possível ler o arquivo CSV. Verifique o separador (vírgula ou ponto-e-vírgula) e a codificação UTF-8.',
      'CSV_PARSE_FAILED'
    );
  }

  const headers =
    records.length > 0 ? Object.keys(records[0]) : firstLine.split(delimiter).map((h) => h.trim());

  return { headers, rows: records };
}

export async function parseXlsxBuffer(buffer: Buffer): Promise<ParsedFile> {
  const workbook = new ExcelJS.Workbook();
  try {
    // Cast: @types/exceljs types load() with the untemplated global Buffer,
    // while @types/node@20 produces Buffer<ArrayBufferLike> — structurally
    // incompatible at the type level only. Runtime value is identical.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(buffer as any);
  } catch (err) {
    // exceljs throws when the file is encrypted/password-protected (it is an
    // OLE compound file, not a zip) — surface a specific message (spec edge case).
    throw new ImportError(
      'Arquivo XLSX protegido por senha ou inválido. Remova a proteção por senha e tente novamente.',
      'XLSX_PROTECTED'
    );
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new ImportError('A planilha está vazia.', 'EMPTY_FILE');
  }

  const cellToString = (value: ExcelJS.CellValue): string => {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') {
      const v = value as { text?: string; result?: unknown; hyperlink?: string };
      if (typeof v.text === 'string') return v.text;
      if (v.result !== undefined && v.result !== null) return String(v.result);
      if (typeof v.hyperlink === 'string') return v.hyperlink;
      return '';
    }
    return String(value);
  };

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber - 1] = cellToString(cell.value).trim();
  });

  const rows: Record<string, string>[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const record: Record<string, string> = {};
    let hasValue = false;
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      const val = cellToString(row.getCell(c + 1).value).trim();
      record[key] = val;
      if (val) hasValue = true;
    }
    if (hasValue) rows.push(record);
  }

  return { headers, rows };
}

/**
 * Parse a legacy `.xls` (BIFF8 / OLE2 compound file) using SheetJS — ExcelJS
 * only reads the OOXML `.xlsx` format. Produces the same `{ headers, rows }`
 * shape so mapping/preview/import are format-agnostic (spec IEC-1).
 */
export function parseXlsBuffer(buffer: Buffer): ParsedFile {
  let workbook: XLSX.WorkBook;
  try {
    // raw:false → SheetJS returns formatted cell text (keeps the original
    // representation our string pipeline + BR parsers expect).
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  } catch {
    throw new ImportError(
      'Arquivo .xls inválido, corrompido ou protegido por senha. Remova a proteção e tente novamente.',
      'XLS_INVALID'
    );
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) {
    throw new ImportError('A planilha está vazia.', 'EMPTY_FILE');
  }

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  });
  if (matrix.length === 0) {
    throw new ImportError('A planilha está vazia.', 'EMPTY_FILE');
  }

  const headers = (matrix[0] as unknown[]).map((h) => String(h ?? '').trim());
  const rows: Record<string, string>[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const cells = matrix[r] as unknown[];
    const record: Record<string, string> = {};
    let hasValue = false;
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      const val = String(cells[c] ?? '').trim();
      record[key] = val;
      if (val) hasValue = true;
    }
    if (hasValue) rows.push(record);
  }

  return { headers, rows };
}

/** Parse an uploaded file by extension/mimetype. */
export async function parseImportFile(
  buffer: Buffer,
  filename: string,
  mimetype?: string
): Promise<ParsedFile> {
  const lower = (filename || '').toLowerCase();
  const isXlsx =
    lower.endsWith('.xlsx') ||
    mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  // Legacy .xls (BIFF8). Checked after .xlsx so "...xlsx" never matches here.
  const isXls =
    (lower.endsWith('.xls') && !lower.endsWith('.xlsx')) || mimetype === 'application/vnd.ms-excel';
  const isCsv = lower.endsWith('.csv') || mimetype === 'text/csv';

  let parsed: ParsedFile;
  if (isXlsx) {
    parsed = await parseXlsxBuffer(buffer);
  } else if (isXls) {
    parsed = parseXlsBuffer(buffer);
  } else if (isCsv) {
    parsed = parseCsvBuffer(buffer);
  } else {
    throw new ImportError(
      'Formato de arquivo não suportado. Envie um arquivo .csv (UTF-8), .xlsx ou .xls.',
      'UNSUPPORTED_FORMAT'
    );
  }

  if (parsed.rows.length > MAX_IMPORT_ROWS) {
    throw new ImportError(
      `A importação excede o máximo de ${MAX_IMPORT_ROWS.toLocaleString('pt-BR')} linhas.`,
      'TOO_MANY_ROWS'
    );
  }

  return parsed;
}

// ────────────────────────────────────────────────────────────────────
// Mapping & validation helpers
// ────────────────────────────────────────────────────────────────────

function applyMapping(row: Record<string, string>, mapping: ColumnMapping): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [fileCol, target] of Object.entries(mapping)) {
    if (!target) continue;
    const raw = row[fileCol];
    out[target] = raw === undefined || raw === null ? '' : String(raw).trim();
  }
  return out;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email?: string): string | undefined {
  const e = (email || '').trim().toLowerCase();
  return e || undefined;
}

function normalizePhone(phone?: string): string | undefined {
  const p = (phone || '').replace(/\D/g, '');
  return p || undefined;
}

function parseEnum<T extends Record<string, string>>(
  value: string | undefined,
  enumObj: T
): T[keyof T] | undefined {
  if (!value) return undefined;
  const upper = value.trim().toUpperCase();
  return (Object.values(enumObj) as string[]).includes(upper) ? (upper as T[keyof T]) : undefined;
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value.trim());
  return isNaN(d.getTime()) ? undefined : d;
}

/**
 * Parse a Brazilian-format date `DD/MM/YYYY` with an optional `HH:MM` time
 * (often in a separate column). Falls back to native Date parsing for ISO or
 * other recognizable strings. The native `parseDate` above interprets
 * `MM/DD/YYYY` and is wrong for Brazilian data (spec restriction).
 */
export function parseBrDate(dateStr?: string, timeStr?: string): Date | undefined {
  const ds = (dateStr || '').trim();
  if (!ds) return undefined;

  const m = ds.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  let year: number;
  let month: number;
  let day: number;
  if (m) {
    day = parseInt(m[1], 10);
    month = parseInt(m[2], 10);
    year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
  } else {
    const fallback = new Date(ds);
    return isNaN(fallback.getTime()) ? undefined : fallback;
  }

  let hours = 0;
  let minutes = 0;
  const tm = (timeStr || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (tm) {
    hours = parseInt(tm[1], 10);
    minutes = parseInt(tm[2], 10);
  }

  const d = new Date(year, month - 1, day, hours, minutes);
  return isNaN(d.getTime()) ? undefined : d;
}

/**
 * Parse a Brazilian-format number into a JS number (spec req 18). The decimal
 * separator is whichever of `.`/`,` appears LAST; the other is treated as a
 * thousands separator. This tolerates both BR text (`25.350,29`) and the
 * dot-decimal form SheetJS emits for numeric .xls cells (`25350.29`). Currency
 * symbols and spaces are stripped.
 */
export function parseBrNumber(value?: string): number | undefined {
  let v = (value || '').trim().replace(/[^\d.,-]/g, '');
  if (v === '' || v === '-') return undefined;
  const lastComma = v.lastIndexOf(',');
  const lastDot = v.lastIndexOf('.');
  if (lastComma > lastDot) {
    // Comma is the decimal separator (BR): drop dot thousands, comma → dot.
    v = v.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
    // Dot is the decimal separator: drop comma thousands.
    v = v.replace(/,/g, '');
  }
  const n = Number(v);
  return isNaN(n) ? undefined : n;
}

/**
 * Coerce a raw cell into the right JSON type for a custom field: NUMBER →
 * number (BR format), DATE → ISO string (BR format), anything else → trimmed
 * string. Returns undefined for empty so empty cells are not stored.
 */
function coerceCustomFieldValue(
  type: CustomFieldType | undefined,
  raw: string
): string | number | undefined {
  const v = (raw || '').trim();
  if (!v) return undefined;
  if (type === CustomFieldType.NUMBER) return parseBrNumber(v);
  if (type === CustomFieldType.DATE) {
    const d = parseBrDate(v);
    return d ? d.toISOString() : v;
  }
  return v;
}

// ────────────────────────────────────────────────────────────────────
// LEADS — analysis
// ────────────────────────────────────────────────────────────────────

interface MappedLead {
  row: number;
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  position?: string;
  source?: LeadSource;
  notes?: string;
  status?: LeadStatus;
  /** Original creation timestamp from the source file (contacts import). */
  createdAt?: Date;
  customFields: Record<string, string | number>;
}

/** Import-mode options shared by analyze + write for leads/contacts. */
export interface LeadImportOptions {
  /**
   * Contacts mode (spec IEC-4/5/6): email is optional, dedup is by
   * name+email (or name+company when there is no email), records are flagged
   * `isContact` and linked to companies by name. Default (false) preserves the
   * original Import Pro leads behavior (email required, dedup by email/phone).
   */
  contactsMode?: boolean;
}

/** Normalize a person/company name for matching (case + whitespace folded). */
function normalizeName(value?: string): string {
  return (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Composite dedup key for a contact (spec reqs 25-27): name + email when an
 * email exists, otherwise name + company. Two different names sharing one email
 * therefore yield different keys (kept as distinct records, req 26).
 */
function contactKey(name: string, email?: string, company?: string): string {
  const n = normalizeName(name);
  if (!n) return '';
  if (email) return `e|${n}|${email}`;
  return `c|${n}|${normalizeName(company)}`;
}

function mapLeadRow(
  row: Record<string, string>,
  mapping: ColumnMapping,
  rowNum: number,
  customFieldTypes: Map<string, CustomFieldType>
): MappedLead {
  const mapped = applyMapping(row, mapping);
  const customFields: Record<string, string | number> = {};
  for (const [key, val] of Object.entries(mapped)) {
    if (customFieldTypes.has(key) && val) {
      const coerced = coerceCustomFieldValue(customFieldTypes.get(key), val);
      if (coerced !== undefined) customFields[key] = coerced;
    }
  }
  return {
    row: rowNum,
    name: mapped.name?.trim() || undefined,
    email: mapped.email?.trim() || undefined,
    phone: mapped.phone?.trim() || undefined,
    company: mapped.company?.trim() || undefined,
    position: mapped.position?.trim() || undefined,
    source: parseEnum(mapped.source, LeadSource),
    notes: mapped.notes?.trim() || undefined,
    status: parseEnum(mapped.status, LeadStatus),
    // Combine a "createdAt" date column with an optional "createdAtTime" column
    // (spec req 16). Absent in normal leads mode (targets don't include it).
    createdAt: parseBrDate(mapped.createdAt, mapped.createdAtTime),
    customFields,
  };
}

/**
 * Analyze a parsed leads/contacts file: detect new rows, duplicates and
 * validation errors. In leads mode dedup is email (primary) + phone
 * (secondary) and email is required; in contacts mode dedup is name+email /
 * name+company and email is optional (spec reqs 11-13, 15, IEC-4/5/6).
 */
export async function analyzeLeads(
  tenantId: string,
  parsed: ParsedFile,
  mapping: ColumnMapping,
  options: LeadImportOptions = {}
): Promise<{ analysis: ImportAnalysis; mappedRows: MappedLead[] }> {
  const contactsMode = options.contactsMode === true;

  const customFieldDefs = await prisma.customField.findMany({
    where: { tenantId, active: true },
    select: { name: true, type: true },
  });
  const customFieldTypes = new Map(customFieldDefs.map((c) => [c.name, c.type]));

  // Existing tenant records for dedup lookup.
  const existing = await prisma.lead.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, email: true, phone: true, name: true, company: true },
  });
  const existingByEmail = new Map<string, string>();
  const existingByPhone = new Map<string, string>();
  const existingByContactKey = new Map<string, string>();
  for (const l of existing) {
    const e = normalizeEmail(l.email ?? undefined);
    const p = normalizePhone(l.phone ?? undefined);
    if (e && !existingByEmail.has(e)) existingByEmail.set(e, l.id);
    if (p && !existingByPhone.has(p)) existingByPhone.set(p, l.id);
    if (contactsMode) {
      const k = contactKey(l.name ?? '', e, l.company ?? undefined);
      if (k && !existingByContactKey.has(k)) existingByContactKey.set(k, l.id);
    }
  }

  const errors: ValidationError[] = [];
  const duplicates: DuplicateInfo[] = [];
  const mappedRows: MappedLead[] = [];

  // Track within-file occurrences so the second of two identical rows counts as
  // a duplicate too.
  const seenEmails = new Set<string>();
  const seenPhones = new Set<string>();
  const seenContactKeys = new Set<string>();

  let newCount = 0;
  let duplicateCount = 0;
  let errorCount = 0;

  parsed.rows.forEach((raw, idx) => {
    const rowNum = idx + 1;
    const lead = mapLeadRow(raw, mapping, rowNum, customFieldTypes);
    mappedRows.push(lead);

    let rowHasError = false;

    if (!lead.name) {
      errors.push({ row: rowNum, field: 'name', message: 'Nome é obrigatório.' });
      rowHasError = true;
    }

    if (!contactsMode) {
      // Leads: email is the primary identity field — required & must be valid.
      if (!lead.email) {
        errors.push({ row: rowNum, field: 'email', message: 'Email ausente.' });
        rowHasError = true;
      } else if (!EMAIL_RE.test(lead.email)) {
        errors.push({ row: rowNum, field: 'email', message: 'Email inválido.' });
        rowHasError = true;
      }
    } else if (lead.email && !EMAIL_RE.test(lead.email)) {
      // Contacts: email optional, but a present email must still be valid.
      errors.push({ row: rowNum, field: 'email', message: 'Email inválido.' });
      rowHasError = true;
    }

    if (rowHasError) {
      errorCount++;
      return;
    }

    const email = normalizeEmail(lead.email);
    const phone = normalizePhone(lead.phone);

    let dup: DuplicateInfo | null = null;
    if (contactsMode) {
      // Dedup by name+email / name+company (reqs 25-26).
      const key = contactKey(lead.name ?? '', email, lead.company);
      if (key && (existingByContactKey.has(key) || seenContactKeys.has(key))) {
        dup = {
          // Contacts dedup by name+email or name+company — never phone alone.
          row: rowNum,
          matchedBy: email ? 'email' : 'name',
          value: email ?? lead.name ?? '',
          name: lead.name,
          email: lead.email,
          phone: lead.phone,
        };
      }
      if (key) seenContactKeys.add(key);
    } else {
      // Dedup by email (primary), then phone (secondary).
      if (email && (existingByEmail.has(email) || seenEmails.has(email))) {
        dup = {
          row: rowNum,
          matchedBy: 'email',
          value: email,
          name: lead.name,
          email: lead.email,
          phone: lead.phone,
        };
      } else if (phone && (existingByPhone.has(phone) || seenPhones.has(phone))) {
        dup = {
          row: rowNum,
          matchedBy: 'phone',
          value: phone,
          name: lead.name,
          email: lead.email,
          phone: lead.phone,
        };
      }
      if (email) seenEmails.add(email);
      if (phone) seenPhones.add(phone);
    }

    if (dup) {
      duplicates.push(dup);
      duplicateCount++;
    } else {
      newCount++;
    }
  });

  const previewRows = mappedRows.slice(0, 5).map((m) => ({
    name: m.name ?? '',
    email: m.email ?? '',
    phone: m.phone ?? '',
    company: m.company ?? '',
    position: m.position ?? '',
    source: m.source ?? '',
    status: m.status ?? '',
    notes: m.notes ?? '',
    ...(m.createdAt ? { createdAt: m.createdAt.toISOString() } : {}),
    ...m.customFields,
  }));

  const analysis: ImportAnalysis = {
    totalRows: parsed.rows.length,
    newCount,
    duplicateCount,
    errorCount,
    duplicates,
    errors,
    previewRows,
  };

  return { analysis, mappedRows };
}

// ────────────────────────────────────────────────────────────────────
// DEALS — analysis
// ────────────────────────────────────────────────────────────────────

interface MappedDeal {
  row: number;
  leadEmail?: string;
  name?: string;
  value?: number;
  stage?: DealStage;
  expectedCloseDate?: Date;
  leadId?: string;
}

export async function analyzeDeals(
  tenantId: string,
  parsed: ParsedFile
): Promise<{ analysis: ImportAnalysis; mappedRows: MappedDeal[] }> {
  // Build a lookup of lead email -> id for association (spec reqs 18, 20).
  const leads = await prisma.lead.findMany({
    where: { tenantId, deletedAt: null, email: { not: null } },
    select: { id: true, email: true },
  });
  const leadByEmail = new Map<string, string>();
  for (const l of leads) {
    const e = normalizeEmail(l.email ?? undefined);
    if (e && !leadByEmail.has(e)) leadByEmail.set(e, l.id);
  }

  const errors: ValidationError[] = [];
  const mappedRows: MappedDeal[] = [];
  let newCount = 0;
  let errorCount = 0;

  parsed.rows.forEach((raw, idx) => {
    const rowNum = idx + 1;
    const leadEmail = normalizeEmail(raw['lead_email']);
    const name = (raw['deal_name'] || '').trim() || undefined;
    const valueRaw = (raw['value'] || '').trim();
    const stage = parseEnum(raw['stage'], DealStage);
    const expectedCloseDate = parseDate(raw['expected_close_date']);

    const deal: MappedDeal = { row: rowNum, leadEmail, name, stage, expectedCloseDate };
    let rowHasError = false;

    if (!name) {
      errors.push({ row: rowNum, field: 'deal_name', message: 'Nome do deal é obrigatório.' });
      rowHasError = true;
    }

    // value: parse a number; empty/invalid is an error.
    if (valueRaw) {
      const num = Number(valueRaw.replace(/\./g, '').replace(',', '.'));
      if (isNaN(num)) {
        errors.push({ row: rowNum, field: 'value', message: 'Valor inválido.' });
        rowHasError = true;
      } else {
        deal.value = num;
      }
    } else {
      deal.value = 0;
    }

    if (raw['stage'] && !stage) {
      errors.push({ row: rowNum, field: 'stage', message: 'Estágio inválido.' });
      rowHasError = true;
    }
    if (raw['expected_close_date'] && !expectedCloseDate) {
      errors.push({ row: rowNum, field: 'expected_close_date', message: 'Data inválida.' });
      rowHasError = true;
    }

    // Lead association required (spec req 20 + edge case "lead não encontrado").
    if (!leadEmail) {
      errors.push({ row: rowNum, field: 'lead_email', message: 'lead_email ausente.' });
      rowHasError = true;
    } else {
      const leadId = leadByEmail.get(leadEmail);
      if (!leadId) {
        errors.push({ row: rowNum, field: 'lead_email', message: 'lead não encontrado.' });
        rowHasError = true;
      } else {
        deal.leadId = leadId;
      }
    }

    mappedRows.push(deal);
    if (rowHasError) errorCount++;
    else newCount++;
  });

  const previewRows = mappedRows.slice(0, 5).map((m) => ({
    lead_email: m.leadEmail ?? '',
    deal_name: m.name ?? '',
    value: m.value ?? 0,
    stage: m.stage ?? '',
    expected_close_date: m.expectedCloseDate ? m.expectedCloseDate.toISOString() : '',
  }));

  const analysis: ImportAnalysis = {
    totalRows: parsed.rows.length,
    newCount,
    duplicateCount: 0,
    errorCount,
    duplicates: [],
    errors,
    previewRows,
  };

  return { analysis, mappedRows };
}

// ────────────────────────────────────────────────────────────────────
// INTERACTIONS — analysis
// ────────────────────────────────────────────────────────────────────

const ALLOWED_INTERACTION_TYPES: InteractionType[] = [
  InteractionType.CALL,
  InteractionType.EMAIL,
  InteractionType.MEETING,
  InteractionType.NOTE,
];

interface MappedInteraction {
  row: number;
  leadEmail?: string;
  type?: InteractionType;
  date?: Date;
  notes?: string;
  leadId?: string;
}

export async function analyzeInteractions(
  tenantId: string,
  parsed: ParsedFile
): Promise<{ analysis: ImportAnalysis; mappedRows: MappedInteraction[] }> {
  const leads = await prisma.lead.findMany({
    where: { tenantId, deletedAt: null, email: { not: null } },
    select: { id: true, email: true },
  });
  const leadByEmail = new Map<string, string>();
  for (const l of leads) {
    const e = normalizeEmail(l.email ?? undefined);
    if (e && !leadByEmail.has(e)) leadByEmail.set(e, l.id);
  }

  const errors: ValidationError[] = [];
  const mappedRows: MappedInteraction[] = [];
  let newCount = 0;
  let errorCount = 0;

  parsed.rows.forEach((raw, idx) => {
    const rowNum = idx + 1;
    const leadEmail = normalizeEmail(raw['lead_email']);
    const typeRaw = (raw['type'] || '').trim().toUpperCase();
    const type = ALLOWED_INTERACTION_TYPES.find((t) => t === typeRaw);
    const date = parseDate(raw['date']);
    const notes = (raw['notes'] || '').trim() || undefined;

    const interaction: MappedInteraction = { row: rowNum, leadEmail, type, date, notes };
    let rowHasError = false;

    if (!typeRaw) {
      errors.push({ row: rowNum, field: 'type', message: 'Tipo é obrigatório.' });
      rowHasError = true;
    } else if (!type) {
      errors.push({
        row: rowNum,
        field: 'type',
        message: 'Tipo inválido (use CALL, EMAIL, MEETING ou NOTE).',
      });
      rowHasError = true;
    }

    if (raw['date'] && !date) {
      errors.push({ row: rowNum, field: 'date', message: 'Data inválida.' });
      rowHasError = true;
    }

    if (!leadEmail) {
      errors.push({ row: rowNum, field: 'lead_email', message: 'lead_email ausente.' });
      rowHasError = true;
    } else {
      const leadId = leadByEmail.get(leadEmail);
      if (!leadId) {
        errors.push({ row: rowNum, field: 'lead_email', message: 'lead não encontrado.' });
        rowHasError = true;
      } else {
        interaction.leadId = leadId;
      }
    }

    mappedRows.push(interaction);
    if (rowHasError) errorCount++;
    else newCount++;
  });

  const previewRows = mappedRows.slice(0, 5).map((m) => ({
    lead_email: m.leadEmail ?? '',
    type: m.type ?? '',
    date: m.date ? m.date.toISOString() : '',
    notes: m.notes ?? '',
  }));

  const analysis: ImportAnalysis = {
    totalRows: parsed.rows.length,
    newCount,
    duplicateCount: 0,
    errorCount,
    duplicates: [],
    errors,
    previewRows,
  };

  return { analysis, mappedRows };
}

// ────────────────────────────────────────────────────────────────────
// Batch writers (process in chunks of BATCH_SIZE — spec req 9)
// ────────────────────────────────────────────────────────────────────

async function processInChunks<T>(
  items: T[],
  worker: (chunk: T[]) => Promise<void>
): Promise<void> {
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const chunk = items.slice(i, i + BATCH_SIZE);
    await worker(chunk);
    // Yield to the event loop between chunks.
    await new Promise((resolve) => setImmediate(resolve));
  }
}

interface BatchCounters {
  imported: number;
  skipped: number;
  errors: ValidationError[];
}

async function writeLeads(
  tenantId: string,
  batchId: string,
  mappedRows: MappedLead[],
  duplicateStrategy: DuplicateStrategy,
  duplicateActions: DuplicateActionMap = {},
  options: LeadImportOptions = {}
): Promise<BatchCounters> {
  const counters: BatchCounters = { imported: 0, skipped: 0, errors: [] };
  const contactsMode = options.contactsMode === true;

  // Per-row decision: explicit action for this row wins; otherwise fall back to
  // the global strategy (Gap 4). The analysis numbers a duplicate by its 1-based
  // row, which is the key the frontend sends in `duplicateActions`.
  const decideAction = (row: number): DuplicateStrategy =>
    duplicateActions[String(row)] ?? duplicateStrategy;

  // Re-derive validity + duplicate decisions deterministically.
  const existing = await prisma.lead.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, email: true, phone: true, name: true, company: true },
  });
  const existingByEmail = new Map<string, string>();
  const existingByPhone = new Map<string, string>();
  const existingByContactKey = new Map<string, string>();
  for (const l of existing) {
    const e = normalizeEmail(l.email ?? undefined);
    const p = normalizePhone(l.phone ?? undefined);
    if (e && !existingByEmail.has(e)) existingByEmail.set(e, l.id);
    if (p && !existingByPhone.has(p)) existingByPhone.set(p, l.id);
    if (contactsMode) {
      const k = contactKey(l.name ?? '', e, l.company ?? undefined);
      if (k && !existingByContactKey.has(k)) existingByContactKey.set(k, l.id);
    }
  }

  // Company name -> id lookup for linking contacts to companies (spec req 21).
  const companyByName = new Map<string, string>();
  if (contactsMode) {
    const companies = await prisma.company.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
    for (const c of companies) {
      const k = normalizeName(c.name);
      if (k && !companyByName.has(k)) companyByName.set(k, c.id);
    }
  }

  const seenEmails = new Set<string>();
  const seenPhones = new Set<string>();
  const seenContactKeys = new Set<string>();

  await processInChunks(mappedRows, async (chunk) => {
    for (const lead of chunk) {
      try {
        // Skip rows that failed validation in analysis. Name is always required;
        // email is required only in leads mode (optional for contacts, req 15).
        if (!lead.name) continue;
        if (contactsMode) {
          if (lead.email && !EMAIL_RE.test(lead.email)) continue;
        } else if (!lead.email || !EMAIL_RE.test(lead.email)) {
          continue;
        }

        const email = normalizeEmail(lead.email);
        const phone = normalizePhone(lead.phone);
        const companyId =
          contactsMode && lead.company ? companyByName.get(normalizeName(lead.company)) : undefined;

        let existingId: string | undefined;
        let matched = false;
        let key = '';
        if (contactsMode) {
          key = contactKey(lead.name, email, lead.company);
          if (key && (existingByContactKey.has(key) || seenContactKeys.has(key))) {
            existingId = existingByContactKey.get(key);
            matched = true;
          }
        } else if (email && (existingByEmail.has(email) || seenEmails.has(email))) {
          existingId = existingByEmail.get(email);
          matched = true;
        } else if (phone && (existingByPhone.has(phone) || seenPhones.has(phone))) {
          existingId = existingByPhone.get(phone);
          matched = true;
        }

        const markSeen = () => {
          if (email) seenEmails.add(email);
          if (phone) seenPhones.add(phone);
          if (key) seenContactKeys.add(key);
        };

        if (matched) {
          const action = decideAction(lead.row);
          if (action === 'skip') {
            counters.skipped++;
            markSeen();
            continue;
          }
          // 'update' — overwrite the existing record when we have its id.
          if (existingId) {
            await prisma.lead.update({
              where: { id: existingId },
              data: {
                name: lead.name,
                email: lead.email ?? null,
                phone: lead.phone ?? null,
                company: lead.company ?? null,
                position: lead.position ?? null,
                source: lead.source ?? undefined,
                status: lead.status ?? undefined,
                notes: lead.notes ?? null,
                ...(contactsMode ? { isContact: true } : {}),
                ...(companyId ? { companyId } : {}),
                ...(lead.createdAt ? { createdAt: lead.createdAt } : {}),
                ...(Object.keys(lead.customFields).length > 0
                  ? { customFields: lead.customFields }
                  : {}),
                importBatchId: batchId,
              },
            });
            counters.imported++;
            markSeen();
            continue;
          }
          // Duplicate within the same file with no existing row to update → skip.
          counters.skipped++;
          markSeen();
          continue;
        }

        const created = await prisma.lead.create({
          data: {
            tenantId,
            name: lead.name,
            email: lead.email ?? null,
            phone: lead.phone ?? null,
            company: lead.company ?? null,
            position: lead.position ?? null,
            companyId: companyId ?? undefined,
            isContact: contactsMode ? true : undefined,
            source: lead.source ?? LeadSource.OUTROS,
            status: lead.status ?? LeadStatus.NOVO,
            notes: lead.notes ?? null,
            customFields: lead.customFields,
            ...(lead.createdAt ? { createdAt: lead.createdAt } : {}),
            importBatchId: batchId,
          },
          select: { id: true },
        });
        counters.imported++;
        if (email) existingByEmail.set(email, created.id);
        if (phone) existingByPhone.set(phone, created.id);
        if (key) existingByContactKey.set(key, created.id);
        markSeen();
      } catch (err) {
        counters.errors.push({
          row: lead.row,
          field: '_row',
          message: err instanceof Error ? err.message : 'Erro desconhecido',
        });
      }
    }
  });

  return counters;
}

async function writeDeals(
  tenantId: string,
  batchId: string,
  mappedRows: MappedDeal[]
): Promise<BatchCounters> {
  const counters: BatchCounters = { imported: 0, skipped: 0, errors: [] };

  await processInChunks(mappedRows, async (chunk) => {
    for (const deal of chunk) {
      try {
        // Skip rows that failed validation (no lead match / no name).
        if (!deal.name || !deal.leadId) continue;
        await prisma.deal.create({
          data: {
            tenantId,
            name: deal.name,
            value: deal.value ?? 0,
            stage: deal.stage ?? DealStage.QUALIFICATION,
            expectedCloseDate: deal.expectedCloseDate ?? null,
            leadId: deal.leadId,
            importBatchId: batchId,
          },
          select: { id: true },
        });
        counters.imported++;
      } catch (err) {
        counters.errors.push({
          row: deal.row,
          field: '_row',
          message: err instanceof Error ? err.message : 'Erro desconhecido',
        });
      }
    }
  });

  return counters;
}

async function writeInteractions(
  tenantId: string,
  batchId: string,
  mappedRows: MappedInteraction[]
): Promise<BatchCounters> {
  const counters: BatchCounters = { imported: 0, skipped: 0, errors: [] };

  await processInChunks(mappedRows, async (chunk) => {
    for (const it of chunk) {
      try {
        if (!it.type || !it.leadId) continue;
        await prisma.interaction.create({
          data: {
            tenantId,
            leadId: it.leadId,
            type: it.type,
            direction: InteractionDirection.OUTBOUND,
            content: it.notes ?? '',
            createdAt: it.date ?? new Date(),
            importBatchId: batchId,
          },
          select: { id: true },
        });
        counters.imported++;
      } catch (err) {
        counters.errors.push({
          row: it.row,
          field: '_row',
          message: err instanceof Error ? err.message : 'Erro desconhecido',
        });
      }
    }
  });

  return counters;
}

// ────────────────────────────────────────────────────────────────────
// COMPANIES — analysis + write (spec IEC-2)
// ────────────────────────────────────────────────────────────────────

// Company destination fields available for column mapping (spec req 6).
export const COMPANY_TARGET_FIELDS = [
  'name',
  'externalId',
  'cnpj',
  'fantasyName',
  'website',
  'industry',
  'notes',
  'createdAt',
  'createdAtTime',
] as const;

interface MappedCompany {
  row: number;
  externalId?: string;
  name?: string;
  fantasyName?: string;
  cnpj?: string;
  website?: string;
  industry?: string;
  notes?: string;
  createdAt?: Date;
  customFields: Record<string, string | number>;
}

/** Digits-only CNPJ for matching (formatting tolerated). */
function normalizeCnpj(value?: string | null): string | undefined {
  const v = (value || '').replace(/\D/g, '');
  return v || undefined;
}

function mapCompanyRow(
  row: Record<string, string>,
  mapping: ColumnMapping,
  rowNum: number,
  customFieldTypes: Map<string, CustomFieldType>
): MappedCompany {
  const mapped = applyMapping(row, mapping);
  const customFields: Record<string, string | number> = {};
  for (const [key, val] of Object.entries(mapped)) {
    if (customFieldTypes.has(key) && val) {
      const coerced = coerceCustomFieldValue(customFieldTypes.get(key), val);
      if (coerced !== undefined) customFields[key] = coerced;
    }
  }
  return {
    row: rowNum,
    externalId: mapped.externalId?.trim() || undefined,
    name: mapped.name?.trim() || undefined,
    fantasyName: mapped.fantasyName?.trim() || undefined,
    cnpj: mapped.cnpj?.trim() || undefined,
    website: mapped.website?.trim() || undefined,
    industry: mapped.industry?.trim() || undefined,
    notes: mapped.notes?.trim() || undefined,
    createdAt: parseBrDate(mapped.createdAt, mapped.createdAtTime),
    customFields,
  };
}

/**
 * Analyze a parsed companies file. Only `name` is required. Dedup precedence:
 * externalId (primary) → cnpj → name (spec req 24). Existing rows are reported
 * as duplicates (they will be updated in place by the writer — upsert).
 */
export async function analyzeCompanies(
  tenantId: string,
  parsed: ParsedFile,
  mapping: ColumnMapping
): Promise<{ analysis: ImportAnalysis; mappedRows: MappedCompany[] }> {
  const customFieldDefs = await prisma.customField.findMany({
    where: { tenantId, active: true },
    select: { name: true, type: true },
  });
  const customFieldTypes = new Map(customFieldDefs.map((c) => [c.name, c.type]));

  const existing = await prisma.company.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, name: true, cnpj: true, externalId: true },
  });
  const byExternalId = new Map<string, string>();
  const byCnpj = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const c of existing) {
    if (c.externalId && !byExternalId.has(c.externalId)) byExternalId.set(c.externalId, c.id);
    const cnpj = normalizeCnpj(c.cnpj);
    if (cnpj && !byCnpj.has(cnpj)) byCnpj.set(cnpj, c.id);
    const n = normalizeName(c.name);
    if (n && !byName.has(n)) byName.set(n, c.id);
  }

  const errors: ValidationError[] = [];
  const duplicates: DuplicateInfo[] = [];
  const mappedRows: MappedCompany[] = [];
  const seenExternalId = new Set<string>();
  const seenCnpj = new Set<string>();
  const seenName = new Set<string>();

  let newCount = 0;
  let duplicateCount = 0;
  let errorCount = 0;

  parsed.rows.forEach((raw, idx) => {
    const rowNum = idx + 1;
    const company = mapCompanyRow(raw, mapping, rowNum, customFieldTypes);
    mappedRows.push(company);

    if (!company.name) {
      errors.push({ row: rowNum, field: 'name', message: 'Nome é obrigatório.' });
      errorCount++;
      return;
    }

    const cnpj = normalizeCnpj(company.cnpj);
    const n = normalizeName(company.name);

    let dup: DuplicateInfo | null = null;
    if (
      company.externalId &&
      (byExternalId.has(company.externalId) || seenExternalId.has(company.externalId))
    ) {
      dup = { row: rowNum, matchedBy: 'externalId', value: company.externalId, name: company.name };
    } else if (cnpj && (byCnpj.has(cnpj) || seenCnpj.has(cnpj))) {
      dup = { row: rowNum, matchedBy: 'cnpj', value: cnpj, name: company.name };
    } else if (n && (byName.has(n) || seenName.has(n))) {
      dup = { row: rowNum, matchedBy: 'name', value: company.name, name: company.name };
    }

    if (company.externalId) seenExternalId.add(company.externalId);
    if (cnpj) seenCnpj.add(cnpj);
    if (n) seenName.add(n);

    if (dup) {
      duplicates.push(dup);
      duplicateCount++;
    } else {
      newCount++;
    }
  });

  const previewRows = mappedRows.slice(0, 5).map((m) => ({
    name: m.name ?? '',
    externalId: m.externalId ?? '',
    cnpj: m.cnpj ?? '',
    fantasyName: m.fantasyName ?? '',
    website: m.website ?? '',
    industry: m.industry ?? '',
    notes: m.notes ?? '',
    ...(m.createdAt ? { createdAt: m.createdAt.toISOString() } : {}),
    ...m.customFields,
  }));

  const analysis: ImportAnalysis = {
    totalRows: parsed.rows.length,
    newCount,
    duplicateCount,
    errorCount,
    duplicates,
    errors,
    previewRows,
  };

  return { analysis, mappedRows };
}

/**
 * Write companies in chunks. Upsert semantics (spec reqs 24, 27): a row matching
 * an existing company (by externalId → cnpj → name) updates it in place;
 * otherwise a new company is created. Re-importing the same file is idempotent.
 */
async function writeCompanies(
  tenantId: string,
  batchId: string,
  mappedRows: MappedCompany[]
): Promise<BatchCounters> {
  const counters: BatchCounters = { imported: 0, skipped: 0, errors: [] };

  const existing = await prisma.company.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, name: true, cnpj: true, externalId: true },
  });
  const byExternalId = new Map<string, string>();
  const byCnpj = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const c of existing) {
    if (c.externalId && !byExternalId.has(c.externalId)) byExternalId.set(c.externalId, c.id);
    const cnpj = normalizeCnpj(c.cnpj);
    if (cnpj && !byCnpj.has(cnpj)) byCnpj.set(cnpj, c.id);
    const n = normalizeName(c.name);
    if (n && !byName.has(n)) byName.set(n, c.id);
  }

  const matchExistingId = (company: MappedCompany): string | undefined => {
    if (company.externalId && byExternalId.has(company.externalId)) {
      return byExternalId.get(company.externalId);
    }
    const cnpj = normalizeCnpj(company.cnpj);
    if (cnpj && byCnpj.has(cnpj)) return byCnpj.get(cnpj);
    const n = normalizeName(company.name);
    if (n && byName.has(n)) return byName.get(n);
    return undefined;
  };

  await processInChunks(mappedRows, async (chunk) => {
    for (const company of chunk) {
      try {
        if (!company.name) continue;

        const baseData = {
          name: company.name,
          fantasyName: company.fantasyName ?? null,
          cnpj: company.cnpj ?? null,
          website: company.website ?? null,
          industry: company.industry ?? null,
          notes: company.notes ?? null,
          externalId: company.externalId ?? null,
          ...(Object.keys(company.customFields).length > 0
            ? { customFields: company.customFields }
            : {}),
          importBatchId: batchId,
        };

        const existingId = matchExistingId(company);
        if (existingId) {
          await prisma.company.update({
            where: { id: existingId },
            data: { ...baseData, ...(company.createdAt ? { createdAt: company.createdAt } : {}) },
          });
          counters.imported++;
        } else {
          const created = await prisma.company.create({
            data: {
              tenantId,
              ...baseData,
              ...(company.createdAt ? { createdAt: company.createdAt } : {}),
            },
            select: { id: true },
          });
          counters.imported++;
          // Register so later rows in the same file dedup against this one.
          if (company.externalId) byExternalId.set(company.externalId, created.id);
          const cnpj = normalizeCnpj(company.cnpj);
          if (cnpj) byCnpj.set(cnpj, created.id);
          byName.set(normalizeName(company.name), created.id);
        }
      } catch (err) {
        counters.errors.push({
          row: company.row,
          field: '_row',
          message: err instanceof Error ? err.message : 'Erro desconhecido',
        });
      }
    }
  });

  return counters;
}

// ────────────────────────────────────────────────────────────────────
// Batch lifecycle (create, run, status, rollback)
// ────────────────────────────────────────────────────────────────────

export interface RunImportInput {
  tenantId: string;
  userId: string;
  type: ImportType;
  parsed: ParsedFile;
  mapping: ColumnMapping;
  duplicateStrategy: DuplicateStrategy;
  /** Per-row skip/update decisions for leads (Gap 4). */
  duplicateActions?: DuplicateActionMap;
  /** Leads/contacts mode options — `contactsMode` drives the IEC-4/5/6 path. */
  options?: LeadImportOptions;
}

/** Decide whether to run synchronously (spec reqs 30-31). */
export function shouldRunSync(rowCount: number): boolean {
  return rowCount <= SYNC_ROW_THRESHOLD;
}

/**
 * Execute the actual write phase for a batch and update its status/counters.
 * On any failure the batch is marked FAILED with the error logged; rows already
 * written are NOT auto-reverted (spec edge case "falha de banco no meio do lote").
 */
export async function executeBatch(
  batchId: string,
  input: RunImportInput,
  precomputed?:
    | { type: 'LEADS'; rows: MappedLead[] }
    | { type: 'DEALS'; rows: MappedDeal[] }
    | { type: 'INTERACTIONS'; rows: MappedInteraction[] }
    | { type: 'COMPANIES'; rows: MappedCompany[] }
): Promise<void> {
  const { tenantId, type, parsed, mapping, duplicateStrategy, duplicateActions, options } = input;
  try {
    await prisma.importBatch.update({
      where: { id: batchId },
      data: { status: ImportStatus.PROCESSING },
    });

    let counters: BatchCounters;
    if (type === ImportType.COMPANIES) {
      const rows =
        precomputed?.type === 'COMPANIES'
          ? precomputed.rows
          : (await analyzeCompanies(tenantId, parsed, mapping)).mappedRows;
      counters = await writeCompanies(tenantId, batchId, rows);
    } else if (type === ImportType.LEADS) {
      const rows =
        precomputed?.type === 'LEADS'
          ? precomputed.rows
          : (await analyzeLeads(tenantId, parsed, mapping, options)).mappedRows;
      counters = await writeLeads(
        tenantId,
        batchId,
        rows,
        duplicateStrategy,
        duplicateActions,
        options
      );
    } else if (type === ImportType.DEALS) {
      const rows =
        precomputed?.type === 'DEALS'
          ? precomputed.rows
          : (await analyzeDeals(tenantId, parsed)).mappedRows;
      counters = await writeDeals(tenantId, batchId, rows);
    } else {
      const rows =
        precomputed?.type === 'INTERACTIONS'
          ? precomputed.rows
          : (await analyzeInteractions(tenantId, parsed)).mappedRows;
      counters = await writeInteractions(tenantId, batchId, rows);
    }

    const errorRows = parsed.rows.length - counters.imported - counters.skipped;
    await prisma.importBatch.update({
      where: { id: batchId },
      data: {
        status: ImportStatus.COMPLETED,
        importedRows: counters.imported,
        skippedRows: counters.skipped,
        errorRows: errorRows < 0 ? 0 : errorRows,
        errorLog:
          counters.errors.length > 0
            ? (counters.errors.slice(0, 100) as unknown as object)
            : undefined,
      },
    });
  } catch (err) {
    logger.error('Import batch failed', err, { batchId, tenantId, type });
    await prisma.importBatch
      .update({
        where: { id: batchId },
        data: {
          status: ImportStatus.FAILED,
          errorLog: [
            {
              row: 0,
              field: '_batch',
              message: err instanceof Error ? err.message : 'Erro no processamento',
            },
          ] as unknown as object,
        },
      })
      .catch(() => {});
  }
}

/** Create the ImportBatch row in PENDING state. */
export async function createBatch(
  tenantId: string,
  userId: string,
  type: ImportType,
  totalRows: number
): Promise<{ id: string }> {
  return prisma.importBatch.create({
    data: { tenantId, userId, type, status: ImportStatus.PENDING, totalRows },
    select: { id: true },
  });
}

/** List the tenant's import history (spec req 22). */
export async function listBatches(tenantId: string) {
  const batches = await prisma.importBatch.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const userIds = [...new Set(batches.map((b) => b.userId))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, tenantId },
    select: { id: true, name: true, email: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  return batches.map((b) => ({
    id: b.id,
    type: b.type,
    status: b.status,
    totalRows: b.totalRows,
    importedRows: b.importedRows,
    errorRows: b.errorRows,
    skippedRows: b.skippedRows,
    createdAt: b.createdAt,
    rolledBackAt: b.rolledBackAt,
    user: userMap.get(b.userId) ?? null,
    canRollback:
      b.status === ImportStatus.COMPLETED &&
      Date.now() - b.createdAt.getTime() <= ROLLBACK_WINDOW_MS,
  }));
}

/** Fetch a single batch scoped to tenant (spec req 32) — for status polling. */
export async function getBatch(tenantId: string, batchId: string) {
  return prisma.importBatch.findFirst({
    where: { id: batchId, tenantId },
  });
}

/**
 * Roll back a batch: soft-delete every record created by it and flip the batch
 * to ROLLED_BACK (spec reqs 27-28). Enforces the 24h window and status guards
 * (spec edge cases).
 */
export async function rollbackBatch(tenantId: string, batchId: string) {
  const batch = await prisma.importBatch.findFirst({
    where: { id: batchId, tenantId },
  });
  if (!batch) {
    throw new ImportError('Lote de importação não encontrado.', 'BATCH_NOT_FOUND', 404);
  }
  if (batch.status === ImportStatus.ROLLED_BACK) {
    throw new ImportError('Este lote já foi desfeito.', 'ALREADY_ROLLED_BACK', 400);
  }
  if (batch.status === ImportStatus.PROCESSING || batch.status === ImportStatus.PENDING) {
    throw new ImportError(
      'A importação ainda está em andamento. Aguarde a conclusão para desfazer.',
      'BATCH_IN_PROGRESS',
      400
    );
  }
  if (Date.now() - batch.createdAt.getTime() > ROLLBACK_WINDOW_MS) {
    throw new ImportError(
      'O prazo de 24h para desfazer esta importação expirou.',
      'ROLLBACK_WINDOW_EXPIRED',
      400
    );
  }

  const now = new Date();
  const [leads, deals, interactions, companies] = await prisma.$transaction([
    prisma.lead.updateMany({
      where: { tenantId, importBatchId: batchId, deletedAt: null },
      data: { deletedAt: now },
    }),
    prisma.deal.updateMany({
      where: { tenantId, importBatchId: batchId, deletedAt: null },
      data: { deletedAt: now },
    }),
    prisma.interaction.updateMany({
      where: { tenantId, importBatchId: batchId, deletedAt: null },
      data: { deletedAt: now },
    }),
    prisma.company.updateMany({
      where: { tenantId, importBatchId: batchId, deletedAt: null },
      data: { deletedAt: now },
    }),
  ]);

  await prisma.importBatch.update({
    where: { id: batchId },
    data: { status: ImportStatus.ROLLED_BACK, rolledBackAt: now },
  });

  return {
    deleted: {
      leads: leads.count,
      deals: deals.count,
      interactions: interactions.count,
      companies: companies.count,
    },
  };
}
