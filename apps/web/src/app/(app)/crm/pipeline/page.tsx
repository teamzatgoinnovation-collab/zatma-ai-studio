import type { Metadata } from 'next';
import { KanbanSquare } from 'lucide-react';
import { PageHeader } from '@zatma/ui';
import { PipelineBoard } from '@/components/crm/pipeline';

export const metadata: Metadata = { title: 'Sales Pipeline' };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader icon={<KanbanSquare />} title="Sales Pipeline" description="Drag deals from New Lead to Won. Totals update as you go." />
      <PipelineBoard />
    </div>
  );
}
