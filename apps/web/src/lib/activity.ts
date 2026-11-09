import type { AuditLogEntry } from '@zatma/types';

const LABELS: Record<string, string> = {
  'organization.created': 'created the organization',
  'organization.updated': 'updated organization settings',
  'organization.logo_updated': 'updated the logo',
  'organization.logo_removed': 'removed the logo',
  'workspace.created': 'created a workspace',
  'workspace.updated': 'updated a workspace',
  'workspace.deleted': 'deleted a workspace',
  'member.invited': 'invited a teammate',
  'member.joined': 'joined the organization',
  'member.role_changed': 'changed a member’s role',
  'member.removed': 'removed a member',
  'invitation.canceled': 'canceled an invitation',
  'file.upload_requested': 'uploaded a file',
  'billing.checkout_started': 'started a plan checkout',
  'billing.plan_changed': 'changed the plan',
  'billing.canceled': 'canceled the subscription',
  'ai.settings_updated': 'changed AI provider preferences',
};

/** Human-readable sentence for an audit action code (falls back to the code itself). */
export function describeActivity(entry: Pick<AuditLogEntry, 'action' | 'actorName'>): string {
  const what = LABELS[entry.action] ?? entry.action.replace(/[._]/g, ' ');
  return `${entry.actorName ?? 'System'} ${what}`;
}

/** Relative time like "5m ago", "3h ago", "2d ago". */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d}d ago` : new Date(iso).toLocaleDateString();
}

/** Number of entries newer than the last-seen timestamp. */
export function unreadCount(entries: Pick<AuditLogEntry, 'createdAt'>[], lastSeen: string | null): number {
  if (!lastSeen) return entries.length;
  const t = new Date(lastSeen).getTime();
  return entries.filter((e) => new Date(e.createdAt).getTime() > t).length;
}

/** localStorage wrapper that never throws (private mode, blocked storage). */
export const safeStorage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  },
};

const STORAGE_EVENT = 'zatma:storage';

/** Subscribe to localStorage changes from this tab (custom event) and other tabs (storage event). */
export function subscribeStorage(callback: () => void): () => void {
  window.addEventListener('storage', callback);
  window.addEventListener(STORAGE_EVENT, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(STORAGE_EVENT, callback);
  };
}

export function writeStorage(key: string, value: string): void {
  safeStorage.set(key, value);
  window.dispatchEvent(new Event(STORAGE_EVENT));
}
