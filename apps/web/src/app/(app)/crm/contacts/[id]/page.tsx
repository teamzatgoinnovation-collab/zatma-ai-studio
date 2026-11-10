import type { Metadata } from 'next';
import { ContactDetail } from '@/components/crm/details';

export const metadata: Metadata = { title: 'Contacts' };

type Props = { params: Promise<{ id: string }> };

export default async function Page({ params }: Props) {
  const { id } = await params;
  return <ContactDetail id={id} />;
}
