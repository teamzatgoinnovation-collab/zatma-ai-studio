'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Tabs } from '@zatma/ui';
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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your organization profile and your personal account.</p>
      </div>
      <Tabs items={TABS} value={tab} onChange={(id) => router.replace(`${pathname}?tab=${id}`)} />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'organization' ? <OrganizationSettings /> : <AccountSettings />}
      </div>
    </div>
  );
}
