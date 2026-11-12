import type { Metadata } from 'next';
import { Megaphone } from 'lucide-react';
import { Suspense } from 'react';
import { PageHeader } from '@zatma/ui';
import { CampaignsList } from '@/components/ads/campaigns-list';

export const metadata: Metadata = { title: 'Ad Campaigns' };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader icon={<Megaphone />} title="Ad Campaigns" description="Every paid campaign across Meta and Google, with spend and limits." />
      <Suspense>
        <CampaignsList />
      </Suspense>
    </div>
  );
}
