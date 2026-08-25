// Interface comum dos motores de pesquisa profunda (Deep Research).
//
// Dois modos de execução:
//  - assíncrono (isAsync=true): start() dispara e retorna um jobId; o poller
//    consulta poll() até concluir. Ex.: OpenAI Responses (background), Perplexity
//    async. Resiliente a reinício do servidor.
//  - síncrono (isAsync=false): run() executa a chamada (via streaming, para não
//    estourar timeout) e retorna o resultado completo. Ex.: OpenRouter.

export interface ResearchSource {
  title?: string;
  url: string;
  date?: string;
}

export interface ProviderResult {
  status: 'pending' | 'completed' | 'failed';
  markdown?: string;
  /** URLs das fontes (compat). */
  sources?: string[];
  /** Fontes ricas (título/URL/data) quando o provedor as expõe. */
  searchResults?: ResearchSource[];
  error?: string;
  /**
   * `true` quando o provedor parou por LIMITE DE SAÍDA (finish_reason ===
   * 'length'), e não porque terminou o texto.
   *
   * Existe porque o relatório vinha CORTADO no meio de uma palavra e mesmo assim
   * era gravado como COMPLETED — 4 das 5 primeiras pesquisas de produção
   * terminavam em "…aproveitando", "…em Fl", "…inser". Sem este sinal não há como
   * distinguir um relatório inteiro de um decapitado.
   */
  truncated?: boolean;
  /** Motivo bruto do provedor (finish_reason), para diagnóstico. */
  finishReason?: string;
}

export interface ResearchProvider {
  name: string;
  /** true = start()+poll(); false = run() síncrono (streaming). */
  isAsync: boolean;
  /** Configurado (chave presente). */
  enabled(): boolean;
  /** Assíncrono: dispara a pesquisa e retorna o id para acompanhamento. */
  start?(prompt: string): Promise<string>;
  /** Assíncrono: consulta o status/resultado de um job. */
  poll?(jobId: string): Promise<ProviderResult>;
  /** Síncrono: executa e retorna o resultado completo. */
  run?(prompt: string): Promise<ProviderResult>;
}
