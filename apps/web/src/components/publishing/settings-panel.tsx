'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorState, Skeleton } from '@zatma/ui';
import { api } from '@/lib/api';
import { describeError } from './shared';

/** Settings → Publishing: approval policy. */
export function PublishingSettingsPanel() {
  const qc = useQueryClient();
  const org = useQuery({ queryKey: ['organization', 'current'], queryFn: api.organizations.current });
  const settings = useQuery({ queryKey: ['social', 'settings'], queryFn: api.social.settings });
  const save = useMutation({
    mutationFn: (requireApproval: boolean) => api.social.updateSettings({ requireApproval }),
    onSuccess: (data) => {
      qc.setQueryData(['social', 'settings'], data);
      toast.success(data.requireApproval ? 'Approval is now required for every post' : 'Publishers can post without approval');
    },
    onError: (e) => toast.error(describeError(e)),
  });
  if (settings.isPending || org.isPending) return <Skeleton className="h-40" />;
  if (settings.isError) return <ErrorState description="Couldn't load publishing settings." onRetry={() => void settings.refetch()} />;
  const canEdit = !!org.data?.permissions.includes('organization:update') && settings.data.canPublish;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Approvals</CardTitle>
        <CardDescription>Designers and other contributors always submit posts for review. Owners, Admins and Marketing Managers publish directly unless you require approval for everyone.</CardDescription>
      </CardHeader>
      <CardContent>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-primary)]" checked={settings.data.requireApproval} disabled={!canEdit || save.isPending} onChange={(e) => save.mutate(e.target.checked)} />
          <span>
            <span className="font-medium">Require approval for every post</span>
            <span className="block text-muted-foreground">A second person must approve before a post can be scheduled or published. Owners and Admins may approve their own posts.</span>
          </span>
        </label>
        {!canEdit && <p className="mt-3 text-xs text-muted-foreground">Only Owners and Admins can change this.</p>}
      </CardContent>
    </Card>
  );
}
