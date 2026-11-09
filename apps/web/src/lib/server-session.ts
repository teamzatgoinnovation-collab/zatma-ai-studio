import 'server-only';
import { headers } from 'next/headers';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

export interface ServerSession {
  user: { id: string; name: string; email: string; image: string | null };
  session: { id: string; activeOrganizationId: string | null };
}

/** Reads the Better Auth session on the server by forwarding the incoming cookies to the API. */
export async function getServerSession(): Promise<ServerSession | null> {
  const cookie = (await headers()).get('cookie');
  if (!cookie) return null;
  const res = await fetch(`${API}/api/auth/get-session`, { headers: { cookie }, cache: 'no-store' });
  if (!res.ok) return null;
  const data = (await res.json()) as ServerSession | null;
  return data?.user ? data : null;
}
