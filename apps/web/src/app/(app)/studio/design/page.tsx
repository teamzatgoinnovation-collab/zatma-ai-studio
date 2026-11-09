import type { Metadata } from 'next';
import { Palette } from 'lucide-react';
import { PageHeader } from '@zatma/ui';
import { DesignGenerator } from '@/components/studio/generator';
import { DesignLibrary } from '@/components/studio/design-library';

export const metadata: Metadata = { title: 'AI Design Generator' };

export default function Page() {
  return (
    <div className="space-y-8">
      <PageHeader
        icon={<Palette />}
        title="AI Design Generator"
        description="Describe what you want to promote. The AI writes the copy and lays out an editable, on-brand design — every word stays live text you can change."
      />
      <DesignGenerator />
      <DesignLibrary />
    </div>
  );
}
