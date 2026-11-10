'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PageHeader, Tabs } from '@zatma/ui';
import { Settings } from 'lucide-react';
import { AccountSettings } from './account-settings';
import { AISettings } from './ai-settings';
import { OrganizationSettings } from './organization-settings';
import { ScoringSettingsPanel } from '@/components/crm/scoring';

const TABS = [
  { id: 'organization', label: 'Organization' },
  { id: 'ai', label: 'AI' },
  { id: 'crm', label: 'CRM scoring' },
  { id: 'account', label: 'Your account' },
];

export function SettingsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const requested = params.get('tab');
  const tab = TABS.some((t) => t.id === requested) ? (requested as string) : 'organization';

  return (
    <div className="space-y-6">
      <PageHeader icon={<Settings />} title="Settings" description="Manage your organization profile, AI providers, CRM scoring and your personal account." />
      <Tabs label="Settings sections" withPanels items={TABS} value={tab} onChange={(id) => router.replace(`${pathname}?tab=${id}`)} />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'organization' ? <OrganizationSettings /> : tab === 'ai' ? <AISettings /> : tab === 'crm' ? <ScoringSettingsPanel /> : <AccountSettings />}
      </div>
    </div>
  );
}
