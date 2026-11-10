import { z } from 'zod';

// ───────────── Enums ─────────────

export const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'CONVERTED', 'LOST'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_SOURCES = ['website', 'facebook', 'instagram', 'whatsapp', 'google_ads', 'meta_ads', 'referral', 'walk_in', 'phone', 'email', 'event', 'import', 'other'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LIFECYCLES = ['LEAD', 'PROSPECT', 'CUSTOMER', 'CHURNED'] as const;
export type Lifecycle = (typeof LIFECYCLES)[number];

export const DEAL_STATUSES = ['OPEN', 'WON', 'LOST'] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

export const STAGE_KINDS = ['OPEN', 'WON', 'LOST'] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

export const ACTIVITY_TYPES = ['CALL', 'EMAIL', 'MEETING', 'WHATSAPP', 'NOTE', 'TASK', 'FOLLOW_UP'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'] as const;

export const CRM_ENTITIES = ['leads', 'contacts', 'companies', 'deals'] as const;
export type CrmEntity = (typeof CRM_ENTITIES)[number];

/** Default pipeline created for every organization on first use. */
export const DEFAULT_PIPELINE_STAGES: Array<{ name: string; probability: number; kind: StageKind }> = [
  { name: 'New Lead', probability: 10, kind: 'OPEN' },
  { name: 'Contacted', probability: 20, kind: 'OPEN' },
  { name: 'Qualified', probability: 40, kind: 'OPEN' },
  { name: 'Proposal', probability: 60, kind: 'OPEN' },
  { name: 'Negotiation', probability: 80, kind: 'OPEN' },
  { name: 'Won', probability: 100, kind: 'WON' },
  { name: 'Lost', probability: 0, kind: 'LOST' },
];

// ───────────── Normalisation ─────────────

/** Country calling code from the organization's currency (our markets), used for local phone numbers. */
export const CALLING_CODE_BY_CURRENCY: Record<string, string> = { INR: '91', AED: '971', SAR: '966', QAR: '974', OMR: '968', KWD: '965', BHD: '973', USD: '1', GBP: '44', EUR: '49' };

/**
 * Normalises a phone number to E.164 ("+919876543210"). Local numbers get the default calling code;
 * a single trunk "0" is dropped (India 098…, UAE 050…). Returns null when it cannot be a phone number.
 */
export function normalizePhone(raw: string | null | undefined, defaultCallingCode = '91'): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let digits = trimmed.replace(/[^\d+]/g, '');
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
  let e164: string;
  if (digits.startsWith('+')) e164 = `+${digits.slice(1).replace(/\+/g, '')}`;
  else if (digits.startsWith('0')) e164 = `+${defaultCallingCode}${digits.replace(/^0+/, '')}`;
  else if (digits.length <= 10) e164 = `+${defaultCallingCode}${digits}`;
  else e164 = `+${digits}`;
  const n = e164.length - 1;
  return n >= 8 && n <= 15 ? e164 : null;
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  const v = raw?.trim().toLowerCase();
  return v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

/** Company names compared without case, punctuation or common legal suffixes. */
export function normalizeCompanyName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\b(private|pvt|limited|ltd|llp|l l p|llc|l l c|plc|opc|fze|fzco|fz llc|inc|corp|corporation|co|company|w l l|wll|est|establishment)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return v || null;
}

/** `wa.me` link for a WhatsApp number (click-to-chat; sending through the API arrives in Phase 14). */
export function whatsappLink(phone: string | null | undefined, text?: string): string | null {
  const e164 = normalizePhone(phone);
  if (!e164) return null;
  return `https://wa.me/${e164.slice(1)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

// ───────────── CSV ─────────────

export const CSV_MAX_BYTES = 2 * 1024 * 1024;
export const CSV_MAX_ROWS = 5000;

export class CsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvError';
  }
}

/** RFC 4180 parser: quoted fields, escaped quotes, CRLF/LF, newlines inside quotes, UTF-8 BOM, comma or semicolon. */
export function parseCsv(input: string, maxRows = CSV_MAX_ROWS): { headers: string[]; rows: string[][] } {
  const text = input.replace(/^\uFEFF/, '');
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === '') inQuotes = true;
    else if (c === delimiter) {
      record.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      record.push(field);
      field = '';
      if (record.some((f) => f.trim() !== '')) records.push(record);
      record = [];
      if (records.length > maxRows + 1) throw new CsvError(`The file has more than ${maxRows.toLocaleString()} rows. Split it into smaller files.`);
    } else field += c;
  }
  if (inQuotes) throw new CsvError('The file has an unclosed quote.');
  record.push(field);
  if (record.some((f) => f.trim() !== '')) records.push(record);
  if (records.length === 0) throw new CsvError('The file is empty.');
  const headers = records[0]!.map((h) => h.trim());
  const rows = records.slice(1);
  if (rows.length > maxRows) throw new CsvError(`The file has more than ${maxRows.toLocaleString()} rows. Split it into smaller files.`);
  return { headers, rows };
}

/** Escapes a cell for CSV export, neutralising spreadsheet formulas (CSV injection). */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.join('; ') : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return `\uFEFF${[headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n')}\r\n`;
}

/** Importable fields per entity, with header aliases used for automatic column mapping. */
export const IMPORT_FIELDS: Record<'leads' | 'contacts' | 'companies', Array<{ field: string; label: string; aliases: string[]; required?: boolean }>> = {
  leads: [
    { field: 'firstName', label: 'First name', aliases: ['first name', 'firstname', 'first', 'given name', 'name', 'full name', 'customer name', 'contact name'], required: true },
    { field: 'lastName', label: 'Last name', aliases: ['last name', 'lastname', 'surname', 'family name'] },
    { field: 'email', label: 'Email', aliases: ['email', 'e-mail', 'email address', 'mail'] },
    { field: 'phone', label: 'Phone', aliases: ['phone', 'mobile', 'phone number', 'contact number', 'mobile number', 'tel'] },
    { field: 'whatsapp', label: 'WhatsApp', aliases: ['whatsapp', 'whatsapp number', 'wa'] },
    { field: 'company', label: 'Company', aliases: ['company', 'company name', 'organisation', 'organization', 'business'] },
    { field: 'jobTitle', label: 'Job title', aliases: ['job title', 'title', 'designation', 'position', 'role'] },
    { field: 'website', label: 'Website', aliases: ['website', 'url', 'site', 'web'] },
    { field: 'industry', label: 'Industry', aliases: ['industry', 'sector', 'category'] },
    { field: 'city', label: 'City', aliases: ['city', 'town', 'location'] },
    { field: 'country', label: 'Country', aliases: ['country'] },
    { field: 'source', label: 'Source', aliases: ['source', 'lead source', 'channel'] },
    { field: 'notes', label: 'Notes', aliases: ['notes', 'note', 'comments', 'remarks', 'description'] },
    { field: 'tags', label: 'Tags', aliases: ['tags', 'labels', 'tag'] },
  ],
  contacts: [
    { field: 'firstName', label: 'First name', aliases: ['first name', 'firstname', 'first', 'given name', 'name', 'full name', 'customer name', 'contact name'], required: true },
    { field: 'lastName', label: 'Last name', aliases: ['last name', 'lastname', 'surname', 'family name'] },
    { field: 'email', label: 'Email', aliases: ['email', 'e-mail', 'email address', 'mail'] },
    { field: 'phone', label: 'Phone', aliases: ['phone', 'mobile', 'phone number', 'contact number', 'mobile number', 'tel'] },
    { field: 'whatsapp', label: 'WhatsApp', aliases: ['whatsapp', 'whatsapp number', 'wa'] },
    { field: 'company', label: 'Company', aliases: ['company', 'company name', 'organisation', 'organization', 'business'] },
    { field: 'jobTitle', label: 'Job title', aliases: ['job title', 'title', 'designation', 'position', 'role'] },
    { field: 'lifecycle', label: 'Lifecycle', aliases: ['lifecycle', 'stage', 'type'] },
    { field: 'tags', label: 'Tags', aliases: ['tags', 'labels', 'tag'] },
  ],
  companies: [
    { field: 'name', label: 'Name', aliases: ['name', 'company', 'company name', 'organisation', 'organization', 'business'], required: true },
    { field: 'website', label: 'Website', aliases: ['website', 'url', 'site', 'domain', 'web'] },
    { field: 'industry', label: 'Industry', aliases: ['industry', 'sector', 'category'] },
    { field: 'phone', label: 'Phone', aliases: ['phone', 'telephone', 'contact number', 'tel'] },
    { field: 'email', label: 'Email', aliases: ['email', 'e-mail', 'mail'] },
    { field: 'city', label: 'City', aliases: ['city', 'town', 'location'] },
    { field: 'country', label: 'Country', aliases: ['country'] },
    { field: 'size', label: 'Size', aliases: ['size', 'employees', 'company size', 'headcount'] },
    { field: 'tags', label: 'Tags', aliases: ['tags', 'labels', 'tag'] },
  ],
};

/** Maps CSV headers to fields by alias (case/punctuation-insensitive); each field is used at most once. */
export function autoMapColumns(entity: keyof typeof IMPORT_FIELDS, headers: string[]): Record<string, string | null> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const used = new Set<string>();
  const mapping: Record<string, string | null> = {};
  for (const h of headers) {
    const n = norm(h);
    const match = IMPORT_FIELDS[entity].find((f) => !used.has(f.field) && (norm(f.field) === n || f.aliases.some((a) => norm(a) === n)));
    mapping[h] = match ? match.field : null;
    if (match) used.add(match.field);
  }
  return mapping;
}

// ───────────── Shared field schemas ─────────────

const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v));
const optEmail = z
  .union([z.literal(''), z.email().max(254)])
  .nullable()
  .optional()
  .transform((v) => (v ? v.trim() : null));
const tags = z.array(z.string().trim().min(1).max(40)).max(20).default([]);
const customFields = z
  .record(z.string().trim().min(1).max(60), z.union([z.string().max(1000), z.number(), z.boolean(), z.null()]))
  .refine((o) => Object.keys(o).length <= 50, 'At most 50 custom fields')
  .default({});
const ownerId = z.string().min(1).max(64).nullable().optional();
const uuid = z.uuid();

const personFields = {
  firstName: z.string().trim().min(1, 'First name is required').max(80),
  lastName: opt(80),
  email: optEmail,
  phone: opt(40),
  whatsapp: opt(40),
  jobTitle: opt(120),
  tags,
  customFields,
  ownerId,
};

// ───────────── Leads ─────────────

export const createLeadSchema = z
  .object({
    ...personFields,
    company: opt(160),
    website: opt(200),
    industry: opt(80),
    city: opt(80),
    country: opt(80),
    status: z.enum(LEAD_STATUSES).default('NEW'),
    source: z.enum(LEAD_SOURCES).default('other'),
    sourceDetail: opt(200),
    notes: opt(4000),
    /** Create even if a lead/contact with the same email or phone exists. */
    allowDuplicate: z.boolean().default(false),
  })
  .strict();
export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export const updateLeadSchema = createLeadSchema.omit({ allowDuplicate: true }).partial().strict();
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

const listBase = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(100).optional(),
  ownerId: z.string().max(64).optional(),
  tag: z.string().trim().max(40).optional(),
  sort: z.enum(['createdAt', 'updatedAt', 'name', 'lastContactedAt', 'nextFollowUpAt', 'value', 'expectedCloseAt']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
};

export const listLeadsSchema = z.object({ ...listBase, status: z.enum(LEAD_STATUSES).optional(), source: z.enum(LEAD_SOURCES).optional() });
export type ListLeadsInput = z.infer<typeof listLeadsSchema>;

export const convertLeadSchema = z
  .object({
    createCompany: z.boolean().default(true),
    createDeal: z.boolean().default(true),
    dealName: z.string().trim().min(1).max(160).optional(),
    dealValue: z.number().min(0).max(1e12).optional(),
    pipelineId: uuid.optional(),
  })
  .strict();
export type ConvertLeadInput = z.infer<typeof convertLeadSchema>;

export const bulkLeadsSchema = z
  .object({
    ids: z.array(uuid).min(1).max(500),
    action: z.enum(['assign', 'status', 'tag', 'delete']),
    ownerId: z.string().min(1).max(64).optional(),
    status: z.enum(LEAD_STATUSES).optional(),
    tag: z.string().trim().min(1).max(40).optional(),
  })
  .strict()
  .refine((v) => (v.action === 'assign' ? !!v.ownerId : v.action === 'status' ? !!v.status : v.action === 'tag' ? !!v.tag : true), { message: 'Missing value for this action' });
export type BulkLeadsInput = z.infer<typeof bulkLeadsSchema>;

// ───────────── Contacts & companies ─────────────

export const createContactSchema = z
  .object({ ...personFields, companyId: uuid.nullable().optional(), lifecycle: z.enum(LIFECYCLES).default('PROSPECT'), source: z.enum(LEAD_SOURCES).default('other'), notes: opt(4000), allowDuplicate: z.boolean().default(false) })
  .strict();
export type CreateContactInput = z.infer<typeof createContactSchema>;
export const updateContactSchema = createContactSchema.omit({ allowDuplicate: true }).partial().strict();
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
export const listContactsSchema = z.object({ ...listBase, lifecycle: z.enum(LIFECYCLES).optional(), companyId: uuid.optional() });
export type ListContactsInput = z.infer<typeof listContactsSchema>;

export const createCompanySchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(160),
    website: opt(200),
    industry: opt(80),
    size: z.enum(COMPANY_SIZES).nullable().optional(),
    phone: opt(40),
    email: optEmail,
    address: opt(300),
    city: opt(80),
    country: opt(80),
    tags,
    customFields,
    ownerId,
  })
  .strict();
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export const updateCompanySchema = createCompanySchema.partial().strict();
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
export const listCompaniesSchema = z.object({ ...listBase, industry: z.string().trim().max(80).optional() });
export type ListCompaniesInput = z.infer<typeof listCompaniesSchema>;

// ───────────── Pipelines & deals ─────────────

export const createPipelineSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    stages: z
      .array(z.object({ name: z.string().trim().min(1).max(60), probability: z.number().int().min(0).max(100), kind: z.enum(STAGE_KINDS).default('OPEN') }).strict())
      .min(2)
      .max(20)
      .optional(),
  })
  .strict();
export type CreatePipelineInput = z.infer<typeof createPipelineSchema>;
export const updatePipelineSchema = z.object({ name: z.string().trim().min(1).max(80).optional(), isDefault: z.literal(true).optional() }).strict();
export const createStageSchema = z.object({ name: z.string().trim().min(1).max(60), probability: z.number().int().min(0).max(100), kind: z.enum(STAGE_KINDS).default('OPEN') }).strict();
export const updateStageSchema = createStageSchema.partial().strict();
export const reorderStagesSchema = z.object({ stageIds: z.array(uuid).min(1).max(20) }).strict();
export const deleteStageSchema = z.object({ moveDealsTo: uuid.optional() }).strict();

export const createDealSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(160),
    value: z.number().min(0).max(1e12).default(0),
    currency: z.string().length(3).toUpperCase().optional(),
    pipelineId: uuid.optional(),
    stageId: uuid.optional(),
    expectedCloseAt: z.iso.datetime({ offset: true }).or(z.iso.date()).nullable().optional(),
    probability: z.number().int().min(0).max(100).optional(),
    source: z.enum(LEAD_SOURCES).optional(),
    contactId: uuid.nullable().optional(),
    companyId: uuid.nullable().optional(),
    tags,
    notes: opt(4000),
    ownerId,
  })
  .strict();
export type CreateDealInput = z.infer<typeof createDealSchema>;
export const updateDealSchema = createDealSchema.omit({ pipelineId: true, stageId: true }).partial().strict();
export type UpdateDealInput = z.infer<typeof updateDealSchema>;
export const listDealsSchema = z.object({ ...listBase, status: z.enum(DEAL_STATUSES).optional(), pipelineId: uuid.optional(), stageId: uuid.optional(), contactId: uuid.optional(), companyId: uuid.optional() });
export type ListDealsInput = z.infer<typeof listDealsSchema>;
export const moveDealSchema = z
  .object({ stageId: uuid, beforeId: uuid.nullable().optional(), lostReason: z.string().trim().min(2).max(300).optional() })
  .strict();
export type MoveDealInput = z.infer<typeof moveDealSchema>;
export const boardQuerySchema = z.object({ ownerId: z.string().max(64).optional(), q: z.string().trim().max(100).optional() });

// ───────────── Activities ─────────────

export const createActivitySchema = z
  .object({
    type: z.enum(ACTIVITY_TYPES),
    subject: z.string().trim().min(1, 'Subject is required').max(200),
    body: opt(5000),
    dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
    completed: z.boolean().optional(),
    priority: z.enum(PRIORITIES).default('MEDIUM'),
    outcome: opt(200),
    leadId: uuid.nullable().optional(),
    contactId: uuid.nullable().optional(),
    companyId: uuid.nullable().optional(),
    dealId: uuid.nullable().optional(),
    ownerId,
  })
  .strict()
  .refine((v) => !!(v.leadId || v.contactId || v.companyId || v.dealId), { message: 'Link the activity to a lead, contact, company or deal', path: ['leadId'] })
  .refine((v) => !['TASK', 'FOLLOW_UP'].includes(v.type) || !!v.dueAt, { message: 'Tasks and follow-ups need a due date', path: ['dueAt'] });
export type CreateActivityInput = z.infer<typeof createActivitySchema>;
/** Request body shape (before defaults/transforms). */
export type CreateActivityRequest = z.input<typeof createActivitySchema>;
export const updateActivitySchema = z
  .object({ subject: z.string().trim().min(1).max(200).optional(), body: opt(5000), dueAt: z.iso.datetime({ offset: true }).nullable().optional(), completed: z.boolean().optional(), priority: z.enum(PRIORITIES).optional(), outcome: opt(200), ownerId })
  .strict();
export type UpdateActivityInput = z.infer<typeof updateActivitySchema>;
export type UpdateActivityRequest = z.input<typeof updateActivitySchema>;
export const listActivitiesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  type: z.enum(ACTIVITY_TYPES).optional(),
  ownerId: z.string().max(64).optional(),
  status: z.enum(['open', 'completed']).optional(),
  leadId: uuid.optional(),
  contactId: uuid.optional(),
  companyId: uuid.optional(),
  dealId: uuid.optional(),
  q: z.string().trim().max(100).optional(),
});
export type ListActivitiesInput = z.infer<typeof listActivitiesSchema>;
export const followUpsQuerySchema = z.object({ range: z.enum(['overdue', 'today', 'week', 'all']).default('all'), owner: z.enum(['me', 'all']).default('all'), tz: z.string().max(60).optional() });
export type FollowUpsQuery = z.infer<typeof followUpsQuerySchema>;

// ───────────── Import ─────────────

export const importPreviewSchema = z.object({ fileId: uuid, entity: z.enum(['leads', 'contacts', 'companies']) }).strict();
export const importSchema = z
  .object({
    fileId: uuid,
    entity: z.enum(['leads', 'contacts', 'companies']),
    /** CSV header → field (null = ignore). */
    mapping: z.record(z.string().max(200), z.string().max(40).nullable()),
    dedupe: z.enum(['skip', 'update', 'create']).default('skip'),
    defaultSource: z.enum(LEAD_SOURCES).default('import'),
    tag: z.string().trim().max(40).optional(),
  })
  .strict();
export type ImportInput = z.infer<typeof importSchema>;

// ───────────── DTOs ─────────────

export interface OwnerRef {
  id: string;
  name: string;
}

interface PersonDto {
  id: string;
  firstName: string;
  lastName: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  jobTitle: string | null;
  tags: string[];
  customFields: Record<string, string | number | boolean | null>;
  owner: OwnerRef | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadDto extends PersonDto {
  company: string | null;
  website: string | null;
  industry: string | null;
  city: string | null;
  country: string | null;
  status: LeadStatus;
  source: LeadSource;
  sourceDetail: string | null;
  notes: string | null;
  score: number | null;
  lastContactedAt: string | null;
  nextFollowUpAt: string | null;
  convertedContactId: string | null;
  convertedDealId: string | null;
  convertedAt: string | null;
}

export interface ContactDto extends PersonDto {
  companyId: string | null;
  companyName: string | null;
  lifecycle: Lifecycle;
  source: LeadSource;
  notes: string | null;
  lastContactedAt: string | null;
  nextFollowUpAt: string | null;
  /** Sum of WON deal values (in the organization currency). */
  wonValue: number;
}

export interface CompanyDto {
  id: string;
  name: string;
  website: string | null;
  industry: string | null;
  size: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  tags: string[];
  customFields: Record<string, string | number | boolean | null>;
  owner: OwnerRef | null;
  contactCount: number;
  dealCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface StageDto {
  id: string;
  name: string;
  order: number;
  probability: number;
  kind: StageKind;
}

export interface PipelineDto {
  id: string;
  name: string;
  isDefault: boolean;
  stages: StageDto[];
}

export interface DealDto {
  id: string;
  name: string;
  value: number;
  currency: string;
  pipelineId: string;
  stageId: string;
  stageName: string;
  position: number;
  probability: number;
  status: DealStatus;
  lostReason: string | null;
  expectedCloseAt: string | null;
  closedAt: string | null;
  source: string | null;
  contact: { id: string; name: string } | null;
  company: { id: string; name: string } | null;
  leadId: string | null;
  tags: string[];
  notes: string | null;
  owner: OwnerRef | null;
  createdAt: string;
  updatedAt: string;
}

export interface BoardColumn {
  stage: StageDto;
  deals: DealDto[];
  count: number;
  total: number;
}

export interface BoardDto {
  pipeline: PipelineDto;
  columns: BoardColumn[];
  currency: string;
}

export interface ActivityDto {
  id: string;
  type: ActivityType;
  subject: string;
  body: string | null;
  dueAt: string | null;
  completedAt: string | null;
  priority: Priority;
  outcome: string | null;
  owner: OwnerRef | null;
  createdBy: OwnerRef | null;
  lead: { id: string; name: string } | null;
  contact: { id: string; name: string } | null;
  company: { id: string; name: string } | null;
  deal: { id: string; name: string } | null;
  createdAt: string;
}

export interface DuplicateMatch {
  type: 'lead' | 'contact';
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  matchedOn: Array<'email' | 'phone'>;
}

export interface CrmSummary {
  leadsByStatus: Record<LeadStatus, number>;
  contacts: number;
  customers: number;
  companies: number;
  openDeals: number;
  openPipelineValue: number;
  wonThisMonth: { count: number; value: number };
  followUps: { overdue: number; today: number };
  currency: string;
}

export interface ImportPreview {
  headers: string[];
  sample: string[][];
  rowCount: number;
  mapping: Record<string, string | null>;
  fields: Array<{ field: string; label: string; required: boolean }>;
}

export interface ImportJobStatus {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  entity: string;
  total: number;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
  error: string | null;
}

export interface TimelineDto {
  activities: ActivityDto[];
  deals: DealDto[];
}
