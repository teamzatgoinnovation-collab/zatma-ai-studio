import { Sparkles } from 'lucide-react';
import { cn } from '@zatma/ui';

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold tracking-tight', className)}>
      <span className="grid size-8 place-items-center rounded-xl bg-gradient-to-br from-primary to-secondary text-primary-foreground shadow-sm">
        <Sparkles className="size-4" aria-hidden="true" />
      </span>
      {!compact && (
        <span>
          ZatGo <span className="text-primary">AI Marketing</span>
        </span>
      )}
    </span>
  );
}
