import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v : undefined));

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    API_URL: z.url(),
    WEB_ORIGIN: z
      .string()
      .min(1)
      .transform((v) => v.split(',').map((o) => o.trim()).filter(Boolean)),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    DATABASE_URL: z.string().startsWith('postgres'),
    REDIS_URL: z.string().startsWith('redis'),

    BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
    GOOGLE_CLIENT_ID: optional,
    GOOGLE_CLIENT_SECRET: optional,

    S3_ENDPOINT: optional,
    S3_REGION: z.string().default('auto'),
    S3_BUCKET: z.string().min(3),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: bool.default(true),

    OPENAI_API_KEY: optional,
    ANTHROPIC_API_KEY: optional,
    GEMINI_API_KEY: optional,

    // Provider order for fallback (first = default). Organizations can prefer a different first provider.
    AI_TEXT_PROVIDERS: z.string().default('anthropic,openai,gemini').transform((v) => v.split(',').map((x) => x.trim()).filter(Boolean)),
    AI_IMAGE_PROVIDERS: z.string().default('openai,gemini').transform((v) => v.split(',').map((x) => x.trim()).filter(Boolean)),
    ANTHROPIC_TEXT_MODEL: z.string().default('claude-opus-5-5'),
    ANTHROPIC_EFFORT: z.enum(['low', 'medium', 'high']).default('medium'),
    OPENAI_TEXT_MODEL: z.string().default('gpt-6.1-sol'),
    OPENAI_IMAGE_MODEL: z.string().default('gpt-image-2'),
    GEMINI_TEXT_MODEL: z.string().default('gemini-3.8-flash'),
    GEMINI_IMAGE_MODEL: z.string().default('gemini-3.1-flash-image'),

    RAZORPAY_KEY_ID: optional,
    RAZORPAY_KEY_SECRET: optional,
    RAZORPAY_WEBHOOK_SECRET: optional,

    /** Public URL of the web app (links in emails, OAuth redirects). Defaults to the first WEB_ORIGIN. */
    WEB_URL: optional,

    EMAIL_TRANSPORT: z.enum(['resend', 'capture']).default('capture'),
    RESEND_API_KEY: optional,
    EMAIL_FROM: z.string().default('ZatGo AI Marketing <no-reply@zatgoinnovation.com>'),
    REQUIRE_EMAIL_VERIFICATION: bool.default(true),

    TRIAL_PLAN: z.enum(['NONE', 'STARTER', 'PROFESSIONAL', 'BUSINESS']).default('PROFESSIONAL'),
    TRIAL_DAYS: z.coerce.number().int().min(0).max(90).default(14),
    BILLING_GRACE_DAYS: z.coerce.number().int().min(0).max(30).default(7),

    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),

    // ── Social accounts (Phase 9). Each platform is enabled only when its keys are set. ──
    /** Comma-separated `kid:base64(32 bytes)` keys; the first encrypts new tokens, all decrypt (rotation). */
    TOKEN_ENCRYPTION_KEYS: optional,
    META_APP_ID: optional,
    META_APP_SECRET: optional,
    /** Token you choose and enter in the Meta webhook settings (GET challenge). */
    META_WEBHOOK_VERIFY_TOKEN: optional,
    META_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v24.0'),
    META_GRAPH_URL: z.url().default('https://graph.facebook.com'),
    META_OAUTH_URL: z.url().default('https://www.facebook.com'),
    LINKEDIN_CLIENT_ID: optional,
    LINKEDIN_CLIENT_SECRET: optional,
    /** LinkedIn Marketing API version header (YYYYMM). */
    LINKEDIN_API_VERSION: z.string().regex(/^\d{6}$/).default('202510'),
    LINKEDIN_API_URL: z.url().default('https://api.linkedin.com'),
    LINKEDIN_OAUTH_URL: z.url().default('https://www.linkedin.com/oauth/v2'),
    YOUTUBE_CLIENT_ID: optional,
    YOUTUBE_CLIENT_SECRET: optional,
    GOOGLE_OAUTH_URL: z.url().default('https://accounts.google.com/o/oauth2/v2/auth'),
    GOOGLE_TOKEN_URL: z.url().default('https://oauth2.googleapis.com/token'),
    GOOGLE_REVOKE_URL: z.url().default('https://oauth2.googleapis.com/revoke'),
    YOUTUBE_API_URL: z.url().default('https://www.googleapis.com/youtube/v3'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.BETTER_AUTH_SECRET.startsWith('change-me')) {
      ctx.addIssue({ code: 'custom', path: ['BETTER_AUTH_SECRET'], message: 'Set a real secret in production' });
    }
    if (env.NODE_ENV === 'production' && env.EMAIL_TRANSPORT === 'capture') {
      ctx.addIssue({ code: 'custom', path: ['EMAIL_TRANSPORT'], message: 'The capture transport is for development only; use resend in production' });
    }
    if (env.EMAIL_TRANSPORT === 'resend' && !env.RESEND_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['RESEND_API_KEY'], message: 'RESEND_API_KEY is required when EMAIL_TRANSPORT=resend' });
    }
    const razorpay = [env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET, env.RAZORPAY_WEBHOOK_SECRET].filter(Boolean).length;
    if (razorpay !== 0 && razorpay !== 3) {
      ctx.addIssue({ code: 'custom', path: ['RAZORPAY_KEY_ID'], message: 'Set RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET together, or none' });
    }
    for (const [id, secret, name] of [
      [env.META_APP_ID, env.META_APP_SECRET, 'META_APP_ID and META_APP_SECRET'],
      [env.LINKEDIN_CLIENT_ID, env.LINKEDIN_CLIENT_SECRET, 'LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET'],
      [env.YOUTUBE_CLIENT_ID, env.YOUTUBE_CLIENT_SECRET, 'YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET'],
    ] as const) {
      if (Boolean(id) !== Boolean(secret)) ctx.addIssue({ code: 'custom', path: [name.split(' ')[0]!], message: `Set both ${name}, or neither` });
    }
    const social = env.META_APP_ID || env.LINKEDIN_CLIENT_ID || env.YOUTUBE_CLIENT_ID;
    if (social && !env.TOKEN_ENCRYPTION_KEYS) {
      ctx.addIssue({ code: 'custom', path: ['TOKEN_ENCRYPTION_KEYS'], message: 'TOKEN_ENCRYPTION_KEYS is required when a social platform is configured' });
    }
    if (env.TOKEN_ENCRYPTION_KEYS) {
      for (const entry of env.TOKEN_ENCRYPTION_KEYS.split(',')) {
        const [kid, key] = entry.trim().split(':');
        if (!kid || !/^[a-z0-9-]{1,16}$/i.test(kid) || !key || Buffer.from(key, 'base64').length !== 32) {
          ctx.addIssue({ code: 'custom', path: ['TOKEN_ENCRYPTION_KEYS'], message: 'Each key must be kid:base64 of exactly 32 bytes (e.g. k1:$(openssl rand -base64 32))' });
          break;
        }
      }
    }
    if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({ code: 'custom', path: ['GOOGLE_CLIENT_ID'], message: 'Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither' });
    }
  })
  .transform((env) => ({ ...env, WEB_URL: (env.WEB_URL ?? env.WEB_ORIGIN[0] ?? 'http://localhost:3000').replace(/\/$/, '') }));

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'EnvValidationError';
  }
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  return result.data;
}
