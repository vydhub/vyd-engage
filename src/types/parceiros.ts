// Tipos do módulo de Gestão de Parceiros Comerciais (frontend).

export type ConsultorStatus = 'ATIVO' | 'SUSPENSO' | 'INATIVO';
export type NdaStatus = 'PENDENTE' | 'ENVIADO' | 'ASSINADO' | 'RECUSADO';
export type RegistroStatus =
  | 'SUBMETIDO'
  | 'EM_ANALISE'
  | 'APROVADO'
  | 'REJEITADO'
  | 'EXPIRADO'
  | 'GANHO'
  | 'PERDIDO';
export type ExtensaoStatus = 'PENDENTE' | 'APROVADA' | 'NEGADA';
export type ConflitoTipo = 'EXTERNO_EXTERNO' | 'EXTERNO_INTERNO';
export type ConflitoDecisao = 'MANTER' | 'REJEITAR' | 'INDEPENDENTE';
export type MatchForca = 'FORTE' | 'FRACO';
export type PlanoAcaoStatus = 'PENDENTE' | 'CONCLUIDA' | 'CANCELADA';
export type PapelAtribuicao = 'ORIGINADOR' | 'DESENVOLVEDOR';
export type ComissaoStatus = 'A_PAGAR' | 'PAGA';
export type ReuniaoStatus = 'AGENDADA' | 'REALIZADA' | 'CANCELADA';
export type PresencaStatus = 'PRESENTE' | 'FALTOU';
export type ScoreFaixa = 'SAUDAVEL' | 'ATENCAO' | 'ESFRIANDO' | 'FRIO';

export interface Consultor {
  id: string;
  nome: string;
  email: string;
  telefone: string | null;
  empresa: string | null;
  nivel: string | null;
  comissaoBase: string | number;
  status: ConsultorStatus;
  inicioParceria: string | null;
  ndaStatus: NdaStatus;
  score: number | null;
  scoreFaixa: ScoreFaixa | null;
  ultimaAtividadeEm: string | null;
  createdAt: string;
}

export interface ConsultorPainel extends Consultor {
  diasSemAtividade: number | null;
  registrosAtivos: number;
  pipeline: number;
  ganho: number;
  metaPct: { registros: number | null; pipeline: number | null; ganho: number | null } | null;
  taxaCumprimento: number | null;
}

export interface PainelData {
  consultores: ConsultorPainel[];
  indicadores: {
    consultoresAtivos: number;
    consultoresDormentes: number;
    registrosAguardando: number;
    conflitosAbertos: number;
    registrosExpirando: number;
    avisoExpiracaoDias: number;
    comissoesAPagar: number;
    pipelineParceiros: number;
    taxaExpiracao: number;
    tempoMedioAprovacaoDias: number | null;
  };
}

export interface RegistroUpdate {
  id: string;
  autorId: string | null;
  texto: string;
  createdAt: string;
}
export interface RegistroExtensao {
  id: string;
  justificativa: string;
  diasSolicitados: number | null;
  status: ExtensaoStatus;
  motivoDecisao: string | null;
  createdAt: string;
  registro?: { id: string; clienteNome: string; protecaoFim: string | null; consultor: { nome: string } };
}
export interface PlanoAcaoItem {
  id: string;
  descricao: string;
  responsavelConsultor: boolean;
  responsavelUserId: string | null;
  dueDate: string | null;
  status: PlanoAcaoStatus;
  concluidaEm: string | null;
}
export interface RegistroAtribuicao {
  id: string;
  papel: PapelAtribuicao;
  percentualOverride: string | number | null;
  consultor: { id: string; nome: string; comissaoBase: string | number };
}
export interface Recebimento {
  id: string;
  data: string;
  valor: string | number;
  referencia: string | null;
}
export interface RegistroAuditoria {
  id: string;
  evento: string;
  detalhe: string | null;
  autorId: string | null;
  createdAt: string;
}
export interface ConflitoCandidato {
  id: string;
  tipo: ConflitoTipo;
  matchForca: MatchForca;
  matchChave: string;
  status: 'ABERTO' | 'RESOLVIDO';
  decisao: ConflitoDecisao | null;
  rationale: string | null;
  createdAt: string;
  registro?: { id: string; clienteNome: string; descricao: string; valorEstimado?: string | number | null; createdAt: string; consultor: { id: string; nome: string } };
  alvoRegistro?: {
    id: string;
    clienteNome: string;
    descricao?: string;
    valorEstimado?: string | number | null;
    status: RegistroStatus;
    createdAt: string;
    consultor: { id: string; nome: string };
  } | null;
  alvoDeal?: { id: string; name: string; stage: string; status: string; notes?: string | null; value?: string | number | null } | null;
  alvoCompany?: { id: string; name: string; cnpj: string | null } | null;
}

export interface Registro {
  id: string;
  clienteNome: string;
  clienteCnpj: string | null;
  clienteContato: string | null;
  descricao: string;
  valorEstimado: string | number | null;
  observacoes: string | null;
  status: RegistroStatus;
  motivoDecisao: string | null;
  protecaoDias: number | null;
  protecaoFim: string | null;
  proximoUpdateEm: string | null;
  ultimaAtividadeEm: string;
  valorContrato: string | number | null;
  ganhoEm: string | null;
  splitOriginador: number | null;
  createdAt: string;
  consultor?: { id: string; nome: string; email?: string; status?: ConsultorStatus };
  deal?: { id?: string; name?: string; stage: string; status: string; value?: string | number } | null;
  updates?: RegistroUpdate[];
  extensoes?: RegistroExtensao[];
  planoAcao?: PlanoAcaoItem[];
  atribuicoes?: RegistroAtribuicao[];
  recebimentos?: Recebimento[];
  auditoria?: RegistroAuditoria[];
  possivelDuplicata?: { registroId: string; clienteNome: string }[];
  _count?: { conflitos?: number; planoAcao?: number; updates?: number };
}

export interface OverlapRow {
  cnpj: string;
  clienteNome: string;
  frentes: Array<{ tipo: 'CONSULTOR' | 'INTERNO'; nome: string }>;
}

export interface ComissaoParcela {
  id: string;
  papel: PapelAtribuicao;
  percentualAplicado: string | number;
  fracaoPapel: number;
  valor: string | number;
  status: ComissaoStatus;
  marcadaPagaEm: string | null;
  createdAt: string;
  consultor: { id: string; nome: string };
  registro: { id: string; clienteNome: string };
  recebimento: { data: string; valor: string | number; referencia: string | null };
}
export interface ExtratoComissao {
  parcelas: ComissaoParcela[];
  totais: { aPagar: number; pagas: number };
}

export interface ConsultorReuniao {
  id: string;
  dataHora: string;
  pauta: string | null;
  participantes: string[] | null;
  status: ReuniaoStatus;
  presenca: PresencaStatus | null;
  observacoes: string | null;
  consultor?: { id: string; nome: string };
}

export interface ConsultorMeta {
  id: string;
  consultorId: string;
  month: number;
  year: number;
  alvoRegistros: number;
  alvoPipeline: string | number;
  alvoGanho: string | number;
  consultor?: { id: string; nome: string };
}
export interface MetaProgress {
  meta: { alvoRegistros: number; alvoPipeline: number; alvoGanho: number };
  realizado: { registros: number; pipeline: number; ganho: number };
  pct: { registros: number | null; pipeline: number | null; ganho: number | null };
}

export interface ConsultorDocumento {
  id: string;
  titulo: string;
  attachmentId: string;
  ativo: boolean;
  createdAt: string;
}

export interface ParceiroConfig {
  protecaoDiasPadrao: number;
  updateCadenciaDias: number;
  avisoExpiracaoDias: number;
  splitOriginadorPadrao: number;
  reuniaoCadenciaDias: number;
  scorePesos: { novasOportunidades: number; updatesCumpridos: number; presencaReunioes: number; progressaoPipeline: number };
  scoreLimiares: { saudavel: number; atencao: number; esfriando: number };
  decaimentoPontosPorDia: number;
  decaimentoMaxPontos: number;
  quedaLimiarPontos: number;
  conflitoInternoUserId: string | null;
}

export interface ScoreSnapshot {
  id: string;
  data: string;
  score: number;
  faixa: ScoreFaixa;
  sinais: Record<string, number> | null;
}

// Portal
export interface PortalPerfil {
  id: string;
  nome: string;
  email: string;
  telefone: string | null;
  empresa: string | null;
  nivel: string | null;
  status: ConsultorStatus;
  ndaStatus: NdaStatus;
  score: number | null;
  scoreFaixa: ScoreFaixa | null;
  inicioParceria: string | null;
}

// Payloads
export interface RegistroInput {
  clienteNome: string;
  clienteCnpj?: string | null;
  clienteContato?: string | null;
  descricao: string;
  valorEstimado?: number | null;
  observacoes?: string | null;
}
export interface ConsultorInput {
  nome: string;
  email: string;
  telefone?: string | null;
  cpfCnpj?: string | null;
  empresa?: string | null;
  nivel?: string | null;
  comissaoBase?: number;
  status?: ConsultorStatus;
  inicioParceria?: string | null;
  cadenciaReuniaoDias?: number | null;
  senhaInicial?: string;
}
