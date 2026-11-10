import type { Metadata } from 'next';
import { Target } from 'lucide-react';
import { PageHeader } from '@zatma/ui';
import { CrmOverview } from '@/components/crm/overview';

export const metadata: Metadata = { title: 'CRM' };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader icon={<Target />} title="CRM" description="Your leads, relationships and sales pipeline at a glance." />
      <CrmOverview />
    </div>
  );
}
