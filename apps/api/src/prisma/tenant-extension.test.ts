import { describe, expect, it } from 'vitest';
import { TenantMismatchError } from '../common/tenant-context.js';
import { scopeArgs, TENANT_MODELS } from './tenant-extension.js';

const ORG = 'org-a';

describe('tenant scoping', () => {
  it('covers the Phase 1 tenant models', () => {
    expect([...TENANT_MODELS].sort()).toEqual(['AiUsage', 'AuditLog', 'GenerationJob', 'Invoice', 'Payment', 'StoredFile', 'Workspace']);
  });

  it('adds organizationId to read, update and delete filters', () => {
    for (const op of ['findMany', 'findFirst', 'findUnique', 'count', 'update', 'updateMany', 'delete', 'deleteMany']) {
      expect(scopeArgs('Workspace', op, { where: { id: 'w1' } }, ORG).where).toEqual({ id: 'w1', organizationId: ORG });
    }
    expect(scopeArgs('Workspace', 'findMany', {}, ORG).where).toEqual({ organizationId: ORG });
  });

  it('overrides a client-supplied organizationId in filters', () => {
    expect(scopeArgs('Workspace', 'findMany', { where: { organizationId: 'org-b' } }, ORG).where).toEqual({ organizationId: ORG });
  });

  it('injects organizationId on create and createMany', () => {
    expect(scopeArgs('Workspace', 'create', { data: { name: 'x' } }, ORG).data).toEqual({ name: 'x', organizationId: ORG });
    expect(scopeArgs('Workspace', 'createMany', { data: [{ name: 'a' }, { name: 'b' }] }, ORG).data).toEqual([
      { name: 'a', organizationId: ORG },
      { name: 'b', organizationId: ORG },
    ]);
  });

  it('rejects writes targeting another organization', () => {
    expect(() => scopeArgs('Workspace', 'create', { data: { name: 'x', organizationId: 'org-b' } }, ORG)).toThrow(TenantMismatchError);
    expect(() => scopeArgs('Workspace', 'create', { data: { organization: { connect: { id: 'org-b' } } } }, ORG)).toThrow(TenantMismatchError);
    expect(() => scopeArgs('Workspace', 'update', { where: { id: 'w' }, data: { organizationId: 'org-b' } }, ORG)).toThrow(TenantMismatchError);
  });

  it('scopes upserts on both where and create', () => {
    const args = scopeArgs('Workspace', 'upsert', { where: { id: 'w' }, create: { name: 'x' }, update: {} }, ORG);
    expect(args.where).toEqual({ id: 'w', organizationId: ORG });
    expect(args.create).toEqual({ name: 'x', organizationId: ORG });
  });
});
