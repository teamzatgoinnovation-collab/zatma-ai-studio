import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Handshake } from 'lucide-react';
import { PageHeader } from '@zatma/ui';
import { DealsList } from '@/components/crm/lists';

export const metadata: Metadata = { title: 'Deals' };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader icon={<Handshake />} title="Deals" description="Every opportunity with value, stage and expected close date." />
      <Suspense>
        <DealsList />
      </Suspense>
    </div>
  );
}
