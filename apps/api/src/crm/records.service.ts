import { HttpStatus, Injectable } from '@nestjs/common';
import type { Paginated } from '@zatma/types';
import {
  normalizeCompanyName,
  type CompanyDto,
  type ContactDto,
  type CreateCompanyInput,
  type CreateContactInput,
  type ListCompaniesInput,
  type ListContactsInput,
  type TimelineDto,
  type UpdateCompanyInput,
  type UpdateContactInput,
} from '@zatma/validation';
import { UsageService } from '../billing/usage.service.js';
import { AppException, notFound } from '../common/errors.js';
import { paginate } from '../common/pagination.js';
import { TenantContext } from '../common/tenant-context.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AutomationEventsService } from '../automation/automation-events.service.js';
import {
  activityInclude,
  companyInclude,
  contactInclude,
  CrmContext,
  currentUserId,
  dealInclude,
  ownerScope,
  searchOr,
  seesAllRecords,
  toActivityDto,
  toCompanyDto,
  toContactDto,
  toDealDto,
} from './crm-common.js';

const SORT: Record<string, string> = { name: 'firstName', createdAt: 'createdAt', updatedAt: 'updatedAt', lastContactedAt: 'lastContactedAt', nextFollowUpAt: 'nextFollowUpAt' };

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crm: CrmContext,
    private readonly usage: UsageService,
    private readonly events: AutomationEventsService,
  ) {}

  private get db() {
    return this.prisma.tenant;
  }

  async getEntity(id: string) {
    const c = await this.db.contact.findFirst({ where: { id, deletedAt: null, ...ownerScope() }, include: contactInclude });
    if (!c) throw notFound('Contact');
    return c;
  }

  /** Sum of won deal values per contact (for the customers view). */
  private async wonValues(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db.deal.groupBy({ by: ['contactId'], where: { contactId: { in: ids }, status: 'WON', deletedAt: null }, _sum: { value: true } });
    return new Map(rows.map((r) => [r.contactId!, Number(r._sum.value ?? 0)]));
  }

  async list(q: ListContactsInput): Promise<Paginated<ContactDto>> {
    const where: Prisma.ContactWhereInput = {
      deletedAt: null,
      ...ownerScope(),
      ...(q.lifecycle ? { lifecycle: q.lifecycle } : {}),
      ...(q.companyId ? { companyId: q.companyId } : {}),
      ...(q.ownerId && seesAllRecords() ? { ownerId: q.ownerId } : {}),
      ...(q.tag ? { tags: { has: q.tag } } : {}),
      ...searchOr(q.q, ['firstName', 'lastName', 'email', 'phone']),
    };
    const [rows, total] = await Promise.all([
      this.db.contact.findMany({ where, include: contactInclude, orderBy: { [SORT[q.sort] ?? 'createdAt']: q.order }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.db.contact.count({ where }),
    ]);
    const won = await this.wonValues(rows.map((r) => r.id));
    return paginate(
      rows.map((r) => toContactDto(r, won.get(r.id) ?? 0)),
      total,
      q,
    );
  }

  async get(id: string): Promise<ContactDto> {
    const c = await this.getEntity(id);
    return toContactDto(c, (await this.wonValues([id])).get(id) ?? 0);
  }

  private async assertCompany(companyId: string | null | undefined) {
    if (companyId && !(await this.db.company.findFirst({ where: { id: companyId, deletedAt: null } }))) throw notFound('Company');
  }

  async create(input: CreateContactInput, opts: { skipLimit?: boolean } = {}): Promise<ContactDto> {
    const organizationId = TenantContext.requireOrganizationId();
    if (!opts.skipLimit) await this.usage.assertWithinLimit(organizationId, 'crmRecords', 1);
    if (!input.allowDuplicate) await this.crm.assertNoDuplicates(input.email, input.phone);
    await this.assertCompany(input.companyId);
    const { allowDuplicate: _ignored, ownerId, ...data } = input;
    const c = await this.db.contact.create({
      data: { ...data, organizationId, ownerId: await this.crm.resolveOwner(ownerId), ...(await this.crm.keys(data.email, data.phone)) },
      include: contactInclude,
    });
    return toContactDto(c);
  }

  async update(id: string, input: UpdateContactInput): Promise<ContactDto> {
    const current = await this.getEntity(id);
    await this.assertCompany(input.companyId);
    const { ownerId, ...data } = input;
    const email = data.email !== undefined ? data.email : current.email;
    const phone = data.phone !== undefined ? data.phone : current.phone;
    await this.db.contact.update({
      where: { id },
      data: {
        ...data,
        ...(ownerId !== undefined ? { ownerId: await this.crm.resolveOwner(ownerId, current.ownerId) } : {}),
        ...(data.email !== undefined || data.phone !== undefined ? await this.crm.keys(email, phone) : {}),
      },
    });
    if (data.lifecycle === 'CUSTOMER' && current.lifecycle !== 'CUSTOMER') void this.events.emit({ kind: 'contact.became_customer', entityType: 'contact', entityId: id });
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    await this.getEntity(id);
    await this.db.contact.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async timeline(id: string): Promise<TimelineDto> {
    await this.getEntity(id);
    const [activities, deals] = await Promise.all([
      this.db.activity.findMany({ where: { contactId: id, deletedAt: null }, include: activityInclude, orderBy: { createdAt: 'desc' }, take: 200 }),
      this.db.deal.findMany({ where: { contactId: id, deletedAt: null, ...ownerScope() }, include: dealInclude, orderBy: { createdAt: 'desc' } }),
    ]);
    return { activities: activities.map(toActivityDto), deals: deals.map(toDealDto) };
  }
}

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crm: CrmContext,
  ) {}

  private get db() {
    return this.prisma.tenant;
  }

  // Companies are shared reference data: everyone with CRM access sees all of them; ownership is informational.
  async getEntity(id: string) {
    const c = await this.db.company.findFirst({ where: { id, deletedAt: null }, include: companyInclude });
    if (!c) throw notFound('Company');
    return c;
  }

  async list(q: ListCompaniesInput): Promise<Paginated<CompanyDto>> {
    const where: Prisma.CompanyWhereInput = {
      deletedAt: null,
      ...(q.industry ? { industry: { equals: q.industry, mode: 'insensitive' } } : {}),
      ...(q.ownerId ? { ownerId: q.ownerId } : {}),
      ...(q.tag ? { tags: { has: q.tag } } : {}),
      ...searchOr(q.q, ['name', 'website', 'email', 'city']),
    };
    const sort = q.sort === 'name' || q.sort === 'updatedAt' ? q.sort : 'createdAt';
    const [rows, total] = await Promise.all([
      this.db.company.findMany({ where, include: companyInclude, orderBy: { [sort]: q.order }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.db.company.count({ where }),
    ]);
    return paginate(rows.map(toCompanyDto), total, q);
  }

  async get(id: string): Promise<CompanyDto> {
    return toCompanyDto(await this.getEntity(id));
  }

  async create(input: CreateCompanyInput): Promise<CompanyDto> {
    const organizationId = TenantContext.requireOrganizationId();
    const { ownerId, ...data } = input;
    const c = await this.db.company.create({
      data: { ...data, organizationId, nameNormalized: normalizeCompanyName(data.name), ownerId: await this.crm.resolveOwner(ownerId) },
      include: companyInclude,
    });
    return toCompanyDto(c);
  }

  async update(id: string, input: UpdateCompanyInput): Promise<CompanyDto> {
    const current = await this.getEntity(id);
    // Visible to everyone, but Sales Agents may only edit companies they own.
    if (!seesAllRecords() && current.ownerId !== currentUserId()) throw new AppException(HttpStatus.FORBIDDEN, 'NOT_OWNER', 'Only the owner or a manager can edit this company');
    const { ownerId, ...data } = input;
    const c = await this.db.company.update({
      where: { id },
      data: {
        ...data,
        ...(data.name ? { nameNormalized: normalizeCompanyName(data.name) } : {}),
        ...(ownerId !== undefined ? { ownerId: await this.crm.resolveOwner(ownerId, current.ownerId) } : {}),
      },
      include: companyInclude,
    });
    return toCompanyDto(c);
  }

  async remove(id: string): Promise<void> {
    await this.getEntity(id);
    await this.db.company.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async timeline(id: string): Promise<TimelineDto & { contacts: ContactDto[] }> {
    await this.getEntity(id);
    const [activities, deals, contacts] = await Promise.all([
      this.db.activity.findMany({ where: { companyId: id, deletedAt: null }, include: activityInclude, orderBy: { createdAt: 'desc' }, take: 200 }),
      this.db.deal.findMany({ where: { companyId: id, deletedAt: null, ...ownerScope() }, include: dealInclude, orderBy: { createdAt: 'desc' } }),
      this.db.contact.findMany({ where: { companyId: id, deletedAt: null, ...ownerScope() }, include: contactInclude, orderBy: { firstName: 'asc' }, take: 200 }),
    ]);
    return { activities: activities.map(toActivityDto), deals: deals.map(toDealDto), contacts: contacts.map((c) => toContactDto(c)) };
  }
}
