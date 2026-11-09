import { Compass } from 'lucide-react';
import Link from 'next/link';
import { Button, EmptyState } from '@zatma/ui';
import { Logo } from '@/components/logo';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 p-4">
      <Logo />
      <EmptyState
        icon={<Compass />}
        title="Page not found"
        description="The page you're looking for doesn't exist or has moved."
        action={
          <Button asChild>
            <Link href="/">Go home</Link>
          </Button>
        }
        className="w-full max-w-md bg-card"
      />
    </div>
  );
}
