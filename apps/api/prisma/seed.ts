import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type PlanCode } from '../src/generated/prisma/client.js';

/** Suggested starting prices (not market-researched); see docs/PROJECT_OVERVIEW.md. -1 = unlimited. */
const PLANS: Array<{
  code: PlanCode;
  name: string;
  description: string;
  priceMonthly: string | null;
  priceYearly: string | null;
  limits: { aiCredits: number; storageMb: number; members: number; socialAccounts: number; workspaces: number };
  isPublic: boolean;
}> = [
  { code: 'FREE', name: 'Free', description: 'Limited AI usage and basic CRM', priceMonthly: '0', priceYearly: '0', limits: { aiCredits: 20, storageMb: 500, members: 1, socialAccounts: 1, workspaces: 1 }, isPublic: true },
  { code: 'STARTER', name: 'Starter', description: '100 AI designs, CRM, basic publishing', priceMonthly: '499', priceYearly: '4990', limits: { aiCredits: 100, storageMb: 5_000, members: 3, socialAccounts: 3, workspaces: 2 }, isPublic: true },
  { code: 'PROFESSIONAL', name: 'Professional', description: '500 AI designs, scheduling, campaigns and automation', priceMonthly: '1499', priceYearly: '14990', limits: { aiCredits: 500, storageMb: 20_000, members: 10, socialAccounts: 10, workspaces: 5 }, isPublic: true },
  { code: 'BUSINESS', name: 'Business', description: 'Multi-brand, advanced CRM, team collaboration', priceMonthly: '3999', priceYearly: '39990', limits: { aiCredits: 2_000, storageMb: 100_000, members: 25, socialAccounts: 30, workspaces: 15 }, isPublic: true },
  { code: 'AGENCY', name: 'Agency', description: 'Multiple clients, team management, white-label options', priceMonthly: null, priceYearly: null, limits: { aiCredits: -1, storageMb: -1, members: -1, socialAccounts: -1, workspaces: -1 }, isPublic: true },
];

export async function seedPlans(prisma: PrismaClient): Promise<void> {
  for (const [index, plan] of PLANS.entries()) {
    const data = { ...plan, currency: 'INR', sortOrder: index };
    await prisma.plan.upsert({ where: { code: plan.code }, update: data, create: data });
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  await import('dotenv/config');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  await seedPlans(prisma);
  console.log(`Seeded ${PLANS.length} plans`);
  await prisma.$disconnect();
}
