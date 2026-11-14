import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { renderMerge, type ActionConfig, type ActionKind, type EntityType, type WorkflowNode } from '@zatma/validation';
import { AppException } from '../common/errors.js';
import { TenantContext } from '../common/tenant-context.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { ActivitiesService } from '../crm/activities.service.js';
import { CrmAiService } from '../crm/crm-ai.service.js';
import { LeadsService } from '../crm/leads.service.js';
import { PipelineService } from '../crm/pipeline.service.js';
import { ContactsService } from '../crm/records.service.js';
import { EmailService } from '../email/email.service.js';
import { emailTemplates } from '../email/templates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS } from '../redis/redis.module.js';
import { AutomationEventsService } from './automation-events.service.js';
import { loadSubject, mergeValues, ownerOf, subjectLink, type Subject } from './automation-subject.js';
import { pickRoundRobin } from './triggers.js';

export interface ActionContext {
  organizationId: string;
  workflowId: string;
  workflowName: string;
  runId: string;
  entityType: EntityType;
  entityId: string;
  /** The member the workflow runs as (the activator). */
  runAs: string;
}

export interface ActionResult {
  /** Redacted summary stored on the step: ids and counts only, never message bodies or contact details. */
  output: Record<string, unknown>;
  /** The step did nothing because it did not apply; shown as "Skipped". */
  skipped?: string;
}

const permanent = (code: string, message: string, status: HttpStatus = HttpStatus.UNPROCESSABLE_ENTITY) => new AppException(status, code, message);

@Injectable()
export class AutomationActions {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly leads: LeadsService,
    private readonly contacts: ContactsService,
    private readonly pipeline: PipelineService,
    private readonly activities: ActivitiesService,
    private readonly ai: CrmAiService,
    private readonly email: EmailService,
    private readonly events: AutomationEventsService,
  ) {}

  private get db() {
    return this.prisma.tenant;
  }

  /** Executes one action node as the workflow's owner. Throws an AppException for problems retrying cannot fix. */
  async execute(node: WorkflowNode, ctx: ActionContext): Promise<ActionResult> {
    const subject = await loadSubject(this.db, ctx.entityType, ctx.entityId);
    if (!subject.primary) return { output: {}, skipped: 'The record no longer exists' };
    const config = node.config as never;
    switch (node.kind as ActionKind) {
      case 'assign_owner':
        return this.assignOwner(config as ActionConfig<'assign_owner'>, subject, node.id, ctx);
      case 'create_task':
        return this.createTask(config as ActionConfig<'create_task'>, subject, ctx);
      case 'add_tag':
        return this.tag(config as ActionConfig<'add_tag'>, subject, true);
      case 'remove_tag':
        return this.tag(config as ActionConfig<'remove_tag'>, subject, false);
      case 'set_lead_status':
        return this.setStatus(config as ActionConfig<'set_lead_status'>, subject);
      case 'notify_team':
        return this.notify(config as ActionConfig<'notify_team'>, subject, ctx, 'notify');
      case 'email_team':
        return this.notify(config as ActionConfig<'email_team'>, subject, ctx, 'email');
      case 'enroll_campaign':
        return this.enroll(config as ActionConfig<'enroll_campaign'>, subject, ctx);
      case 'generate_ai_message':
        return this.generateMessage(config as ActionConfig<'generate_ai_message'>, subject, ctx);
      default:
        // email_lead / whatsapp_lead: messaging customers needs Phase 14 (consent, templates, unsubscribe).
        throw permanent('ACTION_UNAVAILABLE', 'Messaging customers is available in Phase 14');
    }
  }

  private async members(userIds: string[]): Promise<Array<{ userId: string; name: string; email: string }>> {
    if (!userIds.length) return [];
    const rows = await this.prisma.system.member.findMany({ where: { organizationId: TenantContext.requireOrganizationId(), userId: { in: userIds } }, include: { user: { select: { name: true, email: true } } } });
    const missing = userIds.filter((id) => !rows.some((r) => r.userId === id));
    if (missing.length) throw permanent('MEMBER_NOT_FOUND', 'A person chosen in this step is no longer on the team');
    return rows.map((r) => ({ userId: r.userId, name: r.user.name, email: r.user.email }));
  }

  private async assignOwner(c: ActionConfig<'assign_owner'>, s: Subject, nodeId: string, ctx: ActionContext): Promise<ActionResult> {
    await this.members(c.userIds);
    const counter = c.strategy === 'round_robin' && c.userIds.length > 1 ? (await this.redis.incr(`auto:rr:${ctx.workflowId}:${nodeId}`)) - 1 : 0;
    const ownerId = pickRoundRobin(c.userIds, counter);
    if (ownerOf(s) === ownerId) return { output: { ownerId, changed: false } };
    if (s.primary === 'lead') await this.leads.update(s.lead!.id, { ownerId });
    else if (s.primary === 'contact') await this.contacts.update(s.contact!.id, { ownerId });
    else await this.pipeline.updateDeal(s.deal!.id, { ownerId });
    return { output: { ownerId, changed: true, on: s.primary } };
  }

  private async orgName(): Promise<string> {
    return (await this.prisma.system.organization.findUnique({ where: { id: TenantContext.requireOrganizationId() }, select: { name: true } }))?.name ?? '';
  }

  private async campaignName(s: Subject): Promise<string | null> {
    const id = s.lead?.campaignId ?? s.deal?.campaignId;
    return id ? ((await this.db.campaign.findFirst({ where: { id }, select: { name: true } }))?.name ?? null) : null;
  }

  private async render(template: string, s: Subject): Promise<string> {
    return renderMerge(template, mergeValues(s, await this.orgName(), await this.campaignName(s)));
  }

  private async createTask(c: ActionConfig<'create_task'>, s: Subject, ctx: ActionContext): Promise<ActionResult> {
    const assignee = c.assigneeId ?? ownerOf(s) ?? ctx.runAs;
    if (c.assigneeId) await this.members([c.assigneeId]);
    // At least a minute out, so calls and tasks stay open instead of being logged as already done.
    const dueAt = new Date(Date.now() + Math.max(60_000, c.dueInHours * 3_600_000)).toISOString();
    const subject = (await this.render(c.subject, s)).trim().slice(0, 200) || 'Follow up';
    const link = s.primary === 'deal' ? { dealId: s.deal!.id, ...(s.contact ? { contactId: s.contact.id } : {}) } : s.lead ? { leadId: s.lead.id } : s.contact ? { contactId: s.contact.id } : { dealId: s.deal!.id };
    const a = await this.activities.create({ type: c.type, subject, dueAt, priority: c.priority, body: null, outcome: null, ...link, ownerId: assignee, completed: false });
    return { output: { activityId: a.id, ownerId: assignee } };
  }

  private async tag(c: { tag: string }, s: Subject, add: boolean): Promise<ActionResult> {
    const current = (s.primary === 'lead' ? s.lead!.tags : s.primary === 'contact' ? s.contact!.tags : s.deal!.tags) ?? [];
    const has = current.some((t) => t.toLowerCase() === c.tag.toLowerCase());
    if (add === has) return { output: { changed: false } };
    const tags = add ? [...current, c.tag] : current.filter((t) => t.toLowerCase() !== c.tag.toLowerCase());
    if (s.primary === 'lead') await this.leads.update(s.lead!.id, { tags });
    else if (s.primary === 'contact') await this.contacts.update(s.contact!.id, { tags });
    else await this.pipeline.updateDeal(s.deal!.id, { tags });
    return { output: { changed: true, on: s.primary } };
  }

  private async setStatus(c: ActionConfig<'set_lead_status'>, s: Subject): Promise<ActionResult> {
    if (!s.lead) return { output: {}, skipped: 'There is no lead on this record' };
    if (s.lead.status === c.status) return { output: { changed: false } };
    await this.leads.update(s.lead.id, { status: c.status });
    return { output: { changed: true, from: s.lead.status, to: c.status } };
  }

  /** Internal email to teammates (and the record's owner). Customers are never emailed from here. */
  private async notify(c: ActionConfig<'notify_team'> | ActionConfig<'email_team'>, s: Subject, ctx: ActionContext, mode: 'notify' | 'email'): Promise<ActionResult> {
    const ids = new Set(c.userIds);
    const owner = ownerOf(s);
    if (c.toOwner && owner) ids.add(owner);
    if (ids.size === 0) return { output: {}, skipped: 'No recipients: the record has no owner and no one was chosen' };
    const people = await this.members([...ids]);
    const heading = mode === 'email' ? await this.render((c as ActionConfig<'email_team'>).subject, s) : `Automation: ${ctx.workflowName}`;
    const message = await this.render(mode === 'email' ? (c as ActionConfig<'email_team'>).body : (c as ActionConfig<'notify_team'>).message, s);
    const url = subjectLink(s, this.env.WEB_URL);
    for (const p of people) {
      const t = emailTemplates.automationNotice({ name: p.name, workflow: ctx.workflowName, heading: heading.slice(0, 150), message: message.slice(0, 2000), url });
      await this.email.send({ to: p.email, subject: t.subject, html: t.html, text: t.text, tag: t.tag, organizationId: ctx.organizationId });
    }
    return { output: { recipients: people.length } };
  }

  private async enroll(c: ActionConfig<'enroll_campaign'>, s: Subject, ctx: ActionContext): Promise<ActionResult> {
    const campaign = await this.db.campaign.findFirst({ where: { id: c.campaignId, deletedAt: null }, select: { id: true, manualStatus: true } });
    if (!campaign) throw permanent('CAMPAIGN_NOT_FOUND', 'The campaign for this step no longer exists');
    if (campaign.manualStatus === 'CANCELLED') throw permanent('CAMPAIGN_CANCELLED', 'The campaign for this step was cancelled');
    const organizationId = ctx.organizationId;
    let enrolled = 0;
    const add = async (data: { leadId: string } | { contactId: string }) => {
      try {
        await this.db.campaignEnrollment.create({ data: { organizationId, campaignId: campaign.id, source: 'automation', workflowId: ctx.workflowId, ...data } });
        enrolled++;
      } catch (e) {
        if ((e as { code?: string }).code !== 'P2002') throw e; // already enrolled
      }
    };
    if (s.lead) await add({ leadId: s.lead.id });
    if (s.contact) await add({ contactId: s.contact.id });
    if (!s.lead && !s.contact) return { output: {}, skipped: 'Only leads and contacts can be enrolled' };
    // First touch: a lead with no campaign yet is attributed to this one.
    if (s.lead && !s.lead.campaignId) {
      const res = await this.db.lead.updateMany({ where: { id: s.lead.id, campaignId: null }, data: { campaignId: campaign.id } });
      if (res.count) void this.events.emit({ kind: 'campaign.interaction', entityType: 'lead', entityId: s.lead.id, payload: { campaignId: campaign.id } });
    }
    return { output: { campaignId: campaign.id, enrolled, alreadyEnrolled: enrolled === 0 } };
  }

  /** Drafts a message and saves it as a note for the owner to review and send. Nothing is sent to anyone. */
  private async generateMessage(c: ActionConfig<'generate_ai_message'>, s: Subject, ctx: ActionContext): Promise<ActionResult> {
    if (!s.lead && !s.contact) return { output: {}, skipped: 'Messages can only be drafted for leads and contacts' };
    let text: string;
    let provider: string;
    let credits: number;
    if (s.contact) {
      const r = await this.ai.draftContactMessage(s.contact.id, { channel: c.channel, goal: 'follow_up', language: c.language as 'en', context: c.goal.slice(0, 500) });
      ({ text, provider, credits } = r);
    } else {
      const r = await this.ai.leadInsights(s.lead!.id, c.language as 'en');
      text = r.followUpMessage.text;
      provider = r.provider;
      credits = r.credits;
    }
    const link = s.lead ? { leadId: s.lead.id } : { contactId: s.contact!.id };
    const a = await this.activities.create({ type: 'NOTE', subject: `AI draft (${c.channel}): ${c.goal}`.slice(0, 200), body: text.slice(0, 4900), outcome: null, priority: 'MEDIUM', ...link, ownerId: ownerOf(s) ?? ctx.runAs });
    return { output: { activityId: a.id, provider, credits, channel: c.channel } };
  }
}

/** Errors worth retrying: anything that is not a deliberate 4xx from our own validation (timeouts, 5xx, rate limits). */
export function isTransient(e: unknown): boolean {
  if (e instanceof AppException) {
    const status = e.getStatus();
    return status >= 500 || status === 429;
  }
  return !(e instanceof Error && e.name === 'MissingTenantError');
}
