'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarX, Check, Copy, ExternalLink, RotateCcw, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button, Card, CardContent, CardHeader, CardTitle, Dialog, DialogContent, ErrorState, Label, Skeleton } from '@zatma/ui';
import { EDITABLE_POST_STATUSES, PLATFORM_LABELS, type SocialPostDto } from '@zatma/validation';
import { api } from '@/lib/api';
import { formatInZone } from '@/lib/publishing';
import { PlatformMark } from '@/components/social/accounts';
import { Composer, type ComposerPrefill } from './composer';
import { PostPreview } from './previews';
import { describeError, PostStatusBadge, TargetStatusBadge } from './shared';

/** New post: the composer alone (prefilled from a design, copy item or calendar slot). */
export function NewPostPage({ prefill }: { prefill: ComposerPrefill }) {
  return <Composer prefill={prefill} />;
}

/** Existing post: composer while editable, otherwise a read-only view, plus status and actions. */
export function PostPage({ id }: { id: string }) {
  const post = useQuery({
    queryKey: ['social', 'post', id],
    queryFn: () => api.social.posts.get(id),
    // Keep the status fresh while the queue is working on it.
    refetchInterval: (q) => (q.state.data && ['PUBLISHING', 'SCHEDULED'].includes(q.state.data.status) ? 3_000 : false),
  });
  const org = useQuery({ queryKey: ['organization', 'current'], queryFn: api.organizations.current });
  if (post.isPending) return <Skeleton className="h-[32rem]" />;
  if (post.isError) return <ErrorState description="Couldn't load this post." onRetry={() => void post.refetch()} />;
  const p = post.data;
  const tz = p.timezone ?? org.data?.timezone ?? 'Asia/Kolkata';
  const editable = EDITABLE_POST_STATUSES.includes(p.status);
  return (
    <div className="space-y-6">
      <StatusPanel post={p} timezone={tz} />
      {editable ? <Composer key={`${p.id}-${p.revision}-${p.status}`} post={p} /> : <ReadOnlyPost post={p} />}
    </div>
  );
}

function ReadOnlyPost({ post }: { post: SocialPostDto }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {post.targets.map((t) => (
        <PostPreview key={t.id} platform={t.platform} accountName={t.account.name} caption={post.caption} hashtags={post.hashtags} override={t.captionOverride} media={post.media} options={t.options} />
      ))}
    </div>
  );
}

function StatusPanel({ post: p, timezone }: { post: SocialPostDto; timezone: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const settings = useQuery({ queryKey: ['social', 'settings'], queryFn: api.social.settings });
  const canPublish = settings.data?.canPublish ?? false;
  const canDraft = settings.data?.canDraft ?? false;
  const [review, setReview] = useState<'approve' | 'reject' | null>(null);
  const [note, setNote] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const act = useMutation({
    mutationFn: (fn: () => Promise<SocialPostDto | void>) => fn(),
    onSuccess: async (dto) => {
      if (dto) qc.setQueryData(['social', 'post', dto.id], dto);
      await qc.invalidateQueries({ queryKey: ['social'] });
    },
    onError: (e) => toast.error(describeError(e)),
  });
  const run = (fn: () => Promise<SocialPostDto | void>, ok: string) => act.mutate(fn, { onSuccess: () => toast.success(ok) });

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            Status <PostStatusBadge status={p.status} />
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {p.status === 'SCHEDULED' && p.scheduledAt ? `Publishes ${formatInZone(p.scheduledAt, timezone)} (${timezone})` : p.publishedAt ? `Published ${formatInZone(p.publishedAt, timezone)}` : p.status === 'PENDING_APPROVAL' ? 'Waiting for a manager to review' : p.status === 'PUBLISHING' ? 'Publishing to the selected accounts…' : 'Not scheduled'}
            {p.createdBy ? ` · Created by ${p.createdBy.name}` : ''}
            {p.approvedBy ? ` · Approved by ${p.approvedBy.name}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canPublish && p.status === 'PENDING_APPROVAL' && (
            <>
              <Button size="sm" onClick={() => setReview('approve')}>
                <Check aria-hidden="true" /> Approve
              </Button>
              <Button size="sm" variant="outline" onClick={() => setReview('reject')}>
                <X aria-hidden="true" /> Request changes
              </Button>
            </>
          )}
          {canPublish && p.status === 'SCHEDULED' && (
            <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => run(() => api.social.posts.cancel(p.id), 'Schedule canceled; the post is a draft again')}>
              <CalendarX aria-hidden="true" /> Unschedule
            </Button>
          )}
          {canDraft && (
            <Button
              size="sm"
              variant="outline"
              disabled={act.isPending}
              onClick={() =>
                act.mutate(() => api.social.posts.duplicate(p.id), {
                  onSuccess: (dto) => {
                    toast.success('Copied to a new draft');
                    if (dto) router.push(`/marketing/social/${dto.id}`);
                  },
                })
              }
            >
              <Copy aria-hidden="true" /> Duplicate
            </Button>
          )}
          {canDraft && p.status !== 'PUBLISHING' && (
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)} aria-label="Delete post">
              <Trash2 aria-hidden="true" /> Delete
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {p.targets.length > 0 && (
          <ul className="divide-y divide-border rounded-xl border border-border" aria-label="Accounts">
            {p.targets.map((t) => (
              <li key={t.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <PlatformMark platform={t.platform} className="size-7 rounded-md text-[10px]" />
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <span className="truncate">{t.account.name}</span>
                      {!EDITABLE_POST_STATUSES.includes(p.status) && <TargetStatusBadge status={t.status} />}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {PLATFORM_LABELS[t.platform]}
                      {t.publishedAt ? ` · ${formatInZone(t.publishedAt, timezone)}` : ''}
                      {t.errorCode === 'RETRYING' ? ` · Retrying (attempt ${t.attempts + 1})` : ''}
                    </p>
                    {t.status === 'FAILED' && t.error && <p className="mt-1 text-xs text-destructive-text">{t.error}</p>}
                  </div>
                </div>
                <div className="flex gap-2">
                  {t.externalUrl && (
                    <a className="inline-flex h-8 items-center gap-1 rounded-xl border border-border px-3 text-sm font-medium hover:bg-muted" href={t.externalUrl} target="_blank" rel="noreferrer">
                      View post <ExternalLink className="size-3.5" aria-hidden="true" />
                      <span className="sr-only">on {PLATFORM_LABELS[t.platform]} (opens in a new tab)</span>
                    </a>
                  )}
                  {canPublish && t.status === 'FAILED' && (
                    <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => run(() => api.social.posts.retry(p.id, t.id), `Retrying ${t.account.name}`)}>
                      <RotateCcw aria-hidden="true" /> Retry
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={!!review} onOpenChange={(o) => !o && setReview(null)}>
        <DialogContent title={review === 'approve' ? 'Approve post' : 'Request changes'} description={review === 'approve' ? 'The author is notified and the post can then be scheduled.' : 'Tell the author what to change. They are notified by email.'}>
          <div className="mt-4 space-y-1.5">
            <Label htmlFor="review-note">{review === 'approve' ? 'Note (optional)' : 'What needs to change?'}</Label>
            <textarea id="review-note" className="min-h-24 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setReview(null)}>
              Cancel
            </Button>
            <Button
              disabled={act.isPending || (review === 'reject' && !note.trim())}
              onClick={() =>
                act.mutate(() => (review === 'approve' ? api.social.posts.approve(p.id, note.trim() || undefined) : api.social.posts.reject(p.id, note.trim())), {
                  onSuccess: () => {
                    toast.success(review === 'approve' ? 'Approved' : 'Sent back to the author');
                    setReview(null);
                    setNote('');
                  },
                })
              }
            >
              {review === 'approve' ? 'Approve' : 'Send back'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent title="Delete post?" description={p.status === 'PUBLISHED' || p.status === 'PARTIALLY_PUBLISHED' ? 'This removes it from ZatGo only. Posts already on the platforms stay there.' : 'This removes the post and its schedule.'}>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={act.isPending}
              onClick={() =>
                act.mutate(() => api.social.posts.remove(p.id), {
                  onSuccess: () => {
                    toast.success('Post deleted');
                    router.push('/marketing/social');
                  },
                })
              }
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
