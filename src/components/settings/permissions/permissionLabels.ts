// Rótulos pt-BR do contrato de perfis de permissão (Upgrade RD P1, reqs 13/14).
// Fonte de verdade dos tipos: src/types/governance.ts. Estes rótulos alimentam
// os editores de perfil (capabilities / visibilidade / exigir aprovação) e são
// consumidos por PermissionsTab / PermissionProfileEditor.

import type {
  Capability,
  VisibilityLevel,
  BaseRole,
} from '../../../types/governance';

/** Ordem e rótulos das 8 capacidades (switches do editor). */
export const CAPABILITY_LABELS: Array<{ key: Capability; label: string; hint: string }> = [
  { key: 'exportData', label: 'Exportar', hint: 'Baixar registros (CSV/Excel)' },
  { key: 'importData', label: 'Importar', hint: 'Carregar registros em lote' },
  { key: 'bulkActions', label: 'Ações em massa', hint: 'Editar vários registros de uma vez' },
  { key: 'deleteRecords', label: 'Excluir', hint: 'Enviar registros para a lixeira' },
  { key: 'configure', label: 'Configurar', hint: 'Editar funis, campos e configurações' },
  {
    key: 'manageAutomations',
    label: 'Gerenciar automações',
    hint: 'Criar e editar automações',
  },
  {
    key: 'transferOwner',
    label: 'Transferir responsável',
    hint: 'Reatribuir registros a outra pessoa',
  },
  { key: 'viewReports', label: 'Ver relatórios', hint: 'Acessar dashboards e relatórios' },
  {
    key: 'accessAtestados',
    label: 'Acessar Atestados Técnicos',
    hint: 'Ver o módulo de acervo técnico e concorrências',
  },
  {
    key: 'manageAtestados',
    label: 'Gerenciar Atestados Técnicos',
    hint: 'Cadastrar/editar atestados, profissionais e configurações',
  },
  {
    key: 'accessParceiros',
    label: 'Acessar Parceiros Comerciais',
    hint: 'Ver o módulo de consultores externos e registros de oportunidade',
  },
  {
    key: 'manageParceiros',
    label: 'Gerenciar Parceiros Comerciais',
    hint: 'Aprovar registros, resolver conflitos, comissões, documentos e config',
  },
];

/** As 3 dimensões de visibilidade (selects do editor). */
export const VISIBILITY_ENTITIES: Array<{ key: 'deals' | 'companies' | 'contacts'; label: string }> =
  [
    { key: 'deals', label: 'Negociações' },
    { key: 'companies', label: 'Empresas' },
    { key: 'contacts', label: 'Contatos' },
  ];

export const VISIBILITY_LABELS: Record<VisibilityLevel, string> = {
  PROPRIA: 'Só minhas',
  EQUIPE: 'Equipe',
  GERAL: 'Geral',
};

/** Os 3 gatilhos de "exigir aprovação" (switches do editor). */
export const APPROVAL_LABELS: Array<{ key: 'export' | 'bulk' | 'delete'; label: string; hint: string }> =
  [
    { key: 'export', label: 'Exportação', hint: 'Exportar exige aprovação de um gestor' },
    { key: 'bulk', label: 'Ações em massa', hint: 'Ações em massa exigem aprovação' },
    { key: 'delete', label: 'Exclusão', hint: 'Excluir exige aprovação' },
  ];

export const BASE_ROLE_LABELS: Record<BaseRole, string> = {
  ADMIN: 'Administrador',
  GESTOR: 'Gestor',
  USER: 'Usuário',
  VIEWER: 'Visualizador',
};
