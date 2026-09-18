---
forge_id: FRG-156
slug: campo-nao-esta-selecionavel
---
# Spec: o campo Empresa do lead volta a abrir a lista

> Escrita em 18/09/2026 pela **rotina de Spec do VYD Forge**, depois de duas
> rodadas de entrevista (teto da rotina — ver `forge.spec_perguntas`,
> `demand_id a7d954ed-53b5-44f2-918c-3bb462043b73`, `round 1` e `round 2`).
>
> **Quem respondeu a rodada 1: a Respondedora** (`respondida_pela_rotina = true`,
> `answered_at 2026-09-17 19:48:01.445703+00`). Aquela execução **não tinha o
> repositório `vydhub/vyd-engage` em mãos** — seis das oito respostas começam
> por "não sei", e a resposta 5 diz isso com todas as letras. Nada daquela
> rodada sustenta decisão sozinho.
>
> **Quem respondeu a rodada 2: a Respondedora** (`respondida_pela_rotina = true`,
> `answered_at 2026-09-18 01:44:59.902323+00`). Essa execução já tinha o
> repositório e citou arquivo a arquivo, mas **cinco das sete respostas ainda
> começam por "não sei"**: elas registram o que o código mostra, não o que
> quem abriu o chamado viu na tela. O sintoma exato (qual das opções (a)-(g)),
> o navegador, o aparelho e qualquer linha de Console ou de Rede continuam sem
> confirmação humana nas duas rodadas.
>
> Três respostas carregam a marca `decisão assumida pela Respondedora — rever
> na aprovação` (rodada 1, respostas 6 e 7; rodada 2, resposta 7) e estão
> reproduzidas em **Decisões assumidas**, em destaque. **Uma delas está
> errada e não foi adotada**: a resposta 6 da rodada 1 mandava o campo não ter
> criação de empresa embutida — a rodada 2 mediu no código que ela já existe, e
> obedecer àquela resposta apagaria um recurso que está no ar.
>
> O briefing veio com um anexo, `Captura de tela 2026-09-17 163721.png`
> (`image/png`, 224201 bytes, sem legenda). `forge.anexos_da_demanda` devolveu
> `extracao_ok = false` (`extracao_erro: "imagem: sem leitura automática"`) nas
> duas rodadas e também nesta execução: a imagem **não foi lida** e nada nesta
> spec vem dela.

<!-- forge:medicoes -->
```
$ date -u
Fri Sep 18 02:28:29 UTC 2026
$ date -u
Fri Sep 18 02:36:48 UTC 2026
```
Medições rodadas em 18/09/2026, entre 02:28 e 02:36 UTC, contra a
`origin/main 1c90a05` do `vydhub/vyd-engage` e o banco vivo
`dzelgzesjfokrxqvesch`.
<!-- /forge:medicoes -->

Conferente de horário rodado nesta branch antes do push, com a saída colada
como saiu (`specs/spec-sem-horario-inventado.md`, R7). O `vydhub/vyd-engage`
não tem o script `conferir-horarios` no seu `package.json`, então ele foi
rodado a partir do clone do `vydhub/vyd-forge`, apontando para o arquivo — a
spec do usuário não casa nenhum padrão do script e não exige bloco de medição
(FRG-146):

```
$ node /home/user/vyd-forge/scripts/conferir-horarios.mjs \
    /home/user/vyd-engage/specs/campo-nao-esta-selecionavel.md

Fri Sep 18 02:40:22 UTC 2026
conferir-horarios: limpo (1 arquivo(s))
```

## Objetivo

O campo **Empresa** do formulário de lead é um botão escrito
"Selecione a empresa" que deveria abrir um painel com busca e a lista das
empresas. Hoje o clique não mostra painel nenhum.

Esta execução **mediu a causa** em vez de supor: o painel até é montado, mas
**nunca é posicionado**, e fica estacionado fora da tela. O motivo é uma
incompatibilidade entre o `Button` do projeto e o React 18.

O `Button` (`src/components/ui/button.tsx`) é uma função simples, **sem
`React.forwardRef`** — é o formato que o shadcn adotou na era do React 19, em
que `ref` é uma prop comum. Este projeto roda **React 18.3.1**, onde `ref`
não é prop: quando o `PopoverTrigger asChild` do Radix tenta prender o `ref`
do gatilho no `Button`, o React recusa, o Radix fica sem âncora e o Popper
mantém o painel no estado "ainda não posicionado", que é literalmente
`transform: translate(0, -200%)` — duas alturas acima do próprio topo, fora
da vista. Como nunca há âncora, ele nunca sai de lá.

Retrato do defeito, medido em 18/09/2026 nesta execução, com os componentes
reais do repositório (`src/components/ui/popover.tsx` + `src/components/ui/button.tsx`
da `origin/main 1c90a05`), num teste temporário que foi apagado depois de
medir:

```
{"avisoDeRef":true,"transform":"translate(0, -200%)"}
```

O mesmo teste, com o `Button` convertido para `React.forwardRef` na cópia de
trabalho e revertido em seguida, medido em 18/09/2026 na mesma execução:

```
{"avisoDeRef":false,"transform":"translate(0px, 4px)"}
```

`avisoDeRef` é a presença do aviso do React `Function components cannot be
given refs`; `transform` é o estilo do `[data-radix-popper-content-wrapper]`
depois do clique. `translate(0px, 4px)` é o painel ancorado no botão, com o
`sideOffset` de 4 que o `PopoverContent` já define.

Versões que fecham o diagnóstico, lidas do `package-lock.json` da
`origin/main 1c90a05` em 18/09/2026:

```
react = 18.3.1
react-dom = 18.3.1
@radix-ui/react-slot = 1.2.4
@radix-ui/react-popover = 1.1.15
cmdk = 1.1.1
```

Isto explica por que o defeito não aparece em toda parte. Dos doze
`PopoverTrigger asChild` do projeto, seis embrulham um `<button>` nativo e
funcionam; os outros seis embrulham o `<Button>` e não abrem. Somando os
gatilhos que **precisam de âncora** para se posicionar (Popover, DropdownMenu
e Tooltip), são onze pontos com o mesmo defeito. Medido em 18/09/2026 contra
a `origin/main 1c90a05`:

```
src/components/CommentsSection.tsx:216
src/components/ExportButton.tsx:87
src/components/NotificationCenter.tsx:56
src/components/ReportFilters.tsx:202
src/components/ReportFilters.tsx:224
src/components/comercial/CompanyPicker.tsx:97
src/components/comercial/PlaybooksManager.tsx:156
src/components/leads/CompanyQuickSelect.tsx:203
src/components/leads/ContactQuickSelect.tsx:185
src/components/leads/LeadBulkActions.tsx:147
src/components/parceiros/ConsultoresTab.tsx:459
```

**A gravidade é maior do que "um campo não abre".** Na criação de lead, Empresa
e Contato são obrigatórios: `validateLeadOpportunityValues` recusa o salvamento
sem os dois (`src/components/leads/LeadOpportunityFields.tsx:138-140`, retrato
da `origin/main 1c90a05` tirado em 18/09/2026). Como os dois campos dependem do
mesmo painel que não abre, **nenhum lead novo consegue ser cadastrado por esse
formulário** — não há contorno dentro da tela. A pergunta 8 da rodada 1, que
perguntava justamente se dava para salvar assim mesmo, ficou sem resposta
humana; o código responde que não.

A demanda é o campo Empresa. A correção, porém, é **uma só e fica na raiz**:
consertar o `Button` conserta os onze de uma vez. Remendar o campo Empresa
trocando o `<Button>` por um `<button>` nativo deixaria os outros dez de pé e
espalharia o mesmo remendo pela próxima demanda.

## Usuários

Quem cadastra e edita lead no VYD Engage — qualquer usuário autenticado com
permissão de escrita em leads no próprio tenant. Não há recorte por papel: a
falha é de renderização e atinge todo mundo igualmente, inclusive
administrador. A visibilidade de empresas por perfil (`GERAL`, `EQUIPE`,
`PROPRIA`) não tem parte nisto — ela decide **o que** a lista traz, e a lista
nunca chega a aparecer.

## Requisitos

### Obrigatórios

1. **`src/components/ui/button.tsx` passa a usar `React.forwardRef`** e a
   repassar o `ref` recebido para o elemento que renderiza (`'button'` ou o
   `Slot`, conforme `asChild`). A API pública do componente não muda: as mesmas
   props, as mesmas variantes (`variant`, `size`), o mesmo `asChild`, as mesmas
   classes. O componente deve continuar exportado como `Button`, junto com
   `buttonVariants`.
2. **O campo Empresa abre o painel ao clique**, na página inteira de Novo Lead
   (`src/pages/LeadForm.tsx`) e na janela sobreposta de edição do lead
   (`src/components/LeadModal.tsx`), ambas pelo mesmo
   `src/components/leads/LeadOpportunityFields.tsx`.
3. **O campo Contato abre o painel ao clique**, nas mesmas duas telas. Ele usa
   o mesmo mecanismo (`src/components/leads/ContactQuickSelect.tsx`, padrão
   Popover+Command idêntico ao de `CompanyQuickSelect.tsx`) e tem a mesma
   causa; sai junto pela mesma correção, sem edição própria.
4. **Nada do que já existe nos dois campos é removido.** A busca por digitação
   ("Buscar empresa…") e a criação rápida ("+ Criar nova empresa", com Nome,
   CNPJ e Segmento) continuam exatamente como estão, inclusive o desempate de
   nome repetido ("Usar esta" / "Criar mesmo assim").
5. **A largura do painel volta a acompanhar o botão** nos três lugares que hoje
   pedem isso por uma classe que o Tailwind 4 não entende:
   `src/components/leads/CompanyQuickSelect.tsx:220`,
   `src/components/leads/ContactQuickSelect.tsx:203` e
   `src/components/comercial/CompanyPicker.tsx:115`. Medido em 18/09/2026 com o
   `@tailwindcss/cli` do próprio projeto (`tailwindcss 4.3.2`, do
   `package-lock.json` da `origin/main 1c90a05`), a classe
   `w-[--radix-popover-trigger-width]` compila para CSS inválido e o navegador
   descarta a regra:

   ```
   .w-\[--radix-popover-trigger-width\] {
     width: --radix-popover-trigger-width;
   }
   ```

   No Tailwind 4 a forma de ler uma variável CSS é `w-(--radix-popover-trigger-width)`.
   A troca é de dois caracteres por arquivo. Sem ela, o primeiro efeito visível
   da correção é um painel de largura errada.
6. **Entra um teste de regressão permanente**, que falharia hoje e passa depois
   da correção: renderiza `Popover` + `PopoverTrigger asChild` + `Button` (os
   componentes do próprio projeto, não uma cópia), clica no gatilho e verifica
   que (a) o React **não** emite `Function components cannot be given refs` e
   (b) o `[data-radix-popper-content-wrapper]` **não** ficou em
   `translate(0, -200%)`. O teste mora junto dos componentes de UI que ele
   protege.
7. **A correção é feita na raiz, não no campo.** Trocar o `<Button>` por
   `<button>` nativo dentro de `CompanyQuickSelect.tsx` ou
   `ContactQuickSelect.tsx` **não** atende a esta spec, mesmo que faça o campo
   abrir.

### Fora do Escopo

- **Ordenar a lista de empresas** e **ver mais de 50 sem digitar busca**
  (`LIMITE = 50` em `CompanyQuickSelect.tsx:49`). O rodapé "Mostrando N de M.
  Refine a busca para ver as demais." fica como está.
- **Criar empresa por dentro do formulário**: já existe e permanece; não é
  para mexer, nem para ampliar.
- **Conferir um a um os outros nove pontos da lista do Objetivo.** Eles são
  consertados pela mesma mudança de raiz e o teste do requisito 6 cobre o
  mecanismo; auditar tela por tela é trabalho de outra demanda.
- **Os quatro `DialogTrigger asChild` que embrulham `<Button>`.** Eles sofrem o
  mesmo aviso de `ref`, mas um diálogo é centralizado na tela e não depende de
  âncora, então não há defeito visível ali. Somem junto, sem virar critério.
- **Trocar os rótulos de import com versão colada** (`'@radix-ui/react-popover@1.1.6'`,
  resolvidos por `alias` no `vite.config.ts` para pacotes que o lockfile trava
  noutra versão — `1.1.15`, medido em 18/09/2026). É dívida real e é de outra
  demanda.
- **Atualizar o React** para 19, que tornaria o `Button` atual correto. Fora de
  questão nesta demanda; ver Restrições.
- **Converter os demais componentes de `src/components/ui/` para `forwardRef`.**
  Nenhum outro foi medido como quebrado nesta execução; mexer neles agora é
  alargar a demanda sem prova.

## Impacto nas rotinas

**Nenhum.** O `vydhub/vyd-engage` não tem `docs/rotinas/` (medido em
18/09/2026: `git ls-tree -d origin/main docs/` lista `architecture`,
`database`, `frontend`, `integrations`, `prd`, `qa`, `reports`, `reviews` e
`stories`, e nada mais). A demanda não cria, remove nem altera função
`forge.*`, e não toca em contrato de branch, webhook ou formato de relatório.

## Restrições

1. **React continua em 18.3.1.** A correção tem de funcionar no React 18; não é
   para subir versão de React, de Radix ou de `cmdk` para resolver isto.
2. **`forwardRef` é compatível para trás.** Um componente `forwardRef` continua
   aceitando todos os usos atuais do `Button`, com e sem `ref`, com e sem
   `asChild`. Nenhum dos 722 pontos de uso do `Button` precisa mudar (medido em
   18/09/2026 contra a `origin/main 1c90a05` com
   `grep -rn "<Button" src/ --include=*.tsx | wc -l`) — se algum precisar, é
   sinal de que a conversão saiu errada.
3. **Nada de cor literal e nada de CSS próprio.** Vale a regra de UI do
   `CLAUDE.md` do repositório: só tokens semânticos. A correção não muda
   nenhuma classe de cor; a única classe alterada é a de largura do requisito 5.
4. **`npm install` completo não fecha neste ambiente.** Medido em 18/09/2026:
   `npm error code E403 ... GET https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`,
   e o status do proxy confirma `connect_rejected` para `cdn.sheetjs.com:443`.
   A dependência `xlsx` é servida por URL direta (`package.json:90`), fora do
   `registry.npmjs.org`, que é o único liberado. Instalar sem o `xlsx` funciona
   (medido: `added 1175 packages`) e é suficiente para rodar a suíte. **O
   `package.json` e o `package-lock.json` entregues não podem conter essa
   remoção** — ela é contorno de ambiente, não mudança de produto.
5. **Comando git que compare com a branch padrão escreve `origin/main`**, nunca
   `main`.

## Casos Extremos

1. **Nenhuma empresa cadastrada.** O painel abre e mostra "Nenhuma empresa
   cadastrada.". Isso é **sucesso**, não falha: o requisito é o painel abrir. A
   lista vazia é assunto de dado, não desta correção.
2. **Busca sem resultado.** O painel abre e mostra
   `Nenhuma empresa encontrada para "…"`. Também é sucesso.
3. **Usuário sem `entities.companies.create`.** O item "+ Criar nova empresa"
   não aparece (`CompanyQuickSelect.tsx:248`) e o painel abre do mesmo jeito,
   com a lista selecionável. A correção não pode fazer o item reaparecer para
   quem não tem a permissão.
4. **Botão desabilitado.** `CompanyQuickSelect` aceita `disabled` (hoje nenhum
   chamador passa). Com `disabled`, o gatilho continua sem abrir painel — o
   `forwardRef` não pode tornar clicável o que está desabilitado.
5. **`Button` com `asChild`.** Quando `asChild` é `true`, o `Button` rende um
   `Slot`; o `ref` tem de chegar ao filho real, não parar no `Slot`. É o caso de
   `src/components/ExportButton.tsx` e companhia.
6. **Painel dentro de janela sobreposta.** Na edição do lead
   (`LeadModal.tsx`), o painel é filho de um `Dialog`. O `PopoverContent` já usa
   `Portal` por isso (comentário em `src/components/ui/popover.tsx:23-25`, que
   manda não remover) — a correção não pode remover o `Portal` para "simplificar".
7. **Empresa selecionada que não está na página de 50.** O rótulo do botão vem
   de uma segunda consulta (`CompanyQuickSelect.tsx:99-108`). Ao abrir um lead
   que já tem empresa, o nome tem de continuar aparecendo no botão.

## Definição de Concluído

Cada item é verificável por comando ou por tela. `<raiz>` é a raiz do clone do
`vydhub/vyd-engage`.

1. **O aviso de `ref` sumiu e o painel é posicionado.** O teste do requisito 6,
   rodado com `npx vitest run <caminho do teste>`, passa. Rodado contra a
   `origin/main 1c90a05` (sem a correção), o mesmo teste falha — o construtor
   registra as duas saídas no relatório de entrega.
2. **A suíte inteira continua verde.** `npx vitest run` na raiz termina sem
   falha. Retrato de referência medido em 18/09/2026 nesta execução, com a
   correção do requisito 1 aplicada na cópia de trabalho e revertida em
   seguida: `Test Files 16 passed (16)` / `Tests 117 passed (117)`. A entrega
   tem de trazer, no mínimo, esses 16 arquivos verdes mais o teste novo.
3. **O build passa.** `npm run build` termina sem erro (é ele que faz o
   typecheck do TypeScript). Se o ambiente do construtor barrar o `xlsx` como
   barrou o desta execução em 18/09/2026, ele diz isso no relatório e mostra o
   contorno usado, sem levar o contorno para o diff.
4. **`grep -n forwardRef src/components/ui/button.tsx` devolve pelo menos uma
   linha.** Hoje devolve zero (medido em 18/09/2026 contra a
   `origin/main 1c90a05`).
5. **A classe de largura quebrada não existe mais.**
   `grep -rn "w-\[--radix-popover-trigger-width\]" src/` não devolve nada, e
   `grep -rn "w-(--radix-popover-trigger-width)" src/` devolve exatamente as
   três linhas do requisito 5.
6. **Na tela, campo Empresa:** em Leads → Novo Lead, clicar em
   "Selecione a empresa" abre o painel logo abaixo do botão, com a caixa
   "Buscar empresa…" e a lista (ou a frase de lista vazia). Clicar numa empresa
   fecha o painel e deixa o nome dela escrito no botão. O painel tem a mesma
   largura do botão.
7. **Na tela, campo Contato:** o mesmo, com "Selecione o contato".
8. **Na tela, edição de lead:** abrir um lead que já existe e repetir os itens
   6 e 7 dentro da janela sobreposta, com o painel aparecendo por cima dela e
   não recortado.
9. **Console limpo no caminho do lead.** Com o DevTools aberto em Novo Lead,
   clicar nos campos Empresa e Contato não produz a linha
   `Function components cannot be given refs`.
10. **Nada foi removido.** Na tela de Novo Lead, o item "+ Criar nova empresa"
    continua aparecendo para quem tem a permissão, abre o mini-formulário com
    Nome, CNPJ e Segmento, e a empresa criada fica selecionada no lead.

## Decisões assumidas

As duas rodadas foram respondidas pela própria rotina. **Nenhuma pessoa
confirmou o sintoma na tela**, nem no briefing nem nas respostas. O que segue é
o que esta spec decidiu sozinha, e é exatamente o que precisa ser lido na
aprovação.

- **Resposta 6 da rodada 1 — marcada `decisão assumida pela Respondedora —
  rever na aprovação` — NÃO ADOTADA.** Texto:
  *"segue a recomendação da Spec por ser a opção mais estreita — lista com
  busca por digitação, sem criação de empresa nova dentro do formulário de lead
  (fica para demanda própria), campo Empresa opcional e uma única empresa por
  lead."* Aquela execução não tinha o repositório. Medido em 18/09/2026, a
  busca por digitação **e** a criação rápida já existem em
  `CompanyQuickSelect.tsx`, e o campo Empresa é **obrigatório na criação**
  (`LeadOpportunityFields.tsx` marca `Empresa *` quando `mode === 'create'`).
  Obedecer a essa resposta apagaria recurso no ar e mudaria regra de
  obrigatoriedade que ninguém pediu. Esta spec a trata como ausência de
  resposta, não como escolha.
- **Resposta 7 da rodada 1 — marcada `decisão assumida pela Respondedora —
  rever na aprovação` — adotada em parte.** Texto:
  *"segue a recomendação da Spec por ser a opção mais estreita — a demanda
  conserta o campo Empresa no cadastro de novo lead e também na edição do lead
  somente se a causa for a mesma; melhorias como busca avançada, criação de
  empresa embutida e ordenação da lista ficam registradas em Fora do Escopo."*
  A condição "se a causa for a mesma" foi **medida e confirmada** em
  18/09/2026: as duas telas usam o mesmo `LeadOpportunityFields`, logo o mesmo
  componente e a mesma causa. A parte sobre criação embutida está superada pela
  medição acima.
- **Resposta 7 da rodada 2 — marcada `decisão assumida pela Respondedora —
  rever na aprovação` — adotada.** Texto:
  *"segue a recomendação da Spec, agora confirmada no código — [...] (a) sim, a
  demanda conserta apenas a lista voltar a abrir, mantendo busca e criação
  rápida como estão; (b) sim, a correção vale também para a janela de edição de
  lead (LeadModal.tsx) e para o campo Contato (ContactQuickSelect.tsx) se a
  causa for a mesma; (c) sim, melhorias que não são o defeito (ordenar a lista,
  ver mais de 50 empresas sem digitar busca) ficam nomeadas em Fora do Escopo."*
  É o recorte desta spec.

Decisões que esta execução tomou por conta própria, sem pergunta nenhuma por
trás:

- **O sintoma foi tratado como "o painel não aparece".** As duas rodadas
  supuseram isso do texto do briefing; ninguém confirmou. A diferença importa
  pouco aqui, porque a causa medida — painel montado e nunca posicionado —
  produz esse sintoma e também explicaria "pisca" ou "aparece fora do lugar".
  **Se, na aprovação, ficar dito que o painel ABRE e vem vazio**, esta spec está
  no alvo errado: o problema seria de dado ou de permissão, e a correção seria
  outra.
- **A correção fica na raiz (`ui/button.tsx`), não no campo.** Nenhuma resposta
  pediu isso. Foi decidido aqui porque o mesmo defeito atinge onze pontos
  medidos, e remendar um deixaria dez.
- **A largura do painel (requisito 5) entrou no escopo** sem ter sido
  perguntada. Motivo: é o primeiro efeito visível depois de a lista voltar a
  abrir, está nos mesmos arquivos e custa dois caracteres. Se a aprovação achar
  que é assunto de outra demanda, é só riscar o requisito 5 e o item 5 da
  Definição de Concluído — o resto da spec não depende dele.
- **`CompanyPicker.tsx` entrou apenas no requisito 5**, por ter a mesma classe
  quebrada. O conserto do painel dele vem de graça pelo requisito 1.
- **Não foi pedida nenhuma verificação em navegador real** como critério de
  entrega automatizado. Os itens 6 a 10 da Definição de Concluído são de
  conferência humana na tela; os itens 1 a 5 são de comando. A causa foi medida
  em `jsdom`, que é onde o mecanismo do `ref` e do posicionamento se manifesta.
- **Navegador, aparelho, ambiente e qualquer linha de Console seguem
  desconhecidos** nas duas rodadas. A spec não depende deles: a causa medida não
  é específica de navegador.
