import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Paginated } from '@zatma/types';
import {
  designDocumentSchema,
  documentFileIds,
  SIZE_PRESETS,
  type CreateDesignInput,
  type DesignDetail,
  type DesignDocument,
  type DesignSummary,
  type DesignVersionSummary,
  type GenerateDesignInput,
  type ListDesignsInput,
  type SaveTemplateInput,
  type SizePresetId,
  type TemplateSummary,
  type UpdateDesignInput,
} from '@zatma/validation';
import { estimateTextCredits, imageCredits } from '../ai/ai-credits.js';
import { AIProviderRegistry } from '../ai/ai-provider.registry.js';
import { UsageService } from '../billing/usage.service.js';
import { AppException, notFound } from '../common/errors.js';
import { paginate } from '../common/pagination.js';
import { TenantContext } from '../common/tenant-context.js';
import type { Design, Prisma, Template } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { BrandKitService } from './brand-kit.service.js';
import { blankDocument } from './composer.js';

export const DESIGN_QUEUE = 'design-generation';
export interface DesignJobData {
  designId: string;
  organizationId: string;
  userId: string | null;
}

const BRIEF_MAX_TOKENS = 1500;
const MAX_VERSIONS = 50;

@Injectable()
export class DesignService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly brandKits: BrandKitService,
    private readonly usage: UsageService,
    private readonly registry: AIProviderRegistry,
    @InjectQueue(DESIGN_QUEUE) private readonly queue: Queue<DesignJobData>,
  ) {}

  private get db() {
    return this.prisma.tenant;
  }

  // ───────────── Mapping ─────────────

  private async signedUrls(fileIds: string[]): Promise<Record<string, string>> {
    if (fileIds.length === 0) return {};
    const files = await this.db.storedFile.findMany({ where: { id: { in: fileIds }, status: 'UPLOADED' } });
    const entries = await Promise.all(files.map(async (f) => [f.id, await this.storage.signedUrlForKey(f.key)] as const));
    return Object.fromEntries(entries);
  }

  private summary(d: Design | Template, thumbs: Record<string, string>): Omit<DesignSummary, 'title' | 'language' | 'status' | 'workspaceId' | 'updatedAt'> {
    return {
      id: d.id,
      sizePreset: d.sizePreset,
      width: d.width,
      height: d.height,
      thumbnailUrl: d.thumbnailFileId ? (thumbs[d.thumbnailFileId] ?? null) : null,
      createdAt: d.createdAt.toISOString(),
    };
  }

  private toSummary(d: Design, thumbs: Record<string, string>): DesignSummary {
    return { ...this.summary(d, thumbs), title: d.title, language: d.language, status: d.status, workspaceId: d.workspaceId, updatedAt: d.updatedAt.toISOString() };
  }

  private async toDetail(d: Design): Promise<DesignDetail> {
    const document = d.document as unknown as DesignDocument;
    const assets = await this.signedUrls([...documentFileIds(document), ...(d.thumbnailFileId ? [d.thumbnailFileId] : [])]);
    return {
      ...this.toSummary(d, assets),
      prompt: d.prompt,
      brandKitId: d.brandKitId,
      revision: d.revision,
      document,
      caption: d.caption,
      hashtags: d.hashtags,
      generationJobId: d.generationJobId,
      error: d.errorCode ? { code: d.errorCode, message: d.errorMessage ?? '' } : null,
      assets,
    };
  }

  // ───────────── Guards ─────────────

  async getEntity(id: string): Promise<Design> {
    const d = await this.db.design.findFirst({ where: { id, deletedAt: null } });
    if (!d) throw notFound('Design');
    return d;
  }

  private async resolveWorkspace(workspaceId?: string): Promise<string> {
    const ws = workspaceId
      ? await this.db.workspace.findFirst({ where: { id: workspaceId } })
      : await this.db.workspace.findFirst({ where: { isDefault: true } }) ?? await this.db.workspace.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!ws) throw notFound('Workspace');
    return ws.id;
  }

  /** Every file a document references must be an uploaded file of this organization. */
  private async assertAssets(doc: DesignDocument): Promise<void> {
    const ids = documentFileIds(doc);
    if (ids.length === 0) return;
    const owned = await this.db.storedFile.count({ where: { id: { in: ids }, status: 'UPLOADED' } });
    if (owned !== ids.length) {
      throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'INVALID_ASSET', 'The design references a file that does not exist in this organization');
    }
  }

  // ───────────── Designs ─────────────

  async list(q: ListDesignsInput): Promise<Paginated<DesignSummary>> {
    const where: Prisma.DesignWhereInput = {
      deletedAt: null,
      ...(q.workspaceId ? { workspaceId: q.workspaceId } : {}),
      ...(q.q ? { title: { contains: q.q, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.design.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.db.design.count({ where }),
    ]);
    const thumbs = await this.signedUrls(rows.flatMap((r) => (r.thumbnailFileId ? [r.thumbnailFileId] : [])));
    return paginate(rows.map((r) => this.toSummary(r, thumbs)), total, q);
  }

  async get(id: string): Promise<DesignDetail> {
    return this.toDetail(await this.getEntity(id));
  }

  async create(input: CreateDesignInput): Promise<DesignDetail> {
    const organizationId = TenantContext.requireOrganizationId();
    const workspaceId = await this.resolveWorkspace(input.workspaceId);
    let document: DesignDocument;
    let sizePreset: string = input.sizePreset;
    if (input.templateId) {
      const t = await this.db.template.findFirst({ where: { id: input.templateId } });
      if (!t) throw notFound('Template');
      document = t.document as unknown as DesignDocument;
      sizePreset = t.sizePreset;
    } else {
      document = blankDocument(SIZE_PRESETS[input.sizePreset]);
    }
    const d = await this.db.design.create({
      data: {
        organizationId,
        workspaceId,
        title: input.title,
        sizePreset,
        width: document.width,
        height: document.height,
        document: document as unknown as Prisma.InputJsonValue,
        status: 'READY',
        revision: 1,
        createdById: TenantContext.get()?.userId ?? null,
      },
    });
    return this.toDetail(d);
  }

  /** Optimistic concurrency: the client sends the revision it edited; a mismatch is a 409. */
  async update(id: string, input: UpdateDesignInput): Promise<DesignDetail> {
    const current = await this.getEntity(id);
    if (current.status === 'GENERATING') throw new AppException(HttpStatus.CONFLICT, 'DESIGN_GENERATING', 'This design is still being generated');
    if (input.document) {
      if (input.document.width !== current.width || input.document.height !== current.height) {
        throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'SIZE_MISMATCH', 'Document size does not match the design size');
      }
      await this.assertAssets(input.document);
    }
    const res = await this.db.design.updateMany({
      where: { id, revision: input.revision, deletedAt: null },
      data: {
        revision: { increment: 1 },
        ...(input.title ? { title: input.title } : {}),
        ...(input.document ? { document: input.document as unknown as Prisma.InputJsonValue, status: 'READY' } : {}),
      },
    });
    if (res.count === 0) {
      throw new AppException(HttpStatus.CONFLICT, 'REVISION_CONFLICT', 'This design was changed elsewhere. Reload to get the latest version.', { currentRevision: current.revision });
    }
    return this.get(id);
  }

  async duplicate(id: string): Promise<DesignDetail> {
    const src = await this.getEntity(id);
    if (src.status === 'GENERATING') throw new AppException(HttpStatus.CONFLICT, 'DESIGN_GENERATING', 'This design is still being generated');
    const d = await this.db.design.create({
      data: {
        organizationId: src.organizationId,
        workspaceId: src.workspaceId,
        brandKitId: src.brandKitId,
        title: `${src.title} (copy)`.slice(0, 120),
        prompt: src.prompt,
        sizePreset: src.sizePreset,
        width: src.width,
        height: src.height,
        language: src.language,
        document: src.document as Prisma.InputJsonValue,
        caption: src.caption,
        hashtags: src.hashtags,
        thumbnailFileId: src.thumbnailFileId,
        status: src.status === 'FAILED' ? 'DRAFT' : src.status,
        revision: 1,
        createdById: TenantContext.get()?.userId ?? null,
      },
    });
    return this.toDetail(d);
  }

  async remove(id: string): Promise<void> {
    await this.getEntity(id);
    await this.db.design.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async setThumbnail(id: string, fileId: string): Promise<void> {
    await this.getEntity(id);
    const file = await this.db.storedFile.findFirst({ where: { id: fileId, status: 'UPLOADED' } });
    if (!file || !file.mimeType.startsWith('image/')) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'INVALID_ASSET', 'Thumbnail must be an uploaded image');
    await this.db.design.update({ where: { id }, data: { thumbnailFileId: fileId } });
  }

  // ───────────── Generation ─────────────

  async startGeneration(input: GenerateDesignInput): Promise<{ design: DesignDetail; jobId: string }> {
    const organizationId = TenantContext.requireOrganizationId();
    if (this.registry.order('TEXT').length === 0) {
      throw new AppException(HttpStatus.SERVICE_UNAVAILABLE, 'AI_PROVIDER_UNAVAILABLE', 'No text generation provider is configured');
    }
    const withImage = input.aiBackground && this.registry.order('IMAGE').length > 0;
    await this.usage.assertWithinLimit(organizationId, 'aiCredits', estimateTextCredits(input.prompt, BRIEF_MAX_TOKENS) + (withImage ? imageCredits(1) : 0));
    const brandKit = await this.brandKits.resolve(input.brandKitId);
    const workspaceId = await this.resolveWorkspace(input.workspaceId ?? brandKit?.workspaceId ?? undefined);
    const preset = SIZE_PRESETS[input.sizePreset as SizePresetId];
    const d = await this.db.design.create({
      data: {
        organizationId,
        workspaceId,
        brandKitId: brandKit?.id ?? null,
        title: input.prompt.slice(0, 80),
        prompt: input.prompt,
        sizePreset: preset.id,
        width: preset.width,
        height: preset.height,
        language: input.language,
        document: blankDocument(preset) as unknown as Prisma.InputJsonValue,
        status: 'GENERATING',
        generationOptions: input as unknown as Prisma.InputJsonValue,
        createdById: TenantContext.get()?.userId ?? null,
      },
    });
    await this.queue.add(
      'generate',
      { designId: d.id, organizationId, userId: TenantContext.get()?.userId ?? null },
      { jobId: d.id, attempts: 1, removeOnComplete: { age: 24 * 3600 }, removeOnFail: { age: 7 * 24 * 3600 } },
    );
    await this.db.design.update({ where: { id: d.id }, data: { generationJobId: d.id } });
    return { design: await this.get(d.id), jobId: d.id };
  }

  // ───────────── Versions ─────────────

  async listVersions(id: string): Promise<DesignVersionSummary[]> {
    await this.getEntity(id);
    const rows = await this.db.designVersion.findMany({
      where: { designId: id },
      orderBy: { createdAt: 'desc' },
      take: MAX_VERSIONS,
      include: { createdBy: { select: { name: true } } },
    });
    return rows.map((v) => ({ id: v.id, revision: v.revision, note: v.note, createdAt: v.createdAt.toISOString(), createdByName: v.createdBy?.name ?? null }));
  }

  async saveVersion(id: string, note?: string): Promise<DesignVersionSummary> {
    const d = await this.getEntity(id);
    if (d.status !== 'READY') throw new AppException(HttpStatus.CONFLICT, 'DESIGN_NOT_READY', 'Only finished designs can be versioned');
    const v = await this.db.designVersion.create({
      data: { organizationId: d.organizationId, designId: id, revision: d.revision, document: d.document as Prisma.InputJsonValue, note: note ?? null, createdById: TenantContext.get()?.userId ?? null },
      include: { createdBy: { select: { name: true } } },
    });
    return { id: v.id, revision: v.revision, note: v.note, createdAt: v.createdAt.toISOString(), createdByName: v.createdBy?.name ?? null };
  }

  async restoreVersion(id: string, versionId: string): Promise<DesignDetail> {
    const d = await this.getEntity(id);
    const v = await this.db.designVersion.findFirst({ where: { id: versionId, designId: id } });
    if (!v) throw notFound('Version');
    const document = designDocumentSchema.parse(v.document);
    await this.db.design.update({ where: { id }, data: { document: document as unknown as Prisma.InputJsonValue, revision: { increment: 1 }, status: 'READY' } });
    await this.db.designVersion.create({
      data: { organizationId: d.organizationId, designId: id, revision: d.revision + 1, document: document as unknown as Prisma.InputJsonValue, note: `Restored revision ${v.revision}`, createdById: TenantContext.get()?.userId ?? null },
    });
    return this.get(id);
  }

  // ───────────── Templates ─────────────

  async listTemplates(): Promise<TemplateSummary[]> {
    const rows = await this.db.template.findMany({ orderBy: { createdAt: 'desc' } });
    const thumbs = await this.signedUrls(rows.flatMap((r) => (r.thumbnailFileId ? [r.thumbnailFileId] : [])));
    return rows.map((t) => ({ ...this.summary(t, thumbs), name: t.name, category: t.category }));
  }

  async saveAsTemplate(id: string, input: SaveTemplateInput): Promise<TemplateSummary> {
    const d = await this.getEntity(id);
    if (d.status !== 'READY') throw new AppException(HttpStatus.CONFLICT, 'DESIGN_NOT_READY', 'Only finished designs can become templates');
    const t = await this.db.template.create({
      data: {
        organizationId: d.organizationId,
        name: input.name,
        category: input.category,
        sizePreset: d.sizePreset,
        width: d.width,
        height: d.height,
        document: d.document as Prisma.InputJsonValue,
        thumbnailFileId: d.thumbnailFileId,
        createdById: TenantContext.get()?.userId ?? null,
      },
    });
    const thumbs = await this.signedUrls(t.thumbnailFileId ? [t.thumbnailFileId] : []);
    return { ...this.summary(t, thumbs), name: t.name, category: t.category };
  }

  async removeTemplate(id: string): Promise<void> {
    const t = await this.db.template.findFirst({ where: { id } });
    if (!t) throw notFound('Template');
    await this.db.template.delete({ where: { id } });
  }
}
