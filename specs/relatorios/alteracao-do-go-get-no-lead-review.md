---
forge_id: FRG-157
veredicto: aprovado
---
# Revisão independente — FRG-157

<!-- forge:medicoes -->
```
$ date -u
Fri Sep 18 12:21:11 UTC 2026
$ date -u
Fri Sep 18 12:44:15 UTC 2026
```
Medições rodadas em 18/09/2026, entre 12:21 e 12:44 UTC, contra a
`origin/main 649137e133317004af4668e04ba76c980d9e94c7` do `vydhub/vyd-engage`
e o banco vivo do Forge `dzelgzesjfokrxqvesch`, mais um banco Postgres 16
local descartável (`vyd_engage_review`, dropado ao final desta sessão) usado
só para a prova HTTP sob privilégio real.
<!-- /forge:medicoes -->

Sou a revisora independente do VYD Forge para esta demanda. Não construí
nada aqui: li a spec, o diff e o relatório do construtor, e medi tudo de
novo, do zero, com fixtures próprias.

## O que li

- `specs/alteracao-do-go-get-no-lead.md` (a Definição de Concluído é a régua).
- `git diff origin/main...HEAD` inteiro (9 arquivos: `server/prisma/schema.prisma`,
  `server/src/__tests__/unit/createLeadPayload.test.ts`, `server/src/routes/leads.ts`,
  `src/components/leads/LeadOpportunityFields.tsx`, `src/pages/LeadForm.tsx`,
  `src/types/index.ts`, `package-lock.json`, `server/package-lock.json` e o
  próprio `-build.md`).
- `specs/relatorios/alteracao-do-go-get-no-lead-build.md`, só para saber onde
  desconfiar mais — toda conclusão dele foi remedida abaixo.

## O que medi, e com quê

**Portão de comandos do repositório** (`forge.repos.portao_comandos` do
`vydhub/vyd-engage`), rodados por mim, do zero (`npm install` na raiz e em
`server/` antes de tudo — sem bloqueio de rede, porque a correção do lockfile
do `xlsx` já está na branch):

- Os quatro **obrigatórios** fecharam limpos (ver "Provas da rotina").
- Os quatro **não obrigatórios**: confirmei, linha a linha, os mesmos 9 erros
  de `npm run lint` (raiz) e os mesmos 2 de `cd server && npm run lint` que o
  `-build.md` relatou — `AutomationBuilder.tsx:131,146`,
  `CompanyQuickSelect.tsx:295`, `ContactQuickSelect.tsx:277`,
  `StatusReasonDialog.tsx:52`, `RibbonTabs.tsx:75,89`, `SupportWidget.tsx:47`,
  `SsoCallback.tsx:44`, `copilotService.ts:787`, `taskService.ts:43`. Nenhum
  desses arquivos aparece em `git diff --name-only origin/main...HEAD`
  (conferido por mim, não citado do relatório) — pré-existentes, fora do
  território desta demanda. `cd server && npm test` continua não executável
  aqui (script roda `vitest` em modo watch).

**Suíte do servidor, rodada inteira por mim** (`cd server && npx vitest run`):
mesmo resultado do `-build.md` — 71 arquivos, 745 testes, 676 passam e 69
falham, os 69 concentrados em 5 arquivos (`auth`, `automations`, `funnels`,
`leads`, `tasks`) todos com `PrismaClientInitializationError: DATABASE_URL`
na primeira chamada ao banco em `beforeEach`. Conferi eu mesma, com `grep -n
probabilityGoGet` nesses 5 arquivos: nenhuma menção — não é regressão desta
entrega. Diferente do `-build.md`, eu **subi um Postgres 16 local** (pacote
já instalado no ambiente desta sessão + `postgresql-16-pgvector`) e apliquei
as 46 migrations do repositório com `npx prisma migrate deploy` — então pude
ir além do que o ambiente de Build permitiu, com a prova HTTP abaixo.

**`createLeadPayload.test.ts` isolado** (`npx vitest run
src/__tests__/unit/createLeadPayload.test.ts`, sem depender de banco): 24/24
verdes, rodado por mim nesta sessão.

**Reprodução funcional independente**, escrita do zero (não copiada do
`-build.md`, dois scripts próprios em `/tmp`, fora do repositório):
- O mesmo shape do schema Zod (`.int().min(0).max(100).optional()` /
  `.nullable()`) contra os 14 casos da spec (0, 33, 100, -1, 101, 33.5,
  ausente/`null`, criação e edição) — todos bateram o esperado.
- `maskGoGetPercent` e `parseGoGetPercent`, meu próprio código a partir do
  requisito 4-6/8 (não copiado do arquivo): `007`→`7`, `abc`→``,
  `33,5`→`335`, `150`→`150`, `-1`→`1`, `0`→`0`, `00`→`0`, `parse('')`→`null`,
  `parse('0')`→`0`, `parse('100')`→`100` — todos bateram.

**Prova sob privilégio real, ponta a ponta via HTTP** (a parte que o
ambiente de Build não conseguiu fazer por falta de banco): com o Postgres
local no ar, criei fixtures próprias com Prisma — um tenant novo
(`revisao-frg-157`), um plano Enterprise + assinatura `ACTIVE` (sem isso o
`planLimitsService` barra a criação com 404), uma empresa, um "contato"
(outro `Lead` com `isContact=true`, como o schema exige) e um usuário
`ADMIN` `ACTIVE` — nenhum superusuário de banco: autenticação real via JWT
assinado com o mesmo `JWT_SECRET` do processo (equivalente ao que o VYD ID
emitiria), CSRF double-submit real, `tenantScope` real. Contra o servidor
real (`node dist/index.js`, build desta branch) bati:

- `POST /api/v1/leads` com `probabilityGoGet: 33` → `201`, lead volta com
  `probabilityGoGet: 33`.
- `POST` com `0` → `201`, grava `0` (confirmado também por leitura direta em
  `psql`, distinto de `NULL`).
- `POST` com `100` → `201`.
- `POST` com `101` → `400` (`too_big`, mensagem em português).
- `POST` com `-1` → `400` (`too_small`).
- `POST` com `33.5` → `400` (`invalid_type`, "expected integer, received
  float").
- `PUT /api/v1/leads/:id` com `33` → `200`, mantém `33`.
- `PUT` com `probabilityGoGet: null` → `200`; conferido em `psql` direto na
  tabela `Lead`: a coluna ficou `NULL` (não `0`, não string vazia).
- `PUT` com `101` → `400`.

Todos os nove batem exatamente a Definição de Concluído. Banco descartável,
dropado ao final; `.env` e o script de fixture (fora do território) nunca
entraram em commit — removidos antes do push, `git status` conferido limpo
depois.

**Front-end — leitura de código, item a item da Definição de Concluído:**
- `grep -rn "GO_GET_STEPS" --include=*.ts --include=*.tsx . | grep -v
  node_modules`: nenhuma linha (rodado por mim).
- `grep -n "Select" src/components/leads/LeadOpportunityFields.tsx`: nenhum
  `Select` entre os rótulos "Probabilidade Go×Get" e "Responsável comercial"
  (os únicos `Select` que sobram são Status, Origem, Motivo e Responsável —
  nenhum é o campo desta demanda).
- O afixo `%` usa `text-muted-foreground`, o mesmo token que o prefixo `R$`
  do campo Valor estimado já usa nas linhas logo acima — sem cor nova, sem
  hex/rgb (regra de UI VYD, `CLAUDE.md`).
- `git diff --stat origin/main...HEAD -- src/pages/LeadDetail.tsx
  src/components/SidePanel.tsx`: vazio — os dois arquivos de leitura não
  foram tocados, como a spec exige como *verificação*.
- `server/prisma/schema.prisma:766`: comentário passou a descrever a faixa
  0-100, sem "degraus fixos".
- `git status --porcelain server/prisma/migrations/`: vazio — nenhuma
  migration nova (Restrição 1 da spec).
- `LeadForm.tsx` — a normalização do rascunho legado
  (`useFormDraft`/`restoredRef`) roda uma vez, na restauração; li
  `useFormDraft.ts` inteiro para confirmar que `restoredRef.current` já está
  correto no primeiro render (é setado de forma síncrona no inicializador do
  `useState`), então o `useEffect` com `[]` não corre risco de disparar antes
  da hora.

**Checagens do lado do Forge (R7 — FRG-158), sempre contra o banco do Forge,
não do repositório da demanda** (aqui só provam que esta entrega não mexeu
no Forge por engano, não que ela é a que a spec pediu — quem prova isso são
os comandos de portão acima):
- Digest do schema `public`: `cbe009cc82f2b619aaf6cc6faa334938` / 993 itens
  — bate com a régua declarada na rotina.
- `select * from forge.demandas_em_voo`: uma única linha, a própria
  FRG-157 — nenhuma outra demanda em construção que pudesse colidir.
- `npm run conferir-corpos -- --live <captura própria>` (rodado do clone do
  `vyd-forge`): achou **uma divergência pré-existente**,
  `forge.conferir_provas_da_rotina` (arquivo `len=9708`
  `md5=f86c53afedb3d594b0fa2fa256c26f21` × banco `len=9974`
  `md5=35763ff76d261ad6707f59e681e59a49`) — **não é desta demanda**: FRG-157
  é do `vyd-engage`, não toca `supabase/migrations/` nem nada de
  `forge.*` (confirmado no `git diff --name-only` acima), e
  `forge.demandas_em_voo` não mostra nenhuma outra demanda em voo que
  explicasse a divergência por colisão. Registro aqui por transparência —
  não corrijo, porque corrigir isso seria mudar escopo para fora da branch
  e do repositório desta demanda (TRAVAS DURAS: não construo nem reescrevo
  entrega alheia). Fica para quem revisar a demanda que tocou por último
  `forge.conferir_provas_da_rotina`.

**Território:** todos os arquivos do diff estão dentro do território
declarado, mais `package-lock.json`/`server/package-lock.json` — a mesma
correção de mirror do `xlsx` (`cdn.sheetjs.com` → `registry.npmjs.org`,
mesma versão `0.20.3`, sem troca de import) que o `-build.md` documentou em
"Para quem pediu", separada em commit próprio. Confirmei que o `npm install`
que rodei nesta sessão não precisou de rede bloqueada — prova de que a
correção realmente resolve o problema que motivou.

**Impacto nas rotinas:** a spec declara "Nenhum" e justifica (`vyd-engage`
não tem `docs/rotinas/`) — confirmei com `ls docs/rotinas/` (não existe) e
`git diff --stat origin/main...HEAD -- docs/rotinas/` (vazio).

## Achados

Nenhum defeito real. A entrega bate a Definição de Concluído inteira, ponta
a ponta — inclusive nos itens de HTTP que o ambiente de Build não conseguiu
provar por falta de banco, e que eu pude provar com um Postgres local
descartável e fixtures próprias, sob autenticação real (não superusuário).

Uma observação sem impacto no veredicto: a divergência pré-existente em
`forge.conferir_provas_da_rotina` (banco do Forge × migration em arquivo),
descrita acima — não é desta demanda, não bloqueia esta revisão, e não
tentei corrigi-la (fora do escopo e do repositório de FRG-157).

## O que corrigi

Nada. Não encontrei defeito real na branch — nenhum commit de correção foi
necessário.

**Veredicto: ✅ APROVADO**

## Provas da rotina

npm run check:colors && npm run lint:css — exit 0 — 2026-09-18T12:40:05Z
npm test — exit 0 — 2026-09-18T12:40:19Z
npm run typecheck:ci — exit 0 — 2026-09-18T12:40:49Z
npm run build — exit 0 — 2026-09-18T12:41:20Z
npm run lint — exit 1 — 2026-09-18T12:41:52Z
cd server && npm run lint — exit 1 — 2026-09-18T12:42:03Z
cd server && npm run build — exit 0 — 2026-09-18T12:42:30Z
cd server && npm test — não executável neste ambiente — o script `test` do `server/package.json` roda `vitest` em modo watch (sem `run`), travaria esta execução sem supervisão; equivalente não faz parte do cadastro de portão, então não substituo por `npx vitest run` aqui
merge origin/main — 649137e133317004af4668e04ba76c980d9e94c7 — 2026-09-18T12:42:48Z
PR: nenhuma

`npm run lint` (raiz, 9 erros) e `cd server && npm run lint` (2 erros) são
comandos não obrigatórios neste repositório; os erros são pré-existentes a
esta demanda — nenhum dos arquivos onde ocorrem aparece em
`git diff --name-only origin/main...HEAD` (conferido por mim nesta sessão,
não herdado do relatório do construtor):
`AutomationBuilder.tsx:131,146`, `CompanyQuickSelect.tsx:295`,
`ContactQuickSelect.tsx:277`, `StatusReasonDialog.tsx:52`,
`RibbonTabs.tsx:75,89`, `SupportWidget.tsx:47`, `SsoCallback.tsx:44` (raiz);
`copilotService.ts:787`, `taskService.ts:43` (server).

### Portão de horários deste relatório

```
$ node /home/user/vyd-forge/scripts/conferir-horarios.mjs --raiz /home/user/vyd-engage specs/relatorios/alteracao-do-go-get-no-lead-review.md
Fri Sep 18 12:44:23 UTC 2026
conferir-horarios: limpo (1 arquivo(s))
exit=0
```
