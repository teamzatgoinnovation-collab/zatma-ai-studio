import type { Metadata } from 'next';
import { Flag } from 'lucide-react';
import { PageHeader } from '@zatma/ui';
import { MarketingCampaignsList } from '@/components/campaigns/campaigns-list';

export const metadata: Metadata = { title: 'Campaigns' };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader icon={<Flag />} title="Campaigns" description="Plan and track multi-channel campaigns: posts, ads, links, leads and budget in one place." />
      <MarketingCampaignsList />
    </div>
  );
}
