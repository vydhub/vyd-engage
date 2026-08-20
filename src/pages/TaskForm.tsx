import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Header } from '../components/Header';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Task } from '../types';
import { useTasks } from '../hooks/useTasks';
import { useFormDraft } from '../hooks/useFormDraft';
import { TASK_DRAFT_PREFIX } from '../utils/draftKeys';
import { useLeads } from '../hooks/useLeads';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { FieldError } from '../components/register/FieldError';
import { taskFormSchema } from '../utils/validation/formSchemas';
import { useFormValidation } from '../hooks/useFormValidation';
import { useAutoFocus } from '../hooks/useFocusManagement';

export function TaskForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const leadIdParam = searchParams.get('leadId');
  const { tasks, createTask, updateTask, fetchTasks } = useTasks();
  const { leads } = useLeads();

  const [task, setTask] = useState<Task | null>(null);
  // Rascunho por rota: sair para outra aba do sistema e voltar não pode apagar
  // o que já foi digitado (chave 'task.new' na criação, 'task.<id>' na edição).
  const initialFormData = useMemo(
    () => ({
      leadId: leadIdParam || '',
      title: '',
      description: '',
      dueDate: new Date().toISOString().split('T')[0],
      dueTime: '09:00',
      priority: 'MEDIUM' as Task['priority'],
    }),
    [leadIdParam]
  );
  const [formData, setFormData, draft] = useFormDraft(
    id ? `${TASK_DRAFT_PREFIX}${id}` : `${TASK_DRAFT_PREFIX}new`,
    initialFormData
  );
  const { fieldErrors, touchedFields, handleBlur, handleChange, validateAll, formRef } =
    useFormValidation({ schema: taskFormSchema });
  const autoFocusRef = useAutoFocus<HTMLDivElement>(!id);

  useEffect(() => {
    if (id) {
      const foundTask = tasks.find((t) => t.id === id);
      if (foundTask) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- sincroniza task/formData a partir da tarefa carregada (tasks) pelo id da rota
        setTask(foundTask);
        // Rascunho restaurado tem precedência: sobrescrever aqui apagaria a
        // edição em andamento assim que a lista de tarefas chegasse do servidor.
        if (draft.restored) return;
        const dueDate = foundTask.dueDate ? new Date(foundTask.dueDate) : new Date();
        setFormData({
          leadId: foundTask.leadId?.toString() || '',
          title: foundTask.title,
          description: foundTask.description || '',
          dueDate: dueDate.toISOString().split('T')[0],
          dueTime: dueDate.toTimeString().slice(0, 5),
          priority: foundTask.priority,
        });
      }
    } else if (leadIdParam) {
      setFormData((prev) => ({ ...prev, leadId: leadIdParam }));
    }
  }, [id, leadIdParam, tasks]);

  const handleSave = async () => {
    const isValid = validateAll({
      leadId: formData.leadId,
      title: formData.title,
      description: formData.description,
      dueDate: formData.dueDate,
      dueTime: formData.dueTime,
      priority: formData.priority,
    });
    if (!isValid) return;

    const dueDateTime = new Date(`${formData.dueDate}T${formData.dueTime}`);

    try {
      if (task) {
        await updateTask(task.id, {
          leadId: formData.leadId,
          title: formData.title.trim(),
          description: formData.description.trim() || undefined,
          dueDate: dueDateTime.toISOString(),
          priority: formData.priority,
          status: task.status,
        });
      } else {
        await createTask({
          leadId: formData.leadId,
          title: formData.title.trim(),
          description: formData.description.trim() || undefined,
          dueDate: dueDateTime.toISOString(),
          priority: formData.priority,
          status: 'PENDING',
        });
      }
      draft.clear(); // salvou: o rascunho não deve reaparecer
      navigate('/app/tasks');
    } catch (error) {
      console.error('Erro ao salvar tarefa:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <Header
        title={task ? 'Editar Tarefa' : 'Nova Tarefa'}
        subtitle={task ? `Editando: ${task.title}` : 'Preencha os dados da nova tarefa'}
      />

      <div className="p-8 overflow-visible">
        <div className="mb-6">
          <Button variant="outline" onClick={() => navigate('/app/tasks')} className="gap-2">
            <ArrowLeft size={16} />
            Voltar para Tarefas
          </Button>
        </div>

        <div className="bg-card rounded-lg shadow-sm border border-gray-300 max-w-2xl relative overflow-visible">
          <div className="p-6 border-b border-gray-300">
            <h2 className="text-xl font-semibold text-gray-900">
              {task ? 'Editar Tarefa' : 'Nova Tarefa'}
            </h2>
          </div>

          <div className="p-6 space-y-6 overflow-visible" ref={autoFocusRef}>
            <div className="relative overflow-visible">
              <Label htmlFor="task-lead">Lead *</Label>
              <Select
                value={formData.leadId || undefined}
                onValueChange={(value) => {
                  setFormData({ ...formData, leadId: value });
                  handleChange('leadId', value);
                  handleBlur('leadId', value);
                }}
              >
                <SelectTrigger
                  className="mt-1.5 w-full"
                  aria-invalid={!!(touchedFields.leadId && fieldErrors.leadId)}
                >
                  <SelectValue placeholder="Selecione um lead" />
                </SelectTrigger>
                <SelectContent className="z-[9999] bg-card border-2 border-primary shadow-lg max-h-[300px] overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-gray-100 [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:hover:bg-gray-400">
                  {leads.length > 0 ? (
                    leads.map((lead: any) => (
                      <SelectItem key={lead.id} value={lead.id.toString()}>
                        {lead.name}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="no-leads" disabled>
                      Nenhum lead disponível
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              <FieldError
                id="task-lead-error"
                error={fieldErrors.leadId as string}
                touched={touchedFields.leadId}
              />
            </div>

            <div>
              <Label htmlFor="task-title">Título *</Label>
              <Input
                id="task-title"
                value={formData.title}
                onChange={(e) => {
                  setFormData({ ...formData, title: e.target.value });
                  handleChange('title', e.target.value);
                }}
                onBlur={() => handleBlur('title', formData.title)}
                placeholder="Ex: Ligar para o cliente amanhã"
                className="mt-1.5"
                error={touchedFields.title ? fieldErrors.title : undefined}
                aria-describedby={
                  fieldErrors.title && touchedFields.title ? 'task-title-error' : undefined
                }
              />
              <FieldError
                id="task-title-error"
                error={fieldErrors.title as string}
                touched={touchedFields.title}
              />
            </div>

            <div>
              <Label htmlFor="task-description">Descrição</Label>
              <Textarea
                id="task-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Detalhes adicionais sobre a tarefa..."
                rows={3}
                className="mt-1.5"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="task-date">Data de Vencimento *</Label>
                <Input
                  id="task-date"
                  type="date"
                  value={formData.dueDate}
                  onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="task-time">Hora</Label>
                <Input
                  id="task-time"
                  type="time"
                  value={formData.dueTime}
                  onChange={(e) => setFormData({ ...formData, dueTime: e.target.value })}
                  className="mt-1.5"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="task-priority">Prioridade</Label>
              <Select
                value={formData.priority}
                onValueChange={(value) =>
                  setFormData({ ...formData, priority: value as Task['priority'] })
                }
              >
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOW">Baixa</SelectItem>
                  <SelectItem value="MEDIUM">Média</SelectItem>
                  <SelectItem value="HIGH">Alta</SelectItem>
                  <SelectItem value="URGENT">Urgente</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-300 mt-6">
              <Button
                variant="outline"
                type="button"
                onClick={() => {
                  draft.clear(); // cancelar é decisão explícita: descarta o rascunho
                  navigate('/app/tasks');
                }}
              >
                Cancelar
              </Button>
              <Button onClick={handleSave} className="bg-primary hover:bg-primary-dark">
                {task ? 'Salvar' : 'Criar'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
