---
forge_id: FRG-178
slug: atualizacao-do-modelo-de-planilha-para-importacao-de-lead
---
# O modelo de planilha de importação passa a ter todos os campos do lead

## O que muda para você

Hoje, quando você abre **Importar Leads** na tela de Leads e clica em **Baixar
Template**, vem uma planilha com **seis** colunas: nome, e-mail, telefone,
empresa, origem e status. A criação manual de um lead pede **bem mais** que
isso, e nada do que falta na planilha tem como ser preenchido numa carga em
massa.

Depois desta mudança, o modelo passa a ter **dezessete** colunas — as seis de
hoje, com o mesmo nome e na mesma ordem, e onze novas depois delas. As novas
cobrem o que a tela de criação manual pede e a planilha não tinha: o CNPJ da
empresa, o contato da empresa, o cargo, o motivo e a nota do motivo quando o
lead está pausado, cancelado ou encerrado, as informações da oportunidade, o
valor estimado, o prazo estimado, a probabilidade Go×Get e o e-mail do
responsável comercial.

Duas coisas que você precisa saber antes de aprovar, porque mudam o seu dia:

**Primeira: Empresa e Contato passam a ser obrigatórios na importação.** Hoje
você consegue subir uma planilha de leads soltos, sem empresa e sem contato
ligados. Depois desta mudança, não mais: cada linha tem que apontar para uma
empresa e para um contato **que já estejam cadastrados** no sistema. A linha
que não apontar é recusada. Isso deixa a importação igual à criação manual,
onde os dois já são obrigatórios — mas significa que **as suas planilhas
antigas param de funcionar como estão**. Se a sua ideia era continuar subindo
listas de leads sem vínculo, é aqui que você precisa dizer que não quer esta
mudança.

**Segunda: o modelo de hoje está quebrado, e isso também é consertado.** A
planilha de exemplo que o sistema entrega vem com uma origem e um status
escritos num código antigo, que o sistema não reconhece mais. Se você baixa o
modelo, preenche e sobe, a importação **falha inteira** — não entra nenhum
lead, nem os que estavam certos. Depois desta mudança, o exemplo vem com
valores reais e os códigos antigos passam a ser aceitos e traduzidos, para que
quem já tem a planilha velha salva no computador não fique travado.

## Por que esta mudança está sendo feita

Você pediu, no texto da demanda, que o modelo passasse a ter todos os campos do
lead e que a carga em massa criasse o lead já preenchido. São dois pedidos, e
hoje falham os dois lados.

Do lado da planilha, faltam onze colunas. Do lado do carregamento, falta mais:
mesmo que você acrescentasse as colunas à mão, o sistema **não saberia o que
fazer com elas** — ele só aceita oito campos na importação, e nenhum deles é o
valor estimado, o prazo, a probabilidade, o responsável ou o motivo. Há até um
caso menor e irritante: a coluna de status já vem no modelo de hoje, o sistema
lê o arquivo, e **descarta** o que está nela, porque não existe onde encaixá-la.

A parte boa é que o miolo do sistema já está pronto. A camada que grava o lead
já conhece todos esses campos e já sabe validar cada um deles — é a mesma que a
criação manual usa. O que falta é o caminho entre a planilha e ela. Por isso
esta entrega mexe em poucos lugares: o modelo, o mapeamento das colunas e a
porta de entrada da importação.

## Como fica na prática

1. Você abre a tela de **Leads** e clica em **Importar Leads**.
2. Clica em **Baixar Template**. Vem a planilha com as dezessete colunas.
3. Preenche. Para cada linha:
   - **Empresa:** escreve o nome da empresa como ela está cadastrada, ou o CNPJ
     dela na coluna própria. Se preencher os dois e eles apontarem para
     empresas diferentes, a linha é recusada — é sinal de planilha errada.
   - **Contato:** escreve o e-mail do contato, ou o nome dele. O contato tem
     que ser **daquela** empresa.
   - **Origem** e **Status:** escreve como aparece na tela ("Prospecção ativa",
     "Em Andamento") ou o código interno; maiúsculas, minúsculas e acentos não
     importam. Se deixar vazio, entra como "Novo" e "Outros".
   - **Motivo:** só preenche quando o status é Pausado, Cancelado ou Encerrado
     — e aí é **obrigatório**, igual à tela. Se o motivo for "Outro", a nota
     também é obrigatória.
   - **Valor estimado:** pode escrever no padrão brasileiro, com vírgula
     decimal, ou com ponto. Símbolo de moeda e separador de milhar não
     incomodam.
   - **Probabilidade Go×Get:** número inteiro de 0 a 100, sem o sinal de
     porcentagem.
   - **Responsável comercial:** o e-mail da pessoa no sistema. Deixar vazio
     cria o lead sem responsável; escrever um e-mail que não existe recusa a
     linha, para a atribuição não se perder sem você ver.
4. Volta à tela, escolhe o arquivo e segue para o mapeamento. As colunas da
   planilha nova são reconhecidas sozinhas; as suas planilhas antigas
   continuam reconhecidas nas seis colunas que já existiam.
5. Na tela de conferência, se a planilha **não** tiver as colunas de empresa e
   contato, aparece um aviso dizendo que nenhuma linha vai entrar — **antes**
   de você confirmar, não depois.
6. Você confirma. Ao fim, além dos números de importados, duplicados e com
   erro, aparece a **lista de erros**: o número da linha e o motivo de cada
   recusa. Hoje essa lista é calculada pelo sistema e jogada fora antes de
   chegar à tela; passa a aparecer.
7. Corrige as linhas recusadas na planilha e sobe de novo, se quiser.

O teto continua sendo mil linhas por arquivo, como hoje — e a tela passa a
dizer isso, em vez de a importação morrer sem explicação.

## O que não muda e o que ficou de fora

- **A outra tela de importação não é tocada.** Existe uma segunda tela de
  importação, dentro das configurações, só para quem administra o sistema. Ela
  casa coluna a campo, aceita Excel e já aceita mais campos — mas **não
  oferece modelo para baixar**, então não há modelo dela para adequar. Ela
  continua exatamente como está, inclusive com uma diferença que fica
  consciente: lá, um valor de origem que o sistema não reconhece é ignorado em
  silêncio; na tela de Leads, passa a recusar a linha.
- **Etiquetas e campos personalizados não entram no modelo.** Eles não
  aparecem na tela de criação manual, e o pedido foi "os campos da criação
  manual". Se você quiser, é um pedido separado.
- **A importação não cria empresa nem contato que não existam.** Ela só liga
  a cadastros que já estão lá. Criar empresa e contato na própria importação é
  outro pedido — e, se a sua planilha real tiver contatos ainda não
  cadastrados, é provável que você queira fazer esse pedido depois de testar.
- **A planilha continua em formato de texto separado por vírgula, e não vira
  Excel.** Por isso também não tem lista de valores para escolher nem aba de
  instruções.
- **Os títulos das colunas continuam em inglês.** Traduzir os seis títulos que
  já existem faria o sistema deixar de reconhecer as planilhas que você já tem
  salvas.
- **A aparência da tela de importação não é refeita.** Ela usa um visual
  antigo, de antes do padrão atual do sistema. O que for acrescentado agora
  segue o padrão novo, mas o resto da tela fica como está — refazer tudo é
  outra entrega.
- **Quem pode importar continua o mesmo.** Nenhuma permissão muda.

## Como você vai saber que ficou pronto

- Você baixa o modelo e conta **dezessete** colunas, com as seis antigas nas
  seis primeiras posições, e a linha de exemplo **não** traz mais os códigos
  antigos de origem e status.
- Você sobe uma planilha com **cinco linhas**, usando empresas e contatos que
  já existem no seu cadastro, e os cinco leads aparecem na lista com Empresa,
  Contato, Responsável, Status, Origem, Valor estimado e Probabilidade
  preenchidos.
- Você sobe uma planilha com **uma linha boa e uma linha de empresa que não
  existe**, e o resultado mostra **um** importado e **um** com erro, com a
  lista de erros nomeando o número da linha e o motivo. Hoje, uma linha ruim
  derruba o arquivo inteiro e nada entra — é exatamente essa diferença que
  prova a entrega.
- Você sobe uma planilha antiga, só com as seis colunas de antes, e a tela
  avisa, **antes** de você confirmar, que nenhuma linha vai entrar.
- Você sobe uma linha com status Pausado e sem motivo, e ela é recusada com a
  mesma mensagem que a tela de criação manual dá.

Esse teste com a sua planilha de verdade, no sistema no ar, é **conferência de
campo** e acontece **depois** que a mudança entrar — o aceite não fica
esperando por ele, porque os testes automáticos já provam o comportamento do
sistema. Vale dizer em voz alta o que esse teste pode revelar: se boa parte dos
contatos da sua planilha não estiver cadastrada, muitas linhas vão ser
recusadas, e a conclusão será que você precisa daquele pedido separado de criar
empresa e contato durante a importação.

## O que ficou decidido sem perguntar

Esta demanda teve uma rodada de perguntas, e **todas as dez respostas foram
dadas pela rotina automática, não por você**. Cada uma delas está marcada como
decisão a rever nesta aprovação. São estas:

1. **Só a tela de Importar Leads recebe o modelo novo**, não a tela de
   importação das configurações.
2. **A lista de campos foi tirada do sistema, não da sua imagem.** A imagem que
   você anexou com os campos da criação manual **não pôde ser lida** pelo
   sistema. A lista desta entrega foi montada lendo a tela de criação de lead
   por dentro — e ela corrigiu a suposição da rotina num ponto: a tela **não**
   tem e-mail, telefone nem cargo. Esses três continuam no modelo porque já
   estavam lá antes. **Conferir a lista contra a sua imagem é o item mais
   importante desta aprovação.**
3. **Empresa e Contato são identificados por registros que já existem** — pelo
   nome ou CNPJ da empresa, pelo e-mail ou nome do contato — e a importação não
   cria nenhum dos dois.
4. **Empresa e Contato são obrigatórios**, e planilha antiga sem essas colunas
   passa a ter todas as linhas recusadas. É a decisão de maior consequência
   desta entrega; se você quiser o contrário, é aqui que se corrige.
5. **Etiquetas e campos personalizados ficam fora do modelo.**
6. **O responsável comercial é identificado só pelo e-mail**, nunca pelo nome,
   porque nome se repete.
7. **Origem e Status aceitam o nome da tela e o código interno**, sem ligar
   para maiúsculas e acentos; vazio assume Novo e Outros; valor preenchido e
   não reconhecido recusa a linha. A esta decisão a entrega **acrescentou** o
   aceite dos códigos antigos, que não foi perguntado — é o que destrava quem
   já tem a planilha velha salva.
8. **O motivo é exigido nos status Pausado, Cancelado e Encerrado**, com a
   mesma régua da tela, reaproveitando a validação que já existe.
9. **A planilha continua em texto separado por vírgula, com títulos em
   inglês**, e as colunas novas entram depois das seis antigas.
10. **Valor estimado aceita vírgula ou ponto decimal; a probabilidade é inteiro
    de 0 a 100 sem o sinal de porcentagem**, e fora disso a linha é recusada.

Além dessas dez, a escrita da especificação decidiu por conta própria oito
pontos que a rodada de perguntas não cobriu: **os nomes das onze colunas
novas** e a ordem delas; que **uma célula ruim recusa só a linha, nunca o
arquivo inteiro** (sem isso, nada do que foi decidido acima funciona); que **a
lista de erros passa a aparecer na tela**; que o **nome da empresa continua
sendo guardado como texto**, além de servir para encontrar o cadastro; que a
busca dos vínculos é feita **de uma vez para o arquivo todo**, por desempenho;
que **nome repetido recusa a linha** em vez de o sistema escolher um cadastro
em silêncio; e que **a aparência da tela não é refeita** agora.
