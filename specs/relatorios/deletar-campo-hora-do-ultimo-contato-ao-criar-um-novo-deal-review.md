---
forge_id: FRG-175
veredicto: aprovado
---
# Revisão independente — FRG-175

<!-- forge:medicoes -->
```
$ date -u
Wed Nov  4 17:11:12 UTC 2026
$ date -u
Wed Nov  4 17:16:05 UTC 2026
```
Medições rodadas em 04/11/2026, entre 17:11 e 17:16 UTC, contra a `origin/main 27e53bb6c20d6125787929d3332aae7211d85a2d` do `vydhub/vyd-engage`.
<!-- /forge:medicoes -->

Revisão independente: não construí nada, não li o raciocínio do construtor e refiz as medições com captura própria. O relatório de build foi lido só para saber onde desconfiar.

**Veredicto: ✅ APROVADO**

## O que medi

- Diff (`git diff --name-only origin/main...HEAD`): a migração `20261104170000_frg175_hora_ultimo_contato_entidade_empresa/migration.sql` (carimbo > `20261031120000`) e o `-build.md`. Nenhum TS, React nem schema mudou.
- Conteúdo da migração: um `UPDATE "CustomField"` com `t."slug" = 'k2-engenharia-e-tecnologia'`, `cf."name" = 'Hora do último contato'` e `cf."entity" IS NULL`. `grep -c "DELETE\|DROP\|ALTER\|TRUNCATE"` devolveu 0 e `grep -c "publicacao: depois"` devolveu 0.
- Premissas contra o código: `CustomFieldEntity` tem `COMPANY` (`schema.prisma:2131-2136`); `Tenant.slug` existe; o slug e o nome do campo batem com `server/scripts/import-bd-legacy.ts` (linhas 26 e 36). `customFieldService.findAll` (linhas 52-65) devolve `OR [{entity}, {entity:null}]`, e `DealForm.tsx` pede `getCustomFields(true, 'DEAL')`. Com `entity = COMPANY`, o campo sai do formulário de negócio.
- Fluxo de controle até o efeito: formulário → `getCustomFields(true,'DEAL')` → `findAll` com a cláusula `OR`. Não há `return` nem filtro a montante que desvie o caminho.
- Semântica do SQL, em transação com tabelas temporárias e enum temporário (`begin; … rollback;`, banco do Forge, nada persistiu), com quatro linhas de fixture. Só a "Hora" do tenant k2 com `entity` nulo virou `COMPANY`. A "Data do último contato" ficou nula, a "Hora" de outro tenant ficou nula e a "Hora" do k2 já com `DEAL` não foi sobrescrita (guarda de idempotência).
- Classificador: `conferir-pr --base origin/main --raiz /home/user/vyd-engage`, ferramenta fixada em `5e47776522b51f9a06ae7d6ac883e71c4da711e7` (o `FERRAMENTA_REF` do workflow do engage). Saiu 0: "conferência da PR: nada a apontar", com a suposição "supus schema com o nome do papel existe → false", irrelevante para um `UPDATE`. O manifesto tem `"ativa": true` e o engage é Prisma, então nada foi aplicado por mim nem pelo construtor. Quem aplica é a publicação depois do merge.
- Banco do Forge: `select * from forge.demandas_em_voo` listou FRG-169 (vyd-desk) e a própria FRG-175, ambas em `em_review`. O digest do schema `public`, medido com a consulta exata, deu `38578e8a50af605a85504de23684f670` / 1010 itens, e não o `cbe009cc82f2b619aaf6cc6faa334938` / 993 da rotina. Esta entrega é do engage e não toca o Forge, então a divergência vem da evolução do banco (outras demandas já mergeadas) e a linha de base citada na rotina está velha. Registro, não reprovo.
- Impacto nas rotinas: `git diff origin/main...HEAD --stat -- docs/rotinas/` está vazio, e a entrega não toca função `forge.*`. Coerente.

## Provas da rotina

npm run check:colors && npm run lint:css — exit 0 — 2026-11-04T17:12:23Z
npm test — exit 0 — 2026-11-04T17:12:42Z
npm run typecheck:ci — exit 0 — 2026-11-04T17:13:10Z
npm run build — exit 0 — 2026-11-04T17:13:41Z
cd server && npm run build — exit 0 — 2026-11-04T17:14:43Z
cd server && npm test — não executável neste ambiente — o script é vitest em modo watch e não termina; com npx vitest run (2026-11-04T17:15:07Z) 878 testes passam e 69 falham, todos com "Environment variable not found: DATABASE_URL", sem banco neste ambiente
merge origin/main — 27e53bb6c20d6125787929d3332aae7211d85a2d — 2026-11-04T17:15:44Z
PR: nenhuma

## Cobertura da prova

Itens numerados na ordem da Definição de Concluído da spec.

1. documental — o diff tem a migração nova (carimbo `20261104170000`) e, além dela, só o relatório de build em `specs/relatorios/`. Conferi com `git diff --name-only origin/main...HEAD`.
2. documental — o `migration.sql` é o `UPDATE` do requisito 2. Reexercitei a semântica em `begin; … rollback;` com fixtures próprias, e o `grep` de termos destrutivos devolveu 0.
3. documental — o `grep -c "publicacao: depois"` devolveu 0 e o `conferir-pr` saiu 0, rodado por mim.
4. não reexercitado — chamador de fora: suíte do servidor contra um Postgres. Motivo: sem `DATABASE_URL` aqui, os mesmos 69 testes falham antes de tocar na migração, e 878 passam, o que confere com o construtor. Isso pesa pouco: nenhum código mudou, a suíte nunca carrega o `migration.sql` e a falha é de ambiente.
5. exercitado — `npm run build` e `cd server && npm run build` saíram 0 na minha execução (saídas na seção "Provas da rotina").
6. não reexercitado — chamador de fora: formulário de negócio em `engage.vydhub.com` com a produção já migrada. Motivo: só existe depois do merge e da publicação. Li o caminho de código até o filtro por entidade (ver acima), mas não vi a tela. É prova operacional, e a spec diz que ela não bloqueia o aceite.
7. não reexercitado — chamador de fora: `SELECT` na produção do engage. Motivo: o banco do engage não é alcançável desta execução. A premissa de que o campo existe com `entity` nulo no tenant k2 é inferência de código. Se ela falhar, o `UPDATE` afeta zero linhas, sem erro e sem efeito, e a spec já declara esse custo.

Peso dos três `não reexercitado`: a spec os previu e os tirou do critério de aceite. Os itens 1 a 5 bastam para o ✅. Fica para a operação, depois da publicação, abrir **Novo negócio** e rodar a consulta do item 7.

## Achados

Confirmo o que o construtor relatou, medido de forma independente. Não encontrei defeito nem corrigi nada. Duas observações que não reprovam:

- O `StageRequiredField` apontando para este campo continua sem verificação, e ninguém consegue verificá-lo daqui. A spec o deixou como caso extremo, sem requisito.
- A spec foi escrita com decisões assumidas pela Respondedora, não por uma pessoa (ver "Decisões assumidas"). A aprovação é de quem aceita a entrega, e não minha.

## Conferente de horário

```
$ node scripts/conferir-horarios.mjs --raiz /home/user/vyd-engage specs/relatorios/deletar-campo-hora-do-ultimo-contato-ao-criar-um-novo-deal-review.md
Wed Nov  4 17:16:10 UTC 2026
conferir-horarios: limpo (1 arquivo(s))
```
