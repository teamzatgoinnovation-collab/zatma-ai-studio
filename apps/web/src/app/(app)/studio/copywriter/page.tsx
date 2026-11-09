import type { Metadata } from 'next';
import { PenLine } from 'lucide-react';
import { PageHeader } from '@zatma/ui';
import { Copywriter } from '@/components/studio/copywriter';

export const metadata: Metadata = { title: 'AI Copywriter' };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader
        icon={<PenLine />}
        title="AI Copywriter"
        description="Headlines, captions, hashtags, ad text and messages in seven languages, checked against each platform's limits. Rewrite, translate and save the best ones."
      />
      <Copywriter />
    </div>
  );
}
