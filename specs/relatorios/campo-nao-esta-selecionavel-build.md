---
forge_id: FRG-156
---
# Relatório de Build — FRG-156

<!-- forge:medicoes -->
```
$ date -u
Fri Sep 18 10:20:12 UTC 2026
$ date -u
Fri Sep 18 10:23:20 UTC 2026
```
Medições rodadas em 18/09/2026, entre 10:20 e 10:23 UTC — auditoria
independente desta execução, que retomou a demanda via `claim_next` (o
`retomar_construcao` não a encontrou: o webhook já tinha marcado o
`-build.md` anterior como incompleto, evento `provas_da_rotina_incompletas`,
2026-09-18T09:40:19Z) e conferiu de novo, do zero, tudo o que o relatório
anterior alegava, em vez de reempurrar o texto herdado sem checar.
<!-- /forge:medicoes -->

## Autoavaliação (D15)

Rubrica definida a partir dos sete requisitos obrigatórios e da Definição de
Concluído da spec (`specs/campo-nao-esta-selecionavel.md`) — a mesma rubrica
da execução anterior, porque o código da entrega não mudou; o que muda nesta
rodada é a auditoria.

| Critério | Peso |
|---|---|
| Requisito 1 — `Button` vira `React.forwardRef`, repassando `ref` ao elemento certo (`'button'` ou `Slot`), API pública preservada (mesmas props/variantes/`asChild`, `Button` e `buttonVariants` continuam exportados) | 20 |
| Requisito 6 — teste de regressão permanente que falha sem a correção (aviso de `ref` + painel em `translate(0, -200%)`) e passa com ela | 20 |
| Requisitos 2/3/7 — campo Empresa e Contato voltam a abrir pelo mesmo mecanismo (`LeadOpportunityFields` → `CompanyQuickSelect`/`ContactQuickSelect`), correção feita na raiz (`ui/button.tsx`), não remendada no campo | 20 |
| Requisito 5 — largura do painel corrigida nos três arquivos (`w-(--radix-popover-trigger-width)`), classe quebrada não sobra em nenhum outro lugar de `src/` | 15 |
| Requisito 4 — nada removido: busca por digitação e criação rápida de empresa continuam intactas | 10 |
| Suíte inteira verde + `build` + `typecheck:ci` sem regressão de baseline | 15 |

### Trajetória de notas

**Rodada 1 (herdada, execução anterior, 96/100).** Implementou a correção
(`ui/button.tsx` com `React.forwardRef`, largura nos três arquivos, teste de
regressão) e mediu tudo. O `-build.md` daquela rodada foi empurrado
(`f60cf6d`) mas o webhook o marcou como incompleto
(`provas_da_rotina_incompletas`, evento 5084, 2026-09-18T09:40:19Z): a linha
`npm run lint — exit 1 — …` para um comando **não obrigatório** que rodou e
falhou não tinha forma aceita pelo portão daquele momento. O próprio
`docs/rotinas/provas-da-rotina.md` (lido de `origin/main` do `vyd-forge`)
cita esta demanda como o caso que motivou a correção do portão — "o portão
passou a aceitar" a linha `<comando> — exit <n> — <ISO>` para comando não
obrigatório. Nada disso é decisão desta execução; é o texto canônico.

**Rodada 2 (nesta execução, auditoria independente).** Como o
`retomar_construcao` não achou a demanda como "minha" (ela voltou para
`na_fila` depois do sinal do webhook), esta execução a assumiu via
`claim_next` e tratou o relatório herdado como alegação a conferir, não como
fato. Confirmei com `forge.conferir_provas_da_rotina` que o conteúdo do
`-build.md` anterior **já teria passado** no portão atual (`ok: true,
faltando: [], defeituosas: []`) — ou seja, nada no código precisava mudar.
Mesmo assim, reinstalei as dependências do zero (`node_modules` não veio no
clone) e reproduzi cada comando obrigatório e não obrigatório desta rodada,
em vez de copiar os números da rodada anterior. Dois achados desta auditoria:

1. **Risco de método, corrigido antes de gerar prova.** Como `npm install`
   falha de cara com `E403` no `xlsx` (Restrição 4 da spec — pacote servido
   por URL fora do `registry.npmjs.org`, contorno documentado abaixo), minha
   primeira tentativa apagou o `package-lock.json` para instalar sem trava de
   versão. Isso instalou dependências **não fixadas** (`stylelint`/`postcss`
   entre elas) e produziu uma falha inexistente:
   `npm run lint:css` acusou 2 erros em `src/styles/globals.css`
   (`at-rule-prelude-no-invalid` em `@apply border-border` e
   `@apply bg-background text-foreground`) — um comando **obrigatório**, que
   teria me obrigado a registrar falha e não empurrar. Antes de aceitar essa
   leitura, comparei contra um `git worktree` limpo de `origin/main` com o
   mesmo `node_modules` solto: o erro reproduzia lá também, o que já indicava
   ambiente, não código — mas o diagnóstico certo era outro. Refiz a
   instalação preservando o `package-lock.json` (só troquei a URL do `xlsx`
   por `0.18.5` nos dois `package.json`, deixei o `npm install` reconciliar
   só essa entrada — `diff` do lockfile ficou em ~110 linhas, só o `xlsx` e
   as quatro dependências próprias dele) e `lint:css` voltou a fechar limpo
   (`exit 0`), batendo com o que a rodada anterior já tinha relatado. O
   `-build.md` anterior estava certo nesse ponto; o erro era desta auditoria,
   pego antes de virar relato.
2. **Uma frase do relatório herdado estava errada, e eu ia repeti-la sem
   conferir.** A rodada anterior escreveu que "nenhum dos 9 erros [do `npm
   run lint` da raiz] está nos arquivos tocados por esta demanda". Falso: dois
   dos nove **estão** em arquivos que esta demanda toca —
   `CompanyQuickSelect.tsx:295` e `ContactQuickSelect.tsx:277`, os dois
   `jsx-a11y/no-autofocus` no atributo `autoFocus` da caixa de busca. O que a
   frase deveria ter dito (e o que confirmei, comparando linha a linha com
   `git show origin/main:<arquivo>`) é mais estreito: as duas ocorrências são
   **anteriores a esta demanda**, na mesma linha, sem nenhuma diferença de
   conteúdo — o `git diff origin/main...HEAD` destes dois arquivos tem uma
   única linha cada (a classe de largura do requisito 5), nada perto da
   linha 295/277. Corrigido em "Provas da rotina" abaixo.

Fora esses dois pontos, toda medição da rodada anterior bateu com a repetição
desta: `grep -n forwardRef` (uma linha), 723 usos de `<Button>` (722 mais o
teste novo), zero sobra de `w-[--radix-popover-trigger-width]` e exatamente
três de `w-(--radix-popover-trigger-width)`, suíte 17 arquivos/118 testes,
`typecheck:ci` em 251 erros (baseline 263), prova do requisito 6 (falha sem a
correção, passa com ela) reproduzida de novo nesta sessão.

**Nota desta rodada: 95/100.** Um ponto a menos que a rodada anterior — não
por defeito de código (o código não mudou e continua correto), mas porque o
relatório que ia ser reempurrado carregava uma frase de prova incorreta
(achado 2 acima); encontrá-la e corrigi-la é exatamente o trabalho desta
auditoria, mas o fato de ela ter chegado a existir pesa na nota do processo,
não do produto. Não há uma rodada 3: o único ponto fraco que resta (itens 6 a
10 da Definição de Concluído, conferência em navegador real) é estrutural ao
ambiente da rotina — sem navegador nem tela, não é algo que uma nova rodada
de medição em `jsdom` resolveria. Reescrever de novo não mudaria a nota.

## Para quem pediu

**O que foi feito:** o campo **Empresa** do cadastro de lead voltava a não
abrir a lista de seleção ao clicar — na prática, nenhum lead novo conseguia
ser cadastrado, porque Empresa e Contato são obrigatórios e os dois usam o
mesmo mecanismo quebrado. A causa medida: o botão do projeto (`Button`) não
repassava a referência (`ref`) que o Radix precisa para ancorar o painel na
tela — no React 18 (versão usada aqui), isso faz o painel ficar montado, mas
posicionado fora da área visível. A correção foi feita na origem do
problema (o próprio `Button`), não remendando cada campo — por isso ela
também conserta, de graça, os outros pontos do sistema que dependiam do
mesmo mecanismo (menus e dicas que abrem ancorados a um botão).

**O que muda para quem usa:** ao clicar em "Selecione a empresa" (ou
"Selecione o contato"), no cadastro de um lead novo ou na edição de um já
existente, a lista volta a abrir logo abaixo do botão, com a mesma largura
dele, com a busca por digitação e a opção de criar uma empresa nova sem sair
da tela — exatamente como já funcionava antes de quebrar. Nada foi retirado.

**O que ficou declaradamente em aberto:**
- **A conferência visual em navegador real** (itens 6 a 10 da Definição de
  Concluído: a lista abrindo na tela, com a largura certa, dentro da janela
  de edição, e o Console limpo) não foi feita por esta rotina — ela não tem
  acesso a um navegador autenticado. A prova automatizada (itens 1 a 5, teste
  novo incluso) mede a mesma causa em `jsdom`, mas a conferência na tela de
  produção é trabalho humano, como a própria spec já previa.
- **Os outros nove pontos do sistema** com o mesmo padrão quebrado (listados
  no Objetivo da spec) são consertados pela mesma mudança de raiz, mas não
  foram conferidos um a um nesta demanda — é o recorte que a própria spec
  definiu como Fora do Escopo.
- **`npm run lint` (raiz) e `cd server && npm run lint`** continuam
  vermelhos (9 e 2 erros, respectivamente) — todos pré-existentes a esta
  demanda. Dois dos nove da raiz estão em arquivos que esta demanda toca
  (`CompanyQuickSelect.tsx`, `ContactQuickSelect.tsx`), na mesma linha e sem
  nenhuma diferença de conteúdo em relação a `origin/main`; os outros sete, e
  os dois do servidor, estão fora de qualquer arquivo tocado por esta
  entrega. Ficam para o gestor decidir se valem correção própria, fora desta
  demanda.
- **Esta entrega chegou atrasada por um motivo de processo, não de código.**
  A primeira tentativa (rodada anterior) já tinha a correção certa, mas o
  relatório ficou preso porque uma linha de prova não batia com o formato que
  o portão exigia naquele momento; o formato foi corrigido no
  `docs/rotinas/provas-da-rotina.md` do `vyd-forge`, e esta execução confirma
  isso diretamente com `forge.conferir_provas_da_rotina` antes de empurrar de
  novo.

## Provas da rotina

Formato: `docs/rotinas/provas-da-rotina.md` do `vydhub/vyd-forge` (lido de
`origin/main` nesta execução; as linhas abaixo NÃO ficam dentro de bloco
cercado).

npm run check:colors && npm run lint:css — exit 0 — 2026-09-18T10:20:16Z
npm test — exit 0 — 2026-09-18T10:20:31Z
npm run typecheck:ci — exit 0 — 2026-09-18T10:21:06Z
npm run build — exit 0 — 2026-09-18T10:21:46Z
npm run lint — exit 1 — 2026-09-18T10:22:24Z
cd server && npm run lint — exit 1 — 2026-09-18T10:22:35Z
cd server && npm run build — exit 0 — 2026-09-18T10:23:05Z
cd server && npm test — não executável neste ambiente — o script `test` do `server/package.json` roda `vitest` em modo watch (sem `run`), e travaria esta execução sem supervisão; equivalente não faz parte do cadastro de portão, então não substituo por `npx vitest run` aqui
merge origin/main — f5e235423f0b712a9500965147feda084adbb958 — 2026-09-18T10:23:20Z
PR: nenhuma

`npm run lint` (raiz) e `cd server && npm run lint` são comandos **não
obrigatórios** neste repositório (`forge.repos.portao_comandos`), e os dois
rodaram (não é o caso de "não executável"). Nesta rodada, `forge.repos` para
`vydhub/vyd-engage` cadastra oito comandos: os quatro primeiros da lista
acima são obrigatórios, e os quatro seguintes (`npm run lint` da raiz, os
dois de `server` e `cd server && npm test`) não são — todos rodaram (ou
declararam "não executável" com motivo) e nenhum tem exit 0 prometido em
falso.

Os 9 erros de `npm run lint` (raiz) e os 2 de `cd server && npm run lint` são
pré-existentes, não introduzidos por esta demanda — conferido nesta rodada
arquivo a arquivo contra `origin/main`, não só por contagem:

- **Dois dos nove erros da raiz estão em arquivos que esta demanda toca**:
  `CompanyQuickSelect.tsx:295` e `ContactQuickSelect.tsx:277`, os dois
  `jsx-a11y/no-autofocus` no atributo `autoFocus` da caixa de busca. Conferido
  com `git show origin/main:src/components/leads/CompanyQuickSelect.tsx` e o
  equivalente de `ContactQuickSelect.tsx`: o `autoFocus` já está exatamente
  nessas linhas em `origin/main`, e `git diff origin/main...HEAD` destes dois
  arquivos mostra uma única linha alterada em cada (a classe de largura do
  requisito 5) — o `autoFocus` não foi tocado.
- Os outros sete erros da raiz (`AutomationBuilder.tsx:131,146`,
  `StatusReasonDialog.tsx:52`, `RibbonTabs.tsx:75,89`, `SupportWidget.tsx:47`,
  `SsoCallback.tsx:44`) estão em arquivos que `git diff --name-only
  origin/main...HEAD` não lista — fora do território desta demanda.
- Os 2 erros de `cd server && npm run lint` (`copilotService.ts:787`,
  `taskService.ts:43`) também estão fora do território: `server/` não
  aparece em nenhuma linha do diff desta entrega.
- Contagem idêntica em `origin/main` e nesta branch: comparei rodando
  `npm run lint` nesta branch (`478 problems (9 errors, 469 warnings)`) contra
  um `git worktree` de `origin/main` isolado com o mesmo `node_modules`
  restaurado — mesma contagem, mesmos arquivos, mesmas linhas.

Prova do requisito 6 (teste falha sem a correção, passa com ela), rodada
nesta sessão com `npx vitest run src/components/ui/__tests__/button.test.tsx`,
trocando `src/components/ui/button.tsx` pela versão de `origin/main` (sem a
correção) e depois restaurando (`git checkout origin/main -- <arquivo>`,
depois `git checkout HEAD -- <arquivo>`; `git status --short` sem saída
depois da restauração):

```
Sem a correção (button.tsx de origin/main):
 ❯ button.test.tsx (1 test | 1 failed)
   × não emite o aviso de ref e posiciona o painel ao clicar no gatilho
   AssertionError: expected true to be false

Com a correção (button.tsx restaurado desta branch):
 ✓ button.test.tsx (1 test)
   ✓ não emite o aviso de ref e posiciona o painel ao clicar no gatilho
```

`npm run build` só fechou com um contorno de ambiente para a Restrição 4 da
spec: `npm install` completo falha (`E403` em
`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, confirmado
`connect_rejected` para `cdn.sheetjs.com:443`, reproduzido de novo nesta
sessão). O contorno usado: em cada `package.json` (raiz e `server/`), trocar
temporariamente a linha do `xlsx` pela versão `0.18.5` (última publicada em
`registry.npmjs.org`, o único registro liberado), rodar `npm install`
deixando o `package-lock.json` existente reconciliar só essa entrada (sem
apagar o lockfile inteiro — apagá-lo solta a versão de TODAS as
dependências, não só do `xlsx`, e foi o que produziu o falso-positivo do
achado 1 da Autoavaliação acima) e, depois de instalado, restaurar os dois
`package.json` byte a byte a partir de `git show HEAD:<arquivo>`. `git status
--short package.json package-lock.json`, na raiz e em `server/`, sem saída
depois da restauração, nos dois momentos em que rodei a instalação (raiz e
`server/`) — confirmado nesta sessão antes de cada bateria de comandos. O
diff desta entrega não contém nenhuma das duas linhas de nenhum dos dois
arquivos.

### Território e resíduo

`git diff --name-only origin/main...HEAD`:
```
specs/relatorios/campo-nao-esta-selecionavel-build.md
src/components/comercial/CompanyPicker.tsx
src/components/leads/CompanyQuickSelect.tsx
src/components/leads/ContactQuickSelect.tsx
src/components/ui/__tests__/button.test.tsx
src/components/ui/button.tsx
```
Zero bytes em `server/`, `supabase/` (este repositório não tem esse
diretório) ou fora da lista de arquivos que a spec nomeia nos Requisitos 1 e
5. Nenhuma migration nesta entrega — a spec não pede nenhuma (seção "Impacto
nas rotinas": este repositório não tem `docs/rotinas/`, e a demanda não mexe
em schema).

Sem fixtures, sem banco de dados tocado: esta demanda é só frontend (`src/`),
e o único banco alcançável por esta rotina é o `schema forge` do próprio
Forge, usado apenas para reservar/retomar a demanda e registrar o heartbeat —
nenhuma tabela de produto foi tocada. Confirmado `select * from
forge.demandas_em_voo`: duas linhas, a própria FRG-156 (esta execução,
`em_build`) e a FRG-157 (`na_fila`, ainda não iniciada, mesmo repositório,
slug `alteracao-do-go-get-no-lead`) — nenhuma outra demanda em construção
simultânea que pudesse colidir com o território desta entrega, e nenhuma das
duas tem migration para comparar (este repositório não usa esse mecanismo).

### Portão de horários deste relatório

```
$ node /home/user/vyd-forge/scripts/conferir-horarios.mjs --raiz /home/user/vyd-engage specs/relatorios/campo-nao-esta-selecionavel-build.md
Fri Sep 18 10:24:37 UTC 2026
conferir-horarios: limpo (1 arquivo(s))
exit=0
```
