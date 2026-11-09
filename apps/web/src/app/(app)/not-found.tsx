import { Compass } from 'lucide-react';
import Link from 'next/link';
import { Button, EmptyState } from '@zatma/ui';

export default function AppNotFound() {
  return (
    <EmptyState
      icon={<Compass />}
      title="Page not found"
      description="The page you're looking for doesn't exist or has moved. Use search (Ctrl K) to find what you need."
      action={
        <Button asChild>
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      }
    />
  );
}
