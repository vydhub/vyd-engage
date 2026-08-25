import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Plus,
  Pencil,
  Trash2,
  FileText,
  ScanSearch,
  Sparkles,
  SlidersHorizontal,
  Eye,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Header } from '../components/Header';
import { Button } from '../components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { StatusBadge } from '../components/deepResearch/StatusBadge';
import { ResearchEditor } from '../components/deepResearch/ResearchEditor';
import { TemplateManager } from '../components/deepResearch/TemplateManager';
import { DesdobramentosTab } from '../components/comercial/DesdobramentosTab';
import {
  useDeepResearchList,
  useDeepResearchTemplates,
  useDeepResearchActions,
} from '../hooks/useDeepResearch';
import { useAuth } from '../contexts/AuthContext';
import { isManagerRole } from '../utils/roles';
import { apiClient } from '../services/api/client';
import type { DeepResearch as DeepResearchType } from '../types/deepResearch';

export function DeepResearch() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isPlatformAdmin = !!user?.isPlatformAdmin;
  // "Desdobramento comercial" é painel de nível-time (req 11): só GESTOR/ADMIN.
  const canSeeDesdobramentos = isManagerRole(user);

  const listQuery = useDeepResearchList();
  const templatesQuery = useDeepResearchTemplates();
  const { deleteResearch } = useDeepResearchActions();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingResearch, setEditingResearch] = useState<DeepResearchType | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const researches = listQuery.data?.items ?? [];
  const templates = templatesQuery.data?.items ?? [];

  const openNewResearch = () => {
    setEditingResearch(null);
    setEditorOpen(true);
  };

  const openEditResearch = async (id: string) => {
    try {
      const detail = await apiClient.getDeepResearch(id);
      setEditingResearch(detail);
      setEditorOpen(true);
    } catch {
      toast.error('Não foi possível abrir a pesquisa. Recarregue a página e tente novamente.');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50/60">
      <Header
        title="Inteligência de Mercado"
        subtitle="Relatórios profundos de inteligência comercial"
      />

      <div className="space-y-6 p-4 md:p-8">
        <Tabs defaultValue="pesquisas" className="space-y-6">
          <TabsList className="w-fit">
            <TabsTrigger value="pesquisas">Pesquisas</TabsTrigger>
            {canSeeDesdobramentos && (
              <TabsTrigger value="desdobramentos">Desdobramentos</TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="pesquisas" className="space-y-6">
            {/* Hero — ações principais consolidadas aqui */}
            <section className="vyd-hero px-6 py-8 shadow-sm md:px-10 md:py-10">
              <div className="max-w-2xl">
                <span className="vyd-hero__badge">
                  <Sparkles className="h-3.5 w-3.5" />
                  Inteligência de Mercado
                </span>
                <h2 className="vyd-hero__title mt-3 text-2xl font-bold md:text-3xl">
                  Transforme dados em oportunidades comerciais
                </h2>
                <p className="vyd-hero__text mt-2">
                  Solicite uma pesquisa profunda sobre uma empresa ou um segmento inteiro e receba
                  um relatório completo, pronto para apresentar à sua equipe.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Button
                    size="lg"
                    className="vyd-hero__cta"
                    onClick={openNewResearch}
                  >
                    <Plus className="mr-1.5 h-4 w-4" />
                    Nova pesquisa
                  </Button>
                  {isPlatformAdmin && (
                    <Button
                      size="lg"
                      variant="outline"
                      className="vyd-hero__ghost"
                      onClick={() => setTemplatesOpen(true)}
                    >
                      <SlidersHorizontal className="mr-1.5 h-4 w-4" />
                      Gerenciar modelos
                    </Button>
                  )}
                </div>
              </div>
            </section>

            {/* Lista de pesquisas */}
            <section>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold text-gray-900">
                  Suas pesquisas
                  {researches.length > 0 && (
                    <span className="ml-2 text-sm font-normal text-gray-400">
                      {researches.length}
                    </span>
                  )}
                </h3>
                {researches.length > 0 && (
                  <Button variant="outline" size="sm" onClick={openNewResearch}>
                    <Plus className="mr-1 h-4 w-4" />
                    Nova
                  </Button>
                )}
              </div>

              {listQuery.isLoading ? (
                <p className="py-12 text-center text-sm text-gray-500">Carregando…</p>
              ) : researches.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-card py-16 text-center">
                  <ScanSearch className="h-10 w-10 text-gray-300" />
                  <p className="mt-3 font-medium text-gray-900">Nenhuma pesquisa ainda</p>
                  <p className="mt-1 max-w-sm text-sm text-gray-500">
                    Comece criando sua primeira pesquisa de inteligência de mercado.
                  </p>
                  <Button className="mt-4" onClick={openNewResearch}>
                    <Plus className="mr-1 h-4 w-4" />
                    Nova pesquisa
                  </Button>
                </div>
              ) : (
                <ul className="space-y-2">
                  {researches.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-card p-4 transition-colors hover:border-gray-300"
                    >
                      <button
                        type="button"
                        onClick={() => navigate(`/app/deep-research/${r.id}`)}
                        className="group flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <FileText className="h-5 w-5 shrink-0 text-gray-400" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-gray-900 group-hover:text-primary">
                            {r.title}
                          </p>
                          <p className="text-xs text-gray-500">
                            {r.template?.name ? `${r.template.name} · ` : ''}
                            {new Date(r.createdAt).toLocaleDateString('pt-BR')}
                          </p>
                        </div>
                      </button>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <StatusBadge status={r.status} />
                        {r.status === 'COMPLETED' && (
                          <Button size="sm" onClick={() => navigate(`/app/deep-research/${r.id}`)}>
                            <Eye className="mr-1 h-4 w-4" />
                            Ver relatório
                          </Button>
                        )}
                        {r.status === 'RESEARCHING' && (
                          <span className="hidden items-center gap-1 text-xs font-medium text-blue-600 sm:flex">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Processando…
                          </span>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Editar"
                          onClick={() => openEditResearch(r.id)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Excluir"
                          onClick={() => setDeleteTarget({ id: r.id, name: r.title })}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </TabsContent>
          {canSeeDesdobramentos && (
            <TabsContent value="desdobramentos">
              <DesdobramentosTab />
            </TabsContent>
          )}
        </Tabs>
      </div>

      <ResearchEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        templates={templates}
        research={editingResearch}
        onSaved={(saved) => {
          if (saved.status === 'COMPLETED') navigate(`/app/deep-research/${saved.id}`);
        }}
      />

      {isPlatformAdmin && (
        <TemplateManager
          open={templatesOpen}
          onOpenChange={setTemplatesOpen}
          templates={templates}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir definitivamente?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `“${deleteTarget.name}” será removido permanentemente. Esta ação não pode ser desfeita.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={async () => {
                if (deleteTarget) await deleteResearch(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
