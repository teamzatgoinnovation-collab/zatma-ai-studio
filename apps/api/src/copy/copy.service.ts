import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { z } from 'zod';
import type { Paginated } from '@zatma/types';
import {
  checkLimits,
  copyOutputSchema,
  missingTokens,
  normalizeHashtags,
  rewriteOutputSchema,
  translationOutputSchema,
  type CopyAssetDto,
  type CopyGenerationResult,
  type CopyKind,
  type CopyPlatform,
  type CopyRewriteResult,
  type CopyTranslationResult,
  type GenerateCopyInput,
  type ListCopyAssetsInput,
  type RewriteCopyInput,
  type SaveCopyAssetInput,
  type TranslateCopyInput,
  type UpdateCopyAssetInput,
} from '@zatma/validation';
import { AIProviderRegistry } from '../ai/ai-provider.registry.js';
import { AIService, type CallContext } from '../ai/ai.service.js';
import { AppException, notFound } from '../common/errors.js';
import { paginate } from '../common/pagination.js';
import { TenantContext } from '../common/tenant-context.js';
import type { BrandKit, CopyAsset, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  copySystemPrompt,
  copyUserPrompt,
  OutputParseError,
  parseJsonOutput,
  rewriteSystemPrompt,
  rewriteUserPrompt,
  translateSystemPrompt,
  translateUserPrompt,
  type BrandFacts,
} from './copy-prompts.js';

export const toBrandFacts = (kit: BrandKit | null): BrandFacts | null =>
  kit
    ? {
        name: kit.name,
        tagline: kit.tagline,
        website: kit.website,
        phone: kit.phone,
        whatsapp: kit.whatsapp,
        email: kit.email,
        address: kit.address,
        guidelines: kit.guidelines,
      }
    : null;

export interface JsonResult<T> {
  data: T;
  provider: string;
  model: string;
  credits: number;
}

type CopyAssetRow = CopyAsset & { createdBy?: { name: string } | null };

@Injectable()
export class CopyService {
  private readonly logger = new Logger(CopyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
    private readonly registry: AIProviderRegistry,
  ) {}

  private get db() {
    return this.prisma.tenant;
  }

  private ctx(): CallContext {
    return { organizationId: TenantContext.requireOrganizationId(), userId: TenantContext.get()?.userId ?? null, purpose: 'copywriter' };
  }

  private assertTextProvider() {
    if (this.registry.order('TEXT').length === 0) {
      throw new AppException(HttpStatus.SERVICE_UNAVAILABLE, 'AI_PROVIDER_UNAVAILABLE', 'No text generation provider is configured');
    }
  }

  /**
   * Runs a JSON prompt through the text chain and validates it, with one repair retry.
   * Credits from both attempts are reported.
   */
  async runJson<S extends z.ZodType>(system: string, user: string, schema: S, maxOutputTokens: number, ctx: CallContext = this.ctx()): Promise<JsonResult<z.infer<S>>> {
    this.assertTextProvider();
    const call = (prompt: string) => this.ai.generateTextFor(ctx, { prompt, system, responseFormat: 'json', maxOutputTokens, purpose: 'copywriter' });
    const first = await call(user);
    try {
      return { data: parseJsonOutput(first.text, schema), provider: first.provider, model: first.model, credits: first.credits };
    } catch (err) {
      if (!(err instanceof OutputParseError)) throw err;
      this.logger.warn(`AI output invalid (${err.reason}); asking for a repaired version`);
      const second = await call(`${user}\n\nYour previous reply could not be used (${err.reason}). Reply again with ONLY the JSON object described.`);
      try {
        return { data: parseJsonOutput(second.text, schema), provider: second.provider, model: second.model, credits: first.credits + second.credits };
      } catch (again) {
        throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'AI_OUTPUT_INVALID', 'The AI did not return usable copy. Please try again or rephrase the request.', {
          reason: (again as Error).message,
        });
      }
    }
  }

  private async brand(brandKitId?: string | null): Promise<BrandKit | null> {
    if (brandKitId) {
      const kit = await this.db.brandKit.findFirst({ where: { id: brandKitId } });
      if (!kit) throw notFound('Brand kit');
      return kit;
    }
    return this.db.brandKit.findFirst({ where: { isDefault: true } });
  }

  // ───────────── Generation ─────────────

  async generate(input: GenerateCopyInput): Promise<CopyGenerationResult> {
    this.assertTextProvider();
    const kit = await this.brand(input.brandKitId);
    const res = await this.runJson(copySystemPrompt(), copyUserPrompt(input, toBrandFacts(kit)), copyOutputSchema, Math.min(4000, 350 * input.variants + 400));
    const platform = input.platform as CopyPlatform;
    const variants = res.data.variants.slice(0, input.variants).map((v) => {
      const hashtags = input.kind === 'hashtags' ? normalizeHashtags(v.hashtags.length ? v.hashtags : v.text.split(/\s+/)) : input.includeHashtags ? normalizeHashtags(v.hashtags) : [];
      const text = input.kind === 'hashtags' ? hashtags.join(' ') : v.text;
      return { text, hashtags: input.kind === 'hashtags' ? [] : hashtags, limits: checkLimits(input.kind, platform, text, input.kind === 'hashtags' ? [] : hashtags) };
    });
    return { variants, provider: res.provider, model: res.model, credits: res.credits };
  }

  async translate(input: TranslateCopyInput): Promise<CopyTranslationResult> {
    const res = await this.runJson(translateSystemPrompt(), translateUserPrompt(input), translationOutputSchema, Math.min(8000, 600 * input.targetLanguages.length + 300));
    const byLang = new Map(res.data.translations.map((t) => [t.language, t]));
    const translations = input.targetLanguages.map((language, i) => {
      // Prefer the entry labelled with the language; fall back to position.
      const t = byLang.get(language) ?? res.data.translations[i];
      if (!t) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'AI_OUTPUT_INVALID', `The AI did not return a ${language} translation. Please try again.`);
      const missing = missingTokens(input.text, t.text);
      return {
        language,
        text: t.text,
        hashtags: normalizeHashtags(t.hashtags.length ? t.hashtags : input.hashtags),
        warnings: missing.length ? [`Check these details, they changed or are missing in the translation: ${missing.join(', ')}`] : [],
      };
    });
    return { translations, provider: res.provider, model: res.model, credits: res.credits };
  }

  async rewrite(input: RewriteCopyInput): Promise<CopyRewriteResult> {
    const res = await this.runJson(rewriteSystemPrompt(), rewriteUserPrompt(input.text, input.language, input.action, input.instruction), rewriteOutputSchema, 1500);
    return { text: res.data.text, provider: res.provider, model: res.model, credits: res.credits };
  }

  // ───────────── Library ─────────────

  toDto(a: CopyAssetRow): CopyAssetDto {
    return {
      id: a.id,
      kind: a.kind as CopyKind,
      content: a.content,
      hashtags: a.hashtags,
      language: a.language,
      tone: a.tone,
      platform: a.platform,
      goal: a.goal,
      audience: a.audience,
      brief: a.brief,
      variants: Array.isArray(a.variants) ? (a.variants as string[]) : [],
      favorite: a.favorite,
      workspaceId: a.workspaceId,
      brandKitId: a.brandKitId,
      sourceDesignId: a.sourceDesignId,
      campaignId: a.campaignId,
      createdByName: a.createdBy?.name ?? null,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    };
  }

  private async getEntity(id: string): Promise<CopyAssetRow> {
    const a = await this.db.copyAsset.findFirst({ where: { id, deletedAt: null }, include: { createdBy: { select: { name: true } } } });
    if (!a) throw notFound('Copy');
    return a;
  }

  async list(q: ListCopyAssetsInput): Promise<Paginated<CopyAssetDto>> {
    const where: Prisma.CopyAssetWhereInput = {
      deletedAt: null,
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.language ? { language: q.language } : {}),
      ...(q.favorite !== undefined ? { favorite: q.favorite } : {}),
      ...(q.workspaceId ? { workspaceId: q.workspaceId } : {}),
      ...(q.q ? { OR: [{ content: { contains: q.q, mode: 'insensitive' } }, { brief: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.copyAsset.findMany({
        where,
        include: { createdBy: { select: { name: true } } },
        orderBy: [{ favorite: 'desc' }, { updatedAt: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.copyAsset.count({ where }),
    ]);
    return paginate(
      rows.map((r) => this.toDto(r)),
      total,
      q,
    );
  }

  async get(id: string): Promise<CopyAssetDto> {
    return this.toDto(await this.getEntity(id));
  }

  async save(input: SaveCopyAssetInput): Promise<CopyAssetDto> {
    const organizationId = TenantContext.requireOrganizationId();
    const ws = input.workspaceId
      ? await this.db.workspace.findFirst({ where: { id: input.workspaceId } })
      : ((await this.db.workspace.findFirst({ where: { isDefault: true } })) ?? (await this.db.workspace.findFirst({ orderBy: { createdAt: 'asc' } })));
    if (!ws) throw notFound('Workspace');
    if (input.brandKitId && !(await this.db.brandKit.findFirst({ where: { id: input.brandKitId } }))) throw notFound('Brand kit');
    if (input.sourceDesignId && !(await this.db.design.findFirst({ where: { id: input.sourceDesignId, deletedAt: null } }))) throw notFound('Design');
    const a = await this.db.copyAsset.create({
      data: {
        organizationId,
        workspaceId: ws.id,
        kind: input.kind,
        content: input.content,
        hashtags: normalizeHashtags(input.hashtags),
        language: input.language,
        tone: input.tone ?? null,
        platform: input.platform,
        goal: input.goal ?? null,
        audience: input.audience ?? null,
        brief: input.brief ?? null,
        variants: input.variants ? (input.variants as Prisma.InputJsonValue) : undefined,
        favorite: input.favorite,
        brandKitId: input.brandKitId ?? null,
        sourceDesignId: input.sourceDesignId ?? null,
        createdById: TenantContext.get()?.userId ?? null,
      },
      include: { createdBy: { select: { name: true } } },
    });
    return this.toDto(a);
  }

  async update(id: string, input: UpdateCopyAssetInput): Promise<CopyAssetDto> {
    await this.getEntity(id);
    await this.db.copyAsset.update({
      where: { id },
      data: {
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.hashtags !== undefined ? { hashtags: normalizeHashtags(input.hashtags) } : {}),
        ...(input.favorite !== undefined ? { favorite: input.favorite } : {}),
      },
    });
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    await this.getEntity(id);
    await this.db.copyAsset.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}
