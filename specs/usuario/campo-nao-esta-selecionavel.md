---
forge_id: FRG-156
slug: campo-nao-esta-selecionavel
---
# O campo Empresa volta a abrir a lista no cadastro de lead

## O que muda para você

Hoje, ao cadastrar um lead novo, você clica no campo **Empresa** — aquele
botão escrito "Selecione a empresa" — e nada acontece. A lista não aparece.

Depois desta correção, o clique abre a lista logo abaixo do botão, como
sempre deveria. O mesmo vale para o campo **Contato**, logo abaixo, que está
com o mesmo problema pela mesma razão.

Nada do que já existe nesses campos é retirado. A caixa para digitar e filtrar
continua lá, e a opção de cadastrar uma empresa nova sem sair da tela do lead
também.

## Por que esta mudança está sendo feita

Esses dois campos são obrigatórios para salvar um lead novo. Como a lista não
abre, não há como escolher a empresa nem o contato — e, sem eles, o sistema
recusa o cadastro. Na prática, **nenhum lead novo consegue ser cadastrado por
essa tela hoje**, e não existe um jeito de contornar isso por dentro do
formulário.

Investigando, encontramos a causa: a listinha até é montada por baixo dos
panos, mas o sistema não consegue descobrir onde encaixá-la na tela, e acaba
guardando-a fora da área visível. Por isso o clique parece não fazer nada —
não é lentidão, nem falta de empresas cadastradas, nem permissão de acesso.

A mesma causa afeta outros onze pontos do sistema onde uma listinha ou um
menuzinho deveria abrir ao lado de um botão. Por isso a correção vai na
origem do problema, e não só no campo Empresa: assim todos voltam a funcionar
de uma vez, em vez de consertarmos um agora e descobrirmos os outros aos
poucos.

## Como fica na prática

1. Vá em **Leads** e clique em **Novo Lead**.
2. No campo **Empresa**, clique no botão "Selecione a empresa".
3. A lista abre logo abaixo do botão, com a mesma largura dele, trazendo uma
   caixa de busca no topo e as empresas cadastradas embaixo.
4. Digite parte do nome para filtrar, ou role a lista.
5. Clique na empresa desejada: a lista fecha e o nome dela fica escrito no
   botão.
6. Se a empresa ainda não existir, use a opção de criar uma empresa nova ali
   mesmo, informando o nome (e, se quiser, o documento da empresa e o
   segmento). Ela é criada e já fica escolhida no lead.
7. Se você tentar criar uma empresa com um nome que já existe, o sistema
   avisa e oferece usar a que já está cadastrada.
8. Repita o mesmo no campo **Contato**, logo abaixo.
9. O mesmo comportamento vale ao abrir um lead já existente para editar, na
   janela que se abre por cima da lista.

Se a sua conta ainda não tiver nenhuma empresa cadastrada, a lista vai abrir
avisando que não há empresas. Isso também é o campo funcionando: ele abriu e
mostrou o que tem.

## O que não muda e o que ficou de fora

**Não muda:**

- A busca por digitação continua igual.
- A criação rápida de empresa por dentro do cadastro do lead continua
  disponível, exatamente como está hoje, para quem tem permissão de cadastrar
  empresas. Quem não tem essa permissão continua sem ver essa opção, e mesmo
  assim consegue abrir a lista e escolher.
- Empresa e contato seguem obrigatórios para salvar um lead novo, e opcionais
  ao editar um lead antigo.
- Cada lead continua ligado a uma empresa.

**Ficou de fora desta entrega:**

- Mudar a ordem em que as empresas aparecem na lista.
- Mostrar mais de cinquenta empresas de uma vez sem digitar uma busca. Quando
  houver mais que isso, a lista continua avisando quantas está mostrando e
  pedindo que você refine a busca.
- Revisar um a um os outros pontos do sistema afetados pela mesma causa. Eles
  são consertados pela mesma mudança, mas conferir tela por tela é trabalho de
  outra demanda.

## Como você vai saber que ficou pronto

- Em **Novo Lead**, clicar no campo **Empresa** abre a lista abaixo do botão,
  com a caixa de busca visível e com a mesma largura do botão.
- Escolher uma empresa fecha a lista e deixa o nome dela no botão.
- O campo **Contato** faz a mesma coisa.
- Abrindo um lead que já existe para editar, os dois campos abrem a lista do
  mesmo jeito, aparecendo por cima da janela e sem ficar cortados.
- A opção de criar uma empresa nova por dentro do cadastro continua
  aparecendo, abre o formulário curto e deixa a empresa criada já selecionada
  no lead.
- É possível, enfim, preencher e **salvar um lead novo do começo ao fim**.

## O que ficou decidido sem perguntar

Esta é a parte que pede a sua conferência na aprovação. A entrevista desta
demanda foi respondida pelo próprio sistema, não por uma pessoa: **ninguém
confirmou o que aparece na sua tela**. Tudo abaixo foi decidido sem resposta
humana.

- **Assumimos que o sintoma é "clico e não aparece nada".** Foi o que o texto
  do chamado sugeriu. A causa que encontramos produz exatamente isso. **Mas se
  o que acontece com você for diferente — a lista ABRE e vem vazia —, então
  esta correção está mirando no alvo errado**, e o problema seria outro: de
  cadastro de empresas ou de permissão de acesso. Vale confirmar isso na
  aprovação.
- **A imagem anexada ao chamado não foi lida.** O sistema não consegue ler o
  conteúdo de imagens, e preferimos não adivinhar o que ela mostra. Nada desta
  proposta veio dela.
- **Decidimos corrigir a origem do problema, e não só o campo Empresa.**
  Ninguém pediu isso. Escolhemos assim porque o mesmo defeito atinge outros
  onze pontos do sistema, e remendar só este deixaria os demais quebrados.
- **Incluímos também um acerto na largura da lista**, que hoje não acompanha o
  botão por um detalhe de configuração visual. Não foi perguntado; entrou
  porque é a primeira coisa que você veria de errado assim que a lista voltasse
  a abrir, e o ajuste é mínimo. Se preferir tratar isso à parte, é só dizer na
  aprovação: o resto da entrega não depende disso.
- **Uma decisão anterior foi descartada.** Numa primeira rodada, sem acesso ao
  código, o sistema havia decidido que o campo não deveria ter criação de
  empresa embutida. Conferindo depois, esse recurso **já existe e está no ar** —
  segui-la teria removido algo que você já usa. Por isso foi desconsiderada.
- **Também não sabemos** em qual navegador ou aparelho o problema foi visto,
  nem desde quando. A correção não depende disso: a causa encontrada não é
  específica de navegador.
