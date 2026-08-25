// Tipos compartilhados do sistema

// Aligned with Prisma UserRole enum (hierarquia ADMIN > GESTOR > USER > VIEWER)
export type UserRole = 'ADMIN' | 'GESTOR' | 'USER' | 'VIEWER';

// Aligned with Prisma LeadStatus enum (régua "Leads como Oportunidade")
export type LeadStatus = 'NOVO' | 'EM_ANDAMENTO' | 'PAUSADO' | 'CANCELADO' | 'ENCERRADO';

// Aligned with Prisma LeadSource enum
export type LeadSource =
  | 'PROSPECCAO_ATIVA'
  | 'PORTAL_NOTICIAS_LINKEDIN'
  | 'EVENTO_FEIRA_SETORIAL'
  | 'NETWORKING_PESSOAL'
  | 'CLIENTE_RECORRENTE'
  | 'INDICACAO_PARCEIROS'
  | 'OUTROS';

// Aligned with Prisma LeadStatusReason enum — motivo obrigatório ao
// pausar/cancelar/encerrar (specs/leads-oportunidade req. 13)
export type LeadStatusReason =
  | 'CONVERTIDO_EM_OPORTUNIDADE'
  | 'PAUSADO_PELO_CLIENTE'
  | 'PROJETO_SUSPENSO'
  | 'SEM_ADERENCIA_TECNICA'
  | 'CONCORRENTE_ESCOLHIDO'
  | 'PRECO'
  | 'PRAZO'
  | 'DECISAO_INTERNA_CLIENTE'
  | 'SEM_RETORNO'
  | 'OUTRO';

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  NOVO: 'Novo',
  EM_ANDAMENTO: 'Em Andamento',
  PAUSADO: 'Pausado',
  CANCELADO: 'Cancelado',
  ENCERRADO: 'Encerrado',
};

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  PROSPECCAO_ATIVA: 'Prospecção ativa',
  PORTAL_NOTICIAS_LINKEDIN: 'Portal de Notícias/LinkedIn',
  EVENTO_FEIRA_SETORIAL: 'Evento/Feira setorial',
  NETWORKING_PESSOAL: 'Networking pessoal',
  CLIENTE_RECORRENTE: 'Cliente recorrente',
  INDICACAO_PARCEIROS: 'Indicação de parceiros',
  OUTROS: 'Outros',
};

export const LEAD_STATUS_REASON_LABELS: Record<LeadStatusReason, string> = {
  CONVERTIDO_EM_OPORTUNIDADE: 'Convertido em oportunidade',
  PAUSADO_PELO_CLIENTE: 'Pausado pelo cliente',
  PROJETO_SUSPENSO: 'Projeto suspenso',
  SEM_ADERENCIA_TECNICA: 'Sem aderência técnica',
  CONCORRENTE_ESCOLHIDO: 'Concorrente escolhido',
  PRECO: 'Preço',
  PRAZO: 'Prazo',
  DECISAO_INTERNA_CLIENTE: 'Decisão interna do cliente',
  SEM_RETORNO: 'Sem retorno',
  OUTRO: 'Outro',
};

/** Status terminais (exigem motivo na transição) */
export const TERMINAL_LEAD_STATUSES: LeadStatus[] = ['PAUSADO', 'CANCELADO', 'ENCERRADO'];

/** Degraus fixos da probabilidade Go×Get (req. 9) */
export const GO_GET_STEPS = [10, 25, 50, 75, 90] as const;

// Aligned with Prisma TaskPriority enum
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

/** Referências resumidas devolvidas pelo include do backend */
export interface LeadCompanyRef {
  id: string;
  name: string;
  fantasyName?: string | null;
}

export interface LeadContactRef {
  id: string;
  name: string;
  position?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface Lead {
  id: string; // UUID from Prisma
  name: string;
  phone?: string;
  email?: string;
  company?: string;
  position?: string;
  companyId?: string | null;
  companyRef?: LeadCompanyRef | null;
  contactId?: string | null;
  contactRef?: LeadContactRef | null;
  source: LeadSource;
  status: LeadStatus;
  statusReason?: LeadStatusReason | null;
  statusReasonNote?: string | null;
  estimatedValue?: number | string | null;
  estimatedTimeline?: string | null;
  probabilityGoGet?: number | null;
  score: number;
  isContact?: boolean;
  convertedAt?: string | null;
  notes?: string;
  assignedTo?: string;
  assignedUser?: { id: string; name: string; email: string } | null;
  tags: string[];
  customFields: Record<string, string | number | boolean | null>;
  interactions?: Interaction[];
  tasks?: Task[];
  createdAt?: string;
  updatedAt?: string;
}

// Alinhado ao backend (Prisma InteractionType/InteractionDirection em MAIÚSCULAS)
export type InteractionType =
  | 'EMAIL'
  | 'WHATSAPP'
  | 'CALL'
  | 'MEETING'
  | 'NOTE'
  | 'STATUS_CHANGE'
  | 'AUTOMATION';

export type MeetingModality = 'PRESENCIAL' | 'ONLINE';

export type CallReason =
  | 'PRIMEIRO_CONTATO'
  | 'SOLICITACAO_INFORMACOES'
  | 'FOLLOW_UP'
  | 'SUPORTE';

export const CALL_REASON_LABELS: Record<CallReason, string> = {
  PRIMEIRO_CONTATO: 'Primeiro contato',
  SOLICITACAO_INFORMACOES: 'Solicitação de informações',
  FOLLOW_UP: 'Follow-up',
  SUPORTE: 'Suporte',
};

export interface InteractionParticipant {
  id: string;
  leadId: string;
  lead?: LeadContactRef;
}

export interface Interaction {
  id: string;
  leadId: string;
  type: InteractionType;
  direction?: 'INBOUND' | 'OUTBOUND';
  subject?: string;
  content: string;
  userId?: string;
  /** Data/hora do evento (occurredAt do backend; fallback createdAt) */
  timestamp: string;
  occurredAt?: string | null;
  createdAt?: string;
  location?: string | null;
  modality?: MeetingModality | null;
  callReason?: CallReason | null;
  participants?: InteractionParticipant[];
  metadata?: Record<string, unknown>;
}

export interface Task {
  id: string;
  leadId?: string;
  title: string;
  description?: string;
  dueDate?: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  priority: TaskPriority;
  assignedTo?: string;
  userId?: string;
  createdAt: string;
  completedAt?: string;
  updatedAt?: string;
}

export interface CustomField {
  id: string;
  name: string;
  type: 'text' | 'number' | 'date' | 'select' | 'multiselect' | 'textarea' | 'checkbox';
  options?: string[];
  required: boolean;
  defaultValue?: string | number | boolean;
  /** Entidade-alvo (DEAL|COMPANY|CONTACT|PRODUCT); ausente/null = legado (todas). */
  entity?: string | null;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  createdAt: string;
}

export type NotificationType =
  | 'task_due'
  | 'task_overdue'
  | 'lead_assigned'
  | 'automation_error'
  | 'payment_failed'
  | 'subscription_expiring'
  | 'contract_expiring'
  | 'client_followup'
  | 'system';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  link?: string;
  timestamp: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface Report {
  id: string;
  name: string;
  description?: string;
  type: 'leads' | 'sales' | 'automations' | 'tasks' | 'custom';
  widgets: ReportWidget[];
  schedule?: ReportSchedule;
  filters?: ReportFilter;
  shareSettings?: ReportShareSettings;
  templateId?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface ReportWidget {
  id: string;
  type: 'chart' | 'table' | 'metric' | 'funnel' | 'heatmap' | 'line' | 'comparison' | 'topn';
  title: string;
  config: Record<string, string | number | boolean | null>;
  position: { x: number; y: number; w: number; h: number };
  dataSource?: 'leads' | 'pipeline' | 'automations' | 'tasks' | 'interactions';
  filters?: ReportFilter;
  dateRange?: {
    type: 'today' | 'week' | 'month' | 'quarter' | 'year' | 'all' | 'custom';
    start?: string;
    end?: string;
  };
  aggregation?: 'sum' | 'avg' | 'count' | 'min' | 'max';
  metric?: string;
  chartType?: 'bar' | 'line' | 'pie' | 'area';
  colors?: string[];
  styles?: Record<string, string | number>;
}

export interface ReportFilter {
  dateRange?: {
    type: 'today' | 'week' | 'month' | 'quarter' | 'year' | 'all' | 'custom';
    start?: string;
    end?: string;
  };
  status?: string[];
  source?: string[];
  tags?: string[];
  automationIds?: number[];
  userId?: string;
  priority?: string[];
}

export interface ReportSchedule {
  enabled: boolean;
  frequency: 'daily' | 'weekly' | 'monthly';
  dayOfWeek?: number; // 0-6 for weekly
  dayOfMonth?: number; // 1-31 for monthly
  time: string; // HH:mm format
  recipients: string[];
  format: 'pdf' | 'excel' | 'both';
}

export interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  category: 'leads' | 'sales' | 'automations' | 'tasks' | 'executive';
  icon?: string;
  widgets: Omit<ReportWidget, 'id' | 'position'>[];
  defaultFilters?: ReportFilter;
}

export interface ReportShareSettings {
  publicLink?: string;
  publicAccess: boolean;
  permissions: {
    view: string[]; // user IDs or emails
    edit: string[]; // user IDs or emails
  };
  password?: string;
  expiresAt?: string;
}

export interface LeadScore {
  leadId: string;
  score: number;
  factors: ScoreFactor[];
  lastUpdated: string;
}

export interface ScoreFactor {
  type: string;
  description: string;
  points: number;
}

export interface Comment {
  id: string;
  leadId: string;
  userId: string;
  userName: string;
  content: string;
  mentions?: string[]; // User IDs mentioned
  createdAt: string;
  updatedAt?: string;
}

// ========================
// Companies
// ========================

export type CompanySize = 'MICRO' | 'SMALL' | 'MEDIUM' | 'LARGE' | 'ENTERPRISE';

// Follow-up de clientes — status manual (deal GANHO promove a CLIENTE_ATIVO).
export type ClientStatus = 'PROSPECT' | 'CLIENTE_ATIVO' | 'INATIVO';

// Contrato guarda-chuva — quem detém o contrato-quadro da empresa.
export type ContractHolder = 'NOS' | 'CONCORRENTE' | 'NENHUM';

export interface Company {
  id: string;
  tenantId: string;
  name: string;
  /** Nome fantasia (name = razão social). Preenchível via enriquecimento por CNPJ (req 20). */
  fantasyName?: string | null;
  /** CNPJ da empresa (req 20 — enriquecimento). */
  cnpj?: string | null;
  domain?: string | null;
  industry?: string | null;
  size?: CompanySize | null;
  phone?: string | null;
  address?: string | null;
  website?: string | null;
  notes?: string | null;
  /** Segmento configurável do tenant (upgrade-rd-parity, req 6). */
  segmentId?: string | null;
  segment?: { id: string; name: string } | null;
  clientStatus?: ClientStatus;
  assignedTo?: string | null;
  assignedUser?: { id: string; name: string } | null;
  followUpIntervalDays?: number | null;
  contractHolder?: ContractHolder;
  contractCompetitor?: string | null;
  contractStartDate?: string | null;
  contractEndDate?: string | null;
  contractValue?: number | string | null;
  contractScope?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { leads: number; deals: number; interactions?: number };
  leads?: Array<{
    id: string;
    name: string;
    email?: string;
    phone?: string;
    status: string;
    source: string;
    score: number;
    createdAt: string;
  }>;
  deals?: Array<{
    id: string;
    name: string;
    value: number;
    stage: string;
    probability: number;
    expectedCloseDate?: string | null;
    createdAt: string;
  }>;
  interactions?: Array<{
    id: string;
    type: string;
    direction: string;
    subject?: string;
    content: string;
    createdAt: string;
  }>;
}

// ========================
// Deals
// ========================

export type DealStage = 'QUALIFICATION' | 'PROPOSAL' | 'NEGOTIATION' | 'CLOSING' | 'WON' | 'LOST';

export interface Deal {
  id: string;
  tenantId: string;
  name: string;
  value: number;
  stage: DealStage;
  probability: number;
  expectedCloseDate?: string | null;
  leadId?: string | null;
  lead?: { id: string; name: string; email?: string; phone?: string; company?: string } | null;
  /** Empresa-alvo da negociação (Deal.companyId → Company) — distinta da empresa do contato. */
  company?: { id: string; name: string; phone?: string | null } | null;
  assignedTo?: string | null;
  assignedUser?: { id: string; name: string; email: string } | null;
  notes?: string | null;
  customFields: Record<string, string | number | boolean | null>;
  lostReason?: string | null;
  funnelId?: string | null;
  funnelColumnId?: string | null;
  positionInColumn?: number;
  closedAt?: string | null;
  /** Gestão de Negócios (RD parity) — campos opcionais usados no card/detalhe. */
  status?: string | null;
  qualification?: number | null;
  /** Contagem de tarefas vinculadas (vinda do _count da query do funil). */
  taskCount?: number;
  /** Stored AI close-propensity score (0-100); null until first computed. */
  aiScore?: number | null;
  /** ISO timestamp of the last AI score computation. */
  aiScoreUpdatedAt?: string | null;
  /** Stored top factors for the AI score (shape: { label, detail }). */
  aiScoreFactors?: DealAIScoreFactor[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface DealStats {
  totalPipelineValue: number;
  weightedValue: number;
  wonValue: number;
  lostValue: number;
  winRate: number;
  avgDealSize: number;
  avgCycleTime: number;
  byStage: Array<{
    stage: string;
    count: number;
    totalValue: number;
    weightedValue: number;
  }>;
  totalDeals: number;
  activeDeals: number;
  wonDeals: number;
  lostDeals: number;
}

// ========================
// Forecast
// ========================

export interface MonthlyForecast {
  month: string; // 'YYYY-MM'
  totalValue: number;
  weightedValue: number;
  dealCount: number;
}

export interface WonLostMonth {
  month: string;
  won: { count: number; value: number };
  lost: { count: number; value: number };
}

export interface ForecastSummary {
  totalPipelineValue: number;
  totalWeightedForecast: number;
  avgDealSize: number;
  avgCloseTimeDays: number;
  winRate: number;
}

export interface ForecastData {
  monthly: MonthlyForecast[];
  noDateBucket: { totalValue: number; weightedValue: number; dealCount: number };
  summary: ForecastSummary;
}

export interface TrendData {
  months: WonLostMonth[];
}

// ========================
// Next Action (AI Assistant)
// ========================

export interface NextAction {
  action: string;
  reason: string;
  /**
   * Contextualized 1-2 sentence justification (AI Sales Assistant, req 10).
   * Optional for backward compatibility with the legacy next-action shape that
   * only returned `reason`.
   */
  reasoning?: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  icon: string;
  category: string;
}

export interface ActionSummaryItem {
  entityType: 'lead' | 'deal';
  entityId: string;
  entityName: string;
  action: NextAction;
}

export interface FunnelConversionStage {
  stage: string;
  count: number;
  conversionToNext: number | null;
  dropOffRate: number | null;
}

export interface FunnelConversionData {
  stages: FunnelConversionStage[];
  total: number;
}

// ========================
// AI Email Draft
// ========================

export type DraftTemplateType = 'initial_outreach' | 'follow_up' | 'proposal' | 'thank_you';

export interface DraftTemplate {
  id: DraftTemplateType;
  name: string;
  description: string;
}

export interface EmailDraft {
  subject: string;
  body: string;
  templateUsed: DraftTemplateType;
  aiGenerated: boolean;
}

export interface AIConfig {
  provider: string;
  configured: boolean;
  model?: string;
}

export interface AIConnectionTest {
  success: boolean;
  provider: string;
  error?: string;
}

// ========================
// AI Sales Assistant
// ========================

/** Gating status — whether AI features are enabled (AI_PROVIDER configured). */
export interface AIStatus {
  enabled: boolean;
  /**
   * Transcrição de áudio (Whisper/OpenAI) disponível. Opcional para não quebrar
   * respostas legadas; ausente ⇒ tratado como `false` (modo "Áudio" oculto).
   */
  transcription?: boolean;
}

/** Contextual lead summary generated by AI (GET /api/v1/leads/:id/ai-summary). */
export interface AISummary {
  /** AI-generated summary text. */
  summary: string;
  /** ISO timestamp of when the summary was generated server-side. */
  generatedAt?: string;
}

/** A single factor explaining a deal's AI propensity score. */
export interface DealAIScoreFactor {
  /** Human-readable label of the factor (e.g. "Tempo no stage"). */
  label: string;
  /** Optional impact direction/weight description (e.g. "+12", "dados insuficientes"). */
  impact?: string;
  /** Stored explanation persisted on the deal (Deal.aiScoreFactors[].detail). */
  detail?: string;
}

/** Deal close-propensity score (GET /api/v1/deals/:id/ai-score). */
export interface DealAIScore {
  /** Score from 0 to 100. */
  score: number;
  /** Top factors influencing the score (typically 3). */
  factors: DealAIScoreFactor[];
  /** ISO timestamp of last calculation. */
  updatedAt?: string | null;
}

/** A single chat turn kept in sessionStorage and sent to the chat endpoint. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}
