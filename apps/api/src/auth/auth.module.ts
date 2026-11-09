import { Global, Module } from '@nestjs/common';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { EmailService } from '../email/email.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsageService } from '../billing/usage.service.js';
import { TenancyProvisioningService } from '../organizations/tenancy-provisioning.service.js';
import { AuthInfoController } from './auth-info.controller.js';
import { createAuth } from './auth.js';

export const AUTH = Symbol('AUTH');

@Global()
@Module({
  controllers: [AuthInfoController],
  providers: [
    TenancyProvisioningService,
    UsageService,
    {
      provide: AUTH,
      inject: [ENV, PrismaService, TenancyProvisioningService, EmailService, UsageService],
      useFactory: (env: Env, prisma: PrismaService, provisioning: TenancyProvisioningService, email: EmailService, usage: UsageService) =>
        createAuth(env, prisma.system, {
          onOrganizationCreated: (orgId, userId) => provisioning.provisionOrganization(orgId, userId),
          sendEmail: (message) => email.send(message),
          publicLink: (url) => email.publicLink(url),
          webUrl: (path) => email.webUrl(path),
          memberLimit: async (orgId) => (await usage.limits(orgId)).members,
          memberUsage: async (orgId) => (await usage.usage(orgId)).members,
        }),
    },
  ],
  exports: [AUTH, UsageService],
})
export class AuthModule {}
