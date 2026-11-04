# Provas operacionais da publicação automática — vyd-engage

Roteiro `vyd-forge/docs/publicacao/ativacao.md` §3.4 · spec `publicacao-automatica-pos-merge` (Definição de Concluído, Ativação).
Executadas pelo coordenador com autorização do gestor entre 20 e 23/10/2026. Horários em UTC. Tudo o que tocou o banco ficou no schema `ensaio` (tabela `ensaio.publicacao_engage`), fora das tabelas usadas pelo app. A mudança no site foi a `<meta name="publicacao-ensaio">`, conferida pelo domínio e removida nesta PR.

O Engage é o repositório com Prisma, serviço no Railway e site na Vercel, sem edges. A etapa `servico` publica a API no Railway (o deploy automático do Railway está desligado desde a ativação). As migrations `depois` são marcadas como aplicadas no `_prisma_migrations` antes do deploy e guardadas em `publicacao.prisma_adiadas`.

## Prova 1 — migration aditiva, serviço e site

PR #95 (merge `044249e`):
- publicada: preflight 12:40:06 ok → banco 12:40:38 ok → servico 12:43:15 ok → site 12:44:42 ok → conferencia 12:44:48 ok · [execução](https://github.com/vydhub/vyd-engage/actions/runs/39424009610)

## Prova 2 — migration que falha por um estado do banco, correção e Re-run

A migration insere de novo `id = 1` (chave duplicada) junto com a `<meta>` `prova-2`. A etapa banco falhou e o site **não subiu**; o domínio seguiu em `prova-1`. O coordenador apagou a linha `id = 1` de `ensaio.publicacao_engage`, marcou a migration como revertida (`prisma migrate resolve --rolled-back 20261020140100_publicacao_ensaio_2`) e deu **Re-run na mesma execução**.

PR #96 (merge `fa7bc23`), execução [39439179544](https://github.com/vydhub/vyd-engage/actions/runs/39439179544):
- tentativa 1 — falhou, `migration_falhou`: preflight 14:26:31 ok → banco 14:27:03 falhou
- tentativa 2 (20/10) — falhou, `erro_inesperado`: banco 18:31:04 ok → servico 18:32:20 falhou. Incidente do Railway: novos builds pausados.
- tentativa 3 (22/10) — falhou, `railway_recusou`: banco 09:06:44 ok → servico 09:06:48 falhou. O Railway invalidou todos os tokens de API às 04:17 UTC; o gestor gerou um token novo.
- tentativa 4 (22/10) — falhou, `erro_inesperado`: banco 12:43:08 ok → servico 12:44:24 falhou. Deploys pausados para o plano Hobby.
- tentativa 5 (22/10) — **publicada**: preflight 21:10:19 ok → banco 21:10:25 ok → servico 21:25:24 ok → site 21:27:01 ok → conferencia 21:27:08 ok

Nas tentativas 2 a 5 a etapa banco passou sem reaplicar a migration já registrada: o Re-run é seguro mesmo repetido. As falhas 2 a 4 foram do Railway, não do conteúdo; em todas, o site seguiu na versão anterior.

## Prova 4 — coluna criada na fase antes e apagada na fase depois

`…_4_coluna` cria `coluna_depois` (fase antes); `…_4_apaga`, com `-- publicacao: depois`, a apaga. A publicação aplicou só a primeira, marcou a segunda como aplicada no `_prisma_migrations` (para o `prisma migrate deploy` do serviço não a rodar), registrou-a em `publicacao.prisma_adiadas` e abriu a pendência. Site no ar às 22/10 21:47; liberação às 23/10 21:47.

PR #97 (merge `060e3d8`):
- publicada: preflight 21:30:54 ok → banco 21:31:29 ok → servico 21:45:57 ok → site 21:47:17 ok → pendencias 21:47:21 ok → conferencia 21:47:27 ok · [execução](https://github.com/vydhub/vyd-engage/actions/runs/39857840670)

## Prova 3 — `DROP COLUMN` sem marcador, e a saída

O check `conferir-pr` da PR #98 falhou: `destrutiva_na_fase_antes: 20261020140400_publicacao_ensaio_3:3 — ALTER TABLE … DROP COLUMN`. A PR foi mergeada de propósito. A publicação recusou **antes de aplicar** ("nada foi aplicado") e a coluna seguiu no banco.

PR #98 (merge `edf2a45`):
- falhou, `destrutiva_na_fase_antes`: preflight 21:51:33 ok → banco 21:51:38 falhou · [execução](https://github.com/vydhub/vyd-engage/actions/runs/39860547065)

Saída: a PR #99 pôs `-- publicacao: depois` no topo do arquivo. O check ficou vermelho como o roteiro prevê (`arquivo_aplicado_mudou`: sem banco, ele não sabe que o arquivo nunca rodou). Antes do merge, o coordenador conferiu que o `_prisma_migrations` não tinha linha desse arquivo. A publicação destravou e o `DROP` virou pendência da fase depois (site no ar às 22/10 22:07; liberação às 23/10 22:07).

PR #99 (merge `8347a20`):
- publicada: preflight 21:55:27 ok → banco 21:55:59 ok → servico 22:06:45 ok → site 22:08:00 ok → pendencias 22:08:06 ok → conferencia 22:08:12 ok · [execução](https://github.com/vydhub/vyd-engage/actions/runs/39861040489)

## Prova 5 — ordem banco → serviço → site

Em toda publicação bem-sucedida acima, a etapa banco termina antes do serviço, e o serviço antes do site (ex.: prova 4 — banco 21:31:29, servico 21:45:57, site 21:47:17). Quando o banco falha (prova 2, tentativa 1; prova 3), nem o serviço nem o site são publicados. Quando o serviço falha (prova 2, tentativas 2 a 4), o site não é publicado.

## Fase depois (provas 4 e 3) — 23/10

O relógio do Forge disparou a execução `fase-depois` no primeiro horário depois de cada liberação. As pendências fecharam como `aplicada`:

- 22:00 — `20261020140310_publicacao_ensaio_4_apaga → aplicada` · [execução](https://github.com/vydhub/vyd-engage/actions/runs/40030690368)
- 22:15 — `20261020140400_publicacao_ensaio_3 → aplicada` · [execução](https://github.com/vydhub/vyd-engage/actions/runs/40032373195)

## Conferência diária (prova 6) e permissão do App (prova 0)

Disparada pelo Forge às 09:00 UTC, pelo App. Isso prova a permissão `Actions: Read and write` do §0.3.

- 20/10 e 21/10 — concluída · [execução de 21/10](https://github.com/vydhub/vyd-engage/actions/runs/39573546589)
- 22/10 — falhou, `railway_recusou` · [execução](https://github.com/vydhub/vyd-engage/actions/runs/39752009713). Causa: tokens invalidados pelo Railway às 04:17 UTC. O alarme saiu como deve.
- 23/10 a 04/11 — concluída todos os dias, sem alarme.

## O que fica

- O schema `ensaio` fica no banco (decisão do gestor): é pequeno, fica fora do app, e apagá-lo pediria mais um ciclo de 24 h.
- A `<meta name="publicacao-ensaio">` sai do site nesta PR; o `index.html` volta a ser idêntico ao de antes das provas.
- Defeitos da ferramenta achados durante a ativação e as provas: o filtro do Railway `successfulOnly` (vydhub/vyd-forge#120) e a pasta `supabase/.temp` (vydhub/vyd-forge#122, só nos repositórios Supabase).
