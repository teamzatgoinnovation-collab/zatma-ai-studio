import type { Metadata } from 'next';
import { LayoutTemplate } from 'lucide-react';
import { PageHeader } from '@zatma/ui';
import { TemplateGallery } from '@/components/studio/templates';

export const metadata: Metadata = { title: 'Templates' };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader icon={<LayoutTemplate />} title="Templates" description="Your organization's saved layouts. Start a new design from one, then change the text, images and colours." />
      <TemplateGallery />
    </div>
  );
}
