import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Presentation,
  BookOpen,
  ListTree,
  FileDown,
  AlertTriangle,
} from 'lucide-react';
import { buttonVariants } from '../ui/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '../ui/drawer';
import { ReportRenderer } from './ReportRenderer';
import { ReportTOC } from './ReportTOC';
import { ReportCover } from './ReportCover';
import { ReportSources } from './ReportSources';
import { ReportPrintable } from './ReportPrintable';
import { extractToc } from './extractToc';
import { useActiveHeading } from './useActiveHeading';
import { useReportPages, pageLabel, type ReportPage } from './useReportPages';
import type { ResearchSource } from '../../types/deepResearch';
import './reportViewer.css';

type Mode = 'apresentacao' | 'leitura';
const MODE_KEY = 'vyd.reportViewer.mode';
const EMPTY_IDS: string[] = [];

interface ReportViewerProps {
  markdown: string;
  title: string;
  templateName: string | null;
  updatedAt: string;
  searchResults: ResearchSource[];
  sourceCount: number;
  /** O motor cortou o texto por limite de saída — o relatório está incompleto. */
  truncated?: boolean;
  /** Seções do roteiro que ficaram de fora (quando detectadas). */
  missingSections?: string[];
}

function readStoredMode(): Mode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (v === 'apresentacao' || v === 'leitura') return v;
  } catch {
    /* localStorage indisponível (ex.: modo privado) */
  }
  return 'apresentacao';
}

/**
 * Visualizador do relatório com dois modos alternáveis: "Apresentação" (paginado
 * por seção, com Anterior/Próximo, setas do teclado, índice e progresso) e
 * "Leitura" (scroll contínuo com índice por âncora e progresso de leitura). A
 * estética vem de reportViewer.css (Tailwind do projeto é pré-compilado).
 */
export function ReportViewer({
  markdown,
  title,
  templateName,
  updatedAt,
  searchResults,
  sourceCount,
  truncated = false,
  missingSections = [],
}: ReportViewerProps) {
  const hasSources = searchResults.length > 0 || sourceCount > 0;
  const { split, pages } = useReportPages(markdown, hasSources);
  const hasH2 = split.sections.length > 0;
  const sectionTitles = useMemo(() => split.sections.map((s) => s.title), [split.sections]);

  const [mode, setMode] = useState<Mode>(readStoredMode);
  // Sem seções (H2), a paginação não faz sentido → força Leitura e esconde o toggle.
  const effectiveMode: Mode = hasH2 ? mode : 'leitura';

  const [pageIndex, setPageIndex] = useState(0);
  const [scrollPct, setScrollPct] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const firstScroll = useRef(true);

  // Índice por âncora (modo Leitura). O scroll-spy só observa quando em Leitura
  // (evita listeners de scroll inúteis no modo Apresentação).
  const toc = useMemo(() => extractToc(markdown), [markdown]);
  const tocIds = useMemo(() => toc.map((t) => t.id), [toc]);
  const observedIds = useMemo(
    () => (effectiveMode === 'leitura' ? tocIds : EMPTY_IDS),
    [effectiveMode, tocIds]
  );
  const activeId = useActiveHeading(observedIds);

  const goTo = (i: number) => setPageIndex(Math.max(0, Math.min(i, pages.length - 1)));

  // Reinicia na primeira página quando o relatório muda.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sincroniza estado a partir da prop markdown (reset de página quando o relatório muda)
    setPageIndex(0);
  }, [markdown]);

  // Ao trocar de página, rola o visualizador para o topo (exceto na montagem).
  useEffect(() => {
    if (firstScroll.current) {
      firstScroll.current = false;
      return;
    }
    rootRef.current?.scrollIntoView({ block: 'start' });
    // Move o foco para o conteúdo da página (teclado/leitor de tela).
    pageRef.current?.focus({ preventScroll: true });
  }, [pageIndex]);

  // Navegação por setas do teclado (modo Apresentação).
  useEffect(() => {
    if (effectiveMode !== 'apresentacao') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setPageIndex((i) => Math.min(i + 1, pages.length - 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setPageIndex((i) => Math.max(i - 1, 0));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [effectiveMode, pages.length]);

  // Progresso de leitura (modo Leitura), medido pelo scroll do documento.
  useEffect(() => {
    if (effectiveMode !== 'leitura') return;
    const onScroll = () => {
      const el = document.documentElement;
      const max = el.scrollHeight - el.clientHeight;
      setScrollPct(max > 0 ? Math.min(100, (el.scrollTop / max) * 100) : 0);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [effectiveMode]);

  const persistMode = (m: Mode) => {
    setMode(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* ignore */
    }
  };

  // Exportação em PDF via impressão do navegador. O bloco completo (ReportPrintable)
  // só é montado durante a exportação; o efeito abaixo roda DEPOIS do commit, então
  // o DOM já contém o documento inteiro quando `print()` é chamado.
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!printing) return;

    // O PDF sai sempre no tema claro: em dark o documento ficaria com fundo escuro
    // (ruim para leitura/impressão). Usa os tokens do DS — nenhuma cor literal.
    const root = document.documentElement;
    const prevTheme = root.getAttribute('data-vyd-theme');
    root.setAttribute('data-vyd-theme', 'light');

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (prevTheme === null) root.removeAttribute('data-vyd-theme');
      else root.setAttribute('data-vyd-theme', prevTheme);
      setPrinting(false);
    };

    window.addEventListener('afterprint', finish);
    // rAF: garante um ciclo de layout com o bloco de impressão já no DOM.
    const raf = requestAnimationFrame(() => {
      window.print();
      // Navegadores que não emitem `afterprint` (ex.: alguns WebKit) — sem isto o
      // componente ficaria preso no estado de impressão e no tema claro.
      window.setTimeout(finish, 800);
    });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('afterprint', finish);
      finish();
    };
  }, [printing]);

  // Índice seguro: trava entre 0 e a última página mesmo se `pageIndex` ficar
  // obsoleto após o markdown encolher (o reset por efeito roda após a render).
  const lastIndex = pages.length - 1;
  const safeIndex = Math.max(0, Math.min(pageIndex, lastIndex));
  const current = pages[safeIndex];

  const progressPct =
    effectiveMode === 'apresentacao'
      ? lastIndex > 0
        ? (safeIndex / lastIndex) * 100
        : 100
      : scrollPct;

  const positionLabel = (): string => {
    const page = current;
    if (!page) return '';
    if (page.kind === 'section') {
      const sectionPages = pages.filter((p) => p.kind === 'section');
      return `Seção ${sectionPages.indexOf(page) + 1} de ${sectionPages.length}`;
    }
    return pageLabel(page);
  };

  const renderPage = (page: ReportPage) => {
    if (page.kind === 'cover') {
      return (
        <ReportCover
          variant="full"
          title={title}
          sectionTitles={sectionTitles}
          templateName={templateName}
          updatedAt={updatedAt}
          onStart={() => goTo(safeIndex + 1)}
        />
      );
    }
    return (
      <div className="report-viewer__panel">
        {page.kind === 'sources' ? (
          <ReportSources searchResults={searchResults} sourceCount={sourceCount} asPage />
        ) : (
          <div className="report-viewer__body">
            <ReportRenderer markdown={page.markdown} />
          </div>
        )}
      </div>
    );
  };

  const indexNav =
    effectiveMode === 'apresentacao' ? (
      <nav className="report-viewer__index" aria-label="Seções do relatório">
        <p className="report-viewer__index-title">Seções</p>
        {pages.map((p, i) => (
          <button
            key={i}
            type="button"
            aria-current={i === safeIndex ? 'true' : undefined}
            onClick={() => goTo(i)}
          >
            {pageLabel(p)}
          </button>
        ))}
      </nav>
    ) : (
      <ReportTOC items={toc} activeId={activeId} />
    );

  const showRail = effectiveMode === 'apresentacao' ? pages.length > 1 : toc.length > 0;

  return (
    <div className="report-viewer" ref={rootRef}>
      {/* A topbar existe mesmo sem seções (H2) — o toggle de modo é condicional,
          mas "Exportar PDF" vale para qualquer relatório. */}
      <div className="report-viewer__topbar">
        {hasH2 && (
          <div className="report-viewer__toggle" role="group" aria-label="Modo de leitura">
            <button
              type="button"
              aria-pressed={effectiveMode === 'apresentacao'}
              onClick={() => persistMode('apresentacao')}
            >
              <Presentation size={15} aria-hidden /> Apresentação
            </button>
            <button
              type="button"
              aria-pressed={effectiveMode === 'leitura'}
              onClick={() => persistMode('leitura')}
            >
              <BookOpen size={15} aria-hidden /> Leitura
            </button>
          </div>
        )}
        <button
          type="button"
          className="report-viewer__export"
          onClick={() => setPrinting(true)}
          disabled={printing}
        >
          <FileDown size={15} aria-hidden /> {printing ? 'Preparando…' : 'Exportar PDF'}
        </button>
      </div>

      {/* O motor parou por limite de tokens: o texto está cortado, às vezes no
          meio de uma palavra. Avisar é o mínimo — antes disto o relatório
          aparecia como se estivesse completo. */}
      {truncated && (
        <div className="report-viewer__truncated" role="status">
          <AlertTriangle size={16} aria-hidden />
          <div>
            <strong>Relatório incompleto.</strong> O motor de pesquisa interrompeu o texto
            antes de cobrir todo o roteiro. O conteúdo acima é válido, mas está parcial —
            gere novamente para obter a versão completa.
            {missingSections.length > 0 && (
              <>
                {' '}
                Ficou sem: <em>{missingSections.join('; ')}</em>.
              </>
            )}
          </div>
        </div>
      )}

      <div
        className="report-viewer__progress"
        role="progressbar"
        aria-label="Progresso do relatório"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progressPct)}
      >
        <div style={{ width: `${progressPct}%` }} />
      </div>

      <div className={`report-viewer__layout${showRail ? '' : ' report-viewer__layout--full'}`}>
        {showRail && <aside className="report-viewer__rail">{indexNav}</aside>}

        {showRail && (
          <div className="report-viewer__mobile-index">
            <Drawer direction="left">
              <DrawerTrigger className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                <ListTree size={16} aria-hidden style={{ marginRight: 4 }} /> Índice
              </DrawerTrigger>
              <DrawerContent className="w-72 p-4">
                <DrawerHeader className="p-0">
                  <DrawerTitle className="sr-only">Índice</DrawerTitle>
                </DrawerHeader>
                <DrawerClose asChild>
                  <div className="mt-2 overflow-y-auto">{indexNav}</div>
                </DrawerClose>
              </DrawerContent>
            </Drawer>
          </div>
        )}

        <div className="report-viewer__main">
          {effectiveMode === 'apresentacao' ? (
            <>
              <p className="sr-only" aria-live="polite">
                {positionLabel()}
              </p>
              <div ref={pageRef} tabIndex={-1} className="report-viewer__page-region">
                {renderPage(current)}
              </div>
              <div className="report-viewer__nav">
                <button
                  type="button"
                  onClick={() => goTo(safeIndex - 1)}
                  disabled={safeIndex === 0}
                >
                  <ChevronLeft size={16} aria-hidden /> Anterior
                </button>
                <span className="report-viewer__nav-pos">{positionLabel()}</span>
                <button
                  type="button"
                  onClick={() => goTo(safeIndex + 1)}
                  disabled={safeIndex >= lastIndex}
                >
                  Próximo <ChevronRight size={16} aria-hidden />
                </button>
              </div>
            </>
          ) : (
            <>
              <ReportCover
                variant="compact"
                title={title}
                sectionTitles={sectionTitles}
                templateName={templateName}
                updatedAt={updatedAt}
              />
              <div className="report-viewer__panel">
                <div className="report-viewer__body">
                  <ReportRenderer markdown={markdown} />
                </div>
                <ReportSources
                  searchResults={searchResults}
                  sourceCount={sourceCount}
                  asPage={false}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Documento completo para impressão/PDF — montado só durante a exportação. */}
      {printing && (
        <ReportPrintable
          markdown={markdown}
          title={title}
          sectionTitles={sectionTitles}
          templateName={templateName}
          updatedAt={updatedAt}
          toc={toc}
          searchResults={searchResults}
          sourceCount={sourceCount}
          truncated={truncated}
        />
      )}
    </div>
  );
}
