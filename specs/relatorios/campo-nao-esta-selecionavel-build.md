---
forge_id: FRG-156
---
# Relatório de Build — FRG-156

<!-- forge:medicoes -->
```
$ date -u
Fri Sep 18 09:24:30 UTC 2026
$ date -u
Fri Sep 18 09:39:03 UTC 2026
```
Medições rodadas em 18/09/2026, entre 09:24 e 09:39 UTC.
<!-- /forge:medicoes -->

## Autoavaliação (D15)

Rubrica definida **antes** de escrever código, a partir dos sete requisitos
obrigatórios e da Definição de Concluído da spec (`specs/campo-nao-esta-selecionavel.md`).

| Critério | Peso |
|---|---|
| Requisito 1 — `Button` vira `React.forwardRef`, repassando `ref` ao elemento certo (`'button'` ou `Slot`), API pública preservada (mesmas props/variantes/`asChild`, `Button` e `buttonVariants` continuam exportados) | 20 |
| Requisito 6 — teste de regressão permanente que falha sem a correção (aviso de `ref` + painel em `translate(0, -200%)`) e passa com ela | 20 |
| Requisitos 2/3/7 — campo Empresa e Contato voltam a abrir pelo mesmo mecanismo (`LeadOpportunityFields` → `CompanyQuickSelect`/`ContactQuickSelect`), correção feita na raiz (`ui/button.tsx`), não remendada no campo | 20 |
| Requisito 5 — largura do painel corrigida nos três arquivos (`w-(--radix-popover-trigger-width)`), classe quebrada não sobra em nenhum outro lugar de `src/` | 15 |
| Requisito 4 — nada removido: busca por digitação e criação rápida de empresa continuam intactas | 10 |
| Suíte inteira verde + `build` + `typecheck:ci` sem regressão de baseline | 15 |

Trajetória de notas e pontos fracos preenchidos ao final, depois de
implementar e medir — nota inventada antes de medir é o que esta rubrica
existe para evitar.

### Trajetória de notas

**Rodada 1 (90/100)**, depois de implementar e medir tudo:
- Requisito 1 aplicado e medido: `grep -n forwardRef src/components/ui/button.tsx`
  devolve a linha do `React.forwardRef`; `grep -rn "<Button" src/ --include=*.tsx | wc -l`
  devolve 723 (722 usos existentes, inalterados, mais o novo teste) — nenhum
  ponto de uso precisou mudar, confirmando a Restrição 2 da spec.
- Requisito 6: o teste novo (`src/components/ui/__tests__/button.test.tsx`)
  foi rodado duas vezes — com o `Button` revertido para a versão sem
  `forwardRef` (falha: `expected true to be false`, o aviso de ref aparece) e
  com a correção aplicada (passa). As duas saídas estão em "Provas da
  rotina".
- Requisitos 2/3/7: como a spec já mediu (e este build confirmou) que
  `CompanyQuickSelect.tsx` e `ContactQuickSelect.tsx` usam o mesmo padrão
  `Popover` + `PopoverTrigger asChild` + `Button`, a correção única em
  `ui/button.tsx` resolve os dois campos ao mesmo tempo — não há edição
  própria em nenhum dos dois arquivos além da largura (requisito 5).
- Requisito 5: as três ocorrências de `w-[--radix-popover-trigger-width]`
  foram trocadas por `w-(--radix-popover-trigger-width)`; `grep` confirma
  zero sobra da forma antiga e exatamente três da forma nova.
- Requisito 4: não removi nenhuma linha de `CompanyQuickSelect.tsx` ou
  `ContactQuickSelect.tsx` além da classe de largura — busca e criação
  rápida de empresa permanecem como estavam.
- Suíte: 17 arquivos / 118 testes verdes (bate com os 16+1 / 117+1 previstos
  na Definição de Concluído). `npm run build` e `npm run typecheck:ci`
  (251 erros, abaixo do baseline de 263) verdes.
- Pontos fracos identificados nesta rodada:
  1. Os itens 6 a 10 da Definição de Concluído (abrir o painel na tela, nas
     duas telas, com o Console limpo) são de conferência humana em
     navegador real — esta execução não tem navegador nem tela para
     conferir isso, só o mecanismo em `jsdom` (que é onde a causa foi
     medida e onde o teste do requisito 6 vive). A própria spec já declara
     isso como não automatizável ("Decisões assumidas").
  2. Os comandos opcionais `npm run lint` (raiz) e `cd server && npm run
     lint` falharam — mas com a mesma contagem de erros que um checkout
     limpo de `origin/main`, sem nenhuma mudança minha (medido explicitamente
     abaixo, comparando os dois). Não há regressão, mas eu não tinha, na
     primeira rodada, essa comparação lado a lado registrada no relatório.

**Rodada 2 (96/100)**, depois de fechar o que dava para fechar:
- Fechei o ponto fraco 2: rodei `npm run lint` e `cd server && npm run
  lint` de novo contra um `git stash` (código desta demanda fora da árvore)
  e confirmei contagem idêntica — `478 problems (9 errors, 469 warnings)`
  na raiz nos dois casos. As duas saídas (com e sem a mudança) estão citadas
  abaixo, em "Provas da rotina".
- O ponto fraco 1 não tem correção possível dentro desta execução: exigiria
  um navegador autenticado contra um ambiente real, que esta rotina não tem.
  Fica declarado aqui e em "Para quem pediu", como fronteira, não como
  maquiagem.
- Nota não avançaria de forma significativa numa terceira rodada — o único
  ponto fraco restante é estrutural ao ambiente da rotina, não ao código
  entregue. Paro aqui.

**Versão final: 96/100.** A tabela completa de comandos rodados, com exit
code e horário de máquina, está em "## Provas da rotina".

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
  acesso a um navegador autenticado. A prova automatizada (item 1 a 5, teste
  novo incluso) mede a mesma causa em `jsdom`, mas a conferência na tela de
  produção é trabalho humano, como a própria spec já previa.
- **Os outros nove pontos do sistema** com o mesmo padrão quebrado (listados
  no Objetivo da spec) são consertados pela mesma mudança de raiz, mas não
  foram conferidos um a um nesta demanda — é o recorte que a própria spec
  definiu como Fora do Escopo.
- **`npm run lint` (raiz) e `cd server && npm run lint`** continuam
  vermelhos (9 e 2 erros, respectivamente) — mas são exatamente os mesmos
  erros de um checkout limpo, sem relação com esta mudança (medido e citado
  abaixo). Ficam para o gestor decidir se valem correção própria, fora desta
  demanda.

## Provas da rotina

Formato: `docs/rotinas/provas-da-rotina.md` (as linhas abaixo NÃO ficam
dentro de bloco cercado).

npm run check:colors && npm run lint:css — exit 0 — 2026-09-18T09:33:51Z
npm test — exit 0 — 2026-09-18T09:34:27Z
npm run typecheck:ci — exit 0 — 2026-09-18T09:34:55Z
npm run build — exit 0 — 2026-09-18T09:35:28Z
npm run lint — exit 1 — 2026-09-18T09:32:06Z
cd server && npm run lint — exit 1 — 2026-09-18T09:31:31Z
cd server && npm run build — exit 0 — 2026-09-18T09:33:20Z
cd server && npm test — não executável neste ambiente — o script `test` do `server/package.json` roda `vitest` em modo watch (sem `run`), e travaria esta execução sem supervisão; equivalente não faz parte do cadastro de portão, então não substituo por `npx vitest run` aqui
merge origin/main — f5e235423f0b712a9500965147feda084adbb958 — 2026-09-18T09:37:10Z
PR: nenhuma

`npm run lint` e `cd server && npm run lint` são comandos **não
obrigatórios** neste repositório (`forge.repos.portao_comandos`), e os dois
rodaram (não é o caso de "não executável"). Os erros são pré-existentes,
não desta demanda:

- Raiz: `git stash` (código desta demanda fora da árvore, checkout efetivo
  de `origin/main f5e2354`) → `npm run lint` → `478 problems (9 errors, 469
  warnings)`, exit 1. Com a mudança desta demanda de volta (`git stash
  pop`): também `478 problems (9 errors, 469 warnings)`, exit 1. Contagem
  idêntica, nenhum dos 9 erros está nos arquivos tocados por esta demanda
  (`button.tsx`, `CompanyQuickSelect.tsx`, `ContactQuickSelect.tsx`,
  `CompanyPicker.tsx`) — os dois avisos que aparecem nesses arquivos
  (`react-hooks/exhaustive-deps` em `CompanyPicker.tsx`/`CompanyQuickSelect.tsx`/
  `ContactQuickSelect.tsx`, `react-refresh/only-export-components` em
  `button.tsx`) já existiam no checkout limpo, nas mesmas linhas.
- Servidor: os 2 erros de `cd server && npm run lint` são pré-existentes em
  `copilotService.ts` e `taskService.ts` — arquivos que esta demanda não
  toca (fora do território: `git diff --name-only origin/main...HEAD` abaixo
  não lista nada em `server/`).

Prova do requisito 6 (teste falha sem a correção, passa com ela), rodada
nesta sessão com `npx vitest run src/components/ui/__tests__/button.test.tsx`:

```
Sem a correção (Button revertido para a versão sem forwardRef, via git stash):
 ❯ button.test.tsx (1 test | 1 failed)
   × não emite o aviso de ref e posiciona o painel ao clicar no gatilho
   AssertionError: expected true to be false

Com a correção (git stash pop):
 ✓ button.test.tsx (1 test)
   ✓ não emite o aviso de ref e posiciona o painel ao clicar no gatilho
```

`npm run build` só fechou com um contorno de ambiente para a Restrição 4 da
spec: `npm install` completo falha (`E403` em
`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, confirmado
`connect_rejected` para `cdn.sheetjs.com:443`). O contorno usado nesta
sessão: instalar `xlsx@0.18.5` (última versão publicada em
`registry.npmjs.org`, o único registro liberado) com `npm install xlsx@0.18.5
--no-save`, só para resolver o import em tempo de build — **sem** alterar
`package.json`/`package-lock.json`. Os dois arquivos foram conferidos e
restaurados byte a byte ao estado de `origin/main` antes do commit (`git
status --short package.json package-lock.json` sem saída depois da
restauração); o diff desta entrega não contém nenhuma das duas linhas.

### Território e resíduo

`git diff --name-only origin/main...HEAD`:
```
src/components/comercial/CompanyPicker.tsx
src/components/leads/CompanyQuickSelect.tsx
src/components/leads/ContactQuickSelect.tsx
src/components/ui/__tests__/button.test.tsx
src/components/ui/button.tsx
```
(o `specs/relatorios/campo-nao-esta-selecionavel-build.md`, este arquivo, é
adicionado no commit seguinte, com o relatório.) Zero bytes em
`server/`, `supabase/` (este repositório não tem esse diretório) ou fora da
lista de arquivos que a spec nomeia nos Requisitos 1 e 5. Nenhuma migration
nesta entrega — a spec não pede nenhuma (seção "Impacto nas rotinas": este
repositório não tem `docs/rotinas/`, e a demanda não mexe em schema).

Sem fixtures, sem banco de dados tocado: esta demanda é só frontend
(`src/`), e o único banco alcançável por esta rotina é o `schema forge` do
próprio Forge, usado apenas para reservar/retomar a demanda e registrar o
heartbeat — nenhuma tabela de produto foi tocada.

### Portão de horários deste relatório

```
$ node scripts/conferir-horarios.mjs --raiz /home/user/vyd-engage specs/relatorios/campo-nao-esta-selecionavel-build.md
Fri Sep 18 09:39:15 UTC 2026
conferir-horarios: limpo (1 arquivo(s))
exit=0
```
