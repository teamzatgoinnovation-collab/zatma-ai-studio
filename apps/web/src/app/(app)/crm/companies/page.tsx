import type { Metadata } from 'next';
import { Building2 } from 'lucide-react';
import { PageHeader } from '@zatma/ui';
import { CompaniesList } from '@/components/crm/lists';

export const metadata: Metadata = { title: 'Companies' };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader icon={<Building2 />} title="Companies" description="Business accounts with their people and deals." />
      <CompaniesList />
    </div>
  );
}
