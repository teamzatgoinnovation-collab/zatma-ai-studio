import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Send } from 'lucide-react';
import { PageHeader } from '@zatma/ui';
import { PostPage } from '@/components/publishing/post-page';

export const metadata: Metadata = { title: 'Post' };

type Props = { params: Promise<{ id: string }> };

export default async function Page({ params }: Props) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return (
    <div className="space-y-6">
      <PageHeader icon={<Send />} title="Post" description="Edit, review and track where this post was published." />
      <PostPage id={id} />
    </div>
  );
}
