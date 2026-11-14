import type { Metadata } from 'next';
import { CalendarDays } from 'lucide-react';
import { PageHeader } from '@zatma/ui';
import { OrgCampaignCalendar } from '@/components/campaigns/org-calendar';

export const metadata: Metadata = { title: 'Campaign calendar' };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader icon={<CalendarDays />} title="Campaign calendar" description="Every campaign, with its posts, ad flights, planned content and tasks." />
      <OrgCampaignCalendar />
    </div>
  );
}
