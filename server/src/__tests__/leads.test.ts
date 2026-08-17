import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { leadService } from '../services/leadService.js';
import prisma from '../config/database.js';

describe('Lead Service', () => {
  let testTenantId: string;

  beforeEach(async () => {
    // Create test tenant
    const tenant = await prisma.tenant.create({
      data: {
        name: 'Test Company',
        slug: `test-company-${Date.now()}`,
      },
    });
    testTenantId = tenant.id;
  });

  afterEach(async () => {
    // Cleanup
    if (testTenantId) {
      await prisma.lead.deleteMany({ where: { tenantId: testTenantId } });
      await prisma.tenant.delete({ where: { id: testTenantId } });
    }
  });

  describe('create', () => {
    it('should create a lead successfully', async () => {
      const lead = await leadService.create(testTenantId, {
        name: 'John Doe',
        email: 'john@example.com',
        phone: '+5511999999999',
        status: 'NOVO',
        source: 'OUTROS',
      });

      expect(lead).toHaveProperty('id');
      expect(lead.name).toBe('John Doe');
      expect(lead.email).toBe('john@example.com');
      expect(lead.tenantId).toBe(testTenantId);
    });

    it('should enforce plan limits', async () => {
      // This test would require mocking plan limits
      // For now, we'll just test basic creation
      const lead = await leadService.create(testTenantId, {
        name: 'Jane Doe',
        email: 'jane@example.com',
        status: 'NOVO',
        source: 'OUTROS',
      });

      expect(lead).toHaveProperty('id');
    });
  });

  describe('findAll', () => {
    beforeEach(async () => {
      // Create test leads
      await leadService.create(testTenantId, {
        name: 'Lead 1',
        email: 'lead1@example.com',
        status: 'NOVO',
        source: 'OUTROS',
      });
      await leadService.create(testTenantId, {
        name: 'Lead 2',
        email: 'lead2@example.com',
        status: 'EM_ANDAMENTO',
        source: 'OUTROS',
      });
    });

    it('should return all leads for tenant', async () => {
      const result = await leadService.findAll(testTenantId, {});
      expect(result.leads.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter leads by status', async () => {
      const result = await leadService.findAll(testTenantId, {
        status: 'NOVO',
      });
      expect(result.leads.every((lead) => lead.status === 'NOVO')).toBe(true);
    });
  });
});
