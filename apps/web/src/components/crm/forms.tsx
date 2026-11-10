'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@zatma/sdk';
import { Alert, Button } from '@zatma/ui';
import {
  COMPANY_SIZES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  LIFECYCLES,
  type CompanyDto,
  type ContactDto,
  type DealDto,
  type DuplicateMatch,
  type LeadDto,
} from '@zatma/validation';
import { api } from '@/lib/api';
import { LEAD_STATUS_LABELS, LIFECYCLE_LABELS, SOURCE_LABELS } from '@/lib/crm';
import { describeError, fieldErrors, FormSheet, RecordForm, toPayload, useCrmAccess, useOwnerField, type FieldDef, type FormValues } from './shared';

const sourceOptions = LEAD_SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s] }));

const LEAD_FIELDS: FieldDef[] = [
  { name: 'firstName', label: 'First name', required: true },
  { name: 'lastName', label: 'Last name' },
  { name: 'phone', label: 'Phone', type: 'tel', placeholder: '+91 98765 43210' },
  { name: 'whatsapp', label: 'WhatsApp', type: 'tel' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'company', label: 'Company' },
  { name: 'jobTitle', label: 'Job title' },
  { name: 'website', label: 'Website', type: 'url' },
  { name: 'industry', label: 'Industry' },
  { name: 'city', label: 'City' },
  { name: 'country', label: 'Country' },
  { name: 'status', label: 'Status', type: 'select', options: LEAD_STATUSES.filter((s) => s !== 'CONVERTED').map((s) => ({ value: s, label: LEAD_STATUS_LABELS[s] })) },
  { name: 'source', label: 'Source', type: 'select', options: sourceOptions },
  { name: 'sourceDetail', label: 'Source detail', placeholder: 'e.g. Onam campaign, Lulu Mall stall' },
  { name: 'tags', label: 'Tags', type: 'tags', wide: true },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];

const CONTACT_FIELDS: FieldDef[] = [
  { name: 'firstName', label: 'First name', required: true },
  { name: 'lastName', label: 'Last name' },
  { name: 'phone', label: 'Phone', type: 'tel' },
  { name: 'whatsapp', label: 'WhatsApp', type: 'tel' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'jobTitle', label: 'Job title' },
  { name: 'lifecycle', label: 'Lifecycle', type: 'select', options: LIFECYCLES.map((l) => ({ value: l, label: LIFECYCLE_LABELS[l] })) },
  { name: 'source', label: 'Source', type: 'select', options: sourceOptions },
  { name: 'tags', label: 'Tags', type: 'tags', wide: true },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];

const COMPANY_FIELDS: FieldDef[] = [
  { name: 'name', label: 'Name', required: true, wide: true },
  { name: 'website', label: 'Website', type: 'url' },
  { name: 'industry', label: 'Industry' },
  { name: 'size', label: 'Employees', type: 'select', optional: true, options: COMPANY_SIZES.map((s) => ({ value: s, label: s })) },
  { name: 'phone', label: 'Phone', type: 'tel' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'city', label: 'City' },
  { name: 'country', label: 'Country' },
  { name: 'address', label: 'Address', wide: true },
  { name: 'tags', label: 'Tags', type: 'tags', wide: true },
];

const str = (v: unknown) => (v === null || v === undefined ? '' : Array.isArray(v) ? v.join(', ') : String(v));
const initialValues = (fields: FieldDef[], record: Record<string, unknown> | null, defaults: FormValues): FormValues =>
  Object.fromEntries(fields.map((f) => [f.name, record ? str(record[f.name]) : (defaults[f.name] ?? '')]));

/** Warning listing existing leads/contacts with the same email or phone. */
function DuplicateNotice({ matches, onCreateAnyway, busy }: { matches: DuplicateMatch[]; onCreateAnyway?: () => void; busy?: boolean }) {
  if (!matches.length) return null;
  return (
    <Alert tone="info" className="mb-4 space-y-2">
      <p className="flex items-center gap-2 font-medium">
        <AlertTriangle className="size-4" aria-hidden="true" /> Possible duplicate
      </p>
      <ul className="list-disc space-y-0.5 pl-5">
        {matches.map((m) => (
          <li key={`${m.type}-${m.id}`}>
            <Link className="underline" href={`/crm/${m.type === 'lead' ? 'leads' : 'contacts'}/${m.id}`}>
              {m.name}
            </Link>{' '}
            ({m.type}, same {m.matchedOn.join(' and ')})
          </li>
        ))}
      </ul>
      {onCreateAnyway && (
        <Button size="sm" variant="outline" disabled={busy} onClick={onCreateAnyway}>
          Create anyway
        </Button>
      )}
    </Alert>
  );
}

/** Shared create/edit flow: validation errors per field, duplicate warnings for people. */
function EntitySheet<T extends { id: string }>({
  open,
  onOpenChange,
  title,
  fields,
  record,
  defaults,
  checkDuplicates,
  save,
  onSaved,
  submitLabel,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  fields: FieldDef[];
  record: Record<string, unknown> | null;
  defaults: FormValues;
  checkDuplicates?: { exclude: { excludeLeadId?: string; excludeContactId?: string } };
  save: (payload: Record<string, unknown>) => Promise<T>;
  onSaved: (r: T) => void;
  submitLabel: string;
}) {
  const [values, setValues] = useState<FormValues>(() => initialValues(fields, record, defaults));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dupes, setDupes] = useState<DuplicateMatch[]>([]);
  const [blocked, setBlocked] = useState(false);

  const mutation = useMutation({
    mutationFn: (allowDuplicate: boolean) => save({ ...toPayload(fields, values, record ? 'update' : 'create'), ...(allowDuplicate ? { allowDuplicate: true } : {}) }),
    onSuccess: (r) => {
      toast.success(record ? 'Saved' : 'Created');
      onSaved(r);
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'DUPLICATE_RECORD') {
        setDupes(((e.details as { duplicates?: DuplicateMatch[] })?.duplicates ?? []) as DuplicateMatch[]);
        setBlocked(true);
        return;
      }
      const fe = fieldErrors(e);
      setErrors(fe);
      if (!Object.keys(fe).length) toast.error(describeError(e));
    },
  });

  const onBlurField = async (name: string) => {
    if (!checkDuplicates || (name !== 'email' && name !== 'phone')) return;
    const email = values.email?.trim();
    const phone = values.phone?.trim();
    if (!email && !phone) return setDupes([]);
    try {
      setDupes(await api.crm.leads.duplicates({ ...(email ? { email } : {}), ...(phone ? { phone } : {}), ...checkDuplicates.exclude }));
    } catch {
      /* advisory only */
    }
  };

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title={title}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setBlocked(false);
          mutation.mutate(false);
        }}
        className="space-y-5"
      >
        <DuplicateNotice matches={dupes} busy={mutation.isPending} onCreateAnyway={blocked && !record ? () => mutation.mutate(true) : undefined} />
        <RecordForm
          fields={fields}
          values={values}
          errors={errors}
          onBlurField={(n) => void onBlurField(n)}
          onChange={(n, v) => {
            setValues((s) => ({ ...s, [n]: v }));
            if (errors[n]) setErrors((all) => Object.fromEntries(Object.entries(all).filter(([k]) => k !== n)));
          }}
        />
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
            {submitLabel}
          </Button>
        </div>
      </form>
    </FormSheet>
  );
}

interface SheetProps<T> {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  record?: T | null;
  onSaved?: (r: T) => void;
}

export function LeadSheet({ open, onOpenChange, record = null, onSaved }: SheetProps<LeadDto>) {
  const qc = useQueryClient();
  const owner = useOwnerField();
  const me = useCrmAccess().me ?? '';
  const fields = owner ? [...LEAD_FIELDS.slice(0, -2), owner, ...LEAD_FIELDS.slice(-2)] : LEAD_FIELDS;
  return (
    <EntitySheet<LeadDto>
      key={`${record?.id ?? 'new'}-${open}-${me}`}
      open={open}
      onOpenChange={onOpenChange}
      title={record ? `Edit ${record.name}` : 'New lead'}
      fields={fields}
      record={record ? { ...record, ownerId: record.owner?.id ?? '' } : null}
      defaults={{ status: 'NEW', source: 'other', ownerId: me }}
      checkDuplicates={{ exclude: record ? { excludeLeadId: record.id } : {} }}
      save={(p) => (record ? api.crm.leads.update(record.id, p) : api.crm.leads.create(p as { firstName: string }))}
      onSaved={async (r) => {
        await qc.invalidateQueries({ queryKey: ['crm'] });
        onSaved?.(r);
      }}
      submitLabel={record ? 'Save changes' : 'Create lead'}
    />
  );
}

export function ContactSheet({ open, onOpenChange, record = null, onSaved, defaults = {} }: SheetProps<ContactDto> & { defaults?: FormValues }) {
  const qc = useQueryClient();
  const owner = useOwnerField();
  const me = useCrmAccess().me ?? '';
  const companies = useQuery({ queryKey: ['crm', 'companies', 'options'], queryFn: () => api.crm.companies.list({ pageSize: 100, sort: 'name', order: 'asc' }), enabled: open });
  const companyField: FieldDef = { name: 'companyId', label: 'Company', type: 'select', optional: true, options: (companies.data?.data ?? []).map((c) => ({ value: c.id, label: c.name })) };
  const base = [...CONTACT_FIELDS.slice(0, 6), companyField, ...CONTACT_FIELDS.slice(6)];
  const fields = owner ? [...base.slice(0, -2), owner, ...base.slice(-2)] : base;
  return (
    <EntitySheet<ContactDto>
      key={`${record?.id ?? 'new'}-${open}-${me}-${companies.isSuccess}`}
      open={open}
      onOpenChange={onOpenChange}
      title={record ? `Edit ${record.name}` : 'New contact'}
      fields={fields}
      record={record ? { ...record, ownerId: record.owner?.id ?? '' } : null}
      defaults={{ lifecycle: 'PROSPECT', source: 'other', ownerId: me, ...defaults }}
      checkDuplicates={{ exclude: record ? { excludeContactId: record.id } : {} }}
      save={(p) => (record ? api.crm.contacts.update(record.id, p) : api.crm.contacts.create(p as { firstName: string }))}
      onSaved={async (r) => {
        await qc.invalidateQueries({ queryKey: ['crm'] });
        onSaved?.(r);
      }}
      submitLabel={record ? 'Save changes' : 'Create contact'}
    />
  );
}

export function CompanySheet({ open, onOpenChange, record = null, onSaved }: SheetProps<CompanyDto>) {
  const qc = useQueryClient();
  const owner = useOwnerField();
  const me = useCrmAccess().me ?? '';
  const fields = owner ? [...COMPANY_FIELDS, owner] : COMPANY_FIELDS;
  return (
    <EntitySheet<CompanyDto>
      key={`${record?.id ?? 'new'}-${open}-${me}`}
      open={open}
      onOpenChange={onOpenChange}
      title={record ? `Edit ${record.name}` : 'New company'}
      fields={fields}
      record={record ? { ...record, ownerId: record.owner?.id ?? '' } : null}
      defaults={{ ownerId: me }}
      save={(p) => (record ? api.crm.companies.update(record.id, p) : api.crm.companies.create(p as { name: string }))}
      onSaved={async (r) => {
        await qc.invalidateQueries({ queryKey: ['crm'] });
        onSaved?.(r);
      }}
      submitLabel={record ? 'Save changes' : 'Create company'}
    />
  );
}

export function DealSheet({ open, onOpenChange, record = null, onSaved, defaults = {} }: SheetProps<DealDto> & { defaults?: FormValues }) {
  const qc = useQueryClient();
  const owner = useOwnerField();
  const me = useCrmAccess().me ?? '';
  const contacts = useQuery({ queryKey: ['crm', 'contacts', 'options'], queryFn: () => api.crm.contacts.list({ pageSize: 100, sort: 'name', order: 'asc' }), enabled: open });
  const companies = useQuery({ queryKey: ['crm', 'companies', 'options'], queryFn: () => api.crm.companies.list({ pageSize: 100, sort: 'name', order: 'asc' }), enabled: open });
  const fields: FieldDef[] = [
    { name: 'name', label: 'Deal name', required: true, wide: true },
    { name: 'value', label: 'Value', type: 'number' },
    { name: 'expectedCloseAt', label: 'Expected close', type: 'date' },
    { name: 'contactId', label: 'Contact', type: 'select', optional: true, options: (contacts.data?.data ?? []).map((c) => ({ value: c.id, label: c.name })) },
    { name: 'companyId', label: 'Company', type: 'select', optional: true, options: (companies.data?.data ?? []).map((c) => ({ value: c.id, label: c.name })) },
    { name: 'source', label: 'Source', type: 'select', optional: true, options: sourceOptions },
    ...(owner ? [owner] : []),
    { name: 'tags', label: 'Tags', type: 'tags', wide: true },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ];
  return (
    <EntitySheet<DealDto>
      key={`${record?.id ?? 'new'}-${open}-${me}-${contacts.isSuccess}-${companies.isSuccess}`}
      open={open}
      onOpenChange={onOpenChange}
      title={record ? `Edit ${record.name}` : 'New deal'}
      fields={fields}
      record={record ? { ...record, contactId: record.contact?.id ?? '', companyId: record.company?.id ?? '', ownerId: record.owner?.id ?? '', expectedCloseAt: record.expectedCloseAt?.slice(0, 10) ?? '' } : null}
      defaults={{ value: '0', ownerId: me, ...defaults }}
      save={(p) => {
        const { stageId, pipelineId, ...rest } = { ...p, stageId: defaults.stageId, pipelineId: defaults.pipelineId };
        return record ? api.crm.deals.update(record.id, rest) : api.crm.deals.create({ ...(rest as { name: string }), ...(stageId ? { stageId } : {}), ...(pipelineId ? { pipelineId } : {}) });
      }}
      onSaved={async (r) => {
        await qc.invalidateQueries({ queryKey: ['crm'] });
        onSaved?.(r);
      }}
      submitLabel={record ? 'Save changes' : 'Create deal'}
    />
  );
}
