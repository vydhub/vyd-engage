/**
 * Chaves de rascunho de formulário (useFormDraft). Ficam num módulo próprio
 * porque o formulário GRAVA o rascunho e a listagem LÊ para oferecer "retomar" —
 * uma string divergente entre os dois quebraria a retomada em silêncio.
 */
export const TASK_DRAFT_PREFIX = 'task.';
export const LEAD_DRAFT_PREFIX = 'lead.';
