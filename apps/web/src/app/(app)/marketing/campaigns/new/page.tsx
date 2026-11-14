import type { Metadata } from 'next';
import { Flag } from 'lucide-react';
import { PageHeader } from '@zatma/ui';
import { CampaignForm } from '@/components/campaigns/campaign-form';

export const metadata: Metadata = { title: 'New campaign' };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader icon={<Flag />} title="New campaign" description="Set the goal, dates, budget, channels and audience. Nothing is published or spent from here." />
      <CampaignForm />
    </div>
  );
}
