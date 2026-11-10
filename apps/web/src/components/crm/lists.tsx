'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Download, Plus, Search, Upload, UserRound, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { PaginationMeta } from '@zatma/types';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  Input,
  Label,
  Select,
  Skeleton,
} from '@zatma/ui';
import { DEAL_STATUSES, LEAD_SOURCES, LEAD_STATUSES, LIFECYCLES, type CompanyDto, type ContactDto, type DealDto, type LeadDto } from '@zatma/validation';
import { api } from '@/lib/api';
import { formatDate, formatMoney, LEAD_STATUS_LABELS, LEAD_STATUS_TONES, LIFECYCLE_LABELS, queryString, relativeTime, SOURCE_LABELS, toQuery } from '@/lib/crm';
import { CompanySheet, ContactSheet, DealSheet, LeadSheet } from './forms';
import { ImportDialog } from './import-dialog';
import { DealPanel } from './pipeline';
import { ScoreBadge } from './scoring';
import { describeError, OwnerChip, Tags, useCrmAccess, useDebounced, useMembers } from './shared';

// ───────────── Table ─────────────

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

export function DataTable<T extends { id: string }>({
  caption,
  columns,
  rows,
  selected,
  onSelect,
  rowLabel,
}: {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  selected?: Set<string>;
  onSelect?: (ids: Set<string>) => void;
  rowLabel: (row: T) => string;
}) {
  const allSelected = !!selected && rows.length > 0 && rows.every((r) => selected.has(r.id));
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card">
      <table className="w-full min-w-[720px] text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            {onSelect && (
              <th scope="col" className="w-10 px-3 py-2.5">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--color-primary)]"
                  aria-label="Select all on this page"
                  checked={allSelected}
                  onChange={(e) => onSelect(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                />
              </th>
            )}
            {columns.map((c) => (
              <th key={c.key} scope="col" className={`px-3 py-2.5 font-medium ${c.className ?? ''}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/40">
              {onSelect && (
                <td className="px-3 py-2.5">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--color-primary)]"
                    aria-label={`Select ${rowLabel(r)}`}
                    checked={selected?.has(r.id) ?? false}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(r.id);
                      else next.delete(r.id);
                      onSelect(next);
                    }}
                  />
                </td>
              )}
              {columns.map((c) => (
                <td key={c.key} className={`px-3 py-2.5 align-middle ${c.className ?? ''}`}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({ meta, page, onPage }: { meta: PaginationMeta; page: number; onPage: (p: number) => void }) {
  if (meta.totalPages <= 1) return <p className="text-sm text-muted-foreground">{meta.total.toLocaleString()} total</p>;
  return (
    <nav className="flex items-center justify-between gap-2" aria-label="Pages">
      <p className="text-sm text-muted-foreground">{meta.total.toLocaleString()} total</p>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <span className="text-sm text-muted-foreground">
          Page {page} of {meta.totalPages}
        </span>
        <Button size="sm" variant="outline" disabled={page >= meta.totalPages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </nav>
  );
}

function SearchBox({ id, value, onChange, label }: { id: string; value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="relative min-w-56 flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Label htmlFor={id} className="sr-only">
        {label}
      </Label>
      <Input id={id} type="search" placeholder={label} className="pl-9" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function FilterSelect({ id, label, value, onChange, options }: { id: string; label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <div className="w-44">
      <Label htmlFor={id} className="sr-only">
        {label}
      </Label>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{label}: all</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

function OwnerFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const access = useCrmAccess();
  const members = useMembers(access.seesAll && access.loaded);
  if (!access.seesAll) return null;
  return <FilterSelect id="filter-owner" label="Owner" value={value} onChange={onChange} options={(members.data ?? []).map((m) => ({ value: m.userId, label: m.name }))} />;
}

function ListState({ query, children }: { query: { isPending: boolean; isError: boolean; refetch: () => unknown }; children: ReactNode }) {
  if (query.isPending) return <Skeleton className="h-72" />;
  if (query.isError) return <ErrorState description="Couldn't load records." onRetry={() => void query.refetch()} />;
  return <>{children}</>;
}

const personLink = (href: string, name: string, sub?: string | null) => (
  <div className="min-w-0">
    <Link href={href} className="font-medium text-foreground underline-offset-2 hover:text-primary hover:underline">
      {name}
    </Link>
    {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
  </div>
);

// ───────────── Leads ─────────────

export function LeadsList() {
  const qc = useQueryClient();
  const access = useCrmAccess();
  const members = useMembers(access.canAssign);
  const [q, setQ] = useState('');
  const search = useDebounced(q.trim());
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [grade, setGrade] = useState('');
  const [sort, setSort] = useState('createdAt');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const filters = { q: search, status, source, ownerId, grade, sort };
  const list = useQuery({
    queryKey: ['crm', 'leads', filters, page],
    queryFn: () => api.crm.leads.list(toQuery({ ...filters, order: sort === 'name' || sort === 'nextFollowUpAt' ? 'asc' : 'desc', page, pageSize: 25 })),
    placeholderData: keepPreviousData,
  });
  const bulk = useMutation({
    mutationFn: (input: { action: 'assign' | 'status' | 'delete'; ownerId?: string; status?: (typeof LEAD_STATUSES)[number] }) => api.crm.leads.bulk({ ids: [...selected], ...input }),
    onSuccess: async (r) => {
      toast.success(`${r.updated} lead${r.updated === 1 ? '' : 's'} updated`);
      setSelected(new Set());
      await qc.invalidateQueries({ queryKey: ['crm'] });
    },
    onError: (e) => toast.error(describeError(e)),
  });
  const set = (fn: (v: string) => void) => (v: string) => {
    fn(v);
    setPage(1);
  };

  const columns: Column<LeadDto>[] = [
    { key: 'name', header: 'Name', cell: (l) => personLink(`/crm/leads/${l.id}`, l.name, l.company) },
    { key: 'contact', header: 'Phone / email', cell: (l) => <span className="text-muted-foreground">{l.phone ?? l.email ?? '—'}</span> },
    { key: 'score', header: 'Score', cell: (l) => <ScoreBadge score={l.score} grade={l.scoreGrade} reason={l.scoreReason} /> },
    { key: 'status', header: 'Status', cell: (l) => <Badge tone={LEAD_STATUS_TONES[l.status]}>{LEAD_STATUS_LABELS[l.status]}</Badge> },
    { key: 'source', header: 'Source', cell: (l) => SOURCE_LABELS[l.source] },
    { key: 'owner', header: 'Owner', cell: (l) => <OwnerChip owner={l.owner} /> },
    { key: 'next', header: 'Next follow-up', cell: (l) => (l.nextFollowUpAt ? relativeTime(l.nextFollowUpAt) : <span className="text-muted-foreground">—</span>) },
    { key: 'tags', header: 'Tags', cell: (l) => <Tags tags={l.tags} /> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox id="lead-search" label="Search leads" value={q} onChange={set(setQ)} />
        <FilterSelect id="filter-status" label="Status" value={status} onChange={set(setStatus)} options={LEAD_STATUSES.map((s) => ({ value: s, label: LEAD_STATUS_LABELS[s] }))} />
        <FilterSelect id="filter-source" label="Source" value={source} onChange={set(setSource)} options={LEAD_SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s] }))} />
        <FilterSelect id="filter-grade" label="Grade" value={grade} onChange={set(setGrade)} options={[{ value: 'HOT', label: 'Hot' }, { value: 'WARM', label: 'Warm' }, { value: 'COLD', label: 'Cold' }]} />
        <OwnerFilter value={ownerId} onChange={set(setOwnerId)} />
        <div className="w-44">
          <Label htmlFor="lead-sort" className="sr-only">
            Sort
          </Label>
          <Select id="lead-sort" value={sort} onChange={(e) => set(setSort)(e.target.value)}>
            <option value="createdAt">Newest first</option>
            <option value="score">Highest score</option>
            <option value="nextFollowUpAt">Next follow-up</option>
            <option value="name">Name</option>
          </Select>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" asChild>
            <a href={`/api/v1/crm/leads/export.csv${queryString(filters)}`} download>
              <Download aria-hidden="true" /> Export
            </a>
          </Button>
          {access.canWrite && (
            <>
              <Button variant="outline" onClick={() => setImporting(true)}>
                <Upload aria-hidden="true" /> Import CSV
              </Button>
              <Button onClick={() => setCreating(true)}>
                <Plus aria-hidden="true" /> New lead
              </Button>
            </>
          )}
        </div>
      </div>

      {selected.size > 0 && access.canWrite && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm" role="region" aria-label="Bulk actions">
          <span className="font-medium">{selected.size} selected</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                Set status
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {LEAD_STATUSES.filter((s) => s !== 'CONVERTED').map((s) => (
                <DropdownMenuItem key={s} onSelect={() => bulk.mutate({ action: 'status', status: s })}>
                  {LEAD_STATUS_LABELS[s]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {access.canAssign && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline">
                  Assign
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Assign to</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {(members.data ?? []).map((m) => (
                  <DropdownMenuItem key={m.userId} onSelect={() => bulk.mutate({ action: 'assign', ownerId: m.userId })}>
                    {m.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {access.canDelete && (
            <Button size="sm" variant="outline" className="text-destructive" onClick={() => bulk.mutate({ action: 'delete' })}>
              Delete
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <ListState query={list}>
        {list.data && list.data.data.length === 0 ? (
          <EmptyState
            icon={<UserRound />}
            title={search || status || source || ownerId || grade ? 'No leads match these filters' : 'No leads yet'}
            description="Add leads by hand, import a CSV, or capture them from forms and ads in later phases."
            action={
              access.canWrite ? (
                <Button onClick={() => setCreating(true)}>
                  <Plus aria-hidden="true" /> New lead
                </Button>
              ) : undefined
            }
          />
        ) : list.data ? (
          <>
            <DataTable caption="Leads" columns={columns} rows={list.data.data} selected={access.canWrite ? selected : undefined} onSelect={access.canWrite ? setSelected : undefined} rowLabel={(l) => l.name} />
            <Pager meta={list.data.meta} page={page} onPage={setPage} />
          </>
        ) : null}
      </ListState>

      <LeadSheet open={creating} onOpenChange={setCreating} />
      <ImportDialog open={importing} onOpenChange={setImporting} entity="leads" />
    </div>
  );
}

// ───────────── Contacts & customers ─────────────

export function ContactsList({ customers = false }: { customers?: boolean }) {
  const access = useCrmAccess();
  const [q, setQ] = useState('');
  const search = useDebounced(q.trim());
  const [lifecycle, setLifecycle] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const filters = { q: search, lifecycle: customers ? undefined : lifecycle, ownerId };
  const list = useQuery({
    queryKey: ['crm', customers ? 'customers' : 'contacts', filters, page],
    queryFn: () => (customers ? api.crm.contacts.customers : api.crm.contacts.list)(toQuery({ ...filters, page, pageSize: 25 })),
    placeholderData: keepPreviousData,
  });
  const set = (fn: (v: string) => void) => (v: string) => {
    fn(v);
    setPage(1);
  };
  const columns: Column<ContactDto>[] = [
    { key: 'name', header: 'Name', cell: (c) => personLink(`/crm/contacts/${c.id}`, c.name, c.jobTitle) },
    { key: 'company', header: 'Company', cell: (c) => (c.companyId ? <Link className="hover:underline" href={`/crm/companies/${c.companyId}`}>{c.companyName}</Link> : <span className="text-muted-foreground">—</span>) },
    { key: 'contact', header: 'Phone / email', cell: (c) => <span className="text-muted-foreground">{c.phone ?? c.email ?? '—'}</span> },
    customers
      ? { key: 'won', header: 'Won value', cell: (c) => formatMoney(c.wonValue, access.currency), className: 'text-right tabular-nums' }
      : { key: 'lifecycle', header: 'Lifecycle', cell: (c) => <Badge tone={c.lifecycle === 'CUSTOMER' ? 'success' : 'neutral'}>{LIFECYCLE_LABELS[c.lifecycle]}</Badge> },
    { key: 'owner', header: 'Owner', cell: (c) => <OwnerChip owner={c.owner} /> },
    { key: 'last', header: 'Last contacted', cell: (c) => (c.lastContactedAt ? relativeTime(c.lastContactedAt) : <span className="text-muted-foreground">—</span>) },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox id="contact-search" label={customers ? 'Search customers' : 'Search contacts'} value={q} onChange={set(setQ)} />
        {!customers && <FilterSelect id="filter-lifecycle" label="Lifecycle" value={lifecycle} onChange={set(setLifecycle)} options={LIFECYCLES.map((l) => ({ value: l, label: LIFECYCLE_LABELS[l] }))} />}
        <OwnerFilter value={ownerId} onChange={set(setOwnerId)} />
        <div className="ml-auto flex gap-2">
          <Button variant="outline" asChild>
            <a href={`/api/v1/crm/contacts/export.csv${queryString({ ...filters, lifecycle: customers ? 'CUSTOMER' : filters.lifecycle })}`} download>
              <Download aria-hidden="true" /> Export
            </a>
          </Button>
          {access.canWrite && !customers && (
            <>
              <Button variant="outline" onClick={() => setImporting(true)}>
                <Upload aria-hidden="true" /> Import CSV
              </Button>
              <Button onClick={() => setCreating(true)}>
                <Plus aria-hidden="true" /> New contact
              </Button>
            </>
          )}
        </div>
      </div>
      <ListState query={list}>
        {list.data && list.data.data.length === 0 ? (
          <EmptyState
            icon={<Users />}
            title={customers ? 'No customers yet' : search || lifecycle || ownerId ? 'No contacts match these filters' : 'No contacts yet'}
            description={customers ? 'Contacts become customers when one of their deals is won.' : 'Add contacts, import a CSV, or convert qualified leads.'}
          />
        ) : list.data ? (
          <>
            <DataTable caption={customers ? 'Customers' : 'Contacts'} columns={columns} rows={list.data.data} rowLabel={(c) => c.name} />
            <Pager meta={list.data.meta} page={page} onPage={setPage} />
          </>
        ) : null}
      </ListState>
      <ContactSheet open={creating} onOpenChange={setCreating} />
      <ImportDialog open={importing} onOpenChange={setImporting} entity="contacts" />
    </div>
  );
}

// ───────────── Companies ─────────────

export function CompaniesList() {
  const access = useCrmAccess();
  const [q, setQ] = useState('');
  const search = useDebounced(q.trim());
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const list = useQuery({
    queryKey: ['crm', 'companies', search, page],
    queryFn: () => api.crm.companies.list(toQuery({ q: search, page, pageSize: 25 })),
    placeholderData: keepPreviousData,
  });
  const columns: Column<CompanyDto>[] = [
    { key: 'name', header: 'Name', cell: (c) => personLink(`/crm/companies/${c.id}`, c.name, c.website) },
    { key: 'industry', header: 'Industry', cell: (c) => c.industry ?? <span className="text-muted-foreground">—</span> },
    { key: 'location', header: 'Location', cell: (c) => [c.city, c.country].filter(Boolean).join(', ') || <span className="text-muted-foreground">—</span> },
    { key: 'contacts', header: 'Contacts', cell: (c) => c.contactCount, className: 'text-right tabular-nums' },
    { key: 'deals', header: 'Deals', cell: (c) => c.dealCount, className: 'text-right tabular-nums' },
    { key: 'owner', header: 'Owner', cell: (c) => <OwnerChip owner={c.owner} /> },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox
          id="company-search"
          label="Search companies"
          value={q}
          onChange={(v) => {
            setQ(v);
            setPage(1);
          }}
        />
        <div className="ml-auto flex gap-2">
          <Button variant="outline" asChild>
            <a href={`/api/v1/crm/companies/export.csv${queryString({ q: search })}`} download>
              <Download aria-hidden="true" /> Export
            </a>
          </Button>
          {access.canWrite && (
            <>
              <Button variant="outline" onClick={() => setImporting(true)}>
                <Upload aria-hidden="true" /> Import CSV
              </Button>
              <Button onClick={() => setCreating(true)}>
                <Plus aria-hidden="true" /> New company
              </Button>
            </>
          )}
        </div>
      </div>
      <ListState query={list}>
        {list.data && list.data.data.length === 0 ? (
          <EmptyState icon={<Building2 />} title={search ? 'No companies match your search' : 'No companies yet'} description="Companies are created automatically when you convert a lead, or you can add them here." />
        ) : list.data ? (
          <>
            <DataTable caption="Companies" columns={columns} rows={list.data.data} rowLabel={(c) => c.name} />
            <Pager meta={list.data.meta} page={page} onPage={setPage} />
          </>
        ) : null}
      </ListState>
      <CompanySheet open={creating} onOpenChange={setCreating} />
      <ImportDialog open={importing} onOpenChange={setImporting} entity="companies" />
    </div>
  );
}

// ───────────── Deals ─────────────

export function DealsList() {
  const access = useCrmAccess();
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState('');
  const search = useDebounced(q.trim());
  const [status, setStatus] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const openId = params.get('open');
  const filters = { q: search, status, ownerId };
  const list = useQuery({
    queryKey: ['crm', 'deals', filters, page],
    queryFn: () => api.crm.deals.list(toQuery({ ...filters, page, pageSize: 25 })),
    placeholderData: keepPreviousData,
  });
  const set = (fn: (v: string) => void) => (v: string) => {
    fn(v);
    setPage(1);
  };
  const columns: Column<DealDto>[] = [
    { key: 'name', header: 'Deal', cell: (d) => personLink(`/crm/deals?open=${d.id}`, d.name, d.company?.name ?? d.contact?.name) },
    { key: 'value', header: 'Value', cell: (d) => formatMoney(d.value, d.currency), className: 'text-right tabular-nums' },
    { key: 'stage', header: 'Stage', cell: (d) => d.stageName },
    { key: 'status', header: 'Status', cell: (d) => <Badge tone={d.status === 'WON' ? 'success' : d.status === 'LOST' ? 'danger' : 'primary'}>{d.status[0] + d.status.slice(1).toLowerCase()}</Badge> },
    { key: 'close', header: 'Expected close', cell: (d) => formatDate(d.expectedCloseAt) },
    { key: 'owner', header: 'Owner', cell: (d) => <OwnerChip owner={d.owner} /> },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox id="deal-search" label="Search deals" value={q} onChange={set(setQ)} />
        <FilterSelect id="filter-deal-status" label="Status" value={status} onChange={set(setStatus)} options={DEAL_STATUSES.map((s) => ({ value: s, label: s[0] + s.slice(1).toLowerCase() }))} />
        <OwnerFilter value={ownerId} onChange={set(setOwnerId)} />
        <div className="ml-auto flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/crm/pipeline">Pipeline board</Link>
          </Button>
          <Button variant="outline" asChild>
            <a href={`/api/v1/crm/deals/export.csv${queryString(filters)}`} download>
              <Download aria-hidden="true" /> Export
            </a>
          </Button>
          {access.canWrite && (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" /> New deal
            </Button>
          )}
        </div>
      </div>
      <ListState query={list}>
        {list.data && list.data.data.length === 0 ? (
          <EmptyState title={search || status || ownerId ? 'No deals match these filters' : 'No deals yet'} description="Create a deal, or convert a lead with “Create deal” selected." />
        ) : list.data ? (
          <>
            <DataTable caption="Deals" columns={columns} rows={list.data.data} rowLabel={(d) => d.name} />
            <Pager meta={list.data.meta} page={page} onPage={setPage} />
          </>
        ) : null}
      </ListState>
      <DealSheet open={creating} onOpenChange={setCreating} />
      <DealPanel dealId={openId} onClose={() => router.replace('/crm/deals')} />
    </div>
  );
}
