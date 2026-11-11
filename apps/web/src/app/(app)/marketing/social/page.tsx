import type { Metadata } from 'next';
import { Send } from 'lucide-react';
import { PageHeader } from '@zatma/ui';
import { PostsList } from '@/components/publishing/posts-list';

export const metadata: Metadata = { title: 'Social Media' };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader icon={<Send />} title="Social Media" description="Compose posts, preview them per platform, and publish now or on a schedule." />
      <PostsList />
    </div>
  );
}
