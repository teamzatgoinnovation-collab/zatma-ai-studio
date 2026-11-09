'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PageHeader, Tabs } from '@zatma/ui';
import { Settings } from 'lucide-react';
import { AccountSettings } from './account-settings';
import { OrganizationSettings } from './organization-settings';

const TABS = [
  { id: 'organization', label: 'Organization' },
  { id: 'account', label: 'Your account' },
];

export function SettingsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = params.get('tab') === 'account' ? 'account' : 'organization';

  return (
    <div className="space-y-6">
      <PageHeader icon={<Settings />} title="Settings" description="Manage your organization profile and your personal account." />
      <Tabs label="Settings sections" withPanels items={TABS} value={tab} onChange={(id) => router.replace(`${pathname}?tab=${id}`)} />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'organization' ? <OrganizationSettings /> : <AccountSettings />}
      </div>
    </div>
  );
}
