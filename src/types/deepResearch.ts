// Tipos da Inteligência de Mercado (Deep Research).
//
// O `promptBody`/`promptUsed` (IP da plataforma) só chega ao cliente quando o
// usuário é platform admin — por isso são opcionais aqui. Para o usuário final,
// o backend expõe apenas `placeholders` (campos a preencher) e `outline`
// (resumo do que será entregue).

export type DeepResearchStatus = 'DRAFT' | 'RESEARCHING' | 'COMPLETED' | 'FAILED';

export interface DeepResearchTemplate {
  id: string;
  tenantId?: string;
  name: string;
  description?: string | null;
  /** Texto do prompt — presente apenas para platform admins. */
  promptBody?: string;
  /** Campos a preencher (derivados do prompt no backend). */
  placeholders?: string[];
  /** Resumo do que será entregue (títulos de capítulo). */
  outline?: string[];
  isBuiltin: boolean;
  createdById?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeepResearchTemplateRef {
  id: string;
  name: string;
}

/** Fonte citada pela pesquisa (título clicável → URL, com data quando houver). */
export interface ResearchSource {
  title?: string;
  url: string;
  date?: string;
}

export interface DeepResearchReportMeta {
  sources?: string[];
  /** Fontes ricas (título/URL/data) vindas do motor de pesquisa. */
  searchResults?: ResearchSource[];
  generatedAt?: string;
  charCount?: number;
  /**
   * O motor parou por limite de tokens de saída: o texto está CORTADO (às vezes
   * no meio de uma palavra), não concluído. Relatórios antigos não têm o campo —
   * ausente significa "não sabemos", e a tela não avisa nada nesse caso.
   */
  truncated?: boolean;
  /** finish_reason bruto do provedor, para diagnóstico. */
  finishReason?: string;
  /**
   * Seções do roteiro que o relatório não cobriu. É o sinal mais útil: no caso
   * real o provedor reportou `stop` e ainda assim faltaram 2 capítulos.
   */
  missingSections?: string[];
}

/** Item da lista — não carrega o markdown completo nem o prompt. */
export interface DeepResearchListItem {
  id: string;
  title: string;
  status: DeepResearchStatus;
  templateId?: string | null;
  createdById?: string | null;
  createdAt: string;
  updatedAt: string;
  template?: DeepResearchTemplateRef | null;
}

/** Detalhe de uma pesquisa. `promptUsed` só vem para platform admins. */
export interface DeepResearch extends DeepResearchListItem {
  promptUsed?: string;
  variables: Record<string, string>;
  reportMarkdown?: string | null;
  reportMeta?: DeepResearchReportMeta | null;
  /** Integração OpenAI (só platform admin recebe response id/erro). */
  providerResponseId?: string | null;
  providerError?: string | null;
  requestedAt?: string | null;
}

export interface CreateDeepResearchInput {
  title: string;
  templateId?: string;
  variables?: Record<string, string>;
  status?: DeepResearchStatus;
}

export interface UpdateDeepResearchInput {
  title?: string;
  variables?: Record<string, string>;
  status?: DeepResearchStatus;
  reportMarkdown?: string;
}
