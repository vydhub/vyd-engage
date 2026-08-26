# Spec: Aprimoramento do Playbook (responsável, SLA, editor rico+voz, contraste)

## Objetivo

Aprimorar os Playbooks de desdobramento comercial (Inteligência de Mercado →
Desdobramentos) em quatro frentes pedidas pelo solicitante: (1) **responsável por
passo** via uma função comercial (SDR/Closer/Pré-vendas/Gestor), mapeada a pessoas
reais quando o playbook é aplicado; (2) **SLA por passo**, reaproveitando o prazo já
existente e destacando ações **atrasadas**; (3) um **editor de texto rico com
ditado por voz** (speech-to-text pt-BR) nos campos de texto longo da feature, para
facilitar o registro das ações de cada passo; (4) **corrigir o contraste** dos
modais de Playbook para seguir o design system (`vyd-design-system`), atacando a
causa-raiz (cores `slate-*`/`gray-*` fora dos tokens semânticos). Inclui também
esclarecer o **botão de editar** dos playbooks padrão (funciona, mas é
somente-leitura por design).

## Usuários

Time comercial do VYD Engage (multi-tenant): gestores que montam os playbooks
(templates de jornada) e vendedores/BDRs que executam e **registram as ações** de
cada passo na agenda do desdobramento — muitos em campo, digitando pouco, daí o
ditado por voz. Nível técnico variado; nomes/ícones/ações existentes permanecem
familiares. O público desta spec para **construir e verificar** é um desenvolvedor
full-stack (ou uma sessão futura de Claude).

## Contexto do código (estado atual)

- Backend: `PlaybookTemplate` + `PlaybookStep` (`server/prisma/schema.prisma:1707`
  e `:1728`). Passo tem `title`, `actionType (TaskType)`, `targetRole
  (StakeholderRole?)` — o stakeholder EXTERNO alvo —, `offsetDays`, `priority`,
  `description`. **Não há responsável nem SLA no passo.** Ao aplicar,
  `generateActionsFromPlaybook` (`server/src/services/roadmapService.ts:75-112`,
  chamado por `create` `:116-137`) cria uma `Task` por passo; `Task` tem
  `assignedTo` (hoje = criador do desdobramento) e `dueDate` (= `offsetDays`).
- CRUD: `server/src/routes/playbooks.ts` (GET `/`, GET `/:id`, POST/PUT/DELETE
  ADMIN; PUT substitui todos os passos atomicamente; builtin protegido).
- Frontend: `src/components/comercial/PlaybooksManager.tsx` (lista + form),
  usado em `DesdobramentosTab.tsx`. Passo no form: `types/comercial.ts:67-76`.
  Registro de ação: `RegisterActionDialog` em `src/pages/RoadmapView.tsx:747-860`
  (nota em `<Textarea>` → `Interaction.content`).
- **Não existe** editor de texto rico (exceto GrapesJS, só e-mail) **nem**
  speech-to-text no projeto.

## Requisitos

### Obrigatórios

#### A. Responsável por passo (função comercial)

1. O sistema deve definir um enum `CommercialFunction` com os valores `SDR`,
   `CLOSER`, `PRE_VENDAS`, `GESTOR`, `OUTRO` (migração Prisma).
2. `PlaybookStep` deve ganhar um campo **opcional** `responsibleFunction:
   CommercialFunction?`. O editor de playbook (`PlaybooksManager`) deve exibir, em
   cada passo, um Select **"Função responsável"** (ao lado de tipo/alvo/prioridade/
   dias), incluindo a opção "Sem função" (null).
3. `User` deve ganhar um campo **opcional** `commercialFunction:
   CommercialFunction?`, editável na tela de Gestão de Equipe (onde o admin/gestor
   já gerencia usuários). Serve **apenas** para pré-preencher o mapeamento do
   requisito 6; não altera papéis de acesso (ADMIN/GESTOR/USER permanecem).
4. As rotas/serviço/validação (Zod) de playbook (`playbooks.ts`,
   `playbookService.ts`) e o schema de passo devem aceitar e persistir
   `responsibleFunction`. A rota de usuários deve aceitar `commercialFunction`.

#### B. Aplicar playbook com mapeamento de pessoas

5. Ao criar um desdobramento ("Novo desdobramento") com um playbook selecionado, se
   os passos usam ao menos uma `responsibleFunction`, a UI deve exibir um
   **mapeamento**: para cada função distinta usada nos passos, um seletor de membro
   do time ("Quem é o [SDR/Closer/…] deste desdobramento?").
6. Cada seletor do mapeamento deve vir **pré-preenchido** com um usuário cujo
   `commercialFunction` corresponda à função (se houver); o usuário pode trocar.
7. Ao confirmar, o backend deve gerar as Tasks atribuindo cada uma ao usuário
   mapeado para a `responsibleFunction` do seu passo. Passo **sem** função, ou
   função **não mapeada**, deve cair no comportamento atual (`assignedTo` = criador
   do desdobramento). A rota de criação de desdobramento (`roadmaps.ts` POST +
   `roadmapService.create`/`generateActionsFromPlaybook`) deve aceitar o mapeamento
   (ex.: `roleAssignments: { function, userId }[]`) e propagá-lo.

#### C. SLA por passo e destaque de atraso

8. O campo "dias" (`offsetDays`) deve ser **rotulado como "SLA (dias)"** no editor de
   playbook; o dado e o cálculo do `dueDate` permanecem inalterados (sem campo novo
   de prazo).
9. Na agenda do desdobramento (`RoadmapView`), toda ação (Task) com `dueDate` no
   passado e `status != COMPLETED` deve exibir um indicador visual **"Atrasado"**
   (badge/realce com token de perigo do DS), calculado no cliente a partir do
   `dueDate`. Ações concluídas ou sem `dueDate` não recebem o indicador.

#### D. Editor de texto rico + ditado por voz

10. O sistema deve prover um componente de **editor de texto rico** reutilizável
    (recomendado: Tiptap) com, no mínimo: negrito, itálico, lista com marcadores,
    lista numerada e link. O editor deve usar **exclusivamente tokens do DS**
    (nada de `slate-*`/`gray-*`/hex).
11. O editor deve incluir um **botão de ditado por voz** que usa a Web Speech API
    (`SpeechRecognition`/`webkitSpeechRecognition`) com idioma **pt-BR**, inserindo o
    texto reconhecido na posição do cursor. Enquanto ouvindo, o botão indica o estado
    ativo. O botão deve ficar **oculto/desabilitado** quando o navegador não suporta
    a API (degradação graciosa — o editor de texto continua funcionando).
12. O editor rico+voz deve substituir os campos de texto longo da feature:
    - a **nota** de "Registrar ação" (`RegisterActionDialog`);
    - as **notas do desdobramento** (campo `notes` do roadmap);
    - a **descrição do passo** no editor de playbook.
13. O conteúdo rico deve ser persistido como **HTML sanitizado** (sanitização com
    DOMPurify no cliente antes de enviar). Onde esse conteúdo é exibido (timeline de
    interações), deve ser renderizado de forma segura (HTML sanitizado). Onde só há
    espaço para um resumo em texto (ex.: preview de conversa no Inbox), o HTML deve
    ser reduzido a **texto puro** (strip de tags).

#### E. Contraste / aderência ao design system

14. O sistema deve substituir, em `PlaybooksManager.tsx`, todas as cores `slate-*`
    por tokens semânticos: texto de leitura → `text-primary`; meta (rótulos,
    "N passos", numeração, "Carregando…", "dias") → `text-secondary`; bordas →
    `border-default` (ocorrências conhecidas: linhas 128, 132, 135, 143, 205, 207,
    280).
15. O sistema deve corrigir os primitivos compartilhados que quebram contraste:
    `ui/select.tsx:98` (`focus:bg-gray-200 focus:text-gray-900` → tokens, ex.
    `focus:bg-action-primary focus:text-on-accent`); `ui/timeline.tsx` (`gray-*` →
    tokens); `ui/badge.tsx` e `ui/button.tsx` (`text-white` → `text-on-accent`).
16. O gate de cores (`npm run check:colors`) deve ser **endurecido** para detectar
    uso direto de `slate-*` (e demais famílias de cor do Tailwind fora do mapa de
    tokens) em `src/`, falhando quando encontrar — evitando a regressão que deixou
    essas cores passarem. Após o endurecimento, `check:colors` e `lint:css` devem
    passar limpos.

#### F. Botão de editar playbooks padrão

17. O botão de editar (lápis) deve permanecer **funcional para playbooks do tenant**
    e **somente-leitura para os playbooks padrão** (builtin), como já é hoje. Deve
    ganhar um **tooltip** no lápis desabilitado explicando o porquê (ex.: "Playbook
    padrão não é editável"), para não parecer quebrado.

### Fora do Escopo

- **Não** permitir editar/duplicar os playbooks padrão (decisão: somente-leitura).
- **Não** criar um segundo campo de prazo de conclusão (SLA reaproveita o
  `offsetDays`/`dueDate` existente).
- **Não** implementar atribuição automática por função "primeiro usuário do papel"
  (o mapeamento é manual, com pré-preenchimento).
- **Não** propagar/persistir `targetRole` na Task (segue como hoje).
- **Não** adicionar formatação além de negrito/itálico/listas/link (sem imagens,
  tabelas, cores de fonte, upload).
- **Não** trocar de editor os campos fora da feature de Playbook/Desdobramento
  (ex.: campanhas de e-mail seguem no GrapesJS).
- **Não** tocar backend além do necessário para os campos/enum/mapeamento acima.

## Restrições

- **Multi-tenant:** toda query nova filtra por `tenantId`; o mapeamento só oferece
  usuários do tenant atual.
- **Produção:** app já em produção (tenant k2). Migração Prisma **aditiva** (colunas
  opcionais + enum) para não quebrar dados existentes; entrega em **branch dedicada**
  e deploy como release único; migração aplicada antes do deploy do frontend.
- **Permissões:** editar playbooks segue restrito a ADMIN (como hoje); definir
  `User.commercialFunction` restrito a ADMIN/GESTOR.
- **Speech-to-text:** Web Speech API é suportada em Chrome/Edge; Firefox não —
  requisito 11 cobre a degradação. Sem dependência de serviço externo pago.
- **Segurança:** HTML rico sempre sanitizado antes de persistir e ao renderizar
  (prevenir XSS na timeline/inbox).
- **Design system:** só tokens semânticos `var(--vyd-*)`; nada de hex/rgb/`slate`/
  `gray` literais (o gate endurecido passa a garantir isso).
- **Verificação:** feita em dev/preview local; não validar contra o banco de
  produção (o registro de ação cria interações reais).

## Casos Extremos

- **Playbook sem nenhuma `responsibleFunction`:** a criação de desdobramento não
  mostra mapeamento; Tasks caem no criador (comportamento atual).
- **Função usada em passos, mas nenhum usuário com aquele `commercialFunction`:** o
  seletor aparece vazio (sem pré-preenchimento); se não for preenchido, as Tasks
  daquele passo caem no criador.
- **Navegador sem Web Speech API:** o botão de voz some; o editor de texto rico
  continua utilizável (digitação normal).
- **Ditado com falha/permissão de microfone negada:** o editor mostra um aviso não
  bloqueante e mantém o texto já digitado; não perde conteúdo.
- **Conteúdo HTML malicioso/colado:** sanitização remove scripts/handlers; a
  timeline nunca executa HTML não sanitizado.
- **Ação sem `dueDate`:** nunca marcada como "Atrasado".
- **Playbook padrão:** lápis desabilitado com tooltip; nenhuma tentativa de PUT.
- **Passo sem título:** validação atual (não salvar) permanece.

## Definição de Concluído

- [ ] Migração Prisma aditiva: enum `CommercialFunction`, `PlaybookStep.responsibleFunction?`, `User.commercialFunction?` — aplicada sem quebrar dados.
- [ ] Editor de playbook: Select "Função responsável" por passo; "dias" rotulado "SLA (dias)"; salva/carrega `responsibleFunction` (create e edit).
- [ ] Gestão de Equipe: admin/gestor define `commercialFunction` de um usuário; persiste.
- [ ] "Novo desdobramento" com playbook que usa funções mostra o mapeamento função→pessoa, pré-preenchido pelo `commercialFunction` do usuário.
- [ ] Ao aplicar, cada Task nasce atribuída à pessoa mapeada da função do seu passo; passo sem função/não mapeado cai no criador.
- [ ] Agenda do desdobramento mostra badge "Atrasado" em ações vencidas não concluídas (token de perigo), e não mostra em concluídas/sem prazo.
- [ ] Editor de texto rico (negrito/itálico/listas/link) presente na nota de Registrar ação, nas notas do desdobramento e na descrição do passo.
- [ ] Botão de ditado por voz pt-BR insere texto no cursor; oculto quando não suportado; erro de microfone não perde conteúdo.
- [ ] Conteúdo rico salvo como HTML sanitizado; timeline renderiza seguro; preview do Inbox mostra texto puro.
- [ ] `PlaybooksManager` sem `slate-*`; `select.tsx`/`timeline.tsx`/`badge.tsx`/`button.tsx` sem `gray-*`/`text-white` — só tokens.
- [ ] `check:colors` endurecido falha em `slate-*`/`gray-*` diretos; `check:colors` + `lint:css` passam limpos no código final.
- [ ] Lápis dos playbooks padrão desabilitado com tooltip explicativo; editar playbook do tenant funciona (create + update).
- [ ] `cd server && npx vitest run && npm run build` e `npm run build` (frontend) sem erros.
- [ ] Verificação visual em dev/preview: editar playbook (com função + SLA), criar desdobramento com mapeamento, registrar ação com voz+rich text, contraste OK em dark e light.
- [ ] Entregue em branch dedicada, para deploy como release único.
