import { HttpStatus, Injectable } from '@nestjs/common';
import {
  aiCampaignPlanOutputSchema,
  CAMPAIGN_TYPE_INFO,
  MARKETING_CAMPAIGN_TYPES,
  MARKETING_OBJECTIVES,
  slugifyUtm,
  splitBudget,
  type AiCampaignPlanDto,
  type AiCampaignPlanRequest,
  type CampaignAssetDto,
  type CampaignAssetInput,
  type CampaignChannel,
  type CampaignTaskDto,
  type CampaignTaskInput,
  type UpdateCampaignTaskInput,
} from '@zatma/validation';
import { AuditService } from '../audit/audit.service.js';
import { AppException, notFound } from '../common/errors.js';
import { TenantContext } from '../common/tenant-context.js';
import { CopyService } from '../copy/copy.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { CampaignsService } from './campaigns.service.js';

const DAY = 86_400_000;

@Injectable()
export class CampaignAssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignsService,
    private readonly storage: StorageService,
    private readonly copy: CopyService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.prisma.tenant;
  }

  // ───────────── Assets ─────────────

  async listAssets(campaignId: string): Promise<CampaignAssetDto[]> {
    await this.campaigns.row(campaignId);
    const rows = await this.db.campaignAsset.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'desc' },
      include: { file: true, design: { select: { id: true, title: true, thumbnailFileId: true, deletedAt: true } }, copyAsset: { select: { id: true, content: true, kind: true, deletedAt: true } } },
    });
    // Designs and copy linked straight to the campaign (e.g. created for it) show up too.
    const [designs, copies] = await Promise.all([
      this.db.design.findMany({ where: { campaignId, deletedAt: null }, select: { id: true, title: true, thumbnailFileId: true, createdAt: true }, take: 100 }),
      this.db.copyAsset.findMany({ where: { campaignId, deletedAt: null }, select: { id: true, content: true, kind: true, createdAt: true }, take: 100 }),
    ]);
    const thumbIds = [...rows.map((r) => r.design?.thumbnailFileId), ...designs.map((d) => d.thumbnailFileId)].filter((x): x is string => !!x);
    const thumbs = thumbIds.length ? await this.db.storedFile.findMany({ where: { id: { in: thumbIds } }, select: { id: true, key: true } }) : [];
    const urls = new Map(await Promise.all(thumbs.map(async (f) => [f.id, await this.storage.signedUrlForKey(f.key)] as const)));
    const out: CampaignAssetDto[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      if (r.file && r.file.status === 'UPLOADED') {
        out.push({ id: r.id, label: r.label, kind: 'file', refId: r.file.id, name: r.file.fileName, previewUrl: r.file.mimeType.startsWith('image/') ? await this.storage.signedUrlForKey(r.file.key) : null, mimeType: r.file.mimeType, createdAt: r.createdAt.toISOString() });
      } else if (r.design && !r.design.deletedAt) {
        seen.add(r.design.id);
        out.push({ id: r.id, label: r.label, kind: 'design', refId: r.design.id, name: r.design.title, previewUrl: r.design.thumbnailFileId ? (urls.get(r.design.thumbnailFileId) ?? null) : null, mimeType: null, createdAt: r.createdAt.toISOString() });
      } else if (r.copyAsset && !r.copyAsset.deletedAt) {
        seen.add(r.copyAsset.id);
        out.push({ id: r.id, label: r.label, kind: 'copy', refId: r.copyAsset.id, name: r.copyAsset.content.slice(0, 120), previewUrl: null, mimeType: null, createdAt: r.createdAt.toISOString() });
      }
    }
    for (const d of designs) if (!seen.has(d.id)) out.push({ id: `design:${d.id}`, label: '', kind: 'design', refId: d.id, name: d.title, previewUrl: d.thumbnailFileId ? (urls.get(d.thumbnailFileId) ?? null) : null, mimeType: null, createdAt: d.createdAt.toISOString() });
    for (const c of copies) if (!seen.has(c.id)) out.push({ id: `copy:${c.id}`, label: '', kind: 'copy', refId: c.id, name: c.content.slice(0, 120), previewUrl: null, mimeType: null, createdAt: c.createdAt.toISOString() });
    return out;
  }

  async addAsset(campaignId: string, input: CampaignAssetInput): Promise<CampaignAssetDto[]> {
    const c = await this.campaigns.row(campaignId);
    if (input.fileId && !(await this.db.storedFile.findFirst({ where: { id: input.fileId, status: 'UPLOADED' }, select: { id: true } }))) throw notFound('File');
    if (input.designId && !(await this.db.design.findFirst({ where: { id: input.designId, deletedAt: null, workspaceId: c.workspaceId }, select: { id: true } }))) throw notFound('Design');
    if (input.copyAssetId && !(await this.db.copyAsset.findFirst({ where: { id: input.copyAssetId, deletedAt: null, workspaceId: c.workspaceId }, select: { id: true } }))) throw notFound('Copy');
    const dup = await this.db.campaignAsset.findFirst({ where: { campaignId, fileId: input.fileId ?? undefined, designId: input.designId ?? undefined, copyAssetId: input.copyAssetId ?? undefined } });
    if (!dup) {
      if ((await this.db.campaignAsset.count({ where: { campaignId } })) >= 200) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'TOO_MANY_ASSETS', 'A campaign can hold up to 200 assets');
      await this.db.campaignAsset.create({ data: { organizationId: c.organizationId, campaignId, fileId: input.fileId ?? null, designId: input.designId ?? null, copyAssetId: input.copyAssetId ?? null, label: input.label, createdById: TenantContext.get()?.userId ?? null } });
    }
    return this.listAssets(campaignId);
  }

  async removeAsset(campaignId: string, assetId: string): Promise<void> {
    await this.campaigns.row(campaignId);
    // Linked designs/copy (ids "design:<id>" / "copy:<id>") are detached rather than deleted.
    const [kind, ref] = assetId.split(':');
    if (ref && kind === 'design') {
      if (!(await this.db.design.updateMany({ where: { id: ref, campaignId }, data: { campaignId: null } })).count) throw notFound('Asset');
      return;
    }
    if (ref && kind === 'copy') {
      if (!(await this.db.copyAsset.updateMany({ where: { id: ref, campaignId }, data: { campaignId: null } })).count) throw notFound('Asset');
      return;
    }
    if (!(await this.db.campaignAsset.deleteMany({ where: { id: assetId, campaignId } })).count) throw notFound('Asset');
  }

  // ───────────── Tasks ─────────────

  private taskDto(t: { id: string; title: string; dueAt: Date | null; done: boolean; assignee: { id: string; name: string } | null }): CampaignTaskDto {
    return { id: t.id, title: t.title, dueAt: t.dueAt?.toISOString() ?? null, done: t.done, assignee: t.assignee };
  }

  async listTasks(campaignId: string): Promise<CampaignTaskDto[]> {
    await this.campaigns.row(campaignId);
    const rows = await this.db.campaignTask.findMany({ where: { campaignId }, orderBy: [{ done: 'asc' }, { dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }], include: { assignee: { select: { id: true, name: true } } } });
    return rows.map((t) => this.taskDto(t));
  }

  private async assertAssignee(id: string | null | undefined) {
    if (!id) return;
    if (!(await this.prisma.system.member.findFirst({ where: { organizationId: TenantContext.requireOrganizationId(), userId: id }, select: { id: true } }))) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'INVALID_ASSIGNEE', 'The assignee must be a member of this organization');
  }

  async addTask(campaignId: string, input: CampaignTaskInput): Promise<CampaignTaskDto> {
    const c = await this.campaigns.row(campaignId);
    await this.assertAssignee(input.assigneeId);
    if ((await this.db.campaignTask.count({ where: { campaignId } })) >= 200) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'TOO_MANY_TASKS', 'A campaign can have up to 200 tasks');
    const t = await this.db.campaignTask.create({ data: { organizationId: c.organizationId, campaignId, title: input.title, dueAt: input.dueAt ? new Date(input.dueAt) : null, done: input.done, assigneeId: input.assigneeId }, include: { assignee: { select: { id: true, name: true } } } });
    return this.taskDto(t);
  }

  async updateTask(campaignId: string, taskId: string, input: UpdateCampaignTaskInput): Promise<CampaignTaskDto> {
    await this.campaigns.row(campaignId);
    await this.assertAssignee(input.assigneeId);
    const existing = await this.db.campaignTask.findFirst({ where: { id: taskId, campaignId }, select: { id: true } });
    if (!existing) throw notFound('Task');
    const t = await this.db.campaignTask.update({
      where: { id: taskId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.dueAt !== undefined ? { dueAt: input.dueAt ? new Date(input.dueAt) : null } : {}),
        ...(input.done !== undefined ? { done: input.done } : {}),
        ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
      },
      include: { assignee: { select: { id: true, name: true } } },
    });
    return this.taskDto(t);
  }

  async removeTask(campaignId: string, taskId: string): Promise<void> {
    await this.campaigns.row(campaignId);
    if (!(await this.db.campaignTask.deleteMany({ where: { id: taskId, campaignId } })).count) throw notFound('Task');
  }

  // ───────────── AI planner (a suggestion; nothing is saved) ─────────────

  async aiPlan(input: AiCampaignPlanRequest): Promise<AiCampaignPlanDto> {
    const organizationId = TenantContext.requireOrganizationId();
    const org = await this.prisma.system.organization.findUnique({ where: { id: organizationId }, select: { name: true, currency: true, timezone: true } });
    const kit = await this.db.brandKit.findFirst({ where: input.brandKitId ? { id: input.brandKitId } : { isDefault: true } });
    const system = [
      'You plan multi-channel marketing campaigns for small businesses in India and the Gulf. Be specific, practical and honest.',
      'Never invent prices, discounts, dates, phone numbers or claims that are not in the brief.',
      `Campaign types: ${MARKETING_CAMPAIGN_TYPES.join(', ')}. Objectives: ${MARKETING_OBJECTIVES.join(', ')}.`,
      'Channels: social (organic posts), meta_ads, google_ads, email, whatsapp, other (offline, website, partners).',
      'Email and WhatsApp messages cannot be sent yet; still plan them if they suit the goal.',
      'budgetSplit gives each paid or planned channel a percentage of the total budget (they should add up to 100).',
      'contentPlan items have a day offset from the start (0 = first day); tasks have a day offset too (negative = before the start).',
      `Write titles and notes in language code "${input.language}".`,
      'Reply with JSON only: {"name","type","objective","description","channels":[],"budgetSplit":[{"channel","percent"}],"audience":{"description","locations":[],"interests":[],"ageMin","ageMax"},"contentPlan":[{"channel","title","day","notes"}],"tasks":[{"title","day"}],"rationale"}.',
    ].join('\n');
    const user = [
      `Business: ${org?.name ?? 'Unknown'}`,
      kit ? `Brand facts: ${[kit.tagline, kit.website, kit.phone].filter(Boolean).join(' · ')}` : '',
      `Brief: ${input.brief}`,
      input.type ? `Campaign type: ${input.type}` : '',
      input.totalBudget ? `Total budget: ${input.totalBudget} ${org?.currency ?? 'INR'}` : 'No budget given.',
      input.startAt && input.endAt ? `Runs from ${input.startAt.slice(0, 10)} to ${input.endAt.slice(0, 10)}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const res = await this.copy.runJson(system, user, aiCampaignPlanOutputSchema, 2500, { organizationId, userId: TenantContext.get()?.userId ?? null, purpose: 'campaigns' });
    const out = res.data;
    const type = input.type ?? out.type;
    const channels = [...new Set(out.channels.length ? out.channels : CAMPAIGN_TYPE_INFO[type].channels)] as CampaignChannel[];
    const split = input.totalBudget ? splitBudget(input.totalBudget, out.budgetSplit.filter((s) => channels.includes(s.channel))) : [];
    const start = input.startAt ? new Date(input.startAt) : null;
    const end = input.endAt ? new Date(input.endAt) : null;
    const span = start && end ? Math.max(0, Math.floor((end.getTime() - start.getTime()) / DAY)) : null;
    // Only keep content dates that fall inside the campaign when dates are known.
    const dateOf = (day: number) => (start && span !== null ? new Date(start.getTime() + Math.min(day, span) * DAY).toISOString().slice(0, 10) : null);
    return {
      draft: {
        name: out.name,
        type,
        objective: out.objective,
        description: out.description,
        ...(input.startAt ? { startAt: input.startAt } : {}),
        ...(input.endAt ? { endAt: input.endAt } : {}),
        ...(input.totalBudget ? { budgetAmount: input.totalBudget } : {}),
        channels,
        channelPlans: channels.map((channel) => ({
          channel,
          plannedBudget: split.find((s) => s.channel === channel)?.amount ?? null,
          notes: '',
          content: out.contentPlan.filter((p) => p.channel === channel).slice(0, 50).map((p) => ({ title: p.title, date: dateOf(p.day), notes: p.notes })),
        })),
        audience: {
          description: out.audience.description,
          locations: out.audience.locations.slice(0, 20),
          interests: out.audience.interests.slice(0, 30),
          ageMin: out.audience.ageMin,
          ageMax: out.audience.ageMax !== null && out.audience.ageMin !== null ? Math.max(out.audience.ageMin, out.audience.ageMax) : out.audience.ageMax,
          segment: null,
        },
        utmCampaign: slugifyUtm(out.name),
      },
      tasks: out.tasks.map((t) => ({ title: t.title, dueAt: start ? new Date(start.getTime() + t.day * DAY).toISOString() : null })),
      rationale: out.rationale,
    };
  }
}
