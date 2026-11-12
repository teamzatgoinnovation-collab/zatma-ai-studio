'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Plus, RefreshCw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Alert, Badge, Button, buttonVariants, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, DialogContent, EmptyState, ErrorState, Input, Label, Skeleton } from '@zatma/ui';
import { toCents, type AdAccountDto, type AdPlatform } from '@zatma/validation';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/activity';
import { oauthErrorMessage } from '@/components/social/helpers';
import { AdPlatformMark, errorText, money } from './shared';

const PROVIDER: Record<AdPlatform, 'meta_ads' | 'google_ads'> = { META: 'meta_ads', GOOGLE: 'google_ads' };
const NAME: Record<AdPlatform, string> = { META: 'Meta Ads', GOOGLE: 'Google Ads' };

/** Share of the cap already spent or committed (0–100+). */
function capUse(a: AdAccountDto): number | null {
  if (!a.monthlySpendCap) return null;
  const cap = toCents(a.monthlySpendCap);
  if (cap === 0n) return 100;
  return Number(((toCents(a.spentThisMonth) + toCents(a.committedThisMonth)) * 100n) / cap);
}

export function AdAccountsPage({ platform }: { platform: AdPlatform }) {
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const org = useQuery({ queryKey: ['organization', 'current'], queryFn: api.organizations.current });
  const providers = useQuery({ queryKey: ['ads', 'providers'], queryFn: api.ads.providers });
  const accounts = useQuery({ queryKey: ['ads', 'accounts', platform], queryFn: () => api.ads.accounts(platform) });
  const usage = useQuery({ queryKey: ['billing', 'usage'], queryFn: api.billing.usage });
  const perms = org.data?.permissions ?? [];
  const canManage = perms.includes('ads:manage');
  const canApprove = perms.includes('ads:approve');
  const [picker, setPicker] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capFor, setCapFor] = useState<AdAccountDto | null>(null);
  const [removing, setRemoving] = useState<AdAccountDto | null>(null);

  useEffect(() => {
    const c = params.get('connection');
    const e = params.get('error');
    if (!c && !e) return;
    /* eslint-disable react-hooks/set-state-in-effect -- one-time read of the OAuth redirect */
    if (c) setPicker(c);
    if (e) setError(oauthErrorMessage(e));
    /* eslint-enable react-hooks/set-state-in-effect */
    router.replace(pathname, { scroll: false });
  }, [params, pathname, router]);

  const invalidate = () => Promise.all([qc.invalidateQueries({ queryKey: ['ads'] }), qc.invalidateQueries({ queryKey: ['billing', 'usage'] })]);
  const connect = useMutation({ mutationFn: () => api.ads.connect(PROVIDER[platform]), onSuccess: ({ authorizeUrl }) => window.location.assign(authorizeUrl), onError: (e) => toast.error(errorText(e)) });
  const sync = useMutation({ mutationFn: (id: string) => api.ads.sync(id), onSuccess: () => toast.success('Refreshing campaigns and results…'), onError: (e) => toast.error(errorText(e)) });
  const remove = useMutation({
    mutationFn: (id: string) => api.ads.removeAccount(id),
    onSuccess: async () => {
      setRemoving(null);
      await invalidate();
      toast.success('Ad account removed from ZatGo');
    },
    onError: (e) => toast.error(errorText(e)),
  });

  if (providers.isPending || accounts.isPending || org.isPending) return <Skeleton className="h-80" />;
  if (providers.isError || accounts.isError) return <ErrorState description="Couldn't load ad accounts." onRetry={() => void accounts.refetch()} />;
  const info = providers.data.find((p) => p.platform === platform)!;
  const limit = usage.data?.metrics.find((m) => m.metric === 'adAccounts');
  const atLimit = !!limit && limit.limit !== -1 && limit.used >= limit.limit;

  return (
    <div className="space-y-6">
      {error && <Alert>{error}</Alert>}
      <Card>
        <CardHeader className="flex-row flex-wrap items-center gap-3 space-y-0">
          <AdPlatformMark platform={platform} className="size-10" />
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base">{NAME[platform]}</CardTitle>
            <CardDescription>
              {platform === 'META' ? 'Facebook and Instagram ad accounts you manage in Meta Business.' : 'Google Ads accounts, including client accounts under a manager (MCC) account.'} Campaigns are always created paused; only Owners and Admins can start spending.
            </CardDescription>
          </div>
          {info.configured ? (
            canManage && (
              <Button disabled={connect.isPending || atLimit} onClick={() => connect.mutate()}>
                <Plus aria-hidden="true" /> {accounts.data.length ? 'Add ad accounts' : `Connect ${NAME[platform]}`}
              </Button>
            )
          ) : (
            <div className="text-right">
              <Badge tone="neutral">Not configured</Badge>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">{info.unavailableReason}</p>
            </div>
          )}
        </CardHeader>
        {atLimit && canManage && (
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Your plan allows {limit!.limit} ad account{limit!.limit === 1 ? '' : 's'}.{' '}
              <Link className="font-medium text-primary underline-offset-2 hover:underline" href="/billing">
                Upgrade
              </Link>{' '}
              to connect more.
            </p>
          </CardContent>
        )}
      </Card>

      {accounts.data.length === 0 ? (
        <EmptyState title="No ad accounts yet" description={info.configured ? `Connect ${NAME[platform]} to create campaigns and see results here.` : 'An administrator needs to add the platform keys first (see the setup guide in INTEGRATIONS.md).'} />
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2" aria-label="Ad accounts">
          {accounts.data.map((a) => {
            const used = capUse(a);
            return (
              <li key={a.id}>
                <Card className="h-full">
                  <CardHeader className="space-y-1">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      {a.name}
                      <Badge tone={a.status === 'ACTIVE' ? 'success' : a.status === 'NEEDS_REAUTH' ? 'warning' : 'danger'}>{a.status === 'ACTIVE' ? 'Active' : a.status === 'NEEDS_REAUTH' ? 'Reconnect needed' : 'Disabled'}</Badge>
                    </CardTitle>
                    <CardDescription>
                      {a.platform === 'META' ? a.externalId : a.externalId.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3')} · {a.currency} · {a.timezone}
                      {a.lastSyncedAt ? ` · Synced ${timeAgo(a.lastSyncedAt)}` : ''}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <dl className="grid grid-cols-3 gap-3 text-sm">
                      <div>
                        <dt className="text-xs text-muted-foreground">Spent this month</dt>
                        <dd className="font-semibold">{money(a.spentThisMonth, a.currency)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Can still spend</dt>
                        <dd className="font-semibold">{money(a.committedThisMonth, a.currency)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Monthly cap</dt>
                        <dd className="font-semibold">{a.monthlySpendCap ? money(a.monthlySpendCap, a.currency) : 'None'}</dd>
                      </div>
                    </dl>
                    {used !== null && (
                      <div className="space-y-1">
                        <div className="h-2 overflow-hidden rounded-full bg-muted" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, used)} aria-label="Share of the monthly cap spent or committed">
                          <div className={`h-full rounded-full ${used >= 100 ? 'bg-destructive' : used >= 80 ? 'bg-warning' : 'bg-primary'}`} style={{ width: `${Math.min(100, used)}%` }} />
                        </div>
                        <p className="text-xs text-muted-foreground">{used}% of the cap is spent or committed by active campaigns this month.</p>
                      </div>
                    )}
                    {a.lastError && <p className="text-xs text-destructive-text">{a.lastError}</p>}
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/ads/campaigns?adAccountId=${a.id}`} className={buttonVariants({ size: 'sm', variant: 'outline' })}>
                        Campaigns
                      </Link>
                      {canManage && (
                        <Button size="sm" variant="outline" disabled={sync.isPending} onClick={() => sync.mutate(a.id)}>
                          <RefreshCw aria-hidden="true" /> Refresh
                        </Button>
                      )}
                      {canApprove && (
                        <Button size="sm" variant="outline" onClick={() => setCapFor(a)}>
                          Set spend cap
                        </Button>
                      )}
                      {a.status === 'NEEDS_REAUTH' && canManage && (
                        <Button size="sm" onClick={() => connect.mutate()}>
                          Reconnect
                        </Button>
                      )}
                      {canManage && (
                        <Button size="sm" variant="ghost" onClick={() => setRemoving(a)} aria-label={`Remove ${a.name}`}>
                          <Trash2 aria-hidden="true" /> Remove
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        Redirect URI to register: <code className="rounded bg-muted px-1">{info.redirectUri}</code>
        <ExternalLink className="size-3" aria-hidden="true" />
      </p>

      {picker && <AccountPicker connectionId={picker} onClose={() => setPicker(null)} onDone={invalidate} />}
      <CapDialog account={capFor} onClose={() => setCapFor(null)} onSaved={invalidate} />
      <Dialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent title={`Remove ${removing?.name ?? 'ad account'}?`} description="It is removed from ZatGo only; nothing changes in the ad platform. Campaigns created here stay on the platform.">
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => removing && remove.mutate(removing.id)}>
              Remove
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AccountPicker({ connectionId, onClose, onDone }: { connectionId: string; onClose: () => void; onDone: () => Promise<unknown> }) {
  const available = useQuery({ queryKey: ['ads', 'available', connectionId], queryFn: () => api.ads.available(connectionId), retry: false });
  const [picked, setPicked] = useState<string[] | null>(null);
  const chosen = picked ?? (available.data ?? []).filter((a) => !a.alreadyAdded && a.status === 'ACTIVE').map((a) => a.externalId);
  const add = useMutation({
    mutationFn: () => api.ads.addAccounts({ connectionId, externalIds: chosen }),
    onSuccess: async (rows) => {
      await onDone();
      toast.success(`${rows.length} ad account${rows.length === 1 ? '' : 's'} connected`);
      onClose();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Choose ad accounts" description="Pick the ad accounts ZatGo may create campaigns in. Nothing is spent until an Owner or Admin activates a campaign.">
        <div className="mt-4 space-y-3">
          {available.isPending ? (
            <Skeleton className="h-32" />
          ) : available.isError ? (
            <Alert>{errorText(available.error)}</Alert>
          ) : available.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">No ad accounts were found for this login.</p>
          ) : (
            <fieldset>
              <legend className="sr-only">Ad accounts</legend>
              <ul className="space-y-2">
                {available.data.map((a) => (
                  <li key={a.externalId}>
                    <label className="flex items-center gap-3 rounded-xl border border-border p-3 text-sm">
                      <input type="checkbox" className="size-4 accent-[var(--color-primary)]" disabled={a.alreadyAdded || a.status !== 'ACTIVE'} checked={a.alreadyAdded || chosen.includes(a.externalId)} onChange={(e) => setPicked(e.target.checked ? [...chosen, a.externalId] : chosen.filter((x) => x !== a.externalId))} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{a.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {a.externalId} · {a.currency} · {a.timezone}
                        </span>
                      </span>
                      {a.alreadyAdded ? <Badge tone="success">Connected</Badge> : a.status !== 'ACTIVE' && <Badge tone="neutral">Disabled</Badge>}
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {chosen.length ? 'Cancel' : 'Done'}
            </Button>
            {!!available.data?.length && (
              <Button disabled={!chosen.length || add.isPending} onClick={() => add.mutate()}>
                Connect {chosen.length || ''} account{chosen.length === 1 ? '' : 's'}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CapDialog({ account, onClose, onSaved }: { account: AdAccountDto | null; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [value, setValue] = useState('');
  const save = useMutation({
    mutationFn: (cap: string | null) => api.ads.updateAccount(account!.id, { monthlySpendCap: cap }),
    onSuccess: async () => {
      await onSaved();
      toast.success('Spend cap saved');
      setValue('');
      onClose();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const valid = /^\d{1,12}(\.\d{1,2})?$/.test(value.trim());
  return (
    <Dialog
      open={!!account}
      onOpenChange={(o) => {
        if (!o) {
          setValue('');
          onClose();
        }
      }}
    >
      <DialogContent title="Monthly spend cap" description="ZatGo refuses to activate a campaign or raise a budget when the month's spend plus what active campaigns can still spend would go above this amount. It does not stop campaigns already running.">
        {account && (
          <div className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cap">Cap per calendar month ({account.currency})</Label>
              <Input id="cap" inputMode="decimal" placeholder={account.monthlySpendCap ?? 'e.g. 25000'} value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
            <div className="flex justify-between gap-2">
              <Button variant="ghost" disabled={!account.monthlySpendCap || save.isPending} onClick={() => save.mutate(null)}>
                Remove cap
              </Button>
              <Button disabled={!valid || save.isPending} onClick={() => save.mutate(value.trim())}>
                Save cap
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
