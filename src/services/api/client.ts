import type {
  DeepResearch,
  DeepResearchListItem,
  DeepResearchTemplate,
  CreateDeepResearchInput,
  UpdateDeepResearchInput,
} from '../../types/deepResearch';
import type {
  Empreendimento,
  CreateEmpreendimentoInput,
  UpdateEmpreendimentoInput,
  PlaybookTemplate,
  CreatePlaybookInput,
  UpdatePlaybookInput,
  CommercialRoadmap,
  CommercialRoadmapListItem,
  CreateRoadmapInput,
  UpdateRoadmapInput,
  UpsertStakeholderInput,
  RoadmapStakeholder,
  RoadmapPanel,
} from '../../types/comercial';
import type {
  QualificationConfig,
  SalesFlags,
  CompanySegment,
  FieldPreset,
  FieldPresetInput,
  ManagerTrigger,
  ManagerTriggerInput,
  Questionnaire,
  QuestionnaireInput,
  QuestionnaireAnswerInput,
  QuestionnaireResponse,
  RespondQuestionnaireResult,
  ScheduledDeal,
  ScheduledDealStatus,
  CreateScheduledDealInput,
  SendDealEmailInput,
  SendDealEmailResult,
  CelebrationStats,
  DealWithoutTasks,
} from '../../types/sales';
import type {
  Team,
  CreateTeamInput,
  UpdateTeamInput,
  PermissionProfile,
  CreatePermissionProfileInput,
  UpdatePermissionProfileInput,
  EffectivePermissions,
  ApprovalRequest,
  ApprovalStatus,
  TrashEntity,
  TrashListResult,
  Goal as GovernanceGoal,
  UpsertGoalInput,
  PendingApprovalResult,
} from '../../types/governance';
import type {
  Attachment,
  StorageUsage,
  ProposalTemplate,
  CreateProposalTemplateInput,
  UpdateProposalTemplateInput,
  Proposal,
  GenerateProposalInput,
  SendSignatureInput,
  IntegrationStatus,
  SignatureConfigInput,
  PhoneConfigInput,
  PhoneTokenResult,
  LogCallInput,
  EnrichCnpjResult,
} from '../../types/documents';
import type {
  Atestado,
  AtestadoInput,
  AtestadoStatus,
  BuscaResult,
  ImportReport,
  SugestaoResponse,
  Profissional,
  Terceiro,
  Taxonomia,
  TaxonomiaTipo,
  Pendencia,
  PendenciaStatus,
  Concorrencia,
  Curriculo,
} from '../../types/atestados';
import type {
  PainelData,
  Consultor,
  ConsultorInput,
  Registro,
  RegistroInput,
  RegistroUpdate,
  RegistroExtensao,
  ConflitoCandidato,
  ConflitoDecisao,
  OverlapRow,
  ExtratoComissao,
  ComissaoParcela,
  Recebimento,
  PapelAtribuicao,
  ConsultorReuniao,
  ConsultorMeta,
  MetaProgress,
  ConsultorDocumento,
  ParceiroConfig,
  ScoreSnapshot,
  PortalPerfil,
  PlanoAcaoItem,
} from '../../types/parceiros';
import type {
  Meeting,
  ApplyMeetingInput,
  ApplyMeetingResult,
  ResolvedContact,
} from '../../types/meetings';

// Detect API URL automatically in production, use env var or localhost in development
const getApiUrl = () => {
  // If VITE_API_URL is set, use it
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }

  // In production (when not localhost), use relative URLs
  if (
    typeof window !== 'undefined' &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1'
  ) {
    return window.location.origin;
  }

  // Default to localhost for development
  return 'http://localhost:3001';
};

class ApiClient {
  private baseURL: string;

  constructor(baseURL?: string) {
    // Detect URL dynamically at runtime
    this.baseURL = baseURL || getApiUrl();
  }

  // Method to get current API URL (useful for debugging)
  getApiUrl(): string {
    return this.baseURL;
  }

  // Read CSRF token from cookie (non-httpOnly, readable by JS)
  private getCsrfToken(): string | null {
    if (typeof document === 'undefined') return null;
    const match = document.cookie.match(/(?:^|;\s*)csrf-token=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  private async refreshAccessToken(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseURL}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      });

      return response.ok;
    } catch (error) {
      console.error('Failed to refresh token:', error);
    }

    return false;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    // Attach CSRF token for non-GET requests
    const method = (options.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      const csrfToken = this.getCsrfToken();
      if (csrfToken) {
        headers['x-csrf-token'] = csrfToken;
      }
    }

    let response = await fetch(url, {
      ...options,
      headers,
      credentials: 'include',
    });

    // If unauthorized, try to refresh token via cookie (only once, skip for auth endpoints)
    if (
      response.status === 401 &&
      !endpoint.startsWith('/api/v1/auth/') &&
      !endpoint.startsWith('/api/auth/')
    ) {
      const refreshed = await this.refreshAccessToken();
      if (refreshed) {
        // Retry request with new cookie
        response = await fetch(url, {
          ...options,
          headers,
          credentials: 'include',
        });
      }
    }

    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch {
        // Corpo nao-JSON: quase sempre a BORDA respondendo (rewrite da Vercel,
        // firewall, 502/504 do proxy) e nao a nossa API, que sempre devolve
        // JSON pelo errorHandler.
        //
        // O `statusText` NAO serve aqui: em HTTP/2 ele e SEMPRE vazio, entao a
        // mensagem caia no generico "An error occurred" e engolia ate o codigo
        // HTTP. Isso ja custou uma investigacao inteira: um 403 de borda no
        // handoff do VYD ID apareceu como "An error occurred" e mandou a busca
        // para o lugar errado. O status e a unica pista que sobra — mostre-o.
        errorData = {
          error: `Erro ${response.status} ao contatar o servidor${
            response.statusText ? ` (${response.statusText})` : ''
          }. Se persistir, informe esse codigo ao suporte.`,
          statusCode: response.status,
        };
      }

      // Extrair mensagem de erro mais específica
      const errorMessage = errorData.error || errorData.message || 'Request failed';
      throw new ApiError(errorMessage, response.status, errorData);
    }

    // Handle empty responses
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return response.json();
    }

    return {} as T;
  }

  /**
   * Wraps network/timeout errors into ApiError with proper codes.
   * Centralizes the duplicated try/catch pattern from auth methods.
   */
  private normalizeError(error: unknown): never {
    // Network errors (fetch failures)
    if (
      error instanceof TypeError &&
      (error.message.includes('Failed to fetch') ||
        error.message.includes('NetworkError') ||
        error.message.includes('Network request failed'))
    ) {
      throw new ApiError(
        'Erro de conexão. Verifique sua internet e tente novamente.',
        0,
        { originalError: String(error) },
        'NETWORK_ERROR'
      );
    }

    // Timeout errors
    if (
      error instanceof Error &&
      (error.name === 'TimeoutError' || error.message.includes('timeout'))
    ) {
      throw new ApiError(
        'A requisição demorou muito. Tente novamente.',
        408,
        { originalError: String(error) },
        'TIMEOUT'
      );
    }

    // Already an ApiError — ensure code is populated from details
    if (error instanceof ApiError) {
      if (!error.code && error.details) {
        const errorDetails = error.details.error as Record<string, unknown> | undefined;
        error.code = (error.details.code || errorDetails?.code) as string | undefined;
      }
    }

    throw error;
  }

  // Auth methods
  async register(data: { email: string; password: string; name: string; companyName: string }) {
    try {
      // Cookies are set by the server (httpOnly) — no localStorage needed
      return await this.request<{
        user: { id: string; email: string; name: string; role: string; tenantId: string };
      }>('/api/v1/auth/register', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    } catch (error: unknown) {
      this.normalizeError(error);
    }
  }

  async login(data: { email: string; password: string; totpCode?: string }) {
    try {
      // Cookies are set by the server (httpOnly) — no localStorage needed
      return await this.request<
        | { user: { id: string; email: string; name: string; role: string; tenantId: string } }
        | { requiresTwoFactor: true; userId: string }
      >('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    } catch (error: unknown) {
      this.normalizeError(error);
    }
  }

  // SSO VYD ID — troca o vyd_token do portal id.vydhub.com pela sessão nativa.
  // Mesmo contrato do /login: cookies httpOnly setados pelo servidor + { user }.
  async ssoExchange(token: string) {
    try {
      return await this.request<{
        user: { id: string; email: string; name: string; role: string; tenantId: string };
      }>('/api/v1/auth/sso/exchange', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
    } catch (error: unknown) {
      this.normalizeError(error);
    }
  }

  async logout() {
    // Server clears httpOnly cookies
    await this.request('/api/v1/auth/logout', {
      method: 'POST',
    });
  }

  async getCurrentUser() {
    return this.request<{
      user: {
        id: string;
        email: string;
        name: string;
        avatar?: string | null;
        role: string;
        isPlatformAdmin?: boolean;
        tenantId: string;
        tenant?: { id: string; name: string; slug: string; logo?: string | null };
      };
    }>('/api/v1/auth/me');
  }

  // ---- Platform admin (super-admin / cross-tenant) ----
  async getPlatformOverview() {
    return this.request<{
      status: number;
      data: {
        tenants: number;
        users: number;
        leads: number;
        deals: number;
        activeSubscriptions: number;
        mrr: number;
      };
    }>('/api/v1/admin/overview');
  }

  async getPlatformTenants() {
    return this.request<{
      status: number;
      data: Array<{
        id: string;
        name: string;
        slug: string;
        createdAt: string;
        _count: { users: number; leads: number };
        subscription?: { status: string; plan: { type: string; name: string } } | null;
      }>;
    }>('/api/v1/admin/tenants');
  }

  async createPlatformTenant(data: {
    tenantName: string;
    slug: string;
    planType: 'STARTER' | 'PRO' | 'ENTERPRISE';
    subscriptionStatus?: 'ACTIVE' | 'TRIAL';
    adminEmail: string;
    adminName: string;
    adminPassword?: string;
  }) {
    return this.request<{
      status: number;
      data: {
        tenant: { id: string; name: string; slug: string };
        admin: { id: string; email: string };
        generatedPassword?: string;
      };
    }>('/api/v1/admin/tenants', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateProfile(data: { name?: string; phone?: string; avatar?: string | null }) {
    return this.request<{
      id: string;
      name: string;
      email: string;
      phone?: string;
      avatar?: string | null;
    }>('/api/v1/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }


  // 2FA endpoints
  async setup2FA() {
    return this.request<{ secret: string; qrCode: string; otpauthUrl: string }>(
      '/api/v1/auth/2fa/setup',
      {
        method: 'POST',
      }
    );
  }

  async verify2FA(code: string) {
    return this.request<{ enabled: boolean }>('/api/v1/auth/2fa/verify', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  }

  async disable2FA(code: string) {
    return this.request<{ disabled: boolean }>('/api/v1/auth/2fa/disable', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  }

  async get2FAStatus() {
    return this.request<{ enabled: boolean }>('/api/v1/auth/2fa/status');
  }

  async updateTenant(data: {
    name?: string;
    logo?: string | null;
    settings?: { slackWebhookUrl?: string | null; teamsWebhookUrl?: string | null };
    clientFollowUpDays?: number;
    contractAlertDays?: number[];
  }) {
    // O backend responde { tenant: {...} } (mesma forma do GET).
    return this.request<{
      tenant: {
        id: string;
        name: string;
        slug: string;
        logo?: string | null;
        settings?: Record<string, unknown>;
        clientFollowUpDays?: number;
        contractAlertDays?: number[];
      };
    }>('/api/v1/auth/tenant', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async getTenant() {
    return this.request<{
      tenant: {
        id: string;
        name: string;
        slug: string;
        logo?: string | null;
        settings: Record<string, unknown>;
        clientFollowUpDays?: number;
        contractAlertDays?: number[];
      };
    }>('/api/v1/auth/tenant');
  }

  async getProfileStats() {
    return this.request<Record<string, unknown>>('/api/v1/auth/profile/stats');
  }

  async changePlan(data: { planType: string; billingCycle?: string }) {
    return this.request<{ message: string }>('/api/v1/subscriptions/change-plan', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async cancelSubscription() {
    return this.request<{ message: string }>('/api/v1/subscriptions/cancel', {
      method: 'POST',
    });
  }

  // Public lead capture (no auth required)
  async publicCaptureLead(formId: string, data: Record<string, unknown>) {
    return this.request<{ id: string }>(`/api/v1/public/capture/${formId}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Dashboard stats
  async getDashboardStats() {
    return this.request<Record<string, unknown>>('/api/v1/dashboard/stats');
  }

  async requestPasswordReset(email: string) {
    try {
      // Ensure email is trimmed and lowercase
      const normalizedEmail = email.trim().toLowerCase();

      if (!normalizedEmail || !normalizedEmail.includes('@')) {
        throw new ApiError('Email inválido', 400, { code: 'VALIDATION_ERROR' }, 'VALIDATION_ERROR');
      }

      return await this.request<{ message: string }>('/api/v1/auth/password/reset-request', {
        method: 'POST',
        body: JSON.stringify({ email: normalizedEmail }),
      });
    } catch (error: unknown) {
      this.normalizeError(error);
    }
  }

  async resetPassword(token: string, password: string) {
    try {
      return await this.request<{ message: string }>('/api/v1/auth/password/reset', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      });
    } catch (error: unknown) {
      this.normalizeError(error);
    }
  }

  // Leads
  async getLeads(filters?: Record<string, string | number | undefined>) {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params.append(key, String(value));
        }
      });
    }
    const query = params.toString();
    return this.request<{
      leads: Record<string, unknown>[];
      pagination?: { page: number; limit: number; total: number; totalPages: number };
    }>(`/api/v1/leads${query ? `?${query}` : ''}`);
  }

  async getLead(id: string) {
    return this.request<Record<string, unknown>>(`/api/v1/leads/${id}`);
  }

  async createLead(data: Record<string, unknown>) {
    return this.request<Record<string, unknown>>('/api/v1/leads', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateLead(id: string, data: Record<string, unknown>) {
    return this.request<Record<string, unknown>>(`/api/v1/leads/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  /**
   * Exclui um lead. Quando o perfil do usuário exige aprovação de exclusão
   * (Upgrade RD P1, req 16), o backend NÃO deleta: responde 202 com o envelope
   * `{ status: 202, data: { approvalId, pending: true } }`. O caller deve inspecionar
   * o retorno (via `extractPendingApproval`) e, se pendente, mostrar o toast de
   * aprovação em vez de remover o item da lista.
   */
  async deleteLead(id: string) {
    return this.request<
      Record<string, never> | { status: 202; data: PendingApprovalResult }
    >(`/api/v1/leads/${id}`, {
      method: 'DELETE',
    });
  }

  /**
   * Converte o lead em oportunidade (specs/leads-oportunidade req. 17-18):
   * cria o Deal com os dados copiados e encerra o lead com motivo
   * CONVERTIDO_EM_OPORTUNIDADE. Idempotente — se já convertido, devolve
   * alreadyConverted=true com o deal existente.
   */
  async convertLeadToOpportunity(id: string) {
    return this.request<{
      status: number;
      data: {
        deal: { id: string; name: string };
        lead?: Record<string, unknown>;
        alreadyConverted: boolean;
      };
    }>(`/api/v1/leads/${id}/convert-to-opportunity`, { method: 'POST' });
  }

  /**
   * Cadastro rápido de CONTATO (Lead com isContact=true) vinculado a uma
   * empresa (specs/leads-oportunidade reqs. 4 e 36) — usado pelos quick-creates
   * inline (formulário de lead e participantes de atividade).
   */
  async createLeadContact(data: {
    name: string;
    companyId: string;
    position?: string;
    email?: string;
    phone?: string;
  }) {
    return this.request<{ status: number; data: Record<string, unknown> }>(
      '/api/v1/leads/contacts',
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );
  }

  /**
   * Transcreve um áudio (gravação ou arquivo) para texto via Whisper
   * (specs/leads-oportunidade req. 44-45). Multipart campo `audio`, ≤ 25 MB.
   */
  async transcribeAudio(audio: Blob, fileName = 'gravacao.webm'): Promise<{ text: string }> {
    const csrfToken = this.getCsrfToken();
    const headers: Record<string, string> = {};
    if (csrfToken) headers['x-csrf-token'] = csrfToken;
    const formData = new FormData();
    formData.append('audio', audio, fileName);
    const response = await fetch(`${this.baseURL}/api/v1/ai/transcribe`, {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'include',
    });
    if (!response.ok) {
      let errorData: Record<string, unknown>;
      try {
        errorData = await response.json();
      } catch {
        errorData = { error: response.statusText || 'Falha na transcrição' };
      }
      const message =
        (errorData.error as string) || (errorData.message as string) || 'Falha na transcrição';
      throw new ApiError(message, response.status, errorData);
    }
    const json = await response.json();
    return json.data ?? json;
  }

  async importLeads(data: { leads: Record<string, unknown>[]; skipDuplicateEmails?: boolean }) {
    return this.request<{ imported: number; skipped: number }>('/api/v1/leads/import', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async exportLeads(filters?: {
    status?: string;
    source?: string;
    search?: string;
    tagId?: string;
  }) {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
    }
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<{ leads: Record<string, unknown>[] }>(`/api/v1/leads/export${query}`);
  }

  async getLeadDuplicates() {
    return this.request<{ duplicates: Record<string, unknown>[] }>('/api/v1/leads/duplicates');
  }

  async mergeLeads(primaryId: string, duplicateIds: string[]) {
    return this.request<{ id: string }>('/api/v1/leads/merge', {
      method: 'POST',
      body: JSON.stringify({ primaryId, duplicateIds }),
    });
  }

  async convertToContact(id: string) {
    return this.request<{ status: number; data: Record<string, unknown> }>(
      `/api/v1/leads/${id}/convert`,
      {
        method: 'POST',
      }
    );
  }

  async revertToLead(id: string) {
    return this.request<{ status: number; data: Record<string, unknown> }>(
      `/api/v1/leads/${id}/revert`,
      {
        method: 'POST',
      }
    );
  }

  /**
   * Ação em massa sobre leads. Quando o perfil exige aprovação (bulk) ou não tem a
   * capability, o backend responde 202 `{ status: 202, data: { approvalId, pending } }`
   * em vez de aplicar (Upgrade RD P1, reqs 15/16). O caller deve tratar o caso pendente
   * (via `extractPendingApproval`/`handlePendingApproval`) e NÃO seguir o fluxo de sucesso.
   */
  async bulkUpdateLeads(ids: string[], action: string, payload?: Record<string, unknown>) {
    return this.request<
      | { status: number; data: { affected: number; action: string } }
      | { status: 202; data: PendingApprovalResult }
    >('/api/v1/leads/bulk', {
      method: 'PATCH',
      body: JSON.stringify({ ids, action, payload }),
    });
  }

  // Suggestions (feedback in-app)
  async getSuggestions(filters?: {
    status?: SuggestionStatus;
    type?: SuggestionType;
    scope?: 'mine' | 'all';
  }) {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, String(value));
      });
    }
    const qs = params.toString();
    return this.request<{ status: number; data: Suggestion[] }>(
      `/api/v1/suggestions${qs ? `?${qs}` : ''}`
    );
  }

  async getSuggestion(id: string) {
    return this.request<{ status: number; data: Suggestion }>(`/api/v1/suggestions/${id}`);
  }

  async createSuggestion(data: {
    title: string;
    description: string;
    route?: string | null;
    type: SuggestionType;
  }) {
    return this.request<{ status: number; data: Suggestion }>('/api/v1/suggestions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateSuggestion(
    id: string,
    data: { status?: SuggestionStatus; adminNotes?: string | null }
  ) {
    return this.request<{ status: number; data: Suggestion }>(`/api/v1/suggestions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteSuggestion(id: string) {
    return this.request<{ status: number; data: { deleted: boolean } }>(
      `/api/v1/suggestions/${id}`,
      { method: 'DELETE' }
    );
  }

  // ── Gestão de Negócios (RD parity) — ações de status da negociação ──
  async markDealWon(id: string) {
    return this.request<{ status: number; data: Record<string, unknown> }>(
      `/api/v1/deals/${id}/win`,
      { method: 'POST' }
    );
  }
  async markDealLost(id: string, lostReasonId: string) {
    return this.request<{ status: number; data: Record<string, unknown> }>(
      `/api/v1/deals/${id}/lose`,
      { method: 'POST', body: JSON.stringify({ lostReasonId }) }
    );
  }
  async pauseDeal(id: string) {
    return this.request<{ status: number; data: Record<string, unknown> }>(
      `/api/v1/deals/${id}/pause`,
      { method: 'POST' }
    );
  }
  async resumeDeal(id: string) {
    return this.request<{ status: number; data: Record<string, unknown> }>(
      `/api/v1/deals/${id}/resume`,
      { method: 'POST' }
    );
  }

  // ── Múltiplos contatos da negociação ──
  async getDealContacts(id: string) {
    return this.request<{ status: number; data: DealContact[] }>(`/api/v1/deals/${id}/contacts`);
  }
  async addDealContact(id: string, data: { leadId: string; roleInDeal?: string | null }) {
    return this.request<{ status: number; data: DealContact }>(`/api/v1/deals/${id}/contacts`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
  async removeDealContact(id: string, contactId: string) {
    return this.request<{ status: number; data: { deleted: boolean } }>(
      `/api/v1/deals/${id}/contacts/${contactId}`,
      { method: 'DELETE' }
    );
  }

  // ── Listas de configuração (Motivos de perda / Fontes / Campanhas de origem) ──
  async getLostReasons(activeOnly = false) {
    return this.request<{ status: number; data: ConfigItem[] }>(
      `/api/v1/lost-reasons${activeOnly ? '?active=true' : ''}`
    );
  }
  async createLostReason(label: string) {
    return this.request<{ status: number; data: ConfigItem }>('/api/v1/lost-reasons', {
      method: 'POST',
      body: JSON.stringify({ label }),
    });
  }
  async updateLostReason(id: string, data: { label?: string; active?: boolean; order?: number }) {
    return this.request<{ status: number; data: ConfigItem }>(`/api/v1/lost-reasons/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }
  async deleteLostReason(id: string) {
    return this.request<{ status: number; data: { deleted: boolean } }>(
      `/api/v1/lost-reasons/${id}`,
      { method: 'DELETE' }
    );
  }
  async getDealSources(activeOnly = false) {
    return this.request<{ status: number; data: ConfigItem[] }>(
      `/api/v1/deal-sources${activeOnly ? '?active=true' : ''}`
    );
  }
  async createDealSource(name: string) {
    return this.request<{ status: number; data: ConfigItem }>('/api/v1/deal-sources', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }
  async updateDealSource(id: string, data: { name?: string; active?: boolean; order?: number }) {
    return this.request<{ status: number; data: ConfigItem }>(`/api/v1/deal-sources/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }
  async deleteDealSource(id: string) {
    return this.request<{ status: number; data: { deleted: boolean } }>(
      `/api/v1/deal-sources/${id}`,
      { method: 'DELETE' }
    );
  }
  async getOriginCampaigns(activeOnly = false) {
    return this.request<{ status: number; data: ConfigItem[] }>(
      `/api/v1/origin-campaigns${activeOnly ? '?active=true' : ''}`
    );
  }
  async createOriginCampaign(name: string) {
    return this.request<{ status: number; data: ConfigItem }>('/api/v1/origin-campaigns', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }
  async updateOriginCampaign(
    id: string,
    data: { name?: string; active?: boolean; order?: number }
  ) {
    return this.request<{ status: number; data: ConfigItem }>(`/api/v1/origin-campaigns/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }
  async deleteOriginCampaign(id: string) {
    return this.request<{ status: number; data: { deleted: boolean } }>(
      `/api/v1/origin-campaigns/${id}`,
      { method: 'DELETE' }
    );
  }

  // Tasks
  async getTasks(filters?: Record<string, string | number | undefined>) {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params.append(key, String(value));
        }
      });
    }
    const query = params.toString();
    return this.request<{
      tasks: Record<string, unknown>[];
      pagination?: { page: number; limit: number; total: number; totalPages: number };
    }>(`/api/v1/tasks${query ? `?${query}` : ''}`);
  }

  async getTask(id: string) {
    return this.request<Record<string, unknown>>(`/api/v1/tasks/${id}`);
  }

  async createTask(data: Record<string, unknown>) {
    return this.request<Record<string, unknown>>('/api/v1/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateTask(id: string, data: Record<string, unknown>) {
    return this.request<Record<string, unknown>>(`/api/v1/tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // Registra o desfecho de uma ação da agenda (desdobramento): loga interação + conclui/reagenda.
  async registerTaskAction(
    id: string,
    data: {
      outcome: 'REALIZADA' | 'SEM_CONTATO' | 'REAGENDAR';
      note?: string;
      date?: string;
      newDueDate?: string;
    }
  ) {
    return this.request<Record<string, unknown>>(`/api/v1/tasks/${id}/register`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Exclui uma tarefa. Igual a `deleteLead`: pode responder 202 com envelope de
   * aprovação pendente (Upgrade RD P1, req 16) — o caller deve tratar antes de
   * remover o item da lista.
   */
  async deleteTask(id: string) {
    return this.request<
      Record<string, never> | { status: 202; data: PendingApprovalResult }
    >(`/api/v1/tasks/${id}`, {
      method: 'DELETE',
    });
  }

  // Tags
  async getTags() {
    return this.request<Array<{ id: string; name: string; color: string; createdAt: string }>>(
      '/api/v1/tags'
    );
  }

  async getTag(id: string) {
    return this.request<{ id: string; name: string; color: string; createdAt: string }>(
      `/api/v1/tags/${id}`
    );
  }

  async createTag(data: { name: string; color?: string }) {
    return this.request<{ id: string; name: string; color: string; createdAt: string }>(
      '/api/v1/tags',
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );
  }

  async updateTag(id: string, data: { name?: string; color?: string }) {
    return this.request<{ id: string; name: string; color: string; createdAt: string }>(
      `/api/v1/tags/${id}`,
      {
        method: 'PUT',
        body: JSON.stringify(data),
      }
    );
  }

  async deleteTag(id: string) {
    return this.request(`/api/v1/tags/${id}`, {
      method: 'DELETE',
    });
  }

  // Subscriptions
  async getCurrentSubscription() {
    return this.request<Record<string, unknown>>('/api/v1/subscriptions/current');
  }

  async getPlans() {
    return this.request<Array<Record<string, unknown>>>('/api/v1/subscriptions/plans');
  }

  // Automations
  async getAutomations(filters?: Record<string, string | number | undefined>) {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params.append(key, String(value));
        }
      });
    }
    const query = params.toString();
    return this.request<Record<string, unknown>>(`/api/v1/automations${query ? `?${query}` : ''}`);
  }

  async getAutomation(id: string) {
    return this.request<Record<string, unknown>>(`/api/v1/automations/${id}`);
  }

  async createAutomation(data: Record<string, unknown>) {
    return this.request<Record<string, unknown>>('/api/v1/automations', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateAutomation(id: string, data: Record<string, unknown>) {
    return this.request<Record<string, unknown>>(`/api/v1/automations/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteAutomation(id: string) {
    return this.request(`/api/v1/automations/${id}`, {
      method: 'DELETE',
    });
  }

  async getAutomationLogs(id: string, limit?: number) {
    const query = limit ? `?limit=${limit}` : '';
    return this.request<Record<string, unknown>>(`/api/v1/automations/${id}/logs${query}`);
  }

  async getAutomationStats(id: string) {
    return this.request<Record<string, unknown>>(`/api/v1/automations/${id}/stats`);
  }

  // Tenant-wide automation logs with full filtering
  async getAutomationLogsAll(filters?: {
    status?: string;
    leadId?: string;
    stepType?: string;
    automationId?: string;
    executionId?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
    sort?: 'asc' | 'desc';
  }) {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== '') params.set(key, String(value));
      });
    }
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<Record<string, unknown>>(`/api/v1/automation-logs${query}`);
  }

  async getLogsByExecution(executionId: string) {
    return this.request<Record<string, unknown>>(
      `/api/v1/automation-logs/execution/${executionId}`
    );
  }

  async getAutomationLogStats(filters?: { from?: string; to?: string }) {
    const params = new URLSearchParams();
    if (filters?.from) params.set('from', filters.from);
    if (filters?.to) params.set('to', filters.to);
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<Record<string, unknown>>(`/api/v1/automation-logs/stats${query}`);
  }

  async executeAutomation(id: string, leadId: string) {
    return this.request<Record<string, unknown>>(`/api/v1/automations/${id}/execute`, {
      method: 'POST',
      body: JSON.stringify({ leadId }),
    });
  }

  // WhatsApp Connections
  async getWhatsAppConnections() {
    return this.request<Array<Record<string, unknown>>>('/api/v1/whatsapp');
  }

  async getWhatsAppConnection(id: string) {
    return this.request<Record<string, unknown>>(`/api/v1/whatsapp/${id}`);
  }

  async createWhatsAppConnection(data: Record<string, unknown>) {
    return this.request<Record<string, unknown>>('/api/v1/whatsapp', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateWhatsAppConnection(id: string, data: Record<string, unknown>) {
    return this.request<Record<string, unknown>>(`/api/v1/whatsapp/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteWhatsAppConnection(id: string) {
    return this.request(`/api/v1/whatsapp/${id}`, {
      method: 'DELETE',
    });
  }

  async sendWhatsAppMessage(data: {
    connectionId: string;
    to: string;
    type?: 'text' | 'template' | 'image' | 'document' | 'audio';
    content: string;
    templateName?: string;
    templateParams?: string[];
    mediaUrl?: string;
    leadId?: string;
    // Upgrade RD P3 (req 23) — vincula a mensagem à timeline do deal/empresa.
    dealId?: string;
    companyId?: string;
  }) {
    return this.request<{ messageId?: string; success: boolean }>('/api/v1/whatsapp/send', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getWhatsAppTemplates(connectionId: string) {
    return this.request<Array<Record<string, unknown>>>(
      `/api/v1/whatsapp/${connectionId}/templates`
    );
  }

  // Email Configs
  async getEmailConfigs() {
    return this.request<Array<Record<string, unknown>>>('/api/v1/email/configs');
  }

  async getEmailConfig(id: string) {
    return this.request<Record<string, unknown>>(`/api/v1/email/configs/${id}`);
  }

  async createEmailConfig(data: Record<string, unknown>) {
    return this.request<Record<string, unknown>>('/api/v1/email/configs', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateEmailConfig(id: string, data: Record<string, unknown>) {
    return this.request<Record<string, unknown>>(`/api/v1/email/configs/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteEmailConfig(id: string) {
    return this.request(`/api/v1/email/configs/${id}`, {
      method: 'DELETE',
    });
  }

  async sendEmail(data: {
    configId: string;
    to: string;
    subject: string;
    html: string;
    text?: string;
    leadId?: string;
  }) {
    return this.request<{ messageId?: string; success: boolean }>('/api/v1/email/send', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async sendBulkEmail(data: {
    configId: string;
    recipients: Array<{ email: string; leadId?: string; variables?: Record<string, string> }>;
    subject: string;
    html: string;
    text?: string;
  }) {
    return this.request<{ sent: number; failed: number }>('/api/v1/email/send-bulk', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async scheduleBulkEmail(data: {
    configId: string;
    recipients: Array<{ email: string; leadId?: string; variables?: Record<string, string> }>;
    subject: string;
    html: string;
    text?: string;
    scheduledAt: string;
  }) {
    return this.request<{
      campaignId: string;
      scheduledAt: string;
      recipientCount: number;
      status: string;
    }>('/api/v1/email/schedule', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async cancelScheduledCampaign(campaignId: string) {
    return this.request<{ campaignId: string; status: string }>(
      `/api/v1/email/schedule/${campaignId}`,
      {
        method: 'DELETE',
      }
    );
  }

  async getScheduledCampaignStatus(campaignId: string) {
    return this.request<{ campaignId: string; state: string }>(
      `/api/v1/email/schedule/${campaignId}`
    );
  }

  async sendTestEmail(configId: string, toEmail: string) {
    return this.request<{ success: boolean; message?: string }>(
      `/api/v1/email/configs/${configId}/test`,
      {
        method: 'POST',
        body: JSON.stringify({ toEmail }),
      }
    );
  }

  // API Keys
  // List returns each key with `scopes: string[]` (empty array = full access / legacy).
  async getApiKeys() {
    return this.request<ApiKeyListItem[]>('/api/v1/api-keys');
  }

  // Create body: { name, expiresAt?, scopes?: string[] }; returns the full key once.
  async createApiKey(data: { name: string; expiresAt?: string; scopes?: string[] }) {
    return this.request<ApiKeyCreated>('/api/v1/api-keys', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteApiKey(id: string) {
    return this.request<void>(`/api/v1/api-keys/${id}`, { method: 'DELETE' });
  }

  // Outgoing Webhooks
  async getWebhookEvents() {
    return this.request<string[]>('/api/v1/outgoing-webhooks/events');
  }

  async getOutgoingWebhooks() {
    return this.request<OutgoingWebhook[]>('/api/v1/outgoing-webhooks');
  }

  // Create body: { url, events, secret } — secret must be non-empty (validated client-side too).
  async createOutgoingWebhook(data: { url: string; events: string[]; secret: string }) {
    return this.request<OutgoingWebhook>('/api/v1/outgoing-webhooks', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateOutgoingWebhook(
    id: string,
    data: { url?: string; events?: string[]; active?: boolean }
  ) {
    return this.request<OutgoingWebhook>(`/api/v1/outgoing-webhooks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteOutgoingWebhook(id: string) {
    return this.request<void>(`/api/v1/outgoing-webhooks/${id}`, { method: 'DELETE' });
  }

  async getWebhookLogs(webhookId: string) {
    return this.request<OutgoingWebhookLog[]>(`/api/v1/outgoing-webhooks/${webhookId}/logs`);
  }

  async testOutgoingWebhook(id: string, event?: string) {
    return this.request<{
      success: boolean;
      statusCode?: number;
      responseTime?: number;
      payload?: Record<string, unknown>;
    }>(`/api/v1/outgoing-webhooks/${id}/test`, {
      method: 'POST',
      body: JSON.stringify(event ? { event } : {}),
    });
  }

  // Custom Fields
  async getCustomFields(
    activeOnly?: boolean,
    entity?: 'DEAL' | 'COMPANY' | 'CONTACT' | 'PRODUCT'
  ) {
    const params = new URLSearchParams();
    if (activeOnly) params.set('active', 'true');
    if (entity) params.set('entity', entity);
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<Array<Record<string, unknown>>>(`/api/v1/custom-fields${query}`);
  }

  async getCustomField(id: string) {
    return this.request<Record<string, unknown>>(`/api/v1/custom-fields/${id}`);
  }

  async createCustomField(data: Record<string, unknown>) {
    return this.request<Record<string, unknown>>('/api/v1/custom-fields', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateCustomField(id: string, data: Record<string, unknown>) {
    return this.request<Record<string, unknown>>(`/api/v1/custom-fields/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteCustomField(id: string) {
    return this.request(`/api/v1/custom-fields/${id}`, {
      method: 'DELETE',
    });
  }

  // Interactions
  async getInteractions(filters?: Record<string, string | number | undefined>) {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params.append(key, String(value));
        }
      });
    }
    const query = params.toString();
    return this.request<Record<string, unknown>>(`/api/v1/interactions${query ? `?${query}` : ''}`);
  }

  async getLeadInteractions(leadId: string) {
    return this.request<Array<Record<string, unknown>>>(`/api/v1/interactions/leads/${leadId}`);
  }

  async createInteraction(data: Record<string, unknown>) {
    return this.request<Record<string, unknown>>('/api/v1/interactions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteInteraction(id: string) {
    return this.request(`/api/v1/interactions/${id}`, {
      method: 'DELETE',
    });
  }

  async getInboxConversations(filters?: {
    channel?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params.append(key, String(value));
        }
      });
    }
    const query = params.toString();
    return this.request<Record<string, unknown>>(
      `/api/v1/interactions/inbox${query ? `?${query}` : ''}`
    );
  }

  // Funnels (Pipeline)
  async getFunnels(type?: 'LEAD' | 'DEAL') {
    const query = type ? `?type=${type}` : '';
    return this.request<Record<string, unknown>>(`/api/v1/funnels${query}`);
  }

  async getDefaultFunnel(type?: 'LEAD' | 'DEAL') {
    const query = type ? `?type=${type}` : '';
    return this.request<Record<string, unknown>>(`/api/v1/funnels/default${query}`);
  }

  async getFunnel(id: string) {
    return this.request<Record<string, unknown>>(`/api/v1/funnels/${id}`);
  }

  async createFunnel(data: {
    name: string;
    type?: 'LEAD' | 'DEAL';
    columns?: Array<{ title: string; color?: string; mappedStatus?: string }>;
  }) {
    return this.request<Record<string, unknown>>('/api/v1/funnels', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateFunnel(id: string, data: { name?: string; order?: number }) {
    return this.request<Record<string, unknown>>(`/api/v1/funnels/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteFunnel(id: string) {
    return this.request(`/api/v1/funnels/${id}`, {
      method: 'DELETE',
    });
  }

  async addFunnelColumn(
    funnelId: string,
    data: { title: string; color?: string; mappedStatus?: string }
  ) {
    return this.request<Record<string, unknown>>(`/api/v1/funnels/${funnelId}/columns`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateFunnelColumn(
    funnelId: string,
    columnId: string,
    data: { title?: string; color?: string; order?: number }
  ) {
    return this.request<Record<string, unknown>>(
      `/api/v1/funnels/${funnelId}/columns/${columnId}`,
      {
        method: 'PUT',
        body: JSON.stringify(data),
      }
    );
  }

  async reorderFunnelColumns(funnelId: string, columnIds: string[]) {
    return this.request<Record<string, unknown>>(`/api/v1/funnels/${funnelId}/columns/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ columnIds }),
    });
  }

  async deleteFunnelColumn(funnelId: string, columnId: string) {
    return this.request(`/api/v1/funnels/${funnelId}/columns/${columnId}`, {
      method: 'DELETE',
    });
  }

  async moveLead(data: { leadId: string; targetColumnId: string; position: number }) {
    return this.request<Record<string, unknown>>('/api/v1/funnels/move-lead', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async moveDeal(data: { dealId: string; targetColumnId: string; position: number }) {
    return this.request<Record<string, unknown>>('/api/v1/funnels/move-deal', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Notifications
  async getNotifications(filters?: Record<string, string | number | undefined>) {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params.append(key, String(value));
        }
      });
    }
    const query = params.toString();
    return this.request<Record<string, unknown>>(
      `/api/v1/notifications${query ? `?${query}` : ''}`
    );
  }

  async getUnreadNotificationsCount() {
    return this.request<{ count: number }>('/api/v1/notifications/unread/count');
  }

  async markNotificationAsRead(id: string) {
    return this.request<{ success: boolean }>(`/api/v1/notifications/${id}/read`, {
      method: 'PUT',
    });
  }

  async markAllNotificationsAsRead() {
    return this.request<{ success: boolean }>('/api/v1/notifications/read-all', {
      method: 'PUT',
    });
  }

  async deleteNotification(id: string) {
    return this.request(`/api/v1/notifications/${id}`, {
      method: 'DELETE',
    });
  }

  // ========================
  // Scoring Rules
  // ========================

  async getScoringRules() {
    return this.request<Record<string, unknown>>('/api/v1/scoring-rules');
  }

  async getDefaultScoringRules() {
    return this.request<Record<string, unknown>>('/api/v1/scoring-rules/default');
  }

  async getScoringRule(id: string) {
    return this.request<Record<string, unknown>>(`/api/v1/scoring-rules/${id}`);
  }

  async createScoringRule(data: {
    name: string;
    eventType: string;
    points: number;
    description?: string;
    conditions?: Record<string, unknown>;
  }) {
    return this.request<Record<string, unknown>>('/api/v1/scoring-rules', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateScoringRule(
    id: string,
    data: {
      name?: string;
      eventType?: string;
      points?: number;
      description?: string | null;
      active?: boolean;
      conditions?: Record<string, unknown> | null;
    }
  ) {
    return this.request<Record<string, unknown>>(`/api/v1/scoring-rules/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteScoringRule(id: string) {
    return this.request(`/api/v1/scoring-rules/${id}`, {
      method: 'DELETE',
    });
  }

  async recalculateAllScores() {
    return this.request<{ updated: number }>('/api/v1/scoring-rules/recalculate', {
      method: 'POST',
    });
  }

  async recalculateLeadScore(leadId: string) {
    return this.request<{ score: number }>(`/api/v1/scoring-rules/recalculate/${leadId}`, {
      method: 'POST',
    });
  }

  async getScoreBreakdown(leadId: string) {
    return this.request<Record<string, unknown>>(`/api/v1/scoring-rules/breakdown/${leadId}`);
  }

  // ========================
  // Goals
  // ========================

  async getGoals(params?: { userId?: string; teamId?: string; month?: number; year?: number }) {
    const qs = params
      ? new URLSearchParams(
          Object.fromEntries(
            Object.entries(params)
              .filter(([, v]) => v !== undefined)
              .map(([k, v]) => [k, String(v)])
          )
        ).toString()
      : '';
    return this.request<{ status: number; data: GovernanceGoal[] }>(
      `/api/v1/goals${qs ? `?${qs}` : ''}`
    );
  }

  /**
   * Upsert de meta — individual (userId) OU de equipe (teamId), exatamente um
   * (validado no backend). Upgrade RD P1: aceita `teamId` além de `userId`.
   */
  async upsertGoal(data: UpsertGoalInput) {
    return this.request<{ status: number; data: GovernanceGoal }>('/api/v1/goals', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteGoal(id: string) {
    return this.request<void>(`/api/v1/goals/${id}`, { method: 'DELETE' });
  }

  // ========================
  // Reports
  // ========================

  async getReports() {
    return this.request<Array<Record<string, unknown>>>('/api/v1/reports');
  }

  async getReport(id: string) {
    return this.request<Record<string, unknown>>(`/api/v1/reports/${id}`);
  }

  async createReport(data: {
    name: string;
    description?: string;
    type?: string;
    config?: Record<string, unknown>;
  }) {
    return this.request<Record<string, unknown>>('/api/v1/reports', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateReport(
    id: string,
    data: { name?: string; description?: string; type?: string; config?: Record<string, unknown> }
  ) {
    return this.request<Record<string, unknown>>(`/api/v1/reports/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteReport(id: string) {
    return this.request(`/api/v1/reports/${id}`, {
      method: 'DELETE',
    });
  }

  async getReportMetrics(params?: { from?: string; to?: string }) {
    const query = new URLSearchParams();
    if (params?.from) query.set('from', params.from);
    if (params?.to) query.set('to', params.to);
    const qs = query.toString();
    return this.request<Record<string, unknown>>(`/api/v1/reports/metrics${qs ? `?${qs}` : ''}`);
  }

  // ========================
  // Users (Team Management)
  // ========================

  async getUsers() {
    return this.request<
      Array<{
        id: string;
        name: string;
        email: string;
        role: string;
        status: string;
        commercialFunction: string | null;
        createdAt: string;
        lastLoginAt: string | null;
      }>
    >('/api/v1/users');
  }

  async updateUser(
    id: string,
    data: {
      // Nome corrigível por ADMIN/GESTOR; e-mail (identidade de login) só por ADMIN.
      name?: string;
      email?: string;
      role?: string;
      status?: string;
      commercialFunction?: string | null;
      // Times & governança (Upgrade RD P1): vínculo com equipe/perfil (ADMIN/GESTOR).
      teamId?: string | null;
      permissionProfileId?: string | null;
    }
  ) {
    return this.request<{ id: string; name: string; email: string; role: string }>(
      `/api/v1/users/${id}`,
      {
        method: 'PUT',
        body: JSON.stringify(data),
      }
    );
  }

  // ========================
  // Invitations (Team Management)
  // ========================

  async getInvitations() {
    return this.request<
      Array<{ id: string; email: string; role: string; status: string; createdAt: string }>
    >('/api/v1/invitations');
  }

  async createInvitation(data: { email: string; role: string }) {
    return this.request<{
      id: string;
      email: string;
      role: string;
      status: string;
      emailSent: boolean;
      invitationLink?: string;
    }>('/api/v1/invitations', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async resendInvitation(id: string) {
    return this.request<{ emailSent: boolean; invitationLink?: string }>(
      `/api/v1/invitations/${id}/resend`,
      {
        method: 'POST',
      }
    );
  }

  async cancelInvitation(id: string) {
    return this.request<void>(`/api/v1/invitations/${id}`, {
      method: 'DELETE',
    });
  }

  // ========================
  // Payments (Backend API)
  // ========================

  async createPaymentIntent(data: {
    planId: string;
    planType: string;
    amount: number;
    method: string;
    billingCycle: string;
  }) {
    return this.request<Record<string, unknown>>('/api/v1/payments/intent', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async processCardPayment(data: {
    paymentId: string;
    token: string;
    paymentMethodId: string;
    issuerId?: string;
    installments: number;
  }) {
    return this.request<Record<string, unknown>>('/api/v1/payments/process-card', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getPaymentHistory() {
    return this.request<Array<Record<string, unknown>>>('/api/v1/payments/history');
  }

  // ========================
  // Deals
  // ========================

  async getDeals(filters?: Record<string, string | number | undefined>) {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params.append(key, String(value));
        }
      });
    }
    const query = params.toString();
    return this.request<{
      deals: Record<string, unknown>[];
      pagination?: { page: number; limit: number; total: number; totalPages: number };
    }>(`/api/v1/deals${query ? `?${query}` : ''}`);
  }

  async getDeal(id: string) {
    return this.request<Record<string, unknown>>(`/api/v1/deals/${id}`);
  }

  async createDeal(data: Record<string, unknown>) {
    return this.request<Record<string, unknown>>('/api/v1/deals', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateDeal(id: string, data: Record<string, unknown>) {
    return this.request<Record<string, unknown>>(`/api/v1/deals/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  /**
   * Exclui uma negociação. Pode responder 202 com envelope de aprovação pendente
   * (Upgrade RD P1, req 16) — o caller deve tratar antes de remover o item da lista.
   */
  async deleteDeal(id: string) {
    return this.request<
      Record<string, never> | { status: 202; data: PendingApprovalResult }
    >(`/api/v1/deals/${id}`, {
      method: 'DELETE',
    });
  }

  async getDealStats() {
    return this.request<{ data: Record<string, unknown> }>('/api/v1/deals/stats');
  }

  async getDealForecast(filters?: { months?: number; assignedTo?: string; stage?: string }) {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) params.set(key, String(value));
      });
    }
    const qs = params.toString();
    return this.request<{ status: number; data: import('../../types').ForecastData }>(
      `/api/v1/deals/forecast${qs ? `?${qs}` : ''}`
    );
  }

  async getDealTrend(months?: number) {
    const qs = months ? `?months=${months}` : '';
    return this.request<{ status: number; data: import('../../types').TrendData }>(
      `/api/v1/deals/trend${qs}`
    );
  }

  async getFunnelConversion(filters?: {
    from?: string;
    to?: string;
    source?: string;
    assignedTo?: string;
    /** Upgrade RD P0 — filtros por fonte/campanha da negociação (req 5). */
    sourceId?: string;
    originCampaignId?: string;
    /** Upgrade RD P0 — filtro por segmento de empresa (req 8). */
    segmentId?: string;
  }) {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) params.set(key, String(value));
      });
    }
    const qs = params.toString();
    return this.request<{ status: number; data: import('../../types').FunnelConversionData }>(
      `/api/v1/reports/funnel-conversion${qs ? `?${qs}` : ''}`
    );
  }

  async getDealInteractions(dealId: string) {
    return this.request<Array<Record<string, unknown>>>(`/api/v1/interactions?dealId=${dealId}`);
  }

  // ========================
  // Next Action (AI Assistant)
  // ========================

  async getLeadNextAction(leadId: string) {
    return this.request<{ status: number; data: import('../../types').NextAction }>(
      `/api/v1/leads/${leadId}/next-action`
    );
  }

  async getDealNextAction(dealId: string) {
    return this.request<{ status: number; data: import('../../types').NextAction }>(
      `/api/v1/deals/${dealId}/next-action`
    );
  }

  async getActionSummary(limit = 5) {
    return this.request<{ status: number; data: import('../../types').ActionSummaryItem[] }>(
      `/api/v1/deals/action-summary?limit=${limit}`
    );
  }

  // ========================
  // Companies
  // ========================

  async getCompanies(filters?: Record<string, string | number | undefined>) {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params.append(key, String(value));
        }
      });
    }
    const query = params.toString();
    return this.request<{
      companies: Record<string, unknown>[];
      pagination?: { page: number; limit: number; total: number; totalPages: number };
    }>(`/api/v1/companies${query ? `?${query}` : ''}`);
  }

  async getCompany(id: string) {
    return this.request<Record<string, unknown>>(`/api/v1/companies/${id}`);
  }

  async createCompany(data: Record<string, unknown>) {
    return this.request<Record<string, unknown>>('/api/v1/companies', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateCompany(id: string, data: Record<string, unknown>) {
    return this.request<Record<string, unknown>>(`/api/v1/companies/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  /**
   * Exclui uma empresa. Pode responder 202 com envelope de aprovação pendente
   * (Upgrade RD P1, req 16) — o caller deve tratar antes de remover o item da lista.
   */
  async deleteCompany(id: string) {
    return this.request<
      Record<string, never> | { status: 202; data: PendingApprovalResult }
    >(`/api/v1/companies/${id}`, {
      method: 'DELETE',
    });
  }

  async getCompanyCount() {
    return this.request<{ data: { count: number } }>('/api/v1/companies/stats/count');
  }

  // Widget "Contratos a vencer" — janela = maior limiar configurado no tenant.
  async getExpiringContracts() {
    return this.request<{
      data: {
        companies: Array<{
          id: string;
          name: string;
          contractHolder: 'NOS' | 'CONCORRENTE';
          contractCompetitor?: string | null;
          contractEndDate: string;
          assignedUser?: { id: string; name: string } | null;
        }>;
        windowDays: number;
      };
    }>('/api/v1/companies/contracts/expiring');
  }

  // ========================
  // Google Calendar Integration
  // ========================

  async getGoogleCalendarAuthUrl() {
    return this.request<{ url: string }>('/api/v1/integrations/google/auth-url');
  }

  async getGoogleCalendarStatus() {
    return this.request<{
      connected: boolean;
      email?: string;
      syncEnabled?: boolean;
      lastSyncAt?: string | null;
      connectedAt?: string;
    }>('/api/v1/integrations/google/status');
  }

  async toggleGoogleCalendarSync(syncEnabled: boolean) {
    return this.request<{ syncEnabled: boolean }>('/api/v1/integrations/google/sync-toggle', {
      method: 'PUT',
      body: JSON.stringify({ syncEnabled }),
    });
  }

  async syncGoogleCalendar() {
    return this.request<{ synced: number; total: number }>('/api/v1/integrations/google/sync', {
      method: 'POST',
    });
  }

  async disconnectGoogleCalendar() {
    return this.request<{ disconnected: boolean }>('/api/v1/integrations/google/disconnect', {
      method: 'DELETE',
    });
  }

  // ========================
  // Export (CSV/XLSX/JSON downloads)
  // ========================

  private async downloadExport(
    entity: 'leads' | 'deals' | 'tasks',
    format: 'json' | 'csv' | 'xlsx',
    filters?: Record<string, string | number | undefined>
  ): Promise<Blob> {
    const params = new URLSearchParams();
    params.set('format', format);
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          params.set(key, String(value));
        }
      });
    }
    const url = `${this.baseURL}/api/v1/exports/${entity}?${params.toString()}`;
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Export failed' }));
      throw new ApiError(errorData.error || 'Export failed', response.status, errorData);
    }
    return response.blob();
  }

  async exportLeadsDownload(
    format: 'json' | 'csv' | 'xlsx',
    filters?: {
      status?: string;
      source?: string;
      search?: string;
      tagId?: string;
      assignedTo?: string;
    }
  ): Promise<Blob> {
    return this.downloadExport('leads', format, filters);
  }

  async exportDealsDownload(
    format: 'json' | 'csv' | 'xlsx',
    filters?: {
      stage?: string;
      search?: string;
      assignedTo?: string;
      leadId?: string;
      minValue?: number;
      maxValue?: number;
    }
  ): Promise<Blob> {
    return this.downloadExport('deals', format, filters);
  }

  async exportTasksDownload(
    format: 'json' | 'csv' | 'xlsx',
    filters?: {
      status?: string;
      priority?: string;
      search?: string;
      assignedTo?: string;
      leadId?: string;
      startDate?: string;
      endDate?: string;
    }
  ): Promise<Blob> {
    return this.downloadExport('tasks', format, filters);
  }

  async downloadInvoice(paymentId: string): Promise<Blob> {
    const response = await fetch(`${this.baseURL}/api/v1/payments/${paymentId}/invoice`, {
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error('Failed to download invoice');
    }
    return response.blob();
  }

  // ========================
  // AI Email Draft
  // ========================

  async generateEmailDraft(data: {
    leadId?: string;
    dealId?: string;
    templateType: import('../../types').DraftTemplateType;
    customInstructions?: string;
  }) {
    return this.request<{ status: number; data: import('../../types').EmailDraft }>(
      '/api/v1/ai/email-draft',
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );
  }

  async getAITemplates() {
    return this.request<{ status: number; data: import('../../types').DraftTemplate[] }>(
      '/api/v1/ai/templates'
    );
  }

  async getAIConfig() {
    return this.request<{ status: number; data: import('../../types').AIConfig }>(
      '/api/v1/ai/config'
    );
  }

  async testAIConnection() {
    return this.request<{ status: number; data: import('../../types').AIConnectionTest }>(
      '/api/v1/ai/test-connection',
      {
        method: 'POST',
      }
    );
  }

  // ========================
  // AI Sales Assistant
  // ========================

  /**
   * Gating check (req 33). When `enabled` is false the frontend hides all AI
   * components and makes no further AI calls.
   */
  async getAIStatus() {
    const res = await this.request<{ status: number; data: import('../../types').AIStatus }>(
      '/api/v1/ai/status'
    );
    return res.data;
  }

  /**
   * Contextual lead summary (req 8). Pass `force` to bypass the server cache
   * (mirrors the "Atualizar" button); sent as `?refresh=true`.
   */
  async getLeadAISummary(leadId: string, force = false) {
    const query = force ? '?refresh=true' : '';
    const res = await this.request<{ status: number; data: import('../../types').AISummary }>(
      `/api/v1/leads/${leadId}/ai-summary${query}`
    );
    return res.data;
  }

  /**
   * Deal close-propensity score with top factors (req 22).
   */
  async getDealAIScore(dealId: string) {
    const res = await this.request<{ status: number; data: import('../../types').DealAIScore }>(
      `/api/v1/deals/${dealId}/ai-score`
    );
    return res.data;
  }

  /**
   * Opens the AI chat stream (req 30). Returns the raw Response so the caller
   * can read `response.body` as a ReadableStream of text chunks — the standard
   * `request()` helper is bypassed because the body is a streamed text response,
   * not a JSON envelope. Mirrors the cookie + CSRF auth handling used elsewhere.
   */
  async streamLeadAIChat(
    leadId: string,
    body: { message: string; history: import('../../types').ChatMessage[] },
    signal?: AbortSignal
  ): Promise<Response> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const csrfToken = this.getCsrfToken();
    if (csrfToken) headers['x-csrf-token'] = csrfToken;
    return fetch(`${this.baseURL}/api/v1/leads/${leadId}/ai-chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      credentials: 'include',
      signal,
    });
  }

  // ========================
  // Saved Views
  // ========================

  async getSavedViews(page?: string) {
    const query = page ? `?page=${encodeURIComponent(page)}` : '';
    return this.request<{ status: number; data: SavedView[] }>(`/api/v1/saved-views${query}`);
  }

  async createSavedView(data: {
    name: string;
    page: string;
    filters: Record<string, unknown>;
    columns?: Record<string, unknown> | null;
    isDefault?: boolean;
    isShared?: boolean;
    sortBy?: string | null;
    sortOrder?: string | null;
  }) {
    return this.request<{ status: number; data: SavedView }>('/api/v1/saved-views', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateSavedView(
    id: string,
    data: {
      name?: string;
      filters?: Record<string, unknown>;
      columns?: Record<string, unknown> | null;
      isDefault?: boolean;
      isShared?: boolean;
      sortBy?: string | null;
      sortOrder?: string | null;
    }
  ) {
    return this.request<{ status: number; data: SavedView }>(`/api/v1/saved-views/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteSavedView(id: string) {
    return this.request<{ status: number; data: { deleted: boolean } }>(
      `/api/v1/saved-views/${id}`,
      {
        method: 'DELETE',
      }
    );
  }

  // ── Campaigns (Email Campaigns) ─────────────────────
  async getCampaigns() {
    const res = await this.request<{ status: number; data: CampaignListItem[] }>(
      '/api/v1/campaigns'
    );
    return res.data;
  }

  async getCampaign(id: string) {
    const res = await this.request<{ status: number; data: Campaign }>(`/api/v1/campaigns/${id}`);
    return res.data;
  }

  async createCampaign(data: CampaignInput) {
    const res = await this.request<{ status: number; data: Campaign }>('/api/v1/campaigns', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return res.data;
  }

  async updateCampaign(id: string, data: Partial<CampaignInput>) {
    const res = await this.request<{ status: number; data: Campaign }>(`/api/v1/campaigns/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return res.data;
  }

  async deleteCampaign(id: string) {
    return this.request<void>(`/api/v1/campaigns/${id}`, { method: 'DELETE' });
  }

  async previewCampaignAudience(id: string) {
    const res = await this.request<{ status: number; data: CampaignAudiencePreview }>(
      `/api/v1/campaigns/${id}/preview-audience`
    );
    return res.data;
  }

  async scheduleCampaign(id: string, sendAt: string | null) {
    const res = await this.request<{ status: number; data: Campaign }>(
      `/api/v1/campaigns/${id}/schedule`,
      {
        method: 'POST',
        body: JSON.stringify({ sendAt }),
      }
    );
    return res.data;
  }

  async sendCampaignTestEmail(id: string) {
    const res = await this.request<{ status: number; data: { success: boolean } }>(
      `/api/v1/campaigns/${id}/test-email`,
      {
        method: 'POST',
      }
    );
    return res.data;
  }

  async getCampaignStats(id: string) {
    const res = await this.request<{ status: number; data: CampaignStats }>(
      `/api/v1/campaigns/${id}/stats`
    );
    return res.data;
  }

  // ── Email Templates ────────────────────────────────
  async getEmailTemplates() {
    return this.request<EmailTemplateListItem[]>('/api/v1/email-templates');
  }

  async getEmailTemplate(id: string) {
    return this.request<EmailTemplateDetail>(`/api/v1/email-templates/${id}`);
  }

  async createEmailTemplate(data: { name: string; subject: string; html: string }) {
    return this.request<EmailTemplateDetail>('/api/v1/email-templates', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateEmailTemplate(
    id: string,
    data: Partial<{ name: string; subject: string; html: string }>
  ) {
    return this.request<EmailTemplateDetail>(`/api/v1/email-templates/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteEmailTemplate(id: string) {
    return this.request<void>(`/api/v1/email-templates/${id}`, { method: 'DELETE' });
  }

  // ========================
  // Import Pro (data migration)
  // ========================

  /**
   * Posts a multipart import request (file + mapping JSON). Cannot reuse
   * `request()` because that forces Content-Type: application/json — FormData
   * must let the browser set the multipart boundary itself. Mirrors the
   * cookie + CSRF auth handling used by the rest of the client.
   */
  private async postImport<T>(
    entity: 'leads' | 'deals' | 'interactions' | 'companies' | 'contacts',
    formData: FormData,
    dryRun: boolean
  ): Promise<T> {
    const csrfToken = this.getCsrfToken();
    const headers: Record<string, string> = {};
    if (csrfToken) headers['x-csrf-token'] = csrfToken;
    const url = `${this.baseURL}/api/v1/import/${entity}${dryRun ? '?dry_run=true' : ''}`;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'include',
    });
    if (!response.ok) {
      let errorData: Record<string, unknown>;
      try {
        errorData = await response.json();
      } catch {
        errorData = { error: response.statusText || 'Import failed' };
      }
      const message =
        (errorData.error as string) || (errorData.message as string) || 'Falha na importação';
      throw new ApiError(message, response.status, errorData);
    }
    // Backend wraps every import response in the standard { status, data } envelope.
    // Unwrap .data so callers get the inner shape their signatures promise.
    const json = await response.json();
    return (json?.data ?? json) as T;
  }

  async importLeadsFile(
    file: File,
    mapping: Record<string, string>,
    dryRun: boolean,
    options?: { duplicateActions?: Record<string, ImportDuplicateAction> }
  ): Promise<ImportResult> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('mapping', JSON.stringify(mapping));
    if (options?.duplicateActions) {
      formData.append('duplicateActions', JSON.stringify(options.duplicateActions));
    }
    return this.postImport<ImportResult>('leads', formData, dryRun);
  }

  async importCompaniesFile(
    file: File,
    mapping: Record<string, string>,
    dryRun: boolean
  ): Promise<ImportResult> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('mapping', JSON.stringify(mapping));
    return this.postImport<ImportResult>('companies', formData, dryRun);
  }

  async importContactsFile(
    file: File,
    mapping: Record<string, string>,
    dryRun: boolean,
    options?: { duplicateActions?: Record<string, ImportDuplicateAction> }
  ): Promise<ImportResult> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('mapping', JSON.stringify(mapping));
    if (options?.duplicateActions) {
      formData.append('duplicateActions', JSON.stringify(options.duplicateActions));
    }
    return this.postImport<ImportResult>('contacts', formData, dryRun);
  }

  async importDealsFile(file: File, dryRun: boolean): Promise<ImportResult> {
    const formData = new FormData();
    formData.append('file', file);
    return this.postImport<ImportResult>('deals', formData, dryRun);
  }

  async importInteractionsFile(file: File, dryRun: boolean): Promise<ImportResult> {
    const formData = new FormData();
    formData.append('file', file);
    return this.postImport<ImportResult>('interactions', formData, dryRun);
  }

  async getImportBatches(): Promise<{ batches: ImportBatch[] }> {
    const res = await this.request<{ data: { batches: ImportBatch[] } }>('/api/v1/import/batches');
    return res.data;
  }

  async getImportBatch(batchId: string): Promise<{ batch: ImportBatch }> {
    const res = await this.request<{ data: { batch: ImportBatch } }>(
      `/api/v1/import/batches/${batchId}`
    );
    return res.data;
  }

  async rollbackImportBatch(batchId: string): Promise<{
    deleted: { leads: number; deals: number; interactions: number; companies: number };
  }> {
    const res = await this.request<{
      data: { deleted: { leads: number; deals: number; interactions: number; companies: number } };
    }>(`/api/v1/import/batches/${batchId}`, {
      method: 'DELETE',
    });
    return res.data;
  }

  // ── Deep Research (Pesquisa Profunda) ──────────────
  async getDeepResearches(filters?: Record<string, string | number | undefined>) {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          params.append(key, String(value));
        }
      });
    }
    const query = params.toString();
    return this.request<{
      items: DeepResearchListItem[];
      pagination: { page: number; limit: number; total: number; totalPages: number };
    }>(`/api/v1/deep-research${query ? `?${query}` : ''}`);
  }

  async getDeepResearch(id: string) {
    return this.request<DeepResearch>(`/api/v1/deep-research/${id}`);
  }

  async createDeepResearch(data: CreateDeepResearchInput) {
    return this.request<DeepResearch>('/api/v1/deep-research', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateDeepResearch(id: string, data: UpdateDeepResearchInput) {
    return this.request<DeepResearch>(`/api/v1/deep-research/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteDeepResearch(id: string) {
    return this.request(`/api/v1/deep-research/${id}`, { method: 'DELETE' });
  }

  async getDeepResearchTemplates() {
    return this.request<{ items: DeepResearchTemplate[] }>('/api/v1/deep-research/templates');
  }

  async createDeepResearchTemplate(data: {
    name: string;
    description?: string;
    promptBody: string;
  }) {
    return this.request<DeepResearchTemplate>('/api/v1/deep-research/templates', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateDeepResearchTemplate(
    id: string,
    data: { name?: string; description?: string; promptBody?: string }
  ) {
    return this.request<DeepResearchTemplate>(`/api/v1/deep-research/templates/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteDeepResearchTemplate(id: string) {
    return this.request(`/api/v1/deep-research/templates/${id}`, {
      method: 'DELETE',
    });
  }

  // ── Desdobramento Comercial — Empreendimentos ──────
  async getEmpreendimentos(filters?: Record<string, string | number | undefined>) {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '')
          params.append(key, String(value));
      });
    }
    const query = params.toString();
    return this.request<{
      items: Empreendimento[];
      pagination: { page: number; limit: number; total: number; totalPages: number };
    }>(`/api/v1/empreendimentos${query ? `?${query}` : ''}`);
  }

  async getEmpreendimento(id: string) {
    return this.request<Empreendimento>(`/api/v1/empreendimentos/${id}`);
  }

  async createEmpreendimento(data: CreateEmpreendimentoInput) {
    return this.request<Empreendimento>('/api/v1/empreendimentos', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateEmpreendimento(id: string, data: UpdateEmpreendimentoInput) {
    return this.request<Empreendimento>(`/api/v1/empreendimentos/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteEmpreendimento(id: string) {
    return this.request(`/api/v1/empreendimentos/${id}`, { method: 'DELETE' });
  }

  // ── Desdobramento Comercial — Playbooks ────────────
  async getPlaybooks() {
    return this.request<{ items: PlaybookTemplate[] }>('/api/v1/playbooks');
  }

  async getPlaybook(id: string) {
    return this.request<PlaybookTemplate>(`/api/v1/playbooks/${id}`);
  }

  async createPlaybook(data: CreatePlaybookInput) {
    return this.request<PlaybookTemplate>('/api/v1/playbooks', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updatePlaybook(id: string, data: UpdatePlaybookInput) {
    return this.request<PlaybookTemplate>(`/api/v1/playbooks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deletePlaybook(id: string) {
    return this.request(`/api/v1/playbooks/${id}`, { method: 'DELETE' });
  }

  // ── Desdobramento Comercial — Roadmaps ─────────────
  async getRoadmaps(filters?: Record<string, string | number | undefined>) {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '')
          params.append(key, String(value));
      });
    }
    const query = params.toString();
    return this.request<{
      items: CommercialRoadmapListItem[];
      pagination: { page: number; limit: number; total: number; totalPages: number };
    }>(`/api/v1/roadmaps${query ? `?${query}` : ''}`);
  }

  async getRoadmap(id: string) {
    return this.request<CommercialRoadmap>(`/api/v1/roadmaps/${id}`);
  }

  async createRoadmap(data: CreateRoadmapInput) {
    return this.request<CommercialRoadmap>('/api/v1/roadmaps', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateRoadmap(id: string, data: UpdateRoadmapInput) {
    return this.request<CommercialRoadmap>(`/api/v1/roadmaps/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteRoadmap(id: string) {
    return this.request(`/api/v1/roadmaps/${id}`, { method: 'DELETE' });
  }

  async advanceRoadmapToProposal(id: string) {
    return this.request<CommercialRoadmap>(`/api/v1/roadmaps/${id}/advance-to-proposal`, {
      method: 'POST',
    });
  }

  async upsertRoadmapStakeholder(id: string, data: UpsertStakeholderInput) {
    return this.request<RoadmapStakeholder>(`/api/v1/roadmaps/${id}/stakeholders`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async removeRoadmapStakeholder(id: string, leadId: string) {
    return this.request(`/api/v1/roadmaps/${id}/stakeholders/${leadId}`, {
      method: 'DELETE',
    });
  }

  async getRoadmapPanel(filters?: Record<string, string | number | undefined>) {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '')
          params.append(key, String(value));
      });
    }
    const query = params.toString();
    return this.request<RoadmapPanel>(`/api/v1/roadmaps/panel${query ? `?${query}` : ''}`);
  }

  // ════════════════════════════════════════════════
  // Upgrade RD parity — P0
  // ════════════════════════════════════════════════

  // ── Configurações de vendas — qualificação ──────────
  async getQualificationConfig() {
    return this.request<{ status: number; data: QualificationConfig }>(
      '/api/v1/sales-config/qualification'
    );
  }

  async updateQualificationConfig(data: QualificationConfig) {
    return this.request<{ status: number; data: QualificationConfig }>(
      '/api/v1/sales-config/qualification',
      { method: 'PUT', body: JSON.stringify(data) }
    );
  }

  // ── Configurações de vendas — flags do tenant ───────
  async getSalesFlags() {
    return this.request<{ status: number; data: SalesFlags }>('/api/v1/sales-config/flags');
  }

  async updateSalesFlags(data: Partial<SalesFlags>) {
    return this.request<{ status: number; data: SalesFlags }>('/api/v1/sales-config/flags', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // ── Configurações de vendas — segmentos de empresas ─
  async getCompanySegments(activeOnly = false) {
    return this.request<{ status: number; data: CompanySegment[] }>(
      `/api/v1/sales-config/segments${activeOnly ? '?active=true' : ''}`
    );
  }

  async createCompanySegment(name: string) {
    return this.request<{ status: number; data: CompanySegment }>('/api/v1/sales-config/segments', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }

  async updateCompanySegment(id: string, data: { name?: string; active?: boolean }) {
    return this.request<{ status: number; data: CompanySegment }>(
      `/api/v1/sales-config/segments/${id}`,
      { method: 'PUT', body: JSON.stringify(data) }
    );
  }

  async deleteCompanySegment(id: string) {
    return this.request<{ status: number; data: { deleted: boolean } }>(
      `/api/v1/sales-config/segments/${id}`,
      { method: 'DELETE' }
    );
  }

  // ── Configurações de vendas — presets de campos ─────
  async getFieldPresets(entity?: FieldPreset['entity']) {
    return this.request<{ status: number; data: FieldPreset[] }>(
      `/api/v1/sales-config/presets${entity ? `?entity=${entity}` : ''}`
    );
  }

  async createFieldPreset(data: FieldPresetInput) {
    return this.request<{ status: number; data: FieldPreset }>('/api/v1/sales-config/presets', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateFieldPreset(id: string, data: Partial<FieldPresetInput>) {
    return this.request<{ status: number; data: FieldPreset }>(
      `/api/v1/sales-config/presets/${id}`,
      { method: 'PUT', body: JSON.stringify(data) }
    );
  }

  async deleteFieldPreset(id: string) {
    return this.request<{ status: number; data: { deleted: boolean } }>(
      `/api/v1/sales-config/presets/${id}`,
      { method: 'DELETE' }
    );
  }

  // ── Configurações de vendas — gatilhos gerenciais ───
  async getManagerTriggers() {
    return this.request<{ status: number; data: ManagerTrigger[] }>(
      '/api/v1/sales-config/triggers'
    );
  }

  async createManagerTrigger(data: ManagerTriggerInput) {
    return this.request<{ status: number; data: ManagerTrigger }>('/api/v1/sales-config/triggers', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateManagerTrigger(id: string, data: Partial<ManagerTriggerInput>) {
    return this.request<{ status: number; data: ManagerTrigger }>(
      `/api/v1/sales-config/triggers/${id}`,
      { method: 'PUT', body: JSON.stringify(data) }
    );
  }

  /** Gatilho padrão (isDefault) não pode ser excluído — backend responde 400. */
  async deleteManagerTrigger(id: string) {
    return this.request<{ status: number; data: { deleted: boolean } }>(
      `/api/v1/sales-config/triggers/${id}`,
      { method: 'DELETE' }
    );
  }

  // ── Questionários ───────────────────────────────────
  async getQuestionnaires(includeInactive = false) {
    return this.request<{ status: number; data: Questionnaire[] }>(
      `/api/v1/questionnaires${includeInactive ? '?includeInactive=1' : ''}`
    );
  }

  async createQuestionnaire(data: QuestionnaireInput) {
    return this.request<{ status: number; data: Questionnaire }>('/api/v1/questionnaires', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateQuestionnaire(id: string, data: Partial<QuestionnaireInput>) {
    return this.request<{ status: number; data: Questionnaire }>(`/api/v1/questionnaires/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteQuestionnaire(id: string) {
    return this.request<{ status: number; data: { deleted: boolean } }>(
      `/api/v1/questionnaires/${id}`,
      { method: 'DELETE' }
    );
  }

  /** Responde o questionário no deal — calcula score e auto-qualifica se configurado. */
  async respondQuestionnaire(
    id: string,
    data: { dealId: string; answers: QuestionnaireAnswerInput[] }
  ) {
    return this.request<{ status: number; data: RespondQuestionnaireResult }>(
      `/api/v1/questionnaires/${id}/responses`,
      { method: 'POST', body: JSON.stringify(data) }
    );
  }

  async getQuestionnaireResponses(dealId: string) {
    return this.request<{ status: number; data: QuestionnaireResponse[] }>(
      `/api/v1/questionnaires/responses?dealId=${encodeURIComponent(dealId)}`
    );
  }

  // ── Multi-vendas (negociações agendadas) ────────────
  async createScheduledDeal(data: CreateScheduledDealInput) {
    return this.request<{ status: number; data: ScheduledDeal }>('/api/v1/scheduled-deals', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getScheduledDeals(filters?: { status?: ScheduledDealStatus; originDealId?: string }) {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.originDealId) params.set('originDealId', filters.originDealId);
    const qs = params.toString();
    return this.request<{ status: number; data: ScheduledDeal[] }>(
      `/api/v1/scheduled-deals${qs ? `?${qs}` : ''}`
    );
  }

  async cancelScheduledDeal(id: string) {
    return this.request<{ status: number; data: ScheduledDeal }>(
      `/api/v1/scheduled-deals/${id}/cancel`,
      { method: 'POST' }
    );
  }

  // ── E-mail 1:1 + comemoração + negociações sem tarefa ──
  /** Envia e-mail pelo deal (modelo ou assunto/corpo avulsos) e registra Interaction EMAIL. */
  async sendDealEmail(id: string, data: SendDealEmailInput) {
    return this.request<{ status: number; data: SendDealEmailResult }>(
      `/api/v1/deals/${id}/send-email`,
      { method: 'POST', body: JSON.stringify(data) }
    );
  }

  /**
   * Envia e-mail 1:1 pelo lead/contato (Upgrade RD P0, req 11): modelo do tenant
   * OU assunto/corpo avulsos; registra Interaction EMAIL OUTBOUND com leadId e
   * SEM dealId. Variáveis: nome/empresa preenchidas; negociacao/valor vazias.
   */
  async sendLeadEmail(
    leadId: string,
    data: { templateId?: string; subject?: string; html?: string }
  ) {
    return this.request<{ status: number; data: SendDealEmailResult }>(
      `/api/v1/leads/${leadId}/send-email`,
      { method: 'POST', body: JSON.stringify(data) }
    );
  }

  /** Contagem/valor de vendas GANHAS do usuário no mês corrente (comemoração). */
  async getCelebrationStats() {
    return this.request<{ status: number; data: CelebrationStats }>(
      '/api/v1/deals/celebration-stats'
    );
  }

  /** Deals OPEN do usuário (ownerScope) sem tarefa pendente vinculada. */
  async getDealsWithoutTasks() {
    return this.request<{ status: number; data: DealWithoutTasks[] }>(
      '/api/v1/deals/without-tasks'
    );
  }

  // ══════════════════════════════════════════════════════
  // Times & Governança (Upgrade RD P1, reqs 12–16)
  // ══════════════════════════════════════════════════════

  // ── Equipes (req 12) ─────────────────────────────────
  async getTeams() {
    return this.request<{ status: number; data: Team[] }>('/api/v1/teams');
  }

  async createTeam(data: CreateTeamInput) {
    return this.request<{ status: number; data: Team }>('/api/v1/teams', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateTeam(id: string, data: UpdateTeamInput) {
    return this.request<{ status: number; data: Team }>(`/api/v1/teams/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteTeam(id: string) {
    return this.request<{ status: number; data: { deleted: boolean } }>(`/api/v1/teams/${id}`, {
      method: 'DELETE',
    });
  }

  // ── Perfis de permissão (req 13/14) ──────────────────
  async getPermissionProfiles() {
    return this.request<{ status: number; data: PermissionProfile[] }>(
      '/api/v1/permission-profiles'
    );
  }

  /** Perfil efetivo do usuário logado — a UI esconde ações conforme capabilities. */
  async getMyPermissions() {
    return this.request<{ status: number; data: EffectivePermissions }>(
      '/api/v1/permission-profiles/me'
    );
  }

  async createPermissionProfile(data: CreatePermissionProfileInput) {
    return this.request<{ status: number; data: PermissionProfile }>(
      '/api/v1/permission-profiles',
      { method: 'POST', body: JSON.stringify(data) }
    );
  }

  /** Builtins são imutáveis — o backend responde 400 ao tentar editá-los. */
  async updatePermissionProfile(id: string, data: UpdatePermissionProfileInput) {
    return this.request<{ status: number; data: PermissionProfile }>(
      `/api/v1/permission-profiles/${id}`,
      { method: 'PUT', body: JSON.stringify(data) }
    );
  }

  async deletePermissionProfile(id: string) {
    return this.request<{ status: number; data: { deleted: boolean } }>(
      `/api/v1/permission-profiles/${id}`,
      { method: 'DELETE' }
    );
  }

  // ── Aprovações (req 15) ──────────────────────────────
  /**
   * Lista solicitações de aprovação (ADMIN/GESTOR). Com `status` filtra por estado;
   * sem `status` (undefined) o backend retorna todas — usado pela aba "Minhas
   * solicitações", que filtra pelo solicitante no cliente.
   */
  async getApprovals(status?: ApprovalStatus) {
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.request<{ status: number; data: ApprovalRequest[] }>(`/api/v1/approvals${qs}`);
  }

  /**
   * Lista as solicitações do PRÓPRIO usuário (qualquer papel, inclusive USER
   * restrito). Contrato FX-A: GET /api/v1/approvals/mine, escopo por solicitante
   * no backend. Com `status` filtra por estado. Usado pela aba "Minhas
   * solicitações" — não requer papel de gestor (evita 403 do GET /approvals).
   */
  async getMyApprovals(status?: ApprovalStatus) {
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.request<{ status: number; data: ApprovalRequest[] }>(
      `/api/v1/approvals/mine${qs}`
    );
  }

  /** Aprova a solicitação → executa a ação embutida e notifica o solicitante. */
  async approveApproval(id: string) {
    return this.request<{ status: number; data: ApprovalRequest }>(
      `/api/v1/approvals/${id}/approve`,
      { method: 'POST' }
    );
  }

  /** Rejeita a solicitação com motivo → notifica o solicitante. */
  async rejectApproval(id: string, reason: string) {
    return this.request<{ status: number; data: ApprovalRequest }>(
      `/api/v1/approvals/${id}/reject`,
      { method: 'POST', body: JSON.stringify({ reason }) }
    );
  }

  /**
   * Baixa a exportação de uma solicitação aprovada (EXECUTED + tipo EXPORT). Só o
   * SOLICITANTE pode baixar a própria exportação (validado no backend). Reexecuta a
   * exportação com o payload salvo e devolve o Blob do arquivo.
   */
  async downloadApproval(id: string): Promise<Blob> {
    const response = await fetch(`${this.baseURL}/api/v1/approvals/${id}/download`, {
      credentials: 'include',
    });
    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: 'Falha ao baixar exportação' }));
      throw new ApiError(errorData.error || 'Falha ao baixar exportação', response.status, errorData);
    }
    return response.blob();
  }

  // ── Lixeira (req 16) ─────────────────────────────────
  async getTrash(entity: TrashEntity, page = 1) {
    const params = new URLSearchParams({ entity, page: String(page) });
    return this.request<{ status: number; data: TrashListResult }>(
      `/api/v1/trash?${params.toString()}`
    );
  }

  /** Restaura (deletedAt=null). Pai excluído → 400 com mensagem clara (req 16). */
  async restoreTrash(entity: TrashEntity, id: string) {
    return this.request<{ status: number; data: { restored: boolean } }>(
      `/api/v1/trash/${entity}/${id}/restore`,
      { method: 'POST' }
    );
  }

  /** Expurgo definitivo (hard-delete) — só itens já na lixeira (ADMIN). */
  async purgeTrash(entity: TrashEntity, id: string) {
    return this.request<{ status: number; data: { purged: boolean } }>(
      `/api/v1/trash/${entity}/${id}/purge`,
      { method: 'DELETE' }
    );
  }

  // ── Performance por equipe (req 12) ──────────────────
  /** Relatório de performance filtrável por equipe (?teamId=). */
  async getTeamPerformance(params?: { from?: string; to?: string; teamId?: string }) {
    const query = new URLSearchParams();
    if (params?.from) query.set('from', params.from);
    if (params?.to) query.set('to', params.to);
    if (params?.teamId) query.set('teamId', params.teamId);
    const qs = query.toString();
    return this.request<{ status: number; data: Record<string, unknown> }>(
      `/api/v1/reports/team-performance${qs ? `?${qs}` : ''}`
    );
  }

  // ========================================================
  // Documentos & integrações externas (Upgrade RD P2, reqs 17–22)
  // ========================================================

  // ── Central de arquivos (req 22) ─────────────────────

  /**
   * Envia um anexo (multipart). Não usa `request()` porque este força
   * Content-Type application/json — o FormData precisa deixar o browser definir
   * o boundary. Mantém cookie + CSRF como o resto do client. `dealId`/`companyId`
   * vinculam o anexo à superfície (deal ou empresa).
   */
  async uploadAttachment(
    file: File,
    link: { dealId?: string; companyId?: string; leadId?: string; interactionId?: string }
  ): Promise<{ status: number; data: Attachment }> {
    const csrfToken = this.getCsrfToken();
    const headers: Record<string, string> = {};
    if (csrfToken) headers['x-csrf-token'] = csrfToken;
    const formData = new FormData();
    formData.append('file', file);
    if (link.dealId) formData.append('dealId', link.dealId);
    if (link.companyId) formData.append('companyId', link.companyId);
    if (link.leadId) formData.append('leadId', link.leadId);
    if (link.interactionId) formData.append('interactionId', link.interactionId);
    const response = await fetch(`${this.baseURL}/api/v1/attachments`, {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'include',
    });
    if (!response.ok) {
      let errorData: Record<string, unknown>;
      try {
        errorData = await response.json();
      } catch {
        errorData = { error: response.statusText || 'Falha no upload' };
      }
      const message =
        (errorData.error as string) || (errorData.message as string) || 'Falha no upload';
      throw new ApiError(message, response.status, errorData);
    }
    return response.json();
  }

  /** Lista metadados de anexos (sem bytes) de um deal, empresa, lead ou atividade. */
  async getAttachments(link: {
    dealId?: string;
    companyId?: string;
    leadId?: string;
    interactionId?: string;
  }) {
    const params = new URLSearchParams();
    if (link.dealId) params.set('dealId', link.dealId);
    if (link.companyId) params.set('companyId', link.companyId);
    if (link.leadId) params.set('leadId', link.leadId);
    if (link.interactionId) params.set('interactionId', link.interactionId);
    const qs = params.toString();
    return this.request<{ status: number; data: Attachment[] }>(
      `/api/v1/attachments${qs ? `?${qs}` : ''}`
    );
  }

  /** Baixa os bytes de um anexo como Blob (stream tenant-scoped no backend). */
  async downloadAttachment(id: string): Promise<Blob> {
    const response = await fetch(`${this.baseURL}/api/v1/attachments/${id}/download`, {
      credentials: 'include',
    });
    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: 'Falha ao baixar arquivo' }));
      throw new ApiError(errorData.error || 'Falha ao baixar arquivo', response.status, errorData);
    }
    return response.blob();
  }

  /** Exclui (soft-delete) um anexo. */
  async deleteAttachment(id: string) {
    return this.request<{ status: number; data: { deleted: boolean } }>(
      `/api/v1/attachments/${id}`,
      { method: 'DELETE' }
    );
  }

  /** Uso de armazenamento do tenant (barra de uso). */
  async getStorageUsage() {
    return this.request<{ status: number; data: StorageUsage }>('/api/v1/attachments/usage');
  }

  // ── Modelos de proposta (req 17) ─────────────────────

  async getProposalTemplates() {
    return this.request<{ status: number; data: ProposalTemplate[] }>(
      '/api/v1/proposal-templates'
    );
  }

  async getProposalTemplate(id: string) {
    return this.request<{ status: number; data: ProposalTemplate }>(
      `/api/v1/proposal-templates/${id}`
    );
  }

  async createProposalTemplate(data: CreateProposalTemplateInput) {
    return this.request<{ status: number; data: ProposalTemplate }>('/api/v1/proposal-templates', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateProposalTemplate(id: string, data: UpdateProposalTemplateInput) {
    return this.request<{ status: number; data: ProposalTemplate }>(
      `/api/v1/proposal-templates/${id}`,
      { method: 'PUT', body: JSON.stringify(data) }
    );
  }

  async deleteProposalTemplate(id: string) {
    return this.request<{ status: number; data: { deleted: boolean } }>(
      `/api/v1/proposal-templates/${id}`,
      { method: 'DELETE' }
    );
  }

  // ── Propostas geradas no deal (req 18) ───────────────

  /** Gera uma nova proposta (nova versão) a partir de um modelo → PDF anexado. */
  async generateProposal(dealId: string, data?: GenerateProposalInput) {
    return this.request<{ status: number; data: Proposal }>(
      `/api/v1/deals/${dealId}/proposals`,
      { method: 'POST', body: JSON.stringify(data ?? {}) }
    );
  }

  /** Lista as versões de proposta de um deal (histórico). */
  async getDealProposals(dealId: string) {
    return this.request<{ status: number; data: Proposal[] }>(
      `/api/v1/deals/${dealId}/proposals`
    );
  }

  // ── Assinatura eletrônica, gated (req 19) ────────────

  async getSignatureStatus() {
    return this.request<{ status: number; data: IntegrationStatus }>(
      '/api/v1/integrations/signature/status'
    );
  }

  async setSignatureConfig(data: SignatureConfigInput) {
    return this.request<{ status: number; data: IntegrationStatus }>(
      '/api/v1/integrations/signature',
      { method: 'PUT', body: JSON.stringify(data) }
    );
  }

  async deleteSignatureConfig() {
    return this.request<{ status: number; data: { deleted: boolean } }>(
      '/api/v1/integrations/signature',
      { method: 'DELETE' }
    );
  }

  /** Envia a proposta para assinatura. Sem credencial → 400 SIGNATURE_NOT_CONFIGURED. */
  async sendProposalForSignature(proposalId: string, data: SendSignatureInput) {
    return this.request<{ status: number; data: Proposal }>(
      `/api/v1/proposals/${proposalId}/send-signature`,
      { method: 'POST', body: JSON.stringify(data) }
    );
  }

  // ── Enriquecimento por CNPJ (req 20) ─────────────────

  /**
   * Consulta o CNPJ (BrasilAPI, fallback ReceitaWS) e retorna um diff campo a
   * campo. NÃO grava — o apply é o `updateCompany` normal com os campos marcados.
   */
  async enrichCnpj(data: { cnpj: string; companyId?: string }) {
    return this.request<{ status: number; data: EnrichCnpjResult }>(
      '/api/v1/companies/enrich-cnpj',
      { method: 'POST', body: JSON.stringify(data) }
    );
  }

  // ── Telefonia virtual, gated (req 21) ────────────────

  async getPhoneStatus() {
    return this.request<{ status: number; data: IntegrationStatus }>(
      '/api/v1/integrations/phone/status'
    );
  }

  async setPhoneConfig(data: PhoneConfigInput) {
    return this.request<{ status: number; data: IntegrationStatus }>('/api/v1/integrations/phone', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deletePhoneConfig() {
    return this.request<{ status: number; data: { deleted: boolean } }>(
      '/api/v1/integrations/phone',
      { method: 'DELETE' }
    );
  }

  /** Access token do provedor p/ o webphone. Sem credencial → 400 PHONE_NOT_CONFIGURED. */
  async getPhoneToken() {
    return this.request<{ status: number; data: PhoneTokenResult }>('/api/v1/phone/token', {
      method: 'POST',
    });
  }

  /** Registra o desfecho de uma ligação como Interaction CALL OUTBOUND. */
  async logCall(data: LogCallInput) {
    return this.request<{ status: number; data: Record<string, unknown> }>(
      '/api/v1/phone/log-call',
      { method: 'POST', body: JSON.stringify(data) }
    );
  }

  // ════════════════════════════════════════════════════════
  // Upgrade RD parity — P3 (WhatsApp no deal/empresa, copiloto,
  // extensão, IA de reuniões — reqs 23–26). GATING GRACIOSO:
  // recursos de IA/WhatsApp só aparecem quando configurados.
  // ════════════════════════════════════════════════════════

  // ── IA de reuniões no deal (req 26) ──────────────────

  /**
   * Cria uma reunião a partir de ÁUDIO (multipart, campo `audio`). Não usa
   * `request()` porque o FormData precisa deixar o browser definir o boundary.
   * Mantém cookie + CSRF como o resto do client. Áudio exige IA/Whisper (OpenAI);
   * sem IA → 503 AI_NOT_CONFIGURED. Retorna a reunião com resumo + sugestões.
   */
  async createMeetingFromAudio(dealId: string, file: File): Promise<{ status: number; data: Meeting }> {
    const csrfToken = this.getCsrfToken();
    const headers: Record<string, string> = {};
    if (csrfToken) headers['x-csrf-token'] = csrfToken;
    const formData = new FormData();
    formData.append('audio', file);
    const response = await fetch(`${this.baseURL}/api/v1/deals/${dealId}/meetings`, {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'include',
    });
    if (!response.ok) {
      let errorData: Record<string, unknown>;
      try {
        errorData = await response.json();
      } catch {
        errorData = { error: response.statusText || 'Falha ao processar a reunião' };
      }
      const message =
        (errorData.error as string) || (errorData.message as string) || 'Falha ao processar a reunião';
      throw new ApiError(message, response.status, errorData, errorData.code as string | undefined);
    }
    return response.json();
  }

  /**
   * Cria uma reunião a partir de TRANSCRIÇÃO COLADA (sem áudio → não exige
   * Whisper, só a análise). Sem IA → 503 AI_NOT_CONFIGURED.
   */
  async createMeetingFromTranscript(dealId: string, transcript: string) {
    return this.request<{ status: number; data: Meeting }>(
      `/api/v1/deals/${dealId}/meetings`,
      { method: 'POST', body: JSON.stringify({ transcript }) }
    );
  }

  /** Lista as reuniões (Interaction MEETING) de um deal. */
  async getDealMeetings(dealId: string) {
    return this.request<{ status: number; data: Meeting[] }>(
      `/api/v1/deals/${dealId}/meetings`
    );
  }

  /** Detalhe de uma reunião (resumo + sugestões) por id da interação. */
  async getMeeting(interactionId: string) {
    return this.request<{ status: number; data: Meeting }>(
      `/api/v1/deals/meetings/${interactionId}`
    );
  }

  /**
   * Aplica as sugestões ACEITAS: cria só as tarefas marcadas + atualiza só os
   * campos aceitos do deal (nunca silencioso). Marca appliedAt/appliedBy.
   */
  async applyMeeting(dealId: string, interactionId: string, data: ApplyMeetingInput) {
    return this.request<{ status: number; data: ApplyMeetingResult }>(
      `/api/v1/deals/${dealId}/meetings/${interactionId}/apply`,
      { method: 'POST', body: JSON.stringify(data) }
    );
  }

  // ── Copiloto IA via WhatsApp (req 25) ────────────────
  // O toggle isCopilot da conexão é feito via updateWhatsAppConnection(id, { isCopilot })
  // em IntegrationsTab (PUT /whatsapp/:id) — sem endpoint dedicado.

  /**
   * Define o "meu número WhatsApp" do usuário logado — usado pelo copiloto p/
   * reconhecer quem comanda (só números conhecidos comandam). Endpoint próprio
   * self-service `PUT /users/me/whatsapp` (o schema de /auth/profile NÃO aceita
   * este campo, então usá-lo descartaria o número silenciosamente). `null` limpa.
   */
  async updateMyWhatsAppNumber(whatsappNumber: string | null) {
    return this.request<{ id: string; whatsappNumber?: string | null }>(
      '/api/v1/users/me/whatsapp',
      { method: 'PUT', body: JSON.stringify({ whatsappNumber }) }
    );
  }

  // ── Resolução de contato por telefone — extensão (req 24) ──

  /**
   * Resolve um telefone no CRM → lead/empresa/deals/últimas interações. Este
   * endpoint autentica por `X-API-Key` (usado direto pela extensão Chrome);
   * exposto aqui p/ referência do contrato. Escopo exigido: `contacts:read`.
   */
  async resolveContactByPhone(phone: string, apiKey: string) {
    const url = `${this.baseURL}/api/v1/contacts/resolve?phone=${encodeURIComponent(phone)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'x-api-key': apiKey },
    });
    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: 'Falha ao resolver contato' }));
      throw new ApiError(
        (errorData.error as string) || 'Falha ao resolver contato',
        response.status,
        errorData,
        errorData.code as string | undefined
      );
    }
    const json = (await response.json()) as { status: number; data: ResolvedContact };
    return json.data;
  }

  // ── Gestão de Atestados Técnicos ──────────────────────────────────────────
  private async atGet<T>(path: string): Promise<T> {
    const res = await this.request<{ status: number; data: T }>(`/api/v1/atestados${path}`);
    return res.data;
  }
  private async atSend<T>(path: string, method: string, body?: unknown): Promise<T> {
    const res = await this.request<{ status: number; data: T }>(`/api/v1/atestados${path}`, {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return res.data;
  }
  private async atUpload<T>(path: string, file: File): Promise<T> {
    const csrfToken = this.getCsrfToken();
    const headers: Record<string, string> = {};
    if (csrfToken) headers['x-csrf-token'] = csrfToken;
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${this.baseURL}/api/v1/atestados${path}`, {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'include',
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Falha no upload' }));
      throw new ApiError((errorData.error as string) || 'Falha no upload', response.status, errorData);
    }
    const json = (await response.json()) as { status: number; data: T };
    return json.data;
  }

  getAtestadoStatus() { return this.atGet<AtestadoStatus>('/status'); }

  listAtestados(params: Record<string, string> = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.atGet<Atestado[]>(`${qs ? `?${qs}` : ''}`);
  }
  getAtestado(id: string) { return this.atGet<Atestado>(`/${id}`); }
  createAtestado(input: AtestadoInput) { return this.atSend<Atestado>('', 'POST', input); }
  updateAtestado(id: string, input: Partial<AtestadoInput>) { return this.atSend<Atestado>(`/${id}`, 'PUT', input); }
  deleteAtestado(id: string) { return this.atSend<{ id: string }>(`/${id}`, 'DELETE'); }
  reindexAtestado(id: string) { return this.atSend<{ id: string; chunks: number }>(`/${id}/reindex`, 'POST'); }
  buscaAtestados(q: string, includeTerceiros = false) {
    const qs = new URLSearchParams({ q, includeTerceiros: String(includeTerceiros) }).toString();
    return this.atGet<BuscaResult[]>(`/busca?${qs}`);
  }
  importAtestados(file: File) { return this.atUpload<ImportReport>('/import', file); }
  sugerirAtestado(file: File) { return this.atUpload<SugestaoResponse>('/sugerir', file); }
  uploadAtestadoDocumento(id: string, file: File) {
    return this.atUpload<{ atestado: Atestado; extraction: { status: string; engine: string; message: string | null } }>(
      `/${id}/documento`,
      file
    );
  }

  listProfissionais(params: Record<string, string> = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.atGet<Profissional[]>(`/profissionais${qs ? `?${qs}` : ''}`);
  }
  getProfissional(id: string) { return this.atGet<Profissional>(`/profissionais/${id}`); }
  createProfissional(data: Partial<Profissional>) { return this.atSend<Profissional>('/profissionais', 'POST', data); }
  updateProfissional(id: string, data: Partial<Profissional>) { return this.atSend<Profissional>(`/profissionais/${id}`, 'PUT', data); }
  deleteProfissional(id: string) { return this.atSend<{ id: string }>(`/profissionais/${id}`, 'DELETE'); }

  listTerceiros(search?: string) {
    const qs = search ? `?search=${encodeURIComponent(search)}` : '';
    return this.atGet<Terceiro[]>(`/terceiros${qs}`);
  }
  createTerceiro(data: Partial<Terceiro>) { return this.atSend<Terceiro>('/terceiros', 'POST', data); }
  updateTerceiro(id: string, data: Partial<Terceiro>) { return this.atSend<Terceiro>(`/terceiros/${id}`, 'PUT', data); }
  deleteTerceiro(id: string) { return this.atSend<{ id: string }>(`/terceiros/${id}`, 'DELETE'); }

  listTaxonomias(tipo?: TaxonomiaTipo) {
    const qs = tipo ? `?tipo=${tipo}` : '';
    return this.atGet<Taxonomia[]>(`/taxonomias${qs}`);
  }
  createTaxonomia(tipo: TaxonomiaTipo, nome: string) { return this.atSend<Taxonomia>('/taxonomias', 'POST', { tipo, nome }); }
  deleteTaxonomia(id: string) { return this.atSend<{ id: string }>(`/taxonomias/${id}`, 'DELETE'); }

  listPendencias(params: Record<string, string> = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.atGet<Pendencia[]>(`/pendencias${qs ? `?${qs}` : ''}`);
  }
  getPendencia(id: string) { return this.atGet<Pendencia>(`/pendencias/${id}`); }
  createPendencia(data: Partial<Pendencia>) { return this.atSend<Pendencia>('/pendencias', 'POST', data); }
  updatePendencia(id: string, data: Partial<Pendencia>) { return this.atSend<Pendencia>(`/pendencias/${id}`, 'PUT', data); }
  deletePendencia(id: string) { return this.atSend<{ id: string }>(`/pendencias/${id}`, 'DELETE'); }
  convertPendencia(id: string, input: AtestadoInput) { return this.atSend<{ atestado: Atestado }>(`/pendencias/${id}/converter`, 'POST', input); }
  listPendenciaStatus() { return this.atGet<PendenciaStatus[]>('/pendencias/status'); }
  createPendenciaStatus(data: { nome: string; ordem?: number; isFinal?: boolean }) { return this.atSend<PendenciaStatus>('/pendencias/status', 'POST', data); }
  updatePendenciaStatus(id: string, data: Partial<PendenciaStatus>) { return this.atSend<PendenciaStatus>(`/pendencias/status/${id}`, 'PUT', data); }
  deletePendenciaStatus(id: string) { return this.atSend<{ id: string }>(`/pendencias/status/${id}`, 'DELETE'); }

  listConcorrencias() { return this.atGet<Concorrencia[]>('/concorrencias'); }
  getConcorrencia(id: string) { return this.atGet<Concorrencia>(`/concorrencias/${id}`); }
  createConcorrencia(data: Partial<Concorrencia>) { return this.atSend<Concorrencia>('/concorrencias', 'POST', data); }
  updateConcorrencia(id: string, data: Partial<Concorrencia>) { return this.atSend<Concorrencia>(`/concorrencias/${id}`, 'PUT', data); }
  deleteConcorrencia(id: string) { return this.atSend<{ id: string }>(`/concorrencias/${id}`, 'DELETE'); }
  analisarConcorrencia(id: string) { return this.atSend<Concorrencia>(`/concorrencias/${id}/analisar`, 'POST'); }
  addExigencia(id: string, data: Record<string, unknown>) { return this.atSend<Concorrencia>(`/concorrencias/${id}/exigencias`, 'POST', data); }
  updateMatch(matchId: string, data: { status?: string; incluido?: boolean }) { return this.atSend<Concorrencia>(`/concorrencias/matches/${matchId}`, 'PUT', data); }
  gerarDossie(id: string, curriculoIds?: string[]) { return this.atSend<{ concorrenciaId: string; attachmentId: string }>(`/concorrencias/${id}/dossie`, 'POST', { curriculoIds }); }

  listCurriculos(profissionalId?: string) {
    const qs = profissionalId ? `?profissionalId=${profissionalId}` : '';
    return this.atGet<Curriculo[]>(`/curriculos${qs}`);
  }
  getCurriculo(id: string) { return this.atGet<Curriculo>(`/curriculos/${id}`); }
  createCurriculo(data: Record<string, unknown>) { return this.atSend<Curriculo>('/curriculos', 'POST', data); }
  gerarCurriculoPdf(id: string) { return this.atSend<{ curriculo: Curriculo; attachmentId: string }>(`/curriculos/${id}/pdf`, 'POST'); }
  deleteCurriculo(id: string) { return this.atSend<{ id: string }>(`/curriculos/${id}`, 'DELETE'); }

  getAtestadoConfig() { return this.atGet<{ atestadoAlertDays: number }>('/config'); }
  updateAtestadoConfig(data: { atestadoAlertDays: number }) { return this.atSend<{ atestadoAlertDays: number }>('/config', 'PUT', data); }

  // ── Gestão de Parceiros Comerciais (interno) ───────────────────────────────
  private async pGet<T>(path: string): Promise<T> {
    const res = await this.request<{ status: number; data: T }>(`/api/v1/parceiros${path}`);
    return res.data;
  }
  private async pSend<T>(path: string, method: string, body?: unknown): Promise<T> {
    const res = await this.request<{ status: number; data: T }>(`/api/v1/parceiros${path}`, {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return res.data;
  }
  private async pUpload<T>(path: string, file: File, fields: Record<string, string> = {}): Promise<T> {
    const csrfToken = this.getCsrfToken();
    const headers: Record<string, string> = {};
    if (csrfToken) headers['x-csrf-token'] = csrfToken;
    const formData = new FormData();
    formData.append('file', file);
    for (const [k, v] of Object.entries(fields)) formData.append(k, v);
    const response = await fetch(`${this.baseURL}/api/v1/parceiros${path}`, {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'include',
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Falha no upload' }));
      throw new ApiError((errorData.error as string) || 'Falha no upload', response.status, errorData);
    }
    const json = (await response.json()) as { status: number; data: T };
    return json.data;
  }

  getParceirosPainel() { return this.pGet<PainelData>('/painel'); }
  listConsultores(params: Record<string, string> = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.pGet<Consultor[]>(`/consultores${qs ? `?${qs}` : ''}`);
  }
  getConsultor(id: string) { return this.pGet<Consultor & { metas?: ConsultorMeta[]; reunioes?: ConsultorReuniao[] }>(`/consultores/${id}`); }
  getConsultorScoreHistory(id: string) { return this.pGet<ScoreSnapshot[]>(`/consultores/${id}/score-history`); }
  createConsultor(data: ConsultorInput) { return this.pSend<Consultor>('/consultores', 'POST', data); }
  updateConsultor(id: string, data: Partial<ConsultorInput>) { return this.pSend<Consultor>(`/consultores/${id}`, 'PUT', data); }
  deleteConsultor(id: string) { return this.pSend<{ id: string }>(`/consultores/${id}`, 'DELETE'); }
  enviarNda(consultorId: string, file: File) { return this.pUpload<Consultor>(`/consultores/${consultorId}/nda/enviar`, file); }
  uploadNdaManual(consultorId: string, file: File) { return this.pUpload<Consultor>(`/consultores/${consultorId}/nda/manual`, file); }

  listRegistros(params: Record<string, string> = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.pGet<Registro[]>(`/registros${qs ? `?${qs}` : ''}`);
  }
  getRegistro(id: string) { return this.pGet<Registro>(`/registros/${id}`); }
  createRegistroInterno(data: RegistroInput & { consultorId: string }) { return this.pSend<Registro>('/registros', 'POST', data); }
  aprovarRegistro(id: string, data: { protecaoDias?: number; motivo?: string } = {}) { return this.pSend<Registro>(`/registros/${id}/aprovar`, 'POST', data); }
  rejeitarRegistro(id: string, motivo: string) { return this.pSend<Registro>(`/registros/${id}/rejeitar`, 'POST', { motivo }); }
  marcarGanho(id: string, valorContrato: number) { return this.pSend<Registro>(`/registros/${id}/ganho`, 'POST', { valorContrato }); }
  marcarPerdido(id: string, motivo?: string) { return this.pSend<Registro>(`/registros/${id}/perdido`, 'POST', { motivo }); }
  reativarRegistro(id: string, data: { protecaoDias?: number; motivo?: string } = {}) { return this.pSend<Registro>(`/registros/${id}/reativar`, 'POST', data); }
  ajustarProtecao(id: string, data: { dias?: number; novoFim?: string; motivo: string }) { return this.pSend<Registro>(`/registros/${id}/protecao`, 'PATCH', data); }
  atualizarCliente(id: string, data: { clienteNome?: string; clienteCnpj?: string | null; clienteContato?: string | null }) { return this.pSend<Registro>(`/registros/${id}`, 'PUT', data); }
  addRegistroUpdate(id: string, texto: string) { return this.pSend<RegistroUpdate>(`/registros/${id}/updates`, 'POST', { texto }); }
  listPlano(registroId: string) { return this.pGet<PlanoAcaoItem[]>(`/registros/${registroId}/plano`); }
  createPlanoItem(registroId: string, data: { descricao: string; responsavelConsultor: boolean; responsavelUserId?: string | null; dueDate?: string | null }) {
    return this.pSend<PlanoAcaoItem>(`/registros/${registroId}/plano`, 'POST', data);
  }
  updatePlanoItem(id: string, data: Partial<{ descricao: string; responsavelConsultor: boolean; responsavelUserId: string | null; dueDate: string | null; status: string }>) {
    return this.pSend<PlanoAcaoItem>(`/plano/${id}`, 'PUT', data);
  }
  deletePlanoItem(id: string) { return this.pSend<{ id: string }>(`/plano/${id}`, 'DELETE'); }

  listExtensoes(status = 'PENDENTE') { return this.pGet<RegistroExtensao[]>(`/extensoes?status=${status}`); }
  decidirExtensao(id: string, data: { aprovar: boolean; dias?: number; motivo?: string }) { return this.pSend<Registro>(`/extensoes/${id}/decidir`, 'POST', data); }

  listConflitos(status: 'ABERTO' | 'RESOLVIDO' = 'ABERTO') { return this.pGet<ConflitoCandidato[]>(`/conflitos?status=${status}`); }
  getSobreposicao() { return this.pGet<OverlapRow[]>('/sobreposicao'); }
  resolverConflito(id: string, data: { decisao: ConflitoDecisao; rationale: string }) { return this.pSend<ConflitoCandidato[]>(`/conflitos/${id}/resolver`, 'POST', data); }

  getExtratoComissoes(params: Record<string, string> = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.pGet<ExtratoComissao>(`/comissoes/extrato${qs ? `?${qs}` : ''}`);
  }
  setAtribuicao(registroId: string, data: { consultorId: string; papel: PapelAtribuicao; percentualOverride?: number | null }) {
    return this.pSend<unknown>(`/registros/${registroId}/atribuicoes`, 'POST', data);
  }
  removeAtribuicao(id: string) { return this.pSend<{ id: string }>(`/atribuicoes/${id}`, 'DELETE'); }
  setSplit(registroId: string, splitOriginador: number) { return this.pSend<unknown>(`/registros/${registroId}/split`, 'PUT', { splitOriginador }); }
  addRecebimento(registroId: string, data: { data: string; valor: number; referencia?: string | null }) {
    return this.pSend<{ recebimento: Recebimento; excedeuContrato: boolean }>(`/registros/${registroId}/recebimentos`, 'POST', data);
  }
  removeRecebimento(id: string) { return this.pSend<{ id: string }>(`/recebimentos/${id}`, 'DELETE'); }
  marcarParcelaPaga(id: string, paga: boolean) { return this.pSend<ComissaoParcela>(`/comissoes/parcelas/${id}/pagar`, 'POST', { paga }); }

  listReunioesParceiros(params: Record<string, string> = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.pGet<ConsultorReuniao[]>(`/reunioes${qs ? `?${qs}` : ''}`);
  }
  createReuniao(data: { consultorId: string; dataHora: string; pauta?: string | null; participantes?: string[] | null }) { return this.pSend<ConsultorReuniao>('/reunioes', 'POST', data); }
  updateReuniao(id: string, data: Partial<{ dataHora: string; pauta: string | null; participantes: string[] | null; observacoes: string | null; status: string; presenca: 'PRESENTE' | 'FALTOU' }>) {
    return this.pSend<ConsultorReuniao>(`/reunioes/${id}`, 'PUT', data);
  }
  registrarPresenca(id: string, presenca: 'PRESENTE' | 'FALTOU', observacoes?: string) {
    return this.pSend<ConsultorReuniao>(`/reunioes/${id}/presenca`, 'POST', { presenca, observacoes });
  }
  deleteReuniao(id: string) { return this.pSend<{ id: string }>(`/reunioes/${id}`, 'DELETE'); }

  listMetasParceiros(consultorId?: string) {
    const qs = consultorId ? `?consultorId=${consultorId}` : '';
    return this.pGet<ConsultorMeta[]>(`/metas${qs}`);
  }
  getMetaProgress(consultorId: string, month: number, year: number) {
    return this.pGet<MetaProgress>(`/metas/progress?consultorId=${consultorId}&month=${month}&year=${year}`);
  }
  upsertMeta(data: { consultorId: string; month: number; year: number; alvoRegistros?: number; alvoPipeline?: number; alvoGanho?: number }) {
    return this.pSend<ConsultorMeta>('/metas', 'POST', data);
  }
  deleteMeta(id: string) { return this.pSend<{ id: string }>(`/metas/${id}`, 'DELETE'); }

  listDocumentosParceiros() { return this.pGet<ConsultorDocumento[]>('/documentos'); }
  uploadDocumentoParceiro(titulo: string, file: File) { return this.pUpload<ConsultorDocumento>('/documentos', file, { titulo }); }
  updateDocumentoParceiro(id: string, data: { titulo?: string; ativo?: boolean }) { return this.pSend<ConsultorDocumento>(`/documentos/${id}`, 'PUT', data); }
  deleteDocumentoParceiro(id: string) { return this.pSend<{ id: string }>(`/documentos/${id}`, 'DELETE'); }

  getParceiroConfig() { return this.pGet<ParceiroConfig>('/config'); }
  updateParceiroConfig(data: Partial<ParceiroConfig>) { return this.pSend<ParceiroConfig>('/config', 'PUT', data); }
  gerarRelatorioParceiros(periodo?: string) { return this.pSend<{ attachmentId: string }>('/relatorio', 'POST', { periodo }); }

  // ── Portal do Parceiro (consultor externo) ─────────────────────────────────
  private async ppGet<T>(path: string): Promise<T> {
    const res = await this.request<{ status: number; data: T }>(`/api/v1/portal-parceiro${path}`);
    return res.data;
  }
  private async ppSend<T>(path: string, method: string, body?: unknown): Promise<T> {
    const res = await this.request<{ status: number; data: T }>(`/api/v1/portal-parceiro${path}`, {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return res.data;
  }

  portalPerfil() { return this.ppGet<PortalPerfil>('/perfil'); }
  portalRegistros() { return this.ppGet<Registro[]>('/registros'); }
  portalRegistro(id: string) { return this.ppGet<Registro>(`/registros/${id}`); }
  portalCriarRegistro(data: RegistroInput) { return this.ppSend<Registro>('/registros', 'POST', data); }
  portalAddUpdate(id: string, texto: string) { return this.ppSend<RegistroUpdate>(`/registros/${id}/updates`, 'POST', { texto }); }
  portalPedirExtensao(id: string, data: { justificativa: string; diasSolicitados?: number }) {
    return this.ppSend<RegistroExtensao>(`/registros/${id}/extensao`, 'POST', data);
  }
  portalConcluirAcao(id: string) { return this.ppSend<PlanoAcaoItem>(`/acoes/${id}/concluir`, 'POST'); }
  portalComissoes() { return this.ppGet<ExtratoComissao>('/comissoes'); }
  portalMetas() { return this.ppGet<{ metas: ConsultorMeta[]; progressoAtual: MetaProgress | null }>('/metas'); }
  portalReunioes() { return this.ppGet<ConsultorReuniao[]>('/reunioes'); }
  portalDocumentos() { return this.ppGet<ConsultorDocumento[]>('/documentos'); }
  portalDocumentoDownloadUrl(id: string) { return `${this.baseURL}/api/v1/portal-parceiro/documentos/${id}/download`; }
}

// ── API Hub types (api-hub spec) ────────────────────
/** An API key as returned by the list endpoint (key value is masked). */
export interface ApiKeyListItem {
  id: string;
  name: string;
  key?: string;
  /** Granular scopes; empty array = full access (legacy keys). */
  scopes: string[];
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  active: boolean;
  createdAt: string;
}

/** Create response — full key shown only once. */
export interface ApiKeyCreated {
  id: string;
  name: string;
  key: string;
  scopes: string[];
  expiresAt?: string | null;
  active: boolean;
  createdAt: string;
}

export interface OutgoingWebhook {
  id: string;
  tenantId: string;
  url: string;
  events: string[];
  secret: string;
  active: boolean;
  successCount: number;
  failureCount: number;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { logs: number };
}

export interface OutgoingWebhookLog {
  id: string;
  event: string;
  status: string;
  statusCode: number | null;
  durationMs: number | null;
  success: boolean;
  response?: string | null;
  error?: string | null;
  attempts: number;
  createdAt: string;
}

export interface SavedView {
  id: string;
  tenantId: string;
  userId: string;
  name: string;
  page: string;
  filters: Record<string, unknown>;
  columns?: Record<string, unknown> | null;
  isDefault: boolean;
  isShared: boolean;
  sortBy?: string | null;
  sortOrder?: string | null;
  createdAt: string;
  updatedAt: string;
  user?: { id: string; name: string };
}

/**
 * Unified API error type used across all frontend API calls.
 * Thrown by ApiClient on non-2xx responses and network failures.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: Record<string, unknown>,
    public code?: string
  ) {
    super(message);
    this.name = 'ApiError';
    // Extract code from details if not provided directly
    if (!this.code && this.details?.code) {
      this.code = this.details.code as string;
    }
  }

  /** True for 5xx errors */
  get isServerError(): boolean {
    return this.statusCode >= 500;
  }

  /** True for network failures (statusCode 0) */
  get isNetworkError(): boolean {
    return this.statusCode === 0;
  }

  /** True for 401 Unauthorized */
  get isUnauthorized(): boolean {
    return this.statusCode === 401;
  }

  /** True for 403 Forbidden */
  get isForbidden(): boolean {
    return this.statusCode === 403;
  }

  /** True for 404 Not Found */
  get isNotFound(): boolean {
    return this.statusCode === 404;
  }

  /** True for 422 or 400 validation errors */
  get isValidationError(): boolean {
    return this.statusCode === 400 || this.statusCode === 422;
  }
}

/** API error response shape returned by the backend */
export interface ApiErrorResponse {
  error: string;
  statusCode: number;
  code?: string;
  details?: Record<string, unknown>;
  stack?: string;
}

export const apiClient = new ApiClient();

// ── Suggestions (feedback in-app) types ─────────────
export type SuggestionType = 'IMPROVEMENT' | 'BUG';
export type SuggestionStatus = 'PENDING' | 'IN_REVIEW' | 'IN_PROGRESS' | 'DONE' | 'REJECTED';
export interface Suggestion {
  id: string;
  tenantId: string;
  userId: string;
  title: string;
  description: string;
  route: string | null;
  type: SuggestionType;
  status: SuggestionStatus;
  adminNotes: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  user?: { id: string; name: string; email: string };
}

// ── Gestão de Negócios (RD parity) types ──
export interface DealContact {
  id: string;
  dealId: string;
  leadId: string;
  roleInDeal: string | null;
  lead?: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    position: string | null;
    company: string | null;
  };
}

/** Item de lista de configuração (Motivo de perda usa `label`; Fonte/Campanha usam `name`). */
export interface ConfigItem {
  id: string;
  name?: string;
  label?: string;
  active: boolean;
  order: number;
}

export interface EmailTemplateListItem {
  id: string;
  name: string;
  subject: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmailTemplateDetail extends EmailTemplateListItem {
  html: string;
}

// ── Campaign types ──────────────────────────────────
// Block schema — shared contract with backend (`blocksToHtml`). The campaign
// body is `blocks: Block[]`; the frontend renders the preview by mapping these.
export type Block =
  | { id: string; type: 'text'; content: string }
  | { id: string; type: 'image'; url: string; alt?: string }
  | { id: string; type: 'button'; label: string; href: string }
  | { id: string; type: 'divider' }
  | { id: string; type: 'spacer'; height?: number };

export type CampaignStatus = 'DRAFT' | 'SCHEDULED' | 'SENDING' | 'SENT' | 'PAUSED' | 'CANCELLED';

/** Audience segmentation filters (req 12). */
export interface CampaignAudienceFilters {
  status?: string;
  tagId?: string;
  assignedTo?: string;
  source?: string;
  minScore?: number;
  maxScore?: number;
  /** ISO date — last interaction before this date. */
  lastInteractionBefore?: string;
  /** ISO date — last interaction after this date. */
  lastInteractionAfter?: string;
  /** Leads with no interaction in the last N days. */
  noInteractionDays?: number;
}

export interface CampaignInput {
  name: string;
  fromName?: string;
  fromEmail?: string;
  subject: string;
  blocks: Block[];
  audienceFilters: CampaignAudienceFilters;
}

export interface CampaignListItem {
  id: string;
  name: string;
  status: CampaignStatus;
  subject: string;
  sentCount?: number;
  openRate?: number;
  ctr?: number;
  scheduledAt?: string | null;
  sentAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Campaign extends CampaignListItem {
  fromName?: string | null;
  fromEmail?: string | null;
  blocks: Block[];
  audienceFilters: CampaignAudienceFilters;
}

export interface CampaignAudiencePreview {
  count: number;
  sample: Array<{ name: string; email: string }>;
}

export interface CampaignRecipientRow {
  leadId: string;
  name: string;
  email: string;
  status: string;
  openedAt: string | null;
}

export interface CampaignStats {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  unsubscribed: number;
  bounced: number;
  openRate: number;
  ctr: number;
  unsubRate: number;
  timeline: Array<{ hour: string; opens: number }>;
  recipients: CampaignRecipientRow[];
}

// ── Import Pro types ────────────────────────────────

export type ImportType = 'LEADS' | 'DEALS' | 'INTERACTIONS' | 'COMPANIES';

export type ImportBatchStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'ROLLED_BACK';

export type ImportDuplicateAction = 'skip' | 'update';

/** A row that failed validation, surfaced in the dry-run preview. */
export interface ImportValidationError {
  row: number;
  field: string;
  message: string;
}

/**
 * A duplicate detected during dry-run. Leads/contacts match by email/phone;
 * companies match by externalId/cnpj/name.
 */
export interface ImportDuplicate {
  row: number;
  matchedBy: 'email' | 'phone' | 'externalId' | 'cnpj' | 'name';
  /** Identifier the row collides with (the matched value or existing record id). */
  value: string;
  name?: string;
  email?: string;
  phone?: string;
}

/**
 * Response shape for both dry-run and final imports. On dry-run, `dryRun` is
 * true and `batchId` is absent; on async final imports `batchId` is returned
 * for polling.
 */
export interface ImportResult {
  dryRun?: boolean;
  batchId?: string;
  status?: ImportBatchStatus;
  /** True when the file was queued for async processing (> 500 rows). */
  async?: boolean;
  totalRows: number;
  newCount: number;
  duplicateCount: number;
  errorCount: number;
  duplicates?: ImportDuplicate[];
  errors?: ImportValidationError[];
}

export interface ImportBatch {
  id: string;
  type: ImportType;
  status: ImportBatchStatus;
  totalRows: number;
  importedRows: number;
  errorRows: number;
  skippedRows: number;
  errorLog?: ImportValidationError[] | null;
  rolledBackAt?: string | null;
  createdAt: string;
  updatedAt: string;
  user?: { id: string; name: string; email?: string } | null;
}
