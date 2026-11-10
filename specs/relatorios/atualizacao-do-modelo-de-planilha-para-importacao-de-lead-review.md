---
forge_id: FRG-178
veredicto: aprovado
---
# Revisão — FRG-178 — modelo de planilha de importação de leads

Revisão **independente** (rotina Revisora, sessão distinta da do Build). Repositório `vydhub/vyd-engage`, branch `forge/frg-178-atualizacao-do-modelo-de-planilha-para-importacao-de-lead`, comparada com a `origin/main` `87a2e834f58612b622af747628e4101f8a5ce737`.

<!-- forge:medicoes -->
```
$ date -u
Wed Nov  4 23:11:36 UTC 2026
$ date -u
Wed Nov  4 23:19:07 UTC 2026
```
Medições rodadas em 04/11/2026, entre 23:11 e 23:19 UTC, contra a `origin/main` `87a2e834f58612b622af747628e4101f8a5ce737` do `vydhub/vyd-engage`.
<!-- /forge:medicoes -->

## O que medi

Li a spec (Requisitos 1–11 e Definição de Concluído) e o diff inteiro (`git diff origin/main...HEAD`: 9 arquivos, rota, tela, cliente, dois exports em `importService.ts`, comentário em `leadService.ts`, três arquivos de teste). Só depois li o relatório de build, como hipótese. Os portões saem de `forge.repos.portao_comandos` do vyd-engage, rodados por mim.

- **Território (Req. 11):** só arquivos da tabela do território; `git diff --name-only origin/main...HEAD -- server/prisma/` não lista nada (item 10). Sem migration, então o classificador de publicação (`.forge/publicacao.json` existe) não tem arquivo para julgar; não o rodei por isso.
- **Base de comparação:** os 69 testes do servidor que falham (`auth`, `automations`, `funnels`, `leads`, `tasks` — precisam de Postgres) e os erros de lint (9 na raiz, 2 no servidor) são **idênticos na origin/main** (medido em worktree dela: 69 falhas; 9 e 2 erros). A entrega acrescenta 45 testes que passam (878 → 923) e 2 avisos de lint no servidor, nenhum erro.
- **Teste contra o código velho:** com `server/src/routes/leads.ts` da origin/main e o teste da branch, `leadsImport.test.ts` falha em 16 casos, inclusive o da medição 5 (400 / `imported: 0`). Com o arquivo da branch, 19/19 passam. Arquivo restaurado, árvore limpa.
- **Fixtures próprias** (arquivo temporário, depois apagado, não commitado), pela cadeia HTTP real (auth → CSRF → permissão → schema por linha → resolução → `leadService.create`), Prisma mockado. Não há banco nem fixture persistida: zero resíduo por construção e a faixa `number >= 90000` não se aplica. Resultados:
  - modelo antigo de 6 colunas (`WEBSITE`/`NEW`, `REFERRAL`/`CONTACTED`): 200, nenhuma importada, as duas linhas em `errors` com os números 1 e 2 (quebra de compatibilidade declarada, Req. 4);
  - contato com o e-mail certo mas de **outra empresa**: recusado;
  - empresa pela fantasia (`abc`), contato pelo nome com espaços e acento, status `em andamento`, origem `EVENTO/FEIRA SETORIAL`, `R$ 1.234,56`, responsável em caixa mista: cria com `companyId`, `contactId`, `EM_ANDAMENTO`, `EVENTO_FEIRA_SETORIAL`, `1234.56`, `assignedTo` = uuid; `estimated_value` numérico (5000) e `probability_go_get` 0 passam; sem responsável, `assignedTo` ausente;
  - `Pausado` sem motivo e `Cancelado`+`Outro` sem nota recusados com as mensagens de `assertStatusReason`; `70.5` e `101` recusados; responsável desconhecido recusado; linhas numeradas certo (2 a 6) e a válida entra;
  - e-mail repetido dentro do arquivo: a segunda é **pulada**, não erro.
- **Nota sobre o CNPJ:** com `company_cnpj` preenchido e `company` sem nenhuma empresa de mesmo nome, a linha entra pelo CNPJ (precedência do Req. 4); só recusa quando o nome casa **outra** empresa. Está de acordo com a spec; registro para quem ler o relatório de erros.
- **Fluxo de controle até a chamada:** a validação por linha (`safeParse` no laço), a pré-resolução em lote e o laço de criação são sequenciais sem `return` a montante; o único `break` é o do limite do plano, que preserva o contrato antigo. Lido de ponta a ponta, não só as funções chamadas.
- **Tela:** `LeadImportModal.test.tsx` (5 testes) passa no `npm test`; o modelo tem 17 títulos na ordem do Req. 1, a linha de exemplo tem 17 campos, `grep -c "WEBSITE\|NEW"` devolve 0, e o aviso do passo de conferência e o relatório de erros do passo final existem no código.

## Conferência de horários

```
conferir-horarios: limpo (1 arquivo(s))   # exit 0
```

## Achados

Confirmo o que o construtor relatou, medido de forma independente. Nenhum defeito que quebre requisito da spec; nada corrigido por mim. Não corrigi nada, então não houve commit meu além do merge da `origin/main` (que já estava em dia).

Pendência declarada pela própria spec, que **não pesa** no aceite: o item 8 (prova de campo, por pessoa, em produção) é conferência posterior.

## Provas da rotina

npm run check:colors && npm run lint:css — exit 0 — 2026-11-04T23:13:12Z
npm test — exit 0 — 2026-11-04T23:13:30Z
npm run typecheck:ci — exit 0 — 2026-11-04T23:13:56Z
npm run build — exit 0 — 2026-11-04T23:14:30Z
npm run lint — exit 1 — 2026-11-04T23:15:01Z
cd server && npm run lint — exit 1 — 2026-11-04T23:15:08Z
cd server && npm run build — exit 0 — 2026-11-04T23:15:34Z
cd server && npm test — não executável neste ambiente — o script é Vitest em watch; rodei `npx vitest run`: exit 1 às 2026-11-04T23:15:57Z, 69 falhas idênticas às da origin/main (precisam de Postgres), 923 testes passando
merge origin/main — 87a2e834f58612b622af747628e4101f8a5ce737 — 2026-11-04T23:19:03Z
PR: nenhuma

## Cobertura da prova

Itens numerados como na Definição de Concluído da spec.

1. exercitado — o modelo (`grep -n "const headers"`) e `grep -c` = 0, rodados por mim.
2. exercitado — reexercitado pela cadeia HTTP real (origem/status por rótulo e legado, `70.5`/`101` recusados, `R$ 1.234,56` e número → valor correto) e pelo `importLeadPayload.test.ts` (26 passando em `npx vitest run`).
3. exercitado — `leadsImport.test.ts` passa na branch e falha 16 casos contra a `leads.ts` da origin/main (mecanismo: `git checkout origin/main -- server/src/routes/leads.ts`, depois restaurado).
4. exercitado — vínculo por nome, fantasia, CNPJ, contato de outra empresa e sem empresa, na minha rodada HTTP.
5. exercitado — responsável em caixa mista, desconhecido e vazio, na minha rodada HTTP.
6. exercitado — `Pausado` sem motivo e `Outro` sem nota, na minha rodada HTTP.
7. exercitado — `LeadImportModal.test.tsx` roda no `npm test` (5 passando); renderização no navegador real não reexercitada por mim.
8. não reexercitado — prova de campo por pessoa em produção, fora do alcance desta rotina e declarada pela spec como posterior ao aceite; não trava o ✅.
9. exercitado — portões obrigatórios do cadastro com exit 0; lint e testes do servidor com falha idêntica à origin/main.
10. exercitado — `git diff --name-only origin/main...HEAD -- server/prisma/` vazio.

**Veredicto: ✅ APROVADO**
