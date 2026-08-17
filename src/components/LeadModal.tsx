import { FormEvent, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Link } from 'react-router';
import { apiClient } from '../services/api/client';
import { useNotifications } from '../contexts/NotificationContext';
import { Lead } from '../types';
import { CommentsSection } from './CommentsSection';
import { useLeads } from '../hooks/useLeads';
import { toast } from 'sonner';
import {
  LeadOpportunityFields,
  LeadOpportunityValues,
  emptyLeadOpportunityValues,
  leadToOpportunityValues,
  opportunityValuesToLeadPayload,
  validateLeadOpportunityValues,
} from './leads/LeadOpportunityFields';

interface LeadModalProps {
  open: boolean;
  onClose: () => void;
  lead?: Partial<Lead> | null;
}

/**
 * Modal de criação/edição do lead usado pelo Kanban e pela listagem
 * (specs/leads-oportunidade req. 11): mesmo conjunto de campos da página
 * LeadForm via LeadOpportunityFields. Automações mock, tags, custom fields e
 * score saíram do formulário (reqs. 22-24 + tabela E) e a aba órfã "tasks"
 * foi removida (req. 43).
 */
export function LeadModal({ open, onClose, lead }: LeadModalProps) {
  const { addNotification } = useNotifications();
  const { createLead, updateLead } = useLeads();
  const [values, setValues] = useState<LeadOpportunityValues>(emptyLeadOpportunityValues());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- shape cru da API de interações
  const [interactions, setInteractions] = useState<any[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sincroniza o formulário a partir do prop lead/open ao abrir o modal
    setValues(lead ? leadToOpportunityValues(lead) : emptyLeadOpportunityValues());
    setErrors({});

    const loadInteractions = async () => {
      if (lead?.id) {
        try {
          const interactionsData = await apiClient.getLeadInteractions(String(lead.id));
          const list = Array.isArray(interactionsData)
            ? interactionsData
            : ((interactionsData as { data?: unknown[] } | null)?.data ?? []);
          setInteractions(Array.isArray(list) ? list : []);
        } catch (error) {
          console.error('Erro ao carregar interações:', error);
          setInteractions([]);
        }
      } else {
        setInteractions([]);
      }
    };

    void loadInteractions();
  }, [lead, open]);

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();

    const validationErrors = validateLeadOpportunityValues(values, lead ? 'edit' : 'create');
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    setSaving(true);
    try {
      const payload = opportunityValuesToLeadPayload(values);
      if (lead?.id) {
        // Preserva tags/custom fields ocultados (reqs. 23-24: saem da tela, não do dado).
        await updateLead(String(lead.id), {
          ...payload,
          tags: lead.tags,
          customFields: lead.customFields,
        });
      } else {
        await createLead(payload);
        addNotification({
          type: 'system',
          title: 'Novo Lead Criado',
          message: `Lead "${values.name.trim()}" foi adicionado ao sistema`,
          link: `/app/leads`,
        });
      }
      onClose();
    } catch (error) {
      // useLeads já exibe o toast com a mensagem do backend (ex.: vínculos
      // obrigatórios, motivo obrigatório, CONTACT_COMPANY_MISMATCH).
      console.error('Erro ao salvar lead:', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="flex flex-col overflow-hidden p-0 w-[900px] h-[700px] max-w-[90vw] max-h-[90vh]">
        <DialogHeader className="flex-shrink-0 pb-4 border-b border-gray-300 px-6 pt-6">
          <DialogTitle>{lead ? 'Editar Lead' : 'Novo Lead'}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto min-h-0 py-4 px-6">
          <Tabs defaultValue="info" className="mt-4">
            <TabsList className="inline-flex w-full">
              <TabsTrigger value="info" className="flex-1">
                Informações
              </TabsTrigger>
              <TabsTrigger value="activity" className="flex-1">
                Atividades
              </TabsTrigger>
              <TabsTrigger value="comments" className="flex-1">
                Comentários
              </TabsTrigger>
            </TabsList>

            <TabsContent value="info" className="space-y-4 mt-4">
              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                <LeadOpportunityFields
                  value={values}
                  onChange={setValues}
                  mode={lead ? 'edit' : 'create'}
                  errors={errors}
                  idPrefix="lead-modal"
                />
              </form>
            </TabsContent>

            <TabsContent value="activity" className="mt-4">
              {lead?.id ? (
                // Timeline compacta (leitura). O fluxo completo de atividades
                // (Reunião/Ligação/Tarefa — spec req. 35) vive no detalhe do lead.
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-medium text-gray-900">Histórico de atividades</h3>
                    <Button asChild type="button" variant="outline">
                      <Link to={`/app/leads/${lead.id}`}>Registrar atividades no detalhe</Link>
                    </Button>
                  </div>
                  {interactions.length === 0 ? (
                    <div className="text-center py-8 text-gray-600">
                      <p className="text-sm">Nenhuma atividade registrada ainda.</p>
                    </div>
                  ) : (
                    <ul className="space-y-3">
                      {interactions.slice(0, 20).map((i) => (
                        <li key={i.id} className="border rounded-lg p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-gray-900 truncate">
                              {i.subject || i.type}
                            </span>
                            <span className="text-xs text-gray-600 shrink-0">
                              {new Date(i.occurredAt || i.createdAt).toLocaleDateString('pt-BR')}
                            </span>
                          </div>
                          <p className="text-sm text-gray-600 mt-1 line-clamp-2">{i.content}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <div className="text-center py-12 text-gray-600">
                  <p>Salve o lead para ver o histórico de atividades</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="comments" className="mt-4">
              {lead?.id ? (
                <CommentsSection leadId={lead.id} />
              ) : (
                <div className="text-center py-12 text-gray-600">
                  <p>Salve o lead para adicionar comentários</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="flex-shrink-0 pt-4 border-t border-gray-300 mt-0 px-6 pb-6">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            className="bg-primary hover:bg-primary-dark"
            disabled={saving}
          >
            {saving ? 'Salvando…' : 'Salvar Lead'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
