import type { Metadata } from 'next';
import { Megaphone } from 'lucide-react';
import { Suspense } from 'react';
import { PageHeader } from '@zatma/ui';
import { CampaignBuilder } from '@/components/ads/builder';

export const metadata: Metadata = { title: 'New campaign' };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader icon={<Megaphone />} title="New campaign" description="Build a campaign step by step. It is created paused; an Owner or Admin decides when it starts spending." />
      <Suspense>
        <CampaignBuilder />
      </Suspense>
    </div>
  );
}
