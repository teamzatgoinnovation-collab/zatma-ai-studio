import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './cn';

export const badgeVariants = cva('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', {
  variants: {
    tone: {
      neutral: 'bg-muted text-muted-foreground',
      primary: 'bg-primary/10 text-primary',
      success: 'bg-success/15 text-success',
      warning: 'bg-warning/15 text-warning',
      danger: 'bg-destructive/15 text-destructive',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export const Badge = ({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) => (
  <span className={cn(badgeVariants({ tone }), className)} {...props} />
);

export const Skeleton = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('animate-pulse rounded-lg bg-muted', className)} aria-hidden="true" {...props} />
);

export const Alert = ({
  className,
  tone = 'danger',
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { tone?: 'danger' | 'info' }) => (
  <div
    role="alert"
    className={cn(
      'rounded-xl border px-4 py-3 text-sm',
      tone === 'danger' ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'border-primary/30 bg-primary/10 text-primary',
      className,
    )}
    {...props}
  />
);
