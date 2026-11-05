// Captura de Demandas (spec captura-demandas, filha 02).

export type ContratoTipo = 'LTA' | 'GUARDA_CHUVA';
export type ContratoMovimentoTipo = 'ADITIVO' | 'AJUSTE' | 'CONSUMO';
export type LacunaContrato = 'sem_solicitantes' | 'sem_sla' | 'sem_valor' | 'sem_gerente';

export type DemandaEstado =
  | 'recebida'
  | 'em_triagem'
  | 'em_orcamento'
  | 'orcamento_enviado'
  | 'ganha'
  | 'perdida'
  | 'declinada'
  | 'cancelada'
  | 'descartada';

export type DemandaCenario = 'contrato_novo' | 'chamado_lta';

export const ROTULO_ESTADO: Record<DemandaEstado, string> = {
  recebida: 'Recebida',
  em_triagem: 'Em triagem',
  em_orcamento: 'Em orçamento',
  orcamento_enviado: 'Orçamento enviado',
  ganha: 'Ganha / Aprovada',
  perdida: 'Perdida / Reprovada',
  declinada: 'Declinada',
  cancelada: 'Cancelada',
  descartada: 'Descartada',
};

export const ROTULO_CENARIO: Record<DemandaCenario, string> = {
  contrato_novo: 'Contrato novo',
  chamado_lta: 'Chamado LTA',
};

export const ROTULO_LACUNA: Record<LacunaContrato, string> = {
  sem_solicitantes: 'Sem solicitantes',
  sem_sla: 'Sem SLA',
  sem_valor: 'Sem valor',
  sem_gerente: 'Sem gerente',
};

export const ROTULO_TIPO_CONTRATO: Record<ContratoTipo, string> = {
  LTA: 'LTA',
  GUARDA_CHUVA: 'Guarda-chuva',
};

export const ROTULO_MOVIMENTO: Record<ContratoMovimentoTipo, string> = {
  ADITIVO: 'Aditivo',
  AJUSTE: 'Ajuste',
  CONSUMO: 'Consumo',
};

export interface ContratoResumo {
  id: string;
  numero: string;
  numeroCliente: string | null;
  tipo: ContratoTipo;
  objeto: string | null;
  escopo: string | null;
  vigenciaInicio: string | null;
  vigenciaFim: string | null;
  valorContratado: number | null;
  saldo: number | null;
  saldoDisponivel: boolean;
  slaRespostaHoras: number | null;
  gerenteNome: string | null;
  gerenteEmail: string | null;
  planejadorNome: string | null;
  planejadorEmail: string | null;
  flowRecordId: string | null;
  lacunas: LacunaContrato[];
  companyId: string;
  company: { id: string; name: string };
}

export interface ContratoSolicitante {
  id: string;
  nome: string | null;
  email: string;
}

export interface ContratoItem {
  id: string;
  descricao: string;
  disciplina: string | null;
}

export interface ContratoMovimento {
  id: string;
  tipo: ContratoMovimentoTipo;
  valor: number;
  motivo: string | null;
  createdAt: string;
  autor: { id: string; name: string } | null;
  deal: { id: string; name: string } | null;
}

export interface ContratoDetalhe extends ContratoResumo {
  solicitantes: ContratoSolicitante[];
  itens: ContratoItem[];
  movimentos: ContratoMovimento[];
}

export interface ContratoEntrada {
  companyId?: string;
  numero?: string;
  numeroCliente?: string | null;
  tipo?: ContratoTipo;
  objeto?: string | null;
  escopo?: string | null;
  vigenciaInicio?: string | null;
  vigenciaFim?: string | null;
  valorContratado?: number | null;
  slaRespostaHoras?: number | null;
  gerenteNome?: string | null;
  gerenteEmail?: string | null;
  planejadorNome?: string | null;
  planejadorEmail?: string | null;
}

export interface IndicadoresCaptura {
  taxaGo: { go: number; triadas: number; taxa: number | null };
  conversao: { ganhas: number; perdidas: number; taxa: number | null };
  tempoAtendimento: { enviadas: number; mediaHorasUteis: number | null };
  sla: { dentro: number; avaliados: number; taxa: number | null; semSla: number };
  ticketEnviado: { soma: number; quantidade: number; media: number | null; semValor: number };
  ticketAprovado: { soma: number; quantidade: number; media: number | null; semValor: number };
}

export interface RelatorioCaptura {
  dataInicio: string | null;
  calendario: {
    diasUteis: number[];
    inicio: string;
    fim: string;
    fuso: string;
    excluirFeriadosNacionais: boolean;
  };
  indicadores: IndicadoresCaptura;
  grupos: Array<{ id: string; rotulo: string; indicadores: IndicadoresCaptura }>;
  lacunas: {
    ganhasSemValor: Array<{
      engageId: string;
      objeto: string;
      cliente: string | null;
      contrato: string | null;
      aprovadoEm: string | null;
    }>;
  };
}

export type AgrupamentoCaptura = 'cenario' | 'cliente' | 'contrato' | 'mes';

export interface FiltrosRelatorioCaptura {
  de?: string;
  ate?: string;
  cenario?: DemandaCenario;
  clienteId?: string;
  contratoId?: string;
  agrupar?: AgrupamentoCaptura;
}

/** O que a tela do Negócio recebe quando ele veio da Captura (E-16). */
/**
 * Depois que o Flow informa valor enviado ou aprovado, `Deal.value` é esse valor e só muda por
 * evento (E-15, E-16). Antes disso, o valor estimado continua editável.
 */
export function valorControladoPeloFlow(
  demanda: Pick<DemandaDoNegocio, 'valorEnviado' | 'valorAprovado'> | null | undefined
): boolean {
  return !!demanda && (demanda.valorEnviado != null || demanda.valorAprovado != null);
}

export interface DemandaDoNegocio {
  id: string;
  flowCardId: string | null;
  estado?: DemandaEstado;
  cenario?: DemandaCenario;
  valorEnviado?: number | string | null;
  valorAprovado?: number | string | null;
  linkOriginal?: string | null;
  /** W-39 (filha 08): situação do item no portal do cliente e desde quando (ISO). */
  situacaoOrigem?: string | null;
  situacaoOrigemEm?: string | null;
}
