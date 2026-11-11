'use client';

import { Film, Images } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@zatma/ui';
import { composeText, PLATFORM_LABELS, type SocialPlatform, type TargetOptions } from '@zatma/validation';
import { PlatformMark } from '@/components/social/accounts';
import type { ComposerMedia } from './media';

/** Characters shown before each platform's "…more" cut-off (approximate, from the apps' feeds). */
const FOLD: Record<SocialPlatform, number> = { FACEBOOK_PAGE: 477, INSTAGRAM_BUSINESS: 125, LINKEDIN_PAGE: 210, YOUTUBE_CHANNEL: 100 };

function Text({ text, fold }: { text: string; fold: number }) {
  const [open, setOpen] = useState(false);
  const chars = Array.from(text);
  if (open || chars.length <= fold) return <p className="whitespace-pre-wrap break-words text-sm">{text || <span className="text-muted-foreground">No text</span>}</p>;
  return (
    <p className="whitespace-pre-wrap break-words text-sm">
      {chars.slice(0, fold).join('')}…{' '}
      <button type="button" className="font-medium text-muted-foreground underline-offset-2 hover:underline" onClick={() => setOpen(true)}>
        more
      </button>
    </p>
  );
}

function Media({ media, square }: { media: ComposerMedia[]; square?: boolean }) {
  const first = media[0];
  if (!first) return null;
  return (
    <div className={cn('relative overflow-hidden bg-muted', square ? 'aspect-square' : 'aspect-[4/3]')}>
      {first.kind === 'image' && first.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={first.url} alt={first.altText ?? ''} className="size-full object-cover" />
      ) : first.kind === 'video' && first.url ? (
        <video src={first.url} className="size-full object-cover" muted playsInline aria-label="Video preview" />
      ) : (
        <div className="grid size-full place-items-center text-muted-foreground">{first.kind === 'video' ? <Film aria-hidden="true" /> : <Images aria-hidden="true" />}</div>
      )}
      {media.length > 1 && (
        <span className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-xs font-medium text-white">
          1/{media.length}
        </span>
      )}
      {first.kind === 'video' && <span className="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">{first.durationSec ? `${Math.floor(first.durationSec / 60)}:${String(Math.round(first.durationSec % 60)).padStart(2, '0')}` : 'Video'}</span>}
    </div>
  );
}

/** Neutral, platform-shaped preview of how one account's post will read (not a pixel copy of any app). */
export function PostPreview({
  platform,
  accountName,
  caption,
  hashtags,
  override,
  media,
  options,
}: {
  platform: SocialPlatform;
  accountName: string;
  caption: string;
  hashtags: string[];
  override?: string | null;
  media: ComposerMedia[];
  options?: TargetOptions;
}) {
  const text = composeText(caption, hashtags, override);
  const header = (
    <div className="flex items-center gap-2 p-3">
      <PlatformMark platform={platform} className="size-8 rounded-lg text-xs" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{accountName}</p>
        <p className="text-xs text-muted-foreground">{PLATFORM_LABELS[platform]} · Preview</p>
      </div>
    </div>
  );
  return (
    <figure className="overflow-hidden rounded-2xl border border-border bg-card" aria-label={`${PLATFORM_LABELS[platform]} preview for ${accountName}`}>
      {platform === 'YOUTUBE_CHANNEL' ? (
        <>
          <Media media={media} />
          <div className="space-y-1 p-3">
            <p className="font-medium">{options?.title || <span className="text-muted-foreground">Video title</span>}</p>
            <p className="text-xs text-muted-foreground">
              {accountName} · {options?.privacy ? options.privacy[0]!.toUpperCase() + options.privacy.slice(1) : 'Privacy not set'}
            </p>
            <Text text={text} fold={FOLD[platform]} />
          </div>
        </>
      ) : platform === 'INSTAGRAM_BUSINESS' ? (
        <>
          {header}
          <Media media={media} square />
          <div className="p-3">
            <Text text={text} fold={FOLD[platform]} />
          </div>
        </>
      ) : (
        <>
          {header}
          <div className="px-3 pb-3">
            <Text text={text} fold={FOLD[platform]} />
          </div>
          <Media media={media} />
        </>
      )}
    </figure>
  );
}
