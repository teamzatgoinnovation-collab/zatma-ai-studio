import type { Metadata } from 'next';
import { Workflow } from 'lucide-react';
import { PageHeader } from '@zatma/ui';
import { AutomationsHome } from '@/components/automation/automations-list';

export const metadata: Metadata = { title: 'Automation' };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader icon={<Workflow />} title="Automation" description="Rules that run on their own: when something happens in your CRM or campaigns, check conditions and take actions." />
      <AutomationsHome />
    </div>
  );
}
