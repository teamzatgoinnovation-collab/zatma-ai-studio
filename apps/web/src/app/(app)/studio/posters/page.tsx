import type { Metadata } from 'next';
import { Megaphone } from 'lucide-react';
import { PageHeader } from '@zatma/ui';
import { DesignGenerator, type ExamplePrompt } from '@/components/studio/generator';
import { DesignLibrary } from '@/components/studio/design-library';

export const metadata: Metadata = { title: 'AI Poster Generator' };

const OCCASIONS = ['Onam', 'Vishu', 'Eid', 'Diwali', 'Christmas', 'Ramadan', 'Grand opening', 'Flash sale'];

const EXAMPLES: ExamplePrompt[] = [
  { label: 'Onam sale (Malayalam)', prompt: 'Onam mega sale poster for a textile and saree showroom: up to 40% off, free gift on purchases above ₹2,999, 1–15 September.', language: 'ml', occasion: 'Onam', sizePreset: 'instagram_story' },
  { label: 'Eid greetings (Arabic)', prompt: 'Eid Mubarak greeting poster from a family supermarket, with a special 15% discount on dates and sweets during Eid week.', language: 'ar', occasion: 'Eid', sizePreset: 'instagram_story' },
  { label: 'Grand opening', prompt: 'Grand opening of a new bakery and café in Kochi this Saturday at 10 AM. First 100 customers get a free coffee.', occasion: 'Grand opening', sizePreset: 'instagram_story' },
  { label: 'Flash sale', prompt: '24-hour flash sale on smartphones and accessories: up to 50% off, today only, order on WhatsApp.', occasion: 'Flash sale', sizePreset: 'instagram_story' },
];

export default function Page() {
  return (
    <div className="space-y-8">
      <PageHeader
        icon={<Megaphone />}
        title="AI Poster Generator"
        description="Festival, sale and event posters in Malayalam, English, Arabic and more, with your brand kit applied and every word editable."
      />
      <DesignGenerator
        heading="What is the poster for?"
        examples={EXAMPLES}
        occasions={OCCASIONS}
        defaultSize="instagram_story"
        placeholder="e.g. Vishu special offer at our jewellery store: no making charges on gold, 10–20 April."
      />
      <DesignLibrary />
    </div>
  );
}
