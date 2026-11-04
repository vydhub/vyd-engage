# Build — FRG-178 — modelo de planilha de importação de leads

> Rascunho aberto pela rotina de Build; o relatório final substitui este arquivo no push da entrega.

## Rubrica (gravada ANTES do código, em commit próprio)

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
