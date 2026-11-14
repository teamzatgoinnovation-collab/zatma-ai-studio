import type { TriggerKind } from '@zatma/validation';
import { parseNodeConfig } from '@zatma/validation';

/** Whether an event satisfies the trigger node's own filters (source, status change, campaign, deal value). */
export function matchesTrigger(kind: TriggerKind, config: Record<string, unknown>, payload: Record<string, unknown>): boolean {
  const parsed = parseNodeConfig('trigger', kind, config);
  if (!parsed.ok) return false;
  const c = parsed.config as Record<string, unknown>;
  switch (kind) {
    case 'lead.created': {
      const sources = c.sources as string[];
      return sources.length === 0 || (typeof payload.source === 'string' && sources.includes(payload.source));
    }
    case 'lead.status_changed': {
      const from = c.from as string[];
      const to = c.to as string[];
      return (from.length === 0 || (typeof payload.from === 'string' && from.includes(payload.from))) && (to.length === 0 || (typeof payload.to === 'string' && to.includes(payload.to)));
    }
    case 'form.submitted':
    case 'campaign.interaction':
      return !c.campaignId || payload.campaignId === c.campaignId;
    case 'deal.won':
    case 'deal.lost':
      return c.minValue === null || (typeof payload.value === 'number' && payload.value >= (c.minValue as number));
    default:
      return true;
  }
}

/** Next member in a rotation. The counter only ever grows, so every member gets their turn in order. */
export function pickRoundRobin<T>(items: readonly T[], counter: number): T {
  if (items.length === 0) throw new Error('Nothing to choose from');
  return items[((counter % items.length) + items.length) % items.length]!;
}
