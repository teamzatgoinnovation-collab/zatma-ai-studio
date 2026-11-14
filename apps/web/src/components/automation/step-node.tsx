'use client';

import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { AlertTriangle, Clock, GitBranch, Settings2, Zap } from 'lucide-react';
import { cn } from '@zatma/ui';
import type { WorkflowIssue } from '@zatma/validation';
import { stepLabel, summarize, type StepData } from '@/lib/automation';

export type Outcome = 'run' | 'yes' | 'no' | 'stop' | 'would_wait';
/** What the canvas adds on top of a step for display only (never saved). */
export interface DecoratedData extends StepData {
  issues?: WorkflowIssue[];
  outcome?: Outcome | null;
}
export type DecoratedNode = Node<DecoratedData, 'step'>;

const ICON = { trigger: Zap, condition: GitBranch, action: Settings2, delay: Clock } as const;
const ACCENT = { trigger: 'border-primary', condition: 'border-warning', action: 'border-border', delay: 'border-dashed border-border' } as const;
const KIND = { trigger: 'Trigger', condition: 'Condition', action: 'Action', delay: 'Wait' } as const;

export function StepNodeView({ data, selected }: NodeProps<DecoratedNode>) {
  const Icon = ICON[data.nodeType];
  const errors = (data.issues ?? []).filter((i) => i.level === 'error').length;
  const warnings = (data.issues ?? []).filter((i) => i.level === 'warning').length;
  const handle = 'size-3 !border-2 !border-background !bg-primary';
  return (
    <div
      className={cn(
        'w-[220px] rounded-xl border-2 bg-card px-3 py-2.5 text-left shadow-sm',
        ACCENT[data.nodeType],
        selected && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
        data.outcome && data.outcome !== 'stop' && 'border-success',
        errors > 0 && 'border-destructive',
      )}
    >
      {data.nodeType !== 'trigger' && <Handle id="in" type="target" position={Position.Top} className={handle} />}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
        <span>{KIND[data.nodeType]}</span>
        {(errors > 0 || warnings > 0) && (
          <span className={cn('ml-auto inline-flex items-center gap-1', errors > 0 ? 'text-destructive-text' : 'text-warning-text')}>
            <AlertTriangle className="size-3.5" aria-hidden="true" />
            <span className="sr-only">{errors > 0 ? `${errors} problem${errors === 1 ? '' : 's'}` : `${warnings} warning${warnings === 1 ? '' : 's'}`}</span>
          </span>
        )}
        {data.outcome && <span className="ml-auto rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-success-text">{data.outcome === 'would_wait' ? 'waits' : data.outcome === 'stop' ? 'ends' : data.outcome}</span>}
      </div>
      <p className="mt-1 text-sm font-semibold leading-snug">{stepLabel(data.nodeType, data.kind)}</p>
      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{summarize(data.nodeType, data.kind, data.config)}</p>
      {data.nodeType === 'condition' ? (
        <>
          <Handle id="yes" type="source" position={Position.Bottom} style={{ left: '28%' }} className={handle} />
          <Handle id="no" type="source" position={Position.Bottom} style={{ left: '72%' }} className={cn(handle, '!bg-muted-foreground')} />
          <span aria-hidden="true" className="pointer-events-none absolute -bottom-5 left-[28%] -translate-x-1/2 text-[11px] font-medium text-muted-foreground">
            Yes
          </span>
          <span aria-hidden="true" className="pointer-events-none absolute -bottom-5 left-[72%] -translate-x-1/2 text-[11px] font-medium text-muted-foreground">
            No
          </span>
        </>
      ) : (
        <Handle id="next" type="source" position={Position.Bottom} className={handle} />
      )}
    </div>
  );
}
