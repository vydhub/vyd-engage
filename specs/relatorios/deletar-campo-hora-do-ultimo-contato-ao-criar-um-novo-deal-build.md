# Relatório de build — FRG-175

## Rubrica (escrita antes do código)

Nota de 0 a 100, fixada antes de escrever a migração:

| Critério | Pontos |
|---|---|
| Entrega é exatamente 1 migração nova (carimbo > 20261031120000), nenhum TS/React/schema muda | 20 |
| Conteúdo é só o UPDATE do requisito 2, com guarda `entity IS NULL`, tenant e nome literais, UTF-8 sem BOM | 25 |
| Sem DELETE/DROP/ALTER/TRUNCATE e sem `-- publicacao: depois`; conferir-pr sai 0 | 20 |
| Portões obrigatórios do repositório saem 0 (check:colors+lint:css, test, typecheck:ci, build) | 20 |
| Relatório honesto: itens 6 e 7 declarados não exercitados, fronteiras e risco do StageRequiredField declarados | 15 |
