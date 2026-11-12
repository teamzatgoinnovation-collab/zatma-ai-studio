import type { Metadata } from 'next';
import { Search } from 'lucide-react';
import { Suspense } from 'react';
import { PageHeader } from '@zatma/ui';
import { AdAccountsPage } from '@/components/ads/accounts';

export const metadata: Metadata = { title: 'Google Ads' };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader icon={<Search />} title="Google Ads" description="Google Ads accounts, spend caps and Search campaigns." />
      <Suspense>
        <AdAccountsPage platform="GOOGLE" />
      </Suspense>
    </div>
  );
}
