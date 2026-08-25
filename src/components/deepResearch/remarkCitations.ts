import { visit } from 'unist-util-visit';
import type { Root, Text, PhrasingContent } from 'mdast';

/**
 * Transforma citações `[1][2][3]` em notas SOBRESCRITAS.
 *
 * O motor cita a fonte a cada afirmação, e o resultado no meio do parágrafo é
 * algo como "…notícias setoriais entre 2021 e 2026.[1][2][3][4][5][6][7][8][9]
 * [10][11][12][13][14][15][16][17][18][19][20] Fato com fonte." — a citação
 * ocupa mais espaço visual que a própria frase e destrói a leitura.
 *
 * Vira `<sup>1,2,3</sup>`: discreto, sem perder a rastreabilidade (o número
 * continua batendo com a seção "Fontes e Referências").
 *
 * Usa `data.hName`, e NÃO um nó `html`: react-markdown não habilita HTML cru
 * (e o rehype-sanitize o descartaria). Com hName o elemento nasce na árvore
 * HAST como `<sup>` legítimo, então segue passando pelo sanitize — que é, e
 * continua sendo, o último passo do pipeline.
 */

/** Uma ou mais citações coladas: [1] ou [1][2][3]. */
const CITACOES = /(?:\[\d{1,3}\])+/g;

export function remarkCitations() {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || typeof index !== 'number') return;
      // Dentro de link, `[n]` é rótulo — não é citação.
      if (parent.type === 'link' || parent.type === 'linkReference') return;

      const matches = [...node.value.matchAll(CITACOES)];
      if (matches.length === 0) return;

      const filhos: PhrasingContent[] = [];
      let ultimo = 0;
      for (const m of matches) {
        const inicio = m.index ?? 0;
        if (inicio > ultimo) {
          filhos.push({ type: 'text', value: node.value.slice(ultimo, inicio) });
        }
        const numeros = (m[0].match(/\d{1,3}/g) ?? []).join(',');
        filhos.push({
          type: 'emphasis',
          children: [{ type: 'text', value: numeros }],
          // Faz o remark-rehype emitir <sup> em vez de <em>.
          data: { hName: 'sup' },
        } as PhrasingContent);
        ultimo = inicio + m[0].length;
      }
      if (ultimo < node.value.length) {
        filhos.push({ type: 'text', value: node.value.slice(ultimo) });
      }

      parent.children.splice(index, 1, ...filhos);
      return index + filhos.length;
    });
  };
}
