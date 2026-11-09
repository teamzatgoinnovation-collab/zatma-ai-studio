'use client';

import { useEffect } from 'react';
import { ErrorState } from '@zatma/ui';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <ErrorState
      title="This page couldn't load"
      description={
        <>
          Something went wrong on our side. Try again, and if it keeps happening contact support
          {error.digest ? (
            <>
              {' '}
              with reference <code className="rounded bg-muted px-1">{error.digest}</code>
            </>
          ) : null}
          .
        </>
      }
      onRetry={reset}
    />
  );
}
