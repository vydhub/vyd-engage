---
forge_id: FRG-175
slug: deletar-campo-hora-do-ultimo-contato-ao-criar-um-novo-deal
---
# Spec: o campo "Hora do último contato" sai do formulário de negócio

> Escrita em 04/11/2026 pela **rotina de Spec do VYD Forge**, depois de uma
> rodada de entrevista (ver `forge.spec_perguntas`,
> `demand_id 2d0ba206-b502-4be0-8a38-be1da3eba439`, `round 1`).
>
> **Quem respondeu a rodada 1: a Respondedora** (`respondida_pela_rotina = true`,
> `answered_at 2026-11-04 16:19:10.868178+00`). **Nenhuma pessoa respondeu
> nada nesta demanda** — o que existe de humano é o texto do briefing e um
> anexo que não foi lido.
>
> Aquela execução **tinha** o repositório `vydhub/vyd-engage` em mãos e citou
> arquivo e linha; por isso esta execução não refez a entrevista. Das oito
> respostas, duas começam por "não sei", e nenhuma das duas por falta de
> repositório: a resposta 4 porque o anexo é uma imagem sem leitura
> automática, a resposta 5 porque não há como consultar o banco do engage de
> dentro de uma execução da rotina. As **oito** respostas carregam a marca
> `decisão assumida pela Respondedora — rever na aprovação` e estão
> reproduzidas, uma a uma, em **Decisões assumidas**.
>
> **Duas correções de fato que esta execução mediu contra as respostas** (as
> respostas erraram a contagem, não a direção):
> a importação legada cria **12** campos personalizados, não 13 — logo são
> **11** outros campos além da "Hora do último contato", não 12. Ambas as
> contagens estão medidas no Objetivo.
>
> O briefing veio com um anexo, `Captura de tela 2026-10-09 140021.png`
> (`image/png`, 244920 bytes, sem legenda). `forge.anexos_da_demanda` devolveu
> `extracao_ok = false` (`extracao_erro: "imagem: sem leitura automática"`)
> nesta execução: a imagem **não foi lida** e nada nesta spec vem dela.

<!-- forge:medicoes -->
```
$ date -u
Wed Nov  4 16:22:09 UTC 2026
$ date -u
Wed Nov  4 16:30:29 UTC 2026
```
Medições rodadas em 04/11/2026, entre 16:22 e 16:30 UTC, contra a
`origin/main 9c93b03` do `vydhub/vyd-engage` e o banco vivo
`dzelgzesjfokrxqvesch` (banco do Forge — o banco do engage **não** foi
consultado; ver Restrições).
<!-- /forge:medicoes -->

Conferente de horário rodado nesta branch antes do push, com a saída colada
como saiu (`specs/spec-sem-horario-inventado.md`, R7). O `vydhub/vyd-engage`
não tem o script `conferir-horarios` no seu `package.json` (medido em
04/11/2026 contra a `origin/main 9c93b03`), então ele foi rodado a partir do
clone do `vydhub/vyd-forge`, apontando para o arquivo — a spec do usuário não
casa nenhum padrão do script e não exige bloco de medição (FRG-146):

```
$ node /home/user/vyd-forge/scripts/conferir-horarios.mjs \
    /home/user/vyd-engage/specs/deletar-campo-hora-do-ultimo-contato-ao-criar-um-novo-deal.md

Wed Nov  4 16:30:39 UTC 2026
conferir-horarios: limpo (1 arquivo(s))
```

## Objetivo

Na janela de criação de negócio (`https://engage.vydhub.com/app/deals` →
**Novo negócio**), no fim do formulário, aparece um bloco rotulado
**Campos personalizados**. Dentro dele vem o campo **Hora do último contato**,
que não tem nada a ver com negócio. O briefing pede que ele saia.

**O campo não é código do formulário.** Ele é um registro de dado. Medições de
04/11/2026 contra a `origin/main 9c93b03`:

O script de importação da base legada
(`server/scripts/import-bd-legacy.ts`) cria **12** campos personalizados no
tenant `k2-engenharia-e-tecnologia` (`SLUG` na linha 26 do arquivo). A lista
literal, lida do bloco `const CUSTOM_FIELDS` do próprio script:

```
Valor único vendido      (NUMBER)   -- Empresa
Valor recorrente vendido (NUMBER)   -- Empresa
Data do último contato   (DATE)     -- Empresa
Hora do último contato   (TEXT)     -- Empresa
Vendas                   (NUMBER)   -- Empresa
Perdidos                 (NUMBER)   -- Empresa
Pausados                 (NUMBER)   -- Empresa
Em andamento             (NUMBER)   -- Empresa
Total                    (NUMBER)   -- Empresa
Celular                  (TEXT)     -- Contato
Consentimento            (TEXT)     -- Contato
Status de consentimento  (TEXT)     -- Contato
```

São 12 campos — **11 além da "Hora do último contato"**. O script cria todos
eles **sem entidade**: nenhuma das 12 entradas do `CUSTOM_FIELDS` traz `entity`.

A coluna `entity` do `CustomField` nasceu nula e **nunca foi preenchida para o
que já existia**. A migração `20260627130000_gestao_negocios_p0` a acrescenta
sem `DEFAULT` e sem `UPDATE` de retrocarga (linha 14 do `migration.sql`):

```
ALTER TABLE "CustomField" ADD COLUMN     "entity" "CustomFieldEntity",
ADD COLUMN     "visibility" "CustomFieldVisibility" NOT NULL DEFAULT 'VISIBLE';
```

E o backend trata **entidade nula como "vale para todas as entidades"**.
`server/src/services/customFieldService.ts`, linhas 58-62, com o comentário do
próprio código:

```
    // Por entidade: inclui os campos da entidade pedida + os legados (entity=null,
    // visíveis em todas as entidades por compatibilidade).
    if (entity) {
      where.OR = [{ entity }, { entity: null }];
    }
```

O formulário de negócio pede os campos da entidade `DEAL`
(`src/components/deals/DealForm.tsx:203`, `getCustomFields(true, 'DEAL')`) e
rende o bloco "Campos personalizados" com o que voltar
(`DealForm.tsx:570-581`). Como os 12 campos legados têm `entity = null`, os 12
voltam no `OR` e os 12 aparecem ali. **É por isso que a "Hora do último
contato" aparece na criação de negócio.**

Daí sai o conserto desta demanda, e ele é de **dado, não de código**: dar
entidade ao campo. Com `entity = 'COMPANY'`, o campo deixa de casar os dois
lados do `OR` quando a entidade pedida é `DEAL` e desaparece do formulário de
negócio, sem que nenhuma linha de TypeScript mude e sem que nenhum valor
gravado seja tocado.

**Dois fatos medidos que mudam o tamanho do que se promete, e que precisam ser
lidos na aprovação:**

1. **Os outros 11 campos legados continuam aparecendo** no bloco "Campos
   personalizados" do formulário de negócio, inclusive a **"Data do último
   contato"** — a data fica, a hora sai. Foi a resposta 3 que recortou assim.
   Quem abriu a demanda vai continuar vendo o bloco, com 11 campos em vez de
   12.
2. **"Continua existindo para Empresa" não significa "aparece em Empresa".**
   Medido em 04/11/2026: o `CustomFieldInput` é renderizado em **um único**
   formulário do aplicativo, o de negócio
   (`grep -rln "CustomFieldInput" src/` devolve `src/components/CustomFieldInput.tsx`,
   `src/components/deals/DealForm.tsx` e `src/components/CustomFieldEditor.tsx`
   — o primeiro é o próprio componente, o terceiro é o editor de definições da
   tela de administração). **Não existe formulário de Empresa que mostre campo
   personalizado.** Depois desta mudança, a definição do campo segue viva na
   tela de administração de Campos personalizados e os valores importados
   seguem gravados em `Company.customFields`, mas nenhuma tela de Empresa passa
   a exibi-los — porque nenhuma exibia antes.

## Usuários

Quem cria e edita negócio no VYD Engage, no tenant
`k2-engenharia-e-tecnologia` — o único em que a importação legada criou os 12
campos. Não há recorte por papel: o bloco "Campos personalizados" é renderizado
para qualquer usuário autenticado que abra o formulário de negócio.

O efeito é o mesmo na **criação** e na **edição** de negócio, porque as duas
usam o mesmo componente: `DealForm.tsx` recebe `deal` como prop opcional
(`DealForm.tsx:42`) e monta o mesmo formulário com ou sem ela. Não há como
tirar o campo só da criação sem fazer valer a coluna `visibility`, que está
fora do escopo (ver Fora do Escopo e a resposta 8).

Administrador do tenant também é usuário desta mudança por um caminho
indireto: na tela de administração de Campos personalizados o campo continua
listado, editável e excluível como hoje.

## Requisitos

### Obrigatórios

1. **Entra uma migração Prisma nova**, e só ela, em
   `server/prisma/migrations/<carimbo>_<nome>/migration.sql`. O carimbo tem de
   ser posterior a `20261031120000`, que é a última migração da
   `origin/main 9c93b03` (`20261031120000_captura_demandas`, medido em
   04/11/2026).
2. **A migração dá entidade `COMPANY` ao campo "Hora do último contato" do
   tenant `k2-engenharia-e-tecnologia`, e a mais nada.** O comando é um
   `UPDATE` só, apontado por nome do campo e slug do tenant, e **guardado por
   `entity IS NULL`** para não sobrescrever entidade que alguém já tenha
   escolhido:

   ```sql
   UPDATE "CustomField" cf
      SET "entity" = 'COMPANY'
     FROM "Tenant" t
    WHERE cf."tenantId" = t."id"
      AND t."slug" = 'k2-engenharia-e-tecnologia'
      AND cf."name" = 'Hora do último contato'
      AND cf."entity" IS NULL;
   ```

   O par `(tenantId, name)` é único no modelo
   (`@@unique([tenantId, name])` em `server/prisma/schema.prisma`, medido em
   04/11/2026), então este `UPDATE` atinge **no máximo uma linha**. O nome da
   coluna no banco é `tenantId`, não `tenant_id`: o `CustomField` não usa
   `@map`, e a migração `20260627130000_gestao_negocios_p0` escreve
   `CREATE INDEX "CustomField_tenantId_entity_idx" ON "CustomField"("tenantId", "entity")`.
3. **A migração é idempotente.** Rodada duas vezes, a segunda afeta zero
   linhas (é o que a guarda `entity IS NULL` garante). Rodada num banco onde o
   tenant ou o campo não existem, afeta zero linhas e **não falha** — é o caso
   de qualquer ambiente que não seja a produção do engage.
4. **Nenhum arquivo de TypeScript, de React ou de schema muda.** Em especial:
   `customFieldService.ts` continua com o `OR` de compatibilidade como está,
   `DealForm.tsx` continua pedindo `getCustomFields(true, 'DEAL')`, e
   `schema.prisma` não muda (a coluna `entity` já existe e já aceita
   `COMPANY`). O diff da entrega é **um arquivo novo e nada mais**.
5. **A migração não apaga, não renomeia, não troca tipo e não aperta nada.**
   Ela não leva o marcador `-- publicacao: depois` (ver **Restrições**, item
   sobre publicação automática).
6. **A definição do campo não é apagada e nenhum valor gravado é tocado.** Não
   entra `DELETE`, não entra limpeza dos JSON `customFields` de
   `Company`/`Deal`/`Lead`/`Product`/`Empreendimento`/`CommercialRoadmap`, e a
   linha do `CustomField` continua existindo com `active = true`.

### Fora do Escopo

- **Os outros 11 campos legados.** "Data do último contato", "Valor único
  vendido", "Valor recorrente vendido", "Vendas", "Perdidos", "Pausados",
  "Em andamento", "Total", "Celular", "Consentimento" e "Status de
  consentimento" **continuam aparecendo** no formulário de negócio, com
  `entity = null`, exatamente como hoje. O briefing cita só a hora, e a
  resposta 3 recortou assim. **Dar entidade aos 11, ou fechar o vazamento de
  entidade nula de uma vez, é demanda própria** — e é a opção (c) que a
  resposta 1 recusou por ser mais larga.
- **Apagar a definição do campo** e **limpar os valores já gravados**. A
  resposta 2 decidiu não apagar nada. Um dia que se apague, fica valendo o que
  ela escolheu: deixar os valores antigos onde estão, sem limpeza destrutiva.
- **O seletor de entidade no editor de campos personalizados.** Medido em
  04/11/2026: `src/contexts/CustomFieldsContext.tsx` monta os corpos de
  `createCustomField` e `updateCustomField` com `name`, `type`, `options`,
  `required`, `order` e `active`, e **nunca com `entity`** — embora
  `customFieldService.create` (linha 42) e `.update` (linha 110) aceitem
  `entity`. Ou seja: **todo campo criado pela tela hoje também nasce sem
  entidade e também vaza para o formulário de negócio.** É dívida real, foi a
  resposta 7 que a mandou para fora, e é demanda própria. Sem ela, o vazamento
  volta no próximo campo que alguém criar pela tela.
- **Fazer a coluna `visibility` valer.** Ela existe no modelo com quatro
  valores (`VISIBLE`, `ON_CREATE`, `BY_FUNNEL`, `UNIQUE`), é gravada e nenhuma
  tela do `src` a lê (medido em 04/11/2026). Era o único caminho para esconder
  o campo apenas na criação, mantendo-o na edição; a resposta 8 decidiu que
  "delete-o" quer o campo fora do negócio em momento nenhum, e esta spec não
  mexe na coluna.
- **Mudança de código para os demais tenants.** A resposta 5 recortou o escopo
  para o tenant `k2-engenharia-e-tecnologia`. Nenhum outro tenant é tocado, e
  nenhum outro tenant está protegido de ver campos legados no formulário de
  negócio depois desta entrega.
- **Excluir o campo pela tela de administração.** Já é possível hoje
  (`src/pages/CustomFields.tsx`: `handleDelete` na linha 55, `deleteField` na
  57 e confirmação em `AlertDialogAction` na linha 190, medido em 04/11/2026),
  e a resposta 6 recusou esse caminho: a exclusão apagaria o campo **também**
  para Empresa, onde a importação gravou dados.

## Impacto nas rotinas

**Nenhum.** O `vydhub/vyd-engage` não tem `docs/rotinas/` (medido em
04/11/2026: `git ls-tree -d --name-only origin/main docs/` devolve
`architecture`, `database`, `frontend`, `integrations`, `prd`, `qa`, `reports`,
`reviews` e `stories`, e nada mais). A demanda não cria, não remove e não
altera assinatura nem retorno de função `forge.*`, e não toca em contrato de
branch, de webhook nem em formato de relatório.

## Restrições

1. **O banco do engage não foi consultado para escrever esta spec, e não pode
   ser pelo construtor.** Uma execução de rotina alcança, pelo conector MCP, o
   projeto `dzelgzesjfokrxqvesch`, que é o banco do **Forge**; a produção do
   engage é um Postgres no Railway, fora desse alcance. Toda afirmação desta
   spec sobre o que existe no banco do engage vem do **código** que o escreveu
   (`server/scripts/import-bd-legacy.ts`) e da **migração** que criou a coluna
   — nunca de um `SELECT`. Que o campo esteja lá com `entity IS NULL` é
   inferência de código, não medição de banco. Se o `UPDATE` do requisito 2
   atingir zero linhas na produção, a premissa está errada e a entrega não
   resolveu nada: é isso que o item 6 da Definição de Concluído existe para
   pegar.
2. **Publicação automática está ativa neste repositório e a mudança não é
   destrutiva.** `git show origin/main:.forge/publicacao.json` traz
   `"ativa": true`, `"banco": { "tipo": "prisma", "migrations":
   "server/prisma/migrations" }` (medido em 04/11/2026). A exceção da rotina
   para o engage **não se aplica** aqui: ela vale com `"ativa": false`, e aqui
   é `true`. Vale, então, a régua geral — e ela diz que **mudança destrutiva** é
   apagar, renomear, trocar tipo ou apertar (`NOT NULL`, `CHECK` nova,
   `UNIQUE`) o que já existe. O `UPDATE` do requisito 2 **não é nenhuma
   dessas**: escreve um valor numa coluna que já existe, já aceita nulo e
   continua aceitando. Por isso **não há mudança destrutiva nesta entrega, não
   há arquivo com `-- publicacao: depois`, e não há janela de 24 h** — a
   migração roda na fase de antes, pelo pipeline de publicação, antes de a API
   subir (`railway.toml` registra que o `startCommand` não migra mais).
3. **Não há convivência de site antigo e novo a proteger**, porque nenhum
   código muda. A régua das 24 h existe para o intervalo em que o site antigo
   ainda está no ar com o banco já mudado; aqui o site antigo e o novo são o
   mesmo código, e ele lida com `entity = 'COMPANY'` desde a
   `20260627130000_gestao_negocios_p0`. O efeito da migração é imediato e
   igual para os dois.
4. **Se o check `conferir-pr` da publicação classificar esta migração como
   destrutiva** (`destrutiva_na_fase_antes`), o construtor **para e registra a
   saída no relatório**, em vez de contornar. Acrescentar
   `-- publicacao: depois` só para o check passar atrasaria 24 h uma mudança
   que não precisa de janela, e esconderia uma divergência entre a régua
   escrita e o portão — que é informação que a revisão precisa ver.
5. **Comando git que compare com a branch padrão escreve `origin/main`**, nunca
   `main`.
6. **Nada de cor literal e nada de CSS.** Vale a regra de UI do `CLAUDE.md` do
   repositório, e ela é trivial de cumprir aqui: a entrega não tem arquivo de
   interface.

## Casos Extremos

1. **O `UPDATE` atinge zero linhas na produção.** Ou o tenant não se chama
   `k2-engenharia-e-tecnologia`, ou o campo não se chama exatamente
   `Hora do último contato`, ou alguém já lhe deu entidade. A migração **não
   falha** e o campo **continua aparecendo** no formulário. Não é entrega
   quebrada: é premissa desmentida, e o item 6 da Definição de Concluído é
   quem a desmente. O remédio é demanda nova, com o nome e o tenant medidos no
   banco.
2. **Acento no nome do campo.** `Hora do último contato` tem dois acentos. O
   arquivo `migration.sql` tem de estar em UTF-8 sem BOM, como os demais do
   repositório. Um `UPDATE` com o nome mal codificado casa zero linhas e cai
   silenciosamente no caso 1.
3. **O campo está marcado como obrigatório em alguma coluna de funil.** O
   `StageRequiredField` referencia `customFieldId` com
   `ON DELETE CASCADE` (migração `20260627130000_gestao_negocios_p0`). Esta
   entrega **não apaga** o campo, então nenhuma linha de `StageRequiredField`
   é removida em cascata. Mas, se existir uma exigindo esse campo numa coluna
   de funil de negócio, ela passa a exigir um campo que o formulário não mostra
   mais. Nenhuma resposta tratou disso; ver **Decisões assumidas**.
4. **Negócio que já tem valor gravado nesse campo.** O valor fica no
   `Deal.customFields`, com a chave sendo o `id` do campo, e deixa de ser
   exibido e editável pelo formulário. Nada o apaga. Isso é consequência
   aceita da resposta 2, não defeito.
5. **O bloco "Campos personalizados" não fica vazio.** Sobram 11 campos, então
   o `customFieldDefs.length > 0` de `DealForm.tsx:571` continua verdadeiro e o
   rótulo continua na tela. Quem esperava o bloco inteiro desaparecer vai se
   frustrar — e é por isso que isto está escrito aqui e no documento do
   usuário.
6. **A tela de administração continua listando o campo.** `CustomFields.tsx`
   consome o `CustomFieldsContext`, que chama `getCustomFields(true)` **sem
   entidade** (medido em 04/11/2026). Sem entidade, o `findAll` não monta o
   `OR` e devolve **todos** os campos do tenant. O campo continua aparecendo
   lá, agora com entidade `COMPANY` no banco — e a tela não mostra entidade
   nenhuma, porque o editor não tem esse controle.
7. **`src/pages/Import.tsx` também consome o contexto sem entidade**
   (`useCustomFields()` na linha 892). A importação continua vendo o campo,
   como hoje. Esta entrega não muda nada ali.

## Definição de Concluído

`<raiz>` é a raiz do clone do `vydhub/vyd-engage`. Os itens 1 a 5 são do
construtor; os itens 6 e 7 são **operacionais** (ver **Cobertura da prova**).

1. **Existe exatamente uma migração nova e nada mais.**
   `git diff --name-only origin/main...HEAD` devolve **uma única linha**, e ela
   casa `server/prisma/migrations/<carimbo>_<nome>/migration.sql` com
   `<carimbo>` > `20261031120000`.
2. **O conteúdo do `migration.sql` é o `UPDATE` do requisito 2.** Conferível
   por leitura: um `UPDATE "CustomField"`, com `t."slug" = 'k2-engenharia-e-tecnologia'`,
   `cf."name" = 'Hora do último contato'` e `cf."entity" IS NULL` nas
   condições. `grep -c "DELETE\|DROP\|ALTER\|TRUNCATE" <arquivo>` devolve `0`.
3. **A migração não tem marcador de fase depois.**
   `grep -c "publicacao: depois" <arquivo>` devolve `0`.
4. **A suíte do backend continua verde.** `cd server && npx vitest run` termina
   sem falha. Nenhum teste muda, porque nenhum código muda; o item serve para
   provar que a migração nova não quebra a inicialização do Prisma.
5. **O build do frontend e o do backend continuam passando.**
   `npm run build` na raiz e `cd server && npm run build` terminam sem erro. Se
   o ambiente do construtor barrar o `xlsx` (dependência servida por URL
   direta, fora do `registry.npmjs.org`), ele diz isso no relatório e mostra o
   contorno usado, **sem levar o contorno para o diff**.
6. **Na tela, depois da publicação:** em `https://engage.vydhub.com/app/deals`
   → **Novo negócio**, o bloco **Campos personalizados** no fim do formulário
   **não traz mais** "Hora do último contato", e **continua trazendo** os 11
   demais, inclusive "Data do último contato". O mesmo ao abrir um negócio que
   já existe para editar. **Prova operacional.**
7. **No banco, depois da publicação:** a consulta abaixo devolve uma linha com
   `entity = COMPANY`. **Prova operacional.**

   ```sql
   SELECT cf."name", cf."entity"
     FROM "CustomField" cf
     JOIN "Tenant" t ON t."id" = cf."tenantId"
    WHERE t."slug" = 'k2-engenharia-e-tecnologia'
      AND cf."name" = 'Hora do último contato';
   ```

### Cobertura da prova

O chamador real desta entrega é o **pipeline de publicação do Forge**, que
aplica a migração na produção do engage depois do merge na branch padrão. O
construtor **não pode exercitá-lo**: fazê-lo exige merge na `main`, que as
travas dele vedam, e o banco do engage não é alcançável de dentro de uma
execução.

- **Itens 1, 2, 3** — `documental`: a prova é o arquivo e o diff.
- **Itens 4, 5** — `exercitado`: comandos do próprio repositório, saída colada.
- **Item 6** — `não exercitado`. Chamador que ficou de fora: o formulário de
  negócio servido por `engage.vydhub.com` contra a produção já migrada. Motivo:
  a migração só é aplicada pela publicação, depois do merge; o preview da
  branch fala com a produção **não** migrada, e por isso mostraria o campo
  ainda ali — ver o campo no preview não reprova a entrega.
- **Item 7** — `não exercitado`. Chamador que ficou de fora: um `SELECT` na
  produção do engage. Motivo: fora do alcance de qualquer execução de rotina
  (Restrições, item 1).

**Veículo das provas operacionais, com todas as letras:** quem executa é uma
**pessoa**, depois do merge e depois de a publicação automática concluir —
abrindo a tela do item 6 e rodando a consulta do item 7 por um cliente de
banco com acesso ao Postgres do Railway. **O aceite NÃO espera por essas duas
provas:** os itens 6 e 7 não bloqueiam a aceitação da entrega, que se decide
pelos itens 1 a 5. O custo dessa escolha, dito em voz alta: a demanda pode ser
aceita e fechada **sem que ninguém tenha visto o campo sair da tela**, e se o
caso extremo 1 se realizar (`UPDATE` em zero linhas), o defeito só aparece
quando alguém abrir o formulário. A alternativa — travar o aceite até a
publicação — ocuparia a fila por uma janela que não depende do construtor, para
uma mudança de uma linha. **Se a aprovação preferir o aceite travado, é só
dizer na aprovação:** é decisão de quem aprova, não desta spec.

## Decisões assumidas

**Nenhuma pessoa respondeu nenhuma pergunta nesta demanda.** As oito respostas
da rodada 1 são da Respondedora e **todas as oito** carregam a marca
`decisão assumida pela Respondedora — rever na aprovação`. Vão reproduzidas
abaixo, uma a uma, porque é na aprovação que elas têm de ser lidas.

- **Resposta 1 — `decisão assumida pela Respondedora — rever na aprovação`.**
  *"Opção (a): o campo 'Hora do último contato' deixa de aparecer no negócio e
  continua existindo para Empresa, onde a importação gravou dados. Conferi em
  origin/main do vyd-engage: customFieldService.findAll usa where.OR = [{ entity },
  { entity: null }] (linhas 60-61), então entidade vazia vale para todas; é a
  causa do aparecimento. Escolhi a opção mais estreita: só este campo, sem
  apagar nada."* **Adotada.** O mecanismo foi reconferido em 04/11/2026 e está
  certo (o `OR` está na linha 61, dentro do bloco 58-62). A ressalva está no
  Objetivo: "continua existindo para Empresa" não quer dizer que apareça em
  Empresa — nenhuma tela de Empresa mostra campo personalizado.
- **Resposta 2 — `decisão assumida pela Respondedora — rever na aprovação`.**
  *"Não apagar a definição, então a pergunta fica sem efeito: nenhum valor
  gravado é tocado nem limpo. Se um dia a definição for apagada, vale (a):
  deixar os valores antigos onde estão, sem limpeza destrutiva."* **Adotada**
  (requisito 6, caso extremo 4).
- **Resposta 3 — `decisão assumida pela Respondedora — rever na aprovação`.**
  *"Só a 'Hora do último contato' sai do formulário de negócio. Os outros 12
  campos legados e a 'Data do último contato' ficam como estão, porque o pedido
  cita apenas a hora. Consertar o vazamento de todos os campos legados fica
  para demanda própria."* **Adotada, com a contagem corrigida:** são **11**
  outros campos, não 12 (a importação cria 12 no total — medido no Objetivo).
  **É a decisão mais provável de ser revista na aprovação**, porque quem abriu
  a demanda vai continuar vendo o bloco "Campos personalizados" com 11 campos,
  entre eles a "Data do último contato", que é o par óbvio da hora.
- **Resposta 4 — começa por "não sei" — `decisão assumida pela Respondedora —
  rever na aprovação`.** *"não sei — assumido (a)+(c). O anexo 'Captura de tela
  2026-10-09 140021.png' não foi lido (extracao_ok = false). Assumo que o campo
  aparece na janela 'Novo negócio', no bloco 'Campos personalizados' no fim do
  formulário. Como criação e edição usam o mesmo formulário, o campo sai das
  duas; não existe como tirá-lo só da criação (ver resposta sobre
  visibility)."* **Adotada.** A parte do mecanismo foi **medida e confirmada**
  em 04/11/2026: `DealForm.tsx` recebe `deal` opcional e serve criação e
  edição; o bloco e o rótulo estão em `DealForm.tsx:570-573`. A parte do print
  segue **sem confirmação humana**: o anexo não foi lido nesta execução
  tampouco.
- **Resposta 5 — começa por "não sei" — `decisão assumida pela Respondedora —
  rever na aprovação`.** *"não sei — assumido: um tenant só. Escopo: o tenant
  'k2-engenharia-e-tecnologia', onde a importação criou o campo. O conserto é
  de dado nesse tenant (ajustar a entidade do campo para Empresa), sem mudança
  de código para os demais tenants."* **Adotada.** O slug está medido no
  código (`import-bd-legacy.ts:26`). **O que fica em aberto:** nenhum outro
  tenant está protegido do mesmo vazamento, e nenhum foi verificado — não há
  como consultar o banco do engage (Restrições, item 1).
- **Resposta 6 — `decisão assumida pela Respondedora — rever na aprovação`.**
  *"Excluir pela tela não resolve bem: apagaria também o campo em Empresa, onde
  há dados. O desejado é o ajuste de dado da primeira resposta (entidade do
  campo = Empresa no tenant k2), feito como ação operacional, sem construção de
  código. Se a demanda exigir entrega de código, ela deve se limitar a esse
  ajuste."* **Adotada quanto ao conteúdo, com o veículo escolhido por esta
  spec.** A resposta queria "ação operacional, sem construção de código", e
  esta spec escolheu **a migração Prisma** como veículo do mesmo ajuste. Por
  quê: é o único caminho que leva o ajuste à produção de forma reproduzível e
  auditável — SQL digitado num console não deixa rastro no repositório, não
  sobrevive à recriação de ambiente e não passa por revisão. A migração é
  literalmente "limitar-se a esse ajuste": um `UPDATE` de uma linha, nenhum
  arquivo de código. **Se a aprovação preferir o caminho manual**, a demanda
  deve ser fechada como ação operacional, sem build — e isso precisa ser dito
  na aprovação, porque é a diferença entre haver entrega e não haver.
- **Resposta 7 — `decisão assumida pela Respondedora — rever na aprovação`.**
  *"Fica fora do escopo, para demanda própria. Conferi em origin/main que
  src/components/CustomFieldEditor.tsx não envia entity; o seletor de entidade
  no editor é demanda separada."* **Adotada.** Medido em 04/11/2026 e
  **mais largo do que a resposta diz**: quem não envia `entity` é o
  `CustomFieldsContext`, que monta os corpos de `createCustomField` e
  `updateCustomField` sem esse campo — o `CustomFieldEditor` nem chega a ter o
  controle. O efeito é o que a resposta aponta: todo campo criado pela tela
  nasce sem entidade e vaza para o formulário de negócio.
- **Resposta 8 — `decisão assumida pela Respondedora — rever na aprovação`.**
  *"'Delete-o' significa que o campo não aparece em negócio em momento nenhum,
  nem na criação nem na edição. Não tornar a coluna visibility efetiva: conferi
  em origin/main que nenhuma tela do src a lê, e fazê-la valer tocaria mais
  arquivos."* **Adotada** (Usuários, Fora do Escopo).

Decisões que esta execução tomou por conta própria, sem pergunta nenhuma por
trás:

- **A entrega é uma migração de dado, com carimbo posterior a
  `20261031120000`.** Nenhuma resposta disse em que forma o ajuste chegaria à
  produção; a resposta 6 só disse "ação operacional". A escolha e o motivo
  estão acima.
- **A guarda `entity IS NULL` entrou no `UPDATE`** sem ter sido perguntada.
  Motivo: torna a migração idempotente e impede que ela sobrescreva uma
  entidade que alguém venha a escolher pela tela antes de a migração rodar.
- **O aceite não espera pelas provas operacionais** (itens 6 e 7). Ninguém
  perguntou isso. O custo está escrito com todas as letras em **Cobertura da
  prova**, e a aprovação pode inverter a escolha.
- **O caso extremo 3 — `StageRequiredField` apontando para este campo — não foi
  verificado e não virou requisito.** Não há como consultar o banco do engage.
  Se existir uma exigência de coluna de funil sobre a "Hora do último contato",
  depois desta entrega ela exigirá um campo que o formulário de negócio não
  mostra mais, e o negócio pode ficar impossível de avançar nessa coluna.
  **É o único risco de regressão desta spec**, e está declarado em vez de
  silenciado. Fechá-lo exigiria ou consultar o banco (impossível aqui) ou
  alargar a entrega para tratar `StageRequiredField` (o que contraria o
  recorte estreito da resposta 1).
- **"Hora do último contato" foi tratada como campo de Empresa**, e não de
  Contato nem de Produto. Base: o `COMPANY_MAPPING` do
  `import-bd-legacy.ts` (a partir da linha 48) mapeia a coluna
  `Hora do último contato` da planilha `BD - Empresas.xls` na linha 61, e o
  bloco `CUSTOM_FIELDS` a lista na linha 36, sob o comentário `// Empresa` da
  linha 32 (medido em 04/11/2026).
- **O nome do campo foi tomado do código, não do print.** O anexo não foi
  lido. Se o nome na produção divergir de `Hora do último contato` por um
  caractere, cai o caso extremo 1.
