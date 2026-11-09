import { redirect } from 'next/navigation';
import { getServerSession } from '@/lib/server-session';

export default async function Home() {
  const session = await getServerSession();
  redirect(session ? '/dashboard' : '/sign-in');
}
