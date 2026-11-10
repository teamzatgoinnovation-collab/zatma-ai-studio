import type { Metadata } from 'next';
import { LeadDetail } from '@/components/crm/details';

export const metadata: Metadata = { title: 'Leads' };

type Props = { params: Promise<{ id: string }> };

export default async function Page({ params }: Props) {
  const { id } = await params;
  return <LeadDetail id={id} />;
}
