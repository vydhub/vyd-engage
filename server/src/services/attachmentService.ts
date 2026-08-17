/**
 * attachmentService — regras de anexo compartilhadas (Upgrade RD P2, req 22).
 *
 * Concentra allowlist de mimeType, sanitização de nome e o DTO público (nunca
 * expõe storageKey/bytes), reusados pela rota `/attachments` e pelo
 * `proposalService` (PDF gerado = Attachment source=PROPOSAL). A persistência
 * dos bytes fica no `storageService` (provider "db" | "s3" gated).
 */
import type { Attachment } from '@prisma/client';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

// Allowlist de mimeTypes (PDF / imagem / office / texto / csv / áudio). Qualquer
// tipo fora da lista é recusado (415) no upload de usuário. Os tipos de áudio
// habilitam o upload de gravação de reunião (IA de reuniões, Upgrade RD P3).
export const ALLOWED_MIME_TYPES = new Set<string>([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'application/csv',
  // Áudio de reunião (P3) — usado por POST /deals/:id/meetings.
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/webm',
  'audio/mp4',
  'audio/x-m4a',
]);

export function isAllowedMimeType(mimeType: string): boolean {
  return ALLOWED_MIME_TYPES.has(mimeType);
}

/**
 * Sanitiza o nome do arquivo: remove componentes de caminho, caracteres de
 * controle e os proibidos em nomes de arquivo; normaliza espaços. Mantém acentos
 * (pt-BR). Limita a 255 chars. Fallback "arquivo".
 */
export function sanitizeFileName(raw: string | undefined | null): string {
  const base =
    String(raw ?? '')
      .replace(/\\/g, '/')
      .split('/')
      .pop() ?? '';
  const cleaned = base
    // Remove caracteres de controle (0x00-0x1F) e proibidos (<>:"/\|?*).
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 255);
  return cleaned || 'arquivo';
}

/**
 * Campos do Attachment expostos ao cliente (metadados; nunca storageKey/bytes).
 *
 * O autor (`uploadedBy`) NÃO é um join Prisma aqui — o modelo Attachment guarda só
 * `uploadedById` (FK sem relation declarada, para não exigir migração). A rota
 * resolve o nome do autor num lookup batelado a `User` (tenant-scoped) e o DTO o
 * expõe como `uploadedBy:{id,name}` — a coluna "autor" da UI lê `uploadedBy?.name`
 * (req 22).
 */
export const attachmentSelect = {
  id: true,
  tenantId: true,
  name: true,
  mimeType: true,
  size: true,
  storageProvider: true,
  dealId: true,
  companyId: true,
  // Vínculos de atividade de lead (spec req 40): anexo pode pertencer a um lead
  // e/ou a uma interação (Reunião) — a timeline lista/baixa por esses campos.
  leadId: true,
  interactionId: true,
  source: true,
  uploadedById: true,
  createdAt: true,
} as const;

/** Autor do anexo (id + nome do User); null quando não houver autor. */
export interface AttachmentAuthor {
  id: string;
  name: string | null;
}

export interface AttachmentDto {
  id: string;
  tenantId: string;
  name: string;
  mimeType: string;
  size: number;
  storageProvider: string;
  dealId: string | null;
  companyId: string | null;
  leadId: string | null;
  interactionId: string | null;
  source: string;
  uploadedById: string | null;
  uploadedBy: AttachmentAuthor | null;
  createdAt: Date;
}

/**
 * Shape mínimo aceito pelo mapper: os campos escalares do Attachment + o join
 * opcional `uploadedBy`. Aceita registros vindos de `attachmentSelect` (com autor)
 * e também os do storageService.put (sem o join — `uploadedBy` ausente → null).
 */
type AttachmentDtoInput = Pick<
  Attachment,
  'id' | 'tenantId' | 'name' | 'mimeType' | 'size' | 'storageProvider' | 'dealId' | 'companyId' | 'source' | 'uploadedById' | 'createdAt'
> & {
  uploadedBy?: AttachmentAuthor | null;
  // Vínculos de atividade de lead (spec req 40) — OPCIONAIS no input para manter
  // compat com chamadas/fixtures anteriores a este corte; o DTO sempre os emite
  // (default null). Registros reais (attachmentSelect / model completo) já os têm.
  leadId?: string | null;
  interactionId?: string | null;
};

/** Metadados públicos do anexo (nunca expõe storageKey/bytes). */
export function toAttachmentDto(a: AttachmentDtoInput): AttachmentDto {
  return {
    id: a.id,
    tenantId: a.tenantId,
    name: a.name,
    mimeType: a.mimeType,
    size: a.size,
    storageProvider: a.storageProvider,
    dealId: a.dealId,
    companyId: a.companyId,
    leadId: a.leadId ?? null,
    interactionId: a.interactionId ?? null,
    source: a.source,
    uploadedById: a.uploadedById,
    uploadedBy: a.uploadedBy
      ? { id: a.uploadedBy.id, name: a.uploadedBy.name ?? null }
      : null,
    createdAt: a.createdAt,
  };
}

/** Cliente Prisma mínimo p/ o lookup batelado de autores (facilita o mock em teste). */
interface UserLookup {
  user: {
    findMany: (args: {
      where: { id: { in: string[] }; tenantId: string };
      select: { id: true; name: true };
    }) => Promise<Array<{ id: string; name: string | null }>>;
  };
}

/**
 * Enrique uma lista de anexos com o autor (`uploadedBy:{id,name}`), resolvendo os
 * nomes num ÚNICO lookup batelado a `User` (tenant-scoped) — evita N+1 e não exige
 * relation no schema. Registros sem `uploadedById` (ou autor inexistente) ficam com
 * `uploadedBy: null`.
 */
export async function attachAuthors(
  db: UserLookup,
  tenantId: string,
  rows: AttachmentDtoInput[]
): Promise<AttachmentDto[]> {
  const ids = [...new Set(rows.map((r) => r.uploadedById).filter((v): v is string => !!v))];
  const byId = new Map<string, AttachmentAuthor>();
  if (ids.length > 0) {
    const users = await db.user.findMany({
      where: { id: { in: ids }, tenantId },
      select: { id: true, name: true },
    });
    for (const u of users) byId.set(u.id, { id: u.id, name: u.name ?? null });
  }
  return rows.map((r) =>
    toAttachmentDto({ ...r, uploadedBy: r.uploadedById ? byId.get(r.uploadedById) ?? null : null })
  );
}
