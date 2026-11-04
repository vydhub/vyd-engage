import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Plus, Trash2, Copy, Key, Loader2, AlertTriangle } from 'lucide-react';
import { apiClient, type ApiKeyListItem } from '../../services/api/client';

// Available scopes grouped by resource (req 17, 18).
const SCOPE_GROUPS: { resource: string; scopes: { value: string; label: string }[] }[] = [
  {
    resource: 'Leads',
    scopes: [
      { value: 'leads:read', label: 'Ler' },
      { value: 'leads:write', label: 'Escrever' },
    ],
  },
  {
    resource: 'Deals',
    scopes: [
      { value: 'deals:read', label: 'Ler' },
      { value: 'deals:write', label: 'Escrever' },
    ],
  },
  {
    resource: 'Tarefas',
    scopes: [
      { value: 'tasks:read', label: 'Ler' },
      { value: 'tasks:write', label: 'Escrever' },
    ],
  },
  { resource: 'Contatos', scopes: [{ value: 'contacts:read', label: 'Ler' }] },
  { resource: 'Relatórios', scopes: [{ value: 'reports:read', label: 'Ler' }] },
  { resource: 'Webhooks', scopes: [{ value: 'webhooks:manage', label: 'Gerenciar' }] },
  { resource: 'Contratos', scopes: [{ value: 'contracts:read', label: 'Ler' }] },
  { resource: 'Radar', scopes: [{ value: 'captura:write', label: 'Escrever' }] },
];

const SCOPE_LABELS: Record<string, string> = {
  'leads:read': 'Leads: Ler',
  'leads:write': 'Leads: Escrever',
  'deals:read': 'Deals: Ler',
  'deals:write': 'Deals: Escrever',
  'tasks:read': 'Tarefas: Ler',
  'tasks:write': 'Tarefas: Escrever',
  'contacts:read': 'Contatos: Ler',
  'reports:read': 'Relatórios: Ler',
  'webhooks:manage': 'Webhooks: Gerenciar',
  'contracts:read': 'Contratos: Ler',
  'captura:write': 'Radar: Escrever',
};

export function ApiKeysTab() {
  const [keys, setKeys] = useState<ApiKeyListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formExpiry, setFormExpiry] = useState('');
  const [formScopes, setFormScopes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [newFullKey, setNewFullKey] = useState<string | null>(null);

  const loadKeys = useCallback(async () => {
    try {
      const data = await apiClient.getApiKeys();
      setKeys(Array.isArray(data) ? data : []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  const handleCreate = async () => {
    if (!formName.trim()) {
      toast.error('Informe um nome para a chave');
      return;
    }
    setSaving(true);
    try {
      const data = await apiClient.createApiKey({
        name: formName,
        expiresAt: formExpiry || undefined,
        // Empty selection → omit → full access (req 20).
        scopes: formScopes.length > 0 ? formScopes : undefined,
      });
      // The API returns the full key only once
      setNewFullKey(data.key);
      toast.success('Chave API criada');
      setShowForm(false);
      setFormName('');
      setFormExpiry('');
      setFormScopes([]);
      await loadKeys();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao criar chave');
    } finally {
      setSaving(false);
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      await apiClient.deleteApiKey(id);
      toast.success('Chave revogada');
      await loadKeys();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao revogar chave');
    }
  };

  const toggleScope = (scope: string) => {
    setFormScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copiado para a area de transferencia');
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
          <h3 className="text-gray-900 font-medium">Chaves de API</h3>
          <p className="text-sm text-gray-600 mt-1">
            Gerencie chaves de API para integracao com sistemas externos
          </p>
        </div>
        {!showForm && (
          <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
            <Plus size={16} className="mr-2" />
            Nova Chave
          </Button>
        )}
      </div>

      {/* New key warning */}
      {newFullKey && (
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-yellow-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-yellow-800 mb-2">
                Copie sua chave agora. Ela nao sera exibida novamente.
              </p>
              <div className="flex items-center gap-2">
                <code className="text-xs bg-card px-3 py-2 rounded border border-yellow-300 font-mono flex-1 break-all">
                  {newFullKey}
                </code>
                <Button variant="outline" size="sm" onClick={() => copyToClipboard(newFullKey)}>
                  <Copy size={14} />
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 text-yellow-700"
                onClick={() => setNewFullKey(null)}
              >
                Entendido, ja copiei
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <div className="p-4 border border-gray-300 rounded-lg bg-gray-50 space-y-4">
          <div>
            <label htmlFor="apikey-name" className="block text-sm font-medium text-gray-700 mb-1">
              Nome da Chave
            </label>
            <input
              id="apikey-name"
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Ex: Integracao Zapier"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div>
            <label htmlFor="apikey-expiry" className="block text-sm font-medium text-gray-700 mb-1">
              Data de Expiracao <span className="text-gray-400">(opcional)</span>
            </label>
            <input
              id="apikey-expiry"
              type="date"
              value={formExpiry}
              onChange={(e) => setFormExpiry(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          {/* Scopes selector — checkboxes grouped by resource (req 17). */}
          <div>
            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- rotula um grupo de checkboxes (role=group) via aria-labelledby, não um único controle */}
            <label
              id="apikey-scopes-label"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Scopes <span className="text-gray-400">(deixe vazio para acesso total)</span>
            </label>
            <div
              role="group"
              aria-labelledby="apikey-scopes-label"
              className="space-y-3 max-h-52 overflow-y-auto border border-gray-200 rounded-md p-3 bg-card"
            >
              {SCOPE_GROUPS.map((group) => (
                <div key={group.resource}>
                  <p className="text-xs font-semibold text-gray-700 mb-1">{group.resource}</p>
                  <div className="grid grid-cols-2 gap-1">
                    {group.scopes.map((scope) => (
                      <label
                        key={scope.value}
                        className="flex items-center gap-2 text-sm cursor-pointer"
                      >
                        <Checkbox
                          checked={formScopes.includes(scope.value)}
                          onCheckedChange={() => toggleScope(scope.value)}
                        />
                        <span className="text-gray-700">{scope.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowForm(false);
                setFormName('');
                setFormExpiry('');
                setFormScopes([]);
              }}
            >
              Cancelar
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={saving}>
              {saving ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
              Criar Chave
            </Button>
          </div>
        </div>
      )}

      {/* List */}
      {keys.length === 0 && !showForm ? (
        <div className="p-8 bg-gray-100 rounded-lg text-center">
          <p className="text-sm text-gray-600">Nenhuma chave de API criada</p>
        </div>
      ) : (
        <div className="space-y-3">
          {keys.map((apiKey) => (
            <div
              key={apiKey.id}
              className={`p-4 border rounded-lg flex items-center justify-between gap-4 ${
                apiKey.active ? 'border-gray-300 bg-card' : 'border-gray-200 bg-gray-50 opacity-60'
              }`}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div
                  className={`p-2 rounded-lg ${apiKey.active ? 'bg-primary/10' : 'bg-gray-200'}`}
                >
                  <Key size={16} className={apiKey.active ? 'text-primary' : 'text-gray-400'} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm text-gray-900">{apiKey.name}</p>
                    {!apiKey.active && (
                      <span className="px-2 py-0.5 bg-red-100 text-red-600 text-xs rounded-full">
                        Revogada
                      </span>
                    )}
                  </div>
                  <code className="text-xs text-gray-500 font-mono">{apiKey.key}</code>
                  {/* req 21 — scopes per key; empty = full access (req 20). */}
                  <div className="flex flex-wrap items-center gap-1 mt-1">
                    {apiKey.scopes && apiKey.scopes.length > 0 ? (
                      apiKey.scopes.map((scope) => (
                        <span
                          key={scope}
                          className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full"
                        >
                          {SCOPE_LABELS[scope] || scope}
                        </span>
                      ))
                    ) : (
                      <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
                        Acesso total
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                    <span>Criada em {new Date(apiKey.createdAt).toLocaleDateString('pt-BR')}</span>
                    {apiKey.lastUsedAt && (
                      <span>
                        Ultimo uso: {new Date(apiKey.lastUsedAt).toLocaleDateString('pt-BR')}
                      </span>
                    )}
                    {apiKey.expiresAt && (
                      <span
                        className={new Date(apiKey.expiresAt) < new Date() ? 'text-red-500' : ''}
                      >
                        Expira: {new Date(apiKey.expiresAt).toLocaleDateString('pt-BR')}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {apiKey.active && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRevoke(apiKey.id)}
                  className="text-red-500 hover:text-red-700 flex-shrink-0"
                  title="Revogar chave"
                >
                  <Trash2 size={14} />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Usage info */}
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h4 className="text-sm font-medium text-blue-900 mb-2">Como usar</h4>
        <p className="text-sm text-blue-800 mb-2">
          Inclua a chave no header{' '}
          <code className="bg-card px-1 py-0.5 rounded text-xs">X-API-Key</code> de cada
          requisicao.
        </p>
        <code className="text-xs bg-card px-3 py-2 rounded border border-blue-200 font-mono block">
          curl -H "X-API-Key: fcrm_sua_chave" /api/v1/leads
        </code>
      </div>
    </div>
  );
}
