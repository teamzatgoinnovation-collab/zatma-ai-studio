import { AsyncLocalStorage } from 'node:async_hooks';
import type { OrgRole, Permission } from '@zatma/types';

/** Per-request (or per-job) security context. Populated by AuthGuard. */
export interface RequestContext {
  requestId?: string;
  userId?: string;
  organizationId?: string;
  role?: OrgRole;
  permissions?: readonly Permission[];
  ip?: string;
  userAgent?: string;
  /** Set while an automation run executes an action: changes made then carry the run's loop depth (Phase 13). */
  automation?: { runId: string; workflowId: string; depth: number };
}

const storage = new AsyncLocalStorage<RequestContext>();

export const TenantContext = {
  /** Runs `fn` inside a fresh, mutable context (used by the request middleware and job processors). */
  run<T>(initial: RequestContext, fn: () => T): T {
    return storage.run({ ...initial }, fn);
  },
  get(): RequestContext | undefined {
    return storage.getStore();
  },
  /** Mutates the current context. Throws if called outside a context. */
  set(patch: Partial<RequestContext>): void {
    const store = storage.getStore();
    if (!store) throw new Error('TenantContext.set() called outside of a request context');
    Object.assign(store, patch);
  },
  organizationId(): string | undefined {
    return storage.getStore()?.organizationId;
  },
  requireOrganizationId(): string {
    const id = storage.getStore()?.organizationId;
    if (!id) throw new MissingTenantError();
    return id;
  },
};

export class MissingTenantError extends Error {
  constructor(model?: string) {
    super(`Tenant context is required${model ? ` to query ${model}` : ''} but none is active`);
    this.name = 'MissingTenantError';
  }
}

export class TenantMismatchError extends Error {
  constructor(model: string) {
    super(`Attempted to write ${model} with an organizationId that differs from the active tenant`);
    this.name = 'TenantMismatchError';
  }
}
