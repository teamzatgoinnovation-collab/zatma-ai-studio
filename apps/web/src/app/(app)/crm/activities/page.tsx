import type { Metadata } from 'next';
import { History } from 'lucide-react';
import { PageHeader } from '@zatma/ui';
import { ActivitiesList } from '@/components/crm/overview';

export const metadata: Metadata = { title: 'Activities' };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader icon={<History />} title="Activities" description="Calls, WhatsApp messages, emails, meetings and notes across the CRM." />
      <ActivitiesList />
    </div>
  );
}
