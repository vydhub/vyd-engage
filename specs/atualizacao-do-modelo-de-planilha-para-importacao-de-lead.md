---
forge_id: FRG-178
slug: atualizacao-do-modelo-de-planilha-para-importacao-de-lead
---
# Spec: o modelo de planilha de importação de leads passa a ter todos os campos da criação manual

> Escrita em 04/11/2026 pela **rotina de Spec do VYD Forge**, depois de uma
> rodada de entrevista (ver `forge.spec_perguntas`,
> `demand_id fd86b935-1401-42d0-a312-f1459bc0f018`, `round 1`).
>
> **Quem respondeu a rodada 1: a Respondedora** (`respondida_pela_rotina = true`,
> `answered_at 2026-11-04 20:30:07.580132+00`, perguntas criadas em
> `2026-11-04 16:29:26.795139+00`). **Nenhuma pessoa respondeu nada nesta
> demanda** — o que existe de humano é o texto do briefing e os dois anexos.
>
> Aquela execução **tinha** o repositório `vydhub/vyd-engage` em mãos: as dez
> respostas citam arquivo e linha (`LeadImportModal.tsx`, `routes/leads.ts`,
> `importService.ts`, `schema.prisma`). Por isso esta execução **não refez a
> entrevista**. Das dez respostas, **uma** começa por "não sei" (a resposta 2),
> e não por falta de repositório: o anexo que lista os campos é uma imagem sem
> leitura automática. As **dez** respostas carregam a marca
> `decisão assumida pela Respondedora — rever na aprovação` e estão
> reproduzidas, uma a uma, em **Decisões assumidas**.
>
> **Uma correção de fato que esta execução mediu contra as respostas.** A
> resposta 2 assumiu que a tela de criação manual mostra `email`, `phone` e
> `Cargo`. **Não mostra**: o conjunto de campos da tela
> (`src/components/leads/LeadOpportunityFields.tsx`, retrato tirado em
> 04/11/2026 da `origin/main bbfc18b`) tem doze campos, e nenhum deles é
> e-mail, telefone ou cargo. A direção da resposta continua valendo (o modelo
> leva os campos da tela **mais** as colunas que já existem); só a contagem
> estava errada. A lista medida está no Objetivo.
>
> O briefing veio com dois anexos. O primeiro,
> `template-leads (2).csv` (`text/csv`, 103 bytes, sem legenda), foi lido:
> `extracao_ok = true`, e o conteúdo é **idêntico** ao que o código gera hoje
> (ver Objetivo, medição 1). O segundo,
> `Campos para preenchimento na criação do Lead - Manual.JPG` (`image/jpeg`,
> 145422 bytes, sem legenda), **não foi lido**: `forge.anexos_da_demanda`
> devolveu `extracao_ok = false`
> (`extracao_erro: "imagem: sem leitura automática"`) nesta execução. Nada
> nesta spec vem dessa imagem — a lista de campos do Objetivo foi tirada do
> **código da tela**, não dela. **Conferir a lista contra a imagem é item
> explícito da aprovação.**

<!-- forge:medicoes -->
```
$ date -u
Wed Nov  4 21:29:22 UTC 2026
$ date -u
Wed Nov  4 21:35:14 UTC 2026
```
Medições rodadas em 04/11/2026, entre 21:29 e 21:35 UTC, contra a
`origin/main bbfc18b` do `vydhub/vyd-engage` e o banco vivo
`dzelgzesjfokrxqvesch` (banco do Forge — o banco do engage **não** foi
consultado; ver Restrições).
<!-- /forge:medicoes -->

Conferente de horário rodado nesta branch antes do push, com a saída colada
como saiu (`specs/spec-sem-horario-inventado.md`, R7). O `vydhub/vyd-engage`
não tem o script `conferir-horarios` no seu `package.json` (medido em
04/11/2026 contra a `origin/main bbfc18b`), então ele foi rodado a partir do
clone do `vydhub/vyd-forge`. **Com `--raiz`**, que é a forma que a R8
(FRG-158) criou exatamente para isto: sem ela, o arquivo de outro repositório
é classificado pelo caminho **absoluto**, não casa as âncoras da R1 e
**"sai sempre limpo por engano"** — a conferência passaria sem ter conferido o
bloco de medição. Rodado sem argumento nenhum também não serve aqui: o script
compara a `origin/main` do clone **dele** (`vyd-forge`), que nesta execução
não tem `.md` mudado, e devolve `0 arquivo(s)`. A spec do usuário entra na
chamada e sai limpa por não casar padrão do script, que é o esperado
(FRG-146):

```
$ node /home/user/vyd-forge/scripts/conferir-horarios.mjs \
    --raiz /home/user/vyd-engage \
    specs/atualizacao-do-modelo-de-planilha-para-importacao-de-lead.md \
    specs/usuario/atualizacao-do-modelo-de-planilha-para-importacao-de-lead.md

Wed Nov  4 21:43:31 UTC 2026
conferir-horarios: limpo (2 arquivo(s))
```

## Objetivo

O briefing diz: *"O modelo de planilha para importação de leads em massa não
possui todos os campos a serem preenchidos na criação de uma novo lead.
Gostaria de adequar este modelo para que no carregamento em massa ele crie o
lead de forma a preencher todos os campos."*

São **dois** pedidos numa frase, e a entrega precisa dos dois: o **modelo**
ganha as colunas que faltam, e o **carregamento** passa a saber o que fazer
com elas. Hoje falham os dois lados, e um terceiro problema some no meio: o
modelo que o sistema oferece para baixar **derruba a importação inteira**.

**Medição 1 — o modelo de hoje, tirado do código em 04/11/2026 da
`origin/main bbfc18b`.** `downloadTemplate()`, em
`src/components/leads/LeadImportModal.tsx:137-139`:

```
138:  const headers = 'name,email,phone,company,source,status';
139:  const example = 'Maria Silva,maria@email.com,(11)99999-0000,ABC Ltda,WEBSITE,NEW';
```

São **seis** colunas. O anexo `template-leads (2).csv` traz exatamente estas
duas linhas — o arquivo que a pessoa anexou saiu deste botão.

**Medição 2 — a tela de criação manual tem doze campos.** Retrato de
`src/components/leads/LeadOpportunityFields.tsx`, tirado em 04/11/2026 da
`origin/main bbfc18b` (rótulos literais da tela, com a linha de cada um):

| Campo na tela | Linha | Obrigatório na criação |
|---|---|---|
| Nome da oportunidade | 280 | sim |
| Empresa | 293 | sim (`mode === 'create'`) |
| Contato | 308 | sim (`mode === 'create'`) |
| Status | 322 | não |
| Origem | 338 | não |
| Motivo | 357 | sim quando o status é terminal |
| Nota (do motivo) | 378 | sim quando o motivo é "Outro" |
| Informações da oportunidade | 404 | não |
| Valor estimado (Budget) | 419 | não |
| Prazo estimado | 436 | não |
| Probabilidade Go×Get | 447 | não |
| Responsável comercial | 468 | não |

**E-mail, telefone e cargo não estão nessa tela** — mas estão no modelo e no
importador de hoje, e continuam (Requisito 1). Etiquetas e campos
personalizados também não estão na tela, e **ficam fora** (resposta 5).

**Medição 3 — o que o importador aceita hoje.** `importLeadSchema`, em
`server/src/routes/leads.ts:877-907`, tem oito campos: `name`, `email`,
`phone`, `company`, `position`, `status`, `source`, `notes`. A rota
(`leads.ts:961-970`) repassa esses mesmos oito para `leadService.create`.
**Nenhum** dos campos de oportunidade chega lá: nem `companyId`, nem
`contactId`, nem `statusReason`/`statusReasonNote`, nem `estimatedValue`, nem
`estimatedTimeline`, nem `probabilityGoGet`, nem `assignedTo`.

**Medição 4 — a tela manda sete, não oito.** `interface ColumnMapping`
(`LeadImportModal.tsx:33-41`) e `FIELD_LABELS` (`:43-51`) têm `name`, `email`,
`phone`, `company`, `position`, `source`, `notes`. **`status` não está lá.** O
modelo gera uma coluna `status`, a tela a lê do arquivo e a **descarta** — não
há como mapeá-la, e ela nunca sai do navegador.

**Medição 5 — o modelo baixado hoje derruba a importação inteira.** O exemplo
do modelo traz `source = WEBSITE`. `SOURCE_MAP` (`LeadImportModal.tsx:53-64`)
mapeia `website → 'WEBSITE'`, e `'WEBSITE'` **não existe mais** no enum
`LeadSource` (`server/prisma/schema.prisma`: `PROSPECCAO_ATIVA`,
`PORTAL_NOTICIAS_LINKEDIN`, `EVENTO_FEIRA_SETORIAL`, `NETWORKING_PESSOAL`,
`CLIENTE_RECORRENTE`, `INDICACAO_PARCEIROS`, `OUTROS`). Como
`importSchema.parse(req.body)` (`leads.ts:923`) valida o **array inteiro** de
uma vez, uma única célula inválida reprova a requisição toda com 400, e
**nenhuma** linha entra.

Isso foi **medido**, não deduzido. O clone desta sessão não tem
`node_modules` (`server/node_modules/zod/package.json` e
`node_modules/zod/package.json` ausentes em 04/11/2026), então o caminho
HTTP real não roda aqui; em vez disso, o trecho de `importLeadSchema` e os
enums foram **copiados literalmente** para um script com o mesmo `zod` que o
`server/package.json` fixa (`"zod": "^3.22.4"` → `zod@3.22.4` instalado), e
alimentados com o payload que o modal monta a partir do modelo baixado:

```
$ node replica.mjs
1) celula source do modelo: "WEBSITE" -> modal envia: "WEBSITE"
2) "WEBSITE" pertence ao enum LeadSource atual? false
3) importSchema.parse do payload do modal -> success: false
4) erro: [{"received":"WEBSITE","code":"invalid_enum_value","options":["PROSPECCAO_ATIVA","PORTAL_NOTICIAS_LINKEDIN","EVENTO_FEIRA_SETORIAL","NETWORKING_PESSOAL","CLIENTE_RECORRENTE","INDICACAO_PARCEIROS","OUTROS"],"path":["leads",0,"source"],"message":"Invalid enum value. Expected 'PROSPECCAO_ATIVA' | 'PORTAL_NOTICIAS_LINKEDIN' | 'EVENTO_FEIRA_SETORIAL' | 'NETWORKING_PESSOAL' | 'CLIENTE_RECORRENTE' | 'INDICACAO_PARCEIROS', received 'WEBSITE'"}]
5) controle, mesma linha SEM a coluna source -> success: true
```

A réplica é réplica, não o caminho real: ela prova a semântica do `zod` sobre
o schema copiado, e o item 3 da Definição de Concluído manda provar o mesmo
pelo caminho HTTP de verdade. A linha 5 é o controle que mostra que o que
reprova é a célula de origem, não o resto do payload.

**Medição 6 — a camada de serviço já está pronta.** `CreateLeadData`
(`server/src/services/leadService.ts:10-30`) já declara os dezenove campos,
incluindo todos os de oportunidade. `leadService.create` (`:144-151`) já chama
`assertOpportunityLinks(tenantId, data.companyId, data.contactId)` e, quando o
status é terminal, `assertStatusReason(...)`. **Nada no serviço precisa
mudar.** O buraco desta demanda está inteiro em três lugares: o modelo, o
mapeamento da tela e o `importLeadSchema` da rota.

**O que a entrega faz:** o modelo passa a trazer todas as colunas da criação
manual; a tela passa a mapeá-las; a rota passa a aceitá-las, a resolver
Empresa, Contato e Responsável a partir de texto de planilha, e a **recusar a
linha** (não a importação inteira) quando um valor não serve.

## Usuários

- **Quem carrega leads em massa** (papéis com a capacidade `importData`; hoje
  `ADMIN`, `GESTOR` e `USER` a têm por padrão —
  `server/src/services/permissionService.ts:128,145-146`). É quem baixa o
  modelo na tela de Leads, preenche e sobe.
- **Quem lê o resultado**: a mesma pessoa, no relatório de erros ao fim da
  importação (Requisito 8).

## Requisitos

### Obrigatórios

**1. O modelo passa a ter dezessete colunas, nesta ordem.** As seis atuais
vêm primeiro e **com o nome inalterado** (é o que mantém planilha antiga
reconhecida pelo `autoDetectMapping` — resposta 9); as onze novas vêm depois.

| # | Coluna | Campo | Origem da decisão |
|---|---|---|---|
| 1 | `name` | Nome da oportunidade | já existe |
| 2 | `email` | E-mail do lead | já existe |
| 3 | `phone` | Telefone do lead | já existe |
| 4 | `company` | Empresa (chave de busca pelo nome) | já existe; papel novo no Req. 4 |
| 5 | `source` | Origem | já existe |
| 6 | `status` | Status | já existe no modelo, não no mapeamento (medição 4) |
| 7 | `company_cnpj` | Empresa (chave de busca pelo CNPJ) | resposta 3 |
| 8 | `contact_email` | Contato (chave de busca pelo e-mail) | resposta 3 |
| 9 | `contact_name` | Contato (chave de busca pelo nome) | resposta 3 |
| 10 | `position` | Cargo | já mapeado na tela, ausente do modelo |
| 11 | `status_reason` | Motivo | resposta 8 |
| 12 | `status_reason_note` | Nota do motivo | resposta 8 |
| 13 | `notes` | Informações da oportunidade | já mapeado na tela, ausente do modelo |
| 14 | `estimated_value` | Valor estimado (Budget) | resposta 10 |
| 15 | `estimated_timeline` | Prazo estimado | resposta 2 |
| 16 | `probability_go_get` | Probabilidade Go×Get | resposta 10 |
| 17 | `assigned_to_email` | Responsável comercial (e-mail) | resposta 6 |

Os nomes das onze colunas novas **não vieram de resposta nenhuma** — a
entrevista decidiu *quais campos* e *como identificá-los*, não como chamar a
coluna. Os nomes acima são decisão desta spec e estão em **Decisões
assumidas**, item D11, para o gestor corrigir se quiser outro padrão. O
arquivo continua **CSV** e os títulos continuam **em inglês** (resposta 9).

A linha de exemplo do modelo passa a trazer **valores reais**, nunca
`WEBSITE`/`NEW` (resposta 7). O rodapé do modelo não existe: um CSV não tem
aba de instruções, e `.xlsx` ficou fora (resposta 9).

**2. Origem e Status aceitam o rótulo da tela, o código interno e o código
legado.** Sem diferenciar maiúsculas de minúsculas nem acentos (resposta 7).
Os rótulos são os literais de `src/types/index.ts:34-49`:

- Status — `Novo` → `NOVO`; `Em Andamento` → `EM_ANDAMENTO`; `Pausado` →
  `PAUSADO`; `Cancelado` → `CANCELADO`; `Encerrado` → `ENCERRADO`.
- Origem — `Prospecção ativa` → `PROSPECCAO_ATIVA`;
  `Portal de Notícias/LinkedIn` → `PORTAL_NOTICIAS_LINKEDIN`;
  `Evento/Feira setorial` → `EVENTO_FEIRA_SETORIAL`; `Networking pessoal` →
  `NETWORKING_PESSOAL`; `Cliente recorrente` → `CLIENTE_RECORRENTE`;
  `Indicação de parceiros` → `INDICACAO_PARCEIROS`; `Outros` → `OUTROS`.

Os **códigos legados** também passam, porque já existe quem os traduza:
`normalizeLeadStatus` e `normalizeLeadSource`
(`server/src/utils/leadLegacy.ts`) mapeiam `NEW → NOVO`, `WEBSITE → OUTROS`,
`SOCIAL_MEDIA → PORTAL_NOTICIAS_LINKEDIN`, `REFERRAL →
INDICACAO_PARCEIROS`, `EMAIL`/`PHONE → PROSPECCAO_ATIVA`, `OTHER → OUTROS`,
`CONTACTED`/`QUALIFIED`/`PROPOSAL`/`NEGOTIATION → EM_ANDAMENTO`, `WON →
ENCERRADO`, `LOST → CANCELADO`. Reusar essas duas funções é o que conserta a
medição 5 para quem já baixou o modelo antigo — e é **reuso**, não código
novo: elas já estão importadas e aplicadas na mesma rota
(`leads.ts:12` importa as duas; `leads.ts:97-98`, no `querySchema`, usa
`z.preprocess(normalizeLeadStatus, …)` e `z.preprocess(normalizeLeadSource, …)`).

Célula **vazia** assume o padrão (`NOVO` e `OUTROS`). Célula **preenchida e
não reconhecida** recusa **a linha** — nunca a importação inteira (Requisito 7).

`SOURCE_MAP` (`LeadImportModal.tsx:53-64`) deixa de existir como está: hoje
ele mapeia para valores mortos e manda ao servidor o que o servidor reprova.
A tradução passa a ser **uma só**, no servidor, para não haver duas réguas
divergindo em silêncio.

**3. A tela passa a mapear as dezessete colunas.** `ColumnMapping`,
`FIELD_LABELS` e `autoDetectMapping` (`LeadImportModal.tsx:33-51` e `:93-135`)
ganham as onze colunas novas mais `status`. O `autoDetectMapping` reconhece,
para cada coluna nova, o título em inglês do Requisito 1 **e** o rótulo em
português da tela, e continua reconhecendo os seis títulos atuais exatamente
como hoje (resposta 9). Os rótulos de `FIELD_LABELS` passam a ser os da tela
de criação manual (`Nome da oportunidade *`, `Empresa *`, `Contato *`,
`Motivo`, `Valor estimado (Budget)`, `Probabilidade Go×Get`, `Responsável
comercial`…), para a pessoa reconhecer o que está mapeando.

**4. Empresa e Contato são obrigatórios e resolvidos contra registros que já
existem** (respostas 3 e 4). A importação **não cria** empresa nem contato.

- **Empresa:** `company_cnpj` tem precedência; se vazio, busca por `company`.
  A busca é no tenant, entre `Company` não apagadas, por CNPJ normalizado
  (só dígitos) ou por nome normalizado, comparando também `fantasyName`
  (`Company.name`, `Company.fantasyName`, `Company.cnpj` —
  `server/prisma/schema.prisma`, `model Company`).
- **Contato:** `contact_email` tem precedência; se vazio, busca por
  `contact_name`. A busca é entre `Lead` com `isContact = true`, **da empresa
  resolvida**, no tenant, não apagados.
- Linha **sem** empresa ou **sem** contato, ou cuja chave **não casa** nenhum
  registro, é recusada e listada no relatório de erros (Requisito 8). Isto
  **é uma quebra de compatibilidade declarada**: planilha antiga, com só as
  seis colunas, passa a ter **todas** as linhas recusadas (resposta 4) — e o
  Requisito 8 obriga a tela a dizer isso **antes** de a pessoa confirmar.
- A célula `company` continua gravando o texto literal em `Lead.company`
  (campo de texto livre que já existe), além de servir de chave: nada do que
  a planilha escreve se perde.
- A coerência final (empresa do tenant; contato `isContact = true` da **mesma**
  empresa) **não é reimplementada**: quem valida é
  `assertOpportunityLinks`, já chamado por `leadService.create`
  (`leadService.ts:103-148`).
- A resolução é **em lote**, não por linha: uma consulta de empresas e uma de
  contatos para o arquivo todo, antes do laço. Com o teto de mil linhas
  (`importSchema`, `leads.ts:910`), duas consultas por arquivo em vez de duas
  mil.

**5. Responsável comercial é resolvido pelo e-mail, e só por ele**
(resposta 6). Busca em `User` do tenant pelo e-mail, sem diferenciar
maiúsculas. Célula **vazia**: o lead entra **sem responsável**. E-mail
**preenchido e não encontrado**: a linha é **recusada** — perder a atribuição
em silêncio é pior do que recusar. Nome **não** é aceito como chave: nome
repete, e `assignedTo` é um uuid de usuário (`leads.ts:71`).

**6. Motivo e Nota seguem a mesma exigência da tela** (resposta 8). Quando o
status da linha for `PAUSADO`, `CANCELADO` ou `ENCERRADO`
(`TERMINAL_LEAD_STATUSES`, `leadService.ts:44-48`), a linha **precisa** de
`status_reason`; quando o motivo for `OUTRO`, precisa também de
`status_reason_note`. A regra **não é reescrita**: quem valida é
`assertStatusReason` (`leadService.ts:76-96`), já chamado por
`leadService.create` quando o status é terminal (`:150-151`). `status_reason`
aceita o rótulo da tela (`LEAD_STATUS_REASON_LABELS`, `src/types/index.ts:51-63`)
ou o código, com a mesma régua do Requisito 2.

**7. Uma célula ruim recusa a linha, nunca o arquivo.** É a correção direta da
medição 5. O `importLeadSchema` deixa de reprovar o array inteiro num valor de
enum: cada linha é validada **por si**, e a linha que não passa entra em
`errors` com o número da linha e o motivo, enquanto as outras seguem. O
contrato de resposta da rota não muda de forma
(`{ imported, skipped, failed, errors }` — `leads.ts:983-986`); o que muda é
que `errors` passa a ter caso para contar.

**8. O relatório de erros aparece na tela.** Hoje a rota devolve até vinte
erros (`errors: errors.slice(0, 20)`, `leads.ts:985`) e a tela os **joga
fora**: `setResult` (`LeadImportModal.tsx:236-240`) guarda só
`imported`/`skipped`/`failed`. Passa a mostrar, no passo final, **o número da
linha e o motivo** de cada erro devolvido, mais a frase de corte quando houver
mais erros do que os devolvidos. E, no passo de conferência (`preview`), a tela
avisa **antes** de importar quando a planilha não tem as colunas de empresa e
contato mapeadas — porque nesse caso nenhuma linha vai entrar (Requisito 4).

**9. Formato dos números** (resposta 10). `estimated_value` aceita padrão
brasileiro (`1.234,56`) e ponto decimal (`1234.56`), reusando `parseBrNumber`,
que já está exportada (`server/src/services/importService.ts:426-440`).
`probability_go_get` é inteiro de 0 a 100, sem `%`; valor fora da faixa, com
`%` ou com decimal recusa a linha, no molde do `createLeadSchema`
(`leads.ts:62-67`).

**10. Testes.** Ver Definição de Concluído, itens 2 a 7. O repositório já tem
os dois moldes necessários, e os dois rodam **sem Postgres**:
`server/src/__tests__/unit/createLeadPayload.test.ts` (contrato de schema,
importando o schema **real** da rota) e
`server/src/__tests__/http/leadsCreate.test.ts` (cadeia HTTP inteira com
Prisma mockado por `vitest-mock-extended`). O teste novo entra nesses moldes,
não num novo.

**11. Território — os arquivos que a demanda pode tocar.** Fora desta lista,
nada. É o que evita dois construtores colidindo, e é a régua que a revisão usa
para dizer se a entrega passou do pedido.

| Arquivo | O que muda nele |
|---|---|
| `src/components/leads/LeadImportModal.tsx` | `downloadTemplate` (Req. 1), `ColumnMapping`/`FIELD_LABELS`/`autoDetectMapping` (Req. 3), remoção do `SOURCE_MAP` (Req. 2), montagem do payload, aviso no passo de conferência e relatório de erros (Req. 8) |
| `server/src/routes/leads.ts` | `importLeadSchema` e o corpo de `POST /import`: validação por linha (Req. 7), resolução de empresa/contato/responsável em lote (Req. 4 e 5), repasse dos campos novos a `leadService.create` |
| `server/src/services/importService.ts` | **só** exportar `normalizeName` e/ou `normalizeCnpj` (Restrição 8). Nenhuma mudança de comportamento, e nada que mexa com a tela "Importar Dados" |
| `server/src/services/leadService.ts` | **só** o comentário de `create` (Restrição 7). Nenhuma mudança de código |
| `src/services/api/client.ts` | `importLeads` (`:691-696`), se o tipo de retorno precisar carregar `failed`/`errors` para o Req. 8 |
| `server/src/__tests__/unit/` e `server/src/__tests__/http/` | testes novos (itens 2 a 6 da Definição de Concluído) |
| `src/components/leads/` (teste) | teste novo da tela (item 7) |
| `specs/relatorios/<slug>-build.md` | o relatório de build |

**Não entram no território:** `server/prisma/` (Restrição 2 e item 10 da
Definição de Concluído), `src/pages/Import.tsx`, a parte de leads de
`importService.ts` além da exportação citada, `src/types/index.ts`,
`server/src/utils/leadLegacy.ts` (é reuso, não mudança) e
`server/src/services/permissionService.ts`.

### Fora do Escopo

- **A tela "Importar Dados"** (`src/pages/Import.tsx`, rota
  `/app/settings/import`, restrita a `ADMIN_ROLES` —
  `src/utils/routes.tsx:357-360`), que é o outro importador do sistema. Ela
  casa coluna a campo, aceita `.xlsx` e já tem oito campos de lead mais os
  campos personalizados (`LEAD_TARGET_FIELDS`, `importService.ts:31-40`), mas
  **não oferece modelo para baixar** — logo não há modelo dela para adequar
  (resposta 1). Ela **não** recebe as colunas novas nesta entrega, e o
  `parseEnum` dela (`importService.ts:368-375`), que aceita só o código
  interno e **silenciosamente ignora** valor não reconhecido, **continua como
  está**. Fica uma divergência consciente entre os dois importadores; não há
  demanda vizinha aberta para ela (medido em 04/11/2026: as demandas do
  `vydhub/vyd-engage` com "import", "planilha" ou "lead" no título são
  FRG-157, entregue, e esta).
- **Etiquetas e campos personalizados** (resposta 5): não entram no modelo. Não
  há decisão de formato de coluna a tomar agora.
- **Criar empresa ou contato que não existe** (resposta 3, opção B rejeitada), e
  **aceitar lead sem vínculo** (opção C rejeitada).
- **Trocar o CSV por `.xlsx`** e **traduzir os títulos das colunas para
  português** (resposta 9).
- **Converter o visual do modal para os tokens do design system.**
  `LeadImportModal.tsx` está hoje cheio de classes utilitárias de cinza e azul
  (`text-gray-900`, `bg-blue-50`, `border-gray-200`…). Ele **passa** no gate
  atual, que proíbe hex e `rgb()/hsl()` literais e não olha classe utilitária
  (`scripts/check-hardcoded-colors.mjs:1-18`; o arquivo não está na
  `ALLOWLIST_FILES`). Converter o modal inteiro é mudança de outra natureza e
  de outro tamanho; esta entrega não a faz. O que ela **faz** está na
  Restrição 6.
- **Mudar a capacidade exigida para importar.** Continua `importData`
  (`leads.ts:917`).
- **Mexer em `leadService`.** Pela medição 6, não precisa.

## Impacto nas rotinas

**Nenhum.** O `vydhub/vyd-engage` não tem `docs/rotinas/` (medido em
04/11/2026: `git ls-tree -d --name-only origin/main docs/` devolve
`architecture`, `database`, `frontend`, `integrations`, `prd`, `qa`, `reports`,
`reviews` e `stories`, e `git ls-tree -d --name-only origin/main
docs/rotinas/` devolve vazio). A demanda não cria, não remove e não altera
assinatura nem retorno de função `forge.*`, e não toca em contrato de branch,
de webhook nem em formato de relatório.

## Restrições

1. **O banco do engage não foi consultado para escrever esta spec, e não pode
   ser pelo construtor.** Uma execução de rotina alcança, pelo conector MCP, o
   projeto `dzelgzesjfokrxqvesch`, que é o banco do **Forge**; a produção do
   engage é um Postgres no Railway, fora desse alcance. Toda afirmação desta
   spec sobre dados do engage vem do **código** e do **schema**, nunca de um
   `SELECT`. Em particular, esta spec **não sabe** quantas empresas e contatos
   existem no tenant de quem pediu — e é justamente disso que depende o
   Requisito 4 ser útil ou ser uma parede: se os contatos da planilha não
   estiverem cadastrados, toda linha será recusada. É o que o item 8 da
   Definição de Concluído manda a pessoa conferir com uma planilha real antes
   do aceite.
2. **Nenhuma mudança de banco nesta entrega.** Não há migração, não há coluna
   nova, não há tipo alterado: `CreateLeadData` e o `model Lead` já têm todos
   os campos (medição 6). Logo não há mudança destrutiva, não há arquivo com
   `-- publicacao: depois` e não há janela de 24 h. O manifesto existe e está
   **ativo** (`git show origin/main:.forge/publicacao.json` traz
   `"ativa": true`, `"banco": { "tipo": "prisma", "migrations":
   "server/prisma/migrations" }`, medido em 04/11/2026), então a régua geral
   valeria — ela só não tem o que reger aqui. **Se o construtor concluir que
   precisa de migração, a premissa desta spec caiu**: ele para e devolve, em
   vez de inventar a janela.
3. **O site antigo e o novo convivem durante a publicação, e os dois falam com
   a mesma API.** A tela nova manda colunas novas; a API antiga as
   **ignoraria** (o `importLeadSchema` de hoje descarta chave desconhecida,
   que é o padrão do `z.object`), e a API nova atende a tela antiga porque
   toda coluna nova é opcional **no schema**. A obrigatoriedade de empresa e
   contato do Requisito 4 é a exceção que importa: assim que a API nova subir,
   uma importação feita pela **tela antiga** (sem as colunas de vínculo)
   passa a ter todas as linhas recusadas. Não é perda de dado e não é
   silencioso — a resposta já traz `failed` e `errors` —, mas é um intervalo
   em que a tela antiga não importa nada. O construtor registra isso no
   relatório de build; não há o que codificar contra.
4. **Comando git que compare com a branch padrão escreve `origin/main`**, nunca
   `main`.
5. **O teto de mil linhas por importação não muda** (`importSchema`,
   `leads.ts:910`). Arquivo maior continua sendo recusado pela rota; o
   Requisito 8 manda a tela dizer isso em vez de deixar a requisição morrer
   sem explicação.
6. **Regra de UI do repositório, no que esta entrega toca.** Vale o
   `CLAUDE.md` do `vydhub/vyd-engage`: nenhuma cor literal (hex, `rgb()`,
   `hsl()`) em lugar nenhum, e **a marcação nova — o relatório de erros do
   Requisito 8 e as linhas novas do mapeamento — usa tokens semânticos**
   (`text-primary`, `text-secondary`, `bg-panel`, `border-default`,
   `bg-action-primary`/`text-on-accent`), não classes de cinza próprias. As
   linhas **que a entrega não toca** ficam como estão (ver Fora do Escopo).
   `npm run lint` (que encadeia `lint:css` e `check:colors`) tem de continuar
   passando — item 9 da Definição de Concluído.
7. **Esta demanda contraria, de propósito, um caso escrito da spec anterior
   de leads — e isso tem de ficar dito.** O comentário de
   `leadService.create` (`server/src/services/leadService.ts:145-147`, retrato
   de 04/11/2026 da `origin/main bbfc18b`) diz, com todas as letras:

   ```
   // Coerência dos vínculos e do motivo (quando informados). A obrigatoriedade
   // de companyId/contactId na criação MANUAL é imposta pelo Zod da rota
   // (createLeadSchema); captação pública/import criam sem vínculo (caso 5).
   ```

   Ou seja: "importação cria sem vínculo" é **caso previsto e aceito** da spec
   `specs/leads-oportunidade-inteligencia-mercado.md`, não um esquecimento. O
   Requisito 4 **muda** isso para a tela de Importar Leads, por decisão da
   resposta 4 (D4). O construtor **atualiza esse comentário** para registrar
   que a importação pela tela de Leads passa a exigir o vínculo, e que quem
   continua criando sem vínculo é a **captação pública** e a tela "Importar
   Dados" (Fora do Escopo). Deixar o comentário como está faz o próximo leitor
   concluir que a entrega violou a spec anterior — e ele não teria como saber
   que foi decisão desta.

8. **Nenhuma régua de validação é reescrita.** Vínculo Empresa↔Contato:
   `assertOpportunityLinks`. Motivo do status terminal: `assertStatusReason`.
   Número em pt-BR: `parseBrNumber`. Código legado de status/origem:
   `normalizeLeadStatus`/`normalizeLeadSource`. Copiar qualquer uma dessas
   regras para dentro do importador cria duas verdades que divergem na
   primeira mudança — e é motivo de reprovação na revisão.
   `normalizeName` e `normalizeCnpj` (`importService.ts:492-499` e
   `:1216-1219`) hoje são **privadas do módulo**: o construtor **exporta** as
   que for usar, ou move para um utilitário compartilhado. Não reimplementa.

## Casos Extremos

1. **Planilha antiga, com as seis colunas de hoje.** Todas as linhas são
   recusadas por falta de empresa e contato (Requisito 4). A tela avisa no
   passo de conferência, antes de confirmar (Requisito 8). É o efeito
   declarado da resposta 4, e é a mudança que mais incomoda nesta entrega.
2. **Modelo antigo com `WEBSITE`/`NEW` nas células.** Passa a ser aceito e
   traduzido (`WEBSITE → OUTROS`, `NEW → NOVO`) pelo Requisito 2 — mas a linha
   ainda será recusada se não tiver empresa e contato. As duas regras são
   independentes.
3. **Duas empresas com o mesmo nome normalizado no tenant.** A chave é
   ambígua: a linha é **recusada**, com o motivo dizendo que o nome casou mais
   de uma empresa e pedindo o CNPJ. Escolher uma das duas em silêncio liga o
   lead à empresa errada, e ninguém descobre.
4. **`company_cnpj` e `company` apontando para empresas diferentes.** O CNPJ
   tem precedência (Requisito 4), mas discordância é sinal de planilha errada:
   a linha é **recusada**, com o motivo citando as duas.
5. **`contact_email` de um contato de outra empresa.** Recusada — é o que
   `assertOpportunityLinks` já impõe (`leadService.ts:117-127`).
6. **`contact_email` casando um `Lead` que não é contato** (`isContact =
   false`). Recusada, pelo mesmo caminho (`leadService.ts:122-124`).
7. **Dois contatos com o mesmo nome na mesma empresa.** Mesma régua do caso 3:
   recusada, pedindo o e-mail.
8. **Status terminal sem motivo, ou motivo `OUTRO` sem nota.** Recusada por
   `assertStatusReason` (Requisito 6). A mensagem é a que a função já lança
   (`Informe o motivo para pausar, cancelar ou encerrar o lead` /
   `Descreva o motivo quando selecionar "Outro"`), com o número da linha.
9. **Motivo preenchido com status não terminal.** `assertStatusReason` retorna
   sem erro (`leadService.ts:81`) e o motivo é gravado. Comportamento de hoje
   do serviço; a importação não o contradiz.
10. **`estimated_value` com símbolo de moeda, espaço ou separador de milhar.**
    `parseBrNumber` remove o que não é dígito, ponto, vírgula ou sinal, e
    decide o decimal pelo **último** separador (`importService.ts:426-440`).
    `R$ 1.234,56` → `1234.56`. Célula que sobra vazia depois da limpeza vira
    ausente, não zero.
11. **`estimated_value` negativo.** Recusada: `createLeadSchema` exige
    `nonnegative()` (`leads.ts:60`), e a importação segue a mesma faixa.
12. **`probability_go_get` como `70%` ou `70,5`.** Recusada (Requisito 9,
    resposta 10). A planilha escreve `70`.
13. **E-mail do lead repetido, com a opção de pular duplicados ligada** (é o
    padrão da tela — `skipDuplicates`, `LeadImportModal.tsx:168`). A linha
    conta em `skipped`, não em `failed`, como hoje (`leads.ts:950-957`). A
    deduplicação acontece **antes** da resolução de vínculos: linha pulada não
    gasta busca.
14. **Duas linhas do mesmo arquivo com o mesmo e-mail.** A segunda é pulada; o
    conjunto `existingEmails` já é alimentado durante o laço
    (`leads.ts:972`).
15. **Limite do plano atingido no meio do arquivo.** O laço **para** e registra
    `Limite do plano atingido` na linha onde parou (`leads.ts:975-978`). As
    linhas seguintes não são tentadas. Comportamento de hoje, preservado — e o
    relatório do Requisito 8 passa a mostrá-lo, em vez de só somar em `failed`.
16. **Arquivo com mais de mil linhas.** Recusado pela rota (Restrição 5); a
    tela diz o teto antes de enviar.
17. **Arquivo só com cabeçalho.** Já tratado: a tela exige cabeçalho mais uma
    linha (`LeadImportModal.tsx:187-190`).
18. **CSV separado por ponto e vírgula, ou com campo entre aspas contendo
    vírgula.** Já tratado pelo `parseCSV` da tela
    (`LeadImportModal.tsx:66-91`), que aceita `,` e `;` e respeita aspas. As
    colunas novas não mudam isso. Célula de nota com vírgula precisa de aspas,
    como hoje.
19. **Coluna nova presente no arquivo mas deixada em `-- Ignorar --` no
    mapeamento.** Vale como vazia: o campo não é enviado.
20. **Coluna de vínculo mapeada mas com a célula vazia em algumas linhas.** A
    recusa é **por linha**, não pelo arquivo: as linhas preenchidas entram.

## Definição de Concluído

Cada item é verificável por comando. Os itens 1 a 7 e 9 o construtor executa e
cola a saída no relatório de build; o item 8 é prova **operacional**, de
pessoa, e o item 10 diz o que ela não trava.

1. **O modelo tem as dezessete colunas, na ordem do Requisito 1.**
   `grep -n "const headers" src/components/leads/LeadImportModal.tsx` mostra a
   linha única com os dezessete títulos, começando por
   `name,email,phone,company,source,status`, e a linha de exemplo **não**
   contém `WEBSITE` nem `NEW`:
   `grep -c "WEBSITE\|NEW" src/components/leads/LeadImportModal.tsx` devolve
   `0`.
2. **Teste de contrato do schema da rota**, no molde de
   `server/src/__tests__/unit/createLeadPayload.test.ts`, importando
   `importLeadSchema` **da rota** (exportá-lo, se ainda não estiver — uma cópia
   divergiria em silêncio). Ele prova, com `npx vitest run`:
   - uma linha com as dezessete colunas preenchidas passa;
   - `source: 'Prospecção ativa'`, `source: 'PROSPECCAO_ATIVA'` e
     `source: 'WEBSITE'` **todos** passam, e o terceiro resolve para `OUTROS`;
   - `status: 'Em Andamento'`, `'EM_ANDAMENTO'` e `'NEW'` todos passam, o
     último como `NOVO`;
   - `source: 'Carta pombo'` **não** passa;
   - `probability_go_get: '70%'` e `'70,5'` não passam; `'70'` passa;
   - `estimated_value: 'R$ 1.234,56'` e `'1234.56'` passam, ambos como
     `1234.56`.
3. **Teste que prova a correção da medição 5 pelo caminho real**, no molde de
   `server/src/__tests__/http/leadsCreate.test.ts` (`supertest` + Prisma
   mockado, sem Postgres): um `POST /api/v1/leads/import` com **duas** linhas,
   a primeira com `source` inválida e a segunda válida, responde **200** com
   `imported: 1`, `failed: 1` e `errors[0].row === 1`. Hoje a mesma
   requisição responde 400 e `imported: 0` — é a diferença que o teste trava.
4. **Teste de resolução de vínculo**, no mesmo molde: linha cujo `company` casa
   uma empresa e cujo `contact_email` casa um contato **daquela** empresa é
   criada com `companyId` e `contactId` preenchidos (asserção sobre o que
   `leadService.create` recebeu); linha sem `company` é recusada e aparece em
   `errors` com o número da linha; linha cujo `company` casa **duas** empresas
   é recusada (caso extremo 3).
5. **Teste do responsável**, no mesmo molde: `assigned_to_email` de um usuário
   do tenant vira `assignedTo` com o uuid dele; e-mail desconhecido recusa a
   linha; célula vazia cria o lead com `assignedTo` ausente.
6. **Teste do motivo**, no mesmo molde: linha com `status: 'Pausado'` e
   `status_reason` vazio é recusada com a mensagem de
   `STATUS_REASON_REQUIRED`; com `status_reason: 'Outro'` e nota vazia, com a
   de `STATUS_REASON_NOTE_REQUIRED`; com motivo preenchido, é criada.
7. **Teste da tela** (`npm test` na raiz) provando o Requisito 8: dado um
   resultado com `errors: [{ row: 3, error: 'Empresa não encontrada' }]`, o
   passo final **renderiza** `3` e `Empresa não encontrada`. Hoje não
   renderiza nenhum dos dois.
8. **Prova operacional, por pessoa, depois do merge e da publicação**
   (`docs/rotinas/prova-pelo-chamador-real.md` do `vyd-forge`). Nenhum teste
   deste repositório alcança o tenant real, e é lá que está a pergunta que
   importa: *os contatos da planilha estão cadastrados?* (Restrição 1).
   - **Veículo:** quem pediu a demanda baixa o modelo novo na tela de Leads,
     preenche **cinco linhas** com empresas e contatos que já existem no
     tenant, importa, e confere que os cinco leads aparecem na lista com
     Empresa, Contato, Responsável, Status, Origem, Valor estimado e
     Probabilidade preenchidos; depois repete com **uma** linha de empresa
     inexistente e confere que o relatório de erros nomeia a linha e o motivo.
   - **Quem executa:** a pessoa solicitante, no ambiente de produção
     (`engage.vydhub.com`), porque é o único lugar onde existe o cadastro.
   - **O aceite espera por essa prova?** **Não.** Os itens 1 a 7 e 9 provam o
     comportamento do código sem ela, e travar o aceite numa janela de pessoa
     pararia a demanda por tempo que ninguém mediu. O aceite acontece com os
     itens automáticos; esta prova é a **conferência de campo** que vem
     depois, e o seu resultado volta como demanda nova se divergir.
   - **Custo declarado:** se a planilha real da pessoa tiver contatos ainda não
     cadastrados, o Requisito 4 vai recusar essas linhas — e a conclusão será
     que falta um pedido separado (cadastrar empresa/contato na própria
     importação, hoje recusado pela resposta 3). Esse custo está dito em voz
     alta aqui para não aparecer como surpresa na aprovação.
9. **Os portões do repositório passam**, com a saída colada no relatório:
   `cd server && npx vitest run && npm run build`, e, na raiz,
   `npm test && npm run lint && npm run build`. O `npm run lint` encadeia
   `lint:css` e `check:colors` (`package.json`), que é o que prova a
   Restrição 6.
10. **Nenhuma migração nova.** `git diff --name-only origin/main...HEAD --
    server/prisma/` não lista nada (Restrição 2). Se listar, a entrega saiu do
    que esta spec autoriza.

## Decisões assumidas

As dez respostas da rodada 1 vieram da **Respondedora**, não de uma pessoa, e
**todas as dez** carregam a marca `decisão assumida pela Respondedora — rever
na aprovação`. Estão reproduzidas abaixo, uma a uma, em negrito, com o número
da pergunta. Depois delas vêm as decisões desta execução de Spec, que não saem
de resposta nenhuma.

**D1 — resposta 1 (qual tela recebe o modelo novo), decisão assumida pela
Respondedora — rever na aprovação:** *"Só a A (Importar Leads, pelo botão na
tela de Leads). Conferi em src/components/leads/LeadImportModal.tsx:
downloadTemplate() está nesse modal e gera o template-leads.csv anexado
(name,email,phone,company,source,status); a tela B não tem modelo para baixar,
então não há o que adequar nela. É a opção que toca menos arquivos."*

**D2 — resposta 2 (a lista de campos da imagem está certa?), decisão assumida
pela Respondedora — rever na aprovação:** *"Não sei — assumido: a lista está
certa. (…) A imagem "Campos para preenchimento na criação do Lead -
Manual.JPG" não pôde ser lida automaticamente (extracao_ok = false), então
conferi no código: createLeadSchema em server/src/routes/leads.ts:46 aceita
name, email, phone, company, position, companyId, contactId, status, source,
statusReason, statusReasonNote, estimatedValue, estimatedTimeline,
probabilityGoGet, notes, assignedTo, tagIds e customFields. Assumido: o modelo
traz todos os campos da tela de criação manual (…) mais as colunas que já
existem (email, phone) e Cargo. Etiquetas e campos personalizados ficam fora
(ver resposta 5). A Spec deve comparar com a imagem na aprovação."*
→ **A imagem continua não lida nesta execução.** A lista de campos do Objetivo
foi tirada do **código da tela** (`LeadOpportunityFields.tsx`), e corrige a
resposta num ponto: a tela **não** tem e-mail, telefone nem cargo (medição 2).
**Conferir a lista contra a imagem é item da aprovação.**

**D3 — resposta 3 (como a planilha identifica Empresa e Contato), decisão
assumida pela Respondedora — rever na aprovação:** *"Opção A: a planilha
identifica a empresa pelo nome ou CNPJ e o contato pelo e-mail ou nome, usando
só registros que já existem; linha sem correspondência é recusada com erro no
relatório. Não criar empresa nem contato (B) e não deixar sem vínculo (C). (…)
O contato deve pertencer à empresa informada, como a criação manual valida no
leadService."*

**D4 — resposta 4 (Empresa e Contato são obrigatórios na importação?), decisão
assumida pela Respondedora — rever na aprovação:** *"Obrigatórios, como na
criação manual: linha sem empresa ou sem contato (ou sem correspondência,
conforme a resposta 3) é recusada e listada no relatório de erros. (…)
Planilhas antigas sem essas colunas passarão a ter as linhas recusadas, e o
relatório deve dizer isso claramente."*
→ **É a decisão de maior consequência desta spec.** Ela quebra, de propósito,
toda planilha antiga (caso extremo 1). Se o gestor quiser o contrário —
vínculo opcional na importação —, é aqui que se corrige, e o Requisito 4
inteiro muda.

**D5 — resposta 5 (etiquetas e campos personalizados entram?), decisão
assumida pela Respondedora — rever na aprovação:** *"Não entram neste modelo:
nem etiquetas nem campos personalizados. O briefing pede os campos da criação
manual, e a tela manual (conforme a lista da pergunta 2) não mostra esses dois.
Fica como possível evolução futura; não há necessidade de decidir formato de
coluna agora."*

**D6 — resposta 6 (como identificar o Responsável comercial), decisão assumida
pela Respondedora — rever na aprovação:** *"Pelo e-mail da pessoa no sistema,
só ele (nome pode repetir e gerar ambiguidade; o assignedTo do
createLeadSchema, server/src/routes/leads.ts:75, é um uuid de usuário). Coluna
vazia: importa sem responsável. E-mail informado e não encontrado no tenant: a
linha é recusada com erro, para não perder a atribuição em silêncio."*
→ Só um ajuste de endereço: `assignedTo` está em `leads.ts:71` na
`origin/main bbfc18b`, não na linha 75.

**D7 — resposta 7 (Status e Origem: rótulo, código, ou os dois), decisão
assumida pela Respondedora — rever na aprovação:** *"Aceitar os dois: o nome
como aparece na tela e o código interno, sem diferenciar maiúsculas/minúsculas
nem acentos. (…) Célula vazia assume o padrão (Novo e Outros) (…). Valor
preenchido e não reconhecido: a linha é recusada com erro (…). O modelo de
exemplo deve trazer valores reais (ex.: Prospecção ativa / Novo), não
WEBSITE/NEW."*
→ Esta spec **acrescenta** o código legado à lista de aceitos (Requisito 2),
que a resposta não cobriu, porque `normalizeLeadStatus`/`normalizeLeadSource`
já existem e é o que faz o modelo já baixado parar de derrubar a importação
(medição 5).

**D8 — resposta 8 (motivo obrigatório nos status terminais), decisão assumida
pela Respondedora — rever na aprovação:** *"Opção A: a mesma exigência da tela.
(…) Linha Pausado/Cancelado/Encerrado sem motivo (ou com motivo Outro sem
nota) é recusada e listada no relatório; a importação deve reusar
assertStatusReason em vez de reescrever a regra. O motivo aceita nome da tela
ou código, como no status."*

**D9 — resposta 9 (CSV ou .xlsx; títulos em inglês ou português), decisão
assumida pela Respondedora — rever na aprovação:** *"Continua CSV (…) Os seis
títulos atuais (name,email,phone,company,source,status) permanecem
inalterados, para planilhas antigas continuarem reconhecidas por
autoDetectMapping; as colunas novas entram depois delas, e o autoDetectMapping
deve passar a reconhecer também os novos títulos. A tradução dos títulos para
português fica de fora."*

**D10 — resposta 10 (formato de valor e probabilidade), decisão assumida pela
Respondedora — rever na aprovação:** *"Valor estimado: aceitar o padrão
brasileiro (1.234,56) e também o ponto decimal (1234.56); parseBrNumber em
server/src/services/importService.ts:420 já faz isso (…). Probabilidade Go x
Get: número inteiro de 0 a 100 (ex.: 70), sem o símbolo %, igual ao
createLeadSchema (int, min 0, max 100, server/src/routes/leads.ts:62-66); fora
disso ou decimal, a linha é recusada."*
→ Só um ajuste de endereço: `parseBrNumber` está em
`importService.ts:426-440` na `origin/main bbfc18b`, não na linha 420.

Decisões **desta** execução de Spec, que não vêm de resposta nenhuma:

**D11 — os nomes das onze colunas novas.** A entrevista decidiu quais campos
entram e como identificá-los, nunca como chamar a coluna. Esta spec escolheu
`company_cnpj`, `contact_email`, `contact_name`, `position`, `status_reason`,
`status_reason_note`, `notes`, `estimated_value`, `estimated_timeline`,
`probability_go_get` e `assigned_to_email`: inglês, minúsculas, `_` entre
palavras, seguindo os seis títulos que já existem. Trocar o padrão é barato
agora e caro depois de a primeira planilha circular.

**D12 — a ordem das colunas: as seis atuais primeiro.** Decorre de D9 (os seis
títulos não mudam), mas a *ordem* é escolha desta spec. Serve para a planilha
antiga e a nova ficarem alinhadas coluna a coluna no começo.

**D13 — uma célula ruim recusa a linha, não o arquivo** (Requisito 7). Nenhuma
resposta pediu isso; as respostas 6, 7, 8 e 10 dizem "a linha é recusada", o
que **hoje é impossível** pela forma do schema (medição 5). O Requisito 7 é o
que torna as outras decisões executáveis.

**D14 — o relatório de erros aparece na tela** (Requisito 8). As respostas
falam em "listada no relatório de erros" quatro vezes. Esse relatório **não
existe na tela** hoje: a rota devolve `errors`, a tela descarta
(`LeadImportModal.tsx:236-240`). Sem o Requisito 8, metade das decisões da
entrevista produz recusas invisíveis.

**D15 — a célula `company` continua gravando `Lead.company` como texto livre**,
além de servir de chave de busca. Nenhuma resposta tratou do campo de texto
livre que já existe; apagá-lo em silêncio perderia o que a planilha escreveu.

**D16 — resolução de vínculos em lote**, duas consultas por arquivo em vez de
duas por linha (Requisito 4). É decisão de implementação, registrada porque
muda o desenho do laço da rota.

**D17 — ambiguidade recusa a linha** (casos extremos 3, 4 e 7). Nenhuma
resposta previu nome repetido. Escolher um registro em silêncio liga o lead à
empresa errada sem ninguém ver; recusar pedindo o CNPJ ou o e-mail falha alto.

**D18 — o visual do modal não é convertido para os tokens do design system**
(Fora do Escopo, Restrição 6). A regra de UI do repositório é obrigatória em
toda edição, e esta spec a cumpre **na marcação nova**, deixando as linhas
antigas como estão. Converter o modal inteiro é outra entrega; dizer isso aqui
é o que impede a revisão de cobrar as duas coisas de uma vez.
