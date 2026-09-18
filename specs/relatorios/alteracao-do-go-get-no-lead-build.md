---
forge_id: FRG-157
---
# Relatório de Build — FRG-157

## Autoavaliação (D15)

### Rubrica (definida antes do código, a partir dos Requisitos Obrigatórios
e da Definição de Concluído de `specs/alteracao-do-go-get-no-lead.md`)

| Critério | Peso |
|---|---|
| Requisitos 1-3 — `Select` vira campo de texto numérico em `LeadOpportunityFields.tsx`, sufixo `%` no molde do Valor estimado, troca contida a esse único componente (cobre cadastro e edição) | 20 |
| Requisitos 4-6, 8 — máscara só-dígitos sem decimal/sinal/separador, campo opcional (`''` → `null`), `0` válido e distinto de vazio, limpeza explícita continua gravando `null` | 20 |
| Requisito 7 — back-end aceita inteiro 0-100 e recusa o resto com `400`, mensagem em português, mesmo formato de erro da rota | 15 |
| Requisitos 9-10 — `GO_GET_STEPS` removida dos três lugares (nenhum import sobra) e comentário do schema atualizado, sem migration | 10 |
| Requisito 11 — testes reescritos cobrindo os sete casos (`0`, `33`, `100`, `-1`, `101`, `33.5`, `null`) na criação e na edição | 15 |
| Requisito 12 — leitura em `LeadDetail.tsx`/`SidePanel.tsx` funciona sem alteração de código nesses dois arquivos (verificação, não edição) | 5 |
| Casos extremos — rascunho antigo (`useFormDraft`) tolera número/`null`/ausente sem derrubar o formulário; zeros à esquerda normalizados; texto colado é descartado | 10 |
| Portão de comandos obrigatórios do repositório (`check:colors`+`lint:css`, `npm test`, `npm run typecheck:ci`, `npm run build`) limpos, mais `npm run lint` (raiz e server) e suíte do server | 5 |

Total: 100. A nota de cada rodada é a soma do que sobrevive à autocrítica,
não uma estimativa — cada dedução abaixo aponta o critério e o motivo.
