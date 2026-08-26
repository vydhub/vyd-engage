import {
  LayoutDashboard,
  Users,
  UsersRound,
  Building2,
  GitBranch,
  Zap,
  Settings,
  CheckSquare,
  BarChart3,
  Filter,
  Inbox,
  CreditCard,
  Handshake,
  TrendingUp,
  Webhook,
  KeyRound,
  Shield,
  Package,
  Upload,
  Mail,
  ScanSearch,
  MessageSquarePlus,
  CheckCircle,
  Award,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import type { Capability } from '@/types/governance';

export interface NavItem {
  icon: LucideIcon;
  label: string;
  path: string;
  tourId: string;
  adminOnly?: boolean;
  managerOnly?: boolean;
  platformAdminOnly?: boolean;
  /** Item visível apenas quando o usuário tem esta capability (perfil de permissão). */
  capability?: Capability;
}

export interface NavCategory {
  key: string;
  label: string;
  items: NavItem[];
}

// Fonte ÚNICA da navegação do ribbon (extraída do RibbonTabs para poder ser
// consumida também pelo catálogo de rotas da Central de Suporte, sem duplicar
// a lista e sem exportar constante de arquivo de componente — regra do
// eslint-plugin-react-refresh).
//
// Navegação em DOIS NÍVEIS (padrão Office/Autodesk, igual ao projeto Strategy):
// nível 1 = CATEGORIAS (abas .vyd-ribbon-tab); nível 2 = itens da categoria ativa
// na faixa .vyd-ribbon (.vyd-ribbon-item glyph+label).
export const categories: NavCategory[] = [
  {
    key: 'comercial',
    label: 'Comercial',
    items: [
      { icon: LayoutDashboard, label: 'Dashboard', path: '/app', tourId: 'sidebar-dashboard' },
      { icon: Users, label: 'Leads', path: '/app/leads', tourId: 'sidebar-leads' },
      { icon: Building2, label: 'Empresas', path: '/app/companies', tourId: 'sidebar-companies' },
      { icon: Handshake, label: 'Deals', path: '/app/deals', tourId: 'sidebar-deals' },
      { icon: GitBranch, label: 'Pipeline', path: '/app/pipeline', tourId: 'sidebar-pipeline' },
      { icon: CheckSquare, label: 'Tarefas', path: '/app/tasks', tourId: 'sidebar-tasks' },
      {
        icon: UsersRound,
        label: 'Parceiros',
        path: '/app/parceiros',
        tourId: 'sidebar-parceiros',
        capability: 'accessParceiros',
      },
    ],
  },
  {
    key: 'engajamento',
    label: 'Engajamento',
    items: [
      { icon: Inbox, label: 'Inbox', path: '/app/inbox', tourId: 'sidebar-inbox' },
      { icon: Zap, label: 'Automações', path: '/app/automations', tourId: 'sidebar-automations' },
      { icon: Mail, label: 'Campanhas', path: '/app/campaigns', tourId: 'sidebar-campaigns' },
    ],
  },
  {
    key: 'analise',
    label: 'Análise',
    items: [
      { icon: TrendingUp, label: 'Previsão', path: '/app/forecast', tourId: 'sidebar-forecast' },
      { icon: Filter, label: 'Funil Conv.', path: '/app/funnel', tourId: 'sidebar-funnel' },
      { icon: BarChart3, label: 'Relatórios', path: '/app/reports', tourId: 'sidebar-reports' },
      {
        icon: TrendingUp,
        label: 'Performance',
        path: '/app/performance',
        tourId: 'sidebar-performance',
        managerOnly: true,
      },
      {
        icon: ScanSearch,
        label: 'Inteligência de Mercado',
        path: '/app/deep-research',
        tourId: 'sidebar-deep-research',
      },
      {
        icon: Award,
        label: 'Atestados Técnicos',
        path: '/app/atestados',
        tourId: 'sidebar-atestados',
        capability: 'accessAtestados',
      },
      {
        icon: MessageSquarePlus,
        label: 'Sugestões',
        path: '/app/suggestions',
        tourId: 'sidebar-suggestions',
      },
    ],
  },
  {
    key: 'config',
    label: 'Configuração',
    items: [
      {
        icon: UsersRound,
        label: 'Equipe',
        path: '/app/team',
        tourId: 'sidebar-team',
        adminOnly: true,
      },
      {
        icon: Handshake,
        label: 'Config. Negócios',
        path: '/app/settings/deal-config',
        tourId: 'sidebar-deal-config',
        managerOnly: true,
      },
      {
        icon: Package,
        label: 'Produtos',
        path: '/app/settings/products',
        tourId: 'sidebar-products',
        managerOnly: true,
      },
      // Governança (Upgrade RD P1, reqs 15/16): fila de aprovações e lixeira,
      // gated MANAGER_ROLES (mesma proteção das rotas em routes.tsx).
      {
        icon: CheckCircle,
        label: 'Aprovações',
        path: '/app/approvals',
        tourId: 'sidebar-approvals',
        managerOnly: true,
      },
      {
        icon: Trash2,
        label: 'Lixeira',
        path: '/app/trash',
        tourId: 'sidebar-trash',
        managerOnly: true,
      },
      {
        icon: Webhook,
        label: 'Webhooks',
        path: '/app/settings/webhooks',
        tourId: 'sidebar-webhooks',
        adminOnly: true,
      },
      {
        icon: KeyRound,
        label: 'API Keys',
        path: '/app/settings/api-keys',
        tourId: 'sidebar-api-keys',
        adminOnly: true,
      },
      {
        icon: Upload,
        label: 'Importar',
        path: '/app/settings/import',
        tourId: 'sidebar-import',
        adminOnly: true,
      },
      { icon: Settings, label: 'Configurações', path: '/app/settings', tourId: 'sidebar-settings' },
      {
        icon: CreditCard,
        label: 'Billing',
        path: '/app/billing',
        tourId: 'sidebar-billing',
        adminOnly: true,
      },
      {
        icon: Shield,
        label: 'Plataforma',
        path: '/app/admin',
        tourId: 'sidebar-platform-admin',
        platformAdminOnly: true,
      },
    ],
  },
];
