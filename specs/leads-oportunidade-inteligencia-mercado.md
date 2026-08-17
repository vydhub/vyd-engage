# Spec: Leads como Oportunidade + Expansão da Inteligência de Mercado

> Solicitações da área comercial (documento "LEADS - Engage_Final" + demandas de
> Inteligência de Mercado, ago/2026). Duas frentes independentes que podem ser
> implementadas/entregues em PRs separados, mas especificadas juntas por virem do
> mesmo pacote de demandas.

## Objetivo

Reestruturar o módulo de Leads para refletir o entendimento da área comercial de
que **lead é uma oportunidade em potencial**, seguindo a cadeia
`Empresa → Contato → Lead → Atividades → Próxima ação → Conversão ou encerramento`:
vínculo obrigatório do lead a uma empresa e a um contato (com cadastro rápido
inline), novo conjunto enxuto de campos de oportunidade, atividades estruturadas
(Reunião/Ligação/Tarefa) com anexos e transcrição de áudio, motivo obrigatório de
pausa/cancelamento/encerramento e automações de acompanhamento (lembrete de 30
dias e tarefa de planejamento de 15 dias). Em paralelo, expandir o prompt da
pesquisa de **Segmento** da Inteligência de Mercado com as seções pedidas
(commodities, produção, mapa de ativos, projetos implantados, investimentos
correntes, processo produtivo), corrigir os percentuais da matriz de screening e
concentrar o diretório de decisores na pesquisa de Empresa.

## Usuários

- **Área comercial (tenant Tenax/K2)** — vendedores e gestores; usuários de
  negócio, não técnicos. Criam leads, registram atividades, acompanham pendências.
- **Gestores comerciais** — papel GESTOR; acompanham leads da equipe.
- **Analistas de inteligência de mercado** — rodam pesquisas de Segmento/Empresa
  e leem os relatórios renderizados.
- **Platform admin** — único que edita os prompts das pesquisas (gating
  `isPlatformAdmin` já existente).

---

## Contexto do código (fatos verificados, base para os requisitos)

- `Lead` hoje é "achatado": dados de pessoa (name/email/phone/company texto
  livre/position) + score/tags/customFields + `isContact` (contato **é** um Lead
  com flag — decisão registrada em `docs/stories/epic-entity-model-evolution.md`).
- `Lead.companyId` existe no schema mas **não é gravado por nenhuma tela/API**
  (só pelo importador legado). Todo lead criado pela UI fica sem FK de empresa.
- Valor/prazo/probabilidade só existem no `Deal` (`value`, `expectedCloseDate`,
  `probability`). Não existe conversão formal Lead→Deal (só um botão "+ Criar
  Deal" que não copia dados nem encerra o lead).
- `Interaction` é append-only (sem `updatedAt`, sem PUT), com `metadata Json`
  sem validação. `Attachment` só se vincula a `dealId`/`companyId`.
- Transcrição Whisper **já existe** (`meetingService.transcribeAudio`,
  `whisper-1` via OpenAI) mas acoplada a reuniões de Deal e só por upload de
  arquivo — não há gravação no navegador em lugar nenhum do repo.
- Motor de automações (BullMQ) está **desligado em produção**
  (`ENABLE_AUTOMATION_ENGINE=false`); jobs `setInterval` sempre-ativos são o
  padrão vigente (`clientFollowUpChecker`, `salesOps`, `taskNotificationChecker`).
- Prompt de Segmento vive em
  `server/src/services/deepResearch/builtinTemplates.ts` (`SEGMENTO_TEMPLATE_PROMPT`),
  semeado por tenant **sem upsert** — editar o arquivo não atualiza tenants
  existentes. A "matriz de screening" não é cálculo em código: os percentuais são
  gerados pelo LLM a partir do prompt.
- O visualizador pagina o relatório por `##` (H2) e o sanitizador **bloqueia
  iframes** (o embed do Google My Maps não renderiza; links e imagens sim).

---

## Requisitos

### Obrigatórios

#### A. Estrutura do Lead — Empresa → Contato → Lead

1. O sistema deve exigir, na criação de um novo lead pela UI interna, o vínculo a
   uma **Empresa** (`companyId`) e a um **Contato** (`contactId`) existentes ou
   criados na hora. A API (`POST /api/v1/leads`) deve rejeitar criação manual sem
   `companyId` e `contactId` com erro 400 e código de erro específico.
2. O Contato permanece modelado como `Lead` com `isContact = true` (sem novo
   model). O lead-oportunidade deve ganhar o campo `contactId` (FK self-relation
   para o Lead-contato). A API deve validar que o contato referenciado tem
   `isContact = true`, pertence ao mesmo tenant e à mesma empresa (`companyId`)
   do lead; caso contrário, 400.
3. O formulário de lead deve permitir **cadastro rápido inline** de Empresa sem
   sair da tela: combobox de empresa (busca no servidor, padrão do
   `CompanyPicker` existente) com item "+ Criar nova empresa" abrindo um
   mini-formulário (nome obrigatório; CNPJ e segmento opcionais). A empresa criada
   deve ficar imediatamente selecionada no lead.
4. O formulário de lead deve permitir **cadastro rápido inline** de Contato da
   empresa selecionada: combobox de contatos filtrado por `companyId` +
   `isContact=true`, com item "+ Criar novo contato" (nome obrigatório; cargo,
   e-mail e telefone opcionais). O contato criado nasce com `isContact = true` e
   `companyId` da empresa selecionada, e fica imediatamente selecionado.
5. O backend deve passar a aceitar e filtrar `companyId` na listagem de leads
   (`GET /api/v1/leads?companyId=...&isContact=true`) — isso também corrige o bug
   atual do seletor de stakeholders do Desdobramento Comercial, que hoje lista
   todos os leads do tenant.
6. A tela de detalhe do lead deve exibir a empresa vinculada como **link** para
   `/app/companies/:id` e o contato vinculado com nome/cargo/telefone/e-mail
   (dados vêm do Lead-contato).

#### B. Campos do Lead (novo conjunto)

7. O sistema deve substituir o enum de status do lead pelos 5 valores da área
   comercial: `NOVO`, `EM_ANDAMENTO`, `PAUSADO`, `CANCELADO`, `ENCERRADO`
   (rótulos: Novo, Em Andamento, Pausado, Cancelado, Encerrado). Migração dos
   dados existentes: `NEW→NOVO`; `CONTACTED/QUALIFIED/PROPOSAL/NEGOTIATION→EM_ANDAMENTO`;
   `WON→ENCERRADO`; `LOST→CANCELADO` (leads migrados para
   PAUSADO/CANCELADO/ENCERRADO recebem motivo `OUTRO` com nota "migração de
   status legado").
8. O sistema deve substituir o enum de origem do lead pelos 7 valores:
   `PROSPECCAO_ATIVA`, `PORTAL_NOTICIAS_LINKEDIN`, `EVENTO_FEIRA_SETORIAL`,
   `NETWORKING_PESSOAL`, `CLIENTE_RECORRENTE`, `INDICACAO_PARCEIROS`, `OUTROS`
   (rótulos conforme o documento: Prospecção ativa, Portal de Notícias/LinkedIn,
   Evento/Feira setorial, Networking pessoal, Cliente recorrente, Indicação de
   parceiros, Outros). Migração: `SOCIAL_MEDIA→PORTAL_NOTICIAS_LINKEDIN`;
   `REFERRAL→INDICACAO_PARCEIROS`; `EMAIL/PHONE→PROSPECCAO_ATIVA`;
   `WEBSITE/OTHER→OUTROS`.
9. O lead deve ganhar os campos de oportunidade:
   - **Informações da oportunidade** — texto livre; reutiliza a coluna
     `Lead.notes` com o rótulo novo (o textarea atual está desconectado do
     estado — deve passar a salvar de verdade);
   - **Valor estimado (Budget)** — `estimatedValue Decimal(12,2)?`, exibido em
     R$ com máscara de moeda;
   - **Prazo estimado** — `estimatedTimeline String?` (texto livre, conforme
     pedido);
   - **Probabilidade Go×Get** — `probabilityGoGet Int?` restrito por validação
     Zod aos valores {10, 25, 50, 75, 90}, exibido como lista suspensa
     "10% / 25% / 50% / 75% / 90%".
10. O campo **Responsável comercial** (`assignedTo`, já existente no banco) deve
    aparecer em todos os formulários de lead como lista suspensa de usuários do
    tenant, e ser exibido no detalhe do lead e no painel lateral. O
    `leadService.findById` deve incluir `assignedUser` na resposta.
11. Os três formulários de lead (página `LeadForm`, modal do Kanban `LeadModal`
    e criação rápida onde houver) devem convergir para o **mesmo conjunto de
    campos**, idealmente um componente compartilhado: Empresa*, Contato*,
    Status, Origem, Informações da oportunidade, Valor estimado, Prazo estimado,
    Probabilidade Go×Get, Responsável comercial. O campo "nome do lead" (`name`)
    permanece como título da oportunidade.
12. O mapeamento com perda em `src/utils/leadEnums.ts` (status/origem UI ≠
    backend) deve ser eliminado: UI passa a usar os enums novos diretamente.

#### C. Motivo obrigatório de pausa/cancelamento/encerramento

13. Sempre que o status do lead mudar para `PAUSADO`, `CANCELADO` ou
    `ENCERRADO` — por qualquer caminho (formulário, detalhe, bulk, Kanban) — o
    sistema deve exigir um **motivo** da lista fixa de 10:
    `CONVERTIDO_EM_OPORTUNIDADE`, `PAUSADO_PELO_CLIENTE`, `PROJETO_SUSPENSO`,
    `SEM_ADERENCIA_TECNICA`, `CONCORRENTE_ESCOLHIDO`, `PRECO`, `PRAZO`,
    `DECISAO_INTERNA_CLIENTE`, `SEM_RETORNO`, `OUTRO`. Persistir em
    `statusReason` (enum) + `statusReasonNote String?`; quando o motivo for
    `OUTRO`, a nota textual é obrigatória.
14. A API deve rejeitar (400) transição para esses 3 status sem motivo válido; a
    UI deve abrir um diálogo de motivo antes de confirmar a mudança (inclusive
    no arrasto de card no Kanban para coluna mapeada a esses status — cancelar o
    diálogo desfaz o movimento).
15. Toda mudança de status com motivo deve gerar uma `Interaction` do tipo
    `STATUS_CHANGE` registrando status anterior, novo status, motivo e nota — o
    histórico aparece na timeline de atividades.
16. Ao voltar o lead para `NOVO` ou `EM_ANDAMENTO`, o sistema deve limpar
    `statusReason`/`statusReasonNote`.

#### D. Conversão em oportunidade (Lead → Deal)

17. O detalhe do lead deve oferecer a ação **"Converter em oportunidade"**, que:
    (a) cria um `Deal` copiando `name`, `estimatedValue→value`,
    `probabilityGoGet→probability`, `companyId`, `leadId`, `assignedTo` e
    anexando o contato do lead como `DealContact`; o prazo estimado (texto) é
    copiado para as notas do deal; (b) encerra o lead automaticamente
    (`status=ENCERRADO`, `statusReason=CONVERTIDO_EM_OPORTUNIDADE`) sem pedir
    motivo no diálogo; (c) registra `Interaction` de conversão; (d) navega para o
    deal criado.
18. A conversão deve ser idempotente na prática: se o lead já está `ENCERRADO`
    com motivo `CONVERTIDO_EM_OPORTUNIDADE` e já possui deal vinculado, o botão
    vira "Ver oportunidade" (link para o deal).

#### E. Destino dos campos atuais — decisão campo a campo

> A área pediu "excluir os demais campos". A tabela abaixo é a proposta
> individual por campo (conforme decisão de especificar campo a campo). Colunas:
> **OCULTAR** = sai de todas as telas/filtros/export de lead, dado e modelo
> permanecem; **MANTER** = continua como está; **REAPROVEITAR** = muda de papel.

| # | Campo atual | Proposta | Justificativa |
|---|-------------|----------|---------------|
| 19 | `name` | **MANTER** | Vira o título da oportunidade. |
| 20 | `email`, `phone`, `position` | **OCULTAR no lead** | Dados de pessoa pertencem ao **Contato**. Nos Leads-contato (`isContact=true`) continuam visíveis e editáveis. Busca de leads para de olhar email/phone do lead-oportunidade. |
| 21 | `company` (texto livre) | **OCULTAR** (congelar) | Substituído pelo vínculo real `companyId`. Coluna permanece para histórico; nenhuma tela nova grava nela. |
| 22 | `score` + scoring de lead | **OCULTAR** | Sai da tabela, filtros, ordenação, export e detalhe. `scoringService` continua rodando por baixo (sem UI) até decisão futura de remoção. |
| 23 | `tags` | **OCULTAR** | Sai das telas de lead (seletor, filtro, bulk, coluna). Modelo `Tag`/`LeadTag` permanece (usado em automações/campanhas). |
| 24 | `customFields` | **OCULTAR** | Sai do formulário/tabela/filtros de lead. Permanece nos Contatos (cargo usa PresetField CONTACT) e demais entidades. |
| 25 | `notes` | **REAPROVEITAR** | Vira "Informações da oportunidade" (req. 9). |
| 26 | `isContact`/`convertedAt` | **MANTER** | É a base da entidade Contato. Os endpoints convert/revert continuam existindo, mas o botão "Converter para Contato" sai do detalhe do lead-oportunidade (o fluxo agora é criar contato direto na empresa). Aba "Contatos" da listagem permanece. |
| 27 | `assignedTo` | **MANTER + expor** | Vira "Responsável comercial" (req. 10). |
| 28 | `reportsToId`/`directReports` | **MANTER** | Organograma do Desdobramento Comercial depende dele (em Contatos). Sem UI no lead-oportunidade. |
| 29 | `empreendimentoId` | **MANTER** | Usado pelo módulo Empreendimentos. Sem UI no formulário novo. |
| 30 | `unsubscribed`/`unsubscribedAt` | **MANTER** | Compliance LGPD de campanhas — não pode sair. Sem UI no lead. |
| 31 | `funnelColumnId`/`positionInColumn` | **MANTER** | Kanban de leads continua, adaptado aos 5 novos status (req. 33). |
| 32 | `importBatchId`, `deletedAt` | **MANTER** | Infra de import/lixeira. |
| — | "Automações" (checkboxes no form) | **REMOVER** | É mock hardcoded no frontend (3 arquivos), sem backend. Remoção sem impacto de dados. |

33. O Kanban de leads (Pipeline) deve ser **adaptado aos novos status**:
    `FunnelColumn.mappedStatus` passa a aceitar os 5 valores novos; o movimento
    de card continua gravando o status mapeado (com o diálogo de motivo do
    req. 14 quando aplicável); as colunas-padrão seedadas passam a refletir a
    régua nova.
34. Filtros, visualizações salvas, export e bulk actions de leads devem ser
    atualizados para o conjunto novo de campos (sem score/tags/customFields;
    com status/origem novos, responsável, empresa).

#### F. Atividades dentro do Lead

35. O detalhe do lead (`/app/leads/:id`) deve permitir criar **três tipos de
    atividade** por um único fluxo "+ Nova atividade" (modal/drawer com seletor
    de tipo): Reunião, Ligação e Tarefa. As superfícies legadas
    (`InteractionTimeline` de 5 tipos lowercase e `AddInteractionModal` morto)
    devem ser substituídas por esse fluxo.
36. **Reunião** (`Interaction type=MEETING`) deve ter os campos: Local (texto),
    Modalidade (`PRESENCIAL` | `ONLINE`), Participantes (múltiplos contatos da
    empresa do lead, com cadastro rápido inline igual ao req. 4), Assuntos
    tratados (texto — grava em `content`) e Anexos (arquivos, req. 40).
37. **Ligação** (`Interaction type=CALL`) deve ter os campos: Direção
    (`INBOUND` "Recebida" | `OUTBOUND` "Realizada"), Participantes (idem),
    Assuntos tratados (`content`) e Motivo da ligação
    (`PRIMEIRO_CONTATO` | `SOLICITACAO_INFORMACOES` | `FOLLOW_UP` | `SUPORTE`).
38. Os campos estruturados de Reunião/Ligação devem ser persistidos com
    validação Zod no backend (não `metadata: z.any()`): colunas novas na
    `Interaction` (`location`, `modality`, `callReason`, `occurredAt DateTime?`)
    e tabela de junção `InteractionParticipant` (`interactionId` + `leadId` do
    contato, `@@unique`, padrão do `DealContact` existente). O `occurredAt`
    (data/hora do evento, informada no form) passa a ordenar a timeline
    (fallback `createdAt`).
39. **Tarefa** (model `Task`, já existente) criada de dentro do lead deve ter:
    Título*, Prioridade (baixa/média/alta/urgente — enum atual já cobre),
    Data de vencimento, Responsável (select de usuários), Status (a fazer/em
    andamento/concluída — enum atual; **"atrasada" é derivada** de
    `dueDate < hoje` e exibida como badge, não como status persistido) e Tipo da
    tarefa — adicionar ao `TaskType` os valores `FOLLOW_UP`,
    `PREPARACAO_DOCUMENTO` e `VISITA_TECNICA` (rótulos: Follow-up, Preparação de
    documento, Visita técnica; `EMAIL` já existe), com mapeamento no
    `mapTaskTypeToInteraction`.
40. **Anexos em atividades**: o model `Attachment` deve ganhar `leadId?` e
    `interactionId?` (além dos atuais `dealId`/`companyId`); o fluxo de criação
    de Reunião deve permitir anexar arquivos (limite 25 MB e allowlist de MIME
    atuais), vinculados à interação criada; a timeline deve listar e permitir
    baixar os anexos da atividade.
41. As atividades Reunião/Ligação permanecem **imutáveis** após criação
    (append-only, como hoje); correções são feitas criando nova atividade. O
    DELETE de interação deve ganhar o mesmo gate de autorização das demais
    entidades (hoje só filtra tenant).
42. A visualização **"Histórico de interações"** (timeline cronológica) é
    mantida como está (já aprovada pela área), passando a renderizar os campos
    estruturados novos (modalidade, participantes, motivo, anexos) em vez de
    metadata cru.
43. O detalhe do lead deve ganhar o card **"Próximas ações"** listando as
    tarefas pendentes/em andamento do lead ordenadas por vencimento
    (`GET /tasks?leadId=...`), com badge de atraso, criação rápida e link para a
    tarefa. A aba órfã "tasks" (TabsContent sem TabsTrigger em
    LeadForm/LeadModal) deve ser corrigida ou removida nessa consolidação.

#### G. Áudio e transcrição

44. Os campos **"Informações da oportunidade"** (criação/edição do lead) e
    **"Assuntos tratados"** (Reunião e Ligação) devem oferecer entrada por áudio:
    botão de **gravação no navegador** (MediaRecorder) e opção de **upload de
    arquivo de áudio**. O áudio é transcrito e o texto resultante é inserido no
    campo (aditivo ao que já estiver digitado), permanecendo editável antes de
    salvar.
45. O backend deve expor um endpoint genérico de transcrição
    (`POST /api/v1/ai/transcribe`, multipart, campo `audio`, ≤ 25 MB, com
    `aiLimiter` e CSRF registrado), extraindo o `transcribeAudio` do
    `meetingService` para um serviço compartilhado (o fluxo de reuniões de Deal
    continua funcionando sem regressão). Registrar uso via `logAiUsage`
    (feature própria, ex. `field_transcription`).
46. A UI só deve exibir os controles de áudio quando a transcrição estiver
    disponível (`useAIStatus().transcription`); sem OpenAI configurada o campo
    funciona normalmente só com texto. O MIME `audio/webm;codecs=opus` (produzido
    pelo Chrome) deve ser aceito na validação (normalizar antes do allowlist).

#### H. Automações de acompanhamento

47. **Lembrete de 30 dias**: o sistema deve enviar e-mail automático ao
    **responsável comercial** de cada lead com status `EM_ANDAMENTO` a cada 30
    dias (contados da criação ou do último lembrete), com nome do lead, empresa,
    dias em andamento, data da última atividade e link para o lead. Implementar
    como job `setInterval` sempre-ativo (padrão `clientFollowUpChecker`, sem
    dependência de BullMQ/Redis), com deduplicação por janela de 30 dias
    (padrão `Notification.metadata`). Envio pelo caminho Resend global
    (`emailService`, template react-email novo). Leads `EM_ANDAMENTO` **sem
    responsável** geram notificação in-app para admins do tenant em vez de
    e-mail. Cada envio também gera notificação in-app para o responsável.
48. **Tarefa de planejamento**: se um lead for criado e nenhuma tarefa for
    criada junto, o sistema deve criar automaticamente a tarefa **"Planejamento
    de próximas ações"** com vencimento em **15 dias** e responsável = responsável
    comercial do lead. Implementar com janela de carência (job varre leads
    criados há mais de 24h sem nenhuma `Task` vinculada não-deletada), com
    deduplicação por prefixo de título (padrão `FOLLOWUP_TASK_TITLE_PREFIX`).
    A tarefa entra automaticamente nas notificações existentes de vencimento.

#### I. Inteligência de Mercado — pesquisa de Segmento

> Tudo nesta seção é edição de prompt (`SEGMENTO_TEMPLATE_PROMPT` /
> `EMPRESA_TEMPLATE_PROMPT` em `builtinTemplates.ts`) + operação de propagação.
> Mantém-se **um único template** de Segmento, expandido.

49. **Visão Geral do Segmento** — o prompt deve passar a exigir:
    (a) tendências de demanda das commodities do segmento **e** tendências de
    preços com **histórico dos últimos 12 meses** (tabela mês a mês, fonte e
    unidade explícitas);
    (b) **produção por país** (ranking mundial) e **produção por empresa no
    Brasil**;
    (c) **mapa das empresas com a localidade de seus ativos**, classificados
    como **Greenfield ou Brownfield**: tabela georreferenciada (empresa, ativo,
    município/UF, coordenadas quando públicas, estágio) + instrução para citar
    fontes de referência setoriais (para mineração, o MAPA IBRAM —
    https://www.google.com/maps/d/u/0/viewer?mid=1cYf5kH02tHYtKnX9ZvTomkRMO0FhkBw&femb=1 —
    entra como referência linkada no relatório, não como embed);
    (d) **fatores de demanda** desdobrados (estruturais, cíclicos, regulatórios),
    com quantificação quando houver base pública.
50. **Negócios** — o prompt deve passar a exigir:
    (a) retrospectiva dos **últimos projetos implantados** no segmento, em tabela
    com: empresa dona, projeto, **projetista**, **gerenciadora/fiscalizadora** e
    **tipo de contratação** (Spot, EPCM, EPC, outros);
    (b) **lista de todas as empresas do segmento** localizadas no Brasil ou com
    projetos a implantar no Brasil, com critério de inclusão explícito e
    instrução de exaustividade (incluir players pequenos/juniores; declarar o
    critério de corte quando houver);
    (c) para a lista de empresas, **investimentos de capital E investimentos
    correntes** (sustaining/OPEX relevante a engenharia), com **lista e origem
    dos investimentos** (fundos investidores, private equity, BNDES, offtake,
    mercado de capitais).
51. **Posicionamento e Proposta de Valor** — nova seção do prompt de Segmento
    exigindo: particularidades e expertises necessárias para atuação no segmento
    e **em cada commodity**, incluindo **resumo básico do processo produtivo /
    beneficiamento** — descrito de forma a permitir relacionar com as
    experiências da TENAX.
52. **Matriz de screening** — a seção de distribuição por fase/SAM deve ser
    nomeada explicitamente ("Matriz de Screening do Segmento") e o prompt deve
    ancorar os percentuais: faixas de referência por fase (percentual do CAPEX
    para estudos/engenharia/detalhamento/EPCM/comissionamento/compras),
    denominador explícito (CAPEX total vs. escopo endereçável), instrução de que
    as faixas são teto salvo evidência pública em contrário e obrigação de
    marcar `**estimativa**` com a base de cálculo. As faixas concretas devem ser
    parametrizadas no texto do prompt para o platform admin calibrar por
    segmento.
53. **Decisores** — remover do template de Segmento o "diretório de decisores
    por empresa-alvo" (Cap. 6 atual), mantendo apenas a leitura de conteúdo
    local/política regional; reforçar o Capítulo de Stakeholders do template de
    **Empresa** como o local canônico do organograma/decisores (já existe;
    revisar redação para cobrir o desdobramento pedido).
54. **Contrato de renderização** — os capítulos novos devem manter a convenção
    de saída `##` (H2) por capítulo (o visualizador pagina por H2 e o detector
    de completude/continuação usa o outline); o card "O que você vai receber" e
    o detector de completude absorvem os títulos novos automaticamente — a
    fixture de teste `deepResearchCompletude.test.ts` deve ser atualizada.
55. **Orçamento de saída** — elevar `OPENROUTER_MAX_OUTPUT_TOKENS` (e documentar
    o novo default) e `DEEP_RESEARCH_MAX_CONTINUATIONS` para comportar o
    relatório expandido; instruir no prompt que seções sem dados públicos digam
    "sem dados públicos suficientes" em vez de inventar.
56. **Propagação** — criar mecanismo para atualizar os templates builtin dos
    tenants **existentes** (script `server/scripts/` ou endpoint platform-admin):
    atualiza `promptBody` dos templates `isBuiltin=true` cujo conteúdo ainda é a
    versão builtin anterior; templates editados manualmente são listados para
    decisão, não sobrescritos silenciosamente. Executar a propagação faz parte
    da entrega.

### Fora do Escopo

- **Sequência de e-mails (drip/cadência)** como automação de tarefa — não existe
  infra de sequência no produto; fica para fase futura (o documento cita
  "Automações (WhatsApp, Sequência de e-mails)" dentro de Tarefa — registrado
  como melhoria futura).
- **Vincular automações WhatsApp à criação de tarefa** — o motor de automações
  está desligado em produção; fase futura.
- **Remoção física** dos campos/modelos ocultados (score, tags, custom fields de
  lead, coluna `company` texto) — só após validação da nova estrutura em uso.
- **Novo model `Contact` separado** — mantém-se `Lead.isContact` (decisão de
  arquitetura registrada; migração de entidade fica para depois, se necessário).
- **Embed (iframe) do Google My Maps no relatório** — sanitizador bloqueia
  iframe por segurança; entrega é link + tabela georreferenciada.
- **Mudanças no Deal** (motivo de pausa/cancelamento de Deal, novos status de
  Deal) — a demanda é sobre Lead; Deal permanece como está.
- **Gravação/IA de reuniões de Deal** — já existe e não muda.
- **Alterar o formulário público de captação** (`/capture/:tenantSlug`) para
  exigir empresa/contato — continua criando lead simples (ver caso extremo 5).
- **Dividir a pesquisa de Segmento em dois templates** — decidido manter um
  template expandido.

## Restrições

- **Stack e padrões do repo**: Prisma + Express + Zod no backend; TanStack Query
  no frontend; UI conforme regras VYD (tokens semânticos, ribbon, sem sidebar);
  strings de UI em português; conventional commits; migrações **aditivas e
  idempotentes** aplicadas em produção antes do merge (padrão do projeto).
- **Multi-tenant**: toda query nova filtra `tenantId`; validações cross-tenant
  nos novos FKs (`contactId`, `interactionId` em attachment, participantes).
- **CSRF**: novas rotas autenticadas de escrita devem ser registradas na
  whitelist `v1Router.use('/<rota>', csrfProtection)`.
- **Produção sem BullMQ**: `ENABLE_AUTOMATION_ENGINE=false` — os requisitos 47 e
  48 não podem depender do motor de automações nem de Redis.
- **Transcrição depende de OpenAI** (`OPENAI_API_KEY`, já configurada em
  produção); a feature degrada graciosamente para entrada manual (req. 46).
- **Enum migration no Postgres**: renomear/substituir valores de
  `LeadStatus`/`LeadSource` exige migração em etapas (adicionar valores novos,
  atualizar dados, remover antigos) — planejar para não quebrar
  `FunnelColumn.mappedStatus`, filtros salvos (`SavedView`) e automações que
  referenciam status antigos em `trigger.status`.
- **Compatibilidade**: endpoints existentes consumidos pela extensão Chrome
  (`/contacts/resolve`, `POST /contacts/leads`) e importador continuam
  funcionando; leads legados sem empresa/contato permanecem válidos.
- **Performance**: listagem de leads e timeline continuam paginadas; o card de
  próximas ações usa o filtro `leadId` do backend (não filtrar client-side).
- **Prompts são IP**: alterações de prompt só visíveis a platform admin; nada de
  `promptBody` vazando em respostas para usuário comum.

## Casos Extremos

1. **Lead legado sem empresa/contato** — permanece válido e editável; a UI exibe
   badge "vínculo pendente" no detalhe e no painel; salvar outras alterações não
   é bloqueado; vincular empresa/contato é incentivado, não forçado.
2. **Contato de outra empresa selecionado via API** — 400 com código específico
   (`CONTACT_COMPANY_MISMATCH`). Trocar a empresa de um lead limpa o contato
   selecionado na UI (e exige escolher outro).
3. **Quick-create de empresa duplicada** — antes de criar, o mini-form busca por
   nome (case-insensitive) e oferece a existente ("Usar esta"); criação segue
   permitida (não há unique no banco), mas o caminho feliz evita duplicata.
4. **Usuário sem permissão de criar empresa/contato** (capabilities
   `entities.companies.create`/`entities.leads.create`) — o item "+ Criar novo"
   não aparece; o combobox continua funcionando para seleção.
5. **Lead criado por captação pública ou import** — nasce sem empresa/contato
   (obrigatoriedade vale só para criação manual interna); cai no caso 1.
6. **Limite de plano de leads atingido** ao criar contato inline (contato conta
   como Lead) — exibir o erro de limite do plano no mini-form, sem perder o
   estado do formulário principal.
7. **Mudança de status em massa (bulk) para status com motivo** — o diálogo de
   motivo vale para o lote inteiro (um motivo aplicado a todos) ou a ação é
   bloqueada com mensagem — comportamento escolhido deve ser consistente e
   testado.
8. **Áudio**: microfone negado → mostrar instrução e manter upload; transcrição
   indisponível (sem OpenAI/provider fora) → 503 tratado com toast e campo
   manual; áudio silencioso/vazio → 422 com mensagem "não foi possível
   transcrever"; arquivo > 25 MB → 413 com mensagem clara; falha de rede no meio
   → o texto já digitado no campo não é perdido.
9. **Gravação longa** — limitar duração da gravação no cliente (ex.: 10 min) para
   respeitar o teto de 25 MB.
10. **Lembrete de 30 dias**: lead muda de status entre varreduras → só
    `EM_ANDAMENTO` no momento do envio recebe; responsável desativado/removido →
    trata como sem responsável (notificação a admins); `RESEND_API_KEY` ausente →
    job loga e cria só a notificação in-app (não crasha); reinício do servidor
    não duplica lembretes (dedup por janela persistida, não por memória).
11. **Tarefa de planejamento**: lead deletado (soft) antes da carência → não
    cria; tarefa criada e concluída/deletada dentro das 24h → conta como "teve
    tarefa", não cria; lead sem responsável → tarefa criada sem `assignedTo`
    (aparece nos filtros gerais).
12. **Kanban**: arrastar card para coluna mapeada a PAUSADO/CANCELADO/ENCERRADO
    e cancelar o diálogo de motivo → card volta à coluna original sem gravar
    nada.
13. **Conversão dupla** — clicar duas vezes em "Converter em oportunidade" não
    cria dois deals (guarda no backend pelo estado do lead).
14. **Pesquisa de Segmento**: relatório truncado mesmo com orçamento maior →
    banner "Relatório incompleto" + continuação automática (comportamento
    existente) cobrindo os capítulos novos; seção sem dados públicos → texto
    explícito "sem dados públicos suficientes", nunca inventado.
15. **Propagação de template**: tenant com prompt builtin editado manualmente →
    listado no relatório do script e **não** sobrescrito sem confirmação.

## Definição de Concluído

### Leads
- [ ] Criar lead pela UI exige empresa + contato; é possível criar empresa e
      contato inline sem sair da tela, e o lead nasce com `companyId` e
      `contactId` gravados (verificável no banco).
- [ ] `POST /api/v1/leads` sem `companyId`/`contactId` retorna 400; com contato
      de outra empresa retorna 400 `CONTACT_COMPANY_MISMATCH`.
- [ ] Formulários de lead exibem exatamente: Empresa*, Contato*, Status (5
      valores novos), Origem (7 valores novos), Informações da oportunidade,
      Valor estimado, Prazo estimado, Probabilidade Go×Get (5 degraus),
      Responsável comercial — e não exibem score/tags/custom fields/automações
      mock.
- [ ] "Informações da oportunidade" salva de verdade (o bug do textarea
      desconectado está corrigido).
- [ ] Migração aplicada: nenhum lead com status/origem antigos; mapeamentos
      conforme req. 7-8 conferidos por query.
- [ ] Mudar status para Pausado/Cancelado/Encerrado (formulário, detalhe, bulk e
      Kanban) exige motivo da lista de 10; `OUTRO` exige nota; a mudança gera
      entrada na timeline com o motivo.
- [ ] "Converter em oportunidade" cria o Deal com valor/probabilidade/empresa/
      contato copiados e encerra o lead com motivo `CONVERTIDO_EM_OPORTUNIDADE`;
      segundo clique mostra "Ver oportunidade".
- [ ] Kanban de leads funciona com colunas mapeadas aos 5 status novos,
      incluindo o diálogo de motivo no arrasto.
- [ ] Detalhe do lead mostra empresa como link, contato com dados, responsável
      comercial, card "Próximas ações" (tarefas do lead por vencimento com badge
      de atraso) e timeline de atividades.

### Atividades
- [ ] É possível criar Reunião (local, modalidade, participantes, assuntos,
      anexos), Ligação (direção, participantes, assuntos, motivo) e Tarefa
      (título, prioridade, vencimento, responsável, status, tipo — incluindo
      Follow-up, Preparação de documento e Visita técnica) de dentro do lead.
- [ ] Participantes são contatos da empresa do lead (o seletor não lista leads
      de outras empresas) e é possível cadastrar contato novo no meio do fluxo.
- [ ] Anexos de reunião ficam vinculados à atividade e podem ser baixados da
      timeline.
- [ ] A timeline renderiza os campos estruturados (modalidade, participantes,
      motivo, anexos) e ordena por data do evento.
- [ ] Payload inválido de atividade (modalidade fora do enum, motivo fora da
      lista) é rejeitado com 400 (validação Zod, não `z.any()`).

### Áudio
- [ ] Nos 3 campos-alvo há botão de gravar e de enviar arquivo; o texto
      transcrito entra no campo e é editável; sem OpenAI configurada os botões
      não aparecem e o campo funciona manualmente.
- [ ] `POST /api/v1/ai/transcribe` recusa não-áudio (415), > 25 MB (413) e
      funciona com `audio/webm;codecs=opus`; uso registrado em AiUsage.
- [ ] O fluxo existente de reuniões de Deal (transcrição/aplicar) continua
      passando nos testes.

### Automações
- [ ] Lead `EM_ANDAMENTO` com responsável gera e-mail de lembrete no ciclo de 30
      dias (testável reduzindo a janela via env/config em dev), sem duplicar em
      reinícios; sem responsável gera notificação in-app para admins.
- [ ] Lead criado sem tarefa ganha, após a carência, a tarefa "Planejamento de
      próximas ações" com vencimento em 15 dias atribuída ao responsável; lead
      que já tinha tarefa não ganha; não duplica em execuções repetidas.

### Inteligência de Mercado
- [ ] `SEGMENTO_TEMPLATE_PROMPT` contém os capítulos/instruções dos reqs. 49-52
      (histórico 12 meses, produção por país/empresa, tabela georreferenciada
      greenfield/brownfield + referência MAPA IBRAM, fatores de demanda,
      projetos implantados com projetista/gerenciadora/tipo de contratação
      Spot/EPCM/EPC, censo de empresas, investimentos de capital e correntes com
      origem/fundos, expertises por commodity + processo produtivo/TENAX,
      "Matriz de Screening do Segmento" com faixas-teto e denominador).
- [ ] O template de Segmento não pede mais diretório de decisores; o de Empresa
      segue pedindo (organograma concentrado lá).
- [ ] Capítulos novos aparecem no card "O que você vai receber" e são cobrados
      pelo detector de completude; fixture de teste atualizada e verde.
- [ ] Orçamento de tokens/continuações elevado e documentado.
- [ ] Script/endpoint de propagação executado: tenants existentes com template
      builtin não-editado recebem o prompt novo; editados são reportados.
- [ ] Uma pesquisa de Segmento real gerada de ponta a ponta renderiza os
      capítulos novos paginados por H2, com o link do mapa clicável.

### Qualidade
- [ ] `cd server && npx vitest run && npm run build` verde (testes novos para:
      validação de criação de lead, motivo obrigatório, conversão, transcrição
      genérica, jobs de lembrete/planejamento com janela reduzida).
- [ ] `npm run build` do frontend verde.
- [ ] Migrações aditivas aplicadas em produção antes do merge (padrão do
      projeto), com verificação pós-migração dos mapeamentos de status/origem.
