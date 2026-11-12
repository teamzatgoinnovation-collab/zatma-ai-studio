'use client';

import { useQuery } from '@tanstack/react-query';
import { ErrorState, Skeleton } from '@zatma/ui';
import { api } from '@/lib/api';
import { CampaignBuilder } from './builder';

export function EditCampaign({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['ads', 'campaign', id], queryFn: () => api.ads.campaigns.get(id) });
  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorState description="Couldn't load this campaign." onRetry={() => void q.refetch()} />;
  return <CampaignBuilder campaign={q.data} />;
}
