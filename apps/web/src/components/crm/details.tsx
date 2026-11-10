'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, Globe, Mail, MessageCircle, Pencil, Phone, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@zatma/sdk';
import { Badge, Button, Card, CardContent, Dialog, DialogContent, ErrorState, Input, Label, Skeleton } from '@zatma/ui';
import { whatsappLink, type ContactDto, type LeadDto } from '@zatma/validation';
import { api } from '@/lib/api';
import { formatDate, formatMoney, LEAD_STATUS_LABELS, LEAD_STATUS_TONES, LIFECYCLE_LABELS, SOURCE_LABELS } from '@/lib/crm';
import { CompanySheet, ContactSheet, LeadSheet } from './forms';
import { DealPanel } from './pipeline';
import { describeError, OwnerChip, Tags, useCrmAccess } from './shared';
import { ActivityComposer, Timeline } from './timeline';

function NotFoundOr({ error, what, onRetry }: { error: unknown; what: string; onRetry: () => void }) {
  const missing = error instanceof ApiError && error.status === 404;
  return <ErrorState title={missing ? `${what} not found` : `Couldn't load this ${what.toLowerCase()}`} description={missing ? 'It may have been deleted, or it is assigned to someone else.' : describeError(error)} onRetry={missing ? undefined : onRetry} />;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{children ?? '—'}</dd>
    </div>
  );
}

/** Call / WhatsApp / email quick actions (click-to-chat; API messaging arrives in Phase 14). */
function QuickActions({ phone, whatsapp, email, name }: { phone: string | null; whatsapp: string | null; email: string | null; name: string }) {
  const wa = whatsappLink(whatsapp ?? phone, `Hi ${name.split(' ')[0]},`);
  return (
    <div className="flex flex-wrap gap-2">
      {phone && (
        <Button size="sm" variant="outline" asChild>
          <a href={`tel:${phone.replace(/\s+/g, '')}`}>
            <Phone aria-hidden="true" /> Call
          </a>
        </Button>
      )}
      {wa && (
        <Button size="sm" variant="outline" asChild>
          <a href={wa} target="_blank" rel="noopener noreferrer">
            <MessageCircle aria-hidden="true" /> WhatsApp
          </a>
        </Button>
      )}
      {email && (
        <Button size="sm" variant="outline" asChild>
          <a href={`mailto:${email}`}>
            <Mail aria-hidden="true" /> Email
          </a>
        </Button>
      )}
    </div>
  );
}

function DeleteButton({ what, onConfirm, busy }: { what: string; onConfirm: () => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setOpen(true)}>
        <Trash2 aria-hidden="true" /> Delete
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={`Delete this ${what}?`} description="It will be removed from lists and search.">
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={busy} onClick={onConfirm}>
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DetailLayout({ header, fields, side }: { header: ReactNode; fields: ReactNode; side: ReactNode }) {
  return (
    <div className="space-y-6">
      {header}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <Card>
          <CardContent className="p-5">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4">{fields}</dl>
          </CardContent>
        </Card>
        <div className="space-y-4">{side}</div>
      </div>
    </div>
  );
}

// ───────────── Lead ─────────────

function ConvertDialog({ lead, open, onOpenChange }: { lead: LeadDto; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [createCompany, setCreateCompany] = useState(!!lead.company);
  const [createDeal, setCreateDeal] = useState(true);
  const [dealName, setDealName] = useState(`${lead.company ?? lead.name} – deal`);
  const [dealValue, setDealValue] = useState('');
  const convert = useMutation({
    mutationFn: () => api.crm.leads.convert(lead.id, { createCompany, createDeal, ...(createDeal ? { dealName: dealName.trim() || undefined, dealValue: dealValue ? Number(dealValue) : undefined } : {}) }),
    onSuccess: async (r) => {
      toast.success(`${lead.name} is now a contact${r.deal ? ' with a new deal' : ''}`);
      await qc.invalidateQueries({ queryKey: ['crm'] });
      router.push(`/crm/contacts/${r.contact.id}`);
    },
    onError: (e) => toast.error(describeError(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Convert ${lead.name}`} description="Creates a contact (or links an existing one with the same email or phone) and moves this lead’s activity history to it.">
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            convert.mutate();
          }}
        >
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={createCompany} disabled={!lead.company} onChange={(e) => setCreateCompany(e.target.checked)} />
            {lead.company ? `Create or link company “${lead.company}”` : 'No company on this lead'}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={createDeal} onChange={(e) => setCreateDeal(e.target.checked)} />
            Create a deal in the sales pipeline
          </label>
          {createDeal && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="convert-deal-name">Deal name</Label>
                <Input id="convert-deal-name" maxLength={160} value={dealName} onChange={(e) => setDealName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="convert-deal-value">Value</Label>
                <Input id="convert-deal-value" type="number" min={0} step="any" inputMode="decimal" value={dealValue} onChange={(e) => setDealValue(e.target.value)} placeholder="0" />
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={convert.isPending}>
              <ArrowRightLeft aria-hidden="true" /> Convert
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function LeadDetail({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const access = useCrmAccess();
  const lead = useQuery({ queryKey: ['crm', 'lead', id], queryFn: () => api.crm.leads.get(id) });
  const timeline = useQuery({ queryKey: ['crm', 'lead', id, 'timeline'], queryFn: () => api.crm.leads.timeline(id) });
  const [editing, setEditing] = useState(false);
  const [converting, setConverting] = useState(false);
  const remove = useMutation({
    mutationFn: () => api.crm.leads.remove(id),
    onSuccess: async () => {
      toast.success('Lead deleted');
      await qc.invalidateQueries({ queryKey: ['crm'] });
      router.push('/crm/leads');
    },
    onError: (e) => toast.error(describeError(e)),
  });
  if (lead.isPending) return <Skeleton className="h-96" />;
  if (lead.isError) return <NotFoundOr error={lead.error} what="Lead" onRetry={() => void lead.refetch()} />;
  const l = lead.data;
  const converted = l.status === 'CONVERTED';
  return (
    <>
      <DetailLayout
        header={
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
                {l.name} <Badge tone={LEAD_STATUS_TONES[l.status]}>{LEAD_STATUS_LABELS[l.status]}</Badge>
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">{[l.jobTitle, l.company].filter(Boolean).join(' · ') || 'Lead'}</p>
              <div className="mt-3">
                <QuickActions phone={l.phone} whatsapp={l.whatsapp} email={l.email} name={l.name} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {converted && l.convertedContactId && (
                <Button variant="outline" asChild>
                  <Link href={`/crm/contacts/${l.convertedContactId}`}>View contact</Link>
                </Button>
              )}
              {access.canWrite && !converted && (
                <>
                  <Button variant="outline" onClick={() => setEditing(true)}>
                    <Pencil aria-hidden="true" /> Edit
                  </Button>
                  <Button onClick={() => setConverting(true)}>
                    <ArrowRightLeft aria-hidden="true" /> Convert
                  </Button>
                </>
              )}
              {access.canDelete && <DeleteButton what="lead" busy={remove.isPending} onConfirm={() => remove.mutate()} />}
            </div>
          </div>
        }
        fields={
          <>
            <Field label="Phone">{l.phone}</Field>
            <Field label="WhatsApp">{l.whatsapp}</Field>
            <Field label="Email">{l.email}</Field>
            <Field label="Website">
              {l.website && (
                <a className="inline-flex items-center gap-1 text-primary hover:underline" href={/^https?:\/\//.test(l.website) ? l.website : `https://${l.website}`} target="_blank" rel="noopener noreferrer">
                  <Globe className="size-3.5" aria-hidden="true" />
                  {l.website}
                </a>
              )}
            </Field>
            <Field label="Source">
              {SOURCE_LABELS[l.source]}
              {l.sourceDetail ? ` · ${l.sourceDetail}` : ''}
            </Field>
            <Field label="Industry">{l.industry}</Field>
            <Field label="Location">{[l.city, l.country].filter(Boolean).join(', ') || null}</Field>
            <Field label="Owner">
              <OwnerChip owner={l.owner} />
            </Field>
            <Field label="Last contacted">{l.lastContactedAt ? formatDate(l.lastContactedAt, true) : null}</Field>
            <Field label="Next follow-up">{l.nextFollowUpAt ? formatDate(l.nextFollowUpAt, true) : null}</Field>
            <Field label="Created">{formatDate(l.createdAt)}</Field>
            <Field label="AI score">{l.score ?? <span className="text-muted-foreground">Phase 8</span>}</Field>
            {l.tags.length > 0 && (
              <div className="col-span-2">
                <Field label="Tags">
                  <Tags tags={l.tags} />
                </Field>
              </div>
            )}
            {l.notes && (
              <div className="col-span-2">
                <Field label="Notes">
                  <span className="whitespace-pre-wrap">{l.notes}</span>
                </Field>
              </div>
            )}
          </>
        }
        side={
          <>
            {!converted && <ActivityComposer link={{ leadId: l.id }} canWrite={access.canWrite} />}
            <h2 className="text-lg font-semibold">Activity</h2>
            {timeline.isPending ? <Skeleton className="h-32" /> : <Timeline activities={timeline.data?.activities ?? []} canWrite={access.canWrite && !converted} emptyText="No calls, messages or notes yet." />}
          </>
        }
      />
      <LeadSheet open={editing} onOpenChange={setEditing} record={l} />
      {converting && <ConvertDialog lead={l} open={converting} onOpenChange={setConverting} />}
    </>
  );
}

// ───────────── Contact ─────────────

export function ContactDetail({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const access = useCrmAccess();
  const contact = useQuery({ queryKey: ['crm', 'contact', id], queryFn: () => api.crm.contacts.get(id) });
  const timeline = useQuery({ queryKey: ['crm', 'contact', id, 'timeline'], queryFn: () => api.crm.contacts.timeline(id) });
  const [editing, setEditing] = useState(false);
  const [openDeal, setOpenDeal] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: () => api.crm.contacts.remove(id),
    onSuccess: async () => {
      toast.success('Contact deleted');
      await qc.invalidateQueries({ queryKey: ['crm'] });
      router.push('/crm/contacts');
    },
    onError: (e) => toast.error(describeError(e)),
  });
  if (contact.isPending) return <Skeleton className="h-96" />;
  if (contact.isError) return <NotFoundOr error={contact.error} what="Contact" onRetry={() => void contact.refetch()} />;
  const c: ContactDto = contact.data;
  return (
    <>
      <DetailLayout
        header={
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
                {c.name} <Badge tone={c.lifecycle === 'CUSTOMER' ? 'success' : 'neutral'}>{LIFECYCLE_LABELS[c.lifecycle]}</Badge>
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {c.jobTitle}
                {c.jobTitle && c.companyName ? ' · ' : ''}
                {c.companyId && (
                  <Link className="text-primary hover:underline" href={`/crm/companies/${c.companyId}`}>
                    {c.companyName}
                  </Link>
                )}
              </p>
              <div className="mt-3">
                <QuickActions phone={c.phone} whatsapp={c.whatsapp} email={c.email} name={c.name} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {access.canWrite && (
                <Button variant="outline" onClick={() => setEditing(true)}>
                  <Pencil aria-hidden="true" /> Edit
                </Button>
              )}
              {access.canDelete && <DeleteButton what="contact" busy={remove.isPending} onConfirm={() => remove.mutate()} />}
            </div>
          </div>
        }
        fields={
          <>
            <Field label="Phone">{c.phone}</Field>
            <Field label="WhatsApp">{c.whatsapp}</Field>
            <Field label="Email">{c.email}</Field>
            <Field label="Source">{SOURCE_LABELS[c.source]}</Field>
            <Field label="Owner">
              <OwnerChip owner={c.owner} />
            </Field>
            <Field label="Won value">{formatMoney(c.wonValue, access.currency)}</Field>
            <Field label="Last contacted">{c.lastContactedAt ? formatDate(c.lastContactedAt, true) : null}</Field>
            <Field label="Next follow-up">{c.nextFollowUpAt ? formatDate(c.nextFollowUpAt, true) : null}</Field>
            {c.tags.length > 0 && (
              <div className="col-span-2">
                <Field label="Tags">
                  <Tags tags={c.tags} />
                </Field>
              </div>
            )}
            {c.notes && (
              <div className="col-span-2">
                <Field label="Notes">
                  <span className="whitespace-pre-wrap">{c.notes}</span>
                </Field>
              </div>
            )}
          </>
        }
        side={
          <>
            {(timeline.data?.deals.length ?? 0) > 0 && (
              <section aria-labelledby="contact-deals">
                <h2 id="contact-deals" className="mb-2 text-lg font-semibold">
                  Deals
                </h2>
                <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
                  {timeline.data!.deals.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <button type="button" className="text-left font-medium hover:text-primary" onClick={() => setOpenDeal(d.id)}>
                        {d.name}
                      </button>
                      <span className="flex items-center gap-2 text-sm">
                        <Badge tone={d.status === 'WON' ? 'success' : d.status === 'LOST' ? 'danger' : 'primary'}>{d.stageName}</Badge>
                        <span className="tabular-nums">{formatMoney(d.value, d.currency)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <ActivityComposer link={{ contactId: c.id }} canWrite={access.canWrite} />
            <h2 className="text-lg font-semibold">Activity</h2>
            {timeline.isPending ? <Skeleton className="h-32" /> : <Timeline activities={timeline.data?.activities ?? []} canWrite={access.canWrite} />}
          </>
        }
      />
      <ContactSheet open={editing} onOpenChange={setEditing} record={c} />
      <DealPanel dealId={openDeal} onClose={() => setOpenDeal(null)} />
    </>
  );
}

// ───────────── Company ─────────────

export function CompanyDetail({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const access = useCrmAccess();
  const company = useQuery({ queryKey: ['crm', 'company', id], queryFn: () => api.crm.companies.get(id) });
  const timeline = useQuery({ queryKey: ['crm', 'company', id, 'timeline'], queryFn: () => api.crm.companies.timeline(id) });
  const [editing, setEditing] = useState(false);
  const [addingContact, setAddingContact] = useState(false);
  const [openDeal, setOpenDeal] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: () => api.crm.companies.remove(id),
    onSuccess: async () => {
      toast.success('Company deleted');
      await qc.invalidateQueries({ queryKey: ['crm'] });
      router.push('/crm/companies');
    },
    onError: (e) => toast.error(describeError(e)),
  });
  if (company.isPending) return <Skeleton className="h-96" />;
  if (company.isError) return <NotFoundOr error={company.error} what="Company" onRetry={() => void company.refetch()} />;
  const c = company.data;
  const t = timeline.data;
  return (
    <>
      <DetailLayout
        header={
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{[c.industry, [c.city, c.country].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || 'Company'}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {access.canWrite && (
                <>
                  <Button variant="outline" onClick={() => setAddingContact(true)}>
                    Add contact
                  </Button>
                  <Button variant="outline" onClick={() => setEditing(true)}>
                    <Pencil aria-hidden="true" /> Edit
                  </Button>
                </>
              )}
              {access.canDelete && <DeleteButton what="company" busy={remove.isPending} onConfirm={() => remove.mutate()} />}
            </div>
          </div>
        }
        fields={
          <>
            <Field label="Website">{c.website}</Field>
            <Field label="Phone">{c.phone}</Field>
            <Field label="Email">{c.email}</Field>
            <Field label="Employees">{c.size}</Field>
            <Field label="Address">{c.address}</Field>
            <Field label="Owner">
              <OwnerChip owner={c.owner} />
            </Field>
            <Field label="Contacts">{c.contactCount}</Field>
            <Field label="Deals">{c.dealCount}</Field>
            {c.tags.length > 0 && (
              <div className="col-span-2">
                <Field label="Tags">
                  <Tags tags={c.tags} />
                </Field>
              </div>
            )}
          </>
        }
        side={
          <>
            <section aria-labelledby="company-contacts">
              <h2 id="company-contacts" className="mb-2 text-lg font-semibold">
                People
              </h2>
              {t && t.contacts.length > 0 ? (
                <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
                  {t.contacts.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <Link href={`/crm/contacts/${p.id}`} className="font-medium hover:text-primary hover:underline">
                        {p.name}
                      </Link>
                      <span className="truncate text-sm text-muted-foreground">{p.jobTitle ?? p.email ?? p.phone}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No contacts linked yet.</p>
              )}
            </section>
            {t && t.deals.length > 0 && (
              <section aria-labelledby="company-deals">
                <h2 id="company-deals" className="mb-2 text-lg font-semibold">
                  Deals
                </h2>
                <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
                  {t.deals.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <button type="button" className="text-left font-medium hover:text-primary" onClick={() => setOpenDeal(d.id)}>
                        {d.name}
                      </button>
                      <span className="tabular-nums text-sm">{formatMoney(d.value, d.currency)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <ActivityComposer link={{ companyId: c.id }} canWrite={access.canWrite} />
            <h2 className="text-lg font-semibold">Activity</h2>
            {timeline.isPending ? <Skeleton className="h-32" /> : <Timeline activities={t?.activities ?? []} canWrite={access.canWrite} />}
          </>
        }
      />
      <CompanySheet open={editing} onOpenChange={setEditing} record={c} />
      <ContactSheet open={addingContact} onOpenChange={setAddingContact} defaults={{ companyId: c.id }} />
      <DealPanel dealId={openDeal} onClose={() => setOpenDeal(null)} />
    </>
  );
}
