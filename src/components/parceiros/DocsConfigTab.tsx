// Aba "Documentos & Configurações" do módulo de Gestão de Parceiros Comerciais.
// Seção 1: documentos/templates visíveis aos consultores no portal (req. 35).
// Seção 2: configurações do módulo por tenant (proteção, cadências, score, split).
// Todas as chamadas de API passam pelos hooks de useParceiros.ts — exceção
// autorizada: busca de usuários (ADMIN/GESTOR) via apiClient.getUsers().

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Download,
  FileText,
  FileWarning,
  Loader2,
  Save,
  Settings,
  Trash2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { apiClient } from '@/services/api/client';
import {
  useDocumentosParceiros,
  useParceiroConfig,
  useParceirosActions,
} from '@/hooks/useParceiros';
import type { ConsultorDocumento, ParceiroConfig } from '@/types/parceiros';

// Sentinela do Select (Radix não aceita value vazio) → null no payload.
const ADMINS_PADRAO = '__admins';

// ── Estado do formulário de configurações (tudo string p/ inputs) ───────────
interface ConfigForm {
  protecaoDiasPadrao: string;
  updateCadenciaDias: string;
  avisoExpiracaoDias: string;
  reuniaoCadenciaDias: string;
  splitOriginadorPadrao: string;
  pesoNovasOportunidades: string;
  pesoUpdatesCumpridos: string;
  pesoPresencaReunioes: string;
  pesoProgressaoPipeline: string;
  limiarSaudavel: string;
  limiarAtencao: string;
  limiarEsfriando: string;
  decaimentoPontosPorDia: string;
  decaimentoMaxPontos: string;
  quedaLimiarPontos: string;
  conflitoInternoUserId: string;
}

function configToForm(c: ParceiroConfig): ConfigForm {
  return {
    protecaoDiasPadrao: String(Number(c.protecaoDiasPadrao)),
    updateCadenciaDias: String(Number(c.updateCadenciaDias)),
    avisoExpiracaoDias: String(Number(c.avisoExpiracaoDias)),
    reuniaoCadenciaDias: String(Number(c.reuniaoCadenciaDias)),
    splitOriginadorPadrao: String(Number(c.splitOriginadorPadrao)),
    pesoNovasOportunidades: String(Number(c.scorePesos.novasOportunidades)),
    pesoUpdatesCumpridos: String(Number(c.scorePesos.updatesCumpridos)),
    pesoPresencaReunioes: String(Number(c.scorePesos.presencaReunioes)),
    pesoProgressaoPipeline: String(Number(c.scorePesos.progressaoPipeline)),
    limiarSaudavel: String(Number(c.scoreLimiares.saudavel)),
    limiarAtencao: String(Number(c.scoreLimiares.atencao)),
    limiarEsfriando: String(Number(c.scoreLimiares.esfriando)),
    decaimentoPontosPorDia: String(Number(c.decaimentoPontosPorDia)),
    decaimentoMaxPontos: String(Number(c.decaimentoMaxPontos)),
    quedaLimiarPontos: String(Number(c.quedaLimiarPontos)),
    conflitoInternoUserId: c.conflitoInternoUserId ?? ADMINS_PADRAO,
  };
}

/** Campo numérico com rótulo e hint explicativo (pt-BR). */
function CampoNumero({
  id,
  label,
  hint,
  value,
  onChange,
  min,
  max,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function DocsConfigTab() {
  const actions = useParceirosActions();

  const { data: documentos, isLoading: docsLoading, isError: docsError } =
    useDocumentosParceiros();
  const { data: config, isLoading: configLoading, isError: configError } =
    useParceiroConfig();

  // Exceção autorizada: usuários ADMIN/GESTOR p/ o Select de responsável.
  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => apiClient.getUsers(),
  });
  const gestores = (usersQuery.data ?? []).filter(
    (u) => u.role === 'ADMIN' || u.role === 'GESTOR'
  );

  // ── Documentos: publicar / excluir ─────────────────────────────────────────
  const [pubOpen, setPubOpen] = useState(false);
  const [tituloDoc, setTituloDoc] = useState('');
  const [arquivoDoc, setArquivoDoc] = useState<File | null>(null);
  const [publicando, setPublicando] = useState(false);
  const arquivoInputRef = useRef<HTMLInputElement>(null);
  const [docExcluir, setDocExcluir] = useState<ConsultorDocumento | null>(null);
  const [excluindo, setExcluindo] = useState(false);

  const resetPublicar = () => {
    setTituloDoc('');
    setArquivoDoc(null);
    if (arquivoInputRef.current) arquivoInputRef.current.value = '';
  };

  const handlePublicar = async () => {
    if (!tituloDoc.trim() || !arquivoDoc) return;
    setPublicando(true);
    try {
      await actions.uploadDocumento(tituloDoc.trim(), arquivoDoc);
      setPubOpen(false);
      resetPublicar();
    } catch {
      // erro já sinalizado via toast no hook
    } finally {
      setPublicando(false);
    }
  };

  const handleToggleAtivo = (doc: ConsultorDocumento, ativo: boolean) => {
    void actions.updateDocumento(doc.id, { ativo }).catch(() => {
      // erro já sinalizado via toast no hook
    });
  };

  const handleBaixar = (doc: ConsultorDocumento) => {
    window.open(
      `${import.meta.env.VITE_API_URL || ''}/api/v1/attachments/${doc.attachmentId}/download`
    );
  };

  const handleExcluir = async () => {
    if (!docExcluir) return;
    setExcluindo(true);
    try {
      await actions.deleteDocumento(docExcluir.id);
      setDocExcluir(null);
    } catch {
      // erro já sinalizado via toast no hook
    } finally {
      setExcluindo(false);
    }
  };

  // ── Configurações: formulário pré-preenchido do useParceiroConfig() ───────
  const [form, setForm] = useState<ConfigForm | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (config && !form) setForm(configToForm(config));
  }, [config, form]);

  const setCampo = <K extends keyof ConfigForm>(key: K, value: ConfigForm[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const somaPesos = form
    ? Number(form.pesoNovasOportunidades) +
      Number(form.pesoUpdatesCumpridos) +
      Number(form.pesoPresencaReunioes) +
      Number(form.pesoProgressaoPipeline)
    : 0;

  const handleSalvarConfig = async () => {
    if (!form) return;
    const numericos: Array<[string, number]> = [
      ['Proteção padrão (dias)', Number(form.protecaoDiasPadrao)],
      ['Cadência de updates (dias)', Number(form.updateCadenciaDias)],
      ['Aviso de expiração (dias)', Number(form.avisoExpiracaoDias)],
      ['Cadência de reuniões (dias)', Number(form.reuniaoCadenciaDias)],
      ['Split padrão do originador', Number(form.splitOriginadorPadrao)],
      ['Peso — novas oportunidades', Number(form.pesoNovasOportunidades)],
      ['Peso — updates cumpridos', Number(form.pesoUpdatesCumpridos)],
      ['Peso — presença em reuniões', Number(form.pesoPresencaReunioes)],
      ['Peso — progressão no pipeline', Number(form.pesoProgressaoPipeline)],
      ['Limiar — saudável', Number(form.limiarSaudavel)],
      ['Limiar — atenção', Number(form.limiarAtencao)],
      ['Limiar — esfriando', Number(form.limiarEsfriando)],
      ['Decaimento — pontos por dia', Number(form.decaimentoPontosPorDia)],
      ['Decaimento — máximo de pontos', Number(form.decaimentoMaxPontos)],
      ['Queda que dispara alerta (pontos)', Number(form.quedaLimiarPontos)],
    ];
    const invalido = numericos.find(([, n]) => !Number.isFinite(n));
    if (invalido) {
      toast.error(`Preencha o campo "${invalido[0]}" com um número válido.`);
      return;
    }
    const split = Number(form.splitOriginadorPadrao);
    if (split < 0 || split > 100) {
      toast.error('O split do originador deve estar entre 0 e 100.');
      return;
    }

    setSalvando(true);
    try {
      await actions.updateConfig({
        protecaoDiasPadrao: Number(form.protecaoDiasPadrao),
        updateCadenciaDias: Number(form.updateCadenciaDias),
        avisoExpiracaoDias: Number(form.avisoExpiracaoDias),
        reuniaoCadenciaDias: Number(form.reuniaoCadenciaDias),
        splitOriginadorPadrao: split,
        scorePesos: {
          novasOportunidades: Number(form.pesoNovasOportunidades),
          updatesCumpridos: Number(form.pesoUpdatesCumpridos),
          presencaReunioes: Number(form.pesoPresencaReunioes),
          progressaoPipeline: Number(form.pesoProgressaoPipeline),
        },
        scoreLimiares: {
          saudavel: Number(form.limiarSaudavel),
          atencao: Number(form.limiarAtencao),
          esfriando: Number(form.limiarEsfriando),
        },
        decaimentoPontosPorDia: Number(form.decaimentoPontosPorDia),
        decaimentoMaxPontos: Number(form.decaimentoMaxPontos),
        quedaLimiarPontos: Number(form.quedaLimiarPontos),
        conflitoInternoUserId:
          form.conflitoInternoUserId === ADMINS_PADRAO ? null : form.conflitoInternoUserId,
      });
    } catch {
      // erro já sinalizado via toast no hook
    } finally {
      setSalvando(false);
    }
  };

  const docs = documentos ?? [];

  return (
    <div className="space-y-6">
      {/* ══ SEÇÃO DOCUMENTOS ══ */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <FileText size={16} />
              Documentos e templates
            </h3>
            <p className="text-sm text-muted-foreground">
              Materiais publicados aqui ficam disponíveis aos consultores no portal.
            </p>
          </div>
          <Button className="gap-1.5" onClick={() => setPubOpen(true)}>
            <Upload size={16} />
            Publicar documento
          </Button>
        </div>

        <div className="rounded-md border border-border bg-card">
          {docsLoading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : docsError ? (
            <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
              <FileWarning className="mb-3 text-destructive" size={32} />
              <p className="font-medium text-foreground">Erro ao carregar os documentos</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Não foi possível buscar os documentos publicados. Tente novamente.
              </p>
            </div>
          ) : docs.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
              <FileText className="mb-3 text-muted-foreground" size={32} />
              <p className="font-medium text-foreground">Nenhum documento publicado</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Publique templates e materiais de apoio para os consultores.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Título</TableHead>
                    <TableHead>Criado em</TableHead>
                    <TableHead>Ativo</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {docs.map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell className="font-medium text-foreground">
                        {doc.titulo}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(doc.createdAt).toLocaleDateString('pt-BR')}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={doc.ativo}
                            onCheckedChange={(checked) => handleToggleAtivo(doc, checked)}
                            aria-label={`Documento ${doc.titulo} visível aos consultores`}
                          />
                          <Badge variant={doc.ativo ? 'default' : 'outline'}>
                            {doc.ativo ? 'Visível' : 'Oculto'}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="outline"
                            size="icon"
                            aria-label={`Baixar ${doc.titulo}`}
                            onClick={() => handleBaixar(doc)}
                          >
                            <Download size={14} />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            aria-label={`Excluir ${doc.titulo}`}
                            onClick={() => setDocExcluir(doc)}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>

      {/* ══ SEÇÃO CONFIGURAÇÕES ══ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Settings size={16} />
            Configurações do módulo
          </CardTitle>
          <CardDescription>
            Parâmetros de proteção, cadências, score e comissão aplicados a este tenant.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {configError ? (
            <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
              <FileWarning className="mb-3 text-destructive" size={32} />
              <p className="font-medium text-foreground">Erro ao carregar as configurações</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Não foi possível buscar as configurações do módulo. Tente novamente.
              </p>
            </div>
          ) : configLoading || !form ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-2/3" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Prazos e cadências */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <CampoNumero
                  id="cfg-protecao"
                  label="Proteção padrão (dias)"
                  hint="Dias de exclusividade do consultor sobre o cliente após a aprovação do registro."
                  value={form.protecaoDiasPadrao}
                  onChange={(v) => setCampo('protecaoDiasPadrao', v)}
                  min={1}
                />
                <CampoNumero
                  id="cfg-update"
                  label="Cadência de updates (dias)"
                  hint="Intervalo máximo entre atualizações do consultor em um registro ativo."
                  value={form.updateCadenciaDias}
                  onChange={(v) => setCampo('updateCadenciaDias', v)}
                  min={1}
                />
                <CampoNumero
                  id="cfg-aviso"
                  label="Aviso de expiração (dias)"
                  hint="Quantos dias antes do fim da proteção o alerta de expiração é exibido."
                  value={form.avisoExpiracaoDias}
                  onChange={(v) => setCampo('avisoExpiracaoDias', v)}
                  min={1}
                />
                <CampoNumero
                  id="cfg-reuniao"
                  label="Cadência de reuniões (dias)"
                  hint="Intervalo padrão entre reuniões de acompanhamento com cada consultor."
                  value={form.reuniaoCadenciaDias}
                  onChange={(v) => setCampo('reuniaoCadenciaDias', v)}
                  min={1}
                />
              </div>

              {/* Split de comissão */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <CampoNumero
                  id="cfg-split"
                  label="Split padrão do originador (%)"
                  hint="% do originador; o restante vai ao desenvolvedor"
                  value={form.splitOriginadorPadrao}
                  onChange={(v) => setCampo('splitOriginadorPadrao', v)}
                  min={0}
                  max={100}
                />
              </div>

              {/* Pesos do score */}
              <div className="space-y-2 border-t border-border pt-4">
                <p className="text-sm font-semibold text-foreground">Pesos do score</p>
                <p className="text-xs text-muted-foreground">
                  Os quatro pesos devem somar 100.
                  {Number.isFinite(somaPesos) && somaPesos !== 100 ? (
                    <span className="text-destructive"> Soma atual: {somaPesos}.</span>
                  ) : null}
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <CampoNumero
                    id="cfg-peso-novas"
                    label="Novas oportunidades"
                    value={form.pesoNovasOportunidades}
                    onChange={(v) => setCampo('pesoNovasOportunidades', v)}
                    min={0}
                    max={100}
                  />
                  <CampoNumero
                    id="cfg-peso-updates"
                    label="Updates cumpridos"
                    value={form.pesoUpdatesCumpridos}
                    onChange={(v) => setCampo('pesoUpdatesCumpridos', v)}
                    min={0}
                    max={100}
                  />
                  <CampoNumero
                    id="cfg-peso-presenca"
                    label="Presença em reuniões"
                    value={form.pesoPresencaReunioes}
                    onChange={(v) => setCampo('pesoPresencaReunioes', v)}
                    min={0}
                    max={100}
                  />
                  <CampoNumero
                    id="cfg-peso-pipeline"
                    label="Progressão no pipeline"
                    value={form.pesoProgressaoPipeline}
                    onChange={(v) => setCampo('pesoProgressaoPipeline', v)}
                    min={0}
                    max={100}
                  />
                </div>
              </div>

              {/* Limiares do score */}
              <div className="space-y-2 border-t border-border pt-4">
                <p className="text-sm font-semibold text-foreground">Limiares do score</p>
                <p className="text-xs text-muted-foreground">
                  Pontuação mínima de cada faixa — Saudável &gt; Atenção &gt; Esfriando; abaixo
                  do limiar de Esfriando o consultor é considerado Frio.
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <CampoNumero
                    id="cfg-limiar-saudavel"
                    label="Saudável (mínimo)"
                    value={form.limiarSaudavel}
                    onChange={(v) => setCampo('limiarSaudavel', v)}
                    min={0}
                  />
                  <CampoNumero
                    id="cfg-limiar-atencao"
                    label="Atenção (mínimo)"
                    value={form.limiarAtencao}
                    onChange={(v) => setCampo('limiarAtencao', v)}
                    min={0}
                  />
                  <CampoNumero
                    id="cfg-limiar-esfriando"
                    label="Esfriando (mínimo)"
                    value={form.limiarEsfriando}
                    onChange={(v) => setCampo('limiarEsfriando', v)}
                    min={0}
                  />
                </div>
              </div>

              {/* Decaimento por inatividade */}
              <div className="space-y-2 border-t border-border pt-4">
                <p className="text-sm font-semibold text-foreground">
                  Decaimento por inatividade
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <CampoNumero
                    id="cfg-decaimento-dia"
                    label="Pontos por dia"
                    hint="Pontos descontados do score por dia sem atividade do consultor."
                    value={form.decaimentoPontosPorDia}
                    onChange={(v) => setCampo('decaimentoPontosPorDia', v)}
                    min={0}
                  />
                  <CampoNumero
                    id="cfg-decaimento-max"
                    label="Máximo de pontos"
                    hint="Teto total de pontos que o decaimento pode descontar."
                    value={form.decaimentoMaxPontos}
                    onChange={(v) => setCampo('decaimentoMaxPontos', v)}
                    min={0}
                  />
                  <CampoNumero
                    id="cfg-queda-limiar"
                    label="Queda que dispara alerta"
                    hint="Alerta de tendência quando o score cai mais que estes pontos entre duas apurações."
                    value={form.quedaLimiarPontos}
                    onChange={(v) => setCampo('quedaLimiarPontos', v)}
                    min={1}
                  />
                </div>
              </div>

              {/* Responsável por conflitos internos */}
              <div className="space-y-1 border-t border-border pt-4">
                <Label>Responsável por conflitos internos</Label>
                <Select
                  value={form.conflitoInternoUserId}
                  onValueChange={(v) => setCampo('conflitoInternoUserId', v)}
                >
                  <SelectTrigger className="w-full sm:w-80">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ADMINS_PADRAO}>Administradores (padrão)</SelectItem>
                    {gestores.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Usuário designado que trata conflitos consultor × pipeline interno.
                </p>
                {usersQuery.isLoading ? (
                  <p className="text-xs text-muted-foreground">Carregando usuários…</p>
                ) : usersQuery.isError ? (
                  <p className="text-xs text-destructive">
                    Não foi possível carregar a lista de usuários.
                  </p>
                ) : null}
              </div>

              <div className="flex justify-end border-t border-border pt-4">
                <Button className="gap-1.5" onClick={handleSalvarConfig} disabled={salvando}>
                  {salvando ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Save size={16} />
                  )}
                  {salvando ? 'Salvando…' : 'Salvar configurações'}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Dialog: publicar documento ── */}
      <Dialog
        open={pubOpen}
        onOpenChange={(open) => {
          setPubOpen(open);
          if (!open) resetPublicar();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publicar documento</DialogTitle>
            <DialogDescription>
              O documento ficará disponível aos consultores no portal enquanto estiver ativo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="doc-titulo">Título *</Label>
              <Input
                id="doc-titulo"
                value={tituloDoc}
                onChange={(e) => setTituloDoc(e.target.value)}
                placeholder="Ex.: Template de proposta comercial"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="doc-arquivo">Arquivo *</Label>
              <Input
                id="doc-arquivo"
                ref={arquivoInputRef}
                type="file"
                onChange={(e) => setArquivoDoc(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setPubOpen(false);
                resetPublicar();
              }}
              disabled={publicando}
            >
              Cancelar
            </Button>
            <Button
              onClick={handlePublicar}
              disabled={!tituloDoc.trim() || !arquivoDoc || publicando}
            >
              {publicando ? 'Publicando…' : 'Publicar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── AlertDialog: excluir documento ── */}
      <AlertDialog
        open={!!docExcluir}
        onOpenChange={(open) => {
          if (!open) setDocExcluir(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir documento</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é permanente e removerá o documento
              {docExcluir ? ` "${docExcluir.titulo}"` : ''} do portal dos consultores. Deseja
              continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluindo}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              disabled={excluindo}
              onClick={(e) => {
                e.preventDefault();
                handleExcluir();
              }}
            >
              {excluindo ? 'Excluindo…' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
