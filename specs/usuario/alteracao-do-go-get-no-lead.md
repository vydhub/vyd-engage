---
forge_id: FRG-157
slug: alteracao-do-go-get-no-lead
---
# Probabilidade Go×Get: digitar o número em vez de escolher da lista

## O que muda para você

O campo **Probabilidade Go×Get**, no cadastro e na edição de um lead, deixa de
ser uma lista de opções fechadas e passa a ser um campo onde você digita o
número que quiser.

Hoje só existem cinco escolhas: 10%, 25%, 50%, 75% e 90%. Depois desta mudança
você pode registrar 37%, 60%, 85% — qualquer número inteiro de 0 a 100.

## Por que esta mudança está sendo feita

Porque a lista obriga a arredondar. Quando a sua leitura do negócio é 60%, você
hoje precisa escolher entre 50% e 75%, e o número que fica guardado no lead não
é o número em que você acredita. Quem lê esse lead depois — você mesmo daqui a
duas semanas, ou o colega que assumir a conta — lê o arredondamento como se
fosse a avaliação original.

Com o número digitado, o que fica registrado é o que você quis dizer.

## Como fica na prática

1. Abra um lead para cadastrar ou para editar. O campo **Probabilidade Go×Get**
   está onde sempre esteve, logo abaixo do **Valor estimado** e do **Prazo
   estimado**.
2. No lugar da caixa de seleção, você encontra um campo de digitação com o sinal
   de porcentagem ao lado — no mesmo formato do campo de valor estimado, que já
   mostra o "R$".
3. Digite o número. Só entram algarismos: se você tentar digitar vírgula, ponto
   ou letra, nada aparece. Não há casas decimais.
4. Se você digitar um número maior que 100, o sistema avisa e não deixa salvar
   até você corrigir.
5. Para deixar a probabilidade sem definição, apague o conteúdo do campo e
   salve. O lead fica sem probabilidade, do mesmo jeito que hoje acontece quando
   você escolhe "Não definida".
6. Zero é um número válido e diferente de vazio: se você digitar 0 e salvar, o
   lead passa a mostrar 0%, e não um traço.
7. O valor aparece como antes — com o sinal de porcentagem — na tela de detalhe
   do lead e no painel lateral que abre ao lado da lista.

Os leads que você já cadastrou continuam exatamente como estão. Um lead salvo
hoje com 75% abre com 75% no campo novo, pronto para editar. Nenhum número
existente é perdido, convertido ou mexido.

## O que não muda e o que ficou de fora

**Não muda:**

- Preencher a probabilidade continua sendo **opcional**. Nenhum lead passa a
  exigir esse campo.
- O campo continua sendo percentual, sempre número inteiro.
- Quando você converte um lead em oportunidade, a probabilidade continua sendo
  copiada para a oportunidade como já era.
- A exportação de leads continua trazendo a mesma coluna, com o mesmo conteúdo.

**Ficou de fora desta entrega:**

- **Filtrar, ordenar ou agrupar leads por probabilidade.** Hoje isso não existe
  em nenhuma tela, lista ou relatório, e esta mudança não cria. Se você precisar
  procurar leads por faixa de probabilidade — "todos entre 60% e 90%" —, isso é
  um pedido separado.
- **Botões de atalho com os valores antigos.** A lista de cinco opções some por
  completo; não fica nenhum botão de 10/25/50/75/90 ao lado do campo para
  preencher com um clique. Esta é uma decisão tomada sem perguntar, e está
  listada na última seção.

## Como você vai saber que ficou pronto

- Ao cadastrar um lead novo, o campo Probabilidade Go×Get aceita você digitar
  **37** e salva o lead com 37%.
- Ao abrir esse lead no detalhe, e também no painel lateral da lista, a
  probabilidade aparece como **37%**.
- Ao editar o lead, apagar o campo e salvar, o detalhe passa a exibir um traço
  no lugar da probabilidade.
- Digitando **0** e salvando, o lead mostra **0%** — não um traço.
- Digitando **150**, o sistema avisa e não deixa salvar.
- Digitando **abc**, nada é escrito no campo.
- Digitando **007**, o campo fica com **7**.
- Um lead antigo, cadastrado com uma das cinco opções da lista, abre com aquele
  mesmo número e continua salvando normalmente.

## O que ficou decidido sem perguntar

Estas decisões foram tomadas pela rotina que preparou este documento, sem
confirmar com você. Todas podem ser corrigidas agora, na aprovação.

- **A lista de cinco opções some inteira, sem virar atalho.** Poderíamos ter
  mantido 10/25/50/75/90 como botões clicáveis ao lado do campo digitado, para
  quem já usava esses valores continuar preenchendo com um clique. A rotina
  decidiu não fazer isso, porque não existe nenhum campo assim no sistema hoje e
  criar esse comportamento do zero mexeria em mais partes da tela do que o
  pedido cobre. **Se você quiser os atalhos, é aqui que se pede.**

- **A faixa aceita vai de 0 a 100, com o zero valendo como resposta.** Foi
  assumido que 0% quer dizer "probabilidade nula" — uma avaliação de verdade —
  e não "ainda não avaliei", que é o campo vazio. Se zero não fizer sentido no
  seu processo, a faixa passa a começar em 1.

- **Números com zero na frente são limpos.** Nada foi perguntado sobre isso.
  Foi assumido que digitar 007 deve resultar em 7.

- **Formulário deixado pela metade antes desta mudança.** O sistema guarda o que
  você digitou num cadastro não finalizado. Não foi perguntado o que fazer com
  um cadastro guardado antes desta entrega; foi assumido que ele precisa
  continuar abrindo sem erro depois, com a probabilidade preservada.

- **A imagem anexada ao pedido não foi lida.** O pedido veio com uma captura de
  tela que o sistema não conseguiu interpretar automaticamente. Nada neste
  documento veio dela. Se a imagem mostrava o campo de um jeito diferente do
  descrito aqui, vale apontar na aprovação.
