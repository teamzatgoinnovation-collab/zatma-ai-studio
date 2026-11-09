'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, FilePlus2, ImageIcon, Loader2, MoreVertical, Search, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@zatma/sdk';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  Input,
  Label,
  Select,
  Skeleton,
} from '@zatma/ui';
import { SIZE_PRESET_IDS, SIZE_PRESETS, type DesignSummary, type SizePresetId } from '@zatma/validation';
import { api } from '@/lib/api';

const describeError = (e: unknown) => (e instanceof ApiError ? e.message : (e as Error).message);

export function DesignThumb({ url, width, height, title }: { url: string | null; width: number; height: number; title: string }) {
  return (
    <div className="grid aspect-square place-items-center overflow-hidden rounded-xl bg-muted">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={`Preview of ${title}`} className="max-h-full max-w-full object-contain" style={{ aspectRatio: `${width} / ${height}` }} loading="lazy" />
      ) : (
        <ImageIcon className="size-8 text-muted-foreground" aria-hidden="true" />
      )}
    </div>
  );
}

const STATUS: Record<DesignSummary['status'], { label: string; tone: 'neutral' | 'primary' | 'success' | 'danger' } | null> = {
  DRAFT: null,
  READY: null,
  GENERATING: { label: 'Generating', tone: 'primary' },
  FAILED: { label: 'Failed', tone: 'danger' },
};

export function DesignLibrary() {
  const qc = useQueryClient();
  const router = useRouter();
  const [q, setQ] = useState('');
  const query = useDeferredValue(q.trim());
  const [page, setPage] = useState(1);
  const [blankOpen, setBlankOpen] = useState(false);
  const [blankSize, setBlankSize] = useState<SizePresetId>('instagram_post');
  const [deleting, setDeleting] = useState<DesignSummary | null>(null);

  const org = useQuery({ queryKey: ['organization', 'current'], queryFn: api.organizations.current });
  const canWrite = org.data?.permissions.includes('design:write') ?? false;
  const list = useQuery({
    queryKey: ['designs', { q: query, page }],
    queryFn: () => api.designs.list({ q: query || undefined, page, pageSize: 24 }),
    refetchInterval: (s) => (s.state.data?.data.some((d) => d.status === 'GENERATING') ? 3000 : false),
  });

  const createBlank = useMutation({
    mutationFn: () => api.designs.create({ sizePreset: blankSize, title: `Untitled ${SIZE_PRESETS[blankSize].label}` }),
    onSuccess: (d) => router.push(`/studio/design/${d.id}`),
    onError: (e) => toast.error(describeError(e)),
  });
  const duplicate = useMutation({
    mutationFn: (id: string) => api.designs.duplicate(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['designs'] });
      toast.success('Design duplicated');
    },
    onError: (e) => toast.error(describeError(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.designs.remove(id),
    onSuccess: async () => {
      setDeleting(null);
      await qc.invalidateQueries({ queryKey: ['designs'] });
      toast.success('Design deleted');
    },
    onError: (e) => toast.error(describeError(e)),
  });

  return (
    <section aria-labelledby="library-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="library-heading" className="text-lg font-semibold">
          Your designs
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Label htmlFor="design-search" className="sr-only">
              Search designs
            </Label>
            <Input
              id="design-search"
              type="search"
              placeholder="Search designs"
              className="w-56 pl-9"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </div>
          {canWrite && (
            <Button variant="outline" onClick={() => setBlankOpen(true)}>
              <FilePlus2 aria-hidden="true" /> Blank design
            </Button>
          )}
        </div>
      </div>

      {list.isPending ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="aspect-[4/5]" />
          ))}
        </div>
      ) : list.isError ? (
        <ErrorState description="Couldn't load your designs." onRetry={() => void list.refetch()} />
      ) : list.data.data.length === 0 ? (
        <EmptyState
          icon={<ImageIcon />}
          title={query ? 'No designs match your search' : 'No designs yet'}
          description={query ? 'Try a different word from the title.' : 'Generate your first design above, or start from a blank canvas or a template.'}
        />
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {list.data.data.map((d) => {
              const status = STATUS[d.status];
              return (
                <li key={d.id} className="group relative rounded-2xl border border-border bg-card p-2 transition-shadow hover:shadow-md">
                  <Link href={`/studio/design/${d.id}`} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <DesignThumb url={d.thumbnailUrl} width={d.width} height={d.height} title={d.title} />
                    <div className="px-1 pb-1 pt-2">
                      <p className="truncate text-sm font-medium">{d.title}</p>
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {status ? (
                          <Badge tone={status.tone} className="px-1.5 py-0">
                            {d.status === 'GENERATING' && <Loader2 className="mr-1 size-3 animate-spin" aria-hidden="true" />}
                            {status.label}
                          </Badge>
                        ) : (
                          (SIZE_PRESETS[d.sizePreset as SizePresetId]?.label ?? `${d.width}×${d.height}`)
                        )}
                      </p>
                    </div>
                  </Link>
                  {canWrite && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="secondary" size="icon" className="absolute right-3 top-3 size-8 opacity-90 shadow" aria-label={`Actions for ${d.title}`}>
                          <MoreVertical aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem disabled={d.status !== 'READY'} onSelect={() => duplicate.mutate(d.id)}>
                          <Copy aria-hidden="true" /> Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onSelect={() => setDeleting(d)}>
                          <Trash2 aria-hidden="true" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </li>
              );
            })}
          </ul>
          {list.data.meta.total > list.data.meta.pageSize && (
            <nav className="flex items-center justify-center gap-2" aria-label="Design pages">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {Math.ceil(list.data.meta.total / list.data.meta.pageSize)}
              </span>
              <Button variant="outline" size="sm" disabled={page * list.data.meta.pageSize >= list.data.meta.total} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </nav>
          )}
        </>
      )}

      <Dialog open={blankOpen} onOpenChange={setBlankOpen}>
        <DialogContent title="New blank design" description="Pick a size; you can add text, shapes and images in the editor.">
          <form
            className="mt-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              createBlank.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="blank-size">Size</Label>
              <Select id="blank-size" value={blankSize} onChange={(e) => setBlankSize(e.target.value as SizePresetId)}>
                {SIZE_PRESET_IDS.map((id) => (
                  <option key={id} value={id}>
                    {SIZE_PRESETS[id].label} ({SIZE_PRESETS[id].width}×{SIZE_PRESETS[id].height})
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setBlankOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createBlank.isPending}>
                Create
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent title="Delete design?" description={deleting ? `“${deleting.title}” will be removed from your library.` : undefined}>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => deleting && remove.mutate(deleting.id)}>
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
