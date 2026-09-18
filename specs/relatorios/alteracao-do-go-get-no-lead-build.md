---
forge_id: FRG-157
---
# Relatório de Build — FRG-157

<!-- forge:medicoes -->
```
$ date -u
Fri Sep 18 12:06:11 UTC 2026
$ date -u
Fri Sep 18 12:15:46 UTC 2026
```
Medições rodadas em 18/09/2026, entre 12:06 e 12:15 UTC, contra a
`origin/main 649137e133317004af4668e04ba76c980d9e94c7` do `vydhub/vyd-engage`.
<!-- /forge:medicoes -->

## Autoavaliação (D15)

### Rubrica (definida antes do código, a partir dos Requisitos Obrigatórios
e da Definição de Concluído de `specs/alteracao-do-go-get-no-lead.md`)

| Critério | Peso |
|---|---|
| Requisitos 1-3 — `Select` vira campo de texto numérico em `LeadOpportunityFields.tsx`, sufixo `%` no molde do Valor estimado, troca contida a esse único componente (cobre cadastro e edição) | 20 |
| Requisitos 4-6, 8 — máscara só-dígitos sem decimal/sinal/separador, campo opcional (`''` → `null`), `0` válido e distinto de vazio, limpeza explícita continua gravando `null` | 20 |
| Requisito 7 — back-end aceita inteiro 0-100 e recusa o resto com `400`, mensagem em português, mesmo formato de erro da rota | 15 |
| Requisitos 9-10 — `GO_GET_STEPS` removida dos três lugares (nenhum import sobra) e comentário do schema atualizado, sem migration | 10 |
| Requisito 11 — testes reescritos cobrindo os sete casos (`0`, `33`, `100`, `-1`, `101`, `33.5`, `null`) na criação e na edição | 15 |
| Requisito 12 — leitura em `LeadDetail.tsx`/`SidePanel.tsx` funciona sem alteração de código nesses dois arquivos (verificação, não edição) | 5 |
| Casos extremos — rascunho antigo (`useFormDraft`) tolera número/`null`/ausente sem derrubar o formulário; zeros à esquerda normalizados; texto colado é descartado | 10 |
| Portão de comandos obrigatórios do repositório (`check:colors`+`lint:css`, `npm test`, `npm run typecheck:ci`, `npm run build`) limpos, mais `npm run lint` (raiz e server) e suíte do server | 5 |

Total: 100. A nota de cada rodada é a soma do que sobrevive à autocrítica,
não uma estimativa — cada dedução abaixo aponta o critério e o motivo.

### Trajetória de notas

**Rodada 1 — implementação completa, 95/100.**

- Requisitos 1-3 (20/20): `Select` de cinco degraus virou `Input` com sufixo
  `%` posicionado à direita, mesmo molde do `Input` de Valor estimado
  (prefixo `R$` à esquerda). A troca ficou contida a
  `LeadOpportunityFields.tsx` — `grep -n "Select"` entre os rótulos
  `Probabilidade Go×Get` e `Responsável comercial` não encontra nenhum
  `Select` (conferido nesta rodada). `LeadForm.tsx` (cadastro) e
  `LeadModal.tsx` (Kanban) continuam consumindo o mesmo componente, sem
  edição própria em nenhum dos dois além do necessário para o rascunho.
- Requisitos 4-6, 8 (20/20): `maskGoGetPercent` só deixa dígito passar e
  normaliza zero à esquerda (`raw.replace(/\D/g, '').replace(/^0+(?=\d)/,
  '')` — mesma forma de `maskCurrencyBRL`, sem a parte de centavos).
  `parseGoGetPercent('')` devolve `null`; `parseGoGetPercent('0')` devolve o
  inteiro `0` (distinto de vazio). `opportunityValuesToLeadPayload` sempre
  chama `parseGoGetPercent`, então apagar o campo grava `null` explícito.
  Verificado nesta rodada com uma reprodução funcional das duas funções
  (corpo idêntico, byte a byte, ao de `LeadOpportunityFields.tsx:84-94` —
  conferido com `sed` contra o arquivo real antes de aceitar o resultado,
  para não medir a mesma coisa duas vezes sem checar a fonte):
  `007`→`"7"`, `abc`→`""`, `33,5`→`"335"` (vírgula descartada, dígitos
  ficam — quem bloqueia o valor final é a validação, não a máscara),
  `-1`→`"1"` (sinal descartado), `parse("")`→`null`, `parse("0")`→`0`,
  `parse("100")`→`100`.
- Requisito 7 (15/15): `createLeadSchema` e `updateLeadSchema` trocaram o
  `.refine()` dos degraus por `.int().min(0).max(100)`, com a mesma
  mensagem em português nos três pontos de falha (`Probabilidade Go×Get
  deve ser um número inteiro entre 0 e 100`) — o formato de erro
  continua sendo um `ZodError` comum, mesmo pipeline que a rota já usava.
  `cd server && npm run build` (tsc) fechou limpo com o schema novo.
- Requisitos 9-10 (10/10): `grep -rn "GO_GET_STEPS" --include=*.ts
  --include=*.tsx . | grep -v node_modules` não devolve nenhuma linha
  (conferido nesta rodada, depois da remoção nos três arquivos:
  `src/types/index.ts`, `server/src/routes/leads.ts`,
  `createLeadPayload.test.ts`). O comentário de
  `server/prisma/schema.prisma:766` passou a descrever a faixa 0-100.
  `git status --porcelain server/prisma/migrations/` sem saída — nenhuma
  migration nova.
- Requisito 11 (15/15): `createLeadPayload.test.ts` reescrito com os sete
  casos (`0`, `33`, `100`, `-1`, `101`, `33.5` na criação e na edição;
  `null` só na edição) — 24 testes no arquivo, todos verdes
  (`npx vitest run` isolado neste arquivo).
- Requisito 12 (5/5): `git diff --stat origin/main...HEAD --
  src/pages/LeadDetail.tsx src/components/SidePanel.tsx` devolve vazio —
  nenhum dos dois arquivos foi tocado, exatamente como a spec pede como
  verificação.
- Casos extremos (8/10, -2): o rascunho antigo (`LeadForm.tsx`) é
  normalizado uma vez na restauração (`legado == null ? '' :
  String(legado)`), com a mesma lógica conferida na reprodução funcional
  acima (`normalizeDraft`). A dedução é por falta de prova automatizada
  desse caminho especificamente: o Território desta demanda não inclui
  nenhum arquivo de teste de front-end para `LeadForm.tsx` ou
  `useFormDraft`, e criar um novo arquivo de teste extrapolaria o
  Território declarado na spec (`REGRAS QUE VALEM SEMPRE` do
  `docs/rotinas/build.md` do `vyd-forge` proíbe invadir; o `-build.md` é o
  único arquivo novo autorizado fora da lista). A prova que ficou é a
  reprodução funcional da lógica (fora do repositório) mais a leitura de
  código — não é o mesmo peso que um teste automatizado que roda no CI.
- Portão (2/5, -3): os quatro comandos **obrigatórios** do repositório
  (`npm run check:colors && npm run lint:css`, `npm test`, `npm run
  typecheck:ci`, `npm run build`) fecharam limpos. Os não obrigatórios
  `npm run lint` (raiz, 9 erros) e `cd server && npm run lint` (2 erros)
  têm erros, mas todos pré-existentes e fora do território desta demanda
  (conferido linha a linha contra `origin/main` — ver "Provas da rotina").
  A dedução principal é a Definição de Concluído da própria spec, que pede
  `cd server && npx vitest run` passando **inteiro** — cinco arquivos de
  teste do servidor (`auth`, `automations`, `funnels`, `leads`, `tasks`)
  não rodam neste ambiente porque `DATABASE_URL` não está definida
  (nenhum Postgres alcançável por esta rotina de Build fora do schema
  `forge` do próprio Forge) — falha de conexão antes de qualquer
  asserção, em nenhum dos cinco arquivos há menção a `probabilityGoGet`
  (conferido com `grep`), então não é uma regressão desta entrega, mas é
  uma parte da régua da spec que esta rotina não consegue provar aqui.
  `createLeadPayload.test.ts` (o arquivo desta demanda, que não depende de
  banco) roda inteiro e passa: 24/24.

**Não há rodada 2.** As duas deduções são estruturais ao ambiente desta
rotina (sem banco Postgres, sem território para um novo arquivo de teste
de front-end) e não a um defeito de código — reescrever a implementação
não mudaria nenhuma das duas. A nota final desta entrega é **95/100**.

## Para quem pediu

**O que foi feito:** o campo **Probabilidade Go×Get**, no cadastro e na
edição de um lead, deixou de ser uma lista fechada de cinco opções (10%,
25%, 50%, 75%, 90%) e passou a ser um campo onde se digita o número
desejado, de 0 a 100.

**O que muda para quem usa:**
- Ao abrir o cadastro ou a edição de um lead, o campo **Probabilidade
  Go×Get** aparece como uma caixa de digitação com o sinal `%` ao lado, no
  mesmo formato do campo **Valor estimado** logo acima.
- Só dígitos entram no campo: vírgula, ponto, sinal de menos e letras são
  descartados na hora de digitar. `007` vira `7`.
- Deixar o campo vazio e salvar grava "não definida" — como já acontecia
  ao escolher a opção "Não definida" na lista antiga.
- Digitar `0` e salvar grava `0%`, distinto de "não definida".
- Digitar um número maior que 100 impede salvar, com aviso na tela; o
  servidor também recusa esse valor, mesmo se a tela for contornada.
- Leads já cadastrados com um dos cinco valores antigos (10/25/50/75/90)
  continuam abrindo e salvando normalmente, sem nenhuma conversão.
- A exibição do valor no detalhe do lead e no painel lateral não mudou —
  os dois já mostravam `valor%` para qualquer número.

**O que ficou declaradamente em aberto:**
- **A conferência visual em navegador real** (digitar, ver o aviso de
  erro, ver o `%` posicionado) não foi feita por esta rotina — ela não
  tem acesso a um navegador autenticado. A prova ficou nos testes
  automatizados do schema do servidor (24 casos, todos verdes) e na
  leitura de código linha a linha.
- **A suíte completa do servidor (`cd server && npx vitest run`) não
  rodou inteira neste ambiente**, porque não há um banco Postgres
  alcançável aqui (`DATABASE_URL` ausente) — cinco arquivos de teste que
  dependem de banco (nenhum deles sobre Go×Get) não executam. O arquivo
  desta demanda (`createLeadPayload.test.ts`), que não depende de banco,
  roda inteiro e passa. Não há evidência de que os cinco arquivos
  bloqueados tenham qualquer relação com esta mudança — é uma limitação
  de ambiente desta rotina, não do código entregue.
- **`npm run lint` (raiz) e `cd server && npm run lint`** continuam
  vermelhos (9 e 2 erros, respectivamente) — todos pré-existentes a esta
  demanda e fora dos arquivos que ela toca (conferido nesta rodada,
  arquivo a arquivo, contra `origin/main`).
- **Correção de dependência incluída nesta entrega, fora do pedido
  original:** `npm install` falhava de cara neste ambiente porque o
  `package-lock.json` (raiz e `server/`) ainda resolvia o pacote `xlsx`
  para o CDN da SheetJS (`cdn.sheetjs.com`, bloqueado por política de
  rede) — resíduo de uma correção anterior (`9bdb7f3`, já em
  `origin/main`) que atualizou a declaração em `package.json` mas não a
  entrada `node_modules/xlsx` do lockfile. Sem isso, nenhum comando de
  portão roda. A correção troca só a origem da entrada do lockfile para o
  `registry.npmjs.org` (mesmo pacote, mesma versão `0.20.3`, nenhum
  import muda) — está em commit próprio, separado da mudança de Go×Get,
  para o gestor revisar em separado se preferir.

## Provas da rotina

Formato: `docs/rotinas/provas-da-rotina.md` do `vydhub/vyd-forge` (lido de
`origin/main` nesta execução; as linhas abaixo NÃO ficam dentro de bloco
cercado). Comandos do `forge.repos.portao_comandos` do `vydhub/vyd-engage`
(oito comandos: os quatro primeiros obrigatórios, os quatro últimos não).

npm run check:colors && npm run lint:css — exit 0 — 2026-09-18T12:10:10Z
npm test — exit 0 — 2026-09-18T12:10:25Z
npm run typecheck:ci — exit 0 — 2026-09-18T12:11:01Z
npm run build — exit 0 — 2026-09-18T12:11:38Z
npm run lint — exit 1 — 2026-09-18T12:12:14Z
cd server && npm run lint — exit 1 — 2026-09-18T12:13:27Z
cd server && npm run build — exit 0 — 2026-09-18T12:14:08Z
cd server && npm test — não executável neste ambiente — o script `test` do `server/package.json` roda `vitest` em modo watch (sem `run`), e travaria esta execução sem supervisão; equivalente não faz parte do cadastro de portão, então não substituo por `npx vitest run` aqui
merge origin/main — 649137e133317004af4668e04ba76c980d9e94c7 — 2026-09-18T12:14:35Z
PR: nenhuma

`npm run lint` (raiz) e `cd server && npm run lint` são comandos **não
obrigatórios** neste repositório e os dois rodaram (não é o caso de "não
executável"); os 9 e 2 erros, respectivamente, são pré-existentes a esta
demanda:

- Os 9 erros da raiz (`AutomationBuilder.tsx:131,146`,
  `CompanyQuickSelect.tsx:295`, `ContactQuickSelect.tsx:277`,
  `StatusReasonDialog.tsx:52`, `RibbonTabs.tsx:75,89`,
  `SupportWidget.tsx:47`, `SsoCallback.tsx:44`) e os 2 do servidor
  (`copilotService.ts:787`, `taskService.ts:43`) estão em arquivos que
  `git diff --name-only origin/main...HEAD` não lista — nenhum é tocado
  por esta entrega.

Suíte de testes do servidor (`npx vitest run`, rodada nesta sessão fora do
cadastro de portão, só para diagnóstico — não substitui `cd server && npm
test`, que está declarado acima como não executável): 71 arquivos, 745
testes, 676 passaram e 69 falharam, todos os 69 em cinco arquivos
(`auth.test.ts`, `automations.test.ts`, `funnels.test.ts`,
`leads.test.ts`, `tasks.test.ts`) com a mesma causa —
`PrismaClientInitializationError: Environment variable not found:
DATABASE_URL` — travando na primeira chamada ao banco em `beforeEach`,
antes de qualquer asserção sobre o código desta demanda. `grep -n
probabilityGoGet server/src/__tests__/leads.test.ts` não encontra nada —
o arquivo não teria testado esta mudança mesmo se o banco existisse.
`server/.env` não existe neste ambiente (só `server/.env.example`),
confirmando a ausência de configuração de banco, não uma falha
intermitente.

`server/src/__tests__/unit/createLeadPayload.test.ts` (o arquivo desta
demanda, sem dependência de banco — mocka `bullmq` e `ioredis`) rodado
isolado:

```
$ npx vitest run src/__tests__/unit/createLeadPayload.test.ts
 ✓ src/__tests__/unit/createLeadPayload.test.ts  (24 tests) 14ms
 Test Files  1 passed (1)
      Tests  24 passed (24)
```

Reprodução funcional das funções puras (rodada nesta sessão, fora do
repositório, com o corpo copiado byte a byte de
`src/components/leads/LeadOpportunityFields.tsx:84-94` e da normalização
de rascunho de `src/pages/LeadForm.tsx:51-55` — conferido com `sed`
contra o arquivo real antes de aceitar o resultado):

```
mask(007) = "7" OK
mask(abc) = "" OK
mask(33,5) = "335" OK
mask(150) = "150" OK
mask(-1 (sinal descartado)) = "1" OK
parse("") = null OK
parse("0") = 0 OK
parse("100") = 100 OK
normalizeDraft(50) = "50" OK
normalizeDraft(null) = "" OK
normalizeDraft(undefined) = "" OK
normalizeDraft("33") = "33" OK
TUDO OK
```

### Território e resíduo

`git diff --name-only origin/main...HEAD`:
```
package-lock.json
server/package-lock.json
server/prisma/schema.prisma
server/src/__tests__/unit/createLeadPayload.test.ts
server/src/routes/leads.ts
specs/relatorios/alteracao-do-go-get-no-lead-build.md
src/components/leads/LeadOpportunityFields.tsx
src/pages/LeadForm.tsx
src/types/index.ts
```
Todos dentro do Território da spec, mais `package-lock.json` e
`server/package-lock.json` (correção de dependência documentada em "Para
quem pediu", em commit próprio) e o próprio `-build.md`. Nenhuma migration
nesta entrega (`git status --porcelain server/prisma/migrations/` sem
saída) — a spec não pede nenhuma (Restrição 1).

`select * from forge.demandas_em_voo` (conferido nesta sessão): uma única
linha, a própria FRG-157 — nenhuma outra demanda em construção simultânea
que pudesse colidir com o território desta entrega.

### Portão de horários deste relatório

```
$ node /home/user/vyd-forge/scripts/conferir-horarios.mjs --raiz /home/user/vyd-engage specs/relatorios/alteracao-do-go-get-no-lead-build.md
Fri Sep 18 12:16:53 UTC 2026
conferir-horarios: limpo (1 arquivo(s))
exit=0
```
