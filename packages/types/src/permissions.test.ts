import { describe, expect, it } from 'vitest';
import { ORG_ROLES, fromAuthRole, toAuthRole } from './roles.js';
import { PERMISSIONS, ROLE_PERMISSIONS, hasPermissions } from './permissions.js';

describe('RBAC permission map', () => {
  it('defines permissions for every role, using only known permissions', () => {
    for (const role of ORG_ROLES) {
      for (const p of ROLE_PERMISSIONS[role]) expect(PERMISSIONS).toContain(p);
    }
  });

  it('gives the owner every permission', () => {
    expect([...ROLE_PERMISSIONS.ORGANIZATION_OWNER].sort()).toEqual([...PERMISSIONS].sort());
  });

  it('keeps billing management and org deletion owner-only', () => {
    for (const role of ORG_ROLES.filter((r) => r !== 'ORGANIZATION_OWNER')) {
      expect(hasPermissions(role, ['billing:manage'])).toBe(false);
      expect(hasPermissions(role, ['organization:delete'])).toBe(false);
    }
  });

  it('prevents viewers from writing', () => {
    expect(hasPermissions('VIEWER', ['workspace:read'])).toBe(true);
    expect(hasPermissions('VIEWER', ['workspace:create'])).toBe(false);
    expect(hasPermissions('VIEWER', ['crm:write'])).toBe(false);
  });

  it('denies everything when there is no role', () => {
    expect(hasPermissions(null, ['workspace:read'])).toBe(false);
  });

  it('round-trips Better Auth role strings', () => {
    for (const role of ORG_ROLES) expect(fromAuthRole(toAuthRole(role))).toBe(role);
    expect(fromAuthRole('owner')).toBeNull();
    expect(fromAuthRole('viewer, designer')).toBe('VIEWER');
  });
});
