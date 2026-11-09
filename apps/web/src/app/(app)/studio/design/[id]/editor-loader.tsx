'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@zatma/ui';

/** Konva needs `window`, so the editor is client-only. */
const DesignEditor = dynamic(() => import('@/components/editor/editor').then((m) => m.DesignEditor), {
  ssr: false,
  loading: () => <Skeleton className="h-[70vh]" />,
});

export function EditorLoader({ designId }: { designId: string }) {
  return <DesignEditor designId={designId} />;
}
