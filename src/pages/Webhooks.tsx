import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Header } from '../components/Header';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { Checkbox } from '../components/ui/checkbox';
import { PageSkeleton } from '../components/PageSkeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible';
import {
  Plus,
  Trash2,
  Edit2,
  Play,
  ChevronDown,
  ChevronRight,
  Copy,
  CheckCircle2,
  XCircle,
  Clock,
  Webhook,
  Loader2,
} from 'lucide-react';
import {
  apiClient,
  ApiError,
  type OutgoingWebhook,
  type OutgoingWebhookLog,
} from '../services/api/client';

interface TestResult {
  success: boolean;
  statusCode?: number;
  responseTime?: number;
  error?: string;
}

// The 9 selectable events (req 10). Used as fallback if the events endpoint
// is unavailable; otherwise the server list is authoritative.
const SELECTABLE_EVENTS = [
  'lead.created',
  'lead.updated',
  'lead.deleted',
  'deal.created',
  'deal.updated',
  'deal.won',
  'deal.lost',
  'task.completed',
  'automation.triggered',
  'contract.created',
  'contract.updated',
  'contract.deleted',
];

// Event label formatting
function formatEventLabel(event: string): string {
  return event
    .replace(/\./g, ' > ')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

export function Webhooks() {
  const [webhooks, setWebhooks] = useState<OutgoingWebhook[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingWebhook, setEditingWebhook] = useState<OutgoingWebhook | null>(null);
  const [deletingWebhook, setDeletingWebhook] = useState<OutgoingWebhook | null>(null);
  const [expandedWebhook, setExpandedWebhook] = useState<string | null>(null);
  const [webhookLogs, setWebhookLogs] = useState<Record<string, OutgoingWebhookLog[]>>({});
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formUrl, setFormUrl] = useState('');
  const [formEvents, setFormEvents] = useState<string[]>([]);
  const [formSecret, setFormSecret] = useState('');

  const fetchWebhooks = useCallback(async () => {
    try {
      const data = await apiClient.getOutgoingWebhooks();
      setWebhooks(data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao carregar webhooks');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchEvents = useCallback(async () => {
    try {
      const data = await apiClient.getWebhookEvents();
      setEvents(data.length > 0 ? data : SELECTABLE_EVENTS);
    } catch {
      setEvents(SELECTABLE_EVENTS);
    }
  }, []);

  useEffect(() => {
    fetchWebhooks();
    fetchEvents();
  }, [fetchWebhooks, fetchEvents]);

  const fetchLogs = async (webhookId: string) => {
    try {
      const data = await apiClient.getWebhookLogs(webhookId);
      setWebhookLogs((prev) => ({ ...prev, [webhookId]: data }));
    } catch {
      toast.error('Erro ao carregar logs');
    }
  };

  const handleToggleExpand = (webhookId: string) => {
    if (expandedWebhook === webhookId) {
      setExpandedWebhook(null);
    } else {
      setExpandedWebhook(webhookId);
      if (!webhookLogs[webhookId]) {
        fetchLogs(webhookId);
      }
    }
  };

  const openCreate = () => {
    setFormUrl('');
    setFormEvents([]);
    setFormSecret('');
    setEditingWebhook(null);
    setIsCreateOpen(true);
  };

  const openEdit = (webhook: OutgoingWebhook) => {
    setFormUrl(webhook.url);
    setFormEvents([...webhook.events]);
    setFormSecret('');
    setEditingWebhook(webhook);
    setIsCreateOpen(true);
  };

  const handleSave = async () => {
    if (!formUrl.trim()) {
      toast.error('URL e obrigatoria');
      return;
    }
    if (formEvents.length === 0) {
      toast.error('Selecione ao menos um evento');
      return;
    }
    // Secret required on creation (req 9 edge case). Updates keep the existing secret.
    if (!editingWebhook && !formSecret.trim()) {
      toast.error('O secret e obrigatorio para assinatura HMAC');
      return;
    }

    setSaving(true);
    try {
      if (editingWebhook) {
        await apiClient.updateOutgoingWebhook(editingWebhook.id, {
          url: formUrl.trim(),
          events: formEvents,
        });
        toast.success('Webhook atualizado');
      } else {
        await apiClient.createOutgoingWebhook({
          url: formUrl.trim(),
          events: formEvents,
          secret: formSecret.trim(),
        });
        toast.success('Webhook criado');
      }
      setIsCreateOpen(false);
      fetchWebhooks();
    } catch (error) {
      // Tenant reached the 10-webhook limit (req 15 / edge case → HTTP 422).
      if (
        error instanceof ApiError &&
        (error.statusCode === 422 || error.code === 'WEBHOOK_LIMIT_REACHED')
      ) {
        toast.error(
          error.message ||
            'Limite de 10 webhooks atingido. Remova um webhook existente para criar outro.'
        );
      } else {
        toast.error(error instanceof Error ? error.message : 'Erro ao salvar webhook');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingWebhook) return;
    try {
      await apiClient.deleteOutgoingWebhook(deletingWebhook.id);
      toast.success('Webhook removido');
      setDeletingWebhook(null);
      fetchWebhooks();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao remover webhook');
    }
  };

  const handleToggleActive = async (webhook: OutgoingWebhook) => {
    try {
      await apiClient.updateOutgoingWebhook(webhook.id, { active: !webhook.active });
      fetchWebhooks();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao alterar status');
    }
  };

  const handleTest = async (webhook: OutgoingWebhook) => {
    setTestingId(webhook.id);
    setTestResult(null);
    try {
      const result = await apiClient.testOutgoingWebhook(webhook.id);
      setTestResult(result);
      if (result.success) {
        toast.success(`Teste OK — ${result.statusCode} em ${result.responseTime}ms`);
      } else {
        toast.error(`Teste falhou — ${result.statusCode ?? 'Erro desconhecido'}`);
      }
      fetchWebhooks();
      if (expandedWebhook === webhook.id) {
        fetchLogs(webhook.id);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao testar webhook');
    } finally {
      setTestingId(null);
    }
  };

  const toggleEvent = (event: string) => {
    setFormEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  };

  const copySecret = (secret: string) => {
    navigator.clipboard.writeText(secret);
    toast.success('Secret copiado');
  };

  if (loading) return <PageSkeleton />;

  return (
    <div className="min-h-screen">
      <Header title="Webhooks" subtitle="Gerencie webhooks de saida para integracoes externas" />

      <div className="p-4 md:p-8">
        <div className="bg-card rounded-lg shadow-sm border border-gray-300">
          {/* Toolbar */}
          <div className="p-4 md:p-6 border-b border-gray-300 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Webhooks ({webhooks.length})</h2>
              <p className="text-sm text-gray-500">
                Envie notificacoes em tempo real para URLs externas quando eventos acontecerem.
              </p>
            </div>
            <Button onClick={openCreate}>
              <Plus size={16} className="mr-2" />
              Criar Webhook
            </Button>
          </div>

          {/* Table */}
          {webhooks.length === 0 ? (
            <div className="p-12 text-center">
              <Webhook size={48} className="mx-auto text-gray-300 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Nenhum webhook configurado</h3>
              <p className="text-gray-500 mb-6">
                Crie um webhook para receber notificacoes quando eventos acontecerem no seu CRM.
              </p>
              <Button onClick={openCreate}>
                <Plus size={16} className="mr-2" />
                Criar Webhook
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {webhooks.map((webhook) => (
                <Collapsible
                  key={webhook.id}
                  open={expandedWebhook === webhook.id}
                  onOpenChange={() => handleToggleExpand(webhook.id)}
                >
                  <div className="p-4 md:p-6">
                    <div className="flex flex-col md:flex-row md:items-center gap-3">
                      {/* URL + Events */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono text-sm text-gray-900 truncate">
                            {webhook.url}
                          </span>
                          <Badge variant={webhook.active ? 'default' : 'secondary'}>
                            {webhook.active ? 'Ativo' : 'Inativo'}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {webhook.events.map((evt) => (
                            <Badge key={evt} variant="outline" className="text-xs">
                              {evt}
                            </Badge>
                          ))}
                        </div>
                        <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                          <span className="flex items-center gap-1">
                            <CheckCircle2 size={12} className="text-green-500" />
                            {webhook.successCount || 0} sucessos
                          </span>
                          <span className="flex items-center gap-1">
                            <XCircle size={12} className="text-red-500" />
                            {webhook.failureCount || 0} falhas
                          </span>
                          {webhook.lastTriggeredAt && (
                            <span className="flex items-center gap-1">
                              <Clock size={12} />
                              Ultimo: {new Date(webhook.lastTriggeredAt).toLocaleString('pt-BR')}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Switch
                          checked={webhook.active}
                          onCheckedChange={() => handleToggleActive(webhook)}
                          aria-label="Ativar/Desativar"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleTest(webhook)}
                          disabled={testingId === webhook.id}
                        >
                          {testingId === webhook.id ? (
                            <Loader2 size={14} className="mr-1 animate-spin" />
                          ) : (
                            <Play size={14} className="mr-1" />
                          )}
                          Testar
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => openEdit(webhook)}>
                          <Edit2 size={14} />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => setDeletingWebhook(webhook)}
                        >
                          <Trash2 size={14} />
                        </Button>
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" size="sm">
                            {expandedWebhook === webhook.id ? (
                              <ChevronDown size={16} />
                            ) : (
                              <ChevronRight size={16} />
                            )}
                          </Button>
                        </CollapsibleTrigger>
                      </div>
                    </div>

                    {/* Secret */}
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-xs text-gray-400">Secret:</span>
                      <code className="text-xs bg-gray-100 px-2 py-0.5 rounded font-mono">
                        {webhook.secret.slice(0, 8)}...{webhook.secret.slice(-8)}
                      </code>
                      <button
                        onClick={() => copySecret(webhook.secret)}
                        className="text-gray-400 hover:text-gray-600"
                        title="Copiar secret"
                      >
                        <Copy size={12} />
                      </button>
                    </div>
                  </div>

                  {/* Logs section */}
                  <CollapsibleContent>
                    <div className="border-t border-gray-200 bg-gray-50 p-4 md:px-6">
                      <h4 className="text-sm font-medium text-gray-700 mb-3">Entregas recentes</h4>
                      {!webhookLogs[webhook.id] ? (
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                          <Loader2 size={14} className="animate-spin" />
                          Carregando logs...
                        </div>
                      ) : webhookLogs[webhook.id].length === 0 ? (
                        <p className="text-sm text-gray-500">Nenhuma entrega registrada.</p>
                      ) : (
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                          {webhookLogs[webhook.id].map((log) => (
                            <div
                              key={log.id}
                              className="flex items-center gap-3 bg-card rounded border border-gray-200 px-3 py-2 text-sm"
                            >
                              {/* success indicator (req 14) */}
                              {log.success ? (
                                <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
                              ) : (
                                <XCircle size={14} className="text-red-500 flex-shrink-0" />
                              )}
                              <Badge variant="outline" className="text-xs">
                                {log.event}
                              </Badge>
                              {/* HTTP status code (req 14) */}
                              {log.statusCode != null && (
                                <span className="font-mono text-xs text-gray-600">
                                  {log.statusCode}
                                </span>
                              )}
                              {/* duration in ms (req 14) */}
                              {log.durationMs != null && (
                                <span className="text-xs text-gray-500">{log.durationMs}ms</span>
                              )}
                              <span className="text-xs text-gray-400 ml-auto flex-shrink-0">
                                {new Date(log.createdAt).toLocaleString('pt-BR')}
                              </span>
                              {log.error && (
                                <span
                                  className="text-xs text-red-500 truncate max-w-[200px]"
                                  title={log.error}
                                >
                                  {log.error}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>
          )}

          {/* Test result banner */}
          {testResult && (
            <div
              className={`mx-4 md:mx-6 mb-4 p-3 rounded-lg text-sm ${
                testResult.success
                  ? 'bg-green-50 border border-green-200 text-green-800'
                  : 'bg-red-50 border border-red-200 text-red-800'
              }`}
            >
              {testResult.success
                ? `Teste bem-sucedido — Status ${testResult.statusCode} em ${testResult.responseTime}ms`
                : `Teste falhou — ${testResult.error || `Status ${testResult.statusCode}`}`}
              <button onClick={() => setTestResult(null)} className="ml-2 underline text-xs">
                Fechar
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingWebhook ? 'Editar Webhook' : 'Criar Webhook'}</DialogTitle>
            <DialogDescription>
              Configure a URL e os eventos que disparam este webhook.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="webhook-url">URL de destino</Label>
              <Input
                id="webhook-url"
                type="url"
                placeholder="https://example.com/webhook"
                value={formUrl}
                onChange={(e) => setFormUrl(e.target.value)}
                className="mt-1"
              />
            </div>

            {/* Secret — required on creation for HMAC signing (req 9). */}
            {!editingWebhook && (
              <div>
                <Label htmlFor="webhook-secret">Secret (assinatura HMAC)</Label>
                <Input
                  id="webhook-secret"
                  type="text"
                  placeholder="Ex: uma string secreta e aleatoria"
                  value={formSecret}
                  onChange={(e) => setFormSecret(e.target.value)}
                  className="mt-1"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Usado para assinar cada disparo no header X-VYD-Signature. Obrigatorio.
                </p>
              </div>
            )}

            <div>
              <Label className="mb-2 block">Eventos</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto border border-gray-200 rounded-lg p-3">
                {events.map((event) => (
                  <label
                    key={event}
                    className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5"
                  >
                    <Checkbox
                      checked={formEvents.includes(event)}
                      onCheckedChange={() => toggleEvent(event)}
                    />
                    <span>{formatEventLabel(event)}</span>
                  </label>
                ))}
              </div>
              {formEvents.length > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  {formEvents.length} evento(s) selecionado(s)
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 size={14} className="mr-2 animate-spin" />}
              {editingWebhook ? 'Salvar' : 'Criar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deletingWebhook} onOpenChange={() => setDeletingWebhook(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover webhook?</AlertDialogTitle>
            <AlertDialogDescription>
              O webhook para <strong>{deletingWebhook?.url}</strong> sera removido permanentemente.
              Esta acao nao pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
