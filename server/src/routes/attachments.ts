/**
 * /attachments — Central de arquivos (Upgrade RD P2, req 22).
 *
 * Handlers reais (dono B2) sobre `storageService` + `attachmentService`:
 *   POST   /attachments               multipart (file ≤25MB) + dealId?/companyId?/leadId?/interactionId?
 *   GET    /attachments?dealId=|companyId=|leadId=|interactionId=   metadados (sem bytes) + autor
 *   GET    /attachments/usage         { usedMB, limitMB }  (antes de /:id/download)
 *   GET    /attachments/:id/download  stream com mimeType/Content-Disposition
 *   DELETE /attachments/:id           soft-delete (integra Lixeira P1) + gate deleteRecords
 *
 * Multi-tenant: toda query filtra por tenantId. Upload valida allowlist de
 * mimeType, tamanho ≤25MB e sanitiza o nome; download força
 * `Content-Disposition: attachment` (nunca inline) para tipos perigosos.
 *
 * Visibilidade P1 (req 22): list/download/delete revalidam o acesso do usuário ao
 * "pai" (deal/empresa/lead/interação) do anexo via `visibilityScope` — negam (404)
 * se fora do escopo. DELETE exige a capability `deleteRecords` (builtins têm →
 * sem regressão).
 *
 * Atividades de lead (spec req 40): anexo também se vincula a leadId/interactionId
 * (Reunião); quando só a interação é informada, o leadId é derivado dela.
 */
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { Attachment } from '@prisma/client';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { tenantScope } from '../middleware/tenant.js';
import { createError } from '../middleware/errorHandler.js';
import prisma from '../config/database.js';
import { storageService } from '../services/storageService.js';
import { visibilityScope } from '../services/permissionService.js';
import type { PermissionUser } from '../services/permissionService.js';
import {
  MAX_UPLOAD_BYTES,
  isAllowedMimeType,
  sanitizeFileName,
  attachmentSelect,
  attachAuthors,
} from '../services/attachmentService.js';

const router = Router();

router.use(authenticate);
router.use(tenantScope);

/** Usuário do req adaptado ao contrato do permissionService (visibilidade P1). */
function permUser(u: {
  userId: string;
  tenantId: string;
  role?: string;
  isPlatformAdmin?: boolean;
}): PermissionUser {
  return {
    userId: u.userId,
    tenantId: u.tenantId,
    role: u.role,
    isPlatformAdmin: u.isPlatformAdmin,
  };
}

/**
 * Revalida o acesso do usuário ao "pai" (deal/empresa/lead/interação) de um anexo
 * via a visibilidade efetiva do P1 (req 22). Retorna `true` quando acessível.
 *
 * - Anexo SEM pai (dealId/companyId/leadId/interactionId nulos): acessível (só o
 *   filtro de tenant vale).
 * - Anexo COM dealId: acessível se o deal cai no `visibilityScope(user,'deals')`
 *   (GERAL → sem filtro; PROPRIA → só do próprio; EQUIPE → da equipe).
 * - Anexo COM companyId: idem via `visibilityScope(user,'companies')`.
 * - Anexo COM leadId/interactionId (spec req 40): leads NÃO têm visibilityScope
 *   por dono no GET atual de leads — qualquer usuário do tenant acessa; checamos
 *   apenas a posse por tenant do pai (mesmo padrão do GET de leads).
 *
 * FAIL-CLOSED / == HOJE: sem perfil custom, USER tem deals=PROPRIA e companies=GERAL
 * (exatamente o de hoje); qualquer erro recai nos defaults do role.
 */
async function canAccessAttachmentParent(
  user: PermissionUser,
  att: Pick<Attachment, 'dealId' | 'companyId' | 'leadId' | 'interactionId'>
): Promise<boolean> {
  const tenantId = user.tenantId;

  if (att.dealId) {
    const scope = await visibilityScope(user, 'deals');
    if (scope !== undefined) {
      const deal = await prisma.deal.findFirst({
        where: { id: att.dealId, tenantId, assignedTo: scope },
        select: { id: true },
      });
      if (!deal) return false;
    }
  }

  if (att.companyId) {
    const scope = await visibilityScope(user, 'companies');
    if (scope !== undefined) {
      const company = await prisma.company.findFirst({
        where: { id: att.companyId, tenantId, assignedTo: scope },
        select: { id: true },
      });
      if (!company) return false;
    }
  }

  if (att.leadId) {
    const lead = await prisma.lead.findFirst({
      where: { id: att.leadId, tenantId },
      select: { id: true },
    });
    if (!lead) return false;
  }

  if (att.interactionId) {
    const interaction = await prisma.interaction.findFirst({
      where: { id: att.interactionId, tenantId },
      select: { id: true },
    });
    if (!interaction) return false;
  }

  return true;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

// Traduz erros do multer (ex.: arquivo grande demais) para o formato do projeto.
function handleUpload(field: string) {
  const mw = upload.single(field);
  return (req: any, res: any, next: any) => {
    mw(req, res, (err: unknown) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          return next(
            createError('Arquivo excede o tamanho máximo de 25 MB.', 413, 'FILE_TOO_LARGE')
          );
        }
        return next(createError('Falha no upload do arquivo.', 400, 'UPLOAD_FAILED'));
      }
      next();
    });
  };
}

const linkSchema = z.object({
  dealId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  // Atividades de lead (spec req 40): anexo vinculado a lead e/ou interação (Reunião).
  leadId: z.string().uuid().optional(),
  interactionId: z.string().uuid().optional(),
});

const listQuerySchema = z.object({
  dealId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  interactionId: z.string().uuid().optional(),
});

// ─── POST / — Upload de anexo ────────────────────────────────────────────────

router.post('/', handleUpload('file'), async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }
    const file = (req as any).file as
      | { originalname: string; mimetype: string; buffer: Buffer }
      | undefined;
    if (!file) {
      return next(createError('Nenhum arquivo enviado (campo "file").', 400, 'NO_FILE'));
    }

    const mimeType = file.mimetype || 'application/octet-stream';
    if (!isAllowedMimeType(mimeType)) {
      return next(
        createError(`Tipo de arquivo não permitido: ${mimeType}.`, 415, 'UNSUPPORTED_MEDIA_TYPE')
      );
    }

    const parsedLinks = linkSchema.parse(req.body);
    const { dealId, companyId, interactionId } = parsedLinks;
    // `let`: pode ser derivado da interação quando não informado (req 40).
    let leadId = parsedLinks.leadId;
    const { tenantId } = req.user;

    // Valida que o vínculo (deal/empresa/lead/interação) pertence ao tenant,
    // quando informado (spec req 40 + restrição multi-tenant).
    if (dealId) {
      const deal = await prisma.deal.findFirst({
        where: { id: dealId, tenantId },
        select: { id: true },
      });
      if (!deal) return next(createError('Negócio não encontrado.', 404, 'DEAL_NOT_FOUND'));
    }
    if (companyId) {
      const company = await prisma.company.findFirst({
        where: { id: companyId, tenantId },
        select: { id: true },
      });
      if (!company) return next(createError('Empresa não encontrada.', 404, 'COMPANY_NOT_FOUND'));
    }
    if (leadId) {
      const lead = await prisma.lead.findFirst({
        where: { id: leadId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!lead) return next(createError('Lead não encontrado.', 404, 'LEAD_NOT_FOUND'));
    }
    if (interactionId) {
      const interaction = await prisma.interaction.findFirst({
        where: { id: interactionId, tenantId, deletedAt: null },
        select: { id: true, leadId: true },
      });
      if (!interaction) {
        return next(createError('Atividade não encontrada.', 404, 'INTERACTION_NOT_FOUND'));
      }
      // Anexo enviado só com a interação: deriva o lead dela para que o arquivo
      // apareça também na listagem de anexos do lead (spec req 40).
      if (!leadId && interaction.leadId) {
        leadId = interaction.leadId;
      }
    }

    let attachment = await storageService.put(tenantId, {
      name: sanitizeFileName(file.originalname),
      mimeType,
      buffer: file.buffer,
      dealId: dealId ?? null,
      companyId: companyId ?? null,
      source: 'UPLOAD',
      uploadedById: req.user.userId,
    });

    // `storageService.put` não conhece leadId/interactionId (contrato compartilhado
    // com propostas/reuniões de Deal — fora dos arquivos deste corte); o vínculo de
    // atividade é gravado em update separado logo após a criação.
    if (leadId || interactionId) {
      attachment = await prisma.attachment.update({
        where: { id: attachment.id },
        data: { leadId: leadId ?? null, interactionId: interactionId ?? null },
      });
    }

    // Devolve com o autor resolvido (coluna "autor" da UI, req 22).
    const [dto] = await attachAuthors(prisma, tenantId, [attachment]);
    res.status(201).json({ status: 201, data: dto });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
    }
    next(error);
  }
});

// ─── GET / — Lista de anexos (metadados, sem bytes) ──────────────────────────

router.get('/', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }
    const { dealId, companyId, leadId, interactionId } = listQuerySchema.parse(req.query);
    const { tenantId } = req.user;
    const user = permUser(req.user);

    const attachments = await prisma.attachment.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(dealId ? { dealId } : {}),
        ...(companyId ? { companyId } : {}),
        ...(leadId ? { leadId } : {}),
        ...(interactionId ? { interactionId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: attachmentSelect,
    });

    // Visibilidade P1 (req 22): só devolve anexos cujo pai (deal/empresa) o usuário
    // pode ver. Sem perfil custom, o escopo é GERAL/PROPRIA de hoje (fail-closed).
    const visible = [];
    for (const att of attachments) {
      if (await canAccessAttachmentParent(user, att)) visible.push(att);
    }

    const data = await attachAuthors(prisma, tenantId, visible);
    res.json({ status: 200, data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(createError('Validation error', 400, 'VALIDATION_ERROR', error.errors));
    }
    next(error);
  }
});

// ─── GET /usage — Uso de armazenamento do tenant ─────────────────────────────
// DEVE vir antes de /:id/download para não ser capturado pelo param.

router.get('/usage', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }
    const usage = await storageService.usage(req.user.tenantId);
    res.json({ status: 200, data: usage });
  } catch (error) {
    next(error);
  }
});

// ─── GET /:id/download — Stream dos bytes (tenant-scoped) ─────────────────────

router.get('/:id/download', async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }
    const { id } = req.params;
    const { tenantId } = req.user;

    const attachment = await prisma.attachment.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!attachment) {
      return next(createError('Arquivo não encontrado.', 404, 'ATTACHMENT_NOT_FOUND'));
    }

    // Visibilidade P1 (req 22): nega (404) a entrega dos bytes se o anexo pertence
    // a um deal/empresa fora do escopo do usuário. Fail-closed / == hoje sem perfil.
    if (!(await canAccessAttachmentParent(permUser(req.user), attachment))) {
      return next(createError('Arquivo não encontrado.', 404, 'ATTACHMENT_NOT_FOUND'));
    }

    const buffer = await storageService.get(attachment);

    res.setHeader('Content-Type', attachment.mimeType || 'application/octet-stream');
    res.setHeader('Content-Length', String(buffer.length));
    // Sempre `attachment` (nunca inline) — defesa contra XSS via tipos perigosos.
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(attachment.name)}"`
    );
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});

// ─── DELETE /:id — Soft-delete (integra Lixeira P1) ──────────────────────────
// Gate de permissão (req 22 + P1): exige `deleteRecords`. Builtins têm
// deleteRecords=true → sem regressão; só um perfil custom que desligou a capability
// nega (403). Fail-closed via requirePermission.

router.delete('/:id', requirePermission('deleteRecords'), async (req, res, next) => {
  try {
    if (!req.user) {
      return next(createError('Authentication required', 401));
    }
    const { id } = req.params;
    const { tenantId } = req.user;

    const existing = await prisma.attachment.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, dealId: true, companyId: true, leadId: true, interactionId: true },
    });
    if (!existing) {
      return next(createError('Arquivo não encontrado.', 404, 'ATTACHMENT_NOT_FOUND'));
    }

    // Visibilidade P1 (req 22): não permite excluir anexo de um pai fora do escopo.
    if (!(await canAccessAttachmentParent(permUser(req.user), existing))) {
      return next(createError('Arquivo não encontrado.', 404, 'ATTACHMENT_NOT_FOUND'));
    }

    await storageService.remove(tenantId, id);
    res.json({ status: 200, data: { deleted: true } });
  } catch (error) {
    next(error);
  }
});

export default router;
