import type { Metadata } from 'next';
import { CalendarClock } from 'lucide-react';
import { PageHeader } from '@zatma/ui';
import { FollowUps } from '@/components/crm/overview';

export const metadata: Metadata = { title: 'Follow-ups' };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader icon={<CalendarClock />} title="Follow-ups" description="Tasks and follow-ups that are due, so no lead goes cold." />
      <FollowUps />
    </div>
  );
}
