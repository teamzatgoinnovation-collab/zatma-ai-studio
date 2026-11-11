'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, ExternalLink, Link2, RefreshCw, Settings2, Trash2 } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@zatma/sdk';
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, cn, Dialog, DialogContent, EmptyState, ErrorState, Meter, Skeleton } from '@zatma/ui';
import type { Workspace } from '@zatma/types';
import { PROVIDER_LABELS, type SocialAccountDto, type SocialPlatform, type SocialProviderId, type SocialProviderInfo } from '@zatma/validation';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/activity';
import { oauthErrorMessage, PLATFORM_MARK, platformLabel, sortAccounts, STATUS_BADGE, workspaceSummary } from './helpers';

const describeError = (e: unknown) => (e instanceof ApiError ? e.message : (e as Error).message);
const RETURN_TO = '/marketing/accounts';

function PlatformMark({ platform, className }: { platform: SocialPlatform; className?: string }) {
  const m = PLATFORM_MARK[platform];
  return (
    <span aria-hidden="true" className={cn('grid size-10 shrink-0 place-items-center rounded-xl text-sm font-bold', m.className, className)}>
      {m.text}
    </span>
  );
}

function Avatar({ url, platform }: { url: string | null; platform: SocialPlatform }) {
  if (!url) return <PlatformMark platform={platform} />;
  return (
    <span className="relative size-10 shrink-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" className="size-10 rounded-xl border border-border object-cover" />
      <PlatformMark platform={platform} className="absolute -bottom-1 -right-1 size-5 rounded-md text-[9px]" />
    </span>
  );
}

export function SocialAccountsManager() {
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const org = useQuery({ queryKey: ['organization', 'current'], queryFn: api.organizations.current });
  const providers = useQuery({ queryKey: ['social', 'providers'], queryFn: api.social.providers });
  const accounts = useQuery({ queryKey: ['social', 'accounts'], queryFn: api.social.accounts });
  const workspaces = useQuery({ queryKey: ['workspaces', 'all'], queryFn: () => api.workspaces.list({ pageSize: 100 }) });
  const usage = useQuery({ queryKey: ['billing', 'usage'], queryFn: api.billing.usage });
  const canConnect = org.data?.permissions.includes('social:connect') ?? false;

  // Values returned by the OAuth redirect (read once, then removed from the URL).
  const [picker, setPicker] = useState<string | null>(null);
  const [oauthError, setOauthError] = useState<{ message: string; provider: string | null } | null>(null);
  useEffect(() => {
    const connection = params.get('connection');
    const error = params.get('error');
    if (!connection && !error) return;
    /* eslint-disable react-hooks/set-state-in-effect -- one-time read of the OAuth redirect parameters */
    if (connection) setPicker(connection);
    if (error) setOauthError({ message: oauthErrorMessage(error)!, provider: params.get('provider') });
    /* eslint-enable react-hooks/set-state-in-effect */
    router.replace(pathname, { scroll: false });
  }, [params, pathname, router]);

  const [editing, setEditing] = useState<SocialAccountDto | null>(null);
  const [removing, setRemoving] = useState<SocialAccountDto | null>(null);
  const invalidate = () => Promise.all([qc.invalidateQueries({ queryKey: ['social'] }), qc.invalidateQueries({ queryKey: ['billing', 'usage'] })]);

  const connect = useMutation({
    mutationFn: ({ provider, reconnectConnectionId }: { provider: SocialProviderId; reconnectConnectionId?: string }) => api.social.connect(provider, { returnTo: RETURN_TO, reconnectConnectionId }),
    onSuccess: ({ authorizeUrl }) => window.location.assign(authorizeUrl),
    onError: (e) => toast.error(describeError(e)),
  });
  const check = useMutation({
    mutationFn: (id: string) => api.social.check(id),
    onSuccess: async (a) => {
      await invalidate();
      if (a.status === 'ACTIVE') toast.success(`${a.name} is working`);
      else toast.warning(`${a.name}: ${STATUS_BADGE[a.status].label}${a.lastError ? ` — ${a.lastError}` : ''}`);
    },
    onError: (e) => toast.error(describeError(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.social.remove(id),
    onSuccess: async () => {
      const name = removing?.name;
      setRemoving(null);
      await invalidate();
      toast.success(`${name ?? 'Account'} disconnected`);
    },
    onError: (e) => toast.error(describeError(e)),
  });

  const wsList: Workspace[] = workspaces.data?.data ?? [];
  const metric = usage.data?.metrics.find((m) => m.metric === 'socialAccounts');
  const sorted = useMemo(() => sortAccounts(accounts.data ?? []), [accounts.data]);
  const atLimit = metric ? metric.limit !== -1 && metric.used >= metric.limit : false;

  if (providers.isPending || accounts.isPending) return <Skeleton className="h-96" />;
  if (providers.isError || accounts.isError) return <ErrorState description="Couldn't load social accounts." onRetry={() => void Promise.all([providers.refetch(), accounts.refetch()])} />;

  return (
    <div className="space-y-6">
      {oauthError && (
        <Alert>
          <p>
            <span className="font-medium">{oauthError.provider && oauthError.provider in PROVIDER_LABELS ? `${PROVIDER_LABELS[oauthError.provider as SocialProviderId]}: ` : ''}</span>
            {oauthError.message}
          </p>
          <button type="button" className="mt-1 text-xs font-medium underline underline-offset-2" onClick={() => setOauthError(null)}>
            Dismiss
          </button>
        </Alert>
      )}

      <section aria-labelledby="platforms-heading" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="platforms-heading" className="text-lg font-semibold">
            Platforms
          </h2>
          {metric && (
            <div className="w-full sm:w-72">
              <Meter label="Social accounts on your plan" used={metric.used} limit={metric.limit} />
            </div>
          )}
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {providers.data.map((p) => (
            <ProviderCard key={p.id} provider={p} canConnect={canConnect} atLimit={atLimit} pending={connect.isPending && connect.variables?.provider === p.id} onConnect={() => connect.mutate({ provider: p.id })} />
          ))}
        </div>
      </section>

      <section aria-labelledby="accounts-heading" className="space-y-3">
        <h2 id="accounts-heading" className="text-lg font-semibold">
          Connected accounts
        </h2>
        {sorted.length === 0 ? (
          <EmptyState
            icon={<Link2 />}
            title="No accounts connected yet"
            description={canConnect ? 'Connect a Facebook Page, Instagram business account, LinkedIn Page or YouTube channel to publish and track content from here.' : 'An admin or marketing manager can connect your social accounts.'}
          />
        ) : (
          <Card>
            <ul className="divide-y divide-border" aria-label="Connected accounts">
              {sorted.map((a) => {
                const badge = STATUS_BADGE[a.status];
                return (
                  <li key={a.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <Avatar url={a.avatarUrl} platform={a.platform} />
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medium">{a.name}</span>
                          <Badge tone={badge.tone}>{badge.label}</Badge>
                        </p>
                        <p className="text-sm text-muted-foreground sm:truncate">
                          {platformLabel(a.platform)}
                          {a.username && a.username !== a.name ? ` · ${a.username.startsWith('@') ? a.username : `@${a.username}`}` : ''} · {workspaceSummary(a.workspaceIds, wsList)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {a.lastCheckedAt ? `Checked ${timeAgo(a.lastCheckedAt)}` : 'Not checked yet'}
                          {a.connectedBy ? ` · Connected by ${a.connectedBy.name}` : ''}
                        </p>
                        {a.status !== 'ACTIVE' && a.lastError && <p className="mt-1 text-xs text-destructive-text">{a.lastError}</p>}
                      </div>
                    </div>
                    {canConnect && (
                      <div className="flex flex-wrap gap-2 sm:justify-end">
                        {a.status === 'NEEDS_REAUTH' && (
                          <Button size="sm" disabled={connect.isPending} onClick={() => connect.mutate({ provider: a.connection.provider, reconnectConnectionId: a.connection.id })} aria-label={`Reconnect ${a.name} (${platformLabel(a.platform)})`}>
                            <RefreshCw aria-hidden="true" /> Reconnect
                          </Button>
                        )}
                        <Button size="sm" variant="outline" disabled={check.isPending && check.variables === a.id} onClick={() => check.mutate(a.id)} aria-label={`Check ${a.name} (${platformLabel(a.platform)}) now`}>
                          <Activity aria-hidden="true" /> Check
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditing(a)} aria-label={`Workspaces for ${a.name} (${platformLabel(a.platform)})`}>
                          <Settings2 aria-hidden="true" /> Workspaces
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setRemoving(a)} aria-label={`Disconnect ${a.name} (${platformLabel(a.platform)})`}>
                          <Trash2 aria-hidden="true" /> Disconnect
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </section>

      {picker && <AccountPicker connectionId={picker} workspaces={wsList} onClose={() => setPicker(null)} onAdded={invalidate} />}

      <WorkspacesDialog account={editing} workspaces={wsList} onClose={() => setEditing(null)} onSaved={invalidate} />

      <Dialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent
          title={`Disconnect ${removing?.name ?? 'account'}?`}
          description="Scheduled posts for this account will stop publishing. When it's the last account from that login, ZatGo also revokes its access on the platform and deletes the stored tokens."
        >
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => removing && remove.mutate(removing.id)}>
              Disconnect
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProviderCard({ provider: p, canConnect, atLimit, pending, onConnect }: { provider: SocialProviderInfo; canConnect: boolean; atLimit: boolean; pending: boolean; onConnect: () => void }) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className="flex -space-x-2">
            {p.platforms.map((pl) => (
              <PlatformMark key={pl} platform={pl} className="ring-2 ring-card" />
            ))}
          </span>
          <div className="min-w-0">
            <CardTitle className="text-base">{p.name}</CardTitle>
            <CardDescription>{p.platforms.map(platformLabel).join(' · ')}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="mt-auto space-y-3">
        {p.configured ? (
          <>
            <Button className="w-full" disabled={!canConnect || atLimit || pending} onClick={onConnect}>
              {pending ? 'Opening…' : `Connect ${p.name}`}
            </Button>
            {atLimit && canConnect && <p className="text-xs text-muted-foreground">You&apos;ve reached your plan&apos;s social account limit. Upgrade or disconnect an account to add more.</p>}
          </>
        ) : (
          <div className="space-y-2">
            <Badge tone="neutral">Not configured</Badge>
            <p className="text-xs text-muted-foreground">{p.unavailableReason}</p>
            <a className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline" href="https://github.com/teamzatgoinnovation-collab/zatma-ai-studio/blob/main/docs/INTEGRATIONS.md#social-accounts-phase-9" target="_blank" rel="noreferrer">
              Setup guide <ExternalLink className="size-3" aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WorkspaceChecks({ workspaces, value, onChange }: { workspaces: Workspace[]; value: string[]; onChange: (ids: string[]) => void }) {
  if (workspaces.length <= 1) return null;
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Workspaces</legend>
      <p className="text-xs text-muted-foreground">Leave all unticked to make the account available in every workspace.</p>
      <div className="grid gap-1 sm:grid-cols-2">
        {workspaces.map((w) => (
          <label key={w.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={value.includes(w.id)} onChange={(e) => onChange(e.target.checked ? [...value, w.id] : value.filter((x) => x !== w.id))} />
            {w.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function AccountPicker({ connectionId, workspaces, onClose, onAdded }: { connectionId: string; workspaces: Workspace[]; onClose: () => void; onAdded: () => Promise<unknown> }) {
  const available = useQuery({ queryKey: ['social', 'available', connectionId], queryFn: () => api.social.available(connectionId), retry: false });
  const [selected, setSelected] = useState<string[] | null>(null);
  const [workspaceIds, setWorkspaceIds] = useState<string[]>([]);
  // Default: everything not yet added is ticked.
  const chosen = selected ?? (available.data ?? []).filter((a) => !a.alreadyAdded).map((a) => a.externalId);
  const add = useMutation({
    mutationFn: () => api.social.add({ connectionId, externalIds: chosen, workspaceIds }),
    onSuccess: async (added) => {
      await onAdded();
      toast.success(added.length === 1 ? `${added[0]!.name} connected` : `${added.length} accounts connected`);
      onClose();
    },
    onError: (e) => toast.error(describeError(e)),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Choose accounts to connect" description="Pick the Pages, accounts or channels ZatGo should manage. You can change workspaces later." className="max-w-xl">
        <div className="mt-4 space-y-4">
          {available.isPending ? (
            <Skeleton className="h-40" />
          ) : available.isError ? (
            <Alert>{describeError(available.error)}</Alert>
          ) : available.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">No Pages, Instagram business accounts, LinkedIn Pages or channels were found for this login. Make sure you are an admin of the account on the platform, then reconnect.</p>
          ) : (
            <fieldset className="space-y-2">
              <legend className="sr-only">Accounts</legend>
              <ul className="max-h-72 space-y-2 overflow-y-auto">
                {available.data.map((a) => (
                  <li key={`${a.platform}:${a.externalId}`}>
                    <label className={cn('flex items-center gap-3 rounded-xl border border-border p-3', a.alreadyAdded ? 'opacity-70' : 'cursor-pointer hover:bg-muted')}>
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--color-primary)]"
                        disabled={a.alreadyAdded}
                        checked={a.alreadyAdded || chosen.includes(a.externalId)}
                        onChange={(e) => setSelected(e.target.checked ? [...chosen, a.externalId] : chosen.filter((x) => x !== a.externalId))}
                      />
                      <Avatar url={a.avatarUrl} platform={a.platform} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{a.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {platformLabel(a.platform)}
                          {a.username && a.username !== a.name ? ` · ${a.username.startsWith('@') ? a.username : `@${a.username}`}` : ''}
                        </span>
                      </span>
                      {a.alreadyAdded && <Badge tone="success">Connected</Badge>}
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
          <WorkspaceChecks workspaces={workspaces} value={workspaceIds} onChange={setWorkspaceIds} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {available.data?.length && chosen.length ? 'Cancel' : 'Done'}
            </Button>
            {!!available.data?.length && (
              <Button disabled={!chosen.length || add.isPending} onClick={() => add.mutate()}>
                {add.isPending ? 'Connecting…' : chosen.length ? `Connect ${chosen.length} account${chosen.length === 1 ? '' : 's'}` : 'Connect'}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WorkspacesDialog({ account, workspaces, onClose, onSaved }: { account: SocialAccountDto | null; workspaces: Workspace[]; onClose: () => void; onSaved: () => Promise<unknown> }) {
  return (
    <Dialog open={!!account} onOpenChange={(o) => !o && onClose()}>
      {account && <WorkspacesForm key={account.id} account={account} workspaces={workspaces} onClose={onClose} onSaved={onSaved} />}
    </Dialog>
  );
}

function WorkspacesForm({ account, workspaces, onClose, onSaved }: { account: SocialAccountDto; workspaces: Workspace[]; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [ids, setIds] = useState(account.workspaceIds);
  const save = useMutation({
    mutationFn: () => api.social.update(account.id, { workspaceIds: ids }),
    onSuccess: async () => {
      await onSaved();
      toast.success('Workspaces updated');
      onClose();
    },
    onError: (e) => toast.error(describeError(e)),
  });
  return (
    <DialogContent title={`Workspaces for ${account.name}`} description="Choose where this account can be used for publishing.">
      <div className="mt-4 space-y-4">
        {workspaces.length <= 1 ? <p className="text-sm text-muted-foreground">Your organization has one workspace, so this account is available everywhere.</p> : <WorkspaceChecks workspaces={workspaces} value={ids} onChange={setIds} />}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {workspaces.length > 1 && (
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              Save
            </Button>
          )}
        </div>
      </div>
    </DialogContent>
  );
}
