import { HttpStatus, Injectable } from '@nestjs/common';
import {
  CALLING_CODE_BY_CURRENCY,
  normalizeEmail,
  normalizePhone,
  type ActivityDto,
  type CompanyDto,
  type ContactDto,
  type DealDto,
  type DuplicateMatch,
  type LeadDto,
  type OwnerRef,
  type StageDto,
} from '@zatma/validation';
import { AppException } from '../common/errors.js';
import { TenantContext } from '../common/tenant-context.js';
import type { Activity, Company, Contact, Deal, Lead, PipelineStage, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

// ───────────── Record-level access ─────────────

/**
 * Roles that can manage every CRM record. Everyone else who can write (Sales Agent) works only
 * with records they own; read-only roles see everything but cannot change anything.
 */
export function seesAllRecords(): boolean {
  const ctx = TenantContext.get();
  const perms = ctx?.permissions ?? [];
  if (perms.includes('crm:delete')) return true; // Owner, Admin, CRM Manager
  return !perms.includes('crm:write'); // read-only roles: visibility without write access
}

export function currentUserId(): string {
  const id = TenantContext.get()?.userId;
  if (!id) throw new AppException(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in required');
  return id;
}

/** `where` fragment limiting queries to the records the current user may see. */
export function ownerScope(): { ownerId?: string } {
  return seesAllRecords() ? {} : { ownerId: currentUserId() };
}

export const OWNER_SELECT = { select: { id: true, name: true } } as const;

type WithOwner = { owner?: { id: string; name: string } | null };
const ownerRef = (o: WithOwner['owner']): OwnerRef | null => (o ? { id: o.id, name: o.name } : null);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
export const fullName = (p: { firstName: string; lastName: string | null }) => [p.firstName, p.lastName].filter(Boolean).join(' ');
type Fields = Record<string, string | number | boolean | null>;

@Injectable()
export class CrmContext {
  constructor(private readonly prisma: PrismaService) {}

  /** Calling code for local phone numbers, from the organization's currency. */
  async callingCode(): Promise<string> {
    const org = await this.prisma.system.organization.findUnique({ where: { id: TenantContext.requireOrganizationId() }, select: { currency: true } });
    return CALLING_CODE_BY_CURRENCY[org?.currency ?? 'INR'] ?? '91';
  }

  async currency(): Promise<string> {
    const org = await this.prisma.system.organization.findUnique({ where: { id: TenantContext.requireOrganizationId() }, select: { currency: true } });
    return org?.currency ?? 'INR';
  }

  /**
   * Owner for a new or reassigned record. Sales Agents always own what they create and cannot assign;
   * managers may assign to any member of the organization.
   */
  async resolveOwner(requested: string | null | undefined, current?: string | null): Promise<string | null> {
    const me = currentUserId();
    if (!seesAllRecords()) {
      if (requested && requested !== me) throw new AppException(HttpStatus.FORBIDDEN, 'CANNOT_ASSIGN', 'Only managers can assign records to other people');
      return current ?? me;
    }
    if (requested === undefined) return current ?? me;
    if (requested === null) return null;
    const member = await this.prisma.system.member.findFirst({ where: { organizationId: TenantContext.requireOrganizationId(), userId: requested } });
    if (!member) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'INVALID_OWNER', 'The owner must be a member of this organization');
    return requested;
  }

  /** Leads and contacts with the same email or phone (whole organization, so colleagues don't double up). */
  async findDuplicates(email: string | null | undefined, phone: string | null | undefined, exclude: { leadId?: string; contactId?: string } = {}): Promise<DuplicateMatch[]> {
    const e = normalizeEmail(email);
    const p = normalizePhone(phone, await this.callingCode());
    if (!e && !p) return [];
    const or = [...(e ? [{ emailNormalized: e }] : []), ...(p ? [{ phoneNormalized: p }] : [])];
    const db = this.prisma.tenant;
    const [leads, contacts] = await Promise.all([
      db.lead.findMany({ where: { deletedAt: null, status: { not: 'CONVERTED' }, OR: or, ...(exclude.leadId ? { id: { not: exclude.leadId } } : {}) }, take: 5 }),
      db.contact.findMany({ where: { deletedAt: null, OR: or, ...(exclude.contactId ? { id: { not: exclude.contactId } } : {}) }, take: 5 }),
    ]);
    const match = (r: { emailNormalized: string | null; phoneNormalized: string | null }) =>
      [...(e && r.emailNormalized === e ? (['email'] as const) : []), ...(p && r.phoneNormalized === p ? (['phone'] as const) : [])];
    return [
      ...leads.map((l) => ({ type: 'lead' as const, id: l.id, name: fullName(l), email: l.email, phone: l.phone, matchedOn: match(l) })),
      ...contacts.map((c) => ({ type: 'contact' as const, id: c.id, name: fullName(c), email: c.email, phone: c.phone, matchedOn: match(c) })),
    ];
  }

  async assertNoDuplicates(email: string | null | undefined, phone: string | null | undefined, exclude: { leadId?: string; contactId?: string } = {}) {
    const dups = await this.findDuplicates(email, phone, exclude);
    if (dups.length) throw new AppException(HttpStatus.CONFLICT, 'DUPLICATE_RECORD', `A ${dups[0]!.type} with the same ${dups[0]!.matchedOn.join(' and ')} already exists`, { duplicates: dups });
  }

  /** Normalised duplicate keys stored alongside person records. */
  async keys(email: string | null | undefined, phone: string | null | undefined) {
    return { emailNormalized: normalizeEmail(email), phoneNormalized: normalizePhone(phone, await this.callingCode()) };
  }
}

// ───────────── DTO mappers ─────────────

export const leadInclude = { owner: OWNER_SELECT, campaign: { select: { id: true, name: true, number: true } } } satisfies Prisma.LeadInclude;
export const campaignCode = (n: number) => `CMP-${String(n).padStart(4, '0')}`;
export function toLeadDto(l: Lead & WithOwner & { campaign?: { id: string; name: string; number: number } | null }): LeadDto {
  return {
    id: l.id,
    firstName: l.firstName,
    lastName: l.lastName,
    name: fullName(l),
    email: l.email,
    phone: l.phone,
    whatsapp: l.whatsapp,
    jobTitle: l.jobTitle,
    company: l.company,
    website: l.website,
    industry: l.industry,
    city: l.city,
    country: l.country,
    status: l.status,
    source: l.source as LeadDto['source'],
    sourceDetail: l.sourceDetail,
    notes: l.notes,
    tags: l.tags,
    customFields: (l.customFields ?? {}) as Fields,
    owner: ownerRef(l.owner),
    score: l.score,
    scoreGrade: (l.scoreGrade as LeadDto['scoreGrade']) ?? null,
    scoreReason: l.scoreReason,
    lastContactedAt: iso(l.lastContactedAt),
    nextFollowUpAt: iso(l.nextFollowUpAt),
    convertedContactId: l.convertedContactId,
    convertedDealId: l.convertedDealId,
    convertedAt: iso(l.convertedAt),
    campaign: l.campaign ? { id: l.campaign.id, name: l.campaign.name, code: campaignCode(l.campaign.number) } : null,
    utm: (l.utm as LeadDto['utm']) ?? null,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

export const contactInclude = { owner: OWNER_SELECT, company: { select: { id: true, name: true } } } satisfies Prisma.ContactInclude;
export function toContactDto(c: Contact & WithOwner & { company?: { id: string; name: string } | null }, wonValue = 0): ContactDto {
  return {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    name: fullName(c),
    email: c.email,
    phone: c.phone,
    whatsapp: c.whatsapp,
    jobTitle: c.jobTitle,
    companyId: c.companyId,
    companyName: c.company?.name ?? null,
    lifecycle: c.lifecycle,
    source: c.source as ContactDto['source'],
    notes: c.notes,
    tags: c.tags,
    customFields: (c.customFields ?? {}) as Fields,
    owner: ownerRef(c.owner),
    lastContactedAt: iso(c.lastContactedAt),
    nextFollowUpAt: iso(c.nextFollowUpAt),
    wonValue,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export const companyInclude = { owner: OWNER_SELECT, _count: { select: { contacts: { where: { deletedAt: null } }, deals: { where: { deletedAt: null } } } } } satisfies Prisma.CompanyInclude;
export function toCompanyDto(c: Company & WithOwner & { _count?: { contacts: number; deals: number } }): CompanyDto {
  return {
    id: c.id,
    name: c.name,
    website: c.website,
    industry: c.industry,
    size: c.size,
    phone: c.phone,
    email: c.email,
    address: c.address,
    city: c.city,
    country: c.country,
    tags: c.tags,
    customFields: (c.customFields ?? {}) as Fields,
    owner: ownerRef(c.owner),
    contactCount: c._count?.contacts ?? 0,
    dealCount: c._count?.deals ?? 0,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export const toStageDto = (s: PipelineStage): StageDto => ({ id: s.id, name: s.name, order: s.order, probability: s.probability, kind: s.kind });

export const dealInclude = {
  owner: OWNER_SELECT,
  stage: { select: { name: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
  company: { select: { id: true, name: true } },
} satisfies Prisma.DealInclude;
type DealRow = Deal &
  WithOwner & { stage?: { name: string } | null; contact?: { id: string; firstName: string; lastName: string | null } | null; company?: { id: string; name: string } | null };
export function toDealDto(d: DealRow): DealDto {
  return {
    id: d.id,
    name: d.name,
    value: Number(d.value),
    currency: d.currency,
    pipelineId: d.pipelineId,
    stageId: d.stageId,
    stageName: d.stage?.name ?? '',
    position: d.position,
    probability: d.probability,
    status: d.status,
    lostReason: d.lostReason,
    expectedCloseAt: iso(d.expectedCloseAt),
    closedAt: iso(d.closedAt),
    source: d.source,
    contact: d.contact ? { id: d.contact.id, name: fullName(d.contact) } : null,
    company: d.company ? { id: d.company.id, name: d.company.name } : null,
    leadId: d.leadId,
    tags: d.tags,
    notes: d.notes,
    owner: ownerRef(d.owner),
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

export const activityInclude = {
  owner: OWNER_SELECT,
  createdBy: OWNER_SELECT,
  lead: { select: { id: true, firstName: true, lastName: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
  company: { select: { id: true, name: true } },
  deal: { select: { id: true, name: true } },
} satisfies Prisma.ActivityInclude;
type ActivityRow = Activity &
  WithOwner & {
    createdBy?: { id: string; name: string } | null;
    lead?: { id: string; firstName: string; lastName: string | null } | null;
    contact?: { id: string; firstName: string; lastName: string | null } | null;
    company?: { id: string; name: string } | null;
    deal?: { id: string; name: string } | null;
  };
export function toActivityDto(a: ActivityRow): ActivityDto {
  return {
    id: a.id,
    type: a.type,
    subject: a.subject,
    body: a.body,
    dueAt: iso(a.dueAt),
    completedAt: iso(a.completedAt),
    priority: a.priority,
    outcome: a.outcome,
    owner: ownerRef(a.owner),
    createdBy: ownerRef(a.createdBy),
    lead: a.lead ? { id: a.lead.id, name: fullName(a.lead) } : null,
    contact: a.contact ? { id: a.contact.id, name: fullName(a.contact) } : null,
    company: a.company ? { id: a.company.id, name: a.company.name } : null,
    deal: a.deal ? { id: a.deal.id, name: a.deal.name } : null,
    createdAt: a.createdAt.toISOString(),
  };
}

/** Case-insensitive search over several text columns. */
export const searchOr = (q: string | undefined, fields: string[]) => (q ? { OR: fields.map((f) => ({ [f]: { contains: q, mode: 'insensitive' as const } })) } : {});

/**
 * Kanban position for a card dropped between `prev` and `next` (either may be missing).
 * Returns null when the gap is too small and the column needs renumbering.
 */
export function positionBetween(prev: number | null, next: number | null): number | null {
  if (prev === null && next === null) return 1000;
  if (prev === null) return next! - 1000;
  if (next === null) return prev + 1000;
  const mid = (prev + next) / 2;
  return next - prev > 1e-6 ? mid : null;
}
