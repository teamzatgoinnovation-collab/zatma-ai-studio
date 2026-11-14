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
  'social.connected': 'connected a social login',
  'social.reconnected': 'reconnected a social login',
  'social.accounts_added': 'added social accounts',
  'social.account_updated': 'changed a social account’s workspaces',
  'social.account_disconnected': 'disconnected a social account',
  'social.reauth_required': 'was told a social account needs reconnecting',
  'social.post_created': 'created a social post',
  'social.post_submitted': 'submitted a post for approval',
  'social.post_approved': 'approved a post',
  'social.post_rejected': 'requested changes to a post',
  'social.post_scheduled': 'scheduled a post',
  'social.post_unscheduled': 'unscheduled a post',
  'social.post_publish_requested': 'published a post',
  'social.post_published': 'had a post published',
  'social.post_partially_published': 'had a post partly published',
  'social.post_failed': 'had a post fail to publish',
  'social.post_retried': 'retried a failed post',
  'social.post_deleted': 'deleted a post',
  'social.settings_updated': 'changed publishing approvals',
  'ads.connected': 'connected an ad platform',
  'ads.accounts_added': 'added ad accounts',
  'ads.account_removed': 'removed an ad account',
  'ads.spend_cap_changed': 'changed an ad spend cap',
  'ads.campaign_created': 'created an ad campaign draft',
  'ads.campaign_published_paused': 'sent an ad campaign to the platform (paused)',
  'ads.campaign_created_paused': 'had an ad campaign created (paused)',
  'ads.campaign_failed': 'had an ad campaign fail to create',
  'ads.campaign_activated': 'activated an ad campaign (spending approved)',
  'ads.activation_requested': 'requested ad campaign activation',
  'ads.budget_increased': 'raised an ad budget (approved)',
  'ads.budget_changed': 'changed an ad budget',
  'ads.campaign_paused': 'paused an ad campaign',
  'ads.campaign_deleted': 'deleted an ad campaign',
  'ads.status_changed_on_platform': 'saw an ad campaign change on the platform',
  'ads.reauth_required': 'was told an ad connection needs reconnecting',
  'campaigns.created': 'created a campaign',
  'campaigns.updated': 'updated a campaign',
  'campaigns.deleted': 'deleted a campaign',
  'campaigns.marked_ready': 'marked a campaign ready',
  'campaigns.back_to_draft': 'moved a campaign back to draft',
  'campaigns.paused': 'paused a campaign',
  'campaigns.cancelled': 'cancelled a campaign',
  'campaigns.resumed': 'resumed a campaign',
  'campaigns.attached': 'added items to a campaign',
  'campaigns.detached': 'removed items from a campaign',
  'campaigns.link_created': 'created a tracked link',
  'campaigns.link_deleted': 'deleted a tracked link',
  'campaigns.lead_imported': 'imported a lead from a Meta lead form',
  'automation.created': 'created an automation',
  'automation.updated': 'edited an automation',
  'automation.deleted': 'deleted an automation',
  'automation.activated': 'activated an automation',
  'automation.paused': 'paused an automation',
  'automation.run_failed': 'had an automation run fail',
  'automation.run_retried': 'retried a failed automation run',
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
