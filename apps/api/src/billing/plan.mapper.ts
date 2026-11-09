import type { PlanLimits, PlanSummary } from '@zatma/types';
import type { Plan } from '../generated/prisma/client.js';

export function toPlanSummary(plan: Plan): PlanSummary {
  return {
    code: plan.code,
    name: plan.name,
    priceMonthly: plan.priceMonthly?.toFixed(2) ?? null,
    priceYearly: plan.priceYearly?.toFixed(2) ?? null,
    currency: plan.currency,
    limits: plan.limits as unknown as PlanLimits,
  };
}
