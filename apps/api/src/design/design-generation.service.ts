import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { SIZE_PRESETS, type DesignBrief, type GenerateDesignInput, type SizePresetId } from '@zatma/validation';
import { AIProviderRegistry } from '../ai/ai-provider.registry.js';
import { AIService, type CallContext } from '../ai/ai.service.js';
import { AppException } from '../common/errors.js';
import { TenantContext } from '../common/tenant-context.js';
import type { BrandKit, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { backgroundImagePrompt, BriefParseError, briefSystemPrompt, briefUserPrompt, parseBrief } from './brief.js';
import { composeDesign, type ComposerBrand } from './composer.js';
import { DESIGN_QUEUE, type DesignJobData } from './design.service.js';

const toComposerBrand = (kit: BrandKit | null): ComposerBrand | null =>
  kit
    ? {
        colors: kit.colors as ComposerBrand['colors'],
        fonts: kit.fonts as ComposerBrand['fonts'],
        logoFileId: kit.logoFileId,
        website: kit.website,
        phone: kit.phone,
        whatsapp: kit.whatsapp,
      }
    : null;

/**
 * Prompt → design pipeline (runs in the worker, inside the design's tenant context):
 * 1. brief + copy as JSON from the text chain (one repair retry on invalid output)
 * 2. optional text-free background image from the image chain (falls back to a gradient)
 * 3. deterministic composition into editable layers → READY + first version
 */
@Injectable()
export class DesignGenerationService {
  private readonly logger = new Logger(DesignGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
    private readonly registry: AIProviderRegistry,
  ) {}

  private async brief(ctx: CallContext, input: GenerateDesignInput, kit: BrandKit | null): Promise<DesignBrief> {
    const preset = SIZE_PRESETS[input.sizePreset as SizePresetId];
    const user = briefUserPrompt({
      prompt: input.prompt,
      language: input.language,
      platform: preset.label,
      width: preset.width,
      height: preset.height,
      occasion: input.occasion,
      brand: kit ? { name: kit.name, tagline: kit.tagline, guidelines: kit.guidelines, website: kit.website } : null,
    });
    const first = await this.ai.generateTextFor(ctx, { prompt: user, system: briefSystemPrompt(), responseFormat: 'json', maxOutputTokens: 1500, purpose: 'design' });
    try {
      return parseBrief(first.text);
    } catch (err) {
      if (!(err instanceof BriefParseError)) throw err;
      this.logger.warn(`Brief invalid (${err.reason}); asking for a repaired version`);
      const repaired = await this.ai.generateTextFor(ctx, {
        prompt: `${user}\n\nYour previous reply could not be used (${err.reason}). Reply again with ONLY the JSON object described.`,
        system: briefSystemPrompt(),
        responseFormat: 'json',
        maxOutputTokens: 1500,
        purpose: 'design',
      });
      try {
        return parseBrief(repaired.text);
      } catch (again) {
        throw new AppException(422, 'AI_BRIEF_INVALID', 'The AI did not return a usable design brief. Please try again or rephrase the prompt.', {
          reason: (again as Error).message,
        });
      }
    }
  }

  async run(designId: string): Promise<void> {
    const db = this.prisma.tenant;
    const design = await db.design.findFirst({ where: { id: designId, deletedAt: null } });
    if (!design || design.status !== 'GENERATING') return;
    const input = design.generationOptions as unknown as GenerateDesignInput;
    const ctx: CallContext = { organizationId: design.organizationId, userId: design.createdById, purpose: 'design' };
    const kit = design.brandKitId ? await db.brandKit.findFirst({ where: { id: design.brandKitId } }) : null;

    try {
      const brief = await this.brief(ctx, input, kit);

      let backgroundFileId: string | null = null;
      if (input.aiBackground && this.registry.order('IMAGE').length > 0) {
        try {
          const img = await this.ai.generateImagesFor(ctx, {
            prompt: backgroundImagePrompt(brief, input.prompt),
            width: design.width,
            height: design.height,
            count: 1,
            purpose: 'design',
          });
          backgroundFileId = img.fileIds[0] ?? null;
        } catch (err) {
          // A missing background never fails the design: the composer uses a brand gradient.
          this.logger.warn(`Background generation skipped for ${designId}: ${(err as Error).message}`);
        }
      }

      const document = composeDesign({
        preset: SIZE_PRESETS[design.sizePreset as SizePresetId],
        brief,
        language: design.language,
        brand: toComposerBrand(kit),
        backgroundFileId,
      });

      await db.design.update({
        where: { id: designId },
        data: {
          status: 'READY',
          title: brief.headline.slice(0, 120),
          document: document as unknown as Prisma.InputJsonValue,
          caption: brief.caption || null,
          hashtags: brief.hashtags,
          revision: 1,
          errorCode: null,
          errorMessage: null,
        },
      });
      await db.designVersion.create({
        data: { organizationId: design.organizationId, designId, revision: 1, document: document as unknown as Prisma.InputJsonValue, note: 'AI generated', createdById: design.createdById },
      });
    } catch (err) {
      const code = err instanceof AppException ? err.code : 'INTERNAL_ERROR';
      const message = err instanceof AppException ? err.message : 'Design generation failed unexpectedly';
      if (!(err instanceof AppException)) this.logger.error(`Design ${designId} crashed: ${(err as Error).stack}`);
      await db.design.update({ where: { id: designId }, data: { status: 'FAILED', errorCode: code, errorMessage: message } });
    }
  }
}

@Processor(DESIGN_QUEUE, { concurrency: 3 })
export class DesignGenerationProcessor extends WorkerHost {
  constructor(private readonly generation: DesignGenerationService) {
    super();
  }

  async process(job: Job<DesignJobData>): Promise<void> {
    await TenantContext.run({ organizationId: job.data.organizationId, userId: job.data.userId ?? undefined }, () => this.generation.run(job.data.designId));
  }
}
