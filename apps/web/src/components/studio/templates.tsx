'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutTemplate, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@zatma/sdk';
import { Badge, Button, Dialog, DialogContent, EmptyState, ErrorState, Skeleton } from '@zatma/ui';
import { SIZE_PRESETS, type SizePresetId, type TemplateSummary } from '@zatma/validation';
import { api } from '@/lib/api';
import { DesignThumb } from './design-library';

const describeError = (e: unknown) => (e instanceof ApiError ? e.message : (e as Error).message);

export function TemplateGallery() {
  const router = useRouter();
  const qc = useQueryClient();
  const org = useQuery({ queryKey: ['organization', 'current'], queryFn: api.organizations.current });
  const templates = useQuery({ queryKey: ['templates'], queryFn: api.templates.list });
  const canWrite = org.data?.permissions.includes('design:write') ?? false;
  const [deleting, setDeleting] = useState<TemplateSummary | null>(null);

  const use = useMutation({
    mutationFn: (t: TemplateSummary) => api.designs.create({ templateId: t.id, title: t.name, sizePreset: t.sizePreset as SizePresetId }),
    onSuccess: (d) => router.push(`/studio/design/${d.id}`),
    onError: (e) => toast.error(describeError(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.templates.remove(id),
    onSuccess: async () => {
      setDeleting(null);
      await qc.invalidateQueries({ queryKey: ['templates'] });
      toast.success('Template deleted');
    },
    onError: (e) => toast.error(describeError(e)),
  });

  if (templates.isPending) return <Skeleton className="h-64" />;
  if (templates.isError) return <ErrorState description="Couldn't load templates." onRetry={() => void templates.refetch()} />;
  if (templates.data.length === 0) {
    return (
      <EmptyState
        icon={<LayoutTemplate />}
        title="No templates yet"
        description="Open any design and choose “Save as template” to reuse its layout for future campaigns."
        action={
          <Button asChild>
            <Link href="/studio/design">Go to designs</Link>
          </Button>
        }
      />
    );
  }

  const byCategory = Map.groupBy(templates.data, (t) => t.category);
  return (
    <div className="space-y-8">
      {[...byCategory.entries()].map(([category, items]) => (
        <section key={category} aria-labelledby={`cat-${category}`} className="space-y-3">
          <h2 id={`cat-${category}`} className="text-lg font-semibold">
            {category}
          </h2>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {items.map((t) => (
              <li key={t.id} className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-2">
                <DesignThumb url={t.thumbnailUrl} width={t.width} height={t.height} title={t.name} />
                <div className="px-1">
                  <p className="truncate text-sm font-medium">{t.name}</p>
                  <Badge className="mt-1">{SIZE_PRESETS[t.sizePreset as SizePresetId]?.label ?? `${t.width}×${t.height}`}</Badge>
                </div>
                {canWrite && (
                  <div className="mt-auto flex gap-1">
                    <Button size="sm" className="flex-1" disabled={use.isPending} onClick={() => use.mutate(t)}>
                      Use template
                    </Button>
                    <Button size="sm" variant="ghost" aria-label={`Delete template ${t.name}`} onClick={() => setDeleting(t)}>
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent title="Delete template?" description={deleting ? `“${deleting.name}” will no longer be available. Designs made from it are not affected.` : undefined}>
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
    </div>
  );
}
