'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, CreditCard, ExternalLink, Loader2, Receipt } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert, Badge, Button, ErrorState, PageHeader, Card, CardContent, CardDescription, CardHeader, CardTitle, cn, Meter, Skeleton, Tabs } from '@zatma/ui';
import type { BillingInterval, PlanSummary, SubscriptionDetail, UsageMetric } from '@zatma/types';
import { ApiError } from '@zatma/sdk';
import { api } from '@/lib/api';
import { openRazorpayCheckout } from '@/lib/razorpay';

const METRIC_LABELS: Record<UsageMetric, { label: string; unit?: string }> = {
  aiCredits: { label: 'AI credits this period' },
  members: { label: 'Team members (incl. pending)' },
  workspaces: { label: 'Workspaces' },
  storageMb: { label: 'Storage', unit: ' MB' },
  socialAccounts: { label: 'Connected social accounts' },
  crmRecords: { label: 'CRM contacts and leads' },
};

const FEATURES: Record<PlanSummary['code'], string[]> = {
  FREE: ['Basic CRM', 'Try AI design', 'Single user'],
  STARTER: ['AI designs & copy', 'CRM', 'Basic social publishing'],
  PROFESSIONAL: ['Scheduling & campaigns', 'Marketing automation', 'Priority AI queue'],
  BUSINESS: ['Multi-brand workspaces', 'Advanced CRM', 'Team collaboration'],
  AGENCY: ['Unlimited clients', 'White-label options', 'Dedicated support'],
};

const STATUS_TONE: Record<SubscriptionDetail['status'], 'success' | 'primary' | 'warning' | 'danger' | 'neutral'> = {
  ACTIVE: 'success',
  TRIALING: 'primary',
  PAST_DUE: 'warning',
  CANCELED: 'danger',
  EXPIRED: 'neutral',
};

const money = (amount: string | null, currency: string) =>
  amount === null ? 'Custom' : new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(amount));
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '–');
const daysUntil = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000));

export function BillingPage() {
  const qc = useQueryClient();
  const [interval, setInterval] = useState<BillingInterval>('MONTHLY');
  const org = useQuery({ queryKey: ['organization', 'current'], queryFn: api.organizations.current });
  const sub = useQuery({ queryKey: ['billing', 'subscription'], queryFn: api.billing.subscription });
  const plans = useQuery({ queryKey: ['billing', 'plans'], queryFn: api.billing.plans });
  const usage = useQuery({ queryKey: ['billing', 'usage'], queryFn: api.billing.usage });
  const invoices = useQuery({ queryKey: ['billing', 'invoices'], queryFn: () => api.billing.invoices({ pageSize: 24 }) });

  const canManage = org.data?.permissions.includes('billing:manage') ?? false;
  const s = sub.data;
  const livePaid = Boolean(s?.provider && (s.status === 'ACTIVE' || s.status === 'PAST_DUE'));

  const refresh = () => Promise.all(['subscription', 'usage', 'invoices'].map((k) => qc.invalidateQueries({ queryKey: ['billing', k] })));
  const describe = (e: unknown) => (e instanceof ApiError ? e.message : (e as Error).message);

  const choose = useMutation({
    mutationFn: async (plan: PlanSummary) => {
      if (plan.code === 'FREE' || livePaid) return { kind: 'changed' as const, detail: await api.billing.changePlan({ plan: plan.code, interval }) };
      const session = await api.billing.checkout({ plan: plan.code as 'STARTER' | 'PROFESSIONAL' | 'BUSINESS', interval });
      return { kind: 'checkout' as const, outcome: await openRazorpayCheckout(session, org.data?.name ?? '') };
    },
    onSuccess: async (r) => {
      if (r.kind === 'checkout') {
        if (r.outcome === 'paid') toast.success('Payment received. Your plan activates as soon as Razorpay confirms it.');
      } else if (r.detail?.pendingPlan) {
        toast.success(`${r.detail.pendingPlan.name} starts on ${date(r.detail.currentPeriodEnd)}`);
      } else {
        toast.success('Plan updated');
      }
      await refresh();
    },
    onError: (e) => toast.error(describe(e)),
  });

  const cancel = useMutation({
    mutationFn: api.billing.cancel,
    onSuccess: async () => {
      toast.success(livePaid ? 'Your subscription will end at the end of the billing period' : 'Trial ended. You are now on the Free plan.');
      await refresh();
    },
    onError: (e) => toast.error(describe(e)),
  });

  if (sub.isPending || plans.isPending) return <Skeleton className="h-[600px]" />;
  if (sub.isError || plans.isError)
    return <ErrorState description="Couldn't load billing details." onRetry={() => void Promise.all([sub.refetch(), plans.refetch()])} />;

  return (
    <div className="space-y-6">
      <PageHeader icon={<CreditCard />} title="Billing" description={`Plans, usage and invoices for ${org.data?.name ?? 'your organization'}.`} />

      {s && !s.billingEnabled && (
        <Alert tone="info">
          Online payments are not enabled yet. You can use your trial and the Free plan; paid plans will be available once payments are switched on.
        </Alert>
      )}
      {s?.status === 'PAST_DUE' && (
        <Alert>
          <span className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Your last payment failed. Update your payment method in the Razorpay email before {date(s.graceUntil)} to keep your plan.
          </span>
        </Alert>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="size-4 text-primary" aria-hidden="true" /> Current plan
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {s ? (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-2xl font-semibold">{s.plan.name}</span>
                  <Badge tone={STATUS_TONE[s.status]}>{s.status === 'TRIALING' ? 'Trial' : s.status.replace('_', ' ').toLowerCase()}</Badge>
                  {s.provider && <Badge>{s.interval === 'YEARLY' ? 'Yearly' : 'Monthly'}</Badge>}
                </div>
                <dl className="grid gap-3 text-sm sm:grid-cols-3">
                  {s.status === 'TRIALING' && s.trialEndsAt && (
                    <div>
                      <dt className="text-muted-foreground">Trial ends</dt>
                      <dd className="font-medium">
                        {date(s.trialEndsAt)} ({daysUntil(s.trialEndsAt)} days left)
                      </dd>
                    </div>
                  )}
                  {s.provider && (
                    <div>
                      <dt className="text-muted-foreground">{s.cancelAtPeriodEnd ? 'Ends on' : 'Renews on'}</dt>
                      <dd className="font-medium">{date(s.currentPeriodEnd)}</dd>
                    </div>
                  )}
                  {s.pendingPlan && (
                    <div>
                      <dt className="text-muted-foreground">Scheduled change</dt>
                      <dd className="font-medium">
                        {s.pendingPlan.name} from {date(s.currentPeriodEnd)}
                      </dd>
                    </div>
                  )}
                </dl>
                {canManage && (livePaid ? !s.cancelAtPeriodEnd : s.status === 'TRIALING') && (
                  <Button
                    variant="outline"
                    disabled={cancel.isPending}
                    onClick={() =>
                      window.confirm(livePaid ? 'Cancel at the end of the current billing period?' : 'End the trial now and move to the Free plan?') &&
                      cancel.mutate()
                    }
                  >
                    {cancel.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
                    {livePaid ? 'Cancel subscription' : 'End trial'}
                  </Button>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No subscription found.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Usage</CardTitle>
            <CardDescription>Limits of your current plan.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {usage.isPending && <Skeleton className="h-32" />}
            {usage.data?.metrics.map((m) => (
              <Meter key={m.metric} label={METRIC_LABELS[m.metric].label} used={m.used} limit={m.limit} unit={METRIC_LABELS[m.metric].unit} />
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Plans</h2>
        <Tabs
          label="Billing interval"
          items={[
            { id: 'MONTHLY', label: 'Monthly' },
            { id: 'YEARLY', label: 'Yearly · 2 months free' },
          ]}
          value={interval}
          onChange={(id) => setInterval(id as BillingInterval)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {plans.data?.map((plan) => {
          const current = s?.plan.code === plan.code && (plan.code === 'FREE' || s.status === 'TRIALING' || s.interval === interval);
          const price = interval === 'YEARLY' ? plan.priceYearly : plan.priceMonthly;
          const purchasable = plan.code !== 'AGENCY';
          const needsPayments = plan.code !== 'FREE' && !s?.billingEnabled;
          return (
            <Card key={plan.code} className={cn('flex flex-col', plan.code === 'PROFESSIONAL' && 'border-primary shadow-md')}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{plan.name}</CardTitle>
                  {plan.code === 'PROFESSIONAL' && <Badge tone="primary">Popular</Badge>}
                </div>
                <p className="pt-1">
                  <span className="text-2xl font-semibold">{money(price, plan.currency)}</span>
                  {price !== null && <span className="text-sm text-muted-foreground"> / {interval === 'YEARLY' ? 'year' : 'month'}</span>}
                </p>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-4">
                <ul className="flex-1 space-y-1.5 text-sm">
                  <li className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                    {plan.limits.aiCredits === -1 ? 'Unlimited' : plan.limits.aiCredits} AI credits / month
                  </li>
                  <li className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                    {plan.limits.members === -1 ? 'Unlimited' : plan.limits.members} team member{plan.limits.members === 1 ? '' : 's'}
                  </li>
                  {FEATURES[plan.code].map((f) => (
                    <li key={f} className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                      {f}
                    </li>
                  ))}
                </ul>
                {current ? (
                  <Button variant="secondary" disabled>
                    Current plan
                  </Button>
                ) : !purchasable ? (
                  <Button variant="outline" asChild>
                    <a href="mailto:sales@zatgoinnovation.com?subject=ZatGo%20AI%20Marketing%20Agency%20plan">Contact sales</a>
                  </Button>
                ) : (
                  <Button
                    variant={plan.code === 'PROFESSIONAL' ? 'primary' : 'outline'}
                    disabled={!canManage || needsPayments || choose.isPending}
                    title={!canManage ? 'Only the organization owner can change the plan' : needsPayments ? 'Online payments are not enabled yet' : undefined}
                    onClick={() => choose.mutate(plan)}
                  >
                    {choose.isPending && choose.variables?.code === plan.code && <Loader2 className="animate-spin" aria-hidden="true" />}
                    {plan.code === 'FREE' ? 'Switch to Free' : livePaid ? 'Switch plan' : 'Choose plan'}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="size-4 text-primary" aria-hidden="true" /> Invoices
          </CardTitle>
        </CardHeader>
        <CardContent>
          {invoices.data?.data.length === 0 && <p className="text-sm text-muted-foreground">No invoices yet.</p>}
          {invoices.data && invoices.data.data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-2 font-medium">Date</th>
                    <th className="py-2 font-medium">Invoice</th>
                    <th className="py-2 font-medium">Period</th>
                    <th className="py-2 text-right font-medium">Amount</th>
                    <th className="py-2 font-medium">Status</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {invoices.data.data.map((inv) => (
                    <tr key={inv.id}>
                      <td className="py-2.5">{date(inv.issuedAt)}</td>
                      <td className="py-2.5 font-mono text-xs">{inv.number ?? '–'}</td>
                      <td className="py-2.5">
                        {date(inv.periodStart)} – {date(inv.periodEnd)}
                      </td>
                      <td className="py-2.5 text-right">{money(inv.amount, inv.currency)}</td>
                      <td className="py-2.5">
                        <Badge tone={inv.status === 'paid' ? 'success' : 'warning'}>{inv.status}</Badge>
                      </td>
                      <td className="py-2.5 text-right">
                        {inv.invoiceUrl && (
                          <a href={inv.invoiceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                            View <ExternalLink className="size-3" aria-hidden="true" />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
