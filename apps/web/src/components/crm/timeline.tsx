'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, Circle, Mail, MessageCircle, NotebookPen, Phone, Trash2, Users, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, cn, Input, Label, Select } from '@zatma/ui';
import { PRIORITIES, type ActivityDto, type ActivityType, type CreateActivityRequest } from '@zatma/validation';
import { api } from '@/lib/api';
import { ACTIVITY_LABELS, formatDate, relativeTime } from '@/lib/crm';
import { describeError, toLocalInput } from './shared';

export const ACTIVITY_ICONS: Record<ActivityType, LucideIcon> = {
  CALL: Phone,
  EMAIL: Mail,
  MEETING: Users,
  WHATSAPP: MessageCircle,
  NOTE: NotebookPen,
  TASK: CheckCircle2,
  FOLLOW_UP: CalendarClock,
};

export type ActivityLink = Pick<CreateActivityRequest, 'leadId' | 'contactId' | 'companyId' | 'dealId'>;

const COMPOSER_TYPES: ActivityType[] = ['CALL', 'WHATSAPP', 'EMAIL', 'MEETING', 'NOTE', 'FOLLOW_UP'];

export function ActivityComposer({ link, onCreated, canWrite }: { link: ActivityLink; onCreated?: () => void; canWrite: boolean }) {
  const qc = useQueryClient();
  const uid = useId();
  const [type, setType] = useState<ActivityType>('CALL');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [dueAt, setDueAt] = useState(() => toLocalInput(new Date(Date.now() + 24 * 3600_000).toISOString()));
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>('MEDIUM');
  const scheduled = type === 'FOLLOW_UP';

  const create = useMutation({
    mutationFn: () =>
      api.crm.activities.create({
        ...link,
        type,
        subject: subject.trim() || (scheduled ? 'Follow up' : `${ACTIVITY_LABELS[type]} logged`),
        body: body.trim() || null,
        priority,
        ...(scheduled ? { dueAt: new Date(dueAt).toISOString() } : {}),
      }),
    onSuccess: async () => {
      setSubject('');
      setBody('');
      toast.success(scheduled ? 'Follow-up scheduled' : 'Activity logged');
      await qc.invalidateQueries({ queryKey: ['crm'] });
      onCreated?.();
    },
    onError: (e) => toast.error(describeError(e)),
  });

  if (!canWrite) return null;
  return (
    <form
      className="space-y-3 rounded-2xl border border-border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (scheduled && !dueAt) return;
        create.mutate();
      }}
    >
      <div role="radiogroup" aria-label="Activity type" className="flex flex-wrap gap-1.5">
        {COMPOSER_TYPES.map((t) => {
          const Icon = ACTIVITY_ICONS[t];
          return (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={type === t}
              onClick={() => setType(t)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                type === t ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted',
              )}
            >
              <Icon className="size-3.5" aria-hidden="true" />
              {t === 'FOLLOW_UP' ? 'Schedule follow-up' : `Log ${t === 'WHATSAPP' ? 'WhatsApp' : ACTIVITY_LABELS[t].toLowerCase()}`}
            </button>
          );
        })}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${uid}-subject`}>{scheduled ? 'What needs to happen?' : 'Summary'}</Label>
        <Input id={`${uid}-subject`} maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={scheduled ? 'e.g. Send the quotation' : 'e.g. Discussed pricing for 3 vans'} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${uid}-body`}>Details (optional)</Label>
        <textarea
          id={`${uid}-body`}
          rows={2}
          maxLength={5000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      {scheduled && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-due`}>Due</Label>
            <Input id={`${uid}-due`} type="datetime-local" required value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-priority`}>Priority</Label>
            <Select id={`${uid}-priority`} value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p[0] + p.slice(1).toLowerCase()}
                </option>
              ))}
            </Select>
          </div>
        </div>
      )}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={create.isPending}>
          {scheduled ? 'Schedule' : 'Log activity'}
        </Button>
      </div>
    </form>
  );
}

/** Link to the record an activity belongs to (used in cross-record lists). */
export function ActivityTarget({ a }: { a: ActivityDto }) {
  const t = a.deal ? { href: `/crm/deals?open=${a.deal.id}`, name: a.deal.name } : a.contact ? { href: `/crm/contacts/${a.contact.id}`, name: a.contact.name } : a.lead ? { href: `/crm/leads/${a.lead.id}`, name: a.lead.name } : a.company ? { href: `/crm/companies/${a.company.id}`, name: a.company.name } : null;
  return t ? (
    <Link href={t.href} className="text-primary underline-offset-2 hover:underline">
      {t.name}
    </Link>
  ) : null;
}

export function ActivityItem({ a, canWrite, showTarget = false }: { a: ActivityDto; canWrite: boolean; showTarget?: boolean }) {
  const qc = useQueryClient();
  const Icon = ACTIVITY_ICONS[a.type];
  const open = !a.completedAt;
  const [now] = useState(() => Date.now());
  const overdue = open && a.dueAt && new Date(a.dueAt).getTime() < now;
  const toggle = useMutation({
    mutationFn: () => api.crm.activities.update(a.id, { completed: open }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crm'] }),
    onError: (e) => toast.error(describeError(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.crm.activities.remove(a.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crm'] }),
    onError: (e) => toast.error(describeError(e)),
  });
  return (
    <li className="flex gap-3">
      <span aria-hidden="true" className={cn('mt-0.5 grid size-8 shrink-0 place-items-center rounded-full', open && a.dueAt ? 'bg-warning/15 text-warning-text' : 'bg-primary/10 text-primary')}>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('font-medium', !open && a.dueAt && 'text-muted-foreground line-through')}>{a.subject}</span>
          <Badge className="px-2 py-0">{ACTIVITY_LABELS[a.type]}</Badge>
          {a.dueAt && open && <Badge tone={overdue ? 'danger' : 'warning'}>{overdue ? `Overdue · ${relativeTime(a.dueAt)}` : `Due ${relativeTime(a.dueAt)}`}</Badge>}
          {a.priority === 'HIGH' && open && <Badge tone="danger">High</Badge>}
        </div>
        {a.body && <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">{a.body}</p>}
        <p className="mt-0.5 text-xs text-muted-foreground">
          {a.dueAt ? `Due ${formatDate(a.dueAt, true)}` : formatDate(a.createdAt, true)}
          {a.owner ? ` · ${a.owner.name}` : ''}
          {showTarget && (
            <>
              {' · '}
              <ActivityTarget a={a} />
            </>
          )}
        </p>
      </div>
      {canWrite && (
        <div className="flex shrink-0 items-start gap-1">
          {a.dueAt && (
            <Button size="icon" variant="ghost" className="size-8" aria-label={open ? `Mark “${a.subject}” done` : `Reopen “${a.subject}”`} disabled={toggle.isPending} onClick={() => toggle.mutate()}>
              {open ? <Circle aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
            </Button>
          )}
          <Button size="icon" variant="ghost" className="size-8" aria-label={`Delete “${a.subject}”`} disabled={remove.isPending} onClick={() => remove.mutate()}>
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      )}
    </li>
  );
}

export function Timeline({ activities, canWrite, emptyText = 'No activity yet.' }: { activities: ActivityDto[]; canWrite: boolean; emptyText?: string }) {
  if (!activities.length) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  const open = activities.filter((a) => a.dueAt && !a.completedAt).sort((a, b) => a.dueAt!.localeCompare(b.dueAt!));
  const rest = activities.filter((a) => !(a.dueAt && !a.completedAt));
  return (
    <div className="space-y-5">
      {open.length > 0 && (
        <section aria-label="Upcoming">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Upcoming</h3>
          <ul className="space-y-3">
            {open.map((a) => (
              <ActivityItem key={a.id} a={a} canWrite={canWrite} />
            ))}
          </ul>
        </section>
      )}
      {rest.length > 0 && (
        <section aria-label="History">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">History</h3>
          <ul className="space-y-3">
            {rest.map((a) => (
              <ActivityItem key={a.id} a={a} canWrite={canWrite} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
