import { AlertTriangle } from 'lucide-react';
import { ReportCover } from './ReportCover';
import { ReportRenderer } from './ReportRenderer';
import { ReportSources } from './ReportSources';
import type { TocItem } from './extractToc';
import type { ResearchSource } from '../../types/deepResearch';

interface ReportPrintableProps {
  markdown: string;
  title: string;
  sectionTitles: string[];
  templateName: string | null;
  updatedAt: string;
  toc: TocItem[];
  searchResults: ResearchSource[];
  sourceCount: number;
  /** Relatório cortado por limite do motor — o PDF precisa dizer isso. */
  truncated?: boolean;
}

/**
 * Versão do relatório para IMPRESSÃO/PDF: sempre o documento COMPLETO (capa →
 * sumário → todas as seções → fontes), independente do modo em que o usuário
 * está na tela — no modo Apresentação só existe uma seção no DOM por vez.
 *
 * Reusa de propósito as classes do visualizador (`report-viewer`,
 * `report-viewer__body`, `report-cover--full`, `report-sources`) para herdar a
 * MESMA identidade visual; `reportViewer.css` só acrescenta o controle de
 * exibição e as quebras de página em `@media print`.
 *
 * Só é montado durante a exportação (ver `ReportViewer`), tanto para não pagar a
 * renderização do markdown duas vezes quanto para manter os `id` de âncora do
 * rehype-slug únicos no DOM enquanto o usuário navega.
 */
export function ReportPrintable({
  markdown,
  title,
  sectionTitles,
  templateName,
  updatedAt,
  toc,
  searchResults,
  sourceCount,
  truncated = false,
}: ReportPrintableProps) {
  return (
    <div className="report-print report-viewer">
      {/* Antes da capa, de propósito: quem abrir o PDF precisa saber que o
          documento está incompleto antes de ler qualquer conclusão. */}
      {truncated && (
        <div className="report-viewer__truncated">
          <AlertTriangle size={16} aria-hidden />
          <div>
            <strong>Relatório incompleto.</strong> O motor de pesquisa atingiu o limite de
            tamanho da resposta e o texto foi interrompido antes da conclusão.
          </div>
        </div>
      )}

      <ReportCover
        variant="full"
        title={title}
        sectionTitles={sectionTitles}
        templateName={templateName}
        updatedAt={updatedAt}
      />

      {toc.length > 0 && (
        <nav className="report-print__toc" aria-label="Sumário">
          <p className="report-print__toc-title">Sumário</p>
          <ol className="report-print__toc-list">
            {toc.map((item, i) => (
              <li
                key={`${item.id}-${i}`}
                className="report-print__toc-item"
                data-level={item.level}
              >
                {item.text}
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div className="report-viewer__panel report-print__panel">
        <div className="report-viewer__body">
          <ReportRenderer markdown={markdown} />
        </div>
      </div>

      <div className="report-print__sources">
        <ReportSources searchResults={searchResults} sourceCount={sourceCount} asPage />
      </div>
    </div>
  );
}
