import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { remarkCitations } from './remarkCitations';
import rehypeSlug from 'rehype-slug';
import rehypeSanitize from 'rehype-sanitize';
import { reportComponents } from './reportComponents';
import { reportSchema } from './reportSchema';

interface ReportRendererProps {
  markdown: string;
}

/**
 * Renderiza o relatorio (markdown) como um site estilizado e seguro.
 * Pipeline: remark-gfm (tabelas/GFM) -> rehype-slug (ids de ancora) ->
 * rehype-sanitize (allowlist, SEMPRE por ultimo). Sem dangerouslySetInnerHTML.
 */
export function ReportRenderer({ markdown }: ReportRendererProps) {
  return (
    <article className="max-w-3xl">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkCitations]}
        rehypePlugins={[rehypeSlug, [rehypeSanitize, reportSchema]]}
        components={reportComponents}
      >
        {markdown}
      </ReactMarkdown>
    </article>
  );
}
