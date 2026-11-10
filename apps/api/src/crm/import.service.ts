import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { fromAuthRole, permissionsForRole } from '@zatma/types';
import {
  autoMapColumns,
  createCompanySchema,
  createContactSchema,
  createLeadSchema,
  CSV_MAX_BYTES,
  CsvError,
  IMPORT_FIELDS,
  LEAD_SOURCES,
  LIFECYCLES,
  normalizeCompanyName,
  parseCsv,
  type ImportInput,
  type ImportJobStatus,
  type ImportPreview,
} from '@zatma/validation';
import { UNLIMITED, UsageService } from '../billing/usage.service.js';
import { AppException, notFound } from '../common/errors.js';
import { TenantContext } from '../common/tenant-context.js';
import type { CrmImport, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ObjectTooLargeError } from '../storage/object-storage.js';
import { StorageService } from '../storage/storage.service.js';
import { CrmContext } from './crm-common.js';
import { LeadsService } from './leads.service.js';
import { CompaniesService, ContactsService } from './records.service.js';

export const CRM_IMPORT_QUEUE = 'crm-import';
interface ImportJobData {
  importId: string;
  organizationId: string;
  userId: string;
}

type Entity = ImportInput['entity'];
type Row = Record<string, string>;
const MAX_ERRORS = 200;

/** Builds a record from a CSV row using the column mapping (unmapped and blank cells are ignored). */
export function rowToRecord(headers: string[], cells: string[], mapping: Record<string, string | null>): Row {
  const out: Row = {};
  headers.forEach((h, i) => {
    const field = mapping[h];
    const value = (cells[i] ?? '').trim();
    if (field && value && out[field] === undefined) out[field] = value;
  });
  return out;
}

const splitTags = (v?: string) =>
  v
    ? [
        ...new Set(
          v
            .split(/[;,|]/)
            .map((t) => t.trim())
            .filter(Boolean)
            .map((t) => t.slice(0, 40)),
        ),
      ].slice(0, 20)
    : [];

/** Source column → a known source, keeping unknown labels as detail. */
export function mapSource(v: string | undefined, fallback: string): { source: string; sourceDetail?: string } {
  if (!v) return { source: fallback };
  const key = v.toLowerCase().replace(/[\s-]+/g, '_');
  return (LEAD_SOURCES as readonly string[]).includes(key) ? { source: key } : { source: 'other', sourceDetail: v.slice(0, 200) };
}

@Injectable()
export class CrmImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly usage: UsageService,
    @InjectQueue(CRM_IMPORT_QUEUE) private readonly queue: Queue<ImportJobData>,
  ) {}

  private async readCsv(fileId: string) {
    let body: Buffer;
    let fileName: string;
    try {
      const res = await this.storage.readUploaded(fileId, CSV_MAX_BYTES);
      body = res.body;
      fileName = res.file.fileName;
      if (!(res.file.mimeType === 'text/csv' || fileName.toLowerCase().endsWith('.csv'))) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'INVALID_FILE', 'Upload a .csv file');
    } catch (err) {
      if (err instanceof ObjectTooLargeError) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'FILE_TOO_LARGE', 'CSV files can be up to 2 MB');
      throw err;
    }
    try {
      return parseCsv(body.toString('utf8'));
    } catch (err) {
      if (err instanceof CsvError) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'INVALID_CSV', err.message);
      throw err;
    }
  }

  async preview(fileId: string, entity: Entity): Promise<ImportPreview> {
    const { headers, rows } = await this.readCsv(fileId);
    return {
      headers,
      sample: rows.slice(0, 10),
      rowCount: rows.length,
      mapping: autoMapColumns(entity, headers),
      fields: IMPORT_FIELDS[entity].map((f) => ({ field: f.field, label: f.label, required: !!f.required })),
    };
  }

  async start(input: ImportInput): Promise<ImportJobStatus> {
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.get()!.userId!;
    const { headers, rows } = await this.readCsv(input.fileId);
    const fields = new Set(Object.values(input.mapping).filter(Boolean));
    const known = new Set(IMPORT_FIELDS[input.entity].map((f) => f.field));
    for (const f of fields) if (!known.has(f!)) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'INVALID_MAPPING', `Unknown field "${f}"`);
    for (const f of IMPORT_FIELDS[input.entity].filter((x) => x.required)) {
      if (!fields.has(f.field)) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'INVALID_MAPPING', `Map a column to "${f.label}"`);
    }
    if (!headers.some((h) => input.mapping[h])) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'INVALID_MAPPING', 'Map at least one column');
    if (input.entity !== 'companies') await this.usage.assertWithinLimit(organizationId, 'crmRecords', 1);
    const job = await this.prisma.tenant.crmImport.create({
      data: { organizationId, userId, entity: input.entity, fileId: input.fileId, options: input as unknown as Prisma.InputJsonValue, total: rows.length },
    });
    await this.queue.add('import', { importId: job.id, organizationId, userId }, { jobId: job.id, removeOnComplete: 100, removeOnFail: 100 });
    return this.toStatus(job);
  }

  toStatus(j: CrmImport): ImportJobStatus {
    return {
      id: j.id,
      status: j.status,
      entity: j.entity,
      total: j.total,
      processed: j.processed,
      created: j.created,
      updated: j.updated,
      skipped: j.skipped,
      errors: j.errors as ImportJobStatus['errors'],
      error: j.error,
    };
  }

  async status(id: string): Promise<ImportJobStatus> {
    const j = await this.prisma.tenant.crmImport.findFirst({ where: { id } });
    if (!j) throw notFound('Import');
    return this.toStatus(j);
  }
}

/** Processes an import inside the importing user's tenant context (so ownership and scope rules apply). */
@Injectable()
export class CrmImportRunner {
  private readonly logger = new Logger(CrmImportRunner.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly usage: UsageService,
    private readonly crm: CrmContext,
    private readonly leads: LeadsService,
    private readonly contacts: ContactsService,
    private readonly companies: CompaniesService,
  ) {}

  async run(data: ImportJobData): Promise<void> {
    const member = await this.prisma.system.member.findFirst({ where: { organizationId: data.organizationId, userId: data.userId } });
    const role = fromAuthRole(member?.role ?? '');
    await TenantContext.run({ organizationId: data.organizationId, userId: data.userId, role: role ?? undefined, permissions: permissionsForRole(role) }, () => this.process(data.importId));
  }

  private async process(importId: string): Promise<void> {
    const db = this.prisma.tenant;
    const job = await db.crmImport.findFirst({ where: { id: importId } });
    if (!job || job.status !== 'QUEUED') return;
    await db.crmImport.update({ where: { id: importId }, data: { status: 'RUNNING' } });
    const opts = job.options as unknown as ImportInput;
    const counters = { processed: 0, created: 0, updated: 0, skipped: 0 };
    const errors: Array<{ row: number; message: string }> = [];
    const addError = (row: number, message: string) => errors.length < MAX_ERRORS && errors.push({ row, message });
    try {
      const { body } = await this.storage.readUploaded(opts.fileId, CSV_MAX_BYTES);
      const { headers, rows } = parseCsv(body.toString('utf8'));
      // Remaining plan capacity for contacts + leads.
      const limits = await this.usage.limits(job.organizationId);
      const used = (await this.usage.usage(job.organizationId)).crmRecords;
      let capacity = limits.crmRecords === undefined || limits.crmRecords === UNLIMITED ? Infinity : Math.max(0, limits.crmRecords - used);

      for (let i = 0; i < rows.length; i++) {
        const rowNo = i + 2; // header is line 1
        const rec = rowToRecord(headers, rows[i]!, opts.mapping);
        try {
          const existing = await this.findExisting(opts.entity, rec);
          if (existing && opts.dedupe === 'skip') {
            counters.skipped++;
          } else if (existing && opts.dedupe === 'update') {
            await this.update(opts.entity, existing, rec);
            counters.updated++;
          } else {
            if (opts.entity !== 'companies') {
              if (capacity <= 0) {
                addError(rowNo, 'Plan limit reached: upgrade to import more contacts and leads');
                counters.skipped++;
                counters.processed++;
                continue;
              }
              capacity--;
            }
            await this.create(opts, rec);
            counters.created++;
          }
        } catch (err) {
          counters.skipped++;
          addError(rowNo, describe(err));
        }
        counters.processed++;
        if (counters.processed % 100 === 0) await db.crmImport.update({ where: { id: importId }, data: { ...counters, errors } });
      }
      await db.crmImport.update({ where: { id: importId }, data: { ...counters, errors, status: 'SUCCEEDED', completedAt: new Date() } });
    } catch (err) {
      this.logger.error(`Import ${importId} failed: ${(err as Error).stack}`);
      await db.crmImport.update({ where: { id: importId }, data: { ...counters, errors, status: 'FAILED', error: describe(err), completedAt: new Date() } });
    }
  }

  private async findExisting(entity: Entity, rec: Row): Promise<string | null> {
    const db = this.prisma.tenant;
    if (entity === 'companies') {
      const n = normalizeCompanyName(rec.name);
      return n ? ((await db.company.findFirst({ where: { nameNormalized: n, deletedAt: null }, select: { id: true } }))?.id ?? null) : null;
    }
    const keys = await this.crm.keys(rec.email, rec.phone);
    const or = [...(keys.emailNormalized ? [{ emailNormalized: keys.emailNormalized }] : []), ...(keys.phoneNormalized ? [{ phoneNormalized: keys.phoneNormalized }] : [])];
    if (!or.length) return null;
    const where = { deletedAt: null, OR: or };
    return entity === 'leads'
      ? ((await db.lead.findFirst({ where: { ...where, status: { not: 'CONVERTED' } }, select: { id: true } }))?.id ?? null)
      : ((await db.contact.findFirst({ where, select: { id: true } }))?.id ?? null);
  }

  private async companyIdFor(name: string | undefined): Promise<string | null> {
    if (!name) return null;
    const n = normalizeCompanyName(name);
    const existing = n ? await this.prisma.tenant.company.findFirst({ where: { nameNormalized: n, deletedAt: null } }) : null;
    return existing?.id ?? (await this.companies.create(createCompanySchema.parse({ name }))).id;
  }

  private async create(opts: ImportInput, rec: Row) {
    const tags = [...splitTags(rec.tags), ...(opts.tag ? [opts.tag] : [])];
    if (opts.entity === 'leads') {
      const { tags: _t, source, ...rest } = rec;
      await this.leads.create(createLeadSchema.parse({ ...rest, ...mapSource(source, opts.defaultSource), tags, allowDuplicate: true }), { skipLimit: true });
    } else if (opts.entity === 'contacts') {
      const { tags: _t, company, lifecycle, ...rest } = rec;
      const lc = lifecycle?.toUpperCase();
      await this.contacts.create(
        createContactSchema.parse({ ...rest, tags, companyId: await this.companyIdFor(company), lifecycle: (LIFECYCLES as readonly string[]).includes(lc ?? '') ? lc : 'PROSPECT', source: opts.defaultSource, allowDuplicate: true }),
        { skipLimit: true },
      );
    } else {
      const { tags: _t, size, ...rest } = rec;
      await this.companies.create(createCompanySchema.parse({ ...rest, tags, ...(size ? { size } : {}) }));
    }
  }

  /** Fills blank fields of the existing record; never overwrites values already present. */
  private async update(entity: Entity, id: string, rec: Row) {
    const db = this.prisma.tenant;
    const { tags, company, lifecycle: _l, source: _s, size: _z, ...fields } = rec;
    const current = (entity === 'leads' ? await db.lead.findFirst({ where: { id } }) : entity === 'contacts' ? await db.contact.findFirst({ where: { id } }) : await db.company.findFirst({ where: { id } })) as Record<string, unknown> | null;
    if (!current) return;
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(entity === 'leads' && company ? { ...fields, company } : fields)) if (current[k] === null || current[k] === undefined || current[k] === '') patch[k] = v;
    const newTags = splitTags(tags).filter((t) => !(current.tags as string[]).includes(t));
    if (newTags.length) patch.tags = [...(current.tags as string[]), ...newTags];
    if (Object.keys(patch).length === 0) return;
    if (entity === 'leads') await this.leads.update(id, patch);
    else if (entity === 'contacts') await this.contacts.update(id, patch);
    else await this.companies.update(id, patch);
  }
}

function describe(err: unknown): string {
  if (err instanceof AppException) return err.message;
  const issues = (err as { issues?: Array<{ path: PropertyKey[]; message: string }> }).issues;
  if (issues) return issues.map((i) => `${i.path.join('.') || 'row'}: ${i.message}`).join('; ');
  return 'Could not import this row';
}

@Processor(CRM_IMPORT_QUEUE, { concurrency: 2 })
export class CrmImportProcessor extends WorkerHost {
  constructor(private readonly runner: CrmImportRunner) {
    super();
  }

  async process(job: Job<ImportJobData>): Promise<void> {
    await this.runner.run(job.data);
  }
}
