# Spec: Gestão de Parceiros Comerciais (Consultores Externos)

## Objetivo

Módulo PRM (Partner Relationship Management) do VYD Engage para gerir o
relacionamento e as oportunidades de negócio trazidas por **consultores comerciais
externos**. O mecanismo central é o **Registro de Oportunidade (deal
registration)**: o consultor registra a demanda antes de trabalhá-la — com autor,
data/hora e cliente-alvo — e recebe **exclusividade temporária** (janela de
proteção). Em volta dele, quatro sistemas resolvem as dores crônicas do mercado:
(1) **detecção determinística de conflito de interesse** entre consultores e com o
pipeline interno da Tenax; (2) **janela de proteção com expiração + updates
obrigatórios**, que ancora a cobrança em regra objetiva, não em pressão pessoal;
(3) **score de saúde por consultor com faixas e alerta por tendência**, para nenhum
parceiro esfriar sem que o gestor perceba a tempo; (4) **plano de ação bilateral por
oportunidade** (dono + prazo), que dá clareza do que está sendo desenvolvido. O
módulo também cobre **cadência formal de reuniões**, **metas por consultor**,
**documentos/templates + NDA assinado**, e **atribuição + comissão** (originador ×
desenvolvedor, % negociável, devida conforme os recebimentos do cliente). O núcleo
é 100% determinístico (matching por identificadores, timestamps, regras de
expiração) — auditável e defensável em disputa.

## Usuários

- **Consultor comercial externo** — usuário do Engage com **papel/perfil próprio**
  que o restringe **exclusivamente ao Portal do Parceiro** (fail-closed): registra
  e atualiza suas oportunidades, cumpre plano de ação, vê seus indicadores, metas,
  comissões e documentos. Nível técnico básico; usa desktop e celular; o
  **WhatsApp** é via alternativa de registro/update de baixa fricção.
- **Gestor de parceiros (interno Tenax, ADMIN/GESTOR ou perfil equivalente)** —
  aprova/rejeita registros, resolve conflitos, acompanha o painel de saúde dos
  consultores, conduz reuniões, gerencia metas, comissões e documentos.
- **Usuário designado para conflitos internos** — usuário específico configurável
  que trata conflitos entre consultor externo e o pipeline interno da Tenax
  (venda direta).
- **Time interno** — pode abrir/atribuir um registro em nome de um consultor.

## Contexto de reuso (já existe no Engage)

`Deal`/`Company`/`Interaction` (pipeline interno — alvo do cruzamento de conflito);
padrão **SLA = dueDate + badge de atraso** (playbook); módulo **WhatsApp**
aprofundado (P3) para inbound/outbound; **assinatura eletrônica ZapSign** (P2,
gated) para o NDA; `Attachment`/`AttachmentBlob` para documentos;
`Notification` + jobs leves (setInterval) para alertas/digests; `PermissionProfile`
+ capabilities fail-closed (P1) para o gate de acesso; `Goal` (metas) do Comercial
Pro; geração de PDF via `pdfService` (pdfkit) para o relatório executivo.

---

## Requisitos

### Obrigatórios

#### A. Cadastro de consultores (parceiros)

1. O sistema deve modelar o **Consultor** (multi-tenant) com: nome, e-mail,
   telefone/WhatsApp, CPF/CNPJ, empresa (opcional), **nível** (texto/enum
   configurável), **% de comissão base**, status (`ATIVO` | `SUSPENSO` |
   `INATIVO`), data de início da parceria, e vínculo com a conta de usuário do
   Engage (1:1) que dá acesso ao portal.
2. O consultor deve autenticar no Engage com **papel/perfil próprio** que o
   restringe exclusivamente ao Portal do Parceiro — **fail-closed**: nenhuma rota,
   menu ou dado do CRM interno é acessível; qualquer capability não prevista é
   negada por padrão.
3. O sistema deve exigir o **aceite do NDA como pré-condição de acesso ao portal**:
   consultor com NDA pendente vê apenas a tela de assinatura do NDA (fluxo do req
   34) e é bloqueado do restante até concluir.

#### B. Portal do Parceiro (visibilidade restrita)

4. O portal deve exibir **exclusivamente os dados do próprio consultor**: suas
   oportunidades (com estágio, dias para expirar, plano de ação), suas metas, seu
   extrato de comissões, suas reuniões e os documentos compartilhados com ele.
   **Nunca** exibe oportunidades, identidade ou dados de outros consultores, nem o
   pipeline interno da Tenax. Toda query do portal filtra por `tenantId` **e**
   `consultorId` do usuário autenticado.
5. Em caso de conflito envolvendo uma oportunidade do consultor, o portal exibe ao
   consultor **apenas o desfecho** ("aprovada", "não aprovada — já em
   desenvolvimento por outra frente", "em análise") — **nunca** a existência
   nominal do conflito nem a identidade do outro consultor/área.

#### C. Registro de Oportunidade (deal registration)

6. O consultor deve poder **registrar uma oportunidade** pelo portal com, no
   mínimo: cliente-alvo (razão social + **CNPJ quando disponível**), descrição da
   demanda/objeto, valor estimado (opcional), contato no cliente (opcional) e
   observações. O sistema grava **autor + data/hora (timestamp)** imutáveis.
7. Um usuário interno deve poder **abrir um registro em nome de um consultor**
   (atribuindo-o), com a mesma estrutura e o mesmo fluxo de aprovação.
8. O sistema deve suportar **registro e update via WhatsApp**: mensagem recebida do
   número cadastrado do consultor pode ser convertida em registro de oportunidade
   ou em atualização de progresso (fluxo assistido pelo time interno ou
   automatizado, conforme o módulo WhatsApp existente). Gated: se o WhatsApp não
   estiver configurado no tenant, o portal segue como único canal, sem erro.
9. Todo registro nasce com status `SUBMETIDO` e passa por **fluxo de aprovação**
   do gestor: `APROVADO` (concede a janela de proteção) | `REJEITADO` (com
   justificativa obrigatória, visível ao consultor) | `EM_ANALISE` (ex.: aguardando
   resolução de conflito). Toda transição grava quem decidiu, quando e o motivo
   (trilha de auditoria).
10. Ao aprovar, o sistema deve **criar/vincular a oportunidade ao pipeline** do
    Engage com **tag de atribuição** `PARCEIRO` (sourced), preservando o vínculo
    com o registro e o consultor — o pipeline de parceiros é distinguível do
    direto, mas compõe a mesma visão/forecast interna.

#### D. Janela de proteção, updates obrigatórios e expiração

11. O sistema deve conceder ao registro aprovado uma **janela de proteção**
    (exclusividade) com **prazo padrão único configurável pelo admin** do tenant e
    **ajustável caso a caso pelo gestor** no momento da aprovação (ou depois).
    Referências de calibração: ciclos de ~1–3 meses (privado direto) a 12–24 meses
    (público/edital).
12. O sistema deve exigir **atualização de progresso periódica** ("prova de
    trabalho") do consultor, com **cadência configurável pelo admin** (padrão: 30
    dias). Update em atraso → **badge de atraso** visível ao consultor e ao gestor.
13. O sistema deve enviar **aviso automático de expiração** ao consultor e ao
    gestor com antecedência configurável (padrão: 7 dias): "seu registro expira em
    X dias — atualize ou peça extensão".
14. O consultor deve poder **pedir extensão da janela** com justificativa; o gestor
    aprova/nega (com registro de decisão). A expiração nunca é silenciosa nem sem
    caminho de escape.
15. Ao fim da janela sem update/extensão, o registro passa a **`EXPIRADO`** —
    **fica sinalizado e o gestor decide caso a caso** o que fazer (reativar,
    encerrar, liberar para outro fluxo). O sistema **não** reatribui
    automaticamente.

#### E. Detecção e resolução de conflito de interesse

16. Ao submeter um registro, o sistema deve rodar **detecção determinística de
    conflito**: match do cliente-alvo por **CNPJ** (normalizado, chave primária de
    match) e, na ausência de CNPJ, por **razão social normalizada + contato**,
    contra (a) registros **ativos de outros consultores** e (b) o **pipeline
    interno da Tenax** (Deals/Companies ativos). Match positivo → candidato a
    conflito.
17. **Só é conflito**: mesmo cliente (mesmo CNPJ) **e mesma demanda/objeto**.
    **Não é conflito**: (a) grupo econômico/matriz vs. filial (CNPJs diferentes =
    oportunidades independentes); (b) mesmo CNPJ com projetos/demandas claramente
    diferentes. Como "mesma demanda" exige julgamento, o sistema **sinaliza o
    candidato a conflito e a decisão é sempre manual** (req 18) — nunca
    aprova/rejeita automaticamente um registro em conflito.
18. Registro com candidato a conflito entra em **`EM_ANALISE`** e vai para a fila
    de resolução: conflito **entre consultores** → resolvido pelo **gestor**;
    conflito **com o pipeline interno** → resolvido pelo **usuário designado**
    (configurável por tenant). O resolutor vê os dois lados (identidades,
    timestamps, estágios, evidências), decide (manter registro / rejeitar /
    tratar como independente) e o sistema grava **decisão + rationale + quem +
    quando** (trilha de auditoria imutável).
19. O sistema deve oferecer ao gestor uma **visão de sobreposição** (matriz de
    contas × consultores/pipeline interno) que mostra onde mais de uma frente toca
    o mesmo CNPJ — para enxergar conflito potencial **antes** de escalar.

#### F. Plano de ação por oportunidade (clareza bilateral)

20. Cada oportunidade aprovada deve ter um **plano de ação**: lista de ações, cada
    uma com **responsável** (o consultor **ou** um usuário interno da Tenax —
    bilateral), **prazo (dueDate)** e **status** (pendente/concluída/cancelada).
    Reusar o padrão **SLA = dueDate + badge de atraso** do Engage.
21. O portal do consultor deve exibir e permitir concluir **as ações dele**; o
    gestor vê o plano completo (ações de ambos os lados) e a taxa de cumprimento.
22. Cada oportunidade deve exibir campos de primeira classe: **estágio atual**
    (com histórico timestamped), **última interação** (data), **próxima ação**
    (a ação pendente mais próxima) e **dias para expirar**.

#### G. Score de saúde do consultor (anti-esfriamento)

23. O sistema deve calcular um **score de saúde (0–100) por consultor**, composto
    pelos sinais (pesos configuráveis pelo admin): (a) **novas oportunidades
    trazidas** no período; (b) **updates obrigatórios cumpridos** vs. atrasados;
    (c) **presença nas reuniões** agendadas (req 27-28); (d) **progressão do
    pipeline** (oportunidades avançando de estágio vs. paradas). O score tem
    **decaimento por recência** (inatividade derruba o score ao longo do tempo).
24. O score deve ser classificado em **faixas**: `SAUDAVEL` | `ATENCAO` |
    `ESFRIANDO` | `FRIO` (limiares configuráveis), exibidas no painel do gestor.
25. O sistema deve expor por consultor o indicador objetivo **dias desde a última
    atividade** (qualquer evento: registro, update, ação concluída, reunião
    presente, mensagem).
26. O sistema deve **alertar o gestor por tendência de queda** (delta do score na
    janela recente vs. anterior), não apenas por nível baixo — notificação in-app
    + e-mail quando um consultor muda de faixa para pior ou quando a queda excede
    limiar configurável.

#### H. Cadência de reuniões

27. O sistema deve permitir configurar uma **cadência formal de reuniões por
    consultor** (ex.: check-in mensal, revisão trimestral) e **agendar/registrar
    reuniões** com data, pauta e participantes.
28. Cada reunião realizada registra **presença/falta** do consultor; faltas
    alimentam negativamente o score (req 23c). Reuniões vencidas sem registro
    geram pendência para o gestor.

#### I. Atribuição e comissão

29. Cada oportunidade deve suportar **múltiplos consultores com papéis de
    atribuição**: `ORIGINADOR` (quem trouxe) e `DESENVOLVEDOR` (quem
    desenvolve/influencia) — no mínimo um originador; papéis distintos podem ser
    do mesmo consultor.
30. O sistema deve calcular a **comissão** por oportunidade ganha: **% base do
    consultor** (cadastro) **ou % negociado na oportunidade** (override), aplicado
    sobre o valor do contrato, com **divisão configurável entre papéis** (padrão
    sugerido 60% originador / 40% desenvolvedor; editável por oportunidade). Toda
    alteração de % é auditada.
31. A comissão é **devida conforme o cliente paga a Tenax**: o sistema deve
    permitir **registrar os recebimentos** do cliente na oportunidade ganha
    (data + valor + referência/medição) e, a cada recebimento, **liberar a parcela
    proporcional de comissão** de cada consultor (valor devido = % efetivo ×
    valor recebido × fração do papel).
32. O sistema deve manter um **extrato de comissões por consultor** (visível no
    portal dele): parcelas liberadas, valores, oportunidade de origem, status
    (`A_PAGAR` | `PAGA` — marcação manual pelo gestor) e totais. O **pagamento
    efetivo (transferência/financeiro) fica fora do sistema** — o módulo calcula,
    rastreia e marca.

#### J. Metas por consultor

33. O sistema deve permitir definir **metas por consultor** (ex.: nº de
    oportunidades registradas, valor de pipeline, valor ganho — por período) e
    exibir **meta vs. realizado** no painel do gestor e no portal do consultor.

#### K. Documentos e NDA

34. O sistema deve gerenciar o **NDA do consultor**: o gestor dispara o NDA para
    assinatura eletrônica (reusando a integração **ZapSign** existente, gated);
    status rastreado (`PENDENTE` | `ENVIADO` | `ASSINADO` | `RECUSADO`). **Sem
    ZapSign configurado**, o gestor pode fazer **upload manual do NDA assinado**
    (fallback) para liberar o portal. NDA assinado é pré-condição do acesso
    (req 3).
35. O sistema deve ter uma **área de documentos/templates da empresa** disponíveis
    ao consultor no portal (apresentações institucionais, materiais comerciais,
    modelos), gerenciada pelo gestor (upload/remoção/visibilidade), reusando
    `Attachment`.

#### L. Notificações e cobrança assertiva

36. O sistema deve notificar automaticamente (in-app + e-mail; WhatsApp quando
    configurado): (a) consultor — confirmação de registro, decisão de aprovação/
    rejeição com motivo, lembrete de update obrigatório, aviso de expiração,
    decisão de extensão, ação do plano vencendo/vencida, parcela de comissão
    liberada; (b) gestor — novo registro para aprovar, candidato a conflito
    detectado, consultor mudou de faixa de score para pior, registro expirando/
    expirado, reunião de cadência vencida.
37. O sistema deve enviar ao gestor um **resumo periódico (digest)** com:
    consultores por faixa de saúde, registros aguardando aprovação, conflitos
    abertos, registros expirando na semana, ações atrasadas.

#### M. Painel do gestor e relatório executivo

38. O sistema deve exibir um **painel de parceiros** para o gestor com: lista de
    consultores (score + faixa + dias desde a última atividade + pipeline ativo +
    meta vs. realizado), fila de aprovações, conflitos abertos, registros
    expirando, e os indicadores do programa (consultores ativos × dormentes,
    pipeline originado por parceiros, taxa de expiração, tempo médio de aprovação).
39. O sistema deve gerar um **relatório executivo em PDF** (reusando o
    `pdfService`): visão do programa por período — consultores e faixas, pipeline
    por consultor, ganhos, comissões liberadas, conflitos resolvidos, metas vs.
    realizado.

#### N. Acesso e permissões (lado interno)

40. O acesso interno ao módulo deve ser controlado por **capability própria**
    (padrão do módulo de Atestados): consultar (painéis, registros) vs. gerenciar
    (aprovar, resolver conflito, comissões, documentos, config). Gestão restrita a
    ADMIN/GESTOR ou perfil equivalente. O **usuário designado para conflitos
    internos** é configurável pelo admin.

---

### Fora do Escopo

- **Pagamento efetivo da comissão** (transferência bancária, integração
  financeira/contábil, retenções fiscais) — o módulo calcula, rastreia e marca
  como paga; o pagamento acontece fora.
- **Marketplace/recrutamento de parceiros**, onboarding com trilhas de
  treinamento/certificação (LMS), fundos de marketing (MDF), co-branding.
- **Tiers complexos de parceiro** com benefícios progressivos — apenas o campo
  `nível` simples usado para % de comissão base.
- **Integração com o pipeline de propostas/assinatura do cliente final** além do
  vínculo com o Deal existente (proposta/assinatura do cliente já têm módulo
  próprio).
- **App móvel dedicado** — o portal é responsivo; o canal móvel de baixa fricção é
  o WhatsApp.
- **Detecção de conflito por IA/LLM** — o matching é determinístico por decisão de
  design (auditável); IA não participa da decisão de conflito.

## Restrições

- **Stack:** React 18 + TypeScript + Vite / Node.js + Express + Prisma +
  PostgreSQL. Multi-tenant: toda query filtra `tenantId`; queries do portal
  filtram também `consultorId`. Novas rotas autenticadas registram CSRF (whitelist
  do `index.ts`).
- **Segurança do portal:** o papel/perfil do consultor é **fail-closed** — o
  isolamento é garantido no backend (não apenas escondendo UI). Nenhum endpoint
  interno pode ser alcançável pelo papel de consultor; testes devem cobrir o
  isolamento (consultor não lê dados de outro consultor nem do CRM interno).
- **UI:** vyd-design-system@2 obrigatório — tokens semânticos, ribbon, sem
  sidebar; novos arquivos no STRICT_SCOPE do `check:colors`. O Portal do Parceiro
  segue o mesmo shell/design system.
- **Reuso obrigatório:** WhatsApp (P3) para registro/update alternativo (gated);
  ZapSign (P2) para NDA (gated, com fallback de upload manual);
  `Attachment`/`AttachmentBlob` para documentos; `Notification` + job leve
  (setInterval, sem Redis) para lembretes/digest/score; `pdfService` (pdfkit) para
  o relatório executivo; padrão SLA=dueDate+badge do playbook.
- **Migrações:** exclusivamente **aditivas**; aplicar em produção antes do merge
  (processo do projeto). Não rodar testes de integração contra o banco de
  produção (incidente documentado) — testes unitários com mock.
- **Configurabilidade versionada:** prazos (janela, cadência de update,
  antecedência de aviso), pesos e limiares do score, split de comissão padrão e
  usuário designado de conflito são **configuráveis por tenant pelo admin** —
  nunca hard-coded.
- **Verificação:** `cd server && npm run build` (tsc) + testes unitários isolados;
  frontend `npm run build` + `check:colors` + `eslint`.

## Casos Extremos

- **Registro sem CNPJ:** aceito; o match de conflito usa razão social normalizada
  + contato e o resultado é marcado como "match fraco" — sempre revisão manual.
  Quando o CNPJ for preenchido depois, o sistema re-roda a detecção.
- **Dois registros do MESMO consultor para o mesmo cliente/demanda:** não é
  conflito — é duplicata; o sistema avisa e sugere unificar.
- **Conflito detectado após aprovação** (ex.: CNPJ preenchido depois, ou registro
  interno criado depois): o sistema sinaliza o conflito superveniente ao
  gestor/designado sem suspender automaticamente a oportunidade.
- **Consultor SUSPENSO/INATIVO com oportunidades ativas:** portal bloqueado;
  oportunidades ficam sinalizadas ao gestor para decisão caso a caso; janelas de
  proteção continuam correndo (não congelam sozinhas).
- **NDA recusado ou ZapSign indisponível:** portal permanece bloqueado; gestor é
  notificado; fallback de upload manual disponível. Nunca libera silenciosamente.
- **% de comissão ausente** (sem base nem override): a oportunidade pode ser ganha,
  mas o registro de recebimento exige definir o % antes de liberar parcela — o
  sistema aponta a pendência explicitamente (nunca calcula com % zero implícito).
- **Recebimentos que excedem o valor do contrato:** permitido registrar (aditivos
  são comuns em engenharia), com aviso visual de ultrapassagem.
- **Ganho sem plano de ação/updates em dia:** permitido (o resultado manda), mas o
  histórico de atrasos permanece no score.
- **WhatsApp não configurado / número não reconhecido:** mensagem não vira
  registro; cai no fluxo normal do inbox para triagem humana; nenhum dado é
  perdido.
- **Empate de timestamp / registros simultâneos:** ambos entram em `EM_ANALISE`;
  decisão manual (não há desempate automático por design).
- **Fuso/consistência de prazos:** cálculos de expiração e SLA usam data do
  servidor (UTC) com exibição local; a mudança do prazo padrão pelo admin **não**
  altera janelas já concedidas (só novas aprovações).
- **Nunca silêncio:** toda falha (assinatura, WhatsApp, notificação) é logada e
  visível na UI relevante; lacunas e pendências sempre explícitas.

## Definição de Concluído

- [ ] Modelo Prisma criado (migração aditiva) para Consultor, Registro de
      Oportunidade (com timestamps imutáveis e trilha de auditoria), Janela de
      Proteção/Extensões, Conflito (candidatos + resoluções), Plano de Ação,
      Score/Snapshot de saúde, Reuniões/Cadência, Atribuição (papéis), Comissão
      (config + parcelas), Recebimentos, Metas, Documentos/NDA — tudo multi-tenant.
- [ ] Consultor autentica e cai **exclusivamente** no Portal do Parceiro; teste
      comprova que o papel de consultor não acessa endpoints internos nem dados de
      outro consultor (fail-closed).
- [ ] NDA pendente bloqueia o portal; assinatura via ZapSign (gated) e fallback de
      upload manual liberam o acesso.
- [ ] Consultor registra oportunidade pelo portal; interno registra em nome dele;
      registro via WhatsApp funciona quando configurado e degrada sem erro quando
      não.
- [ ] Fluxo de aprovação funciona com justificativa e trilha de auditoria;
      aprovação concede janela de proteção com prazo padrão (config admin)
      ajustado caso a caso pelo gestor; vincula ao pipeline com tag PARCEIRO.
- [ ] Detecção de conflito roda na submissão: match por CNPJ (e fallback) contra
      registros de outros consultores E pipeline interno; candidato → `EM_ANALISE`;
      resolução manual pelo gestor (externo×externo) ou usuário designado
      (externo×interno) com rationale auditado; consultor nunca vê o concorrente.
- [ ] Matriz de sobreposição (contas × frentes) disponível ao gestor.
- [ ] Updates obrigatórios com cadência configurável geram badge de atraso; aviso
      automático de expiração com antecedência configurável; pedido de extensão
      funciona; expiração marca `EXPIRADO` e aguarda decisão do gestor.
- [ ] Plano de ação bilateral com dono+prazo+badge funciona no portal e no painel
      interno; campos última interação / próxima ação / estágio / dias-para-expirar
      visíveis por oportunidade.
- [ ] Score 0–100 com 4 sinais + decaimento calculado por job; faixas exibidas;
      "dias desde a última atividade" por consultor; alerta por mudança de faixa /
      tendência de queda chega ao gestor.
- [ ] Cadência de reuniões configurável; reuniões agendadas/registradas com
      presença/falta alimentando o score; reunião vencida gera pendência.
- [ ] Atribuição originador/desenvolvedor com % base, override por oportunidade e
      split configurável; recebimentos registrados liberam parcelas proporcionais;
      extrato de comissões no portal; marcação A_PAGAR/PAGA pelo gestor.
- [ ] Metas por consultor com meta vs. realizado no painel e no portal.
- [ ] Área de documentos/templates gerenciada pelo gestor e visível no portal.
- [ ] Notificações (in-app + e-mail; WhatsApp gated) para todos os eventos do
      req 36; digest periódico ao gestor.
- [ ] Painel do gestor com os indicadores do req 38; relatório executivo em PDF
      gerado.
- [ ] Configurações por tenant (prazos, pesos/limiares do score, split padrão,
      usuário designado) editáveis pelo admin.
- [ ] UI 100% tokenizada (STRICT_SCOPE), `check:colors`/`lint:css` passam;
      `cd server && npm run build` e `npm run build` (frontend) passam.
