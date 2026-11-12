import type { Metadata } from 'next';
import { Target } from 'lucide-react';
import { Suspense } from 'react';
import { PageHeader } from '@zatma/ui';
import { AdAccountsPage } from '@/components/ads/accounts';

export const metadata: Metadata = { title: 'Meta Ads' };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader icon={<Target />} title="Meta Ads" description="Facebook and Instagram ad accounts, spend caps and campaigns." />
      <Suspense>
        <AdAccountsPage platform="META" />
      </Suspense>
    </div>
  );
}
