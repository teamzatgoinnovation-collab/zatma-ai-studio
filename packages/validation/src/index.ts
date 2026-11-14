import { z } from 'zod';

export const LANGUAGES = ['en', 'ml', 'ar', 'hi', 'ta', 'kn', 'te'] as const;
export const CURRENCIES = ['INR', 'AED', 'SAR', 'QAR', 'OMR', 'KWD', 'BHD', 'USD', 'EUR', 'GBP'] as const;

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);
// Accepts a URL, '' or null (so the transformed output of a form can be re-validated by the API).
const optionalUrl = z
  .union([z.url({ protocol: /^https?$/ }), z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' ? null : v));

const timezone = z.string().refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Invalid IANA timezone' },
);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationInput = z.infer<typeof paginationSchema>;

// ── Auth (client-side forms; the server-side equivalents are enforced by Better Auth) ──
export const signUpSchema = z.object({
  name: trimmed(2, 80),
  email: z.email().max(254),
  password: z
    .string()
    .min(10, 'Use at least 10 characters')
    .max(128)
    .regex(/[A-Za-z]/, 'Include a letter')
    .regex(/[0-9]/, 'Include a number'),
});
export type SignUpInput = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email: z.email(),
  password: z.string().min(1, 'Password is required'),
});
export type SignInInput = z.infer<typeof signInSchema>;

// ── Users ──
export const updateProfileSchema = z
  .object({
    name: trimmed(2, 80).optional(),
    locale: z.enum(LANGUAGES).optional(),
    timezone: timezone.optional(),
  })
  .strict();
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// ── Organizations ──
export const slugSchema = z
  .string()
  .trim()
  .min(3)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, numbers and dashes only');

export const createOrganizationSchema = z.object({
  name: trimmed(2, 100),
  slug: slugSchema,
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const updateOrganizationSchema = z
  .object({
    name: trimmed(2, 100).optional(),
    website: optionalUrl,
    industry: trimmed(2, 80).nullable().optional(),
    timezone: timezone.optional(),
    defaultLanguage: z.enum(LANGUAGES).optional(),
    currency: z.enum(CURRENCIES).optional(),
  })
  .strict();
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

// ── Workspaces ──
export const createWorkspaceSchema = z
  .object({
    name: trimmed(2, 80),
    description: z.string().trim().max(500).nullable().optional(),
  })
  .strict();
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

export const updateWorkspaceSchema = createWorkspaceSchema.partial().strict();
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;

// ── Storage ──
export const UPLOAD_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
  'video/mp4',
  'video/quicktime',
  'application/pdf',
  'text/csv',
] as const;
export const UPLOAD_PURPOSES = ['LOGO', 'BRAND_ASSET', 'DESIGN_ASSET', 'THUMBNAIL', 'IMPORT', 'POST_MEDIA', 'OTHER'] as const;
/** Purposes only the server assigns (never accepted from upload requests). */
export const SERVER_FILE_PURPOSES = ['AI_IMAGE'] as const;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
/** Social post media (Phase 10): larger videos, smaller images (platform limits). */
export const MAX_POST_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_POST_VIDEO_BYTES = 250 * 1024 * 1024;
const POST_MEDIA_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/quicktime']);

/** Largest size allowed for an upload of this purpose and type. */
export function maxUploadBytes(purpose: string, mimeType: string): number {
  if (purpose !== 'POST_MEDIA') return MAX_UPLOAD_BYTES;
  return mimeType.startsWith('video/') ? MAX_POST_VIDEO_BYTES : MAX_POST_IMAGE_BYTES;
}

export const presignUploadSchema = z
  .object({
    fileName: trimmed(1, 200),
    mimeType: z.enum(UPLOAD_MIME_TYPES),
    sizeBytes: z.number().int().positive().max(MAX_POST_VIDEO_BYTES),
    purpose: z.enum(UPLOAD_PURPOSES).default('OTHER'),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.purpose === 'POST_MEDIA' && !POST_MEDIA_MIME.has(v.mimeType)) ctx.addIssue({ code: 'custom', path: ['mimeType'], message: 'Post media must be a PNG, JPEG, WebP, MP4 or MOV file' });
    if (v.purpose !== 'POST_MEDIA' && v.mimeType === 'video/quicktime') ctx.addIssue({ code: 'custom', path: ['mimeType'], message: 'MOV files are only accepted for post media' });
    const max = maxUploadBytes(v.purpose, v.mimeType);
    if (v.sizeBytes > max) ctx.addIssue({ code: 'custom', path: ['sizeBytes'], message: `File must be at most ${Math.round(max / 1024 / 1024)} MB` });
  });
export type PresignUploadInput = z.infer<typeof presignUploadSchema>;

// ── Phase 2: auth flows ──
export const passwordSchema = signUpSchema.shape.password;

export const forgotPasswordSchema = z.object({ email: z.email() });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({ password: passwordSchema, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1, 'Enter your current password'), newPassword: passwordSchema, confirmPassword: z.string() })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' })
  .refine((v) => v.newPassword !== v.currentPassword, { path: ['newPassword'], message: 'Choose a different password' });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// ── Phase 2: team ──
/** Roles that can be assigned through invitations / role changes (ownership is not transferable via invite). */
export const ASSIGNABLE_ROLES = ['ADMIN', 'MARKETING_MANAGER', 'CRM_MANAGER', 'SALES_AGENT', 'DESIGNER', 'ANALYST', 'VIEWER'] as const;

export const inviteMemberSchema = z.object({
  email: z.email().max(254),
  role: z.enum(ASSIGNABLE_ROLES),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const updateMemberRoleSchema = z.object({ role: z.enum([...ASSIGNABLE_ROLES, 'ORGANIZATION_OWNER']) });
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

// ── Phase 2: organization logo ──
export const setLogoSchema = z.object({ fileId: z.uuid() }).strict();
export type SetLogoInput = z.infer<typeof setLogoSchema>;

// ── Phase 2: billing ──
export const PLAN_CODES = ['FREE', 'STARTER', 'PROFESSIONAL', 'BUSINESS', 'AGENCY'] as const;
export const BILLING_INTERVALS = ['MONTHLY', 'YEARLY'] as const;

export const checkoutSchema = z
  .object({ plan: z.enum(['STARTER', 'PROFESSIONAL', 'BUSINESS']), interval: z.enum(BILLING_INTERVALS).default('MONTHLY') })
  .strict();
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const changePlanSchema = z.object({ plan: z.enum(PLAN_CODES), interval: z.enum(BILLING_INTERVALS).default('MONTHLY') }).strict();
export type ChangePlanInput = z.infer<typeof changePlanSchema>;

// ── Phase 4: AI ──
export const AI_PROVIDER_IDS = ['anthropic', 'openai', 'gemini'] as const;
export const AI_PURPOSES = ['playground', 'copywriter', 'design', 'crm', 'ads', 'assistant'] as const;

export const generateTextSchema = z
  .object({
    prompt: z.string().trim().min(3, 'Write a longer prompt').max(8000),
    system: z.string().trim().max(4000).optional(),
    language: z.enum(LANGUAGES).optional(),
    responseFormat: z.enum(['text', 'json']).default('text'),
    maxOutputTokens: z.number().int().min(64).max(8000).default(2000),
    provider: z.enum(AI_PROVIDER_IDS).optional(),
    purpose: z.enum(AI_PURPOSES).default('playground'),
  })
  .strict();
export type GenerateTextInput = z.infer<typeof generateTextSchema>;

export const generateImageSchema = z
  .object({
    prompt: z.string().trim().min(3).max(4000),
    width: z.number().int().min(256).max(4096).default(1080),
    height: z.number().int().min(256).max(4096).default(1080),
    count: z.number().int().min(1).max(4).default(1),
    provider: z.enum(AI_PROVIDER_IDS).optional(),
    purpose: z.enum(AI_PURPOSES).default('playground'),
  })
  .strict();
export type GenerateImageInput = z.infer<typeof generateImageSchema>;

export const createGenerationJobSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('TEXT'), input: generateTextSchema }).strict(),
  z.object({ type: z.literal('IMAGE'), input: generateImageSchema }).strict(),
]);
export type CreateGenerationJobInput = z.infer<typeof createGenerationJobSchema>;

export const aiSettingsSchema = z
  .object({
    textProvider: z.enum(AI_PROVIDER_IDS).nullable().optional(),
    imageProvider: z.enum(AI_PROVIDER_IDS).nullable().optional(),
  })
  .strict();
export type AISettingsInput = z.infer<typeof aiSettingsSchema>;
export * from './design.js';
export * from './copy.js';
export * from './crm.js';
export * from './scoring.js';
export * from './social.js';
export * from './publishing.js';
export { withoutDefaults } from './patch.js';
export * from './ads.js';
export * from './campaigns.js';
