import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Header } from '../components/Header';
import { Button } from '../components/ui/button';
import { ArrowLeft, CheckCircle2, Copy, Loader2 } from 'lucide-react';
import { apiClient } from '../services/api/client';
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

interface DuplicateLead {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  status: string;
  score: number;
  createdAt: string;
  tags?: Array<{ tag: { id: string; name: string; color: string } }>;
}

interface DuplicateGroup {
  matchField: 'email' | 'phone';
  matchValue: string;
  leads: DuplicateLead[];
}

// Régua nova (specs/leads-oportunidade req. 7); valores legados por compat com
// dados pré-migração eventualmente em cache.
const statusLabels: Record<string, string> = {
  NOVO: 'Novo',
  EM_ANDAMENTO: 'Em Andamento',
  PAUSADO: 'Pausado',
  CANCELADO: 'Cancelado',
  ENCERRADO: 'Encerrado',
  NEW: 'Novo',
  CONTACTED: 'Em Andamento',
  QUALIFIED: 'Em Andamento',
  PROPOSAL: 'Em Andamento',
  NEGOTIATION: 'Em Andamento',
  WON: 'Encerrado',
  LOST: 'Cancelado',
};

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

export function LeadDuplicates() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPrimary, setSelectedPrimary] = useState<Record<number, string>>({});
  const [merging, setMerging] = useState<number | null>(null);
  const [confirmGroup, setConfirmGroup] = useState<number | null>(null);

  useEffect(() => {
    fetchDuplicates();
  }, []);

  const fetchDuplicates = async () => {
    try {
      setLoading(true);
      const response = await apiClient.getLeadDuplicates();
      const data = response.data || response;
      const fetchedGroups: DuplicateGroup[] = data.groups || [];
      setGroups(fetchedGroups);

      // Set default primary for each group (earliest created lead)
      const defaults: Record<number, string> = {};
      fetchedGroups.forEach((group, idx) => {
        if (group.leads.length > 0) {
          const sorted = [...group.leads].sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          );
          defaults[idx] = sorted[0].id;
        }
      });
      setSelectedPrimary(defaults);
    } catch (error) {
      console.error('Erro ao buscar duplicados:', error);
      toast.error('Erro ao buscar leads duplicados. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleMerge = async (groupIndex: number) => {
    const group = groups[groupIndex];
    const primaryId = selectedPrimary[groupIndex];
    if (!primaryId || !group) return;

    const duplicateIds = group.leads.filter((l) => l.id !== primaryId).map((l) => l.id);
    if (duplicateIds.length === 0) return;

    try {
      setMerging(groupIndex);
      await apiClient.mergeLeads(primaryId, duplicateIds);
      toast.success(`${duplicateIds.length} lead(s) mesclado(s) com sucesso!`);
      // Remove merged group from list
      setGroups((prev) => prev.filter((_, idx) => idx !== groupIndex));
      // Reindex selectedPrimary
      setSelectedPrimary((prev) => {
        const newMap: Record<number, string> = {};
        const remainingGroups = groups.filter((_, idx) => idx !== groupIndex);
        remainingGroups.forEach((g, idx) => {
          const oldIdx = groups.indexOf(g);
          if (prev[oldIdx]) {
            newMap[idx] = prev[oldIdx];
          }
        });
        return newMap;
      });
    } catch (error) {
      console.error('Erro ao mesclar leads:', error);
      toast.error('Erro ao mesclar leads. Tente novamente.');
    } finally {
      setMerging(null);
      setConfirmGroup(null);
    }
  };

  return (
    <div className="min-h-screen">
      <Header
        title="Leads Duplicados"
        subtitle="Detecte e mescle leads duplicados por email ou telefone"
      />

      <div className="p-8">
        {/* Back button */}
        <Button variant="outline" className="gap-2 mb-6" onClick={() => navigate('/app/leads')}>
          <ArrowLeft size={16} />
          Voltar para Leads
        </Button>

        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={32} className="animate-spin text-primary" />
          </div>
        )}

        {/* Content */}
        {!loading && (
          <>
            {/* Summary */}
            <div className="bg-card rounded-lg p-4 shadow-sm border border-gray-300 mb-6">
              <p className="text-gray-700 font-medium">
                {groups.length > 0
                  ? `${groups.length} grupo(s) de duplicados encontrado(s)`
                  : 'Nenhum duplicado encontrado'}
              </p>
            </div>

            {/* Empty state */}
            {groups.length === 0 && (
              <div className="bg-card rounded-lg shadow-sm border border-gray-300 p-12 text-center">
                <CheckCircle2 size={48} className="mx-auto text-green-500 mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  Nenhum duplicado encontrado
                </h3>
                <p className="text-gray-600">
                  Sua base de leads esta limpa. Nenhum lead duplicado foi detectado.
                </p>
              </div>
            )}

            {/* Duplicate groups */}
            {groups.map((group, groupIndex) => (
              <div
                key={`${group.matchField}-${group.matchValue}-${groupIndex}`}
                className="bg-card rounded-lg shadow-sm border border-gray-300 mb-6 overflow-hidden"
              >
                {/* Group header */}
                <div className="bg-gray-50 px-6 py-4 border-b border-gray-300">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Copy size={16} className="text-gray-500" />
                      <span className="font-medium text-gray-900">
                        Duplicados por {group.matchField === 'email' ? 'email' : 'telefone'}:{' '}
                        <span className="text-primary">{group.matchValue}</span>
                      </span>
                      <span className="text-sm text-gray-500">({group.leads.length} leads)</span>
                    </div>
                    <Button
                      size="sm"
                      className="gap-2"
                      onClick={() => setConfirmGroup(groupIndex)}
                      disabled={merging === groupIndex}
                    >
                      {merging === groupIndex ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : null}
                      Mesclar
                    </Button>
                  </div>
                </div>

                {/* Leads table */}
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-100 border-b border-gray-200">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                          Principal
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                          Nome
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                          Email
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                          Telefone
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                          Empresa
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                          Status
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                          Criado em
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {group.leads.map((lead) => (
                        <tr
                          key={lead.id}
                          className={`hover:bg-gray-50 transition-colors ${
                            selectedPrimary[groupIndex] === lead.id ? 'bg-blue-50' : ''
                          }`}
                        >
                          <td className="px-6 py-4">
                            <input
                              type="radio"
                              name={`primary-${groupIndex}`}
                              checked={selectedPrimary[groupIndex] === lead.id}
                              onChange={() =>
                                setSelectedPrimary((prev) => ({
                                  ...prev,
                                  [groupIndex]: lead.id,
                                }))
                              }
                              className="h-4 w-4 text-primary focus:ring-primary border-gray-300"
                            />
                          </td>
                          <td className="px-6 py-4 font-medium text-gray-900">{lead.name}</td>
                          <td className="px-6 py-4 text-gray-600">{lead.email || '-'}</td>
                          <td className="px-6 py-4 text-gray-600">{lead.phone || '-'}</td>
                          <td className="px-6 py-4 text-gray-600">{lead.company || '-'}</td>
                          <td className="px-6 py-4">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                              {statusLabels[lead.status] || lead.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-gray-600">{formatDate(lead.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Confirmation dialog */}
      <AlertDialog
        open={confirmGroup !== null}
        onOpenChange={(open) => !open && setConfirmGroup(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Mesclagem</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmGroup !== null && groups[confirmGroup] && (
                <>
                  Os leads duplicados serao removidos e suas interacoes, tarefas e logs de automacao
                  serao transferidos para o lead principal selecionado. Esta acao nao pode ser
                  desfeita.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmGroup(null)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmGroup !== null) handleMerge(confirmGroup);
              }}
            >
              Confirmar Mesclagem
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
