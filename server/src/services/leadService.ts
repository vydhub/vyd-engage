import prisma from '../config/database.js';
import { LeadStatus, LeadSource, LeadStatusReason, ScoreEvent } from '@prisma/client';
import { createError } from '../middleware/errorHandler.js';
import { scoringService } from './scoringService.js';
import { dispatchTrigger } from '../jobs/automationEngine.js';
import { planLimitsService } from './planLimitsService.js';
import { webhookDispatcher } from './webhookDispatcher.js';
import { emitToTenant } from './socketService.js';

export interface CreateLeadData {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  position?: string;
  companyId?: string;
  contactId?: string;
  status?: LeadStatus;
  source?: LeadSource;
  statusReason?: LeadStatusReason;
  statusReasonNote?: string;
  estimatedValue?: number;
  estimatedTimeline?: string;
  probabilityGoGet?: number;
  score?: number;
  customFields?: Record<string, any>;
  notes?: string;
  assignedTo?: string;
  tagIds?: string[];
}

export interface UpdateLeadData extends Partial<CreateLeadData> {
  id: string;
}

/** Status terminais: transição para eles exige motivo (spec req. 13). */
export const TERMINAL_LEAD_STATUSES: LeadStatus[] = [
  LeadStatus.PAUSADO,
  LeadStatus.CANCELADO,
  LeadStatus.ENCERRADO,
];

/** Rótulos pt-BR dos motivos, usados na timeline (spec req. 15). */
export const LEAD_STATUS_REASON_LABELS: Record<LeadStatusReason, string> = {
  CONVERTIDO_EM_OPORTUNIDADE: 'Convertido em oportunidade',
  PAUSADO_PELO_CLIENTE: 'Pausado pelo cliente',
  PROJETO_SUSPENSO: 'Projeto suspenso',
  SEM_ADERENCIA_TECNICA: 'Sem aderência técnica',
  CONCORRENTE_ESCOLHIDO: 'Concorrente escolhido',
  PRECO: 'Preço',
  PRAZO: 'Prazo',
  DECISAO_INTERNA_CLIENTE: 'Decisão interna do cliente',
  SEM_RETORNO: 'Sem retorno',
  OUTRO: 'Outro',
};

const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  NOVO: 'Novo',
  EM_ANDAMENTO: 'Em Andamento',
  PAUSADO: 'Pausado',
  CANCELADO: 'Cancelado',
  ENCERRADO: 'Encerrado',
};

/**
 * Valida o motivo exigido nas transições para status terminal (req. 13-14).
 * Lança 400 STATUS_REASON_REQUIRED / STATUS_REASON_NOTE_REQUIRED.
 */
export function assertStatusReason(
  status: LeadStatus,
  statusReason?: LeadStatusReason | null,
  statusReasonNote?: string | null
) {
  if (!TERMINAL_LEAD_STATUSES.includes(status)) return;
  if (!statusReason) {
    throw createError(
      'Informe o motivo para pausar, cancelar ou encerrar o lead',
      400,
      'STATUS_REASON_REQUIRED'
    );
  }
  if (statusReason === LeadStatusReason.OUTRO && !statusReasonNote?.trim()) {
    throw createError(
      'Descreva o motivo quando selecionar "Outro"',
      400,
      'STATUS_REASON_NOTE_REQUIRED'
    );
  }
}

/**
 * Valida a coerência Empresa ↔ Contato do lead-oportunidade (req. 1-2):
 * empresa do tenant; contato = Lead isContact=true do tenant, da MESMA empresa.
 * `companyId`/`contactId` já resolvidos (par final após o update).
 */
async function assertOpportunityLinks(
  tenantId: string,
  companyId?: string | null,
  contactId?: string | null
) {
  if (companyId) {
    const company = await prisma.company.findFirst({
      where: { id: companyId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!company) {
      throw createError('Empresa não encontrada', 404, 'COMPANY_NOT_FOUND');
    }
  }
  if (contactId) {
    const contact = await prisma.lead.findFirst({
      where: { id: contactId, tenantId, deletedAt: null },
      select: { id: true, isContact: true, companyId: true },
    });
    if (!contact || !contact.isContact) {
      throw createError('Contato não encontrado', 404, 'CONTACT_NOT_FOUND');
    }
    if (!companyId || contact.companyId !== companyId) {
      throw createError(
        'O contato selecionado não pertence à empresa do lead',
        400,
        'CONTACT_COMPANY_MISMATCH'
      );
    }
  }
}

/** Include padrão do lead-oportunidade (empresa, contato, responsável, tags). */
const leadInclude = {
  tags: { include: { tag: true } },
  assignedUser: { select: { id: true, name: true, email: true } },
  companyRef: { select: { id: true, name: true, fantasyName: true } },
  contactRef: { select: { id: true, name: true, position: true, email: true, phone: true } },
} as const;

export const leadService = {
  async create(tenantId: string, data: CreateLeadData) {
    // Coerência dos vínculos e do motivo (quando informados). A obrigatoriedade
    // de companyId/contactId na criação MANUAL é imposta pelo Zod da rota
    // (createLeadSchema); captação pública/import criam sem vínculo (caso 5).
    await assertOpportunityLinks(tenantId, data.companyId, data.contactId);
    const status = data.status || LeadStatus.NOVO;
    if (data.status && TERMINAL_LEAD_STATUSES.includes(data.status)) {
      assertStatusReason(data.status, data.statusReason, data.statusReasonNote);
    }

    const lead = await prisma.lead.create({
      data: {
        tenantId,
        name: data.name,
        email: data.email,
        phone: data.phone,
        company: data.company,
        position: data.position,
        companyId: data.companyId,
        contactId: data.contactId,
        status,
        source: data.source || LeadSource.OUTROS,
        statusReason: TERMINAL_LEAD_STATUSES.includes(status) ? data.statusReason : undefined,
        statusReasonNote: TERMINAL_LEAD_STATUSES.includes(status)
          ? data.statusReasonNote
          : undefined,
        estimatedValue: data.estimatedValue,
        estimatedTimeline: data.estimatedTimeline,
        probabilityGoGet: data.probabilityGoGet,
        score: data.score || 0,
        customFields: data.customFields || {},
        notes: data.notes,
        assignedTo: data.assignedTo,
      },
      include: leadInclude,
    });

    // Add tags if provided
    if (data.tagIds && data.tagIds.length > 0) {
      await Promise.all(
        data.tagIds.map((tagId) =>
          prisma.leadTag.create({
            data: {
              leadId: lead.id,
              tagId,
            },
          })
        )
      );
      // Score for each tag added
      for (const tagId of data.tagIds) {
        scoringService.processEvent(tenantId, lead.id, ScoreEvent.TAG_ADDED).catch(() => {});
      }
    }

    // Score lead creation event
    scoringService.processEvent(tenantId, lead.id, ScoreEvent.LEAD_CREATED).catch(() => {});

    // Dispatch automation trigger
    dispatchTrigger(tenantId, 'lead_created', lead.id, {
      source: data.source || 'OUTROS',
      status: status,
    }).catch(() => {});

    planLimitsService.invalidateUsage(tenantId).catch(() => {});

    // Dispatch outgoing webhook
    const createdLead = await this.findById(tenantId, lead.id);
    webhookDispatcher.emitLeadEvent(tenantId, 'lead.created', createdLead);

    // Emit Socket.IO event for real-time cache updates
    emitToTenant(tenantId, 'lead:created', { lead: createdLead });

    return createdLead;
  },

  async findById(tenantId: string, id: string) {
    const lead = await prisma.lead.findFirst({
      where: {
        id,
        tenantId,
        deletedAt: null,
      },
      include: leadInclude,
    });

    if (!lead) {
      throw createError('Lead not found', 404, 'LEAD_NOT_FOUND');
    }

    return lead;
  },

  async convertToContact(id: string, tenantId: string) {
    const lead = await this.findById(tenantId, id);

    if (lead.isContact) {
      throw createError('Lead is already a contact', 400, 'ALREADY_CONTACT');
    }

    // Não força mais status (o antigo WON não existe na régua nova):
    // contato é pessoa, não oportunidade — o status do lead fica intocado.
    const updated = await prisma.lead.update({
      where: { id },
      data: {
        isContact: true,
        convertedAt: new Date(),
      },
      include: {
        tags: {
          include: {
            tag: true,
          },
        },
      },
    });

    // Create interaction for conversion
    await prisma.interaction.create({
      data: {
        tenantId,
        leadId: id,
        type: 'STATUS_CHANGE',
        direction: 'OUTBOUND',
        subject: 'Conversão para Contato',
        content: `Lead convertido para Contato em ${new Date().toLocaleDateString('pt-BR')}`,
        metadata: { action: 'convert_to_contact', previousStatus: lead.status },
      },
    });

    return updated;
  },

  async revertToLead(id: string, tenantId: string) {
    const lead = await this.findById(tenantId, id);

    if (!lead.isContact) {
      throw createError('Lead is not a contact', 400, 'NOT_A_CONTACT');
    }

    const updated = await prisma.lead.update({
      where: { id },
      data: {
        isContact: false,
        convertedAt: null,
      },
      include: {
        tags: {
          include: {
            tag: true,
          },
        },
      },
    });

    // Create interaction for reversion
    await prisma.interaction.create({
      data: {
        tenantId,
        leadId: id,
        type: 'STATUS_CHANGE',
        direction: 'OUTBOUND',
        subject: 'Reversão para Lead',
        content: `Contato revertido para Lead em ${new Date().toLocaleDateString('pt-BR')}`,
        metadata: { action: 'revert_to_lead' },
      },
    });

    return updated;
  },

  async findAll(
    tenantId: string,
    filters?: {
      status?: LeadStatus;
      source?: LeadSource;
      search?: string;
      tagId?: string;
      assignedTo?: string;
      isContact?: boolean;
      companyId?: string;
      page?: number;
      limit?: number;
      sort?: string;
      order?: 'asc' | 'desc';
    },
    // Escopo de visibilidade por dono (req 14). DEFAULT == HOJE: undefined → SEM
    // filtro por dono (contacts GERAL para todos os builtins). Quando presente,
    // SUBSTITUI o filtro `assignedTo` bruto (já resolvido pelo visibilityScope).
    ownerScope?: string | { in: string[] }
  ) {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;
    const sortField = filters?.sort || 'createdAt';
    const sortOrder = filters?.order || 'desc';

    const where: any = {
      tenantId,
      deletedAt: null,
    };

    if (filters?.status) {
      where.status = filters.status;
    }

    if (filters?.source) {
      where.source = filters.source;
    }

    // O escopo de visibilidade (ownerScope), quando definido, é a fonte de verdade
    // do filtro por dono — já incorpora o `assignedTo` pedido no nível GERAL.
    if (ownerScope !== undefined) {
      where.assignedTo = ownerScope;
    } else if (filters?.assignedTo) {
      where.assignedTo = filters.assignedTo;
    }

    if (filters?.isContact !== undefined) {
      where.isContact = filters.isContact;
    }

    // Contatos/leads de uma empresa específica (req. 5) — também usado pelo
    // seletor de participantes e pelo de stakeholders do Desdobramento.
    if (filters?.companyId) {
      where.companyId = filters.companyId;
    }

    if (filters?.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
        { phone: { contains: filters.search, mode: 'insensitive' } },
        { company: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    if (filters?.tagId) {
      where.tags = {
        some: {
          tagId: filters.tagId,
        },
      };
    }

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        include: leadInclude,
        orderBy: {
          [sortField]: sortOrder,
        },
        skip,
        take: limit,
      }),
      prisma.lead.count({ where }),
    ]);

    return {
      leads,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  async update(tenantId: string, data: UpdateLeadData, userId?: string) {
    // Verify lead exists and belongs to tenant
    const existingLead = await this.findById(tenantId, data.id);

    // Coerência Empresa ↔ Contato sobre o PAR FINAL (req. 2 + caso extremo 2):
    // o valor novo quando enviado, senão o já gravado.
    if (data.companyId !== undefined || data.contactId !== undefined) {
      const finalCompanyId =
        data.companyId !== undefined ? data.companyId : existingLead.companyId;
      const finalContactId =
        data.contactId !== undefined ? data.contactId : existingLead.contactId;
      await assertOpportunityLinks(tenantId, finalCompanyId, finalContactId);
    }

    // Motivo obrigatório na TRANSIÇÃO para status terminal (req. 13-14).
    const statusChanged = data.status !== undefined && data.status !== existingLead.status;
    if (statusChanged && TERMINAL_LEAD_STATUSES.includes(data.status!)) {
      assertStatusReason(data.status!, data.statusReason, data.statusReasonNote);
    }

    const updateData: any = {
      name: data.name,
      email: data.email,
      phone: data.phone,
      company: data.company,
      position: data.position,
      companyId: data.companyId,
      contactId: data.contactId,
      status: data.status,
      source: data.source,
      estimatedValue: data.estimatedValue,
      estimatedTimeline: data.estimatedTimeline,
      probabilityGoGet: data.probabilityGoGet,
      score: data.score,
      customFields: data.customFields,
      notes: data.notes,
      assignedTo: data.assignedTo,
    };

    // Remove undefined values
    Object.keys(updateData).forEach((key) => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });

    // Motivo acompanha o ciclo do status (req. 13/16): grava na transição
    // terminal; limpa ao voltar para NOVO/EM_ANDAMENTO.
    if (statusChanged) {
      if (TERMINAL_LEAD_STATUSES.includes(data.status!)) {
        updateData.statusReason = data.statusReason;
        updateData.statusReasonNote =
          data.statusReason === 'OUTRO' ? data.statusReasonNote : (data.statusReasonNote ?? null);
      } else {
        updateData.statusReason = null;
        updateData.statusReasonNote = null;
      }
    }

    const lead = await prisma.lead.update({
      where: { id: data.id },
      data: updateData,
      include: leadInclude,
    });

    // Score and trigger status change
    if (statusChanged) {
      // Timeline (req. 15): registra a transição com motivo/nota.
      const reasonLabel = updateData.statusReason
        ? LEAD_STATUS_REASON_LABELS[updateData.statusReason as LeadStatusReason]
        : null;
      const contentParts = [
        `Status alterado de "${LEAD_STATUS_LABELS[existingLead.status]}" para "${LEAD_STATUS_LABELS[data.status!]}"`,
      ];
      if (reasonLabel) contentParts.push(`Motivo: ${reasonLabel}`);
      if (updateData.statusReasonNote) contentParts.push(`Nota: ${updateData.statusReasonNote}`);
      await prisma.interaction
        .create({
          data: {
            tenantId,
            leadId: data.id,
            type: 'STATUS_CHANGE',
            direction: 'OUTBOUND',
            subject: 'Mudança de status',
            content: contentParts.join('. '),
            userId,
            metadata: {
              previousStatus: existingLead.status,
              newStatus: data.status,
              statusReason: updateData.statusReason ?? null,
              statusReasonNote: updateData.statusReasonNote ?? null,
            },
          },
        })
        .catch(() => {});

      scoringService.processEvent(tenantId, data.id, ScoreEvent.STATUS_CHANGED).catch(() => {});
      dispatchTrigger(tenantId, 'status_changed', data.id, {
        oldStatus: existingLead.status,
        newStatus: data.status,
      }).catch(() => {});
    }

    // Update tags if provided
    if (data.tagIds !== undefined) {
      const existingTagIds = existingLead.tags.map((t: any) => t.tagId);

      // Remove all existing tags
      await prisma.leadTag.deleteMany({
        where: { leadId: data.id },
      });

      // Add new tags
      if (data.tagIds.length > 0) {
        await Promise.all(
          data.tagIds.map((tagId) =>
            prisma.leadTag.create({
              data: {
                leadId: data.id,
                tagId,
              },
            })
          )
        );

        // Score and trigger newly added tags
        const newTags = data.tagIds.filter((id) => !existingTagIds.includes(id));
        for (const tagId of newTags) {
          scoringService.processEvent(tenantId, data.id, ScoreEvent.TAG_ADDED).catch(() => {});
          dispatchTrigger(tenantId, 'tag_added', data.id, { tagId }).catch(() => {});
        }
      }
    }

    const updatedLead = await this.findById(tenantId, data.id);

    // Dispatch outgoing webhook — status_changed has extra context
    if (data.status && data.status !== existingLead.status) {
      webhookDispatcher.emitLeadEvent(tenantId, 'lead.status_changed', {
        ...updatedLead,
        _extra: { previous_status: existingLead.status, new_status: data.status },
      });
    }
    webhookDispatcher.emitLeadEvent(tenantId, 'lead.updated', updatedLead);

    // Emit Socket.IO event for real-time cache updates
    emitToTenant(tenantId, 'lead:updated', { lead: updatedLead });

    // Dispatch automation trigger
    dispatchTrigger(tenantId, 'lead_updated', data.id, {
      changedFields: Object.keys(updateData),
    }).catch(() => {});

    return updatedLead;
  },

  /**
   * Converte o lead em oportunidade (req. 17-18): cria o Deal copiando os dados
   * da oportunidade, vincula o contato como DealContact, encerra o lead com
   * motivo CONVERTIDO_EM_OPORTUNIDADE e registra a transição na timeline.
   * Idempotente: se o lead já foi convertido e tem deal, devolve o existente.
   */
  async convertToOpportunity(tenantId: string, id: string, userId?: string) {
    const lead = await this.findById(tenantId, id);

    // Guarda contra clique duplo (caso extremo 13)
    if (
      lead.status === LeadStatus.ENCERRADO &&
      lead.statusReason === LeadStatusReason.CONVERTIDO_EM_OPORTUNIDADE
    ) {
      const existingDeal = await prisma.deal.findFirst({
        where: { tenantId, leadId: id, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true },
      });
      if (existingDeal) {
        return { deal: existingDeal, alreadyConverted: true };
      }
    }

    // Notas do deal levam o prazo estimado (texto livre) do lead (req. 17a)
    const noteParts: string[] = [];
    if (lead.estimatedTimeline) noteParts.push(`Prazo estimado (lead): ${lead.estimatedTimeline}`);
    if (lead.notes) noteParts.push(lead.notes);

    // Import dinâmico para evitar ciclo leadService ↔ dealService
    const { dealService } = await import('./dealService.js');
    const deal = await dealService.create(tenantId, {
      name: lead.name,
      value: lead.estimatedValue ? Number(lead.estimatedValue) : 0,
      probability: lead.probabilityGoGet ?? undefined,
      leadId: id,
      companyId: lead.companyId ?? undefined,
      assignedTo: lead.assignedTo ?? undefined,
      notes: noteParts.length ? noteParts.join('\n\n') : undefined,
    });

    // Contato principal do lead entra como contato do deal (req. 17a)
    if (lead.contactId) {
      await prisma.dealContact
        .create({
          data: { dealId: deal.id, leadId: lead.contactId, roleInDeal: 'Contato principal' },
        })
        .catch(() => {}); // unique (dealId, leadId) — ignora duplicata
    }

    // Encerra o lead como convertido — sem diálogo de motivo (req. 17b)
    const updated = await prisma.lead.update({
      where: { id },
      data: {
        status: LeadStatus.ENCERRADO,
        statusReason: LeadStatusReason.CONVERTIDO_EM_OPORTUNIDADE,
        statusReasonNote: null,
      },
      include: leadInclude,
    });

    // Timeline da conversão (req. 17c)
    await prisma.interaction
      .create({
        data: {
          tenantId,
          leadId: id,
          type: 'STATUS_CHANGE',
          direction: 'OUTBOUND',
          subject: 'Convertido em oportunidade',
          content: `Lead convertido em oportunidade "${deal.name}". Status: Encerrado (Convertido em oportunidade).`,
          userId,
          metadata: {
            action: 'convert_to_opportunity',
            dealId: deal.id,
            previousStatus: lead.status,
            newStatus: LeadStatus.ENCERRADO,
            statusReason: LeadStatusReason.CONVERTIDO_EM_OPORTUNIDADE,
          },
        },
      })
      .catch(() => {});

    dispatchTrigger(tenantId, 'status_changed', id, {
      oldStatus: lead.status,
      newStatus: LeadStatus.ENCERRADO,
    }).catch(() => {});
    webhookDispatcher.emitLeadEvent(tenantId, 'lead.status_changed', {
      ...updated,
      _extra: { previous_status: lead.status, new_status: LeadStatus.ENCERRADO },
    });
    emitToTenant(tenantId, 'lead:updated', { lead: updated });

    return { deal, lead: updated, alreadyConverted: false };
  },

  async delete(tenantId: string, id: string) {
    const lead = await this.findById(tenantId, id);
    await prisma.lead.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    planLimitsService.invalidateUsage(tenantId).catch(() => {});

    // Dispatch outgoing webhook for deletion
    webhookDispatcher.emitLeadEvent(tenantId, 'lead.deleted', lead);

    // Emit Socket.IO event for real-time cache updates
    emitToTenant(tenantId, 'lead:deleted', { leadId: id });
  },

  async count(tenantId: string) {
    return prisma.lead.count({
      where: { tenantId, deletedAt: null },
    });
  },
};
