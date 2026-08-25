import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { RichTextEditor } from '../ui/RichTextEditor';
import { CompanyPicker } from './CompanyPicker';
import { apiClient } from '../../services/api/client';
import { useEmpreendimentos, usePlaybooks, useRoadmapActions } from '../../hooks/useComercial';
import { stripHtml } from '../../lib/richText';
import {
  COMMERCIAL_FUNCTION_LABELS,
  type CommercialFunction,
  type CommercialRoadmap,
  type RoleAssignment,
} from '../../types/comercial';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (roadmap: CommercialRoadmap) => void;
  /** Semeia o desdobramento a partir de uma pesquisa (opcional). */
  deepResearchId?: string;
  /** Empresa pré-selecionada (opcional). */
  defaultCompanyId?: string;
  /** Título sugerido (opcional — ex.: "Aquecimento — {empresa}"). */
  defaultTitle?: string;
}

const NONE = '__none__';

type TeamUser = { id: string; name: string; commercialFunction?: CommercialFunction | null };

export function RoadmapCreateDialog({
  open,
  onOpenChange,
  onCreated,
  deepResearchId,
  defaultCompanyId,
  defaultTitle,
}: Props) {
  const { createRoadmap } = useRoadmapActions();
  const [title, setTitle] = useState(defaultTitle ?? '');
  const [companyId, setCompanyId] = useState(defaultCompanyId ?? '');
  const [empreendimentoId, setEmpreendimentoId] = useState<string>(NONE);
  const [playbookTemplateId, setPlaybookTemplateId] = useState<string>(NONE);
  const [researchId, setResearchId] = useState<string>(deepResearchId ?? NONE);
  const [notes, setNotes] = useState('');
  const [roleMap, setRoleMap] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);


  const empreendimentosQuery = useEmpreendimentos(companyId ? { companyId } : undefined);
  const empreendimentos = companyId ? (empreendimentosQuery.data?.items ?? []) : [];

  const playbooksQuery = usePlaybooks();
  const playbooks = playbooksQuery.data?.items ?? [];

  const usersQuery = useQuery({
    queryKey: ['users', 'roadmap-mapping'],
    queryFn: () => apiClient.getUsers() as Promise<TeamUser[]>,
    enabled: open,
  });
  const teamUsers = usersQuery.data ?? [];

  const researchesQuery = useQuery({
    queryKey: ['deep-research', 'roadmap-seed'],
    queryFn: () => apiClient.getDeepResearches({ limit: 100 }),
    enabled: open,
  });
  const researches = (researchesQuery.data?.items ?? []) as Array<{ id: string; title: string }>;

  // Funções comerciais distintas usadas pelos passos do playbook selecionado (req 5).
  const usedFunctions = useMemo<CommercialFunction[]>(() => {
    if (playbookTemplateId === NONE) return [];
    const pb = playbooks.find((p) => p.id === playbookTemplateId);
    if (!pb) return [];
    const set = new Set<CommercialFunction>();
    for (const s of pb.steps) if (s.responsibleFunction) set.add(s.responsibleFunction);
    return [...set];
  }, [playbookTemplateId, playbooks]);

  // Pré-preenche cada função com um usuário cujo commercialFunction corresponda (req 6);
  // preserva escolhas manuais já feitas.
  useEffect(() => {
    setRoleMap((prev) => {
      const next: Record<string, string> = {};
      for (const fn of usedFunctions) {
        next[fn] = prev[fn] || teamUsers.find((u) => u.commercialFunction === fn)?.id || '';
      }
      return next;
    });
  }, [usedFunctions, teamUsers]);

  // Pré-preenchimento ao abrir (aquecimento 1-clique): empresa e título sugeridos,
  // sem sobrescrever o que o usuário já digitou.
  useEffect(() => {
    if (open) {
      setTitle((t) => t || defaultTitle || '');
      setCompanyId((c) => c || defaultCompanyId || '');
    }
  }, [open, defaultTitle, defaultCompanyId]);

  const reset = () => {
    setTitle(defaultTitle ?? '');
    setCompanyId(defaultCompanyId ?? '');
    setEmpreendimentoId(NONE);
    setPlaybookTemplateId(NONE);
    setResearchId(deepResearchId ?? NONE);
    setNotes('');
    setRoleMap({});
  };

  const submit = async () => {
    if (!title.trim() || !companyId) return;
    setSubmitting(true);
    try {
      const roleAssignments = usedFunctions
        .map((fn) => ({ function: fn, userId: roleMap[fn] }))
        .filter((a): a is RoleAssignment => !!a.userId);
      const roadmap = await createRoadmap({
        title: title.trim(),
        companyId,
        empreendimentoId: empreendimentoId === NONE ? undefined : empreendimentoId,
        playbookTemplateId: playbookTemplateId === NONE ? undefined : playbookTemplateId,
        deepResearchId: researchId === NONE ? undefined : researchId,
        notes: stripHtml(notes) ? notes : undefined,
        roleAssignments: roleAssignments.length ? roleAssignments : undefined,
      });
      reset();
      onOpenChange(false);
      onCreated?.(roadmap);
    } catch {
      /* toast já exibido pelo hook */
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-y-auto sm:max-w-[520px]" style={{ maxHeight: '85vh' }}>
        <DialogHeader>
          <DialogTitle>Novo desdobramento</DialogTitle>
          <DialogDescription>
            Escolha a empresa e, opcionalmente, um empreendimento e um playbook. O playbook gera as
            ações de acesso na agenda.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="rm-title">Título</Label>
            <Input
              id="rm-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Acesso à Construtora Acme"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="roadmap-empresa">Empresa</Label>
            {/* Busca no SERVIDOR: o `<Select>` anterior trazia no máximo 100 de
                219 empresas do tenant e não tinha filtro de texto. */}
            <CompanyPicker
              id="roadmap-empresa"
              value={companyId}
              required
              onChange={(id: string) => {
                setCompanyId(id);
                setEmpreendimentoId(NONE);
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Empreendimento (opcional)</Label>
            <Select
              value={empreendimentoId}
              onValueChange={setEmpreendimentoId}
              disabled={!companyId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Nenhum" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Nenhum</SelectItem>
                {empreendimentos.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Playbook (opcional — gera as ações)</Label>
            <Select value={playbookTemplateId} onValueChange={setPlaybookTemplateId}>
              <SelectTrigger>
                <SelectValue placeholder="Sem playbook" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Sem playbook (adiciono manualmente)</SelectItem>
                {playbooks.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                    {p.isBuiltin ? ' · padrão' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Mapeamento função→pessoa (req 5-7): só aparece quando o playbook usa funções. */}
          {usedFunctions.length > 0 && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <Label className="text-xs text-muted-foreground">
                Responsáveis por função (o playbook usa estas funções)
              </Label>
              {usedFunctions.map((fn) => (
                <div key={fn} className="space-y-1">
                  <Label className="text-xs">
                    Quem é o {COMMERCIAL_FUNCTION_LABELS[fn]} deste desdobramento?
                  </Label>
                  <Select
                    value={roleMap[fn] || NONE}
                    onValueChange={(v) =>
                      setRoleMap((m) => ({ ...m, [fn]: v === NONE ? '' : v }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um membro" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Sem responsável (cai no criador)</SelectItem>
                      {teamUsers.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Pesquisa de origem (opcional)</Label>
            <Select value={researchId} onValueChange={setResearchId}>
              <SelectTrigger>
                <SelectValue placeholder="Sem pesquisa" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Sem pesquisa</SelectItem>
                {researches.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Notas (opcional)</Label>
            <RichTextEditor
              value={notes}
              onChange={setNotes}
              placeholder="Notas do desdobramento…"
              minHeight={90}
              ariaLabel="Notas do desdobramento"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={submitting || !title.trim() || !companyId}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Criar desdobramento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
