import type { Metadata } from 'next';
import { CompanyDetail } from '@/components/crm/details';

export const metadata: Metadata = { title: 'Companies' };

type Props = { params: Promise<{ id: string }> };

export default async function Page({ params }: Props) {
  const { id } = await params;
  return <CompanyDetail id={id} />;
}
