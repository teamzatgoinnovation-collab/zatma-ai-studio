'use client';

/** Last-resort boundary for errors in the root layout (renders its own <html>). */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', display: 'grid', placeItems: 'center', minHeight: '100dvh', margin: 0 }}>
        <div style={{ textAlign: 'center', padding: 24 }}>
          <h1 style={{ fontSize: 20 }}>Something went wrong</h1>
          <p style={{ color: '#64748b' }}>Please try again.</p>
          <button onClick={reset} style={{ marginTop: 12, padding: '8px 16px', borderRadius: 12, border: 0, background: '#4f46e5', color: '#fff' }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
