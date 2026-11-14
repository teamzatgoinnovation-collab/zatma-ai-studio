'use client';

import { useQuery } from '@tanstack/react-query';
import { Workflow } from 'lucide-react';
import Link from 'next/link';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@zatma/ui';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/activity';
import { RUN_LABEL, RUN_TONE } from '@/lib/automation';
import { useNow } from '@/lib/use-now';

/** On a lead or contact: the automations that ran on it. Quietly absent when there are none or the user can't see automations. */
export function RecordAutomations({ entityId }: { entityId: string }) {
  const now = useNow(60_000);
  const q = useQuery({ queryKey: ['automation', 'runs', 'record', entityId], queryFn: () => api.automation.runs({ entityId, pageSize: 5 }), retry: false });
  if (!q.data || q.data.data.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Workflow className="size-4" aria-hidden="true" /> Automations that ran
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 text-sm">
          {q.data.data.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
              <Link href={`/marketing/automation/${r.workflowId}`} className="font-medium hover:underline">
                {r.workflowName}
              </Link>
              <span className="flex items-center gap-2">
                <Badge tone={RUN_TONE[r.status]}>{RUN_LABEL[r.status]}</Badge>
                <span className="text-xs text-muted-foreground">{timeAgo(r.startedAt, now)}</span>
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
