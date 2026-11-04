---
forge_id: FRG-175
slug: deletar-campo-hora-do-ultimo-contato-ao-criar-um-novo-deal
---
# O campo "Hora do último contato" sai do formulário de negócio

## O que muda para você

Hoje, quando você abre **Novo negócio**, no fim do formulário aparece um bloco
chamado **Campos personalizados**. Dentro dele vem o campo **Hora do último
contato**, que não tem relação nenhuma com negócio.

Depois desta mudança, esse campo não aparece mais ali — nem quando você cria um
negócio, nem quando abre um negócio que já existe para editar.

Leia com atenção o que **não** muda: o bloco **Campos personalizados**
**continua aparecendo**, agora com onze campos em vez de doze. Entre os que
ficam está a **Data do último contato**, que é o par natural da hora. Só a hora
sai. Se a sua expectativa era o bloco inteiro desaparecer, esta entrega não faz
isso — e este é o ponto principal a conferir antes de aprovar.

## Por que esta mudança está sendo feita

Esse campo, e outros onze com ele, não foram criados por ninguém da equipe
pensando em negócios. Eles nasceram na importação da base antiga de empresas e
contatos: cada coluna daquelas planilhas virou um campo personalizado no
sistema.

Na época em que foram criados, o sistema ainda não tinha como dizer a que tipo
de cadastro cada campo pertence. Quando essa informação passou a existir, os
campos antigos ficaram sem ela — e o sistema, por segurança, trata campo sem
dono como campo que vale para tudo. Por isso eles aparecem no formulário de
negócio, que não é o lugar deles.

A correção é dizer, para este campo, que ele pertence ao cadastro de **empresa**.
Com isso ele deixa de ser oferecido no formulário de negócio. Nenhuma
informação é apagada: o campo continua existindo e tudo o que a importação
gravou nele continua guardado.

## Como fica na prática

1. Você abre o menu de **Negócios** e clica em **Novo negócio**.
2. Preenche o formulário como sempre: nome, valor, etapa, responsável, e o
   restante.
3. Ao chegar ao fim do formulário, no bloco **Campos personalizados**, o campo
   **Hora do último contato** não está mais na lista. Os outros onze
   continuam, na mesma ordem de antes, só sem ele.
4. Você salva o negócio normalmente. Nada no modo de salvar muda.
5. Ao abrir um negócio que já existe para editar, vale o mesmo: o campo não
   aparece mais.

Se algum negócio antigo já tinha uma hora preenchida nesse campo, esse valor
fica guardado, mas deixa de ser mostrado e de ser editável por essa tela.

Para quem administra o sistema: na tela de **Campos personalizados**, o campo
**continua listado**, e continua podendo ser editado ou excluído como hoje. A
mudança não o esconde de lá — ela só o retira do formulário de negócio.

## O que não muda e o que ficou de fora

- **Os outros onze campos da importação antiga continuam no formulário de
  negócio**, inclusive a **Data do último contato**, o **Celular**, o
  **Total**, as **Vendas** e os demais. Tirar todos eles, ou resolver de uma
  vez a causa que faz campo antigo aparecer onde não devia, é um pedido
  separado — e maior do que este.
- **Nada é apagado.** A definição do campo continua existindo e os valores já
  gravados continuam guardados. Esta entrega não limpa nenhum dado.
- **Nenhum outro cliente do sistema é afetado.** A correção vale para a sua
  empresa, que é onde a importação criou esses campos. Em outras empresas, se
  um dia alguém importar uma base do mesmo jeito, o mesmo incômodo pode
  aparecer.
- **O campo não passa a aparecer numa tela de empresa.** Dizemos ao sistema que
  ele pertence a empresa, mas hoje não existe formulário de empresa que mostre
  campos personalizados. Na prática, depois desta mudança o campo e o que ele
  guarda ficam visíveis apenas para quem administra os campos.
- **Não há como tirar o campo só da criação e deixá-lo na edição.** As duas
  telas são o mesmo formulário. Como o pedido foi que o campo saísse, ele sai
  das duas.
- **Na tela de criação de campos personalizados nada muda.** Ela continua sem
  um lugar para escolher a que tipo de cadastro o campo novo pertence — o que
  significa que um campo criado por lá hoje voltará a aparecer no formulário de
  negócio. Resolver isso é outro pedido, e está registrado.

## Como você vai saber que ficou pronto

- Você abre **Novo negócio** e, no bloco **Campos personalizados** no fim do
  formulário, **não encontra** mais o campo **Hora do último contato**.
- No mesmo bloco, você **ainda encontra** os outros onze campos, entre eles a
  **Data do último contato**.
- Você abre um negócio que já existe para editar e confirma a mesma coisa: o
  campo não está lá.
- Você salva um negócio novo e ele é salvo normalmente, sem erro.

Vale saber **quando** você poderá conferir isso: a mudança só tem efeito depois
que a nova versão entra no ar. Antes disso, numa prévia, o campo ainda aparece —
e isso é esperado, não é falha. As duas conferências acima são feitas por uma
pessoa depois da publicação.

E vale saber uma coisa desconfortável, dita de propósito: **a entrega pode ser
aceita antes de alguém ter visto o campo sair da tela.** A conferência final não
está travando a aceitação, porque ela depende de uma etapa que não está nas mãos
de quem constrói. Se você preferir que a aceitação espere pela conferência na
tela, basta dizer isso na aprovação.

## O que ficou decidido sem perguntar

**Ninguém da equipe respondeu às perguntas desta demanda.** Todas as oito
respostas que orientaram esta especificação foram preenchidas automaticamente
pelo sistema, e todas estão marcadas para serem revistas agora, na aprovação. O
que está escrito abaixo é o que foi decidido sem confirmação de uma pessoa.

- **Só a hora sai; os outros onze campos ficam, inclusive a data.** Foi a
  decisão automática mais consequente, porque o pedido falava só da hora. **É o
  ponto mais provável de você querer corrigir**: se o que incomoda é o bloco
  inteiro, ou se a data deve sair junto com a hora, diga agora.
- **O campo não é apagado, é realocado.** Decidiu-se não excluí-lo, porque
  excluir apagaria também o campo no cadastro de empresa, onde a importação
  gravou informação.
- **A correção vale só para a sua empresa.** Nenhum outro cliente foi verificado
  nem protegido.
- **O campo sai da criação e da edição.** Não se tentou separar as duas.
- **O print que veio junto com o pedido não foi lido.** O sistema não consegue
  ler imagens, então tudo o que esta especificação afirma sobre onde o campo
  aparece veio da leitura do próprio programa, não da sua tela. Se o campo que
  incomoda estiver em outro lugar da tela de negócios, esta entrega mira no
  lugar errado.
- **O nome do campo foi tomado do programa, não do print.** Assumiu-se que ele
  se chama exatamente **Hora do último contato**. Se o nome real tiver qualquer
  diferença, a correção não encontra o campo e nada muda na tela — sem dar erro.
  É o motivo de a conferência na tela existir.
- **Não foi possível consultar a base de dados** para confirmar nada disso antes
  de escrever. Tudo o que está afirmado sobre o que existe hoje foi lido no
  programa que criou esses campos.
- **Há um risco declarado, pequeno e não verificado.** Se este campo estiver
  marcado como obrigatório em alguma etapa de algum funil de negócios, depois
  da mudança essa etapa passará a exigir um campo que o formulário não mostra
  mais, e o negócio pode travar ali. Não houve como verificar se isso acontece.
  Se você souber que esse campo é exigido em alguma etapa, diga na aprovação.
