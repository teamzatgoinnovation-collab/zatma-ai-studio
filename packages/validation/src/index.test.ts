import { describe, expect, it } from 'vitest';
import { createWorkspaceSchema, paginationSchema, signUpSchema, slugSchema, updateOrganizationSchema } from './index.js';

describe('validation schemas', () => {
  it('rejects weak passwords', () => {
    expect(signUpSchema.safeParse({ name: 'Zain', email: 'a@b.co', password: 'short' }).success).toBe(false);
    expect(signUpSchema.safeParse({ name: 'Zain', email: 'a@b.co', password: 'longpassword1' }).success).toBe(true);
  });

  it('validates slugs', () => {
    expect(slugSchema.safeParse('zatgo-innovation').success).toBe(true);
    expect(slugSchema.safeParse('ZatGo Innovation').success).toBe(false);
  });

  it('rejects unknown keys (prevents organizationId injection)', () => {
    expect(createWorkspaceSchema.safeParse({ name: 'Main', organizationId: 'other' }).success).toBe(false);
  });

  it('validates timezone and normalises empty website', () => {
    expect(updateOrganizationSchema.safeParse({ timezone: 'Mars/Base' }).success).toBe(false);
    const parsed = updateOrganizationSchema.parse({ timezone: 'Asia/Kolkata', website: '' });
    expect(parsed.website).toBeNull();
  });

  it('applies pagination defaults and caps', () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(paginationSchema.safeParse({ pageSize: 500 }).success).toBe(false);
  });
});
