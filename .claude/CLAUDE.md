# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Princípios Operacionais

**"Never take the lazy path. Do the hard work now."**

- **Explore → Proponha → Valide → Execute → Verifique** (não seja apenas executor de tarefas)
- **Discovery antes de implementação:** mapeie o que já existe antes de criar algo novo
- **Opções antes de implementação:** sempre apresente alternativas com trade-offs
- **Determinismo primeiro:** código/SQL/regex > LLM para tarefas previsíveis
- **Commits atômicos:** uma mudança específica por commit, diff antes de aplicar
- **Só o que foi pedido:** feature não solicitada é débito, não crédito
- **3 linhas duplicadas > 1 abstração prematura**

### Gradiente de Permissão

| Ação | Regra |
|------|-------|
| READ | Livre |
| MOVE | Após aprovação de direção |
| CREATE | Verificar se similar existe primeiro |
| DELETE | **SEMPRE confirmar** |

Aprovação de direção = execute até completar. Não pergunte "Quer que eu continue?" após aprovação já dada.

### Regras Críticas

- **Regra do 2x:** Se o usuário repetiu algo 2x → você não entendeu. PARE e faça EXATAMENTE o pedido.
- **Leitura completa:** NUNCA leia arquivos parcialmente antes de editar. `Read(file)` completo, depois `Edit`.
- **Verificação física:** `ls -la`, `curl -I`, hard refresh antes de declarar "completo".
- **Debugging por hipótese:** 3 hipóteses ordenadas por probabilidade antes de tentar consertar.

---

## Project Overview

**VYD Engage** — CRM SaaS multi-tenant com auth, pagamentos e gerenciamento de leads. Parte do ecossistema VYD (Value Your Day).

| Camada | Stack |
|--------|-------|
| Frontend | React 18 + TypeScript + Vite + TailwindCSS + shadcn/ui + Radix UI |
| Backend | Node.js + Express + TypeScript + Prisma ORM |
| Database | PostgreSQL 16+ |
| Real-time | Socket.IO |
| Auth | JWT + Refresh Tokens + 2FA (TOTP) |
| Payments | Mercado Pago |
| Email | Resend + Nodemailer |
| Jobs | BullMQ + Redis |
| Testing | Vitest (frontend e backend) |

---

## Commands

### Backend (`cd server`)

```bash
npm run dev              # Dev server (port 3001, tsx watch)
npm run build            # Compile TypeScript → dist/ (also serves as typecheck)
npm start                # Run dist/index.js (production)
npm test                 # Vitest (WATCH mode — script é "vitest" sem "run")
npx vitest run           # Vitest single run (use isto em pre-commit / CI)
npm run test:ui          # Vitest UI dashboard
npm run test:coverage    # Coverage report
npm run lint             # ESLint
npm run lint:fix         # ESLint auto-fix
npm run format           # Prettier format
npm run format:check     # Prettier check
npm run prisma:generate  # Regenerate Prisma client
npm run prisma:migrate   # Create/apply migration (dev)
npm run prisma:studio    # Visual DB browser
npm run prisma:seed      # Seed initial data
```

### Frontend (root)

```bash
npm run dev              # Dev server (port 5173)
npm run build            # Production build → build/
npm test                 # Run Vitest (single run)
npm run test:watch       # Vitest watch mode
npm run test:ui          # Vitest UI dashboard
npm run lint             # ESLint
npm run lint:fix         # ESLint auto-fix
npm run format           # Prettier format
npm run format:check     # Prettier check
```

### Pre-commit Verification

```bash
cd server && npx vitest run && npm run build   # Backend tests (single run) + typecheck via tsc
cd .. && npm run build                          # Frontend build (typecheck + bundle)
```

> **Atenção**: o script `npm test` no backend roda Vitest em modo **watch** (não `vitest run`). Use `npx vitest run` ou ajuste o script ao executar em CI/pre-commit, senão trava.

---

## Architecture

### Directory Structure

```
server/                        # Backend API
  src/
    config/                    # DB & app config
    middleware/                 # auth, tenant, rateLimit, errorHandler, planLimits, csrf, requestLogger
    routes/                    # 28 route modules (auth, ai, apiKeys, automationLogs, automations,
                               #   calendar, companies, customFields, deals, email, exports, funnels,
                               #   interactions, invitations, leads, notifications, outgoingWebhooks,
                               #   payments, reports, savedViews, scoring, subscriptions, tags, tasks,
                               #   tracking, users, webhooks, whatsapp)
    services/                  # Business logic (~35 services: authService, automationService,
                               #   aiDraftService, dealService, forecastService, googleCalendarService,
                               #   nextActionService, scoringService, socketService, etc.)
    jobs/                      # 3 background jobs:
                               #   - billing.ts (BullMQ; gated por ENABLE_BILLING_JOBS)
                               #   - automationEngine.ts (BullMQ; gated por ENABLE_AUTOMATION_ENGINE)
                               #   - taskNotificationChecker.ts (sempre ativo, lightweight, sem Redis)
    utils/                     # logger, sentry, validators
    __tests__/                 # Vitest tests
  prisma/
    schema.prisma              # All model definitions
    migrations/                # DB migrations
    seed.ts                    # Seed script

src/                           # Frontend (React)
  components/
    ui/                        # shadcn/ui + Radix primitives
    email/, payment/, register/, whatsapp/
  pages/                       # Page components (lazy-loaded)
  contexts/                    # AuthContext, PlanContext, PaymentContext
  hooks/                       # Custom React hooks
  services/api/                # API client utilities
  utils/                       # Shared utilities (email, validation, whatsapp)
  types/                       # TypeScript type definitions
```

### Multi-Tenancy (Foundational Pattern)

Todo request passa por `tenantMiddleware` que seta `req.tenantId`. **Todas as queries Prisma devem filtrar por `tenantId`:**

```typescript
const leads = await prisma.lead.findMany({ where: { tenantId } });
```

### Authentication Flow

1. Login → JWT + Refresh Token emitidos
2. JWT no Authorization header de cada request
3. Refresh tokens no DB com expiração
4. Password reset via tokens temporários por email
5. 2FA opcional (TOTP)

Key files: `server/src/services/authService.ts`, `server/src/routes/auth.ts`, `server/src/middleware/auth.ts`

### Rate Limiting

Três limiters separados em `server/src/middleware/rateLimit.ts`:
- `apiLimiter` — API geral
- `authLimiter` — login/register
- `passwordResetLimiter` — reset de senha

### Frontend Routing

Routes definidas em `src/utils/routes.tsx` com React Router v6 + lazy loading:
- **Públicas:** `/login`, `/register`, `/forgot-password`, `/reset-password`, `/onboarding`, `/capture/:formId`
- **Protegidas** (`/app/*`): dashboard, leads, deals, pipeline, tasks, automations, settings, billing, reports, inbox, whatsapp, email campaigns

Lazy loading via `lazyNamed()` wrapper + Suspense. Protected routes via `RequireAuth` component.

### Frontend Code Splitting

Configurado em `vite.config.ts` com manual chunks:
- `vendor-react` — React, React Router
- `vendor-radix` — Radix UI components
- `vendor-recharts` — Charts
- `vendor-exceljs` — Excel exports

Path alias: `@` → `./src`

### Backend Entry Point

`server/src/index.ts` configura: Express + Socket.IO + CORS + Helmet + Compression + Morgan + Rate Limiting + CSRF + Sentry (opcional) + BullMQ jobs (opcional).

### API Versioning

Todas as rotas são montadas em **dois prefixos** (`server/src/index.ts:225-226`):
- `/api/v1` → canônico
- `/api` → alias backward-compat (mesma router instance)

Header `X-API-Version: 1` é setado em todas as respostas v1. Cliente frontend usa exclusivamente `/api/v1/*`.

### Public Routes (no auth, no CSRF)

Montadas em `/api/public` e `/api/v1/public` (`server/src/index.ts:230-327`):
- `POST /capture/:tenantSlug` — formulário público de captação de lead (Zod schema embedded)
- `GET /plans` — pricing público para landing page

Tracking pixel/links também são públicos: `/api/v1/track/*` (sem auth, sem CSRF).

### CSRF (whitelist)

CSRF é aplicado por **whitelist explícita** em `server/src/index.ts:163-190`, NÃO por blacklist. Rotas como `/auth/login`, `/auth/register`, `/auth/refresh`, `/track`, `/webhooks` (HMAC) e public routes **não têm CSRF**. Se adicionar uma nova rota autenticada, registre `v1Router.use('/<rota>', csrfProtection)`.

### Health Check

`GET /health` consome `getHealthStatus()` em `server/src/utils/healthCheck.ts`. Retorna 200 se healthy, 503 caso contrário. Use para liveness/readiness probes.

### Middleware Stack (route pattern)

```typescript
router.get('/:id', authMiddleware, tenantMiddleware, apiLimiter, async (req, res, next) => {
  try { /* ... */ } catch (error) { next(error); }
});
```

### Database Models (Prisma)

| Grupo | Models |
|-------|--------|
| Auth | User, RefreshToken, Invitation |
| Tenant | Tenant |
| Billing | Plan, Subscription, Payment |
| CRM Core | Lead, Deal, Task, Company, LeadTag, Tag, CustomField, Interaction |
| Sales | Funnel, FunnelColumn, ScoreRule |
| Integrations | WhatsAppConnection, EmailConfig, Automation, AutomationLog, CalendarConnection |
| Developer | ApiKey, Webhook, WebhookLog |
| Notifications | Notification |
| Reports / Views | Report, SavedView |

> Schema canônico: `server/prisma/schema.prisma`. Quando em dúvida, consulte direto.

### API Response Format

```typescript
// Success
{ status: 200, data: { ... } }
// Error
{ status: 400, error: "Description", details?: { fieldName: "message" } }
```

### Validation

Zod para runtime validation em requests:
```typescript
const schema = z.object({ name: z.string().min(1), email: z.string().email() });
```

---

## Naming Conventions

| Contexto | Convenção | Exemplo |
|----------|-----------|---------|
| Routes | kebab-case | `/api/custom-fields` |
| Services | PascalCase + Service | `AuthService` |
| Utilities | camelCase | `validateEmail` |
| Components | PascalCase | `LeadCard` |
| DB columns | snake_case | Prisma models |
| Enums | UPPER_SNAKE_CASE | `UserRole.ADMIN` |

---

## Environment Variables

**Backend** (`server/.env` — template em `server/.env.example`):

| Variável | Obrigatória? | Notas |
|----------|--------------|-------|
| `DATABASE_URL` | **sim** | Postgres connection string. Server crasha sem isso. |
| `JWT_SECRET` | **sim** | Token de acesso. |
| `JWT_REFRESH_SECRET` | **sim** | Refresh token. |
| `JWT_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | não | Defaults: `15m` / `7d`. |
| `ENCRYPTION_KEY` | **sim p/ 2FA + email/WhatsApp configs** | Gere com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `PORT` | não | Default `3001`. |
| `NODE_ENV` | não | `development` ou `production`. |
| `FRONTEND_URL` | prod | Fallback de CORS quando `CORS_ORIGINS` vazio. |
| `CORS_ORIGINS` | não | CSV de origens. Sobrescreve default. |
| `REDIS_URL` | só p/ jobs | Necessário se `ENABLE_BILLING_JOBS` ou `ENABLE_AUTOMATION_ENGINE` = `true`. |
| `ENABLE_BILLING_JOBS` | não | Default `false`. |
| `ENABLE_AUTOMATION_ENGINE` | não | Default `false`. |
| `MERCADOPAGO_ACCESS_TOKEN` / `MERCADOPAGO_PUBLIC_KEY` | só p/ pagamentos | — |
| `RESEND_API_KEY` | só p/ email transacional | Alternativa ao SMTP. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | só p/ email transacional | — |
| `EMAIL_WEBHOOK_SECRET` | não | Se setado, webhooks de email exigem `x-webhook-secret`. |
| `SENTRY_DSN` | não | Habilita Sentry. |
| `OPENAI_API_KEY` | só p/ AI drafts/next-action | `aiDraftService.ts`, `nextActionService.ts`. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | só p/ Calendar | `googleCalendarService.ts`. |
| `EXTERNAL_BASE_URL` | só p/ tracking | Base pública usada em pixels/links. |

**Frontend** (`.env` na raiz):

| Variável | Notas |
|----------|-------|
| `VITE_API_URL` | Em **produção é a PRÓPRIA origem do frontend** (`https://engage.vydhub.com`), não a URL do Railway — e isso é intencional. O backend é alcançado por **rewrite** no `vercel.json` (`/api` e `/socket.io` → Railway), mantendo tudo same-origin. **NÃO troque para a URL do Railway:** o CSRF é double-submit lido de `document.cookie` (`src/services/api/client.ts`), o JS ficaria cego para o `csrf-token` vindo de outro host e **toda escrita passaria a dar 403**; além disso os cookies são host-only (`server/src/utils/cookies.ts`, sem `domain`) e o handshake do socket seria recusado. **Na Vercel ela existe só no ambiente Production:** os previews ficam sem ela e caem na própria origem do preview (`getApiUrl` em `client.ts`, que o `useSocket` também usa). Se ela voltar a valer para Preview, todo preview fala com `engage.vydhub.com` e o login de um preview termina em produção. Em dev local, `http://localhost:3001`. |

> **Setup local primeiro acesso:** se `server/.env` não existe, copie de `.env.example`: `cp server/.env.example server/.env`. Sem isso o backend não sobe e o login não responde.

## Deploy

| Componente | Plataforma | Config |
|------------|------------|--------|
| Backend | Railway | `railway.toml` na raiz aponta para `server/` (`cd server && npm ci && npm run build` → `npm start`). |
| Frontend | Vercel | Build via `npm run build` → `build/`. `VITE_API_URL` já está setada só em Production (= a própria origem — ver tabela acima). O login de um preview volta ao preview porque o botão usa o handoff do portal (`src/lib/vydId.ts`) e o app `engage` do IdP aceita `https://vyd-engage-*-klebers-projects-2f5727d9.vercel.app` em `allowed_redirect_urls`. O `vercel.json` proxia `/api` e `/socket.io` até o Railway; a regra do `/socket.io` **tem que vir antes do catch-all**, senão o handshake recebe o `index.html`. A Vercel proxia o polling mas **não** o upgrade de WebSocket (medido: `400`), por isso o cliente conecta com `transports: ['polling','websocket']`. |
| Postgres | Externo (Supabase/Railway/Neon) | Connection string em `DATABASE_URL`. |
| Redis | Externo (Upstash/Railway) | Apenas se jobs habilitados. |

---

## Synkra AIOX Integration

Sistema de agentes para orquestração de desenvolvimento. Detalhes completos em `.claude/rules/`.

### Agent Activation

`@agent-name` ou `/AIOX:agents:agent-name`. Comandos com prefixo `*`: `*help`, `*create-story`, `*task`, `*exit`.

| Agente | Persona | Escopo |
|--------|---------|--------|
| @dev (Dex) | Implementação | git add/commit/branch (NÃO push) |
| @qa (Quinn) | Testes e qualidade | QA gate, qa-loop |
| @architect (Aria) | Arquitetura | Decisões técnicas |
| @pm (Morgan) | Product Management | Epics, specs |
| @po (Pax) | Product Owner | Validação de stories |
| @sm (River) | Scrum Master | Criação de stories |
| @analyst (Alex) | Pesquisa | Análise e research |
| @data-engineer (Dara) | Database | Schema, migrations, RLS |
| @ux-design-expert (Uma) | UX/UI | Design |
| @devops (Gage) | CI/CD | **EXCLUSIVO:** git push, gh pr, MCP management |

### Story Flow

```
@sm *draft → @po *validate → @dev *develop → @qa *qa-gate → @devops *push
```

### Rules (auto-loaded from `.claude/rules/`)

- `agent-authority.md` — Delegation matrix, exclusive operations
- `agent-handoff.md` — Context compaction on agent switch
- `story-lifecycle.md` — Story status transitions, QA gates
- `workflow-execution.md` — SDC, QA Loop, Spec Pipeline, Brownfield
- `ids-principles.md` — Incremental Development System
- `mcp-usage.md` — MCP tool selection priority
- `coderabbit-integration.md` — Automated code review

---

## Git Conventions

- Conventional commits: `feat:`, `fix:`, `docs:`, `chore:`
- Reference story ID: `feat: implement lead search [Story 3.2]`
- Atomic, focused commits
- **@dev** pode: `git add`, `commit`, `branch`, `checkout`, `merge` (local), `stash`, `diff`, `log`
- **@dev** NÃO pode: `git push`, `gh pr create/merge` → delegar para **@devops**
