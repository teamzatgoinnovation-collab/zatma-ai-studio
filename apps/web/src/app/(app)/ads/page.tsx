import type { Metadata } from 'next';
import { Target } from 'lucide-react';
import { Suspense } from 'react';
import { PageHeader } from '@zatma/ui';
import { CampaignsList } from '@/components/ads/campaigns-list';

export const metadata: Metadata = { title: 'Advertising' };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader icon={<Target />} title="Advertising" description="Paid campaigns on Meta and Google. Nothing spends until an Owner or Admin activates it." />
      <Suspense>
        <CampaignsList />
      </Suspense>
    </div>
  );
}
