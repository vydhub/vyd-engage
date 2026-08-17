/**
 * Propagação dos templates builtin da Pesquisa Profunda (Deep Research) para
 * tenants EXISTENTES — spec leads-oportunidade-inteligencia-mercado, req. 56.
 *
 * O seed/ensureBuiltins só CRIA templates que não existem: editar
 * builtinTemplates.ts não atualiza tenants já provisionados. Este script fecha
 * a lacuna: para cada template `isBuiltin=true` com nome 'Empresa'/'Segmento',
 * se o promptBody ainda for a versão builtin ANTERIOR (legada, embutida abaixo),
 * atualiza para o prompt novo; se foi editado manualmente, NÃO sobrescreve —
 * lista no relatório final para decisão humana (caso extremo 15 da spec).
 *
 * Placeholders e outline NÃO são armazenados no banco: o templateService deriva
 * ambos do promptBody on-the-fly (extractPlaceholders/extractOutline em
 * toClientTemplate) — basta atualizar promptBody (a description acompanha).
 *
 *   npx tsx scripts/update-builtin-templates.ts             # dry-run (default)
 *   ALLOW_PROD_DB=true npx tsx scripts/update-builtin-templates.ts --apply
 */
import prisma from '../src/config/database.js';
import { BUILTIN_TEMPLATES } from '../src/services/deepResearch/builtinTemplates.js';
import { assertNotProdDatabase } from '../src/config/dbSafety.js';

const APPLY = process.argv.includes('--apply');

// Escrita em produção exige intenção explícita (ALLOW_PROD_DB=true); o dry-run
// é read-only e pode rodar livre, como os scripts de diagnóstico.
if (APPLY) assertNotProdDatabase('scripts/update-builtin-templates.ts --apply');

// ---------------------------------------------------------------------------
// Versões LEGADAS (V1) dos prompts builtin — cópia literal do que estava em
// builtinTemplates.ts antes da expansão da spec leads-oportunidade-inteligencia-
// mercado (reqs. 49-53). São o critério de comparação: promptBody idêntico a
// uma destas versões = template intocado pelo tenant → seguro sobrescrever.
// ---------------------------------------------------------------------------

export const LEGACY_EMPRESA_PROMPT_V1 = `Objetivo: gerar uma pesquisa comercial aprofundada sobre a empresa [EMPRESA] (setor: [SETOR]), para uso do time comercial de uma empresa de consultoria e serviços de engenharia, projetos e suprimentos. O leitor parte do desconhecimento total da conta e, ao terminar, precisa dominar: quais oportunidades existem, quanto valem, em que fase estão, quem decide, quando e como abordar.

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
- Lideranças relevantes para as oportunidades, nas áreas de Engenharia, Projetos, Suprimentos e Diretoria Executiva: nome, cargo, responsabilidades e contato institucional público;
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

export const LEGACY_SEGMENTO_PROMPT_V1 = `Objetivo: gerar uma pesquisa aprofundada sobre o segmento de [SEGMENTO] em [REGIÃO], com foco em mapear oportunidades de negócio em engenharia, projetos e suprimentos — identificando empresas-alvo, investimentos, decisores e estratégia comercial.

## Estrutura da pesquisa solicitada

### Capítulo 1 — Escopo, premissas e leitura executiva
- Definição do escopo do segmento e do recorte geográfico ([REGIÃO]);
- Leitura executiva: atratividade do segmento, maturidade do pipeline e principais oportunidades;
- Ranking-resumo das melhores oportunidades comerciais (empresa/projeto, foco, tese resumida, janela principal).

### Capítulo 2 — Panorama do segmento
- Relevância estratégica e principais drivers de demanda;
- Posição de [REGIÃO] na cadeia de valor / oferta;
- Principais polos, regiões e concentração geográfica;
- Ambiente de demanda, preços e arcabouço regulatório.

### Capítulo 3 — Players, ativos e ranking preliminar
- Tabela-mestra de empresas do segmento (controlador, origem do capital, estágio, ativos/projetos, localização, capacidade atual/planejada, relevância comercial);
- Ranking preliminar por relevância como potencial cliente de engenharia, cruzando: tamanho do CAPEX, maturidade/janela de entrada, abertura a terceiros e concorrência já instalada.

### Capítulo 4 — Investimentos do segmento e valor endereçável (a partir de 2026)
- Tabela consolidada de investimentos (empresa/projeto, tipo, CAPEX total, datas-chave, fase intensiva em engenharia, distribuição anual 2026+);
- Visão agregada do CAPEX do segmento e pico de desembolso esperado;
- Distribuição estimada por fase de projeto e SAM (mercado endereçável) para estudos, engenharia, detalhamento, EPCM/comissionamento e compras/equipamentos.

Considerar apenas investimentos que passam por 2026 ou se iniciam em 2026 ou posterior; sempre informar datas/janelas; marcar inferências como **estimativa**.

### Capítulo 5 — Maturidade, modelos de contratação e concorrência
- Mapa de maturidade dos projetos e janela de entrada para serviços;
- Timeline do segmento (marcos e oportunidades comerciais associadas);
- Modelos de contratação predominantes (EPC vs EPCM, terceirização, LTAs guarda-chuva);
- Concorrência instalada e incumbentes com evidência pública.

### Capítulo 6 — Conteúdo local e diretório de decisores
- Tendência de conteúdo local e política regional do segmento;
- Diretório de decisores por empresa-alvo, nas áreas de Engenharia, Projetos, Suprimentos e Diretoria Executiva, com nome, cargo, responsabilidades e contato institucional público, quando disponível.

### Capítulo 7 — Pipeline futuro, estratégia comercial e limitações
- Pipeline futuro que pode virar empreendimento relevante após 2026;
- Estratégia comercial recomendada por tipo de alvo (developers em pré-FID, brownfields/expansões, players verticalizados);
- Proposta de abordagem inicial por empresa-alvo (primeira oferta recomendada e motivo);
- Open questions e limitações (informações sem transparência pública).

## Instruções de formatação da saída
- Responda em português do Brasil, em **Markdown estruturado** (não HTML).
- Use um título de nível 1 (#) para o relatório e um título de nível 2 (##) para cada capítulo, para que um sumário navegável possa ser gerado.
- Use **tabelas Markdown (GFM)** para a tabela-mestra de players, investimentos, rankings e diretório de decisores.
- Sempre que citar um investimento, informe a data ou janela; considere apenas investimentos que atravessam 2026 ou começam em 2026 ou depois.
- Marque claramente como **estimativa** qualquer valor ou cronograma inferido.
- Inclua uma seção final \`## Fontes e Referências\` listando as fontes utilizadas.
- Mantenha linguagem profissional e objetiva, adequada para apresentação à área comercial.`;

// ---------------------------------------------------------------------------

const LEGACY_BY_NAME: Record<string, string> = {
  Empresa: LEGACY_EMPRESA_PROMPT_V1,
  Segmento: LEGACY_SEGMENTO_PROMPT_V1,
};

/** Normalização defensiva para comparação: CRLF→LF e espaço nas pontas. */
function norm(s: string): string {
  return (s || '').replace(/\r\n/g, '\n').trim();
}

interface ReportRow {
  tenant: string;
  template: string;
  status: 'atualizado' | 'ja-atual' | 'editado-manualmente';
}

async function main() {
  const current = new Map(BUILTIN_TEMPLATES.map((t) => [t.name, t]));

  const tenants = await prisma.tenant.findMany({
    select: { id: true, name: true, slug: true },
    orderBy: { createdAt: 'asc' },
  });
  const tenantLabel = new Map(tenants.map((t) => [t.id, `${t.slug} (${t.name})`]));

  const templates = await prisma.deepResearchTemplate.findMany({
    where: { isBuiltin: true, name: { in: [...current.keys()] } },
    select: { id: true, tenantId: true, name: true, promptBody: true, updatedAt: true },
    orderBy: [{ tenantId: 'asc' }, { name: 'asc' }],
  });

  console.log(
    `[${APPLY ? 'APPLY' : 'DRY-RUN'}] ${tenants.length} tenants, ` +
      `${templates.length} templates builtin (Empresa/Segmento) encontrados.`
  );

  const rows: ReportRow[] = [];

  for (const tpl of templates) {
    const tenant = tenantLabel.get(tpl.tenantId) || tpl.tenantId;
    const novo = current.get(tpl.name);
    const legacy = LEGACY_BY_NAME[tpl.name];
    if (!novo || !legacy) continue; // nome fora do conjunto (não deveria ocorrer)

    const body = norm(tpl.promptBody);
    if (body === norm(novo.promptBody)) {
      rows.push({ tenant, template: tpl.name, status: 'ja-atual' });
      continue;
    }
    if (body === norm(legacy)) {
      if (APPLY) {
        // Placeholders/outline são derivados do promptBody na leitura — não há
        // colunas derivadas para atualizar; description acompanha a nova versão.
        await prisma.deepResearchTemplate.update({
          where: { id: tpl.id },
          data: { promptBody: novo.promptBody, description: novo.description },
        });
      }
      rows.push({ tenant, template: tpl.name, status: 'atualizado' });
      continue;
    }
    rows.push({ tenant, template: tpl.name, status: 'editado-manualmente' });
  }

  // Tenants ainda sem os templates builtin (lazy provision): nada a fazer — o
  // ensureBuiltins cria com a versão nova no próximo acesso ao módulo.
  const comTemplate = new Set(templates.map((t) => t.tenantId));
  const semTemplate = tenants.filter((t) => !comTemplate.has(t.id));

  const atualizados = rows.filter((r) => r.status === 'atualizado');
  const jaAtuais = rows.filter((r) => r.status === 'ja-atual');
  const editados = rows.filter((r) => r.status === 'editado-manualmente');

  console.log('\n===== RELATÓRIO =====');
  console.log(`${APPLY ? 'Atualizados' : 'Seriam atualizados'}: ${atualizados.length}`);
  for (const r of atualizados) console.log(`  - ${r.tenant} · ${r.template}`);
  console.log(`Já na versão atual: ${jaAtuais.length}`);
  for (const r of jaAtuais) console.log(`  - ${r.tenant} · ${r.template}`);
  console.log(`EDITADOS MANUALMENTE — NÃO sobrescritos (decisão humana): ${editados.length}`);
  for (const r of editados) console.log(`  - ${r.tenant} · ${r.template}`);
  if (semTemplate.length) {
    console.log(`Sem template builtin ainda (criado no próximo acesso, já na versão nova): ${semTemplate.length}`);
    for (const t of semTemplate) console.log(`  - ${t.slug} (${t.name})`);
  }
  if (!APPLY) {
    console.log('\nDry-run: nada gravado. Use --apply (com ALLOW_PROD_DB=true em produção) para aplicar.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('ERRO:', e?.stack || e);
    process.exit(1);
  });
