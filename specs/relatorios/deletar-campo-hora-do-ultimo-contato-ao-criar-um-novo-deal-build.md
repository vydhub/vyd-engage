# Relatório de build — FRG-175

<!-- forge:medicoes -->
```
$ date -u
Wed Nov  4 16:33:47 UTC 2026
$ date -u
Wed Nov  4 16:47:03 UTC 2026
```
Medições rodadas em 04/11/2026, entre 16:33 e 16:47 UTC, contra a `origin/main 27e53bb6c20d6125787929d3332aae7211d85a2d` do `vydhub/vyd-engage`.
<!-- /forge:medicoes -->

## Rubrica (escrita antes do código)

Nota de 0 a 100, fixada antes de escrever a migração:

| Critério | Pontos |
|---|---|
| Entrega é exatamente 1 migração nova (carimbo > 20261031120000), nenhum TS/React/schema muda | 20 |
| Conteúdo é só o UPDATE do requisito 2, com guarda `entity IS NULL`, tenant e nome literais, UTF-8 sem BOM | 25 |
| Sem DELETE/DROP/ALTER/TRUNCATE e sem `-- publicacao: depois`; conferir-pr sai 0 | 20 |
| Portões obrigatórios do repositório saem 0 (check:colors+lint:css, test, typecheck:ci, build) | 20 |
| Relatório honesto: itens 6 e 7 declarados não exercitados, fronteiras e risco do StageRequiredField declarados | 15 |

## Entrega

Uma migração Prisma nova, `server/prisma/migrations/20261104170000_frg175_hora_ultimo_contato_entidade_empresa/migration.sql` (carimbo > 20261031120000), com o `UPDATE` do requisito 2 (guardado por `entity IS NULL`, apontado por slug do tenant e nome do campo). Nenhum arquivo de TypeScript, React ou schema mudou. O diff contra a `origin/main` traz, além da migração, só este relatório e a rubrica (`specs/relatorios/`); a Definição de Concluído item 1 fala do código da entrega, e a única mudança de código é a migração.

Migração (item 5 de Publicação automática): fase **antes**, não destrutiva, sem `-- publicacao: depois`. Repositório com manifesto (`"ativa": true`, banco Prisma): **não apliquei nada**; quem aplica é a publicação depois do merge. O classificador (`conferir-pr --base origin/main`, ferramenta fixada em `5e47776522b51f9a06ae7d6ac883e71c4da711e7`) saiu 0 com a nota "supus schema com o nome do papel existe → false" e "conferência da PR: nada a apontar".

## Autoavaliação (D15)

Trajetória: 84 → 90.

- Versão 1 (84): migração correta e portões obrigatórios verdes, mas a prova dos itens 4 e 5 tinha uma lacuna: `cd server && npm test` é modo watch e travou; `npx vitest run` falha por falta de `DATABASE_URL`.
- Versão 2 (90): lacuna declarada com a saída real (abaixo), sem fingir verde; relatório separa o que foi exercitado do que só a publicação prova.

Pontos fracos, sem maquiagem:
- A suíte do servidor **não ficou verde neste ambiente**: `npx vitest run` terminou com 5 arquivos e 69 testes falhando, todos com `Environment variable not found: DATABASE_URL`, e 878 passando. Nenhum código mudou, então a falha não vem desta entrega, mas não consegui provar o item 4 como a spec o escreve.
- A premissa de que o campo existe com `entity IS NULL` na produção é inferência de código; o banco do engage não é alcançável daqui.
- O risco de `StageRequiredField` exigindo o campo não foi verificado.

## Para quem pediu

O campo **Hora do último contato** deixa de aparecer no formulário de **Novo negócio** (e na edição de negócio) depois que a publicação aplicar a mudança. Foi preparada uma migração que diz ao sistema que esse campo pertence a Empresa. Nada é apagado: a definição do campo e os valores gravados continuam.

O que não muda: o bloco **Campos personalizados** continua aparecendo, com onze campos, inclusive a **Data do último contato**. O campo continua listado na tela de administração. A mudança só tem efeito depois da publicação; numa prévia o campo ainda aparece, e isso é esperado.

Em aberto: ninguém viu o campo sair da tela nem consultou o banco do engage. Se na produção o nome ou o tenant forem diferentes dos assumidos, a migração não encontra o campo, não dá erro e nada muda. Se alguma etapa de funil exigir esse campo, ela passa a exigir algo que o formulário não mostra.

## Provas da rotina

npm run check:colors && npm run lint:css — exit 0 — 2026-11-04T16:36:01Z
npm test — exit 0 — 2026-11-04T16:36:19Z
npm run typecheck:ci — exit 0 — 2026-11-04T16:36:46Z
npm run build — exit 0 — 2026-11-04T16:37:18Z
npm run lint — exit 1 — 2026-11-04T16:37:43Z
cd server && npm run lint — exit 1 — 2026-11-04T16:37:50Z
cd server && npm run build — exit 0 — 2026-11-04T16:38:16Z
cd server && npm test — não executável neste ambiente — o script é vitest em modo watch e não termina; com npx vitest run (2026-11-04T16:46:34Z) 878 testes passam e 69 falham por falta de DATABASE_URL, sem banco neste ambiente
merge origin/main — 27e53bb6c20d6125787929d3332aae7211d85a2d — 2026-11-04T16:46:43Z
PR: nenhuma

## Cobertura da prova

Itens numerados na ordem da Definição de Concluído da spec.

1. documental — `git diff --name-only origin/main...HEAD` lista a migração nova (carimbo 20261104170000) e, além dela, só os relatórios em `specs/relatorios/`.
2. documental — `migration.sql` contém um `UPDATE "CustomField"` com slug, nome e `entity IS NULL`; `grep -c "DELETE\|DROP\|ALTER\|TRUNCATE"` devolveu 0 (a palavra ALTER, DROP etc. não aparece nem nos comentários).
3. documental — `grep -c "publicacao: depois"` devolveu 0.
4. só por fixture — chamador de fora: suíte do servidor contra um Postgres — sem `DATABASE_URL` neste ambiente, 69 testes dependentes de banco falham antes de tocar na migração; os 878 que rodam passam.
5. exercitado — `npm run build` exit 0 (2026-11-04T16:37:18Z) e `cd server && npm run build` exit 0 (2026-11-04T16:38:16Z), saída acima; sem contorno de `xlsx`.
6. não exercitado — chamador de fora: formulário de negócio em `engage.vydhub.com` com a produção já migrada — a migração só é aplicada pela publicação depois do merge; ficou para a operação.
7. não exercitado — chamador de fora: `SELECT` na produção do engage — fora do alcance de qualquer execução de rotina; ficou para a operação.

## Conferente de horário

```
$ node /home/user/vyd-forge/scripts/conferir-horarios.mjs --raiz /home/user/vyd-engage specs/relatorios/deletar-campo-hora-do-ultimo-contato-ao-criar-um-novo-deal-build.md
conferir-horarios: limpo (1 arquivo(s))
```
