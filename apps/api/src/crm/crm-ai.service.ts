import { Injectable } from '@nestjs/common';
import {
  draftMessageOutputSchema,
  leadInsightsOutputSchema,
  type DraftMessageInput,
  type DraftMessageResult,
  type LeadInsights,
  type ScoreSignalResult,
} from '@zatma/validation';
import type { CallContext } from '../ai/ai.service.js';
import { notFound } from '../common/errors.js';
import { TenantContext } from '../common/tenant-context.js';
import { languageGuidance, languageName } from '../copy/copy-prompts.js';
import { CopyService, toBrandFacts } from '../copy/copy.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { fullName, ownerScope } from './crm-common.js';
import { ScoringService } from './scoring.service.js';

const FACT_RULE =
  'Use ONLY facts given below (the record, its activity history and the brand details). Never invent prices, discounts, dates, deadlines, promises, product features or contact details. If something is unknown, do not mention it.';

type ActivityLine = { type: string; subject: string; body: string | null; createdAt: Date; dueAt: Date | null; completedAt: Date | null };

/** Compact, factual activity history for the prompt (newest first). */
export function activityLines(activities: ActivityLine[], now = new Date()): string {
  if (!activities.length) return 'No activity yet.';
  return activities
    .slice(0, 12)
    .map((a) => {
      const when = a.dueAt && !a.completedAt ? `due ${a.dueAt.toISOString().slice(0, 10)}${a.dueAt < now ? ' (overdue)' : ''}` : (a.completedAt ?? a.createdAt).toISOString().slice(0, 10);
      return `- ${when} · ${a.type} · ${a.subject}${a.body ? `: ${a.body.slice(0, 160)}` : ''}`;
    })
    .join('\n');
}

export function insightsSystemPrompt(): string {
  return [
    'You are a pragmatic sales coach for small businesses in India (especially Kerala) and the Gulf.',
    'Given one lead, its activity history and its explainable score, decide the single best next step and draft a short follow-up message.',
    FACT_RULE,
    'Reply with only a JSON object:',
    '{"summary":"two sentences on where this lead stands",',
    ' "nextBestAction":{"action":"CALL|WHATSAPP|EMAIL|MEETING|NURTURE|DISQUALIFY","reason":"one sentence","when":"today|tomorrow|this_week|next_week"},',
    ' "talkingPoints":["up to 4 short points"],',
    ' "followUpMessage":{"channel":"whatsapp|email","subject":"only for email","text":"the message"}}',
    'Write "summary", "reason" and "talkingPoints" in English for the sales team. Write "followUpMessage" in the requested language, warm and concise, signed with the brand name if known.',
  ].join('\n');
}

export interface LeadPromptData {
  name: string;
  jobTitle: string | null;
  company: string | null;
  industry: string | null;
  city: string | null;
  country: string | null;
  source: string;
  status: string;
  notes: string | null;
  hasWhatsapp: boolean;
  hasEmail: boolean;
  score: number | null;
  grade: string | null;
  signals: ScoreSignalResult[];
}

export function insightsUserPrompt(lead: LeadPromptData, activities: string, language: string, brand: ReturnType<typeof toBrandFacts>): string {
  return [
    `Lead: ${lead.name}${lead.jobTitle ? `, ${lead.jobTitle}` : ''}${lead.company ? ` at ${lead.company}` : ''}`,
    `Industry: ${lead.industry ?? 'unknown'} · Location: ${[lead.city, lead.country].filter(Boolean).join(', ') || 'unknown'} · Source: ${lead.source} · Status: ${lead.status}`,
    `Reachable on: ${[lead.hasWhatsapp && 'WhatsApp', lead.hasEmail && 'email'].filter(Boolean).join(', ') || 'phone only or unknown'}`,
    lead.notes ? `Notes: ${lead.notes.slice(0, 600)}` : '',
    `Score: ${lead.score ?? 'n/a'} (${lead.grade ?? 'ungraded'}). Signals: ${lead.signals.map((s) => `${s.label} ${s.points > 0 ? '+' : ''}${s.points} (${s.detail})`).join('; ') || 'none'}`,
    `Activity history:\n${activities}`,
    `Follow-up message language: ${languageName(language)}. ${languageGuidance(language)}`,
    brand ? `Brand details: ${[brand.name, brand.tagline, brand.website, brand.whatsapp && `WhatsApp ${brand.whatsapp}`, brand.phone && `Phone ${brand.phone}`].filter(Boolean).join(' · ')}${brand.guidelines ? `\nBrand guidelines: ${brand.guidelines}` : ''}` : 'Brand details: none.',
  ]
    .filter(Boolean)
    .join('\n');
}

const GOAL_TEXT: Record<DraftMessageInput['goal'], string> = {
  follow_up: 'a friendly follow-up on the last conversation',
  reengage: 're-engage a contact who has gone quiet, without being pushy',
  thank_you: 'thank them for their business or time',
  meeting_request: 'ask for a short meeting or call',
  offer: 'mention an offer ONLY if one appears in the facts below; otherwise invite them to ask about current options',
};

@Injectable()
export class CrmAiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly copy: CopyService,
    private readonly scoring: ScoringService,
  ) {}

  private ctx(): CallContext {
    return { organizationId: TenantContext.requireOrganizationId(), userId: TenantContext.get()?.userId ?? null, purpose: 'crm' };
  }

  private async defaults() {
    const organizationId = TenantContext.requireOrganizationId();
    const [org, kit] = await Promise.all([
      this.prisma.system.organization.findUnique({ where: { id: organizationId }, select: { defaultLanguage: true } }),
      this.prisma.tenant.brandKit.findFirst({ where: { isDefault: true } }),
    ]);
    return { language: org?.defaultLanguage ?? 'en', brand: toBrandFacts(kit) };
  }

  async cachedInsights(leadId: string): Promise<LeadInsights | null> {
    const lead = await this.prisma.tenant.lead.findFirst({ where: { id: leadId, deletedAt: null, ...ownerScope() }, select: { aiInsights: true } });
    if (!lead) throw notFound('Lead');
    return (lead.aiInsights as LeadInsights | null) ?? null;
  }

  async leadInsights(leadId: string, language?: string): Promise<LeadInsights> {
    const db = this.prisma.tenant;
    const visible = await db.lead.findFirst({ where: { id: leadId, deletedAt: null, ...ownerScope() }, select: { id: true } });
    if (!visible) throw notFound('Lead');
    const score = await this.scoring.scoreOne(leadId);
    const lead = await db.lead.findFirstOrThrow({ where: { id: leadId }, include: { activities: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 12 } } });
    const d = await this.defaults();
    const lang = language ?? d.language;
    const res = await this.copy.runJson(
      insightsSystemPrompt(),
      insightsUserPrompt(
        {
          name: fullName(lead),
          jobTitle: lead.jobTitle,
          company: lead.company,
          industry: lead.industry,
          city: lead.city,
          country: lead.country,
          source: lead.source,
          status: lead.status,
          notes: lead.notes,
          hasWhatsapp: !!(lead.whatsapp || lead.phone),
          hasEmail: !!lead.email,
          score: score?.score ?? lead.score,
          grade: score?.grade ?? lead.scoreGrade,
          signals: score?.signals ?? [],
        },
        activityLines(lead.activities),
        lang,
        d.brand,
      ),
      leadInsightsOutputSchema,
      1500,
      this.ctx(),
    );
    const insights: LeadInsights = { ...res.data, language: lang, generatedAt: new Date().toISOString(), provider: res.provider, model: res.model, credits: res.credits };
    await db.lead.update({ where: { id: leadId }, data: { aiInsights: insights as unknown as Prisma.InputJsonValue, aiInsightsAt: new Date() } });
    return insights;
  }

  async draftContactMessage(contactId: string, input: DraftMessageInput): Promise<DraftMessageResult> {
    const db = this.prisma.tenant;
    const c = await db.contact.findFirst({
      where: { id: contactId, deletedAt: null, ...ownerScope() },
      include: {
        company: { select: { name: true } },
        activities: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 10 },
        deals: { where: { deletedAt: null }, select: { name: true, status: true, stage: { select: { name: true } } }, take: 5 },
      },
    });
    if (!c) throw notFound('Contact');
    const d = await this.defaults();
    const lang = input.language ?? d.language;
    const system = [
      'You write short, natural customer messages for small businesses in India and the Gulf.',
      FACT_RULE,
      `Channel: ${input.channel}. ${input.channel === 'sms' ? 'Keep it under 160 characters (70 for non-Latin scripts).' : input.channel === 'whatsapp' ? 'WhatsApp style: warm, a few short lines, at most one or two emojis.' : 'Email: include a clear subject line.'}`,
      'Reply with only JSON: {"subject":"only for email","text":"the message"}.',
    ].join('\n');
    const user = [
      `Goal: ${GOAL_TEXT[input.goal]}.`,
      `Contact: ${fullName(c)}${c.jobTitle ? `, ${c.jobTitle}` : ''}${c.company ? ` at ${c.company.name}` : ''} (${c.lifecycle.toLowerCase()}).`,
      c.deals.length ? `Deals: ${c.deals.map((x) => `${x.name} (${x.status === 'OPEN' ? x.stage.name : x.status.toLowerCase()})`).join('; ')}` : '',
      `Activity history:\n${activityLines(c.activities)}`,
      input.context ? `Extra context from the user: ${input.context}` : '',
      `Language: ${languageName(lang)}. ${languageGuidance(lang)}`,
      d.brand ? `Brand: ${[d.brand.name, d.brand.website, d.brand.whatsapp && `WhatsApp ${d.brand.whatsapp}`].filter(Boolean).join(' · ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const res = await this.copy.runJson(system, user, draftMessageOutputSchema, 800, this.ctx());
    return { channel: input.channel, language: lang, subject: input.channel === 'email' ? (res.data.subject ?? null) : null, text: res.data.text, provider: res.provider, model: res.model, credits: res.credits };
  }
}
