import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Flag } from 'lucide-react';
import { PageHeader } from '@zatma/ui';
import { MarketingCampaignPage } from '@/components/campaigns/campaign-page';

export const metadata: Metadata = { title: 'Campaign' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return (
    <div className="space-y-6">
      <PageHeader icon={<Flag />} title="Campaign" description="Content, budget, tracking, leads and results." />
      <MarketingCampaignPage id={id} />
    </div>
  );
}
