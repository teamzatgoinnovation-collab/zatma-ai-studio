'use client';

import type { ReactNode } from 'react';
import { Input, Label, Select } from '@zatma/ui';
import {
  ACTION_INFO,
  ACTIVITY_TYPES,
  CURRENCIES,
  LANGUAGES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  LIFECYCLES,
  MERGE_FIELDS,
  PRIORITIES,
  TRIGGER_INFO,
  unknownMergeFields,
  type ActionKind,
  type NodeType,
  type TriggerKind,
} from '@zatma/validation';
import { LEAD_STATUS_LABELS, LIFECYCLE_LABELS, SOURCE_LABELS } from '@/lib/crm';
import { stepLabel } from '@/lib/automation';

export interface FormContext {
  members: Array<{ userId: string; name: string }>;
  campaigns: Array<{ id: string; name: string }>;
}
type Config = Record<string, unknown>;
interface Props {
  stepId: string;
  nodeType: NodeType;
  kind: string;
  config: Config;
  ctx: FormContext;
  onChange: (patch: Config) => void;
}

const list = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const csv = (v: string) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A set of checkboxes for a fixed list of choices (nothing ticked = no filter where the step says so). */
function Choices<T extends string>({ legend, options, labels, value, onChange, hint }: { legend: string; options: readonly T[]; labels?: Record<string, string>; value: string[]; onChange: (v: T[]) => void; hint?: string }) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {options.map((o) => (
          <label key={o} className="inline-flex items-center gap-1.5 text-sm">
            <input type="checkbox" className="accent-primary" checked={value.includes(o)} onChange={() => onChange((value.includes(o) ? value.filter((x) => x !== o) : [...value, o]) as T[])} />
            {labels?.[o] ?? o}
          </label>
        ))}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </fieldset>
  );
}

function People({ legend, ctx, value, onChange }: { legend: string; ctx: FormContext; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <Choices legend={legend} options={ctx.members.map((m) => m.userId)} labels={Object.fromEntries(ctx.members.map((m) => [m.userId, m.name]))} value={value} onChange={onChange} />
  );
}

function CsvField({ id, label, value, onCommit, hint, placeholder }: { id: string; label: string; value: string[]; onCommit: (v: string[]) => void; hint?: string; placeholder?: string }) {
  // Committed on blur so a half-typed comma doesn't reshuffle the text; the key resets it when another step is opened.
  return (
    <Field id={id} label={label} hint={hint ?? 'Separate with commas'}>
      <Input id={id} key={`${id}-${value.join('|')}`} defaultValue={value.join(', ')} placeholder={placeholder} onBlur={(e) => onCommit(csv(e.target.value))} />
    </Field>
  );
}

function NumberField({ id, label, value, onChange, min = 0, max, hint, nullable }: { id: string; label: string; value: number | null | undefined; onChange: (v: number | null) => void; min?: number; max?: number; hint?: string; nullable?: boolean }) {
  return (
    <Field id={id} label={label} hint={hint}>
      <Input id={id} type="number" min={min} max={max} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? (nullable ? null : min) : Number(e.target.value))} />
    </Field>
  );
}

function CampaignSelect({ id, label, value, ctx, onChange, anyLabel }: { id: string; label: string; value: unknown; ctx: FormContext; onChange: (v: string | null) => void; anyLabel?: string }) {
  return (
    <Field id={id} label={label}>
      <Select id={id} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || (anyLabel ? null : ''))}>
        <option value="">{anyLabel ?? 'Choose a campaign…'}</option>
        {ctx.campaigns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

const OPS = [
  ['gt', 'is more than'],
  ['gte', 'is at least'],
  ['lt', 'is less than'],
  ['lte', 'is at most'],
  ['eq', 'is exactly'],
] as const;

function MergeHint({ text }: { text: string }) {
  const unknown = unknownMergeFields(text);
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <details>
        <summary className="cursor-pointer">Merge fields you can use</summary>
        <p className="mt-1 break-words">{MERGE_FIELDS.map((f) => `{{${f}}}`).join('  ')}</p>
      </details>
      {unknown.length > 0 && <p className="text-warning-text">Not a known field, it will be left blank: {unknown.map((f) => `{{${f}}}`).join(', ')}</p>}
    </div>
  );
}

export function StepForm({ stepId, nodeType, kind, config: c, ctx, onChange }: Props) {
  const f = (name: string) => `${stepId}-${name}`;
  const set = (patch: Config) => onChange(patch);

  if (nodeType === 'delay') {
    return (
      <div className="grid grid-cols-2 gap-3">
        <NumberField id={f('amount')} label="Wait for" value={num(c.amount, 1)} min={1} max={43_200} onChange={(v) => set({ amount: v ?? 1 })} />
        <Field id={f('unit')} label="Unit">
          <Select id={f('unit')} value={String(c.unit ?? 'days')} onChange={(e) => set({ unit: e.target.value })}>
            <option value="minutes">Minutes</option>
            <option value="hours">Hours</option>
            <option value="days">Days</option>
          </Select>
        </Field>
        <p className="col-span-2 text-xs text-muted-foreground">Up to 30 days. The steps after it run once the wait is over, using the record as it is then.</p>
      </div>
    );
  }

  if (nodeType === 'trigger') {
    const info = TRIGGER_INFO[kind as TriggerKind];
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{info?.description}</p>
        {kind === 'lead.created' && <Choices legend="Only from these sources" options={LEAD_SOURCES} labels={SOURCE_LABELS} value={list(c.sources)} onChange={(v) => set({ sources: v })} hint="Leave all unticked for any source. CSV imports never start automations." />}
        {kind === 'lead.status_changed' && (
          <>
            <Choices legend="Changed from" options={LEAD_STATUSES} labels={LEAD_STATUS_LABELS} value={list(c.from)} onChange={(v) => set({ from: v })} />
            <Choices legend="Changed to" options={LEAD_STATUSES} labels={LEAD_STATUS_LABELS} value={list(c.to)} onChange={(v) => set({ to: v })} hint="Leave unticked to react to any status." />
          </>
        )}
        {(kind === 'form.submitted' || kind === 'campaign.interaction') && <CampaignSelect id={f('campaign')} label="Campaign" value={c.campaignId} ctx={ctx} anyLabel="Any campaign" onChange={(v) => set({ campaignId: v })} />}
        {kind === 'activity.followup_overdue' && <NumberField id={f('grace')} label="Hours after the due time" value={num(c.graceHours)} max={720} onChange={(v) => set({ graceHours: v ?? 0 })} hint="Checked hourly, for follow-ups that became overdue in the last 14 days." />}
        {kind === 'contact.inactive' && <NumberField id={f('days')} label="Days without contact" value={num(c.days, 30)} min={1} max={365} onChange={(v) => set({ days: v ?? 30 })} hint="Checked hourly. It starts once per quiet period, not every day." />}
        {(kind === 'deal.won' || kind === 'deal.lost') && <NumberField id={f('min')} label="Only deals worth at least" value={c.minValue as number | null} nullable onChange={(v) => set({ minValue: v })} hint="Leave empty for any value." />}
      </div>
    );
  }

  if (nodeType === 'condition') {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Continues down “Yes” when this is true, otherwise “No”.</p>
        {(kind === 'lead.score' || kind === 'deal.value') && (
          <div className="grid grid-cols-2 gap-3">
            <Field id={f('op')} label={kind === 'lead.score' ? 'Score' : 'Deal value'}>
              <Select id={f('op')} value={String(c.op ?? 'gt')} onChange={(e) => set({ op: e.target.value })}>
                {OPS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <NumberField id={f('value')} label="Value" value={num(c.value)} max={kind === 'lead.score' ? 100 : undefined} onChange={(v) => set({ value: v ?? 0 })} />
            {kind === 'deal.value' && (
              <Field id={f('currency')} label="Currency">
                <Select id={f('currency')} value={String(c.currency ?? '')} onChange={(e) => set({ currency: e.target.value || null })}>
                  <option value="">Any</option>
                  {CURRENCIES.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        )}
        {kind === 'lead.source' && <Choices legend="Source is one of" options={LEAD_SOURCES} labels={SOURCE_LABELS} value={list(c.sources)} onChange={(v) => set({ sources: v })} />}
        {kind === 'segment' && (
          <>
            <Choices legend="Lead status" options={LEAD_STATUSES} labels={LEAD_STATUS_LABELS} value={list(c.statuses)} onChange={(v) => set({ statuses: v })} hint="Leave a group unticked to ignore it." />
            <Choices legend="Customer lifecycle" options={LIFECYCLES} labels={LIFECYCLE_LABELS} value={list(c.lifecycles)} onChange={(v) => set({ lifecycles: v })} />
            <Choices legend="Source" options={LEAD_SOURCES} labels={SOURCE_LABELS} value={list(c.sources)} onChange={(v) => set({ sources: v })} />
            <CsvField id={f('tags')} label="Has any of these tags" value={list(c.tags)} onCommit={(v) => set({ tags: v })} />
            <CsvField id={f('cities')} label="City is" value={list(c.cities)} onCommit={(v) => set({ cities: v })} />
          </>
        )}
        {kind === 'industry' && <CsvField id={f('industries')} label="Industry is" value={list(c.industries)} onCommit={(v) => set({ industries: v })} placeholder="Retail, Hospitality" />}
        {kind === 'tags' && (
          <>
            <Field id={f('mode')} label="The record has">
              <Select id={f('mode')} value={String(c.mode ?? 'any')} onChange={(e) => set({ mode: e.target.value })}>
                <option value="any">any of these tags</option>
                <option value="all">all of these tags</option>
                <option value="none">none of these tags</option>
              </Select>
            </Field>
            <CsvField id={f('tags')} label="Tags" value={list(c.tags)} onCommit={(v) => set({ tags: v })} />
          </>
        )}
        {kind === 'campaign.engagement' && (
          <>
            <Field id={f('engaged')} label="The record is">
              <Select id={f('engaged')} value={c.engaged === false ? 'no' : 'yes'} onChange={(e) => set({ engaged: e.target.value === 'yes' })}>
                <option value="yes">in a campaign (attributed or enrolled)</option>
                <option value="no">not in a campaign</option>
              </Select>
            </Field>
            <CampaignSelect id={f('campaign')} label="Campaign" value={c.campaignId} ctx={ctx} anyLabel="Any campaign" onChange={(v) => set({ campaignId: v })} />
          </>
        )}
        {kind === 'date' && (
          <>
            <Choices legend="On these days" options={['0', '1', '2', '3', '4', '5', '6']} labels={Object.fromEntries(WEEKDAYS.map((d, i) => [String(i), d]))} value={list(c.weekdays).map(String)} onChange={(v) => set({ weekdays: v.map(Number).sort() })} hint="In your organization's time zone. None ticked = every day." />
            <div className="grid grid-cols-2 gap-3">
              <Field id={f('from')} label="From">
                <Input id={f('from')} type="time" value={String(c.fromTime ?? '')} onChange={(e) => set({ fromTime: e.target.value || null })} />
              </Field>
              <Field id={f('to')} label="Until">
                <Input id={f('to')} type="time" value={String(c.toTime ?? '')} onChange={(e) => set({ toTime: e.target.value || null })} />
              </Field>
              <NumberField id={f('minAge')} label="Record at least (days old)" value={c.minAgeDays as number | null} nullable onChange={(v) => set({ minAgeDays: v })} />
              <NumberField id={f('maxAge')} label="Record at most (days old)" value={c.maxAgeDays as number | null} nullable onChange={(v) => set({ maxAgeDays: v })} />
            </div>
          </>
        )}
      </div>
    );
  }

  // Actions
  const info = ACTION_INFO[kind as ActionKind];
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{info?.description}</p>
      {(kind === 'email_lead' || kind === 'whatsapp_lead') && <p className="rounded-lg bg-muted p-3 text-sm">{stepLabel('action', kind)} is available in Phase 14, with consent tracking, templates and unsubscribe. It can&apos;t be activated yet.</p>}
      {kind === 'assign_owner' && (
        <>
          <People legend="Assign to" ctx={ctx} value={list(c.userIds)} onChange={(v) => set({ userIds: v })} />
          {list(c.userIds).length > 1 && (
            <Field id={f('strategy')} label="When there are several people">
              <Select id={f('strategy')} value={String(c.strategy ?? 'round_robin')} onChange={(e) => set({ strategy: e.target.value })}>
                <option value="round_robin">Take turns, in order</option>
                <option value="specific">Always the first person</option>
              </Select>
            </Field>
          )}
        </>
      )}
      {kind === 'create_task' && (
        <>
          <Field id={f('subject')} label="Task title">
            <Input id={f('subject')} value={String(c.subject ?? '')} maxLength={200} onChange={(e) => set({ subject: e.target.value })} />
          </Field>
          <MergeHint text={String(c.subject ?? '')} />
          <div className="grid grid-cols-2 gap-3">
            <Field id={f('type')} label="Type">
              <Select id={f('type')} value={String(c.type ?? 'FOLLOW_UP')} onChange={(e) => set({ type: e.target.value })}>
                {ACTIVITY_TYPES.filter((t) => t !== 'NOTE').map((t) => (
                  <option key={t} value={t}>
                    {t.replace('_', ' ').toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id={f('priority')} label="Priority">
              <Select id={f('priority')} value={String(c.priority ?? 'MEDIUM')} onChange={(e) => set({ priority: e.target.value })}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p.toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>
            <NumberField id={f('due')} label="Due in (hours)" value={num(c.dueInHours, 24)} max={2160} onChange={(v) => set({ dueInHours: v ?? 24 })} />
            <Field id={f('assignee')} label="Assign to">
              <Select id={f('assignee')} value={String(c.assigneeId ?? '')} onChange={(e) => set({ assigneeId: e.target.value || null })}>
                <option value="">The record&apos;s owner</option>
                {ctx.members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </>
      )}
      {(kind === 'add_tag' || kind === 'remove_tag') && (
        <Field id={f('tag')} label="Tag">
          <Input id={f('tag')} value={String(c.tag ?? '')} maxLength={40} onChange={(e) => set({ tag: e.target.value })} />
        </Field>
      )}
      {kind === 'set_lead_status' && (
        <Field id={f('status')} label="Set the lead's status to">
          <Select id={f('status')} value={String(c.status ?? 'CONTACTED')} onChange={(e) => set({ status: e.target.value })}>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {LEAD_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {(kind === 'notify_team' || kind === 'email_team') && (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="accent-primary" checked={c.toOwner !== false} onChange={(e) => set({ toOwner: e.target.checked })} />
            Send to the record&apos;s owner
          </label>
          <People legend="And these teammates" ctx={ctx} value={list(c.userIds)} onChange={(v) => set({ userIds: v })} />
          {kind === 'email_team' && (
            <Field id={f('subject')} label="Subject">
              <Input id={f('subject')} value={String(c.subject ?? '')} maxLength={150} onChange={(e) => set({ subject: e.target.value })} />
            </Field>
          )}
          <Field id={f('message')} label={kind === 'email_team' ? 'Message' : 'Notification'} hint="Internal only: it goes to your team, never to the customer.">
            <textarea
              id={f('message')}
              className="min-h-24 w-full rounded-xl border border-input bg-background p-3 text-sm"
              value={String((kind === 'email_team' ? c.body : c.message) ?? '')}
              maxLength={kind === 'email_team' ? 2000 : 500}
              onChange={(e) => set(kind === 'email_team' ? { body: e.target.value } : { message: e.target.value })}
            />
          </Field>
          <MergeHint text={`${String(c.subject ?? '')} ${String((kind === 'email_team' ? c.body : c.message) ?? '')}`} />
        </>
      )}
      {kind === 'enroll_campaign' && (
        <>
          <CampaignSelect id={f('campaign')} label="Campaign" value={c.campaignId} ctx={ctx} onChange={(v) => set({ campaignId: v ?? '' })} />
          <p className="text-xs text-muted-foreground">Adds the person to the campaign&apos;s audience (for Email and WhatsApp in Phase 14) and credits the lead to it if it has no campaign yet.</p>
        </>
      )}
      {kind === 'generate_ai_message' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field id={f('channel')} label="Channel">
              <Select id={f('channel')} value={String(c.channel ?? 'whatsapp')} onChange={(e) => set({ channel: e.target.value })}>
                <option value="whatsapp">WhatsApp</option>
                <option value="email">Email</option>
                <option value="sms">SMS</option>
              </Select>
            </Field>
            <Field id={f('language')} label="Language">
              <Select id={f('language')} value={String(c.language ?? 'en')} onChange={(e) => set({ language: e.target.value })}>
                {LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field id={f('goal')} label="What should it say?" hint="The draft is saved as a note on the record for the owner to review and send. Nothing is sent, and it uses AI credits.">
            <Input id={f('goal')} value={String(c.goal ?? '')} maxLength={300} onChange={(e) => set({ goal: e.target.value })} />
          </Field>
        </>
      )}
    </div>
  );
}
