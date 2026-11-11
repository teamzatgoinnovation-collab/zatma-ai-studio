import type { Metadata } from 'next';
import { Send } from 'lucide-react';
import { PageHeader } from '@zatma/ui';
import { NewPostPage } from '@/components/publishing/post-page';

export const metadata: Metadata = { title: 'New post' };

type Props = { searchParams: Promise<{ design?: string; copy?: string; at?: string }> };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Page({ searchParams }: Props) {
  const q = await searchParams;
  const at = q.at && !Number.isNaN(Date.parse(q.at)) ? q.at : undefined;
  return (
    <div className="space-y-6">
      <PageHeader icon={<Send />} title="New post" description="Choose accounts, write once, customise per platform and check the previews." />
      <NewPostPage prefill={{ designId: q.design && uuid.test(q.design) ? q.design : undefined, copyId: q.copy && uuid.test(q.copy) ? q.copy : undefined, at }} />
    </div>
  );
}
