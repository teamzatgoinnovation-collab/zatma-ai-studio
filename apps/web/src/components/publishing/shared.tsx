'use client';

import { Badge } from '@zatma/ui';
import { POST_STATUS_LABELS, type PostStatus, type TargetStatus } from '@zatma/validation';
import { POST_TONE, TARGET_LABEL } from '@/lib/publishing';

export function PostStatusBadge({ status, className }: { status: PostStatus; className?: string }) {
  return (
    <Badge tone={POST_TONE[status]} className={className}>
      {POST_STATUS_LABELS[status]}
    </Badge>
  );
}

export function TargetStatusBadge({ status }: { status: TargetStatus }) {
  const s = TARGET_LABEL[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export const describeError = (e: unknown) => (e as Error)?.message ?? 'Something went wrong';
