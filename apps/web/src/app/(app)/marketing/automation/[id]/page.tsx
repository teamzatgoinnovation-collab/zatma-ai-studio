import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Workflow } from 'lucide-react';
import { PageHeader } from '@zatma/ui';
import { AutomationEditor } from '@/components/automation/builder';

export const metadata: Metadata = { title: 'Automation' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return (
    <div className="space-y-6">
      <PageHeader icon={<Workflow />} title="Automation" description="Build the workflow, test it on a real record, then activate it." />
      <AutomationEditor id={id} />
    </div>
  );
}
