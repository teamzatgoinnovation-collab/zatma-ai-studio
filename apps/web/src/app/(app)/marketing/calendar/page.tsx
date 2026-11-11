import type { Metadata } from 'next';
import { CalendarDays } from 'lucide-react';
import { PageHeader } from '@zatma/ui';
import { ContentCalendar } from '@/components/publishing/calendar';

export const metadata: Metadata = { title: 'Content Calendar' };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader icon={<CalendarDays />} title="Content Calendar" description="Everything scheduled and published, by month, week, day or as a list." />
      <ContentCalendar />
    </div>
  );
}
