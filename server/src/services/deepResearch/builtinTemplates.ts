// Templates semente da Pesquisa Profunda (Deep Research).
//
// Fonte única de verdade dos prompts-modelo. Usado pelo seed e pelo
// auto-provision lazy (templateService.ensureBuiltins). A seção de saída pede
// Markdown estruturado (renderizado como site pelo Engage) em vez de HTML.
//
// Placeholders são escritos no formato [TEXTO] — o frontend os detecta e gera
// um campo preenchível por placeholder. Os modelos cobrem dois recortes:
//   - "Empresa": pesquisa sobre uma empresa específica;
//   - "Segmento": pesquisa sobre um segmento de mercado inteiro.

export interface BuiltinTemplate {
  name: string;
  description: string;
  promptBody: string;
}

export const EMPRESA_TEMPLATE_PROMPT = `Objetivo: gerar uma pesquisa comercial aprofundada sobre a empresa [EMPRESA] (setor: [SETOR]), para uso do time comercial de uma empresa de consultoria e serviços de engenharia, projetos e suprimentos. O leitor parte do desconhecimento total da conta e, ao terminar, precisa dominar: quais oportunidades existem, quanto valem, em que fase estão, quem decide, quando e como abordar.

Este relatório alimenta um CRM: cada oportunidade identificada aqui será cadastrada como negócio e trabalhada até um pedido de proposta. Escreva para esse uso — informação acionável, específica e datada. Estamos em 2026.

## Estrutura da pesquisa solicitada

### Capítulo 1 — Sumário Executivo Comercial
- A conta em até 6 bullets: quem é, tamanho, momento financeiro, direção estratégica e por que ela importa AGORA para quem vende engenharia, projetos e suprimentos;
- Tabela **Radar de Oportunidades** com TODAS as oportunidades detalhadas no Capítulo 2, ranqueadas por atratividade: Nº | Oportunidade | Valor estimado | Fase atual | Janela de contratação | Decisor provável | Próximo passo | Confiança;
- Leitura de momento: o que acontece nos próximos 12 meses que abre (ou fecha) janelas de entrada.

### Capítulo 2 — Fichas das Oportunidades
Para CADA linha do Radar, uma ficha padronizada (título de nível 3 com o nome da oportunidade) contendo os campos:
- **O que é** — descrição objetiva do projeto ou iniciativa;
- **Escopo aderente** — o que pode ser vendido em engenharia, projetos ou suprimentos dentro dela;
- **Valor e base** — investimento estimado, com ano-base e moeda (R$ e US$ quando possível);
- **Fase e maturidade** — estudo, licenciamento, engenharia conceitual/básica/detalhada, construção, comissionamento ou operação — sempre com a evidência da fase;
- **Janela de contratação** — quando os pacotes de serviços devem ir a mercado;
- **Modelo de contratação provável** — EPC, EPCM, pacotes especializados, LTA, reforço de equipe;
- **Stakeholders** — quem decide, quem influencia e quem pode vetar (nomes e cargos públicos);
- **Concorrência provável** — quem já está dentro e quem deve disputar;
- **Sinais e gatilhos** — eventos DATADOS que sustentam a ficha (licença, edital, audiência pública, contratação-chave, divulgação de CAPEX);
- **Riscos e incertezas** — o que pode atrasar, reduzir ou cancelar;
- **Próximo passo recomendado** — ação concreta para os próximos 30 dias.

Campo sem informação pública: escreva "não encontrado" e indique onde o time deve buscar (pessoa, documento ou canal). Nunca preencha com generalidades.

### Capítulo 3 — Panorama da Empresa
- Histórico, posicionamento, estrutura societária e controladores, unidades e localizações, produtos, volumes e mercados atendidos;
- Saúde financeira e capacidade de investimento (receita, margem, alavancagem, rating — quando públicos);
- Reputação como contratante (prazos de pagamento, litígios relevantes com fornecedores — quando públicos);
- Inclua APENAS o que muda a leitura comercial da conta; nada de biografia genérica.

### Capítulo 4 — Investimentos e CAPEX (2026 em diante)
- Diretrizes de CAPEX anunciadas e valores por projeto e por ano, separando expansão (greenfield/brownfield), sustentação e exploração/prospecção quando aplicável;
- Tabela consolidada: Projeto | Valor | Período | Categoria | Fase | Status | Fonte;
- Considere apenas investimentos que atravessam 2026 ou começam em 2026 ou depois; ignore os já concluídos; todo investimento citado precisa de data ou janela.

### Capítulo 5 — Maturidade e Janelas de Entrada
- Para cada projeto do Capítulo 4: fase atual (com evidência), próximos marcos decisórios e a janela em que serviços de engenharia, projetos e suprimentos são contratados;
- Distribuição percentual estimada dos custos por fase (engenharia conceitual/básica/detalhada, aquisição de equipamentos, construção e montagem, gerenciamento e comissionamento), quando houver base para estimar;
- Tabela: Projeto | Fase atual | Próximo marco | Janela para serviços | Urgência da abordagem.

### Capítulo 6 — Como a Empresa Contrata
- Processo e plataforma de compras (portal, cadastro e homologação de fornecedores: requisitos, prazos e passos práticos);
- Estrutura de contratação (EPC, EPCM, pacotes especializados, LTAs guarda-chuva) e nível de terceirização em engenharia, compras e obras;
- Política de conteúdo local e preferência por fornecedores nacionais ou regionais — e como usá-la a favor;
- Encerre com um passo a passo objetivo: o que fazer HOJE para estar apto a receber um convite de proposta desta empresa.

### Capítulo 7 — Mapa de Stakeholders (situação em 2026)
Este capítulo é o local CANÔNICO do organograma e do diretório de decisores da conta — a pesquisa de Segmento não traz diretório de decisores; ele vive aqui, completo.
- Lideranças relevantes para as oportunidades, nas áreas de Engenharia, Projetos, Suprimentos e Diretoria Executiva: nome, cargo, responsabilidades e contato institucional público;
- Apresente o diretório em tabela: Nome | Cargo | Área (Engenharia/Projetos/Suprimentos/Diretoria) | Responsabilidades | Contato institucional público | Classificação (decide/influencia/veta);
- Classifique cada um: decide | influencia | veta — amarrando às oportunidades do Capítulo 2 sempre que possível;
- Sinais públicos de cada stakeholder (entrevistas, palestras, publicações, movimentações de carreira) que sirvam de gancho de abordagem;
- Porta de entrada recomendada na conta e erros a evitar.

### Capítulo 8 — Concorrência na Conta
- Fornecedores de engenharia, consultorias técnicas, empreiteiras e montadoras que JÁ atuam com a empresa: contratos conhecidos, escopos, datas e se há LTA vigente;
- Forças e LACUNAS de cada incumbente — onde existe espaço real de entrada;
- Parcerias estratégicas da empresa que condicionam a disputa.

### Capítulo 9 — Sinais de Compra e Gatilhos de Timing
- Eventos datados dos últimos 18 meses e esperados para os próximos 12: licenças, audiências, editais, contratações-chave, guidance de CAPEX, M&A, mudanças regulatórias;
- Tabela ordenada do mais urgente ao menos urgente: Data | Sinal | O que indica | Implicação prática | Prazo sugerido de reação.

### Capítulo 10 — Plano de Ataque Comercial
- Sequência de abordagem em 30/60/90 dias, amarrada às fichas do Capítulo 2 e ao Radar do Capítulo 1;
- Mensagem-chave por stakeholder: o que dizer a cada decisor ou influenciador para gerar a primeira reunião;
- Objeções prováveis e como respondê-las;
- Critérios de qualificação: o que confirmar na primeira conversa para validar (ou descartar) cada oportunidade.

## Instruções de formato e qualidade
- Responda em português do Brasil, em **Markdown estruturado** (não HTML): título de nível 1 (#) para o relatório e de nível 2 (##) para cada capítulo, na ordem acima, para que o sumário navegável possa ser gerado.
- É PROIBIDO repetir fatos entre capítulos: escreva o fato uma única vez e use referência cruzada ("ver Capítulo 4"). Cada parágrafo deve trazer informação nova.
- Dados em **tabelas Markdown (GFM)**; prosa apenas para análise e interpretação. Sem frases de preenchimento ("é fundamental destacar…") desacompanhadas de fato.
- Marque o nível de confiança de cada informação relevante: fato com fonte numerada | inferência (com o raciocínio explícito) | **estimativa**.
- Todo investimento citado precisa de data ou janela, valor com ano-base e moeda (R$ e US$ quando possível).
- Termine cada capítulo com **Implicações para a abordagem** — no máximo 3 bullets, sem repetir fatos, apenas a consequência prática para o time comercial.
- O que não foi encontrado publicamente deve aparecer como "não encontrado — onde buscar: …". Lacuna silenciosa é proibida.
- Inclua uma seção final com o título "Fontes e Referências" (nível 2) listando todas as fontes numeradas utilizadas.
- Linguagem profissional e objetiva, adequada para apresentação à área comercial.`;

export const SEGMENTO_TEMPLATE_PROMPT = `Objetivo: gerar uma pesquisa aprofundada sobre o segmento de [SEGMENTO] em [REGIÃO], com foco em mapear oportunidades de negócio em engenharia, projetos e suprimentos — identificando commodities, empresas-alvo, ativos, investimentos, janelas de contratação e estratégia comercial. O relatório alimenta o CRM de uma consultoria de engenharia (TENAX): escreva informação acionável, específica e datada. Estamos em 2026.

## Estrutura da pesquisa solicitada

### Capítulo 1 — Escopo, premissas e leitura executiva
- Definição do escopo do segmento e do recorte geográfico ([REGIÃO]);
- Leitura executiva: atratividade do segmento, maturidade do pipeline e principais oportunidades;
- Ranking-resumo das melhores oportunidades comerciais (empresa/projeto, foco, tese resumida, janela principal).

### Capítulo 2 — Visão Geral do Segmento e Commodities
- Tendências de DEMANDA das principais commodities do segmento e tendências de PREÇOS, com **histórico dos últimos 12 meses** em tabela mês a mês: Mês | Preço | Unidade | Variação | Fonte — fonte e unidade explícitas em cada linha;
- **Produção por país**: ranking mundial dos maiores produtores de cada commodity (Posição | País | Volume | Unidade | Ano-base | Fonte);
- **Produção por empresa no Brasil**: ranking das empresas produtoras (Empresa | Volume | Unidade | Participação | Ano-base | Fonte);
- **Fatores de demanda** desdobrados em três categorias — estruturais (transição energética, urbanização, substituição de materiais), cíclicos (estoques, câmbio, ciclo econômico global) e regulatórios (políticas públicas, tarifas, licenciamento) — quantificados sempre que houver base pública;
- Posição de [REGIÃO] na cadeia de valor / oferta e arcabouço regulatório relevante.

### Capítulo 3 — Mapa de Empresas e Ativos no Território
- Tabela georreferenciada dos ativos do segmento: Empresa | Ativo/Projeto | Município/UF | Coordenadas (quando públicas) | Estágio (Greenfield ou Brownfield) | Status operacional;
- Classifique cada ativo como **Greenfield** (implantação nova) ou **Brownfield** (expansão/modernização de ativo existente);
- Cite as fontes de referência setoriais utilizadas (associações, agências reguladoras, anuários do setor);
- Quando o segmento for mineração, referencie o Mapa da Mineração Brasileira do IBRAM incluindo no relatório o link [Mapa da Mineração Brasileira — IBRAM](https://www.google.com/maps/d/u/0/viewer?mid=1cYf5kH02tHYtKnX9ZvTomkRMO0FhkBw&femb=1) — SEMPRE como link markdown, nunca como iframe ou embed.

### Capítulo 4 — Censo de Empresas do Segmento
- Lista de TODAS as empresas do segmento localizadas no Brasil ou com projetos a implantar no Brasil — o objetivo é EXAUSTIVIDADE: inclua também players pequenos e juniores, não apenas os líderes;
- Declare explicitamente o critério de inclusão adotado e, se houver corte, declare o critério de corte;
- Tabela-mestra: Empresa | Controlador/origem do capital | Estágio | Ativos/projetos | Localização | Capacidade atual/planejada | Relevância comercial;
- Ranking preliminar por relevância como potencial cliente de engenharia, cruzando: tamanho do CAPEX, maturidade/janela de entrada, abertura a terceiros e concorrência já instalada.

### Capítulo 5 — Retrospectiva de Projetos Implantados
- Retrospectiva dos últimos projetos implantados no segmento, em tabela: Empresa dona | Projeto | Projetista | Gerenciadora/Fiscalizadora | Tipo de contratação (Spot, EPCM, EPC ou outros) | Ano | CAPEX | Fonte;
- Quando projetista ou gerenciadora não forem públicos, escreva "sem dados públicos suficientes" na célula — não deixe em branco nem invente;
- Leitura do padrão: quais projetistas e gerenciadoras dominam o segmento e que modelos de contratação prevalecem.

### Capítulo 6 — Investimentos de Capital e Correntes (a partir de 2026)
- Tabela consolidada de investimentos de CAPITAL (empresa/projeto, tipo, CAPEX total, datas-chave, fase intensiva em engenharia, distribuição anual 2026+);
- Investimentos CORRENTES relevantes para engenharia (sustaining CAPEX e OPEX de manutenção/melhoria contínua) por empresa, quando públicos;
- Para cada investimento, lista e ORIGEM dos recursos: fundos investidores, private equity, BNDES/bancos de fomento, contratos de offtake, mercado de capitais (follow-on, debêntures) ou geração própria de caixa;
- Visão agregada do CAPEX do segmento e pico de desembolso esperado.

Considerar apenas investimentos que passam por 2026 ou se iniciam em 2026 ou posterior; sempre informar datas/janelas; marcar inferências como **estimativa**.

### Capítulo 7 — Matriz de Screening do Segmento
- Distribuição do valor endereçável (SAM) por fase de projeto, usando as FAIXAS-TETO de referência abaixo (percentual do CAPEX):
  - Estudos + engenharia conceitual/básica: 1,5–4% do CAPEX;
  - Detalhamento: 2–5% do CAPEX;
  - EPCM/gerenciamento: 6–12% do CAPEX;
  - Comissionamento: 1–3% do CAPEX;
  - Compras/equipamentos: 40–60% do CAPEX.
- As faixas acima são TETO: só ultrapasse se houver evidência pública em contrário, citada no texto;
- Explicite o DENOMINADOR de cada percentual — CAPEX total do projeto vs. escopo endereçável por serviços de engenharia — e nunca misture os dois sem avisar;
- Todo valor derivado deve vir marcado como **estimativa**, com a base de cálculo explícita (percentual aplicado × CAPEX de referência).

### Capítulo 8 — Maturidade, modelos de contratação e concorrência
- Mapa de maturidade dos projetos e janela de entrada para serviços;
- Timeline do segmento (marcos e oportunidades comerciais associadas);
- Modelos de contratação predominantes (EPC vs EPCM, terceirização, LTAs guarda-chuva);
- Concorrência instalada e incumbentes com evidência pública.

### Capítulo 9 — Conteúdo local e política regional
- Tendência de conteúdo local e política regional do segmento: exigências, incentivos, preferência por fornecedores locais — e como usá-los a favor na disputa comercial.

### Capítulo 10 — Posicionamento e Proposta de Valor
- Particularidades e expertises necessárias para atuação no segmento e **em cada commodity** (normas, tecnologias de processo, licenciamento, desafios típicos de engenharia);
- Resumo básico do processo produtivo / beneficiamento de cada commodity (etapas principais, da matéria-prima ao produto vendável), descrito de forma a permitir relacionar com as experiências da TENAX em engenharia, projetos e suprimentos;
- Onde uma consultoria de engenharia gera mais valor em cada etapa do processo.

### Capítulo 11 — Pipeline futuro, estratégia comercial e limitações
- Pipeline futuro que pode virar empreendimento relevante após 2026;
- Estratégia comercial recomendada por tipo de alvo (developers em pré-FID, brownfields/expansões, players verticalizados);
- Proposta de abordagem inicial por empresa-alvo (primeira oferta recomendada e motivo);
- Open questions e limitações (informações sem transparência pública).

## Instruções de formatação da saída
- Responda em português do Brasil, em **Markdown estruturado** (não HTML).
- Use um título de nível 1 (#) para o relatório e um título de nível 2 (##) para cada capítulo, na ordem acima, para que um sumário navegável possa ser gerado.
- Use **tabelas Markdown (GFM)** para histórico de preços, rankings de produção, mapa de ativos, censo de empresas, retrospectiva de projetos, investimentos e matriz de screening.
- Sempre que citar um investimento, informe a data ou janela; considere apenas investimentos que atravessam 2026 ou começam em 2026 ou depois.
- Marque claramente como **estimativa** qualquer valor ou cronograma inferido, com a base de cálculo.
- Seção ou campo sem base pública: escreva explicitamente "sem dados públicos suficientes" — NUNCA invente valores, empresas, datas ou coordenadas.
- Mapas e conteúdos externos entram APENAS como links markdown — nunca iframe ou embed.
- Inclua uma seção final \`## Fontes e Referências\` listando as fontes utilizadas.
- Mantenha linguagem profissional e objetiva, adequada para apresentação à área comercial.`;

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    name: 'Empresa',
    description:
      'Pesquisa profunda focada em uma empresa específica — do desconhecimento total ao plano de ataque comercial (10 capítulos).',
    promptBody: EMPRESA_TEMPLATE_PROMPT,
  },
  {
    name: 'Segmento',
    description:
      'Pesquisa profunda sobre um segmento de mercado inteiro — commodities, produção, mapa de ativos, censo de empresas, investimentos, matriz de screening e estratégia comercial (11 capítulos).',
    promptBody: SEGMENTO_TEMPLATE_PROMPT,
  },
];
