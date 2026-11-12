'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, AlertTriangle, CalendarClock, ChevronDown, FileText, ImagePlus, Loader2, Palette, Send, Upload, X } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, cn, Dialog, DialogContent, Input, Label, Select, Skeleton } from '@zatma/ui';
import {
  composeText,
  countGraphemes,
  normalizeHashtags,
  PLATFORM_LABELS,
  PLATFORM_RULES,
  validatePost,
  YOUTUBE_PRIVACY,
  type DesignDetail,
  type SocialAccountDto,
  type SocialPostDto,
  type TargetOptions,
} from '@zatma/validation';
import { api } from '@/lib/api';
import { formatInZone, fromLocalInput, nextSlot, toLocalInput } from '@/lib/publishing';
import { useNow } from '@/lib/use-now';
import { PlatformMark } from '@/components/social/accounts';
import { uploadPostMedia, toPostMedia, type ComposerMedia } from './media';
import { PostPreview } from './previews';
import { describeError } from './shared';
import { uploadFile } from '@/lib/upload';

const DesignRenderer = dynamic(() => import('./design-renderer'), { ssr: false });

type TargetState = { captionOverride: string | null; options: TargetOptions };

export interface ComposerPrefill {
  designId?: string;
  copyId?: string;
  at?: string;
}

/** Compose, validate, preview and (depending on permissions and settings) submit, schedule or publish a post. */
export function Composer({ post, prefill }: { post?: SocialPostDto; prefill?: ComposerPrefill }) {
  const router = useRouter();
  const qc = useQueryClient();
  const org = useQuery({ queryKey: ['organization', 'current'], queryFn: api.organizations.current });
  const settings = useQuery({ queryKey: ['social', 'settings'], queryFn: api.social.settings });
  const accounts = useQuery({ queryKey: ['social', 'accounts'], queryFn: api.social.accounts });
  const workspaces = useQuery({ queryKey: ['workspaces', 'all'], queryFn: () => api.workspaces.list({ pageSize: 100 }) });

  const [postId, setPostId] = useState(post?.id ?? null);
  const [workspaceId, setWorkspaceId] = useState(post?.workspaceId ?? '');
  const [caption, setCaption] = useState(post?.caption ?? '');
  const [hashtags, setHashtags] = useState<string[]>(post?.hashtags ?? []);
  const [media, setMedia] = useState<ComposerMedia[]>(post?.media ?? []);
  const [targets, setTargets] = useState<Record<string, TargetState>>(() =>
    Object.fromEntries((post?.targets ?? []).map((t) => [t.socialAccountId, { captionOverride: t.captionOverride, options: t.options }])),
  );
  const [sourceDesignId, setSourceDesignId] = useState<string | null>(post?.sourceDesignId ?? null);
  const [copyAssetId, setCopyAssetId] = useState<string | null>(post?.copyAssetId ?? null);
  const [uploading, setUploading] = useState(0);
  const [dialog, setDialog] = useState<'schedule' | 'publish' | 'copy' | 'design' | null>(null);
  const [rendering, setRendering] = useState<DesignDetail | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const tz = org.data?.timezone ?? 'Asia/Kolkata';

  // Default workspace once loaded.
  useEffect(() => {
    if (!workspaceId && workspaces.data?.data.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initialise from loaded data
      setWorkspaceId((workspaces.data.data.find((w) => w.isDefault) ?? workspaces.data.data[0])!.id);
    }
  }, [workspaceId, workspaces.data]);

  // Prefill from a design or copy item (?design=, ?copy=).
  const prefilled = useRef(false);
  useEffect(() => {
    if (post || prefilled.current) return;
    prefilled.current = true;
    if (prefill?.copyId) {
      void api.copyAssets.get(prefill.copyId).then((c) => {
        setCaption(c.content);
        setHashtags(normalizeHashtags(c.hashtags));
        setCopyAssetId(c.id);
      });
    }
    if (prefill?.designId) {
      void api.designs.get(prefill.designId).then((d) => {
        if (!prefill.copyId) {
          setCaption((c) => c || d.caption || '');
          setHashtags((h) => (h.length ? h : normalizeHashtags(d.hashtags)));
        }
        setSourceDesignId(d.id);
        setRendering(d);
      });
    }
  }, [post, prefill]);

  const selectable = useMemo(() => (accounts.data ?? []).filter((a) => !a.workspaceIds.length || a.workspaceIds.includes(workspaceId)), [accounts.data, workspaceId]);
  const selected = useMemo(() => selectable.filter((a) => targets[a.id]), [selectable, targets]);
  const perms = settings.data;
  const canPublish = perms?.canPublish ?? false;
  const requireApproval = perms?.requireApproval ?? false;
  const approved = !!post?.approvedAt;
  const status = post?.status ?? 'DRAFT';
  const pending = status === 'PENDING_APPROVAL';

  const validation = useMemo(
    () =>
      validatePost(
        { caption, hashtags, media },
        selected.map((a) => ({ platform: a.platform, captionOverride: targets[a.id]?.captionOverride, options: targets[a.id]?.options, socialAccountId: a.id })),
      ),
    [caption, hashtags, media, selected, targets],
  );
  const errorCount = validation.targets.reduce((n, t) => n + t.issues.filter((i) => i.level === 'error').length, 0);
  const inactive = selected.filter((a) => a.status !== 'ACTIVE');
  const ready = selected.length > 0 && errorCount === 0 && inactive.length === 0 && uploading === 0;

  const body = () => ({
    caption,
    hashtags,
    media: media.map(toPostMedia),
    targets: selected.map((a) => ({ socialAccountId: a.id, captionOverride: targets[a.id]!.captionOverride || null, options: targets[a.id]!.options })),
    sourceDesignId,
    copyAssetId,
  });

  const save = useMutation({
    mutationFn: async () => (postId ? api.social.posts.update(postId, body()) : api.social.posts.create({ workspaceId, ...body() })),
    onSuccess: async (dto) => {
      await qc.invalidateQueries({ queryKey: ['social', 'posts'] });
      qc.setQueryData(['social', 'post', dto.id], dto);
      if (!postId) {
        setPostId(dto.id);
        router.replace(`/marketing/social/${dto.id}`);
      }
    },
  });

  const run = (label: string, action: (id: string) => Promise<SocialPostDto>, after?: () => void) => async () => {
    try {
      const saved = await save.mutateAsync();
      const dto = await action(saved.id);
      qc.setQueryData(['social', 'post', dto.id], dto);
      await qc.invalidateQueries({ queryKey: ['social'] });
      toast.success(label);
      after?.();
      if (post?.id !== dto.id) router.push(`/marketing/social/${dto.id}`);
    } catch (e) {
      toast.error(describeError(e));
    }
  };

  const toggle = (a: SocialAccountDto) =>
    setTargets((t) => {
      const next = { ...t };
      if (next[a.id]) delete next[a.id];
      else next[a.id] = { captionOverride: null, options: a.platform === 'YOUTUBE_CHANNEL' ? { privacy: 'public', madeForKids: false, title: '' } : {} };
      return next;
    });

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      setUploading((n) => n + 1);
      try {
        const m = await uploadPostMedia(file);
        setMedia((list) => [...list, m]);
      } catch (e) {
        toast.error(`${file.name}: ${describeError(e)}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const onDesignRendered = useCallback(
    async (blob: Blob) => {
      const d = rendering;
      setRendering(null);
      if (!d) return;
      setUploading((n) => n + 1);
      try {
        const file = new File([blob], `${d.title || 'design'}.jpg`, { type: 'image/jpeg' });
        const fileId = await uploadFile(file, 'POST_MEDIA');
        setMedia((list) => [...list, { fileId, kind: 'image', mimeType: 'image/jpeg', width: d.width, height: d.height, sizeBytes: file.size, url: URL.createObjectURL(file) }]);
        setSourceDesignId(d.id);
        toast.success(`Added “${d.title}”`);
      } catch (e) {
        toast.error(describeError(e));
      } finally {
        setUploading((n) => n - 1);
      }
    },
    [rendering],
  );
  const onRenderError = useCallback((e: Error) => {
    setRendering(null);
    toast.error(e.name === 'SecurityError' ? 'An image in this design could not be read. Check the storage CORS settings.' : `Could not render the design: ${e.message}`);
  }, []);

  if (org.isPending || settings.isPending || accounts.isPending || workspaces.isPending) return <Skeleton className="h-[32rem]" />;
  // The API also enforces that drafters edit only their own drafts.
  const editable = !post || (['DRAFT', 'PENDING_APPROVAL', 'SCHEDULED'].includes(post.status) && (canPublish || post.status !== 'SCHEDULED'));
  const strictest = selected.length ? Math.min(...selected.map((a) => PLATFORM_RULES[a.platform].maxText)) : null;
  const length = countGraphemes(composeText(caption, hashtags));
  const preview = selected.find((a) => a.id === previewId) ?? selected[0];

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <div className="space-y-6">
        {post?.reviewNote && post.status === 'DRAFT' && !post.approvedAt && (
          <Alert>
            <span className="font-medium">Changes requested:</span> {post.reviewNote}
          </Alert>
        )}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Accounts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(workspaces.data?.data.length ?? 0) > 1 && (
              <div className="max-w-xs space-y-1.5">
                <Label htmlFor="post-workspace">Workspace</Label>
                <Select id="post-workspace" value={workspaceId} disabled={!!postId || !editable} onChange={(e) => setWorkspaceId(e.target.value)}>
                  {workspaces.data!.data.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            {selectable.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No social accounts are connected for this workspace.{' '}
                <Link className="font-medium text-primary underline-offset-2 hover:underline" href="/marketing/accounts">
                  Connect accounts
                </Link>
              </p>
            ) : (
              <fieldset>
                <legend className="sr-only">Post to</legend>
                <div className="flex flex-wrap gap-2">
                  {selectable.map((a) => {
                    const on = !!targets[a.id];
                    const disabled = !editable || (a.status !== 'ACTIVE' && !on);
                    return (
                      <label
                        key={a.id}
                        className={cn(
                          'flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                          on ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
                          disabled && 'cursor-not-allowed opacity-60',
                        )}
                        title={a.status !== 'ACTIVE' ? 'Reconnect this account on the Social Accounts page' : undefined}
                      >
                        <input type="checkbox" className="sr-only" checked={on} disabled={disabled} onChange={() => toggle(a)} aria-label={`${a.name} (${PLATFORM_LABELS[a.platform]})${a.status !== 'ACTIVE' ? ', needs reconnecting' : ''}`} />
                        <PlatformMark platform={a.platform} className="size-6 rounded-md text-[10px]" />
                        <span className="max-w-40 truncate">{a.name}</span>
                        {a.status !== 'ACTIVE' && <Badge tone="warning">Reconnect</Badge>}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">Content</CardTitle>
            {editable && (
              <Button size="sm" variant="outline" onClick={() => setDialog('copy')}>
                <FileText aria-hidden="true" /> Insert copy
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="post-caption">Caption</Label>
                <span className={cn('text-xs', strictest && length > strictest ? 'text-destructive-text' : 'text-muted-foreground')} aria-live="polite">
                  {length.toLocaleString('en-IN')}
                  {strictest ? ` / ${strictest.toLocaleString('en-IN')}` : ''} characters
                </span>
              </div>
              <textarea
                id="post-caption"
                className="min-h-36 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                value={caption}
                disabled={!editable}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Write your post… Mention offers, dates and how to contact you."
              />
            </div>
            <HashtagInput value={hashtags} onChange={setHashtags} disabled={!editable} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">Media</CardTitle>
            {editable && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setDialog('design')}>
                  <Palette aria-hidden="true" /> Add design
                </Button>
                <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-xl border border-border bg-background px-3 text-sm font-medium hover:bg-muted has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                  <Upload className="size-4" aria-hidden="true" /> Upload
                  <input type="file" className="sr-only" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" onChange={(e) => void onFiles(e.target.files).then(() => (e.target.value = ''))} />
                </label>
              </div>
            )}
          </CardHeader>
          <CardContent>
            {media.length === 0 && !uploading && !rendering ? (
              <p className="text-sm text-muted-foreground">Add images or one video. Instagram needs media; YouTube needs a video.</p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Post media">
                {media.map((m, i) => (
                  <li key={`${m.fileId}-${i}`} className="space-y-1.5">
                    <div className="relative aspect-square overflow-hidden rounded-xl border border-border bg-muted">
                      {m.kind === 'image' && m.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.url} alt={m.altText ?? ''} className="size-full object-cover" />
                      ) : m.url ? (
                        <video src={m.url} className="size-full object-cover" muted playsInline aria-label="Uploaded video" />
                      ) : (
                        <div className="grid size-full place-items-center text-xs text-muted-foreground">{m.kind}</div>
                      )}
                      <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 text-[10px] text-white">
                        {m.width}×{m.height}
                        {m.durationSec ? ` · ${Math.round(m.durationSec)} s` : ''}
                      </span>
                      {editable && (
                        <button type="button" className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-full bg-black/70 text-white hover:bg-black" onClick={() => setMedia((l) => l.filter((_, j) => j !== i))} aria-label={`Remove media ${i + 1}`}>
                          <X className="size-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    {m.kind === 'image' && editable && (
                      <Input aria-label={`Alt text for image ${i + 1}`} placeholder="Alt text (describe the image)" className="h-8 text-xs" value={m.altText ?? ''} maxLength={1000} onChange={(e) => setMedia((l) => l.map((x, j) => (j === i ? { ...x, altText: e.target.value || undefined } : x)))} />
                    )}
                  </li>
                ))}
                {(uploading > 0 || rendering) && (
                  <li className="grid aspect-square place-items-center rounded-xl border border-dashed border-border text-sm text-muted-foreground" aria-live="polite">
                    <span className="flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" /> {rendering ? 'Rendering design…' : 'Uploading…'}
                    </span>
                  </li>
                )}
              </ul>
            )}
          </CardContent>
        </Card>

        {selected.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Per-account settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {selected.map((a) => (
                <AccountSettings key={a.id} account={a} state={targets[a.id]!} disabled={!editable} onChange={(s) => setTargets((t) => ({ ...t, [a.id]: s }))} />
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="space-y-4 xl:sticky xl:top-20 xl:self-start">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Checks</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {selected.length === 0 ? (
              <p className="text-muted-foreground">Choose at least one account.</p>
            ) : (
              <ul className="space-y-2" aria-label="Platform checks">
                {selected.map((a) => {
                  const issues = validation.targets.find((t) => t.socialAccountId === a.id)?.issues ?? [];
                  return (
                    <li key={a.id}>
                      <p className="flex items-center gap-2 font-medium">
                        <PlatformMark platform={a.platform} className="size-5 rounded text-[9px]" /> {a.name}
                        {issues.length === 0 && a.status === 'ACTIVE' && <Badge tone="success">Ready</Badge>}
                      </p>
                      <ul className="ml-7 mt-1 space-y-1">
                        {a.status !== 'ACTIVE' && (
                          <li className="flex gap-1.5 text-destructive-text">
                            <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> Reconnect this account before publishing.
                          </li>
                        )}
                        {issues.map((i) => (
                          <li key={i.code} className={cn('flex gap-1.5', i.level === 'error' ? 'text-destructive-text' : 'text-warning-text')}>
                            {i.level === 'error' ? <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />}
                            <span>
                              <span className="sr-only">{i.level === 'error' ? 'Error: ' : 'Warning: '}</span>
                              {i.message}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {preview && (
          <div className="space-y-2">
            {selected.length > 1 && (
              <div className="flex flex-wrap gap-1" role="group" aria-label="Preview account">
                {selected.map((a) => (
                  <button key={a.id} type="button" aria-pressed={preview.id === a.id} onClick={() => setPreviewId(a.id)} className={cn('rounded-lg border px-2 py-1 text-xs', preview.id === a.id ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted')}>
                    {PLATFORM_LABELS[a.platform]}
                  </button>
                ))}
              </div>
            )}
            <PostPreview platform={preview.platform} accountName={preview.name} caption={caption} hashtags={hashtags} override={targets[preview.id]?.captionOverride} media={media} options={targets[preview.id]?.options} />
          </div>
        )}

        {editable && (
          <Card>
            <CardContent className="space-y-2 p-4">
              {post?.scheduledAt && post.status === 'SCHEDULED' && <p className="text-sm text-muted-foreground">Scheduled for {formatInZone(post.scheduledAt, post.timezone ?? tz)}.</p>}
              {requireApproval && !approved && canPublish && !pending && <p className="text-xs text-muted-foreground">Approval is required before scheduling or publishing.</p>}
              {!canPublish && <p className="text-xs text-muted-foreground">A manager reviews and schedules posts you submit.</p>}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={save.isPending || uploading > 0 || !workspaceId} onClick={() => save.mutate(undefined, { onSuccess: () => toast.success('Draft saved'), onError: (e) => toast.error(describeError(e)) })}>
                  {save.isPending ? 'Saving…' : status === 'SCHEDULED' ? 'Save changes' : 'Save draft'}
                </Button>
                {status === 'DRAFT' && (!canPublish || (requireApproval && !approved)) && (
                  <Button disabled={!ready || save.isPending} onClick={run('Submitted for approval', (id) => api.social.posts.submit(id))}>
                    <Send aria-hidden="true" /> Submit for approval
                  </Button>
                )}
                {canPublish && !pending && (!requireApproval || approved) && (
                  <>
                    <Button variant="outline" disabled={!ready} onClick={() => setDialog('schedule')}>
                      <CalendarClock aria-hidden="true" /> {status === 'SCHEDULED' ? 'Reschedule' : 'Schedule'}
                    </Button>
                    <Button disabled={!ready} onClick={() => setDialog('publish')}>
                      <Send aria-hidden="true" /> Publish now
                    </Button>
                  </>
                )}
              </div>
              {!ready && selected.length > 0 && errorCount > 0 && <p className="text-xs text-destructive-text">Fix {errorCount} problem{errorCount === 1 ? '' : 's'} above to continue.</p>}
            </CardContent>
          </Card>
        )}
      </div>

      {rendering && <DesignRenderer design={rendering} onDone={onDesignRendered} onError={onRenderError} />}

      <ScheduleDialog
        open={dialog === 'schedule'}
        timezone={tz}
        initial={post?.scheduledAt ?? prefill?.at ?? nextSlot()}
        onClose={() => setDialog(null)}
        onConfirm={(iso) => run(`Scheduled for ${formatInZone(iso, tz)}`, (id) => api.social.posts.schedule(id, { scheduledAt: iso, timezone: tz }), () => setDialog(null))()}
      />
      <Dialog open={dialog === 'publish'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent title="Publish now?" description="This posts immediately to the accounts below. It can't be undone from here once published.">
          <ul className="mt-4 space-y-2">
            {selected.map((a) => (
              <li key={a.id} className="flex items-center gap-2 text-sm">
                <PlatformMark platform={a.platform} className="size-6 rounded-md text-[10px]" /> {a.name} <span className="text-muted-foreground">· {PLATFORM_LABELS[a.platform]}</span>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button onClick={run('Publishing started', (id) => api.social.posts.publishNow(id), () => setDialog(null))}>
              Publish to {selected.length} account{selected.length === 1 ? '' : 's'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <CopyPicker
        open={dialog === 'copy'}
        onClose={() => setDialog(null)}
        onPick={(c) => {
          setCaption(c.content);
          setHashtags(normalizeHashtags(c.hashtags));
          setCopyAssetId(c.id);
          setDialog(null);
        }}
      />
      <DesignPicker
        open={dialog === 'design'}
        workspaceId={workspaceId}
        onClose={() => setDialog(null)}
        onPick={async (id) => {
          setDialog(null);
          try {
            setRendering(await api.designs.get(id));
          } catch (e) {
            toast.error(describeError(e));
          }
        }}
      />
    </div>
  );
}

function HashtagInput({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState('');
  const id = useId();
  const commit = () => {
    if (!draft.trim()) return;
    onChange(normalizeHashtags([...value, ...draft.split(/[\s,]+/)]));
    setDraft('');
  };
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Hashtags</Label>
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-input bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring">
        {value.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {t}
            {!disabled && (
              <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Remove ${t}`}>
                <X className="size-3" aria-hidden="true" />
              </button>
            )}
          </span>
        ))}
        <input
          id={id}
          className="min-w-32 flex-1 bg-transparent px-1 py-1 text-sm outline-none"
          value={draft}
          disabled={disabled}
          placeholder={value.length ? '' : 'Type a tag and press Enter'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={commit}
        />
      </div>
      <p className="text-xs text-muted-foreground">Added to the end of the post unless already in the caption.</p>
    </div>
  );
}

function AccountSettings({ account: a, state, disabled, onChange }: { account: SocialAccountDto; state: TargetState; disabled: boolean; onChange: (s: TargetState) => void }) {
  const [open, setOpen] = useState(!!state.captionOverride || a.platform === 'YOUTUBE_CHANNEL');
  const id = useId();
  const opt = state.options;
  return (
    <div className="rounded-xl border border-border">
      <button type="button" className="flex w-full items-center gap-2 p-3 text-left text-sm font-medium" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <PlatformMark platform={a.platform} className="size-6 rounded-md text-[10px]" />
        <span className="flex-1 truncate">{a.name}</span>
        {state.captionOverride && <Badge tone="primary">Custom text</Badge>}
        <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {open && (
        <div id={id} className="space-y-3 border-t border-border p-3">
          {a.platform === 'YOUTUBE_CHANNEL' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor={`${id}-title`}>Video title</Label>
                <Input id={`${id}-title`} maxLength={100} value={opt.title ?? ''} disabled={disabled} onChange={(e) => onChange({ ...state, options: { ...opt, title: e.target.value } })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-privacy`}>Visibility</Label>
                <Select id={`${id}-privacy`} value={opt.privacy ?? 'public'} disabled={disabled} onChange={(e) => onChange({ ...state, options: { ...opt, privacy: e.target.value as TargetOptions['privacy'] } })}>
                  {YOUTUBE_PRIVACY.map((p) => (
                    <option key={p} value={p}>
                      {p[0]!.toUpperCase() + p.slice(1)}
                    </option>
                  ))}
                </Select>
              </div>
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium">Made for kids?</legend>
                <div className="flex gap-4 pt-2 text-sm">
                  {[false, true].map((v) => (
                    <label key={String(v)} className="flex items-center gap-1.5">
                      <input type="radio" name={`${id}-kids`} className="accent-[var(--color-primary)]" checked={opt.madeForKids === v} disabled={disabled} onChange={() => onChange({ ...state, options: { ...opt, madeForKids: v } })} />
                      {v ? 'Yes' : 'No'}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-text`}>{a.platform === 'YOUTUBE_CHANNEL' ? 'Description' : 'Text for this account'} (optional)</Label>
            <textarea
              id={`${id}-text`}
              className="min-h-24 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              placeholder="Leave empty to use the main caption"
              value={state.captionOverride ?? ''}
              disabled={disabled}
              onChange={(e) => onChange({ ...state, captionOverride: e.target.value || null })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ScheduleDialog({ open, timezone, initial, onClose, onConfirm }: { open: boolean; timezone: string; initial: string; onClose: () => void; onConfirm: (iso: string) => void }) {
  const [value, setValue] = useState(() => toLocalInput(initial, timezone));
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when reopened
    if (open) setValue(toLocalInput(new Date(initial).getTime() > Date.now() + 60_000 ? initial : nextSlot(), timezone));
  }, [open, initial, timezone]);
  const iso = value ? fromLocalInput(value, timezone) : null;
  const userTz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : timezone;
  const now = useNow();
  const past = iso ? new Date(iso).getTime() <= now : true;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Schedule post" description={`Times are in your organization's time zone (${timezone}).`}>
        <div className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="schedule-at">Date and time</Label>
            <Input id="schedule-at" type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
          {iso && userTz !== timezone && <p className="text-xs text-muted-foreground">That is {formatInZone(iso, userTz)} your time ({userTz}).</p>}
          {past && <p className="text-xs text-destructive-text">Choose a time in the future.</p>}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!iso || past} onClick={() => iso && onConfirm(iso)}>
            <CalendarClock aria-hidden="true" /> Schedule
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CopyPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (c: { id: string; content: string; hashtags: string[] }) => void }) {
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['copy-assets', 'picker', q], queryFn: () => api.copyAssets.list({ pageSize: 20, q: q || undefined }), enabled: open });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Insert copy" description="Use a caption saved in the AI Copywriter library. It replaces the current caption." className="max-w-2xl">
        <Input className="mt-4" aria-label="Search copy" placeholder="Search saved copy…" value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="mt-3 max-h-96 space-y-2 overflow-y-auto">
          {list.isPending ? (
            <Skeleton className="h-24" />
          ) : !list.data?.data.length ? (
            <li className="text-sm text-muted-foreground">
              Nothing saved yet. Create copy in the{' '}
              <Link className="font-medium text-primary underline-offset-2 hover:underline" href="/studio/copywriter">
                AI Copywriter
              </Link>
              .
            </li>
          ) : (
            list.data.data.map((c) => (
              <li key={c.id}>
                <button type="button" className="w-full rounded-xl border border-border p-3 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onPick(c)}>
                  <span className="line-clamp-3 whitespace-pre-wrap">{c.content}</span>
                  {c.hashtags.length > 0 && <span className="mt-1 block truncate text-xs text-primary">{c.hashtags.join(' ')}</span>}
                </button>
              </li>
            ))
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

export function DesignPicker({ open, workspaceId, onClose, onPick }: { open: boolean; workspaceId: string; onClose: () => void; onPick: (id: string) => void }) {
  const list = useQuery({ queryKey: ['designs', 'picker', workspaceId], queryFn: () => api.designs.list({ pageSize: 24, workspaceId: workspaceId || undefined }), enabled: open });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Add a design" description="The design is rendered at full size and added as a JPEG image." className="max-w-3xl">
        <ul className="mt-4 grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
          {list.isPending ? (
            <Skeleton className="h-40" />
          ) : !list.data?.data.filter((d) => d.status !== 'GENERATING' && d.status !== 'FAILED').length ? (
            <li className="col-span-full text-sm text-muted-foreground">
              No finished designs yet.{' '}
              <Link className="font-medium text-primary underline-offset-2 hover:underline" href="/studio/design">
                Create one
              </Link>
              .
            </li>
          ) : (
            list.data.data
              .filter((d) => d.status !== 'GENERATING' && d.status !== 'FAILED')
              .map((d) => (
                <li key={d.id}>
                  <button type="button" className="w-full overflow-hidden rounded-xl border border-border text-left hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onPick(d.id)}>
                    <span className="block aspect-square bg-muted">
                      {d.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={d.thumbnailUrl} alt="" className="size-full object-contain" />
                      ) : (
                        <ImagePlus className="m-auto mt-12 size-6 text-muted-foreground" aria-hidden="true" />
                      )}
                    </span>
                    <span className="block truncate p-2 text-sm font-medium">{d.title}</span>
                    <span className="block px-2 pb-2 text-xs text-muted-foreground">
                      {d.width}×{d.height}
                    </span>
                  </button>
                </li>
              ))
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

