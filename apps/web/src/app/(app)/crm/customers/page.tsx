import type { Metadata } from 'next';
import { BadgeCheck } from 'lucide-react';
import { PageHeader } from '@zatma/ui';
import { ContactsList } from '@/components/crm/lists';

export const metadata: Metadata = { title: 'Customers' };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader icon={<BadgeCheck />} title="Customers" description="Contacts with at least one won deal, and their lifetime value." />
      <ContactsList customers />
    </div>
  );
}
