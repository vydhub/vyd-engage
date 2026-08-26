import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter } from 'react-router';
import { AppShell } from '../components/shell/AppShell';
import { RequireAuth } from '../components/RequireAuth';
import { RequireCapability } from '../components/RequireCapability';
import { ErrorBoundary } from '../components/ErrorBoundary';

// Loading fallback
function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  );
}

// Lazy wrapper for named exports — each route gets its own ErrorBoundary
function lazyNamed<T extends Record<string, any>>(factory: () => Promise<T>, name: keyof T) {
  const Component = lazy(() => factory().then((mod) => ({ default: mod[name] as any })));
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        <Component />
      </Suspense>
    </ErrorBoundary>
  );
}

// Gating por papel (spec papeis-comerciais). Envolve o elemento da rota exigindo
// papéis específicos; navegação direta a rota sem permissão é bloqueada no front
// (a API também bloqueia — defesa em profundidade).
const MANAGER_ROLES = ['ADMIN', 'GESTOR']; // estrategista + admin
const ADMIN_ROLES = ['ADMIN'];
function guard(element: ReactNode, roles: string[]) {
  return <RequireAuth requiredRoles={roles}>{element}</RequireAuth>;
}

// Public pages
const LandingPage = lazyNamed(() => import('../pages/LandingPage'), 'LandingPage');
const Login = lazyNamed(() => import('../pages/Login'), 'Login');
const Onboarding = lazyNamed(() => import('../pages/Onboarding'), 'Onboarding');
const PublicForm = lazyNamed(() => import('../pages/PublicForm'), 'PublicForm');
const PublicSchedule = lazyNamed(() => import('../pages/PublicSchedule'), 'PublicSchedule');
const AcceptInvitation = lazyNamed(() => import('../pages/AcceptInvitation'), 'AcceptInvitation');
const SsoCallback = lazyNamed(() => import('../pages/SsoCallback'), 'SsoCallback');

// App pages (behind auth)
const Dashboard = lazyNamed(() => import('../pages/Dashboard'), 'Dashboard');
const Leads = lazyNamed(() => import('../pages/Leads'), 'Leads');
const LeadForm = lazyNamed(() => import('../pages/LeadForm'), 'LeadForm');
const Pipeline = lazyNamed(() => import('../pages/Pipeline'), 'Pipeline');
const Automations = lazyNamed(() => import('../pages/Automations'), 'Automations');
const AutomationBuilderPage = lazyNamed(
  () => import('../pages/AutomationBuilderPage'),
  'AutomationBuilderPage'
);
const AutomationLogs = lazyNamed(() => import('../pages/AutomationLogs'), 'AutomationLogs');
const Settings = lazyNamed(() => import('../pages/Settings'), 'Settings');
const CustomFields = lazyNamed(() => import('../pages/CustomFields'), 'CustomFields');
const Tasks = lazyNamed(() => import('../pages/Tasks'), 'Tasks');
const TaskForm = lazyNamed(() => import('../pages/TaskForm'), 'TaskForm');
const Profile = lazyNamed(() => import('../pages/Profile'), 'Profile');
const Inbox = lazyNamed(() => import('../pages/Inbox'), 'Inbox');
const Billing = lazyNamed(() => import('../pages/Billing'), 'Billing');
const Reports = lazyNamed(() => import('../pages/Reports'), 'Reports');
const ReportBuilder = lazyNamed(() => import('../pages/ReportBuilder'), 'ReportBuilder');
const ReportView = lazyNamed(() => import('../pages/ReportView'), 'ReportView');
const WhatsAppTemplates = lazyNamed(
  () => import('../pages/WhatsAppTemplates'),
  'WhatsAppTemplates'
);
const EmailCampaigns = lazyNamed(() => import('../pages/EmailCampaigns'), 'EmailCampaigns');
const TeamManagement = lazyNamed(() => import('../pages/TeamManagement'), 'TeamManagement');
const LeadDetail = lazyNamed(() => import('../pages/LeadDetail'), 'LeadDetail');
const LeadDuplicates = lazyNamed(() => import('../pages/LeadDuplicates'), 'LeadDuplicates');
const Companies = lazyNamed(() => import('../pages/Companies'), 'Companies');
const CompanyDetail = lazyNamed(() => import('../pages/CompanyDetail'), 'CompanyDetail');
const Deals = lazyNamed(() => import('../pages/Deals'), 'Deals');
const DealDetail = lazyNamed(() => import('../pages/DealDetail'), 'DealDetail');
const Forecast = lazyNamed(() => import('../pages/Forecast'), 'Forecast');
const FunnelConversion = lazyNamed(() => import('../pages/FunnelConversion'), 'FunnelConversion');
const Webhooks = lazyNamed(() => import('../pages/Webhooks'), 'Webhooks');
const ApiKeys = lazyNamed(() => import('../pages/ApiKeys'), 'ApiKeys');
const PlatformAdmin = lazyNamed(() => import('../pages/PlatformAdmin'), 'PlatformAdmin');
const TeamPerformance = lazyNamed(() => import('../pages/TeamPerformance'), 'TeamPerformance');
const WinLossReport = lazyNamed(() => import('../pages/WinLossReport'), 'WinLossReport');
const Products = lazyNamed(() => import('../pages/Products'), 'Products');
const Import = lazyNamed(() => import('../pages/Import'), 'Import');
const Campaigns = lazyNamed(() => import('../pages/Campaigns'), 'Campaigns');
const CampaignWizard = lazyNamed(() => import('../pages/CampaignWizard'), 'CampaignWizard');
const CampaignDetail = lazyNamed(() => import('../pages/CampaignDetail'), 'CampaignDetail');
const DeepResearch = lazyNamed(() => import('../pages/DeepResearch'), 'DeepResearch');
const DeepResearchView = lazyNamed(() => import('../pages/DeepResearchView'), 'DeepResearchView');
const RoadmapView = lazyNamed(() => import('../pages/RoadmapView'), 'RoadmapView');
const RoadmapPanelView = lazyNamed(() => import('../pages/RoadmapPanelView'), 'RoadmapPanelView');
const Suggestions = lazyNamed(() => import('../pages/Suggestions'), 'Suggestions');
const DealSettings = lazyNamed(() => import('../pages/DealSettings'), 'DealSettings');
const Approvals = lazyNamed(() => import('../pages/Approvals'), 'Approvals');
const Atestados = lazyNamed(() => import('../pages/Atestados'), 'Atestados');
const Parceiros = lazyNamed(() => import('../pages/Parceiros'), 'Parceiros');
const PortalParceiro = lazyNamed(() => import('../pages/PortalParceiro'), 'PortalParceiro');
const Trash = lazyNamed(() => import('../pages/Trash'), 'Trash');

export const router = createBrowserRouter([
  {
    path: '/',
    element: LandingPage,
  },
  {
    path: '/login',
    element: Login,
  },
  {
    path: '/onboarding',
    element: Onboarding,
  },
  {
    // Portal do Parceiro — consultor externo (papel CONSULTOR). Shell próprio,
    // fora do AppShell interno; RequireAuth redireciona internos p/ /app.
    path: '/portal',
    element: <RequireAuth requiredRoles={['CONSULTOR']}>{PortalParceiro}</RequireAuth>,
  },
  {
    path: '/capture/:formId',
    element: PublicForm,
  },
  {
    path: '/s/:slug',
    element: PublicSchedule,
  },
  {
    path: '/accept-invitation',
    element: AcceptInvitation,
  },
  {
    // Callback público do SSO VYD ID (portal id.vydhub.com) — lê o fragmento
    // #vyd_token=… e troca pela sessão nativa (ver src/pages/SsoCallback.tsx).
    path: '/sso',
    element: SsoCallback,
  },
  {
    path: '/app',
    element: (
      <RequireAuth>
        <ErrorBoundary>
          <AppShell />
        </ErrorBoundary>
      </RequireAuth>
    ),
    children: [
      {
        index: true,
        element: Dashboard,
      },
      {
        path: 'suggestions',
        element: Suggestions,
      },
      {
        path: 'settings/deal-config',
        element: guard(DealSettings, MANAGER_ROLES),
      },
      {
        path: 'leads',
        element: Leads,
      },
      {
        path: 'leads/new',
        element: LeadForm,
      },
      {
        path: 'leads/duplicates',
        element: LeadDuplicates,
      },
      {
        path: 'leads/:id/edit',
        element: LeadForm,
      },
      {
        path: 'leads/:id',
        element: LeadDetail,
      },
      {
        path: 'companies',
        element: Companies,
      },
      {
        path: 'companies/:id',
        element: CompanyDetail,
      },
      {
        path: 'deals',
        element: Deals,
      },
      {
        path: 'deals/:id',
        element: DealDetail,
      },
      {
        path: 'forecast',
        element: Forecast,
      },
      {
        path: 'funnel',
        element: FunnelConversion,
      },
      {
        path: 'team',
        element: guard(TeamManagement, MANAGER_ROLES),
      },
      {
        path: 'pipeline',
        element: Pipeline,
      },
      {
        path: 'automations',
        element: Automations,
      },
      {
        // Editor único: o builder visual. As rotas /builder ficam como alias
        // retrocompatível dos links existentes.
        path: 'automations/new',
        element: AutomationBuilderPage,
      },
      {
        path: 'automations/new/builder',
        element: AutomationBuilderPage,
      },
      {
        path: 'automations/logs',
        element: AutomationLogs,
      },
      {
        path: 'automations/:id',
        element: AutomationBuilderPage,
      },
      {
        path: 'automations/:id/builder',
        element: AutomationBuilderPage,
      },
      {
        path: 'settings',
        element: Settings,
      },
      {
        path: 'custom-fields',
        element: CustomFields,
      },
      {
        path: 'tasks',
        element: Tasks,
      },
      {
        path: 'tasks/new',
        element: TaskForm,
      },
      {
        path: 'tasks/:id/edit',
        element: TaskForm,
      },
      {
        path: 'profile',
        element: Profile,
      },
      {
        path: 'inbox',
        element: Inbox,
      },
      {
        path: 'billing',
        element: guard(Billing, ADMIN_ROLES),
      },
      {
        path: 'whatsapp/templates',
        element: WhatsAppTemplates,
      },
      {
        path: 'email/campaigns',
        element: EmailCampaigns,
      },
      {
        path: 'campaigns',
        element: Campaigns,
      },
      {
        path: 'campaigns/new',
        element: CampaignWizard,
      },
      {
        path: 'campaigns/:id',
        element: CampaignDetail,
      },
      {
        path: 'reports',
        element: Reports,
      },
      {
        path: 'reports/new',
        element: ReportBuilder,
      },
      {
        path: 'reports/view/:id',
        element: ReportView,
      },
      {
        path: 'reports/:id',
        element: ReportBuilder,
      },
      {
        path: 'performance',
        element: guard(TeamPerformance, MANAGER_ROLES),
      },
      {
        path: 'deep-research',
        element: DeepResearch,
      },
      {
        path: 'atestados',
        element: <RequireCapability cap="accessAtestados">{Atestados}</RequireCapability>,
      },
      {
        path: 'parceiros',
        element: <RequireCapability cap="accessParceiros">{Parceiros}</RequireCapability>,
      },
      {
        path: 'deep-research/painel',
        element: guard(RoadmapPanelView, MANAGER_ROLES),
      },
      {
        path: 'deep-research/desdobramento/:id',
        element: guard(RoadmapView, MANAGER_ROLES),
      },
      {
        path: 'deep-research/:id',
        element: DeepResearchView,
      },
      {
        path: 'reports/win-loss',
        element: guard(WinLossReport, MANAGER_ROLES),
      },
      {
        path: 'settings/products',
        element: guard(Products, MANAGER_ROLES),
      },
      {
        path: 'settings/import',
        element: guard(Import, ADMIN_ROLES),
      },
      {
        path: 'webhooks',
        element: guard(Webhooks, ADMIN_ROLES),
      },
      {
        // Spec-required path for the API Hub webhooks page (API-1.2, req 8).
        path: 'settings/webhooks',
        element: guard(Webhooks, ADMIN_ROLES),
      },
      {
        path: 'api-keys',
        element: guard(ApiKeys, ADMIN_ROLES),
      },
      {
        // Spec-required path for the API keys page with scopes (API-2.1, req 21).
        path: 'settings/api-keys',
        element: guard(ApiKeys, ADMIN_ROLES),
      },
      {
        // Aprovações (Upgrade RD P1, req 15) — apenas autenticada: o solicitante
        // (USER restrito) precisa abrir "Minhas solicitações" p/ baixar sua
        // exportação aprovada. A fila pendente (aprovar/rejeitar) segue protegida
        // no backend (requireRole) e no componente (isManagerRole).
        path: 'approvals',
        element: Approvals,
      },
      {
        // Lixeira / restauração (Upgrade RD P1, req 16) — gated MANAGER_ROLES.
        path: 'trash',
        element: guard(Trash, MANAGER_ROLES),
      },
      {
        path: 'admin',
        element: PlatformAdmin,
      },
    ],
  },
]);
