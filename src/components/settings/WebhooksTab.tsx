import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import {
  Plus,
  Trash2,
  Play,
  Pause,
  Send,
  ChevronDown,
  ChevronUp,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  Copy,
} from 'lucide-react';
import {
  apiClient,
  ApiError,
  type OutgoingWebhook,
  type OutgoingWebhookLog,
} from '../../services/api/client';

interface TestResult {
  success: boolean;
  statusCode?: number;
  responseTime?: number;
  payload?: Record<string, unknown>;
  error?: string;
}

// The 9 selectable events (req 10) — fallback if the events endpoint is unavailable.
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

const EVENT_LABELS: Record<string, string> = {
  'lead.created': 'Lead criado',
  'lead.updated': 'Lead atualizado',
  'lead.deleted': 'Lead deletado',
  'deal.created': 'Deal criado',
  'deal.updated': 'Deal atualizado',
  'deal.won': 'Deal ganho',
  'deal.lost': 'Deal perdido',
  'task.completed': 'Tarefa concluida',
  'automation.triggered': 'Automacao disparada',
  'contract.created': 'Contrato criado',
  'contract.updated': 'Contrato atualizado',
  'contract.deleted': 'Contrato excluido',
};

export function WebhooksTab() {
  const [webhooks, setWebhooks] = useState<OutgoingWebhook[]>([]);
  const [availableEvents, setAvailableEvents] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formUrl, setFormUrl] = useState('');
  const [formEvents, setFormEvents] = useState<string[]>([]);
  const [formSecret, setFormSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [logs, setLogs] = useState<Record<string, OutgoingWebhookLog[]>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [testEvent, setTestEvent] = useState<Record<string, string>>({});
  const [testResultModal, setTestResultModal] = useState<TestResult | null>(null);

  const loadWebhooks = useCallback(async () => {
    try {
      const [wh, events] = await Promise.all([
        apiClient.getOutgoingWebhooks(),
        apiClient.getWebhookEvents(),
      ]);
      setWebhooks(Array.isArray(wh) ? wh : []);
      setAvailableEvents(Array.isArray(events) && events.length > 0 ? events : SELECTABLE_EVENTS);
    } catch {
      setAvailableEvents(SELECTABLE_EVENTS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWebhooks();
  }, [loadWebhooks]);

  const handleCreate = async () => {
    if (!formUrl || formEvents.length === 0) {
      toast.error('Preencha a URL e selecione pelo menos um evento');
      return;
    }
    if (!formSecret.trim()) {
      toast.error('O secret e obrigatorio para assinatura HMAC');
      return;
    }
    setSaving(true);
    try {
      await apiClient.createOutgoingWebhook({
        url: formUrl,
        events: formEvents,
        secret: formSecret.trim(),
      });
      toast.success('Webhook criado');
      setShowForm(false);
      setFormUrl('');
      setFormEvents([]);
      setFormSecret('');
      await loadWebhooks();
    } catch (error) {
      // Tenant reached the 10-webhook limit (req 15 → HTTP 422).
      if (
        error instanceof ApiError &&
        (error.statusCode === 422 || error.code === 'WEBHOOK_LIMIT_REACHED')
      ) {
        toast.error(
          error.message || 'Limite de 10 webhooks atingido. Remova um existente para criar outro.'
        );
      } else {
        toast.error(error instanceof Error ? error.message : 'Erro ao criar webhook');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (webhook: OutgoingWebhook) => {
    try {
      await apiClient.updateOutgoingWebhook(webhook.id, { active: !webhook.active });
      toast.success(webhook.active ? 'Webhook desativado' : 'Webhook ativado');
      await loadWebhooks();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao atualizar webhook');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiClient.deleteOutgoingWebhook(id);
      toast.success('Webhook removido');
      await loadWebhooks();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao remover webhook');
    }
  };

  const handleTest = async (id: string) => {
    setTesting(id);
    try {
      const selectedEvent = testEvent[id] || undefined;
      const result = (await apiClient.testOutgoingWebhook(
        id,
        selectedEvent
      )) as unknown as TestResult;
      if (result.success) {
        toast.success(`Teste enviado com sucesso (status ${result.statusCode})`);
      } else {
        toast.error(`Teste falhou: ${result.error || `status ${result.statusCode}`}`);
      }
      setTestResultModal(result);
      await loadWebhooks();
      // Reload logs if expanded
      if (expandedId === id) {
        const logData = await apiClient.getWebhookLogs(id);
        setLogs((prev) => ({ ...prev, [id]: logData }));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao testar webhook');
    } finally {
      setTesting(null);
    }
  };

  const toggleLogs = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!logs[id]) {
      try {
        const logData = await apiClient.getWebhookLogs(id);
        setLogs((prev) => ({ ...prev, [id]: logData }));
      } catch {
        // silent
      }
    }
  };

  const toggleEvent = (event: string) => {
    setFormEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  };

  const copyPayload = () => {
    if (testResultModal?.payload) {
      navigator.clipboard.writeText(JSON.stringify(testResultModal.payload, null, 2));
      toast.success('Payload copiado');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-gray-900 font-medium">Webhooks de Saida</h3>
          <p className="text-sm text-gray-600 mt-1">
            Receba notificacoes HTTP quando eventos ocorrerem no VYD Engage
          </p>
        </div>
        {!showForm && (
          <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
            <Plus size={16} className="mr-2" />
            Novo Webhook
          </Button>
        )}
      </div>

      {/* Create form */}
      {showForm && (
        <div className="p-4 border border-gray-300 rounded-lg bg-gray-50 space-y-4">
          <div>
            <label htmlFor="webhook-url" className="block text-sm font-medium text-gray-700 mb-1">
              URL do Endpoint
            </label>
            <input
              id="webhook-url"
              type="url"
              value={formUrl}
              onChange={(e) => setFormUrl(e.target.value)}
              placeholder="https://example.com/webhook"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          {/* Secret — required for HMAC signing (req 9). */}
          <div>
            <label
              htmlFor="webhook-secret"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Secret (assinatura HMAC)
            </label>
            <input
              id="webhook-secret"
              type="text"
              value={formSecret}
              onChange={(e) => setFormSecret(e.target.value)}
              placeholder="String secreta e aleatoria"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <p className="text-xs text-gray-500 mt-1">
              Usado para assinar cada disparo (X-VYD-Signature). Obrigatorio.
            </p>
          </div>
          <div>
            <span className="block text-sm font-medium text-gray-700 mb-2">Eventos</span>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {availableEvents.map((event) => (
                <label key={event} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formEvents.includes(event)}
                    onChange={() => toggleEvent(event)}
                    className="rounded border-gray-300"
                  />
                  <span className="text-gray-700">{EVENT_LABELS[event] || event}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowForm(false);
                setFormUrl('');
                setFormEvents([]);
                setFormSecret('');
              }}
            >
              Cancelar
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={saving}>
              {saving ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
              Criar Webhook
            </Button>
          </div>
        </div>
      )}

      {/* List */}
      {webhooks.length === 0 && !showForm ? (
        <div className="p-8 bg-gray-100 rounded-lg text-center">
          <p className="text-sm text-gray-600">Nenhum webhook configurado</p>
        </div>
      ) : (
        <div className="space-y-3">
          {webhooks.map((webhook) => (
            <div key={webhook.id} className="border border-gray-300 rounded-lg overflow-hidden">
              <div className="p-4 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`w-2 h-2 rounded-full ${webhook.active ? 'bg-green-500' : 'bg-gray-400'}`}
                    />
                    <code className="text-sm font-mono truncate block">{webhook.url}</code>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {webhook.events.map((e) => (
                      <span
                        key={e}
                        className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full"
                      >
                        {EVENT_LABELS[e] || e}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <CheckCircle size={12} className="text-green-500" /> {webhook.successCount}
                    </span>
                    <span className="flex items-center gap-1">
                      <XCircle size={12} className="text-red-500" /> {webhook.failureCount}
                    </span>
                    {webhook.lastTriggeredAt && (
                      <span className="flex items-center gap-1">
                        <Clock size={12} />
                        {new Date(webhook.lastTriggeredAt).toLocaleDateString('pt-BR')}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {/* Event selector for test */}
                  <select
                    className="text-xs border border-gray-300 rounded px-1 py-1 bg-card max-w-[140px]"
                    value={testEvent[webhook.id] || ''}
                    onChange={(e) =>
                      setTestEvent((prev) => ({ ...prev, [webhook.id]: e.target.value }))
                    }
                    title="Evento de teste"
                  >
                    <option value="">Teste generico</option>
                    {availableEvents.map((ev) => (
                      <option key={ev} value={ev}>
                        {EVENT_LABELS[ev] || ev}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleTest(webhook.id)}
                    disabled={testing === webhook.id}
                    title="Testar"
                  >
                    {testing === webhook.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Send size={14} />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleToggle(webhook)}
                    title={webhook.active ? 'Desativar' : 'Ativar'}
                  >
                    {webhook.active ? <Pause size={14} /> : <Play size={14} />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(webhook.id)}
                    title="Remover"
                    className="text-red-500 hover:text-red-700"
                  >
                    <Trash2 size={14} />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => toggleLogs(webhook.id)}>
                    {expandedId === webhook.id ? (
                      <ChevronUp size={14} />
                    ) : (
                      <ChevronDown size={14} />
                    )}
                  </Button>
                </div>
              </div>

              {/* Logs */}
              {expandedId === webhook.id && (
                <div className="border-t border-gray-200 bg-gray-50 p-4">
                  <h5 className="text-xs font-medium text-gray-600 mb-2">Ultimos Logs</h5>
                  {!logs[webhook.id] ? (
                    <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                  ) : logs[webhook.id].length === 0 ? (
                    <p className="text-xs text-gray-500">Nenhum log disponivel</p>
                  ) : (
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {logs[webhook.id].map((log) => (
                        <div key={log.id} className="flex items-center gap-3 text-xs py-1">
                          {/* success indicator (req 14) */}
                          <span
                            className={`w-2 h-2 rounded-full flex-shrink-0 ${
                              log.success ? 'bg-green-500' : 'bg-red-500'
                            }`}
                          />
                          <span className="text-gray-600 w-24 flex-shrink-0">
                            {new Date(log.createdAt).toLocaleString('pt-BR', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })}
                          </span>
                          <span className="font-mono text-gray-700">{log.event}</span>
                          {/* HTTP status code (req 14) */}
                          {log.statusCode != null && (
                            <span
                              className={`${log.statusCode < 300 ? 'text-green-600' : 'text-red-600'}`}
                            >
                              {log.statusCode}
                            </span>
                          )}
                          {/* duration in ms (req 14) */}
                          {log.durationMs != null && (
                            <span className="text-gray-500">{log.durationMs}ms</span>
                          )}
                          {log.error && <span className="text-red-500 truncate">{log.error}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Test Result Modal */}
      {testResultModal && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Fechar"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setTestResultModal(null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              if (e.key === ' ') e.preventDefault();
              setTestResultModal(null);
            }
          }}
        >
          <div
            role="presentation"
            className="bg-card rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h4 className="font-medium text-gray-900">Resultado do Teste</h4>
              <Button variant="ghost" size="sm" onClick={() => setTestResultModal(null)}>
                <XCircle size={16} />
              </Button>
            </div>
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-3">
                <span
                  className={`px-2 py-0.5 rounded text-xs font-medium ${
                    testResultModal.success
                      ? 'bg-green-100 text-green-700'
                      : 'bg-red-100 text-red-700'
                  }`}
                >
                  {testResultModal.success ? 'Sucesso' : 'Falhou'}
                </span>
                {testResultModal.statusCode && (
                  <span className="text-sm text-gray-600">
                    Status: {testResultModal.statusCode}
                  </span>
                )}
                {testResultModal.responseTime !== undefined && (
                  <span className="text-sm text-gray-600">{testResultModal.responseTime}ms</span>
                )}
              </div>
              {testResultModal.error && (
                <div className="text-sm text-red-600 bg-red-50 p-2 rounded">
                  {testResultModal.error}
                </div>
              )}
              {testResultModal.payload && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-600">Payload enviado</span>
                    <Button variant="ghost" size="sm" onClick={copyPayload} title="Copiar">
                      <Copy size={12} className="mr-1" /> Copiar
                    </Button>
                  </div>
                  <pre className="text-xs bg-gray-100 p-3 rounded overflow-x-auto max-h-64 overflow-y-auto font-mono">
                    {JSON.stringify(testResultModal.payload, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
