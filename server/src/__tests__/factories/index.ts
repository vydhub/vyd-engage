import { Factory } from 'fishery';
import { fakerPT_BR as faker } from '@faker-js/faker';
import {
  UserRole,
  UserStatus,
  LeadStatus,
  LeadSource,
  type Tag,
  type Tenant,
  type User,
  type Lead,
} from '@prisma/client';

/**
 * Typed test factories (fishery + faker pt_BR). They return full scalar shapes
 * of the Prisma models so they can be used as `prismaMock.<model>.<op>` return
 * values. Relations are omitted (Prisma base types are scalar-only).
 */

export const tenantFactory = Factory.define<Tenant>(({ sequence }) => ({
  id: faker.string.uuid(),
  name: faker.company.name(),
  slug: `${faker.helpers.slugify(faker.company.name()).toLowerCase()}-${sequence}`,
  logo: null,
  settings: {},
  staleDays: 5,
  clientFollowUpDays: 30,
  contractAlertDays: [90, 60, 30],
  atestadoAlertDays: 7,
  createdAt: new Date(),
  updatedAt: new Date(),
}));

export const userFactory = Factory.define<User>(() => ({
  id: faker.string.uuid(),
  email: faker.internet.email().toLowerCase(),
  passwordHash: faker.string.alphanumeric(60),
  name: faker.person.fullName(),
  phone: faker.phone.number(),
  avatar: null,
  role: UserRole.USER,
  status: UserStatus.ACTIVE,
  // Onda 4: sem marca d'agua o usuario de teste nasce com todos os tokens
  // validos, que e o estado normal de 99,9% das contas.
  tokensValidAfter: null,
  isPlatformAdmin: false,
  commercialFunction: null,
  teamId: null,
  permissionProfileId: null,
  whatsappNumber: null,
  tenantId: faker.string.uuid(),
  emailVerified: true,
  emailVerifiedAt: new Date(),
  passwordResetToken: null,
  passwordResetExpires: null,
  twoFactorEnabled: false,
  twoFactorSecret: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastLoginAt: null,
}));

export const tagFactory = Factory.define<Tag>(() => ({
  id: faker.string.uuid(),
  tenantId: faker.string.uuid(),
  name: faker.commerce.department(),
  color: faker.color.rgb(),
  createdAt: new Date(),
  updatedAt: new Date(),
}));

export const leadFactory = Factory.define<Lead>(() => ({
  id: faker.string.uuid(),
  tenantId: faker.string.uuid(),
  name: faker.person.fullName(),
  email: faker.internet.email().toLowerCase(),
  phone: faker.phone.number(),
  company: faker.company.name(),
  position: faker.person.jobTitle(),
  companyId: null,
  reportsToId: null,
  empreendimentoId: null,
  isContact: false,
  convertedAt: null,
  contactId: null,
  status: LeadStatus.NOVO,
  source: LeadSource.OUTROS,
  score: 0,
  statusReason: null,
  statusReasonNote: null,
  estimatedValue: null,
  estimatedTimeline: null,
  probabilityGoGet: null,
  unsubscribed: false,
  unsubscribedAt: null,
  customFields: {},
  notes: null,
  assignedTo: null,
  funnelColumnId: null,
  positionInColumn: 0,
  importBatchId: null,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}));
