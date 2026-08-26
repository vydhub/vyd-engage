// Defaults por baseRole (== HOJE, alinhado ao permissionService do backend).
// Compartilhado pelo editor de perfil custom e pelo visualizador de builtins.
// Fonte de verdade dos tipos: src/types/governance.ts.

import type { BaseRole, Capabilities, VisibilityMap } from '../../../types/governance';

export const CAPABILITY_DEFAULTS: Record<BaseRole, Capabilities> = {
  ADMIN: {
    exportData: true,
    importData: true,
    bulkActions: true,
    deleteRecords: true,
    configure: true,
    manageAutomations: true,
    transferOwner: true,
    viewReports: true,
    accessAtestados: true,
    manageAtestados: true,
    accessParceiros: true,
    manageParceiros: true,
  },
  GESTOR: {
    exportData: true,
    importData: true,
    bulkActions: true,
    deleteRecords: true,
    configure: true,
    manageAutomations: true,
    transferOwner: true,
    viewReports: true,
    accessAtestados: true,
    manageAtestados: true,
    accessParceiros: true,
    manageParceiros: true,
  },
  USER: {
    exportData: true,
    importData: false,
    bulkActions: true,
    deleteRecords: true,
    configure: false,
    manageAutomations: false,
    transferOwner: false,
    viewReports: true,
    accessAtestados: false,
    manageAtestados: false,
    accessParceiros: false,
    manageParceiros: false,
  },
  VIEWER: {
    exportData: false,
    importData: false,
    bulkActions: false,
    deleteRecords: false,
    configure: false,
    manageAutomations: false,
    transferOwner: false,
    viewReports: true,
    accessAtestados: false,
    manageAtestados: false,
    accessParceiros: false,
    manageParceiros: false,
  },
};

export const VISIBILITY_DEFAULTS: Record<BaseRole, VisibilityMap> = {
  ADMIN: { deals: 'GERAL', companies: 'GERAL', contacts: 'GERAL' },
  GESTOR: { deals: 'GERAL', companies: 'GERAL', contacts: 'GERAL' },
  USER: { deals: 'PROPRIA', companies: 'GERAL', contacts: 'GERAL' },
  VIEWER: { deals: 'PROPRIA', companies: 'PROPRIA', contacts: 'PROPRIA' },
};
