import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { prismaMock } from '../helpers/prismaMock.js';

/**
 * Upgrade RD parity — P1 (permissionService): NÚCLEO fail-closed.
 * Foco: NÃO-REGRESSÃO. Sem PermissionProfile custom, TODA resposta == HOJE:
 *  - USER (analista): deals PROPRIA (== ownerScope), companies/contacts GERAL;
 *    exporta, faz bulk, deleta próprios; NÃO configura/automações/transfere.
 *  - ADMIN/GESTOR: tudo true, visibilidade GERAL.
 *  - VIEWER: só viewReports, visibilidade PROPRIA.
 * E: perfil custom que EXPANDE (USER→deals GERAL) devolve undefined (sem filtro).
 */
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import {
  defaultsForRole,
  getEffective,
  can,
  canEntity,
  visibilityScope,
  teamMemberIds,
} from '../../services/permissionService.js';

const tenantId = 't1';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('defaultsForRole — mapeamento role → defaults (== HOJE)', () => {
  it('ADMIN e GESTOR: todas as capabilities true e visibilidade GERAL', () => {
    for (const role of [UserRole.ADMIN, UserRole.GESTOR]) {
      const d = defaultsForRole(role);
      expect(Object.values(d.capabilities).every((v) => v === true)).toBe(true);
      expect(d.visibility).toEqual({ deals: 'GERAL', companies: 'GERAL', contacts: 'GERAL' });
      expect(d.requireApprovalFor).toEqual({ export: false, bulk: false, delete: false });
    }
  });

  it('USER: exporta/importa/bulk/deleta e vê relatórios; NÃO configura/automações/transfere; deals PROPRIA', () => {
    const d = defaultsForRole(UserRole.USER);
    expect(d.capabilities).toEqual({
      exportData: true,
      // == HOJE: import de leads não tem guarda de papel; USER importa.
      importData: true,
      bulkActions: true,
      deleteRecords: true,
      configure: false,
      manageAutomations: false,
      transferOwner: false,
      viewReports: true,
      accessAtestados: false,
      manageAtestados: false,
      accessParceiros: false,
      manageParceiros: false,
    });
    expect(d.visibility).toEqual({ deals: 'PROPRIA', companies: 'GERAL', contacts: 'GERAL' });
    // Eixo por-entidade (req 13): USER cria/edita/exclui as 4 entidades (== hoje).
    expect(d.entities).toEqual({
      leads: { create: true, edit: true, delete: true },
      companies: { create: true, edit: true, delete: true },
      deals: { create: true, edit: true, delete: true },
      tasks: { create: true, edit: true, delete: true },
    });
  });

  it('VIEWER: só viewReports; visibilidade GERAL (tenant-wide só-leitura == HOJE)', () => {
    const d = defaultsForRole(UserRole.VIEWER);
    expect(d.capabilities).toEqual({
      exportData: false,
      importData: false,
      bulkActions: false,
      deleteRecords: false,
      configure: false,
      manageAutomations: false,
      transferOwner: false,
      viewReports: true,
      accessAtestados: false,
      manageAtestados: false,
      accessParceiros: false,
      manageParceiros: false,
    });
    // BYTE-A-BYTE == HOJE: ownerScope nunca restringia o VIEWER (só o USER analista);
    // VIEWER permanece tenant-wide (GERAL). Entidades todas false (só-leitura).
    expect(d.visibility).toEqual({ deals: 'GERAL', companies: 'GERAL', contacts: 'GERAL' });
    expect(d.entities.deals).toEqual({ create: false, edit: false, delete: false });
  });
});

describe('getEffective — fail-closed sem perfil custom', () => {
  it('USER sem profileId devolve exatamente os defaults de USER', async () => {
    const eff = await getEffective({
      userId: 'u1',
      tenantId,
      role: 'USER',
      permissionProfileId: null,
    });
    expect(eff).toEqual(defaultsForRole(UserRole.USER));
    // Nenhuma query de perfil quando profileId já é null.
    expect(prismaMock.permissionProfile.findFirst).not.toHaveBeenCalled();
  });

  it('platform-admin é tratado como ADMIN (defaults GERAL/tudo-true)', async () => {
    const eff = await getEffective({
      userId: 'u1',
      tenantId,
      role: 'USER',
      isPlatformAdmin: true,
      permissionProfileId: null,
    });
    expect(eff.baseRole).toBe(UserRole.ADMIN);
    expect(eff.capabilities.configure).toBe(true);
  });

  it('erro ao carregar perfil → fail-closed nos defaults do role (nunca lança)', async () => {
    prismaMock.permissionProfile.findFirst.mockRejectedValue(new Error('db down') as never);
    const eff = await getEffective({
      userId: 'u1',
      tenantId,
      role: 'USER',
      permissionProfileId: 'p1',
    });
    expect(eff).toEqual(defaultsForRole(UserRole.USER));
  });

  it('perfil ausente (id não encontrado) → fail-closed nos defaults do role', async () => {
    prismaMock.permissionProfile.findFirst.mockResolvedValue(null as never);
    const eff = await getEffective({
      userId: 'u1',
      tenantId,
      role: 'USER',
      permissionProfileId: 'ghost',
    });
    expect(eff).toEqual(defaultsForRole(UserRole.USER));
  });
});

describe('getEffective — perfil custom expande explicitamente', () => {
  it('USER com perfil que liga configure e deals=GERAL sobrescreve só o configurado', async () => {
    prismaMock.permissionProfile.findFirst.mockResolvedValue({
      baseRole: UserRole.USER,
      capabilities: { configure: true },
      visibility: { deals: 'GERAL' },
      requireApprovalFor: { export: true },
    } as never);

    const eff = await getEffective({
      userId: 'u1',
      tenantId,
      role: 'USER',
      permissionProfileId: 'p-custom',
    });

    expect(eff.capabilities.configure).toBe(true); // expandido
    expect(eff.capabilities.manageAutomations).toBe(false); // default de USER mantido
    expect(eff.visibility.deals).toBe('GERAL'); // expandido
    expect(eff.visibility.companies).toBe('GERAL'); // default mantido
    expect(eff.requireApprovalFor.export).toBe(true);
    expect(eff.requireApprovalFor.bulk).toBe(false);
  });
});

describe('can — capability', () => {
  it('USER default: bulkActions=true, configure=false', async () => {
    const user = { userId: 'u1', tenantId, role: 'USER', permissionProfileId: null };
    expect(await can(user, 'bulkActions')).toBe(true);
    expect(await can(user, 'configure')).toBe(false);
    expect(await can(user, 'transferOwner')).toBe(false);
    // == HOJE: import de leads não tinha guarda → USER importa (importData=true).
    expect(await can(user, 'importData')).toBe(true);
  });
});

describe('entities — eixo por-entidade (req 13, == HOJE)', () => {
  it('defaults: ADMIN/GESTOR/USER todas true; VIEWER todas false', () => {
    for (const role of [UserRole.ADMIN, UserRole.GESTOR, UserRole.USER]) {
      const d = defaultsForRole(role);
      for (const kind of ['leads', 'companies', 'deals', 'tasks'] as const) {
        expect(d.entities[kind]).toEqual({ create: true, edit: true, delete: true });
      }
    }
    const v = defaultsForRole(UserRole.VIEWER);
    for (const kind of ['leads', 'companies', 'deals', 'tasks'] as const) {
      expect(v.entities[kind]).toEqual({ create: false, edit: false, delete: false });
    }
  });

  it('canEntity — USER default cria/edita/exclui todas as entidades (== hoje)', async () => {
    const user = { userId: 'u1', tenantId, role: 'USER', permissionProfileId: null };
    expect(await canEntity(user, 'deals', 'create')).toBe(true);
    expect(await canEntity(user, 'leads', 'edit')).toBe(true);
    expect(await canEntity(user, 'companies', 'delete')).toBe(true);
    expect(await canEntity(user, 'tasks', 'create')).toBe(true);
  });

  it('canEntity — perfil custom que desliga deals.create nega só isso', async () => {
    prismaMock.permissionProfile.findFirst.mockResolvedValue({
      baseRole: UserRole.USER,
      isBuiltin: false,
      capabilities: { entities: { deals: { create: false } } },
      visibility: {},
      requireApprovalFor: {},
    } as never);
    const user = { userId: 'u1', tenantId, role: 'USER', permissionProfileId: 'p-restr' };
    expect(await canEntity(user, 'deals', 'create')).toBe(false); // restrito
    expect(await canEntity(user, 'deals', 'edit')).toBe(true); // default mantido
    expect(await canEntity(user, 'leads', 'create')).toBe(true); // outra entidade intacta
  });
});

describe('hasCustomProfile — distingue restrição explícita de default do builtin', () => {
  it('sem profileId → hasCustomProfile=false (builtin)', async () => {
    const eff = await getEffective({
      userId: 'u1',
      tenantId,
      role: 'USER',
      permissionProfileId: null,
    });
    expect(eff.hasCustomProfile).toBe(false);
  });

  it('perfil builtin (isBuiltin=true) → hasCustomProfile=false', async () => {
    prismaMock.permissionProfile.findFirst.mockResolvedValue({
      baseRole: UserRole.USER,
      isBuiltin: true,
      capabilities: {},
      visibility: {},
      requireApprovalFor: {},
    } as never);
    const eff = await getEffective({
      userId: 'u1',
      tenantId,
      role: 'USER',
      permissionProfileId: 'builtin-user',
    });
    expect(eff.hasCustomProfile).toBe(false);
  });

  it('perfil custom (isBuiltin=false) → hasCustomProfile=true', async () => {
    prismaMock.permissionProfile.findFirst.mockResolvedValue({
      baseRole: UserRole.USER,
      isBuiltin: false,
      capabilities: {},
      visibility: {},
      requireApprovalFor: {},
    } as never);
    const eff = await getEffective({
      userId: 'u1',
      tenantId,
      role: 'USER',
      permissionProfileId: 'custom-1',
    });
    expect(eff.hasCustomProfile).toBe(true);
  });
});

describe('visibilityScope — deals/tasks/companies/contacts', () => {
  it('USER→deals PROPRIA devolve o próprio userId (== ownerScope de analista)', async () => {
    const scope = await visibilityScope(
      { userId: 'u1', tenantId, role: 'USER', permissionProfileId: null },
      'deals'
    );
    expect(scope).toBe('u1');
  });

  it('USER→tasks acompanha deals (PROPRIA → userId)', async () => {
    const scope = await visibilityScope(
      { userId: 'u1', tenantId, role: 'USER', permissionProfileId: null },
      'tasks'
    );
    expect(scope).toBe('u1');
  });

  it('USER→companies GERAL devolve requested (undefined quando não pedido)', async () => {
    const scope = await visibilityScope(
      { userId: 'u1', tenantId, role: 'USER', permissionProfileId: null },
      'companies'
    );
    expect(scope).toBeUndefined();
  });

  it('GESTOR→deals GERAL devolve requested (undefined) — sem filtro, == hoje', async () => {
    const scope = await visibilityScope(
      { userId: 'g1', tenantId, role: 'GESTOR', permissionProfileId: null },
      'deals'
    );
    expect(scope).toBeUndefined();
  });

  it('GESTOR→deals GERAL preserva o assignedTo pedido pelo cliente', async () => {
    const scope = await visibilityScope(
      { userId: 'g1', tenantId, role: 'GESTOR', permissionProfileId: null },
      'deals',
      'someone'
    );
    expect(scope).toBe('someone');
  });

  it('EQUIPE → { in: teamMemberIds } (membros da equipe do user)', async () => {
    prismaMock.permissionProfile.findFirst.mockResolvedValue({
      baseRole: UserRole.USER,
      capabilities: {},
      visibility: { deals: 'EQUIPE' },
      requireApprovalFor: {},
    } as never);
    prismaMock.user.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }] as never);

    const scope = await visibilityScope(
      { userId: 'u1', tenantId, role: 'USER', permissionProfileId: 'p-team', teamId: 'team-1' },
      'deals'
    );
    expect(scope).toEqual({ in: ['u1', 'u2'] });
  });

  it('perfil custom expandindo USER→deals GERAL devolve undefined (expansão explícita, sem filtro)', async () => {
    prismaMock.permissionProfile.findFirst.mockResolvedValue({
      baseRole: UserRole.USER,
      capabilities: {},
      visibility: { deals: 'GERAL' },
      requireApprovalFor: {},
    } as never);

    const scope = await visibilityScope(
      { userId: 'u1', tenantId, role: 'USER', permissionProfileId: 'p-open' },
      'deals'
    );
    expect(scope).toBeUndefined();
  });
});

describe('teamMemberIds', () => {
  it('sem equipe → [userId]', async () => {
    const ids = await teamMemberIds(tenantId, {
      userId: 'u1',
      tenantId,
      role: 'USER',
      teamId: null,
    });
    expect(ids).toEqual(['u1']);
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });

  it('com equipe → ids dos membros, incluindo o próprio', async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }] as never);
    const ids = await teamMemberIds(tenantId, {
      userId: 'u1',
      tenantId,
      role: 'USER',
      teamId: 'team-1',
    });
    expect(ids).toEqual(['u1', 'u2', 'u3']);
  });

  it('fail-closed: erro na query → [userId]', async () => {
    prismaMock.user.findMany.mockRejectedValue(new Error('db') as never);
    const ids = await teamMemberIds(tenantId, {
      userId: 'u1',
      tenantId,
      role: 'USER',
      teamId: 'team-1',
    });
    expect(ids).toEqual(['u1']);
  });
});
