import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Header } from '../components/Header';
import { Button } from '../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { ArrowLeft } from 'lucide-react';
import { InteractionTimeline } from '../components/InteractionTimeline';
import { apiClient } from '../services/api/client';
import { useNotifications } from '../contexts/NotificationContext';
import { Lead } from '../types';
import { CommentsSection } from '../components/CommentsSection';
import { WhatsAppSendPanel } from '../components/lead/WhatsAppSendPanel';
import { EmailSendPanel } from '../components/lead/EmailSendPanel';
import { useLeads } from '../hooks/useLeads';
import { toast } from 'sonner';
import {
  LeadOpportunityFields,
  LeadOpportunityValues,
  emptyLeadOpportunityValues,
  leadToOpportunityValues,
  opportunityValuesToLeadPayload,
  validateLeadOpportunityValues,
} from '../components/leads/LeadOpportunityFields';

/**
 * Página de criação/edição do lead-oportunidade (specs/leads-oportunidade
 * reqs. 3-4, 9-11). A aba Informações usa o conjunto único de campos
 * (LeadOpportunityFields); automações mock, tags, custom fields e score
 * saíram do formulário (reqs. 22-24 + tabela E) e a aba órfã "tasks" foi
 * removida (req. 43). Abas Atividades/Comunicação/Comentários mantidas.
 */
export function LeadForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { addNotification } = useNotifications();
  const { createLead, updateLead } = useLeads();
  const [lead, setLead] = useState<Lead | null>(null);
  const [values, setValues] = useState<LeadOpportunityValues>(emptyLeadOpportunityValues());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- shape legado consumido pelo InteractionTimeline
  const [interactions, setInteractions] = useState<any[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!id) {
        setLead(null);
        setValues(emptyLeadOpportunityValues());
        setErrors({});
        setInteractions([]);
        return;
      }
      try {
        const raw = await apiClient.getLead(String(id));
        const data = ((raw as { data?: unknown }).data ?? raw) as Lead;
        if (cancelled) return;
        setLead(data);
        setValues(leadToOpportunityValues(data));
        setErrors({});

        try {
          const interactionsData = await apiClient.getLeadInteractions(String(data.id));
          const list = Array.isArray(interactionsData)
            ? interactionsData
            : ((interactionsData as { data?: unknown[] } | null)?.data ?? []);
          if (!cancelled) setInteractions(Array.isArray(list) ? list : []);
        } catch (error) {
          console.error('Erro ao carregar interações:', error);
          if (!cancelled) setInteractions([]);
        }
      } catch (error) {
        console.error('Erro ao carregar lead:', error);
        if (!cancelled) toast.error('Erro ao carregar lead');
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- shape legado do InteractionTimeline
  const handleAddInteraction = async (interactionData: any) => {
    if (!lead?.id) return;
    try {
      const newInteraction = await apiClient.createInteraction({
        leadId: String(lead.id),
        type: interactionData.type,
        content: interactionData.content,
        metadata: interactionData.metadata,
      });
      setInteractions([newInteraction, ...interactions]);
    } catch (error) {
      console.error('Erro ao criar interação:', error);
      toast.error('Erro ao criar interação');
    }
  };

  const handleDeleteInteraction = async (interactionId: string) => {
    if (!lead?.id) return;
    try {
      await apiClient.deleteInteraction(interactionId);
      setInteractions(interactions.filter((i) => i.id !== interactionId));
    } catch (error) {
      console.error('Erro ao deletar interação:', error);
      toast.error('Erro ao deletar interação');
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    const validationErrors = validateLeadOpportunityValues(values, lead ? 'edit' : 'create');
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    setSaving(true);
    try {
      const payload = opportunityValuesToLeadPayload(values);
      if (lead) {
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
      navigate('/app/leads');
    } catch (error) {
      // useLeads já exibe o toast com a mensagem do backend (ex.: vínculos
      // obrigatórios, motivo obrigatório, CONTACT_COMPANY_MISMATCH).
      console.error('Erro ao salvar lead:', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-full bg-gray-100">
      <Header
        title={lead ? 'Editar Lead' : 'Novo Lead'}
        subtitle={lead ? `Editando: ${lead.name}` : 'Preencha os dados da nova oportunidade'}
      />

      <div className="p-8">
        <div className="mb-6">
          <Button variant="outline" onClick={() => navigate('/app/leads')} className="gap-2">
            <ArrowLeft size={16} />
            Voltar para Leads
          </Button>
        </div>

        <div className="bg-card rounded-lg shadow-sm border border-gray-300 overflow-hidden">
          <div className="p-6 border-b border-gray-300">
            <h2 className="text-xl font-semibold text-gray-900">
              {lead ? 'Editar Lead' : 'Novo Lead'}
            </h2>
          </div>

          <div className="p-6">
            <Tabs defaultValue="info" className="w-full">
              <TabsList className="inline-flex w-full mb-6 h-auto">
                <TabsTrigger value="info" className="flex-1 py-2">
                  Informações
                </TabsTrigger>
                <TabsTrigger value="activity" className="flex-1 py-2">
                  Atividades
                </TabsTrigger>
                {id && (
                  <TabsTrigger value="communication" className="flex-1 py-2">
                    Comunicação
                  </TabsTrigger>
                )}
                <TabsTrigger value="comments" className="flex-1 py-2">
                  Comentários
                </TabsTrigger>
              </TabsList>

              <TabsContent value="info" className="space-y-4 mt-0 outline-none relative">
                <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                  <LeadOpportunityFields
                    value={values}
                    onChange={setValues}
                    mode={lead ? 'edit' : 'create'}
                    errors={errors}
                    idPrefix="lead-form"
                  />

                  <div className="flex justify-end gap-3 pt-4 border-t border-gray-300 mt-6">
                    <Button
                      variant="outline"
                      type="button"
                      onClick={() => navigate('/app/leads')}
                      disabled={saving}
                    >
                      Cancelar
                    </Button>
                    <Button
                      type="submit"
                      className="bg-primary hover:bg-primary-dark"
                      disabled={saving}
                    >
                      {saving ? 'Salvando…' : 'Salvar Lead'}
                    </Button>
                  </div>
                </form>
              </TabsContent>

              <TabsContent value="activity" className="mt-0 outline-none relative">
                {lead?.id ? (
                  <InteractionTimeline
                    // leadId tipado como number no componente legado, mas em runtime sempre foi o UUID string
                    leadId={lead.id as unknown as number}
                    interactions={interactions}
                    onDelete={handleDeleteInteraction}
                    onAdd={handleAddInteraction}
                  />
                ) : (
                  <div className="text-center py-12 text-gray-600">
                    <p>Salve o lead para ver o histórico de interações</p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="communication" className="mt-0 outline-none relative">
                {lead?.id ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="border rounded-lg">
                      <WhatsAppSendPanel
                        leadId={String(lead.id)}
                        leadPhone={lead.phone}
                        leadName={lead.name}
                      />
                    </div>
                    <div className="border rounded-lg">
                      <EmailSendPanel
                        leadId={String(lead.id)}
                        leadEmail={lead.email}
                        leadName={lead.name}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12 text-gray-600">
                    <p>Salve o lead para enviar mensagens</p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="comments" className="mt-0 outline-none relative">
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
        </div>
      </div>
    </div>
  );
}
