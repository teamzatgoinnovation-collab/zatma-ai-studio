import type { Metadata } from 'next';
import { Megaphone } from 'lucide-react';
import { PageHeader } from '@zatma/ui';
import { MarketingOverview } from '@/components/publishing/overview';

export const metadata: Metadata = { title: 'Marketing' };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader icon={<Megaphone />} title="Marketing" description="Plan, publish and track your social content." />
      <MarketingOverview />
    </div>
  );
}
