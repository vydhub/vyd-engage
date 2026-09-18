---
forge_id: FRG-157
slug: alteracao-do-go-get-no-lead
---
# Spec: Go×Get do lead aceita número digitado

> Escrita em 18/09/2026 pela **rotina de Spec do VYD Forge**, depois de uma
> rodada de entrevista (1 rodada, sete perguntas — ver `forge.spec_perguntas`,
> `demand_id 76d381f3-2d43-48a8-8262-213429be16e0`, `round 1`).
> **Quem respondeu a rodada 1: a Respondedora** (`respondida_pela_rotina = true`,
> `answered_at 2026-09-17 21:12:39.708554+00`). As sete respostas foram dadas
> com o repositório `vydhub/vyd-engage` em mãos e citam arquivo e linha em cada
> afirmação — nenhuma delas é "não sei". Uma única resposta traz a marca
> `decisão assumida pela Respondedora — rever na aprovação` (resposta 6) e está
> reproduzida em **Decisões assumidas**, em destaque.
>
> O briefing veio com um anexo, `Captura de tela 2026-09-17 165008.png`
> (`image/png`, 98254 bytes, sem legenda). `forge.anexos_da_demanda` devolveu
> `extracao_ok = false` (`extracao_erro: "imagem: sem leitura automática"`): a
> imagem **não foi lida** e nada nesta spec vem dela.

<!-- forge:medicoes -->
```
$ date -u
Fri Sep 18 01:27:59 UTC 2026
$ date -u
Fri Sep 18 01:31:53 UTC 2026
```
Medições rodadas em 18/09/2026, entre 01:27 e 01:31 UTC, contra a
`origin/main 11dfe63` do `vydhub/vyd-engage` e o banco vivo
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
    /home/user/vyd-engage/specs/alteracao-do-go-get-no-lead.md

Fri Sep 18 01:32:05 UTC 2026
conferir-horarios: limpo (1 arquivo(s))
```

## Objetivo

Hoje o campo **Probabilidade Go×Get** do lead é uma lista fechada de cinco
degraus (10, 25, 50, 75 e 90 por cento). Quem cadastra um lead não consegue
registrar 60% nem 35%: precisa escolher o degrau mais próximo, e o número que
fica salvo não é o número que a pessoa tinha em mente.

Esta demanda troca a lista por um campo em que se digita o número, mantendo
tudo o mais igual: continua sendo percentual inteiro, continua opcional,
continua sendo copiado para a probabilidade da oportunidade na conversão
Lead→Deal. A faixa aceita passa a ser **0 a 100**, a mesma que `Deal.probability`
já usa (`server/src/routes/deals.ts:51`, retrato de `origin/main 11dfe63`
tirado em 18/09/2026).

## Usuários

Quem cadastra e edita lead no VYD Engage — qualquer usuário autenticado com
permissão de escrita em leads no próprio tenant. Não há recorte por papel: o
campo não tem, hoje, nenhuma checagem de `role` própria, e esta demanda não
cria uma.

## Requisitos

### Obrigatórios

1. O campo **Probabilidade Go×Get** do formulário de lead deve deixar de ser um
   `Select` de opções e passar a ser um campo de texto numérico em que a pessoa
   digita o número, em `src/components/leads/LeadOpportunityFields.tsx`
   (hoje o `Select` está nas linhas 427-444; retrato de `origin/main 11dfe63`
   tirado em 18/09/2026).
2. A troca deve acontecer **apenas** nesse componente. Ele é o único lugar
   editável do campo e é consumido tanto por `src/pages/LeadForm.tsx:173` quanto
   por `src/components/LeadModal.tsx:127` — mudar ali cobre cadastro e edição de
   uma vez, sem tocar nas duas telas.
3. O campo deve continuar exibindo o sufixo `%` junto ao valor digitado, no
   mesmo molde visual do campo **Valor estimado (Budget)** logo acima
   (`LeadOpportunityFields.tsx:399-414`), que já usa `Input` com afixo
   posicionado e `inputMode="numeric"`.
4. O campo deve aceitar **somente número inteiro**, sem casas decimais, sem
   separador de milhar e sem sinal. Dígito é o único caractere que entra; o
   resto é descartado na digitação, como `maskCurrencyBRL` já faz para o valor
   estimado (`LeadOpportunityFields.tsx:59-60`).
5. O campo deve continuar **opcional**. Em branco significa "não definida" e
   grava `null`, exatamente como o valor `__none__` do `Select` de hoje faz
   (`LeadOpportunityFields.tsx:430-431`). A coluna é `probabilityGoGet Int?`
   (`server/prisma/schema.prisma:766`).
6. `0` deve passar a ser um valor válido e distinguível de "em branco": salvar
   `0` grava o inteiro `0`, não `null`.
7. O back-end deve aceitar qualquer inteiro de **0 a 100** e recusar o resto com
   `400`. Em `server/src/routes/leads.ts`, o `.refine()` que hoje testa a lista
   de degraus (linhas 65-72 na criação e 88-95 na edição) deve virar
   `.int().min(0).max(100)`, mantendo a mensagem de erro em português e o
   formato de erro que a rota já usa.
8. A edição deve continuar aceitando `null` explícito para **limpar** o campo
   (`updateLeadSchema`, `server/src/routes/leads.ts:88-95`). Apagar o conteúdo
   do campo na tela grava `null`, não `0`.
9. A constante `GO_GET_STEPS` deve ser removida dos três lugares onde hoje fixa
   a lista: `src/types/index.ts:68`, `server/src/routes/leads.ts:45` e a cópia
   local do teste `server/src/__tests__/unit/createLeadPayload.test.ts:33`.
   Nenhum código pode continuar importando `GO_GET_STEPS` depois da entrega.
10. O comentário da coluna em `server/prisma/schema.prisma:766` — hoje
    `// degraus fixos: 10 | 25 | 50 | 75 | 90 (validação Zod)` — deve passar a
    descrever a faixa nova (0 a 100, validação Zod). É só comentário: **não há
    migração de banco nesta demanda** (ver Restrições).
11. Os testes que hoje fixam os degraus devem ser reescritos para a régua nova,
    no mesmo arquivo em que já vivem:
    - `server/src/__tests__/unit/createLeadPayload.test.ts:98-107` (hoje "fora
      dos degraus 10/25/50/75/90 é rejeitada" e "em cada degrau válido passa");
    - `server/src/__tests__/unit/createLeadPayload.test.ts:148-151` (hoje
      "degraus do Go×Get continuam valendo na edição (33 rejeitado; 75 aceito)").
    A cobertura nova tem de exercitar, na criação e na edição: `0` aceito, `33`
    aceito, `100` aceito, `-1` recusado, `101` recusado, `33.5` recusado e
    `null` aceito só na edição.
12. A exibição do valor em leitura deve continuar funcionando sem alteração de
    código em `src/pages/LeadDetail.tsx:1015-1016` e
    `src/components/SidePanel.tsx:93`, que já imprimem `${valor}%` para qualquer
    inteiro. Estes dois arquivos entram na Definição de Concluído como
    *verificação*, não como alvo de edição.

### Fora do Escopo

- **Filtrar, ordenar, somar ou agrupar leads por Go×Get.** Medido em 18/09/2026
  contra `origin/main 11dfe63`: `grep -rn probabilityGoGet` não encontra o campo
  no `querySchema` de `GET /leads`, nem em `server/src/routes/savedViews.ts`,
  nem em `server/src/routes/reports.ts`, nem em `server/src/services/scoringService.ts`.
  Não existe filtro nem coluna de lista para adaptar hoje, e esta demanda não
  cria um. Se for preciso filtrar por faixa depois, é outra demanda.
- **Chips ou botões de sugestão ao lado do campo** (ver Decisões assumidas).
- **Migração de dados.** Não há o que migrar (ver Restrições).
- **Mudar `Deal.probability`** ou a conversão Lead→Deal
  (`server/src/services/leadService.ts:621`). A conversão copia o inteiro como
  já copia; com a faixa nova ela passa a copiar qualquer valor de 0 a 100, que
  `Deal.probability` já aceitava (`server/src/routes/deals.ts:51`).
- **Mudar a exportação CSV** (`server/src/services/exportService.ts:153`), que
  imprime o valor cru e continua correta para qualquer inteiro.
- **Editar `specs/leads-oportunidade-inteligencia-mercado.md`**, a spec aprovada
  que criou o campo com cinco degraus (linhas 121, 186 e 471). Spec aprovada é
  registro do que valia quando foi aprovada; esta spec é que passa a valer para
  o campo daqui em diante.

## Impacto nas rotinas

**Nenhum.** A demanda é do `vydhub/vyd-engage`, repositório que não tem pasta
`docs/rotinas/` (conferido em 18/09/2026 na `origin/main 11dfe63`: `ls
docs/rotinas/` devolve `No such file or directory`). Nenhuma função `forge.*`,
nenhum contrato de branch, webhook ou formato de relatório é tocado.

## Restrições

1. **Sem migração de banco.** A coluna já é `INTEGER` nullable e nunca teve
   `CHECK` — `server/prisma/migrations/20260817000000_leads_oportunidade/migration.sql:45`
   diz apenas `ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "probabilityGoGet" INTEGER;`
   (retrato de `origin/main 11dfe63` tirado em 18/09/2026). A restrição aos
   cinco degraus só existiu no Zod. Alargar a faixa não exige DDL, e a entrega
   **não deve** criar migração.
2. **Sem dado legado para converter.** Como o único caminho de escrita sempre
   foi o Zod dos cinco degraus, todo valor já salvo é um dos inteiros 10, 25,
   50, 75 ou 90 — todos dentro de 0 a 100. Leads existentes continuam abrindo,
   exibindo e salvando o mesmo número, sem passo de migração.
3. Stack e padrões já usados no repositório: React 18 + TypeScript + Zod no
   Express, primitivos `Input`/`Label` de `src/components/ui/`, validação de
   submit por `validateLeadOpportunityValues`
   (`LeadOpportunityFields.tsx:122-150`).
4. **Regras de UI VYD** (raiz `CLAUDE.md` do repositório): só tokens semânticos
   de cor, nada de hex ou rgb literal. O campo novo herda o estilo do `Input`
   já usado pelo Valor estimado; não cria cor nem cinza próprio.
5. O tipo `LeadOpportunityValues.probabilityGoGet`
   (`LeadOpportunityFields.tsx:50`) é hoje `number | null`, o que não representa
   o estado intermediário de um campo sendo digitado. Ele deve passar a `string`,
   no mesmo molde de `estimatedValue: string` (linha 48), com a conversão para
   `number | null` feita em `opportunityValuesToLeadPayload`
   (`LeadOpportunityFields.tsx:151-173`) e a leitura em
   `leadToOpportunityValues` (linha 120). A troca é contida: `LeadForm.tsx` e
   `LeadModal.tsx` nunca leem esse campo direto — só passam o objeto inteiro
   pelas funções auxiliares (`emptyLeadOpportunityValues`,
   `leadToOpportunityValues`, `validateLeadOpportunityValues`,
   `opportunityValuesToLeadPayload`).
6. `emptyLeadOpportunityValues` (`LeadOpportunityFields.tsx:88-102`) deve passar
   a devolver `''` no lugar de `null` para esse campo, acompanhando a troca de
   tipo.

## Casos Extremos

- **Campo apagado na edição de um lead que tinha valor.** Grava `null` (limpa),
  não `0`. É o caminho que `updateLeadSchema` já abre com
  `.nullable().optional()`.
- **`0` digitado.** Valor válido e distinto de vazio: grava `0`. Na leitura,
  `LeadDetail.tsx:1015-1016` e `SidePanel.tsx:93` testam `!= null`, então `0`
  aparece como `0%` e não como `—`.
- **Número acima de 100 ou negativo.** A tela impede antes do envio (validação
  de submit) e o back-end recusa com `400` de todo modo — a régua do servidor é
  a que vale, porque a API é chamável sem a tela.
- **Decimal digitado (`33,5` ou `33.5`).** A máscara só deixa passar dígito, de
  modo que a vírgula e o ponto nunca entram no campo. Pela API, `33.5` é
  recusado com `400` pelo `.int()`.
- **Zeros à esquerda (`007`).** Devem ser normalizados para `7` antes de gravar.
- **Campo colado com texto (`abc`).** A máscara descarta tudo e o campo fica
  vazio, equivalente a "não definida".
- **Rascunho salvo antes da entrega.** `LeadForm.tsx:41-43` guarda o formulário
  em `useFormDraft`. Um rascunho gravado com a versão antiga traz
  `probabilityGoGet` como número (ou `null`), e o campo novo espera `string`.
  A restauração do rascunho deve tolerar os dois formatos — número vira o texto
  correspondente, `null`/ausente vira `''` — sem derrubar o formulário.
- **Lead legado com um dos cinco degraus.** Abre com o mesmo número no campo,
  editável e salvável sem alteração (Restrição 2).
- **Conversão Lead→Deal com valor fora dos degraus.** `leadService.ts:621` copia
  `probabilityGoGet` para `probability` do deal; `createDealSchema` já aceita
  0-100, então 33 passa como passava 25.

## Definição de Concluído

**Back-end**

- [ ] `grep -rn "GO_GET_STEPS" --include=*.ts --include=*.tsx . | grep -v node_modules`
      não devolve nenhuma linha.
- [ ] `POST /api/v1/leads` com `probabilityGoGet: 33` num payload válido retorna
      `201`, e o lead lido de volta traz `probabilityGoGet: 33`.
- [ ] `POST /api/v1/leads` com `probabilityGoGet: 0` retorna `201` e grava `0`
      (não `null`).
- [ ] `POST /api/v1/leads` com `probabilityGoGet: 100` retorna `201`.
- [ ] `POST /api/v1/leads` com `probabilityGoGet: 101` retorna `400`.
- [ ] `POST /api/v1/leads` com `probabilityGoGet: -1` retorna `400`.
- [ ] `POST /api/v1/leads` com `probabilityGoGet: 33.5` retorna `400`.
- [ ] `PUT /api/v1/leads/:id` com `probabilityGoGet: 33` retorna `200` e grava `33`.
- [ ] `PUT /api/v1/leads/:id` com `probabilityGoGet: null` retorna `200` e deixa
      a coluna `NULL`.
- [ ] `PUT /api/v1/leads/:id` com `probabilityGoGet: 101` retorna `400`.
- [ ] `server/prisma/schema.prisma:766` não menciona mais "degraus fixos".
- [ ] `git status --porcelain server/prisma/migrations/` não lista arquivo novo
      (Restrição 1).

**Testes**

- [ ] `cd server && npx vitest run` passa inteiro, sem teste pulado.
- [ ] `server/src/__tests__/unit/createLeadPayload.test.ts` cobre, na criação e
      na edição, os sete casos do requisito 11 (`0`, `33`, `100`, `-1`, `101`,
      `33.5`, `null`).
- [ ] `server/src/__tests__/http/leadsCreate.test.ts` e
      `server/src/__tests__/unit/leadStatusReason.test.ts` continuam passando
      (usam `probabilityGoGet: 50` e `75`, ambos dentro da faixa nova).

**Front-end**

- [ ] `grep -n "Select" src/components/leads/LeadOpportunityFields.tsx` não
      encontra mais um `Select` entre o rótulo `Probabilidade Go×Get` e o rótulo
      `Responsável comercial`.
- [ ] `npm run build` na raiz conclui sem erro de TypeScript (é o typecheck do
      front).
- [ ] Na tela de cadastro de lead (`/app/leads/new`), digitar `37` no campo
      Probabilidade Go×Get e salvar cria o lead com `probabilityGoGet = 37`.
- [ ] Na edição do mesmo lead, apagar o conteúdo do campo e salvar deixa a
      coluna `NULL`, e o detalhe do lead passa a exibir `—`.
- [ ] Digitar `abc` no campo deixa o campo vazio; digitar `007` deixa `7`;
      digitar `150` não permite salvar, com aviso na tela.
- [ ] O detalhe do lead (`src/pages/LeadDetail.tsx`) e o painel lateral
      (`src/components/SidePanel.tsx`) exibem `37%` para esse lead, sem que
      nenhum dos dois arquivos tenha sido alterado
      (`git diff --stat origin/main...HEAD -- src/pages/LeadDetail.tsx src/components/SidePanel.tsx`
      devolve vazio).
- [ ] `npm run lint` na raiz e `cd server && npm run lint` passam.

**Território** (arquivos que a demanda pode tocar — qualquer outro fora daqui é
colisão com demanda vizinha):

- `src/components/leads/LeadOpportunityFields.tsx`
- `src/types/index.ts` (só a remoção de `GO_GET_STEPS`)
- `server/src/routes/leads.ts`
- `server/prisma/schema.prisma` (só o comentário da linha 766)
- `server/src/__tests__/unit/createLeadPayload.test.ts`
- `src/pages/LeadForm.tsx` (**só** se a tolerância a rascunho antigo exigir —
  ver Casos Extremos)

## Decisões assumidas

- **Resposta 6 — `decisão assumida pela Respondedora — rever na aprovação`:**
  *"a lista de opções de hoje some por completo, e o campo vira um input
  numérico simples igual ao de Valor estimado (LeadOpportunityFields.tsx:404-413),
  sem chips de sugestão ao lado. Não existe no código nenhum padrão de input
  livre com sugestão clicável ao lado (os únicos componentes com nome parecido,
  CompanyQuickSelect e ContactQuickSelect, são autocompletes de empresa/contato,
  não números) — criar esse padrão do zero para este campo tocaria mais
  componentes do que o pedido cobre, então fico na opção mais estreita."*
  Esta spec adota essa decisão (requisitos 1 e 3, e o item correspondente em
  Fora do Escopo). **Se o gestor quiser manter os cinco degraus como atalhos
  clicáveis ao lado do campo digitado, é aqui que se corrige, na aprovação.**

- **Faixa 0-100, e não 1-100.** A pergunta 3 foi respondida com "mínimo 0 e
  máximo 100" por espelhar `Deal.probability`, que é o campo de destino na
  conversão. Assumi que `0` significa "probabilidade nula", valor com sentido
  próprio, e não "não preenchido" — por isso o requisito 6 exige que `0` e
  vazio sejam distinguíveis. Se `0` não fizer sentido de negócio, o mínimo vira
  `1` e o requisito 6 cai.

- **Normalização de zeros à esquerda.** Nada foi perguntado sobre `007`.
  Assumi `7`, por ser o que a máscara de moeda vizinha já faz com dígitos
  colados.

- **Rascunho antigo do formulário.** A entrevista não tratou de
  `useFormDraft`. Assumi que um rascunho salvo antes da entrega não pode
  derrubar o formulário, e transformei isso em caso extremo com tolerância aos
  dois formatos. É o único motivo pelo qual `src/pages/LeadForm.tsx` aparece no
  território, e condicionalmente.

- **Remoção da constante em vez de aposentadoria.** O requisito 9 manda apagar
  `GO_GET_STEPS` dos três lugares. A alternativa seria mantê-la como sugestão
  de UI, mas a decisão da resposta 6 tirou as sugestões da tela, e constante
  sem uso é lixo que o próximo leitor confunde com regra viva.

- **O anexo não foi lido.** `extracao_ok = false` para
  `Captura de tela 2026-09-17 165008.png`. Se a imagem mostrar um layout de
  campo diferente do descrito no requisito 3, a aprovação é o lugar de dizer.
