# Build — FRG-178 — modelo de planilha de importação de leads com todos os campos

Branch: `forge/frg-178-atualizacao-do-modelo-de-planilha-para-importacao-de-lead`, a partir da
`origin/main` `87a2e834f58612b622af747628e4101f8a5ce737`. Rotina de Build, execução nova (claim_next), repositório
`vydhub/vyd-engage`.

<!-- forge:medicoes -->
```
$ date -u
Wed Nov  4 22:29:39 UTC 2026
$ date -u
Wed Nov  4 22:56:33 UTC 2026
```
Medições rodadas em 04/11/2026, entre 22:29 e 22:56 UTC, contra a `origin/main` `87a2e834f58612b622af747628e4101f8a5ce737` do `vydhub/vyd-engage`.
<!-- /forge:medicoes -->

Conferente de horário (`specs/spec-sem-horario-inventado.md`), rodado do clone do vyd-forge com `--raiz` (o engage não
tem o script):

```
$ node /home/user/vyd-forge/scripts/conferir-horarios.mjs --raiz /home/user/vyd-engage \
    specs/relatorios/atualizacao-do-modelo-de-planilha-para-importacao-de-lead-build.md

Wed Nov  4 22:56:50 UTC 2026
conferir-horarios: limpo (1 arquivo(s))
```

## O que a entrega faz

- `src/components/leads/LeadImportModal.tsx`: modelo com **17 colunas** (as 6 de hoje primeiro, mesmo nome), exemplo com valores
  reais (BOM no arquivo para o Excel ler os acentos); mapeamento das 17 colunas com reconhecimento automático do título em inglês
  **e** do rótulo da tela em português (título exato primeiro, regras antigas depois para o que sobrar); `SOURCE_MAP` removido;
  aviso **antes** de confirmar quando faltam as colunas de empresa/contato; teto de 1000 linhas dito na tela (e botão
  bloqueado acima dele); passo final com a **lista de erros** (linha + motivo).
- `server/src/routes/leads.ts`: `importLeadSchema` exportado e ampliado (rótulo da tela, código interno e código legado, sem
  caixa/acento); **validação por linha** (célula ruim recusa a linha, o contrato `{imported, skipped, failed, errors}` não muda);
  Empresa/Contato/Responsável resolvidos **em lote** contra o que já existe; ambiguidade, discordância CNPJ×nome, contato de outra
  empresa e ausência recusam a linha.
- `server/src/services/importService.ts`: **só** `export` em `normalizeName` e `normalizeCnpj`.
- `server/src/services/leadService.ts`: **só** o comentário de `create` (Restrição 7).
- `src/services/api/client.ts`: tipo de retorno de `importLeads` carrega `failed` e `errors`.
- Testes: `server/src/__tests__/unit/importLeadPayload.test.ts`, `server/src/__tests__/http/leadsImport.test.ts`,
  `src/components/leads/LeadImportModal.test.tsx`.

Régua reaproveitada, não reescrita (Restrição 8): `assertOpportunityLinks` e `assertStatusReason` (via `leadService.create`),
`parseBrNumber`, `normalizeLeadStatus`/`normalizeLeadSource`, `normalizeName`/`normalizeCnpj`.

## Migrations

Nenhum arquivo de migration na entrega (`git diff --name-only origin/main...HEAD -- server/prisma/` devolve vazio, 0 linhas).
Fase antes/depois, aplicação no banco e classificador: **não se aplicam** (nada para classificar). Edge: nenhuma.

## Janela de convivência (Restrição 3)

Declarado, nada a codificar: assim que a API nova subir, uma importação feita pela tela **antiga** (sem as colunas de vínculo)
tem **todas** as linhas recusadas, com `failed` e `errors` na resposta; não há perda de dado nem falha silenciosa. A tela nova
contra a API antiga: as colunas novas são ignoradas pelo `z.object` antigo.

## Autoavaliação (D15)

Rubrica gravada em commit próprio antes do código (seção abaixo). Nota minha, contra a tabela, sem terceiro avaliador.

| Versão | Nota | O que pesou |
|---|---|---|
| v1 (primeiro rascunho que passava nos testes) | 84 | Mensagens de recusa que contêm "limit" (ex.: empresa "Limited") caíam no `break` do limite do plano; consulta de contatos pegava todas as empresas do tenant, não só as resolvidas; `response?.data` com erro de tipo; cabeçalho do modelo quebrado em duas linhas pelo Prettier (contra o DoD 1); Prettier reformatou linhas alheias em `leads.ts`. |
| v2 | 92 | Corrigidos: `LinhaRecusada` isenta a recusa de conteúdo do teste de "limit"; contatos só das empresas resolvidas de linhas não duplicadas; tipo; `// prettier-ignore` no cabeçalho; reformatação alheia revertida; teste extra dos rótulos em português. |
| v3 | 92 | Nada a corrigir que mudasse a nota; os pontos abaixo são fronteira declarada, não conserto. |

Parou em 92 porque o que sobra não se resolve aqui. Pontos fracos, sem maquiagem:

1. **DoD 8 não foi provado** (R10, −0): é prova de pessoa em produção; nenhum teste alcança o tenant real nem diz se os contatos da planilha dela estão cadastrados.
2. **O Postgres não rodou.** Os testes HTTP usam Prisma mockado (o veículo que a spec nomeou). Nenhum SQL real da resolução em lote foi executado. (R8, −1)
3. **Numeração da linha no relatório de erros:** o número é a posição entre as linhas **enviadas**. A tela descarta linhas sem nome antes de enviar, então, se houver linha sem nome no meio, o número é menor que a linha da planilha. A spec pede "o número da linha" e o teste 7 fixa `row: 3` renderizado, por isso não traduzi no navegador; a tela diz que "a linha conta as linhas enviadas, depois do cabeçalho". (R7, −1)
4. **Aviso da conferência é por coluna, não por célula:** avisa quando a coluna de empresa/contato não está mapeada; linha com célula vazia só é recusada pelo servidor. É o que o Requisito 8 pede, mas a pessoa só descobre as linhas ruins depois. (R7, −1)
5. **Régua duplicada em dois pontos pequenos** (R4/R6, −2): a faixa 0–100 da probabilidade foi reimplementada num regex em vez de reusar o `createLeadSchema`, que valida número já convertido e não texto de célula; e os rótulos de origem existem agora no servidor (`LEAD_SOURCE_LABELS_IMPORT`) além do `src/types/index.ts`, porque o servidor não tinha essa tabela e a spec manda aceitar o rótulo da tela. Se um rótulo mudar, os dois lugares mudam.
6. **A busca de empresas lê todas as empresas não apagadas do tenant** (4 colunas), uma vez por arquivo, e casa em memória, porque CNPJ e nome normalizados não dão para pesquisar em SQL. Funciona para tenant de milhares; não foi medido com dezenas de milhares.
7. **`estimated_value` só com símbolo (`R$`) vira ausente**, como o caso extremo 10 manda; valor com dígito que não vira número (`1.2.3`) eu recuso a linha, o que a spec não diz mas é o lado seguro.
8. Portões **não obrigatórios** vermelhos, todos já vermelhos na `origin/main` (ver Provas): lint da raiz (9 erros em 7 arquivos que não toquei), lint do servidor (2 erros em `copilotService.ts` e `taskService.ts`) e `npm test` do servidor (69 testes de `auth`, `automations`, `funnels`, `leads`, `tasks`, que exigem Postgres/Redis: `DATABASE_URL` ausente, `ECONNREFUSED 127.0.0.1:6379`). Medi os mesmos 69 testes contra os arquivos da `origin/main`: mesma falha, 69 de 69.
9. `npm run typecheck:ci` diz 250 erros contra baseline 263 (desce 13). Não mexi no baseline (`scripts/typecheck-ratchet.mjs` está fora do território).

## Para quem pediu

**O que foi feito.** O botão **Baixar Template** da tela Leads → Importar Leads agora entrega uma planilha com **17 colunas**: as 6 de
antes (nome, e-mail, telefone, empresa, origem, status) mais CNPJ da empresa, e-mail e nome do contato, cargo, motivo, nota do motivo,
informações da oportunidade, valor estimado, prazo estimado, probabilidade Go×Get e e-mail do responsável comercial. A importação passou a
**usar** essas colunas ao criar o lead, e o que antes era descartado em silêncio (o status) agora é gravado.

**O que muda para quem usa.**
- **Empresa e Contato são obrigatórios e precisam já estar cadastrados.** A importação não cria nenhum dos dois. Planilha antiga, só com as 6
  colunas, passa a ter **todas** as linhas recusadas, e a tela avisa isso **antes** de você confirmar.
- **Uma linha ruim não derruba mais o arquivo.** Antes, uma única origem ou status inválido fazia a importação inteira falhar sem entrar nenhum
  lead (o próprio modelo antigo fazia isso, com `WEBSITE` e `NEW`). Agora entram as linhas boas, e o resultado traz a **lista de erros** com
  a linha e o motivo.
- Origem, Status e Motivo aceitam o nome como aparece na tela ou o código, sem importar maiúsculas e acentos; os códigos antigos
  (`WEBSITE`, `NEW` etc.) são traduzidos, então a planilha velha salva no seu computador deixa de travar por isso. Vazio entra como "Novo" e "Outros".
- Status Pausado, Cancelado e Encerrado exigem o motivo (e a nota quando o motivo é "Outro"), com as mesmas mensagens da tela de criação.
- Valor estimado aceita `1.234,56`, `1234.56` e `R$ 1.234,56`. Probabilidade é inteiro de 0 a 100, sem `%`.
- O teto continua sendo 1000 linhas por arquivo, e a tela passa a dizer isso (e bloqueia o envio acima dele).
- Janela curta durante a publicação: enquanto o servidor novo estiver no ar e a tela antiga ainda for a que está aberta no seu navegador, uma
  importação feita por ela terá todas as linhas recusadas (mensagem clara, nenhum dado perdido). Recarregar a página resolve.

**O que ficou em aberto.**
- **A conferência de campo, com a sua planilha de verdade em produção, não foi feita** e não podia ser: o ambiente de construção não
  alcança o banco do engage. Se muitos contatos da sua planilha não estiverem cadastrados, muitas linhas serão recusadas, e a conclusão será
  o pedido separado de criar empresa/contato durante a importação.
- A lista de campos veio do código da tela de criação, **não da imagem que você anexou** (o sistema não conseguiu lê-la). Vale conferir as 17
  colunas contra a imagem.
- O número da linha no relatório de erros conta as linhas enviadas (sem o cabeçalho); linha sem nome é descartada antes do envio e desloca a contagem.
- Etiquetas e campos personalizados continuam fora do modelo, e a outra tela de importação (Configurações → Importar Dados) não foi tocada.

## Provas da rotina

npm run check:colors && npm run lint:css — exit 0 — 2026-11-04T22:51:54Z
npm test — exit 0 — 2026-11-04T22:52:19Z
npm run typecheck:ci — exit 0 — 2026-11-04T22:52:56Z
npm run build — exit 0 — 2026-11-04T22:53:35Z
npm run lint — exit 1 — 2026-11-04T22:54:14Z
cd server && npm run lint — exit 1 — 2026-11-04T22:54:23Z
cd server && npm run build — exit 0 — 2026-11-04T22:54:57Z
cd server && npm test — exit 1 — 2026-11-04T22:55:28Z
merge origin/main — 87a2e834f58612b622af747628e4101f8a5ce737 — 2026-11-04T22:48:48Z
PR: nenhuma

(Os quatro primeiros são obrigatórios e saíram 0. Os quatro seguintes são não obrigatórios; `npm run lint`, `cd server && npm run lint` e
`cd server && npm test` saíram não zero por defeitos que já existem na `origin/main`, detalhados na Autoavaliação, ponto 8. O `npm test` do
servidor foi rodado como `CI=true npm test`, porque o script é `vitest` em modo watch. Os testes novos do servidor, rodados à parte com
`npx vitest run`: 26 em `importLeadPayload`, 19 em `leadsImport`, junto dos 24 e 17 de `createLeadPayload` e `leadsCreate`: 86 de 86.)

## Cobertura da prova

Os itens seguem a numeração de 1 a 10 da Definição de Concluído da spec.

1. exercitado — `grep -n "const headers"` mostra o cabeçalho de 17 títulos em linha única começando por `name,email,phone,company,source,status` (linha 187 de `LeadImportModal.tsx`; contei 17 campos separados por vírgula); `grep -c "WEBSITE\|NEW" src/components/leads/LeadImportModal.tsx` devolve `0`.
2. exercitado — `server/src/__tests__/unit/importLeadPayload.test.ts` importa o `importLeadSchema` exportado da rota: 26 testes passam, cobrindo as 17 colunas, os três formatos de origem/status, `Carta pombo`, `70%`/`70,5`/`70`, `R$ 1.234,56`/`1234.56` → `1234.56`.
3. exercitado — veículo nomeado pela spec (supertest sobre o app Express completo, Prisma mockado, sem Postgres): `leadsImport.test.ts` "origem inválida na linha 1 e linha 2 válida" responde 200, `imported: 1`, `failed: 1`, `errors[0].row === 1`. O SQL real não rodou.
4. exercitado — mesmo veículo: empresa pelo nome + contato pelo e-mail criam com `companyId`/`contactId` (asserção sobre o `data` de `prisma.lead.create`, dentro de `leadService.create`); sem `company` recusa com a linha 2; duas empresas com o mesmo nome recusam; também CNPJ×nome divergentes, contato de outra empresa e resolução em lote (1 consulta de empresas, 1 de contatos).
5. exercitado — mesmo veículo: `assigned_to_email` vira `assignedTo` com o uuid; desconhecido recusa; vazio cria sem responsável.
6. exercitado — mesmo veículo: `Pausado` sem motivo recusa com `Informe o motivo para pausar, cancelar ou encerrar o lead`; motivo `Outro` sem nota com `Descreva o motivo quando selecionar "Outro"`; com motivo e nota é criada com `statusReason` e `statusReasonNote`.
7. exercitado — `src/components/leads/LeadImportModal.test.tsx` (jsdom, `apiClient.importLeads` mockado): com `errors: [{ row: 3, error: 'Empresa não encontrada' }]` o passo final renderiza `3` e `Empresa não encontrada`; mais o aviso da conferência, o payload enviado e o reconhecimento dos rótulos em português. 5 testes passam.
8. não exercitado — chamador de fora: a pessoa solicitante, no `engage.vydhub.com` com a planilha real (prova operacional, depois do merge e da publicação; a spec diz que o aceite não espera por ela).
9. exercitado — saídas na seção "Provas da rotina": `cd server && npx vitest run` dos testes do servidor que esta demanda tocou passa (86 de 86); `npm test` da raiz 177 de 177; `npm run build` da raiz e `cd server && npm run build` saem 0; o `npm run lint` da raiz sai 1 por 9 erros em 7 arquivos que a demanda não tocou (`check:colors` e `lint:css`, que provam a Restrição 6, saem 0). A suíte inteira do servidor tem 69 falhas que já existem na `origin/main` (Postgres/Redis ausentes).
10. exercitado — `git diff --name-only origin/main...HEAD -- server/prisma/ | wc -l` devolve `0`.

Regra do teste contra o código velho. Mecanismo declarado: **cópia** — restaurei `server/src/routes/leads.ts` e `src/components/leads/LeadImportModal.tsx` da `HEAD` anterior à mudança (`git show HEAD:<arquivo> > <arquivo>`), rodei os testes novos e devolvi a versão nova.

```
# contra o leads.ts antigo (importLeadSchema nem era exportado):
 Tests  42 failed | 3 passed (45)      # leadsImport.test.ts + importLeadPayload.test.ts (45 testes na época)
# contra o LeadImportModal.tsx antigo:
 Tests  3 failed | 1 passed (4)        # LeadImportModal.test.tsx (4 testes na época; o 5º nasceu depois)
```

Os 3 do servidor que passam contra o código velho são os que provam o que não mudou (por exemplo, mais de mil linhas continua 400). O 5º teste da tela
(rótulos em português) nasceu depois dessa medição e não foi rodado contra o código velho.

## Rubrica (gravada ANTES do código, em commit próprio — commit 7ea7bdc)

Nota 0–100. Cada critério vale o que está entre parênteses; a nota só pode ser dada contra esta tabela.

| # | Critério | Pontos |
|---|---|---|
| R1 | Modelo com 17 colunas na ordem do Req. 1, exemplo sem os códigos antigos (DoD 1) | 8 |
| R2 | Origem/Status/Motivo aceitam rótulo, código e legado, sem caixa/acento; vazio assume padrão; não reconhecido recusa a LINHA (Req. 2, 6) | 12 |
| R3 | Uma célula ruim recusa só a linha; resposta mantém `{imported, skipped, failed, errors}` (Req. 7, DoD 3) | 14 |
| R4 | Empresa/Contato resolvidos em lote contra registros existentes; ambiguidade, discordância CNPJ×nome e ausência recusam a linha (Req. 4, casos 1,3,4,5,6,7) | 16 |
| R5 | Responsável só por e-mail: vazio entra sem, desconhecido recusa (Req. 5) | 6 |
| R6 | Valor e probabilidade nos formatos do Req. 9, reuso de `parseBrNumber` (sem reescrever régua — Restrição 8) | 8 |
| R7 | Tela: mapeia 17 colunas, autodetecta título EN e rótulo PT sem quebrar planilha antiga, aviso antes de confirmar, teto de 1000, lista de erros no passo final (Req. 3, 8) | 14 |
| R8 | Testes DoD 2–7 escritos nos moldes existentes, e cada teste de correção falha contra o código velho | 12 |
| R9 | Território respeitado, zero migração, sem cor literal, marcação nova com tokens (Req. 11, Restrições 2 e 6) | 5 |
| R10 | Relatório honesto: o que não foi provado (DoD 8 é de pessoa), divergências declaradas | 5 |

Descontos automáticos: gate obrigatório vermelho = nota máxima 60; qualquer arquivo fora do território = −10; régua de validação copiada para dentro do importador = −10.
