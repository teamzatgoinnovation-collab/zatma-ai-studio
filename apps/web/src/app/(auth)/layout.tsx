import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { getServerSession } from '@/lib/server-session';

const PILLARS = [
  { title: 'AI Create', text: 'Posters, ads, copy and video from a single prompt, in Malayalam, English, Arabic and more.' },
  { title: 'AI Market', text: 'Publish to Meta, LinkedIn, WhatsApp and more, and run campaigns and automations.' },
  { title: 'CRM & Analyze', text: 'Capture leads, move deals through your pipeline, and see what really works.' },
];

export default async function AuthLayout({ children }: { children: ReactNode }) {
  if (await getServerSession()) redirect('/dashboard');

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-indigo-700 via-violet-700 to-cyan-600 p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <Logo className="text-white [&_span_span]:text-cyan-200" />
        <div className="max-w-md space-y-6">
          <h1 className="text-4xl font-semibold leading-tight">Create. Market. Grow.<br />Powered by AI.</h1>
          <ul className="space-y-4">
            {PILLARS.map((p) => (
              <li key={p.title} className="rounded-2xl bg-white/10 p-4 backdrop-blur">
                <p className="font-medium">{p.title}</p>
                <p className="text-sm text-white/80">{p.text}</p>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-white/70">© {new Date().getFullYear()} ZatGo Innovation</p>
      </aside>
      <main className="flex flex-col">
        <div className="flex items-center justify-between p-4 lg:justify-end">
          <Logo className="lg:hidden" />
          <ThemeToggle />
        </div>
        <div className="flex flex-1 items-center justify-center px-4 pb-16">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </main>
    </div>
  );
}
