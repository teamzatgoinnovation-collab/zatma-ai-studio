import type { Metadata } from 'next';
import { Palette } from 'lucide-react';
import { PageHeader } from '@zatma/ui';
import { BrandKitManager } from '@/components/studio/brand-kit';

export const metadata: Metadata = { title: 'Brand Kit' };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader icon={<Palette />} title="Brand Kit" description="Logo, colours, fonts and contact details applied to every AI design. The default kit is used when a design doesn't pick one." />
      <BrandKitManager />
    </div>
  );
}
