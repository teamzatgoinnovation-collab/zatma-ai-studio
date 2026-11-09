import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { tenantExtension } from './tenant-extension.js';

export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}

export type TenantPrismaClient = ReturnType<typeof extendWithTenant>;
const extendWithTenant = (client: PrismaClient) => client.$extends(tenantExtension);

/**
 * Two views over one connection pool:
 * - `tenant`: the default for feature code. Tenant models are automatically scoped to the active org.
 * - `system`: unscoped. Use only for auth, platform-level tables and cross-tenant system jobs.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly system: PrismaClient;
  readonly tenant: TenantPrismaClient;

  constructor(@Inject(ENV) env: Env) {
    this.system = createPrismaClient(env.DATABASE_URL);
    this.tenant = extendWithTenant(this.system);
  }

  async onModuleDestroy(): Promise<void> {
    await this.system.$disconnect();
  }
}
