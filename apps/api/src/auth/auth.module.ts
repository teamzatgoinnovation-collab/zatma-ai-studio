import { Global, Module } from '@nestjs/common';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenancyProvisioningService } from '../organizations/tenancy-provisioning.service.js';
import { createAuth } from './auth.js';

export const AUTH = Symbol('AUTH');

@Global()
@Module({
  providers: [
    TenancyProvisioningService,
    {
      provide: AUTH,
      inject: [ENV, PrismaService, TenancyProvisioningService],
      useFactory: (env: Env, prisma: PrismaService, provisioning: TenancyProvisioningService) =>
        createAuth(env, prisma.system, {
          onOrganizationCreated: (orgId, userId) => provisioning.provisionOrganization(orgId, userId),
        }),
    },
  ],
  exports: [AUTH],
})
export class AuthModule {}
