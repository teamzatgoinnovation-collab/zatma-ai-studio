import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Megaphone } from 'lucide-react';
import { PageHeader } from '@zatma/ui';
import { EditCampaign } from '@/components/ads/edit-campaign';

export const metadata: Metadata = { title: 'Edit campaign' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return (
    <div className="space-y-6">
      <PageHeader icon={<Megaphone />} title="Edit campaign" description="Drafts can be changed until they are created on the platform." />
      <EditCampaign id={id} />
    </div>
  );
}
