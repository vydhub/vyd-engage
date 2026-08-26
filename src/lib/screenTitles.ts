/**
 * Título legível de cada tela do /app (spec ribbon-shell-global req 5/10).
 * Deriva dos rótulos que já existem na navegação; usado no chrome (topbar +
 * ribbon default). Casamento por prefixo mais específico primeiro.
 */
const TITLES: Array<[string, string]> = [
  // rotas mais específicas antes das genéricas
  ['/app/automations/new', 'Nova automação'],
  ['/app/automations/logs', 'Logs de automação'],
  ['/app/automations', 'Automações'],
  ['/app/leads/new', 'Novo lead'],
  ['/app/leads/duplicates', 'Duplicatas de leads'],
  ['/app/leads', 'Leads'],
  ['/app/companies', 'Empresas'],
  ['/app/deals', 'Negócios'],
  ['/app/forecast', 'Previsão'],
  ['/app/funnel', 'Funil de conversão'],
  ['/app/team', 'Equipe'],
  ['/app/pipeline', 'Pipeline'],
  ['/app/inbox', 'Inbox'],
  ['/app/campaigns', 'Campanhas'],
  ['/app/email/campaigns', 'Campanhas de e-mail'],
  ['/app/whatsapp/templates', 'Templates de WhatsApp'],
  ['/app/tasks', 'Tarefas'],
  ['/app/reports/win-loss', 'Ganhos e Perdas'],
  ['/app/reports', 'Relatórios'],
  ['/app/performance', 'Performance'],
  ['/app/suggestions', 'Sugestões'],
  ['/app/deep-research/painel', 'Painel de desdobramento'],
  ['/app/deep-research', 'Inteligência de Mercado'],
  ['/app/atestados', 'Atestados Técnicos'],
  ['/app/parceiros', 'Parceiros Comerciais'],
  ['/app/settings/deal-config', 'Config. de Negócios'],
  ['/app/settings/products', 'Produtos'],
  ['/app/settings/import', 'Importar'],
  ['/app/settings/webhooks', 'Webhooks'],
  ['/app/settings/api-keys', 'API Keys'],
  ['/app/settings', 'Configurações'],
  ['/app/custom-fields', 'Campos personalizados'],
  ['/app/webhooks', 'Webhooks'],
  ['/app/api-keys', 'API Keys'],
  ['/app/billing', 'Billing'],
  ['/app/profile', 'Perfil'],
  ['/app/admin', 'Plataforma'],
];

export function screenTitleFor(pathname: string): string {
  for (const [prefix, title] of TITLES) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) return title;
  }
  if (pathname === '/app' || pathname === '/app/') return 'Dashboard';
  return 'VYD Engage';
}
