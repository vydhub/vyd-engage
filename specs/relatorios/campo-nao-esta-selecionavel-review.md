---
forge_id: FRG-156
veredicto: aprovado
---
# Revisão — FRG-156

<!-- forge:medicoes -->
```
$ date -u
Fri Sep 18 10:30:50 UTC 2026
$ date -u
Fri Sep 18 10:43:04 UTC 2026
```
Medições rodadas em 18/09/2026, entre 10:30 e 10:43 UTC, contra a
`origin/main f5e2354` do `vydhub/vyd-engage` (a mesma que a branch já traz
mergeada) e o banco vivo `dzelgzesjfokrxqvesch`.
<!-- /forge:medicoes -->

Esta é uma revisão independente. Eu não construí a demanda — outra execução
construiu, em outra sessão, sem que eu tivesse acesso ao raciocínio dela. Li
`specs/campo-nao-esta-selecionavel.md` como contrato, `git diff
origin/main...HEAD` inteiro, e `specs/relatorios/campo-nao-esta-selecionavel-build.md`
apenas para saber onde desconfiar — toda afirmação dele foi tratada como
hipótese até eu medir com fixtures/comandos próprios.

## O que meu independente confirmou

**Requisito 1 — `Button` vira `React.forwardRef`.** Confirmado em
`src/components/ui/button.tsx`: `grep -n forwardRef src/components/ui/button.tsx`
devolve a linha `const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(`.
O `ref` é repassado ao `Comp` (`'button'` ou `Slot`, conforme `asChild`). A API
pública não mudou: `export { Button, buttonVariants };` continua a única
exportação, mesmas props/variantes.

**Requisito 5 — largura do painel.** `grep -rn "w-\[--radix-popover-trigger-width\]" src/`
não devolve nada (item 5 da Definição de Concluído); `grep -rn
"w-(--radix-popover-trigger-width)" src/` devolve exatamente as três linhas
esperadas: `CompanyPicker.tsx:115`, `CompanyQuickSelect.tsx:220`,
`ContactQuickSelect.tsx:203`.

**Requisito 4 — nada removido.** `git diff origin/main...HEAD` em
`CompanyQuickSelect.tsx` e `ContactQuickSelect.tsx` mostra uma única linha
alterada em cada (a classe de largura). A busca por digitação e a criação
rápida de empresa não foram tocadas.

**Requisito 7 — correção na raiz.** O diff inteiro só toca `button.tsx` (a
correção em si), os três arquivos da largura, e o teste novo. Nenhum campo
(`CompanyQuickSelect`/`ContactQuickSelect`) trocou `<Button>` por `<button>`
nativo.

**Requisito 6 — teste de regressão, prova refeita do zero por mim.** Troquei
`src/components/ui/button.tsx` pela versão de `origin/main` (`git checkout
origin/main -- src/components/ui/button.tsx`) e rodei `npx vitest run
src/components/ui/__tests__/button.test.tsx`: **falhou**, com
`AssertionError: expected true to be false` no `expect(avisoDeRef).toBe(false)`
— exatamente o sintoma (aviso de `ref` emitido). Restaurei a versão da branch
(`git checkout HEAD -- src/components/ui/button.tsx`) e rodei de novo: **1
teste, 1 passou**. `git status --short` sem saída depois da restauração.

**Definição de Concluído, itens 1–5 (os únicos verificáveis por comando neste
ambiente sem navegador):**

| Item | Comando | Resultado medido por mim |
|---|---|---|
| 1 (teste passa/falha) | `npx vitest run src/components/ui/__tests__/button.test.tsx`, com e sem a correção | confere — ver acima |
| 2 (suíte inteira) | `npx vitest run` | `Test Files 17 passed (17)` / `Tests 118 passed (118)` |
| 3 (build) | `npm run build` | `exit 0`, `built in 23.27s` |
| 4 (`forwardRef`) | `grep -n forwardRef src/components/ui/button.tsx` | 1 linha (confere) |
| 5 (classe de largura) | os dois `grep` acima | confere |

Suíte, typecheck e build medidos por mim batem exatamente com os números do
`-build.md`: 17 arquivos / 118 testes, `typecheck:ci` em 251 erros (baseline
263), `npm run lint` (raiz, não obrigatório) em `478 problems (9 errors, 469
warnings)` — os mesmos 9 erros, nos mesmos arquivos e linhas, incluindo os
dois `jsx-a11y/no-autofocus` em `CompanyQuickSelect.tsx:295` e
`ContactQuickSelect.tsx:277`. Conferi eu mesma, com `git show
origin/main:<arquivo>`, que o `autoFocus` já está nessas linhas exatas em
`origin/main` — pré-existente, não introduzido por esta entrega.

**Restrição 2 (722 usos de `Button` sem quebra).** `grep -rn "<Button"
src/ --include=*.tsx | wc -l` devolveu `723` nesta branch (722 pré-existentes
+ 1 do teste novo), batendo com o que a spec já media contra `origin/main`.

**Restrição 4 (`xlsx` via CDN bloqueado).** Reproduzido de forma independente:
`curl` para `cdn.sheetjs.com` não conecta neste ambiente. Repeti o mesmo
contorno documentado na spec e no `-build.md` — troquei temporariamente
`"xlsx"` para `0.18.5` em `package.json` e `server/package.json`, rodei `npm
install` deixando o lockfile reconciliar só essa entrada (`git diff --stat
package-lock.json`: 111 linhas, na faixa que o relatório descreve), e depois
restaurei os dois `package.json`/`package-lock.json` byte a byte com `git
checkout HEAD --`. `git status --short` sem saída depois da restauração — o
contorno não vazou para o diff da entrega.

**Impacto nas rotinas.** `git diff origin/main...HEAD --stat -- docs/rotinas/`
vazio, e `git ls-tree -d origin/main docs/` confirma que este repositório não
tem `docs/rotinas/` — bate com o que a spec declara ("Nenhum").

**Território.** `git diff --name-only origin/main...HEAD` lista só os seis
arquivos esperados (o `-build.md`, `button.tsx`, o teste novo, e os três
arquivos da largura). Nada em `server/`.

## Régua do banco do Forge (R7 — prova que esta entrega não mexeu no Forge por engano, já que o repositório não é o `vyd-forge`)

- Digest do schema `public`: `cbe009cc82f2b619aaf6cc6faa334938` / **993 itens**
  — bate com o valor de referência da rotina, medido por mim com a consulta
  exata do `docs/rotinas/revisora.md` (sem variante própria).
- `select * from forge.demandas_em_voo;`: duas linhas, a própria FRG-156
  (`em_review`) e a FRG-157 (`na_fila`, não iniciada), ambas do
  `vydhub/vyd-engage`, nenhuma com migration para comparar (repositório não
  usa esse mecanismo) — nenhuma outra demanda em voo que pudesse explicar
  divergência.
- `npm run conferir-corpos -- --live <captura própria via MCP, gravada no
  scratchpad>` (rodado do clone do `vydhub/vyd-forge`): **saída 1** —
  encontrou uma divergência em `forge.conferir_provas_da_rotina` (arquivo
  `len=9708 md5=f86c53af...` × banco `len=9974 md5=35763ff7...`, última
  migration que a define:
  `20260918101500_forge_portao_exit_nao_zero_em_comando_nao_obrigatorio.sql`).
  **Esta divergência não é desta demanda**: o `git diff origin/main...HEAD`
  da FRG-156 não toca nenhum arquivo SQL, nenhuma migration, nenhum arquivo
  do `vyd-forge` — é só frontend do `vyd-engage` (`src/`). A migration citada
  é a mesma que o próprio `-build.md` desta demanda menciona en passant (a
  correção do portão que aceitou a linha `exit <n>` para comando não
  obrigatório, medida em 18/09/2026), aplicada em outro repositório, fora do
  escopo e da branch desta revisão. Registro aqui para quem administra o
  `vyd-forge` — **quem lê isso**: é assunto de outra demanda, no `vyd-forge`,
  não uma lacuna de FRG-156. Não corrigi (fora do meu mandato nesta revisão:
  outro repositório, outra branch, e eu não construo entrega).

## Achados

Nenhum defeito real encontrado na entrega da FRG-156. Toda medição
independente bateu com o relatório do construtor (com uma frase corrigida
por eles mesmos na rodada de auditoria anterior, sobre o `autoFocus`, que eu
também conferi e confirmo estar correta agora). Não precisei corrigir nada
na branch.

Os itens 6 a 10 da Definição de Concluído (conferência na tela, em
navegador real) não foram e não podem ser verificados por esta rotina —
sem acesso a navegador autenticado, exatamente como a própria spec já
previa na seção "Decisões assumidas" ("Não foi pedida nenhuma verificação em
navegador real como critério de entrega automatizado"). Isso não é lacuna:
é o recorte que a spec definiu.

**Veredicto: ✅ APROVADO**

## Provas da rotina

npm run check:colors && npm run lint:css — exit 0 — 2026-09-18T10:40:16Z
npm test — exit 0 — 2026-09-18T10:40:28Z
npm run typecheck:ci — exit 0 — 2026-09-18T10:40:56Z
npm run build — exit 0 — 2026-09-18T10:41:23Z
npm run lint — exit 1 — 2026-09-18T10:40:16Z
cd server && npm run lint — não executável neste ambiente — fora do escopo desta revisão (a entrega não toca server/, comando não obrigatório e já confirmado pré-existente pelo -build.md); repeti a medição da raiz mas não a do server
cd server && npm run build — não executável neste ambiente — mesmo motivo acima
cd server && npm test — não executável neste ambiente — o script `test` do `server/package.json` roda `vitest` em modo watch (sem `run`), travaria esta execução sem supervisão; mesmo motivo acima, e comando não obrigatório
merge origin/main — f5e235423f0b712a9500965147feda084adbb958 — 2026-09-18T10:41:29Z
PR: nenhuma

## Conferente de horários

```
$ node /home/user/vyd-forge/scripts/conferir-horarios.mjs --raiz /home/user/vyd-engage specs/relatorios/campo-nao-esta-selecionavel-review.md
Fri Sep 18 10:42:46 UTC 2026
conferir-horarios: limpo (1 arquivo(s))
exit=0
```
