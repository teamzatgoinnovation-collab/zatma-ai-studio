import type { Metadata } from 'next';
import { Users } from 'lucide-react';
import { PageHeader } from '@zatma/ui';
import { ContactsList } from '@/components/crm/lists';

export const metadata: Metadata = { title: 'Contacts' };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader icon={<Users />} title="Contacts" description="People you work with, with their company, deals and full activity history." />
      <ContactsList />
    </div>
  );
}
