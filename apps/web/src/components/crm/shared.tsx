'use client';

import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { ApiError } from '@zatma/sdk';
import { Badge, Button, cn, Dialog, FieldError, Input, Label, Select, SheetContent } from '@zatma/ui';
import type { OwnerRef } from '@zatma/validation';
import { api } from '@/lib/api';
import { initials } from '@/lib/crm';

/** What the current user may do in the CRM. Sales Agents (write without delete) work only with their own records. */
export function useCrmAccess() {
  const org = useQuery({ queryKey: ['organization', 'current'], queryFn: api.organizations.current });
  const me = useQuery({ queryKey: ['users', 'me'], queryFn: api.users.me });
  const perms = new Set(org.data?.permissions ?? []);
  const canWrite = perms.has('crm:write');
  const canDelete = perms.has('crm:delete');
  return {
    loaded: org.isSuccess && me.isSuccess,
    canWrite,
    canDelete,
    /** Managers (and read-only roles) see every record; Sales Agents only their own. */
    seesAll: canDelete || !canWrite,
    canAssign: canDelete,
    me: me.data?.id ?? null,
    currency: org.data?.currency ?? 'INR',
  };
}

export function useMembers(enabled = true) {
  return useQuery({ queryKey: ['organization', 'members'], queryFn: api.organizations.members, enabled, staleTime: 60_000 });
}

export const describeError = (e: unknown) => {
  if (e instanceof ApiError) {
    if (e.code === 'PLAN_LIMIT_REACHED') return 'Your plan’s CRM record limit is reached. Upgrade to add more contacts and leads.';
    return e.message;
  }
  return (e as Error).message;
};

/** Field errors from a VALIDATION_ERROR response, keyed by the top-level field. */
export function fieldErrors(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError) || e.code !== 'VALIDATION_ERROR' || !Array.isArray(e.details)) return {};
  const out: Record<string, string> = {};
  for (const d of e.details as Array<{ path: string; message: string }>) {
    const key = String(d.path).split('.')[0]!;
    if (!out[key]) out[key] = d.message;
  }
  return out;
}

export function OwnerChip({ owner }: { owner: OwnerRef | null }) {
  if (!owner) return <span className="text-muted-foreground">Unassigned</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className="grid size-6 place-items-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
        {initials(owner.name)}
      </span>
      <span className="truncate">{owner.name}</span>
    </span>
  );
}

export function Tags({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <Badge key={t} className="px-2 py-0">
          {t}
        </Badge>
      ))}
    </span>
  );
}

// ───────────── Config-driven form ─────────────

export interface FieldDef {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'tel' | 'url' | 'textarea' | 'select' | 'tags' | 'number' | 'date' | 'datetime';
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
  placeholder?: string;
  /** Full row on wide forms. */
  wide?: boolean;
  /** Allow an empty choice in selects (sent as null). */
  optional?: boolean;
  help?: string;
}

export type FormValues = Record<string, string>;

/** Turns form strings into an API payload according to the field types. */
export function toPayload(fields: FieldDef[], values: FormValues, mode: 'create' | 'update'): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = (values[f.name] ?? '').trim();
    switch (f.type) {
      case 'tags':
        out[f.name] = raw
          ? [
              ...new Set(
                raw
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean),
              ),
            ]
          : [];
        break;
      case 'number':
        if (raw !== '') out[f.name] = Number(raw);
        break;
      case 'date':
        out[f.name] = raw ? raw : mode === 'update' ? null : undefined;
        break;
      case 'datetime':
        out[f.name] = raw ? new Date(raw).toISOString() : mode === 'update' ? null : undefined;
        break;
      case 'select':
        if (raw) out[f.name] = raw;
        else if (f.optional) out[f.name] = null;
        break;
      default:
        out[f.name] = raw ? raw : mode === 'update' ? null : undefined;
    }
    if (out[f.name] === undefined) delete out[f.name];
  }
  return out;
}

/** Converts an ISO timestamp to the value of a datetime-local input (local time). */
export const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function RecordForm({
  fields,
  values,
  onChange,
  errors,
  onBlurField,
}: {
  fields: FieldDef[];
  values: FormValues;
  onChange: (name: string, value: string) => void;
  errors: Record<string, string>;
  onBlurField?: (name: string) => void;
}) {
  const uid = useId();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((f) => {
        const id = `${uid}-${f.name}`;
        const err = errors[f.name];
        const common = {
          id,
          name: f.name,
          value: values[f.name] ?? '',
          'aria-invalid': !!err,
          'aria-describedby': err ? `${id}-err` : f.help ? `${id}-help` : undefined,
          required: f.required,
          onBlur: () => onBlurField?.(f.name),
        };
        return (
          <div key={f.name} className={cn('space-y-1.5', (f.wide || f.type === 'textarea') && 'sm:col-span-2')}>
            <Label htmlFor={id}>
              {f.label}
              {f.required && <span aria-hidden="true"> *</span>}
            </Label>
            {f.type === 'textarea' ? (
              <textarea
                {...common}
                rows={3}
                onChange={(e) => onChange(f.name, e.target.value)}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive"
              />
            ) : f.type === 'select' ? (
              <Select {...common} onChange={(e) => onChange(f.name, e.target.value)}>
                {f.optional && <option value="">—</option>}
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                {...common}
                type={f.type === 'tags' ? 'text' : f.type === 'datetime' ? 'datetime-local' : (f.type ?? 'text')}
                inputMode={f.type === 'number' ? 'decimal' : undefined}
                min={f.type === 'number' ? 0 : undefined}
                step={f.type === 'number' ? 'any' : undefined}
                placeholder={f.placeholder ?? (f.type === 'tags' ? 'Comma separated' : undefined)}
                onChange={(e) => onChange(f.name, e.target.value)}
              />
            )}
            {f.help && !err && (
              <p id={`${id}-help`} className="text-xs text-muted-foreground">
                {f.help}
              </p>
            )}
            <FieldError id={`${id}-err`} message={err} />
          </div>
        );
      })}
    </div>
  );
}

/** Right-hand sheet with a visible title, used for create/edit forms. */
export function FormSheet({ open, onOpenChange, title, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" title={title} className="w-[34rem] max-w-full bg-background">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={() => onOpenChange(false)}>
            <X aria-hidden="true" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </SheetContent>
    </Dialog>
  );
}

/** Owner select for managers; hidden for Sales Agents (they always own what they create). */
export function useOwnerField(): FieldDef | null {
  const access = useCrmAccess();
  const members = useMembers(access.canAssign);
  if (!access.canAssign) return null;
  return { name: 'ownerId', label: 'Owner', type: 'select', optional: true, options: (members.data ?? []).map((m) => ({ value: m.userId, label: m.name })) };
}

/** Debounced value (for search boxes). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
