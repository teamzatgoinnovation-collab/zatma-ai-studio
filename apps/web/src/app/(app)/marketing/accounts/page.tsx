import type { Metadata } from 'next';
import { Share2 } from 'lucide-react';
import { Suspense } from 'react';
import { PageHeader } from '@zatma/ui';
import { SocialAccountsManager } from '@/components/social/accounts';

export const metadata: Metadata = { title: 'Social Accounts' };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader icon={<Share2 />} title="Social Accounts" description="Connect Facebook Pages, Instagram business accounts, LinkedIn Pages and YouTube channels through each platform's official sign-in." />
      <Suspense>
        <SocialAccountsManager />
      </Suspense>
    </div>
  );
}
