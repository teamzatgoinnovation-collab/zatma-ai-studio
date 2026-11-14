import type { Activity, Company, Contact, Deal, Lead } from '../generated/prisma/client.js';
import type { RecordFacts, EntityType } from '@zatma/validation';
import type { PrismaService } from '../prisma/prisma.service.js';

/** The CRM records an event is about, loaded fresh each time so an action sees earlier actions' changes. */
export interface Subject {
  lead: Lead | null;
  contact: (Contact & { company: Pick<Company, 'industry' | 'city'> | null }) | null;
  deal: Deal | null;
  activity: Activity | null;
  /** The record conditions and most actions work on. */
  primary: 'lead' | 'contact' | 'deal' | null;
}

type Db = PrismaService['tenant'];

export async function loadSubject(db: Db, entityType: EntityType, entityId: string): Promise<Subject> {
  const lead = (id: string | null | undefined) => (id ? db.lead.findFirst({ where: { id, deletedAt: null } }) : Promise.resolve(null));
  const contact = (id: string | null | undefined) => (id ? db.contact.findFirst({ where: { id, deletedAt: null }, include: { company: { select: { industry: true, city: true } } } }) : Promise.resolve(null));
  const deal = (id: string | null | undefined) => (id ? db.deal.findFirst({ where: { id, deletedAt: null } }) : Promise.resolve(null));
  const s: Subject = { lead: null, contact: null, deal: null, activity: null, primary: null };
  if (entityType === 'lead') s.lead = await lead(entityId);
  else if (entityType === 'contact') s.contact = await contact(entityId);
  else if (entityType === 'deal') {
    s.deal = await deal(entityId);
    [s.contact, s.lead] = await Promise.all([contact(s.deal?.contactId), lead(s.deal?.leadId)]);
  } else {
    s.activity = await db.activity.findFirst({ where: { id: entityId, deletedAt: null } });
    [s.lead, s.contact, s.deal] = await Promise.all([lead(s.activity?.leadId), contact(s.activity?.contactId), deal(s.activity?.dealId)]);
  }
  s.primary = entityType === 'lead' ? (s.lead ? 'lead' : null) : entityType === 'contact' ? (s.contact ? 'contact' : null) : entityType === 'deal' ? (s.deal ? 'deal' : null) : s.lead ? 'lead' : s.contact ? 'contact' : s.deal ? 'deal' : null;
  return s;
}

export const ownerOf = (s: Subject): string | null => (s.primary === 'lead' ? s.lead!.ownerId : s.primary === 'contact' ? s.contact!.ownerId : s.primary === 'deal' ? s.deal!.ownerId : null);

export async function loadFacts(db: Db, s: Subject): Promise<RecordFacts | null> {
  if (!s.primary) return null;
  const l = s.primary === 'lead' ? s.lead : null;
  const c = s.primary === 'contact' ? s.contact : null;
  const d = s.primary === 'deal' ? s.deal : null;
  const enrolled = await db.campaignEnrollment.findMany({ where: { OR: [...(s.lead ? [{ leadId: s.lead.id }] : []), ...(s.contact ? [{ contactId: s.contact.id }] : [])] }, select: { campaignId: true }, take: 100 });
  return {
    entity: s.primary,
    score: l?.score ?? null,
    source: l?.source ?? c?.source ?? d?.source ?? null,
    status: l?.status ?? d?.status ?? null,
    lifecycle: c?.lifecycle ?? null,
    tags: l?.tags ?? c?.tags ?? d?.tags ?? [],
    industry: l?.industry ?? c?.company?.industry ?? null,
    city: l?.city ?? c?.company?.city ?? null,
    dealValue: d ? Number(d.value) : null,
    dealCurrency: d?.currency ?? null,
    campaignId: l?.campaignId ?? d?.campaignId ?? null,
    enrolledCampaignIds: enrolled.map((e) => e.campaignId),
    createdAt: (l ?? c ?? d)?.createdAt ?? null,
  };
}

/** Values for `{{merge.fields}}`. */
export function mergeValues(s: Subject, orgName: string, campaignName: string | null): Record<string, string | number | null> {
  const l = s.lead;
  const c = s.contact;
  const d = s.deal;
  const person = l ?? c;
  const name = [person?.firstName, person?.lastName].filter(Boolean).join(' ');
  return {
    'lead.firstName': l?.firstName ?? c?.firstName ?? null,
    'lead.lastName': l?.lastName ?? c?.lastName ?? null,
    'lead.name': name || null,
    'lead.email': l?.email ?? c?.email ?? null,
    'lead.phone': l?.phone ?? c?.phone ?? null,
    'lead.company': l?.company ?? null,
    'lead.score': l?.score ?? null,
    'lead.status': l?.status ?? null,
    'lead.source': l?.source ?? c?.source ?? null,
    'contact.name': c ? [c.firstName, c.lastName].filter(Boolean).join(' ') : name || null,
    'deal.name': d?.name ?? null,
    'deal.value': d ? Number(d.value) : null,
    'deal.currency': d?.currency ?? null,
    'campaign.name': campaignName,
    'org.name': orgName,
  };
}

export const subjectLink = (s: Subject, webUrl: string): string | null =>
  s.lead ? `${webUrl}/crm/leads/${s.lead.id}` : s.contact ? `${webUrl}/crm/contacts/${s.contact.id}` : s.deal ? `${webUrl}/crm/deals/${s.deal.id}` : null;
