'use client';

import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@zatma/ui';
import { api } from '@/lib/api';
import { CampaignCalendar } from './campaign-calendar';

export function OrgCampaignCalendar() {
  const org = useQuery({ queryKey: ['organization', 'current'], queryFn: api.organizations.current });
  if (!org.data) return <Skeleton className="h-96" />;
  return <CampaignCalendar timezone={org.data.timezone ?? 'Asia/Kolkata'} />;
}
