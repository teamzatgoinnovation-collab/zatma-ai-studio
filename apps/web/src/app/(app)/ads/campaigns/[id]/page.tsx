import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Megaphone } from 'lucide-react';
import { PageHeader } from '@zatma/ui';
import { CampaignPage } from '@/components/ads/campaign-page';

export const metadata: Metadata = { title: 'Campaign' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return (
    <div className="space-y-6">
      <PageHeader icon={<Megaphone />} title="Campaign" description="Status, spend approvals and results." />
      <CampaignPage id={id} />
    </div>
  );
}
