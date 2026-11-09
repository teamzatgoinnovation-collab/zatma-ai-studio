import { z } from 'zod';

export const LANGUAGES = ['en', 'ml', 'ar', 'hi', 'ta', 'kn', 'te'] as const;
export const CURRENCIES = ['INR', 'AED', 'SAR', 'QAR', 'OMR', 'KWD', 'BHD', 'USD', 'EUR', 'GBP'] as const;

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);
const optionalUrl = z
  .union([z.url({ protocol: /^https?$/ }), z.literal('')])
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
  'application/pdf',
  'text/csv',
] as const;
export const UPLOAD_PURPOSES = ['LOGO', 'BRAND_ASSET', 'DESIGN_ASSET', 'IMPORT', 'OTHER'] as const;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const presignUploadSchema = z
  .object({
    fileName: trimmed(1, 200),
    mimeType: z.enum(UPLOAD_MIME_TYPES),
    sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
    purpose: z.enum(UPLOAD_PURPOSES).default('OTHER'),
  })
  .strict();
export type PresignUploadInput = z.infer<typeof presignUploadSchema>;
