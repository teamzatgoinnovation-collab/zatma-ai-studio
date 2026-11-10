import type { Metadata } from 'next';
import { UserRound } from 'lucide-react';
import { PageHeader } from '@zatma/ui';
import { LeadsList } from '@/components/crm/lists';

export const metadata: Metadata = { title: 'Leads' };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader icon={<UserRound />} title="Leads" description="Capture, qualify and convert leads. Import a CSV or add them one by one." />
      <LeadsList />
    </div>
  );
}
