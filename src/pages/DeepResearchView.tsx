import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { ArrowLeft, Pencil, Sparkles, FileEdit, AlertTriangle } from 'lucide-react';
import { Header } from '../components/Header';
import { Button } from '../components/ui/button';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '../components/ui/breadcrumb';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { sanitizeReportMarkdown } from '../components/deepResearch/sanitizeReportMarkdown';
import { ReportViewer } from '../components/deepResearch/ReportViewer';
import { ResearchEditor } from '../components/deepResearch/ResearchEditor';
import { AdminProcessPanel } from '../components/deepResearch/AdminProcessPanel';
import { useDeepResearchItem, useDeepResearchTemplates } from '../hooks/useDeepResearch';
import { useAuth } from '../contexts/AuthContext';

export function DeepResearchView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isPlatformAdmin = !!user?.isPlatformAdmin;

  const itemQuery = useDeepResearchItem(id);
  const templatesQuery = useDeepResearchTemplates();
  const [editorOpen, setEditorOpen] = useState(false);

  const item = itemQuery.data;
  const rawMarkdown = item?.reportMarkdown ?? '';
  const { markdown } = useMemo(() => sanitizeReportMarkdown(rawMarkdown), [rawMarkdown]);

  const hasReport = item?.status === 'COMPLETED' && markdown.trim().length > 0;
  const sourceCount = item?.reportMeta?.sources?.length ?? 0;
  const searchResults = item?.reportMeta?.searchResults ?? [];
  // Relatórios gerados antes da detecção não têm o campo — só avisamos quando o
  // motor DISSE que cortou, nunca por suposição.
  const truncated = item?.reportMeta?.truncated === true;
  const missingSections = item?.reportMeta?.missingSections ?? [];

  // Conteúdo do relatório (visualizador ou estado vazio). Reutilizado na aba
  // "Relatório" do platform admin e na visão direta do usuário comum.
  const reportBody = !item ? null : hasReport ? (
    <ReportViewer
      markdown={markdown}
      title={item.title}
      templateName={item.template?.name ?? null}
      updatedAt={item.updatedAt}
      searchResults={searchResults}
      sourceCount={sourceCount}
      truncated={truncated}
      missingSections={missingSections}
    />
  ) : (
    <StatusState status={item.status} onEdit={() => setEditorOpen(true)} />
  );

  return (
    <div className="min-h-screen bg-gray-50/60">
      {/* nao-imprimir: no PDF quem abre o documento e a CAPA do relatorio. */}
      <div className="nao-imprimir">
        <Header title={item?.title ?? 'Inteligência de Mercado'} subtitle="Inteligência de Mercado" />
      </div>

      <div className="p-4 md:p-8">
        {/* Navegação e ações */}
        <div className="nao-imprimir mb-6 flex flex-wrap items-center justify-between gap-3">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink
                  href="/app/deep-research"
                  onClick={(e) => {
                    e.preventDefault();
                    navigate('/app/deep-research');
                  }}
                >
                  Inteligência de Mercado
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{item?.title ?? '…'}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate('/app/deep-research')}>
              <ArrowLeft className="mr-1 h-4 w-4" />
              Voltar
            </Button>
            <Button variant="outline" size="sm" onClick={() => setEditorOpen(true)}>
              <Pencil className="mr-1 h-4 w-4" />
              Editar
            </Button>
          </div>
        </div>

        {itemQuery.isLoading ? (
          <p className="py-12 text-center text-sm text-gray-500">Carregando…</p>
        ) : !item ? (
          <p className="py-12 text-center text-sm text-gray-500">Pesquisa não encontrada.</p>
        ) : isPlatformAdmin ? (
          // Platform admin vê o relatório (web page) e o prompt/processamento em
          // abas distintas — o prompt é IP da plataforma e não chega ao usuário comum.
          <Tabs defaultValue="report" className="gap-4">
            <TabsList className="nao-imprimir w-fit">
              <TabsTrigger value="report" className="px-4">
                Relatório
              </TabsTrigger>
              <TabsTrigger value="prompt" className="px-4">
                Prompt
              </TabsTrigger>
            </TabsList>
            <TabsContent value="report" className="mt-2">
              {reportBody}
            </TabsContent>
            <TabsContent value="prompt" className="mt-2">
              <AdminProcessPanel research={item} />
            </TabsContent>
          </Tabs>
        ) : (
          reportBody
        )}
      </div>

      {item && (
        <ResearchEditor
          open={editorOpen}
          onOpenChange={setEditorOpen}
          templates={templatesQuery.data?.items ?? []}
          research={item}
        />
      )}
    </div>
  );
}

/** Estado da pesquisa quando ainda não há relatório (visão do usuário). */
function StatusState({
  status,
  onEdit,
}: {
  status: 'DRAFT' | 'RESEARCHING' | 'COMPLETED' | 'FAILED';
  onEdit: () => void;
}) {
  const config = {
    RESEARCHING: {
      icon: <Sparkles className="h-10 w-10 text-primary" />,
      title: 'Pesquisa em andamento',
      desc: 'Estamos preparando seu relatório de inteligência de mercado com os dados que você informou. Ele aparecerá aqui assim que estiver pronto.',
      action: null,
    },
    DRAFT: {
      icon: <FileEdit className="h-10 w-10 text-gray-300" />,
      title: 'Rascunho',
      desc: 'Complete as informações e solicite a pesquisa para gerar o relatório.',
      action: (
        <Button className="mt-4" onClick={onEdit}>
          <Pencil className="mr-1 h-4 w-4" />
          Editar e solicitar
        </Button>
      ),
    },
    FAILED: {
      icon: <AlertTriangle className="h-10 w-10 text-red-400" />,
      title: 'Não foi possível concluir',
      desc: 'Houve um problema ao gerar o relatório. Revise os dados e solicite novamente.',
      action: (
        <Button className="mt-4" onClick={onEdit}>
          <Pencil className="mr-1 h-4 w-4" />
          Revisar
        </Button>
      ),
    },
    COMPLETED: {
      icon: <Sparkles className="h-10 w-10 text-primary" />,
      title: 'Relatório indisponível',
      desc: 'O relatório foi marcado como concluído, mas não há conteúdo para exibir.',
      action: null,
    },
  }[status];

  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-card py-16 text-center">
      {config.icon}
      <p className="mt-3 font-medium text-gray-900">{config.title}</p>
      <p className="mt-1 max-w-md text-sm text-gray-500">{config.desc}</p>
      {config.action}
    </div>
  );
}
