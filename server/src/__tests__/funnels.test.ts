import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { funnelService } from '../services/funnelService.js';
import prisma from '../config/database.js';

describe('Funnel Service', () => {
  let testTenantId: string;

  beforeEach(async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: 'Funnel Test Company',
        slug: `funnel-test-${Date.now()}`,
      },
    });
    testTenantId = tenant.id;
  });

  afterEach(async () => {
    // GUARDA CRÍTICA: se o beforeEach falhou, testTenantId fica undefined e o
    // Prisma REMOVE filtros undefined — os deleteMany abaixo apagariam as tabelas
    // INTEIRAS (funis/usuários — incidente de 03/07/2026).
    if (!testTenantId) return;
    // Clean up in correct order: leads → columns → funnels → users → tenant
    const funnels = await prisma.funnel.findMany({
      where: { tenantId: testTenantId },
      include: { columns: true },
    });
    const columnIds = funnels.flatMap((f) => f.columns.map((c) => c.id));

    if (columnIds.length > 0) {
      await prisma.lead.deleteMany({ where: { funnelColumnId: { in: columnIds } } });
      await prisma.funnelColumn.deleteMany({ where: { id: { in: columnIds } } });
    }
    await prisma.funnel.deleteMany({ where: { tenantId: testTenantId } });
    await prisma.user.deleteMany({ where: { tenantId: testTenantId } });
    await prisma.tenant.delete({ where: { id: testTenantId } }).catch(() => {});
    testTenantId = '';
  });

  describe('ensureDefaultFunnel', () => {
    it('should create default funnel with 7 columns when none exists', async () => {
      const funnel = await funnelService.ensureDefaultFunnel(testTenantId);

      expect(funnel).toHaveProperty('id');
      expect(funnel.name).toBe('Funil de Venda');
      expect(funnel.isDefault).toBe(true);
      expect(funnel.columns.length).toBe(7);
    });

    it('should return existing default funnel', async () => {
      const first = await funnelService.ensureDefaultFunnel(testTenantId);
      const second = await funnelService.ensureDefaultFunnel(testTenantId);

      expect(first.id).toBe(second.id);
    });
  });

  describe('create', () => {
    it('should create first funnel as default', async () => {
      const funnel = await funnelService.create(testTenantId, { name: 'My Funnel' });

      expect(funnel.name).toBe('My Funnel');
      expect(funnel.isDefault).toBe(true);
      expect(funnel.columns.length).toBe(7); // DEFAULT_COLUMNS
    });

    it('should create second funnel as non-default', async () => {
      await funnelService.create(testTenantId, { name: 'First' });
      const second = await funnelService.create(testTenantId, { name: 'Second' });

      expect(second.isDefault).toBe(false);
      expect(second.order).toBe(1);
    });

    it('should create funnel with custom columns', async () => {
      const funnel = await funnelService.create(testTenantId, {
        name: 'Custom',
        columns: [
          { title: 'Stage A', color: '#FF0000' },
          { title: 'Stage B', color: '#00FF00' },
        ],
      });

      expect(funnel.columns.length).toBe(2);
      expect(funnel.columns[0].title).toBe('Stage A');
      expect(funnel.columns[1].title).toBe('Stage B');
    });
  });

  describe('findAll', () => {
    it('should list all funnels for tenant', async () => {
      await funnelService.create(testTenantId, { name: 'Funnel A' });
      await funnelService.create(testTenantId, { name: 'Funnel B' });

      const funnels = await funnelService.findAll(testTenantId);
      expect(funnels.length).toBe(2);
    });

    it('should return empty array for new tenant', async () => {
      const funnels = await funnelService.findAll(testTenantId);
      expect(funnels).toEqual([]);
    });
  });

  describe('findById', () => {
    it('should find funnel with columns and leads', async () => {
      const created = await funnelService.create(testTenantId, { name: 'Find Me' });
      const found = await funnelService.findById(testTenantId, created.id);

      expect(found.id).toBe(created.id);
      expect(found.columns).toBeDefined();
      expect(found.columns.length).toBeGreaterThan(0);
    });

    it('should throw 404 for non-existent funnel', async () => {
      await expect(funnelService.findById(testTenantId, 'non-existent-id')).rejects.toThrow(
        'Funnel not found'
      );
    });
  });

  describe('update', () => {
    it('should update funnel name', async () => {
      const funnel = await funnelService.create(testTenantId, { name: 'Original' });
      const updated = await funnelService.update(testTenantId, funnel.id, { name: 'Renamed' });

      expect(updated.name).toBe('Renamed');
    });

    it('should throw 404 for non-existent funnel', async () => {
      await expect(
        funnelService.update(testTenantId, 'non-existent', { name: 'X' })
      ).rejects.toThrow('Funnel not found');
    });
  });

  describe('delete', () => {
    it('should delete a non-default funnel', async () => {
      await funnelService.create(testTenantId, { name: 'Default' });
      const second = await funnelService.create(testTenantId, { name: 'Deletable' });

      const result = await funnelService.delete(testTenantId, second.id);
      expect(result.success).toBe(true);

      const remaining = await funnelService.findAll(testTenantId);
      expect(remaining.length).toBe(1);
    });

    it('should not delete default funnel', async () => {
      const funnel = await funnelService.create(testTenantId, { name: 'Default' });

      await expect(funnelService.delete(testTenantId, funnel.id)).rejects.toThrow(
        'Cannot delete the default funnel'
      );
    });

    it('should throw 404 for non-existent funnel', async () => {
      await expect(funnelService.delete(testTenantId, 'non-existent')).rejects.toThrow(
        'Funnel not found'
      );
    });
  });

  describe('addColumn', () => {
    it('should add a column to funnel', async () => {
      const funnel = await funnelService.create(testTenantId, { name: 'Test' });
      const column = await funnelService.addColumn(testTenantId, funnel.id, {
        title: 'New Stage',
        color: '#ABCDEF',
      });

      expect(column.title).toBe('New Stage');
      expect(column.color).toBe('#ABCDEF');
      expect(column.order).toBe(7); // After 7 default columns (0-6)
    });

    it('should throw 404 for non-existent funnel', async () => {
      await expect(
        funnelService.addColumn(testTenantId, 'non-existent', { title: 'X' })
      ).rejects.toThrow('Funnel not found');
    });
  });

  describe('updateColumn', () => {
    it('should update column title and color', async () => {
      const funnel = await funnelService.create(testTenantId, { name: 'Test' });
      const columnId = funnel.columns[0].id;

      const updated = await funnelService.updateColumn(testTenantId, columnId, {
        title: 'Renamed Stage',
        color: '#FF0000',
      });

      expect(updated.title).toBe('Renamed Stage');
      expect(updated.color).toBe('#FF0000');
    });

    it('should throw 404 for non-existent column', async () => {
      await expect(
        funnelService.updateColumn(testTenantId, 'non-existent', { title: 'X' })
      ).rejects.toThrow('Column not found');
    });
  });

  describe('deleteColumn', () => {
    it('should delete a non-default column without leads', async () => {
      const funnel = await funnelService.create(testTenantId, { name: 'Test' });
      // columns[1] is not default (only columns[0] is default)
      const columnId = funnel.columns[1].id;

      const result = await funnelService.deleteColumn(testTenantId, columnId);
      expect(result.success).toBe(true);
    });

    it('should not delete the default column', async () => {
      const funnel = await funnelService.create(testTenantId, { name: 'Test' });
      const defaultColumn = funnel.columns.find((c) => c.isDefault);

      await expect(funnelService.deleteColumn(testTenantId, defaultColumn!.id)).rejects.toThrow(
        'Cannot delete the default column'
      );
    });
  });

  describe('moveLead', () => {
    it('should move a lead to another column and update status', async () => {
      const funnel = await funnelService.create(testTenantId, { name: 'Test' });
      const sourceCol = funnel.columns[0]; // Novo (NOVO)
      const targetCol = funnel.columns[2]; // Pausado (PAUSADO)

      // Create a lead in the first column
      const lead = await prisma.lead.create({
        data: {
          tenantId: testTenantId,
          name: 'Move Lead',
          email: 'move@test.com',
          status: 'NOVO',
          source: 'OUTROS',
          funnelColumnId: sourceCol.id,
          positionInColumn: 0,
        },
      });

      const moved = await funnelService.moveLead(testTenantId, lead.id, targetCol.id, 0);

      expect(moved.funnelColumnId).toBe(targetCol.id);
      expect(moved.positionInColumn).toBe(0);
      // If target column has mappedStatus, lead status should update
      if (targetCol.mappedStatus) {
        expect(moved.status).toBe(targetCol.mappedStatus);
      }
    });

    it('should throw 404 for non-existent lead', async () => {
      const funnel = await funnelService.create(testTenantId, { name: 'Test' });

      await expect(
        funnelService.moveLead(testTenantId, 'non-existent', funnel.columns[0].id, 0)
      ).rejects.toThrow('Lead not found');
    });
  });
});
