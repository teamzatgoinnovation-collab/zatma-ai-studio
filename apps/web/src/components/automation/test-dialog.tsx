'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button, Dialog, DialogContent, Label, Select, Skeleton } from '@zatma/ui';
import { TRIGGER_INFO, type EntityType, type TestRunResult, type TriggerKind } from '@zatma/validation';
import { api } from '@/lib/api';
import { errorText } from '@/components/campaigns/shared';

const NOUN: Record<EntityType, string> = { lead: 'lead', contact: 'contact', deal: 'deal', activity: 'follow-up' };

async function recordsFor(entity: EntityType): Promise<Array<{ id: string; label: string }>> {
  if (entity === 'lead') return (await api.crm.leads.list({ pageSize: 25 })).data.map((l) => ({ id: l.id, label: `${l.name}${l.score !== null ? ` · score ${l.score}` : ''}` }));
  if (entity === 'contact') return (await api.crm.contacts.list({ pageSize: 25 })).data.map((c) => ({ id: c.id, label: c.name }));
  if (entity === 'deal') return (await api.crm.deals.list({ pageSize: 25 })).data.map((d) => ({ id: d.id, label: `${d.name} · ${d.status.toLowerCase()}` }));
  return (await api.crm.activities.list({ pageSize: 25, status: 'open' })).data.map((a) => ({ id: a.id, label: a.subject }));
}

/** Runs the automation against a real record as a dry run: the path it takes and what it would change, nothing written. */
export function TestDialog({
  open,
  workflowId,
  triggerKind,
  dirty,
  saveFirst,
  onClose,
  onResult,
}: {
  open: boolean;
  workflowId: string;
  triggerKind: TriggerKind | null;
  dirty: boolean;
  saveFirst: () => Promise<void>;
  onClose: () => void;
  onResult: (r: TestRunResult) => void;
}) {
  const entity: EntityType = triggerKind ? TRIGGER_INFO[triggerKind].entity : 'lead';
  const [chosen, setChosen] = useState('');
  const records = useQuery({ queryKey: ['automation', 'test-records', entity], queryFn: () => recordsFor(entity), enabled: open });
  const run = useMutation({
    mutationFn: async () => {
      if (dirty) await saveFirst();
      return api.automation.test(workflowId, { entityType: entity, entityId: chosen || records.data![0]!.id });
    },
    onSuccess: onResult,
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Test run" description={`Pick a ${NOUN[entity]} to try it on. Nothing is changed, sent or charged.`}>
        <div className="mt-4 space-y-4">
          {records.isPending ? (
            <Skeleton className="h-10" />
          ) : records.data?.length === 0 ? (
            <p className="text-sm text-muted-foreground">There is no {NOUN[entity]} to test with yet.</p>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="test-record">{NOUN[entity][0]!.toUpperCase() + NOUN[entity].slice(1)}</Label>
              <Select id="test-record" value={chosen || records.data?.[0]?.id || ''} onChange={(e) => setChosen(e.target.value)}>
                {records.data?.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {dirty && <p className="text-xs text-muted-foreground">Your unsaved changes are saved first, so the test uses them.</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!records.data?.length || run.isPending} onClick={() => run.mutate()}>
              {dirty ? 'Save and test' : 'Run test'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
