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
