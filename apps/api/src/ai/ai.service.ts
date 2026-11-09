import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { AISettings, AIUsageSummary, GenerationJobSummary, Paginated, TextGenerationResponse } from '@zatma/types';
import type { CreateGenerationJobInput, GenerateImageInput, GenerateTextInput, PaginationInput } from '@zatma/validation';
import { AppException, notFound } from '../common/errors.js';
import { paginate, toSkipTake } from '../common/pagination.js';
import { TenantContext } from '../common/tenant-context.js';
import type { AICapability, GenerationJob, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsageService } from '../billing/usage.service.js';
import { StorageService } from '../storage/storage.service.js';
import { estimateTextCredits, imageCredits, textCredits } from './ai-credits.js';
import { AIProviderError } from './ai-errors.js';
import { AIProviderRegistry, type GenerativeCapability } from './ai-provider.registry.js';

export const AI_QUEUE = 'ai-generation';

interface Attempt {
  provider: string;
  kind: string;
  message: string;
}

export interface CallContext {
  organizationId: string;
  userId: string | null;
  purpose: string;
  jobId?: string;
}

const SYNC_TEXT_TIMEOUT_MS = 90_000;

/**
 * Runs AI generations for the active organization:
 * plan-limit pre-check → provider chain with fallback → per-attempt metering (AiUsage) → result.
 * Provider keys never leave the server; responses never include provider error internals.
 */
@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: AIProviderRegistry,
    private readonly usage: UsageService,
    private readonly storage: StorageService,
    @InjectQueue(AI_QUEUE) private readonly queue: Queue<{ jobId: string; organizationId: string; userId: string | null }>,
  ) {}

  private context(purpose: string): CallContext {
    const ctx = TenantContext.get();
    return { organizationId: TenantContext.requireOrganizationId(), userId: ctx?.userId ?? null, purpose };
  }

  // ───────────────────────────── Settings ─────────────────────────────

  async orgPreferences(organizationId: string): Promise<{ textProvider: string | null; imageProvider: string | null }> {
    const org = await this.prisma.system.organization.findUnique({ where: { id: organizationId }, select: { aiSettings: true } });
    const s = (org?.aiSettings ?? {}) as { textProvider?: string | null; imageProvider?: string | null };
    return { textProvider: s.textProvider ?? null, imageProvider: s.imageProvider ?? null };
  }

  async settings(): Promise<AISettings> {
    const prefs = await this.orgPreferences(TenantContext.requireOrganizationId());
    return {
      ...prefs,
      textOrder: this.registry.order('TEXT', prefs.textProvider),
      imageOrder: this.registry.order('IMAGE', prefs.imageProvider),
    };
  }

  async updateSettings(input: { textProvider?: string | null; imageProvider?: string | null }): Promise<AISettings> {
    const organizationId = TenantContext.requireOrganizationId();
    const current = await this.orgPreferences(organizationId);
    const next = { ...current, ...input };
    if (next.textProvider && !this.registry.has('TEXT', next.textProvider)) {
      throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'AI_PROVIDER_NOT_AVAILABLE', `${next.textProvider} is not configured for text generation`);
    }
    if (next.imageProvider && !this.registry.has('IMAGE', next.imageProvider)) {
      throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'AI_PROVIDER_NOT_AVAILABLE', `${next.imageProvider} is not configured for image generation`);
    }
    await this.prisma.system.organization.update({ where: { id: organizationId }, data: { aiSettings: next as Prisma.InputJsonValue } });
    return this.settings();
  }

  // ───────────────────────────── Core execution ─────────────────────────────

  private async record(ctx: CallContext, capability: AICapability, data: {
    provider: string;
    model: string;
    status: 'SUCCEEDED' | 'FAILED';
    inputTokens?: number;
    outputTokens?: number;
    units?: number;
    costMicroUsd?: number;
    credits?: number;
    errorKind?: string;
    latencyMs: number;
  }): Promise<void> {
    await this.prisma.system.aiUsage.create({
      data: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        capability,
        provider: data.provider,
        model: data.model,
        inputTokens: data.inputTokens ?? 0,
        outputTokens: data.outputTokens ?? 0,
        units: data.units ?? 0,
        costMicroUsd: BigInt(data.costMicroUsd ?? 0),
        credits: data.credits ?? 0,
        status: data.status,
        purpose: ctx.purpose,
        jobId: ctx.jobId ?? null,
        errorKind: data.errorKind ?? null,
        latencyMs: data.latencyMs,
      },
    });
  }

  /** Tries each provider in order; non-retryable errors (bad request) stop the chain. */
  private async runChain<T, P extends { id: string; defaultModel: string }>(
    capability: GenerativeCapability,
    chain: P[],
    ctx: CallContext,
    call: (provider: P) => Promise<T>,
    meter: (result: T) => { model: string; inputTokens?: number; outputTokens?: number; units?: number; costMicroUsd: number; credits: number },
  ): Promise<{ result: T; provider: string; credits: number; model: string; attempts: Attempt[] }> {
    if (chain.length === 0) {
      throw new AppException(HttpStatus.SERVICE_UNAVAILABLE, 'AI_PROVIDER_UNAVAILABLE', `No ${capability.toLowerCase()} generation provider is configured`);
    }
    const attempts: Attempt[] = [];
    for (const provider of chain) {
      const started = Date.now();
      try {
        const result = await call(provider);
        const m = meter(result);
        await this.record(ctx, capability, { provider: provider.id, status: 'SUCCEEDED', latencyMs: Date.now() - started, ...m });
        return { result, provider: provider.id, credits: m.credits, model: m.model, attempts };
      } catch (err) {
        const e = err instanceof AIProviderError ? err : new AIProviderError(provider.id, 'unknown', (err as Error).message, true);
        attempts.push({ provider: provider.id, kind: e.kind, message: e.message });
        await this.record(ctx, capability, { provider: provider.id, model: provider.defaultModel, status: 'FAILED', errorKind: e.kind, latencyMs: Date.now() - started });
        this.logger.warn(`${capability} generation via ${provider.id} failed (${e.kind}): ${e.message}`);
        if (!e.retryable) {
          throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'AI_REQUEST_REJECTED', 'The AI provider rejected this request. Try rephrasing or shortening the prompt.', {
            provider: provider.id,
          });
        }
      }
    }
    const refused = attempts.every((a) => a.kind === 'refused');
    throw new AppException(
      refused ? HttpStatus.UNPROCESSABLE_ENTITY : HttpStatus.SERVICE_UNAVAILABLE,
      refused ? 'AI_CONTENT_REFUSED' : 'AI_PROVIDERS_FAILED',
      refused ? 'The request was declined by the AI safety filters. Please rephrase it.' : 'AI generation is temporarily unavailable. Please try again shortly.',
      { attempts: attempts.map((a) => ({ provider: a.provider, kind: a.kind })) },
    );
  }

  /** Text generation for a known tenant context (used by queued work such as design generation). */
  async generateTextFor(ctx: CallContext, input: GenerateTextInput, timeoutMs?: number): Promise<TextGenerationResponse> {
    await this.usage.assertWithinLimit(ctx.organizationId, 'aiCredits', estimateTextCredits(`${input.system ?? ''}${input.prompt}`, input.maxOutputTokens));
    const prefs = await this.orgPreferences(ctx.organizationId);
    const chain = this.registry.chain('TEXT', input.provider ?? prefs.textProvider);
    const out = await this.runChain(
      'TEXT',
      chain,
      ctx,
      (p) =>
        p.generateText({
          prompt: input.prompt,
          system: input.system,
          language: input.language,
          responseFormat: input.responseFormat,
          maxOutputTokens: input.maxOutputTokens,
          timeoutMs,
        }),
      (r) => ({ model: r.model, inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, costMicroUsd: r.usage.costMicroUsd, credits: textCredits(r.usage.inputTokens ?? 0, r.usage.outputTokens ?? 0) }),
    );
    return {
      text: out.result.text,
      provider: out.provider,
      model: out.model,
      credits: out.credits,
      finishReason: out.result.finishReason,
      fallbackFrom: out.attempts.map((a) => a.provider),
    };
  }

  /** Synchronous text generation for short requests (copy, captions, briefs). */
  generateText(input: GenerateTextInput): Promise<TextGenerationResponse> {
    return this.generateTextFor(this.context(input.purpose), input, SYNC_TEXT_TIMEOUT_MS);
  }

  /** Image generation for a known tenant context; images are stored as private AI_IMAGE files. */
  async generateImagesFor(ctx: CallContext, input: GenerateImageInput) {
    await this.usage.assertWithinLimit(ctx.organizationId, 'aiCredits', imageCredits(input.count));
    const prefs = await this.orgPreferences(ctx.organizationId);
    const chain = this.registry.chain('IMAGE', input.provider ?? prefs.imageProvider);
    const out = await this.runChain(
      'IMAGE',
      chain,
      ctx,
      (p) => p.generateImage({ prompt: input.prompt, width: input.width, height: input.height, count: input.count }),
      (r) => ({ model: r.model, inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, units: r.images.length, costMicroUsd: r.usage.costMicroUsd, credits: imageCredits(r.images.length) }),
    );
    const files = [];
    for (const [i, img] of out.result.images.entries()) {
      files.push(await this.storage.storeGenerated(img.data, img.mimeType, 'AI_IMAGE', `ai-image-${i + 1}.${img.mimeType.split('/')[1] ?? 'png'}`));
    }
    return { fileIds: files.map((f) => f.id), provider: out.provider, model: out.model, credits: out.credits };
  }

  // ───────────────────────────── Jobs ─────────────────────────────

  async createJob(body: CreateGenerationJobInput): Promise<GenerationJobSummary> {
    const ctx = this.context(body.input.purpose);
    // Fail fast on plan limits and missing providers before queueing.
    const estimate = body.type === 'TEXT' ? estimateTextCredits(body.input.prompt, body.input.maxOutputTokens) : imageCredits(body.input.count);
    await this.usage.assertWithinLimit(ctx.organizationId, 'aiCredits', estimate);
    if (this.registry.order(body.type).length === 0) {
      throw new AppException(HttpStatus.SERVICE_UNAVAILABLE, 'AI_PROVIDER_UNAVAILABLE', `No ${body.type.toLowerCase()} generation provider is configured`);
    }
    const job = await this.prisma.tenant.generationJob.create({
      data: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        type: body.type,
        purpose: body.input.purpose,
        input: body.input as Prisma.InputJsonValue,
      },
    });
    await this.queue.add(body.type, { jobId: job.id, organizationId: ctx.organizationId, userId: ctx.userId }, {
      jobId: job.id,
      attempts: 1, // provider retries + fallback happen inside the job
      removeOnComplete: { age: 24 * 3600 },
      removeOnFail: { age: 7 * 24 * 3600 },
    });
    return this.toSummary(job);
  }

  /** Executes a queued job. Called by the worker inside a TenantContext for the job's organization. */
  async runJob(jobId: string): Promise<void> {
    const job = await this.prisma.tenant.generationJob.findFirst({ where: { id: jobId } });
    if (!job || job.status !== 'QUEUED') return;
    await this.prisma.tenant.generationJob.update({ where: { id: jobId }, data: { status: 'RUNNING', startedAt: new Date() } });
    const ctx: CallContext = { organizationId: job.organizationId, userId: job.userId, purpose: job.purpose, jobId };
    try {
      if (job.type === 'TEXT') {
        const r = await this.generateTextFor(ctx, job.input as unknown as GenerateTextInput);
        await this.prisma.tenant.generationJob.update({
          where: { id: jobId },
          data: { status: 'SUCCEEDED', output: { text: r.text }, provider: r.provider, model: r.model, credits: r.credits, completedAt: new Date() },
        });
      } else if (job.type === 'IMAGE') {
        const r = await this.generateImagesFor(ctx, job.input as unknown as GenerateImageInput);
        await this.prisma.tenant.generationJob.update({
          where: { id: jobId },
          data: { status: 'SUCCEEDED', output: { fileIds: r.fileIds }, provider: r.provider, model: r.model, credits: r.credits, completedAt: new Date() },
        });
      } else {
        throw new AppException(HttpStatus.BAD_REQUEST, 'UNSUPPORTED_JOB_TYPE', `${job.type} jobs are not supported yet`);
      }
    } catch (err) {
      const code = err instanceof AppException ? err.code : 'INTERNAL_ERROR';
      const message = err instanceof AppException ? err.message : 'Generation failed unexpectedly';
      if (!(err instanceof AppException)) this.logger.error(`Job ${jobId} crashed: ${(err as Error).stack}`);
      await this.prisma.tenant.generationJob.update({ where: { id: jobId }, data: { status: 'FAILED', errorCode: code, errorMessage: message, completedAt: new Date() } });
    }
  }

  private async toSummary(job: GenerationJob): Promise<GenerationJobSummary> {
    const output = job.output as { text?: string; fileIds?: string[] } | null;
    let files: Array<{ id: string; url: string; mimeType: string }> | undefined;
    if (output?.fileIds?.length) {
      files = await Promise.all(
        output.fileIds.map(async (id) => {
          const f = await this.prisma.tenant.storedFile.findFirst({ where: { id } });
          return { id, mimeType: f?.mimeType ?? 'image/png', url: f ? await this.storage.signedUrlForKey(f.key) : '' };
        }),
      );
    }
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      purpose: job.purpose,
      provider: job.provider,
      model: job.model,
      credits: job.credits,
      output: output ? { ...(output.text !== undefined ? { text: output.text } : {}), ...(files ? { files } : {}) } : null,
      error: job.errorCode ? { code: job.errorCode, message: job.errorMessage ?? '' } : null,
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt?.toISOString() ?? null,
    };
  }

  async getJob(id: string): Promise<GenerationJobSummary> {
    const job = await this.prisma.tenant.generationJob.findFirst({ where: { id } });
    if (!job) throw notFound('Generation job');
    return this.toSummary(job);
  }

  async listJobs(pagination: PaginationInput): Promise<Paginated<GenerationJobSummary>> {
    const [rows, total] = await Promise.all([
      this.prisma.tenant.generationJob.findMany({ orderBy: { createdAt: 'desc' }, ...toSkipTake(pagination) }),
      this.prisma.tenant.generationJob.count(),
    ]);
    return paginate(await Promise.all(rows.map((r) => this.toSummary(r))), total, pagination);
  }

  // ───────────────────────────── Usage ─────────────────────────────

  async usageSummary(): Promise<AIUsageSummary> {
    const organizationId = TenantContext.requireOrganizationId();
    const { subscription } = await this.usage.effectivePlan(organizationId);
    const periodStart = subscription?.currentPeriodStart ?? new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const [limits, used, groups, recent] = await Promise.all([
      this.usage.limits(organizationId),
      this.usage.usage(organizationId),
      this.prisma.tenant.aiUsage.groupBy({
        by: ['provider', 'capability', 'status'],
        where: { createdAt: { gte: periodStart } },
        _count: { _all: true },
        _sum: { credits: true },
      }),
      this.prisma.tenant.aiUsage.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    const byKey = new Map<string, AIUsageSummary['byProvider'][number]>();
    for (const g of groups) {
      const key = `${g.provider}:${g.capability}`;
      const row = byKey.get(key) ?? { provider: g.provider, capability: g.capability, requests: 0, failures: 0, credits: 0 };
      row.requests += g._count._all;
      if (g.status === 'FAILED') row.failures += g._count._all;
      row.credits += g._sum.credits ?? 0;
      byKey.set(key, row);
    }
    return {
      periodStart: periodStart.toISOString(),
      credits: { used: used.aiCredits, limit: limits.aiCredits },
      byProvider: [...byKey.values()].sort((a, b) => b.credits - a.credits),
      recent: recent.map((r) => ({
        id: r.id,
        provider: r.provider,
        model: r.model,
        capability: r.capability,
        status: r.status,
        credits: r.credits,
        purpose: r.purpose,
        errorKind: r.errorKind,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }
}
