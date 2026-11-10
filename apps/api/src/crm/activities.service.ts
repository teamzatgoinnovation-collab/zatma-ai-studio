import { Injectable } from '@nestjs/common';
import type { Paginated } from '@zatma/types';
import type { ActivityDto, CreateActivityInput, FollowUpsQuery, ListActivitiesInput, TimelineDto, UpdateActivityInput } from '@zatma/validation';
import { notFound } from '../common/errors.js';
import { paginate } from '../common/pagination.js';
import { TenantContext } from '../common/tenant-context.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ScoringService } from './scoring.service.js';
import { activityInclude, CrmContext, currentUserId, dealInclude, ownerScope, seesAllRecords, toActivityDto, toDealDto } from './crm-common.js';

/** Activity types that count as contacting the person. */
const CONTACT_TYPES = new Set(['CALL', 'EMAIL', 'MEETING', 'WHATSAPP']);

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** UTC instant of local midnight (in `tz`) for the day containing `date`. */
export function startOfDayInZone(date: Date, tz: string): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const localAsUtc = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
  const offset = localAsUtc - Math.floor(date.getTime() / 1000) * 1000;
  return new Date(Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!) - offset);
}

@Injectable()
export class ActivitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crm: CrmContext,
    private readonly scoring: ScoringService,
  ) {}

  private get db() {
    return this.prisma.tenant;
  }

  /** The records an activity links to must exist and be visible to the current user. */
  private async assertLinks(input: { leadId?: string | null; contactId?: string | null; companyId?: string | null; dealId?: string | null }) {
    const scope = ownerScope();
    if (input.leadId && !(await this.db.lead.findFirst({ where: { id: input.leadId, deletedAt: null, ...scope } }))) throw notFound('Lead');
    if (input.contactId && !(await this.db.contact.findFirst({ where: { id: input.contactId, deletedAt: null, ...scope } }))) throw notFound('Contact');
    if (input.companyId && !(await this.db.company.findFirst({ where: { id: input.companyId, deletedAt: null } }))) throw notFound('Company');
    if (input.dealId && !(await this.db.deal.findFirst({ where: { id: input.dealId, deletedAt: null, ...scope } }))) throw notFound('Deal');
  }

  /** Keeps lastContactedAt / nextFollowUpAt on the linked lead and contact in sync. */
  private async refreshDates(leadId: string | null | undefined, contactId: string | null | undefined, contactedAt?: Date) {
    for (const [model, id] of [
      ['lead', leadId],
      ['contact', contactId],
    ] as const) {
      if (!id) continue;
      const next = await this.db.activity.findFirst({ where: { [`${model}Id`]: id, deletedAt: null, completedAt: null, dueAt: { not: null } }, orderBy: { dueAt: 'asc' }, select: { dueAt: true } });
      const data = { nextFollowUpAt: next?.dueAt ?? null, ...(contactedAt ? { lastContactedAt: contactedAt } : {}) };
      if (model === 'lead') {
        await this.db.lead.updateMany({ where: { id }, data });
        // First contact moves a NEW lead to CONTACTED.
        if (contactedAt) await this.db.lead.updateMany({ where: { id, status: 'NEW' }, data: { status: 'CONTACTED' } });
        await this.scoring.scoreOne(id);
      } else await this.db.contact.updateMany({ where: { id }, data });
    }
  }

  async getEntity(id: string) {
    const a = await this.db.activity.findFirst({ where: { id, deletedAt: null, ...ownerScope() }, include: activityInclude });
    if (!a) throw notFound('Activity');
    return a;
  }

  async list(q: ListActivitiesInput): Promise<Paginated<ActivityDto>> {
    const where: Prisma.ActivityWhereInput = {
      deletedAt: null,
      ...ownerScope(),
      ...(q.type ? { type: q.type } : {}),
      ...(q.status === 'open' ? { completedAt: null } : q.status === 'completed' ? { completedAt: { not: null } } : {}),
      ...(q.ownerId && seesAllRecords() ? { ownerId: q.ownerId } : {}),
      ...(q.leadId ? { leadId: q.leadId } : {}),
      ...(q.contactId ? { contactId: q.contactId } : {}),
      ...(q.companyId ? { companyId: q.companyId } : {}),
      ...(q.dealId ? { dealId: q.dealId } : {}),
      ...(q.q ? { OR: [{ subject: { contains: q.q, mode: 'insensitive' } }, { body: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.activity.findMany({ where, include: activityInclude, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.db.activity.count({ where }),
    ]);
    return paginate(rows.map(toActivityDto), total, q);
  }

  async create(input: CreateActivityInput): Promise<ActivityDto> {
    await this.assertLinks(input);
    const organizationId = TenantContext.requireOrganizationId();
    const now = new Date();
    const dueAt = input.dueAt ? new Date(input.dueAt) : null;
    // Logged interactions are complete when created unless they are scheduled for later.
    const completedAt = input.completed === true || (input.completed === undefined && CONTACT_TYPES.has(input.type) && (!dueAt || dueAt <= now)) || (input.completed === undefined && input.type === 'NOTE') ? now : null;
    const { ownerId, completed: _c, ...data } = input;
    const a = await this.db.activity.create({
      data: { ...data, dueAt, completedAt, organizationId, ownerId: await this.crm.resolveOwner(ownerId), createdById: currentUserId() },
      include: activityInclude,
    });
    await this.refreshDates(a.leadId, a.contactId, completedAt && CONTACT_TYPES.has(a.type) ? completedAt : undefined);
    return toActivityDto(a);
  }

  async update(id: string, input: UpdateActivityInput): Promise<ActivityDto> {
    const current = await this.getEntity(id);
    const { ownerId, completed, dueAt, ...data } = input;
    const completedAt = completed === undefined ? undefined : completed ? (current.completedAt ?? new Date()) : null;
    const a = await this.db.activity.update({
      where: { id },
      data: {
        ...data,
        ...(dueAt !== undefined ? { dueAt: dueAt ? new Date(dueAt) : null } : {}),
        ...(completedAt !== undefined ? { completedAt } : {}),
        ...(ownerId !== undefined ? { ownerId: await this.crm.resolveOwner(ownerId, current.ownerId) } : {}),
      },
      include: activityInclude,
    });
    const contacted = completed && !current.completedAt && CONTACT_TYPES.has(a.type) ? a.completedAt! : undefined;
    await this.refreshDates(a.leadId, a.contactId, contacted);
    return toActivityDto(a);
  }

  async remove(id: string): Promise<void> {
    const a = await this.getEntity(id);
    await this.db.activity.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.refreshDates(a.leadId, a.contactId);
  }

  async followUps(q: FollowUpsQuery): Promise<ActivityDto[]> {
    const user = await this.prisma.system.user.findUnique({ where: { id: currentUserId() }, select: { timezone: true } });
    const tz = q.tz && isValidTimeZone(q.tz) ? q.tz : user?.timezone && isValidTimeZone(user.timezone) ? user.timezone : 'Asia/Kolkata';
    const now = new Date();
    const today = startOfDayInZone(now, tz);
    const day = 24 * 3600 * 1000;
    const due: Prisma.DateTimeNullableFilter =
      q.range === 'overdue' ? { lt: now } : q.range === 'today' ? { gte: today, lt: new Date(today.getTime() + day) } : q.range === 'week' ? { gte: today, lt: new Date(today.getTime() + 7 * day) } : { not: null };
    const rows = await this.db.activity.findMany({
      where: { deletedAt: null, completedAt: null, dueAt: due, ...ownerScope(), ...(q.owner === 'me' ? { ownerId: currentUserId() } : {}) },
      include: activityInclude,
      orderBy: { dueAt: 'asc' },
      take: 500,
    });
    return rows.map(toActivityDto);
  }

  async leadTimeline(leadId: string): Promise<TimelineDto> {
    if (!(await this.db.lead.findFirst({ where: { id: leadId, deletedAt: null, ...ownerScope() } }))) throw notFound('Lead');
    const [activities, deals] = await Promise.all([
      this.db.activity.findMany({ where: { leadId, deletedAt: null }, include: activityInclude, orderBy: { createdAt: 'desc' }, take: 200 }),
      this.db.deal.findMany({ where: { leadId, deletedAt: null }, include: dealInclude }),
    ]);
    return { activities: activities.map(toActivityDto), deals: deals.map(toDealDto) };
  }

  async dealTimeline(dealId: string): Promise<TimelineDto> {
    if (!(await this.db.deal.findFirst({ where: { id: dealId, deletedAt: null, ...ownerScope() } }))) throw notFound('Deal');
    const activities = await this.db.activity.findMany({ where: { dealId, deletedAt: null }, include: activityInclude, orderBy: { createdAt: 'desc' }, take: 200 });
    return { activities: activities.map(toActivityDto), deals: [] };
  }
}
