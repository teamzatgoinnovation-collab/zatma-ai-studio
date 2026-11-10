import { HttpStatus, Injectable } from '@nestjs/common';
import type { Paginated } from '@zatma/types';
import {
  normalizeCompanyName,
  type BulkLeadsInput,
  type ContactDto,
  type ConvertLeadInput,
  type CreateLeadInput,
  type DealDto,
  type LeadDto,
  type ListLeadsInput,
  type UpdateLeadInput,
} from '@zatma/validation';
import { UsageService } from '../billing/usage.service.js';
import { AppException, notFound } from '../common/errors.js';
import { paginate } from '../common/pagination.js';
import { TenantContext } from '../common/tenant-context.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { contactInclude, CrmContext, dealInclude, leadInclude, ownerScope, searchOr, seesAllRecords, toContactDto, toDealDto, toLeadDto } from './crm-common.js';
import { PipelineService } from './pipeline.service.js';

const SORT: Record<string, string> = { name: 'firstName', createdAt: 'createdAt', updatedAt: 'updatedAt', lastContactedAt: 'lastContactedAt', nextFollowUpAt: 'nextFollowUpAt' };

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crm: CrmContext,
    private readonly usage: UsageService,
    private readonly pipelines: PipelineService,
  ) {}

  private get db() {
    return this.prisma.tenant;
  }

  async getEntity(id: string) {
    const lead = await this.db.lead.findFirst({ where: { id, deletedAt: null, ...ownerScope() }, include: leadInclude });
    if (!lead) throw notFound('Lead');
    return lead;
  }

  async list(q: ListLeadsInput): Promise<Paginated<LeadDto>> {
    const where: Prisma.LeadWhereInput = {
      deletedAt: null,
      ...ownerScope(),
      ...(q.status ? { status: q.status } : {}),
      ...(q.source ? { source: q.source } : {}),
      ...(q.ownerId && seesAllRecords() ? { ownerId: q.ownerId === 'none' ? null : q.ownerId } : {}),
      ...(q.tag ? { tags: { has: q.tag } } : {}),
      ...searchOr(q.q, ['firstName', 'lastName', 'email', 'phone', 'company']),
    };
    const [rows, total] = await Promise.all([
      this.db.lead.findMany({ where, include: leadInclude, orderBy: { [SORT[q.sort] ?? 'createdAt']: q.order }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.db.lead.count({ where }),
    ]);
    return paginate(rows.map(toLeadDto), total, q);
  }

  /** Every matching lead (for export), capped. */
  async listAll(q: ListLeadsInput, cap = 10_000) {
    return (await this.list({ ...q, page: 1, pageSize: cap } as ListLeadsInput)).data;
  }

  async get(id: string): Promise<LeadDto> {
    return toLeadDto(await this.getEntity(id));
  }

  async create(input: CreateLeadInput, opts: { skipLimit?: boolean } = {}): Promise<LeadDto> {
    const organizationId = TenantContext.requireOrganizationId();
    if (!opts.skipLimit) await this.usage.assertWithinLimit(organizationId, 'crmRecords', 1);
    if (!input.allowDuplicate) await this.crm.assertNoDuplicates(input.email, input.phone);
    const { allowDuplicate: _ignored, ownerId, ...data } = input;
    const lead = await this.db.lead.create({
      data: { ...data, organizationId, ownerId: await this.crm.resolveOwner(ownerId), ...(await this.crm.keys(data.email, data.phone)) },
      include: leadInclude,
    });
    return toLeadDto(lead);
  }

  async update(id: string, input: UpdateLeadInput): Promise<LeadDto> {
    const current = await this.getEntity(id);
    const { ownerId, ...data } = input;
    const email = data.email !== undefined ? data.email : current.email;
    const phone = data.phone !== undefined ? data.phone : current.phone;
    const lead = await this.db.lead.update({
      where: { id },
      data: {
        ...data,
        ...(ownerId !== undefined ? { ownerId: await this.crm.resolveOwner(ownerId, current.ownerId) } : {}),
        ...(data.email !== undefined || data.phone !== undefined ? await this.crm.keys(email, phone) : {}),
      },
      include: leadInclude,
    });
    return toLeadDto(lead);
  }

  async remove(id: string): Promise<void> {
    await this.getEntity(id);
    await this.db.lead.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async bulk(input: BulkLeadsInput): Promise<{ updated: number }> {
    const where: Prisma.LeadWhereInput = { id: { in: input.ids }, deletedAt: null, ...ownerScope() };
    if (input.action === 'delete') {
      const perms = TenantContext.get()?.permissions ?? [];
      if (!perms.includes('crm:delete')) throw new AppException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'You do not have permission to delete records');
      return { updated: (await this.db.lead.updateMany({ where, data: { deletedAt: new Date() } })).count };
    }
    if (input.action === 'assign') {
      const ownerId = await this.crm.resolveOwner(input.ownerId);
      return { updated: (await this.db.lead.updateMany({ where, data: { ownerId } })).count };
    }
    if (input.action === 'status') return { updated: (await this.db.lead.updateMany({ where, data: { status: input.status! } })).count };
    // tag: add to each lead that doesn't have it yet
    const rows = await this.db.lead.findMany({ where: { ...where, NOT: { tags: { has: input.tag! } } }, select: { id: true, tags: true } });
    await Promise.all(rows.map((r) => this.db.lead.update({ where: { id: r.id }, data: { tags: [...r.tags, input.tag!] } })));
    return { updated: rows.length };
  }

  /**
   * Lead → contact (+ company, + deal). Re-uses an existing contact with the same email/phone and an
   * existing company with the same name, moves the lead's activities to the contact, marks the lead CONVERTED.
   */
  async convert(id: string, input: ConvertLeadInput): Promise<{ lead: LeadDto; contact: ContactDto; deal: DealDto | null }> {
    const lead = await this.getEntity(id);
    if (lead.status === 'CONVERTED') throw new AppException(HttpStatus.CONFLICT, 'ALREADY_CONVERTED', 'This lead has already been converted');
    const organizationId = TenantContext.requireOrganizationId();
    const pipeline = input.createDeal ? await this.pipelines.getOrDefault(input.pipelineId) : null;
    const currency = await this.crm.currency();
    const keys = await this.crm.keys(lead.email, lead.phone);

    const result = await this.db.$transaction(async (tx) => {
      let companyId: string | null = null;
      const companyName = lead.company?.trim();
      if (input.createCompany && companyName) {
        const nameNormalized = normalizeCompanyName(companyName);
        const existing = nameNormalized ? await tx.company.findFirst({ where: { nameNormalized, deletedAt: null } }) : null;
        companyId =
          existing?.id ??
          (
            await tx.company.create({
              data: { organizationId, name: companyName, nameNormalized, website: lead.website, industry: lead.industry, city: lead.city, country: lead.country, ownerId: lead.ownerId },
            })
          ).id;
      }

      const or = [...(keys.emailNormalized ? [{ emailNormalized: keys.emailNormalized }] : []), ...(keys.phoneNormalized ? [{ phoneNormalized: keys.phoneNormalized }] : [])];
      const existingContact = or.length ? await tx.contact.findFirst({ where: { deletedAt: null, OR: or } }) : null;
      const contact = existingContact
        ? await tx.contact.update({ where: { id: existingContact.id }, data: { companyId: existingContact.companyId ?? companyId, tags: [...new Set([...existingContact.tags, ...lead.tags])] } })
        : await tx.contact.create({
            data: {
              organizationId,
              firstName: lead.firstName,
              lastName: lead.lastName,
              email: lead.email,
              phone: lead.phone,
              whatsapp: lead.whatsapp,
              jobTitle: lead.jobTitle,
              companyId,
              lifecycle: 'PROSPECT',
              source: lead.source,
              notes: lead.notes,
              tags: lead.tags,
              customFields: lead.customFields as Prisma.InputJsonValue,
              ownerId: lead.ownerId,
              lastContactedAt: lead.lastContactedAt,
              nextFollowUpAt: lead.nextFollowUpAt,
              ...keys,
            },
          });

      let dealId: string | null = null;
      if (pipeline) {
        const first = pipeline.stages.find((s) => s.kind === 'OPEN') ?? pipeline.stages[0]!;
        const last = await tx.deal.findFirst({ where: { stageId: first.id, deletedAt: null }, orderBy: { position: 'desc' } });
        dealId = (
          await tx.deal.create({
            data: {
              organizationId,
              name: input.dealName ?? [companyName || [lead.firstName, lead.lastName].filter(Boolean).join(' '), 'deal'].join(' – '),
              value: input.dealValue ?? 0,
              currency,
              pipelineId: pipeline.id,
              stageId: first.id,
              position: (last?.position ?? 0) + 1000,
              probability: first.probability,
              source: lead.source,
              contactId: contact.id,
              companyId,
              leadId: lead.id,
              ownerId: lead.ownerId,
            },
          })
        ).id;
      }

      await tx.activity.updateMany({ where: { leadId: lead.id }, data: { contactId: contact.id, ...(companyId ? { companyId } : {}) } });
      await tx.lead.update({ where: { id: lead.id }, data: { status: 'CONVERTED', convertedContactId: contact.id, convertedDealId: dealId, convertedAt: new Date() } });
      return { contactId: contact.id, dealId };
    });

    const [updatedLead, contact, deal] = await Promise.all([
      this.db.lead.findFirstOrThrow({ where: { id }, include: leadInclude }),
      this.db.contact.findFirstOrThrow({ where: { id: result.contactId }, include: contactInclude }),
      result.dealId ? this.db.deal.findFirstOrThrow({ where: { id: result.dealId }, include: dealInclude }) : null,
    ]);
    return { lead: toLeadDto(updatedLead), contact: toContactDto(contact), deal: deal ? toDealDto(deal) : null };
  }
}
