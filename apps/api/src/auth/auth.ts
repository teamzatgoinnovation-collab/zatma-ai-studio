import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { organization } from 'better-auth/plugins';
import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements, memberAc, ownerAc } from 'better-auth/plugins/organization/access';
import { toAuthRole } from '@zatma/types';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { Env } from '../config/env.js';

/**
 * Better Auth's own access control only governs Better Auth's organization endpoints
 * (invite, update member role, delete org, ...). Application endpoints use our permission
 * map in @zatma/types. Here we map our roles onto Better Auth's built-in capabilities.
 */
const ac = createAccessControl(defaultStatements);
const authRoles = {
  [toAuthRole('ORGANIZATION_OWNER')]: ac.newRole(ownerAc.statements),
  [toAuthRole('ADMIN')]: ac.newRole(adminAc.statements),
  [toAuthRole('MARKETING_MANAGER')]: ac.newRole(memberAc.statements),
  [toAuthRole('CRM_MANAGER')]: ac.newRole(memberAc.statements),
  [toAuthRole('SALES_AGENT')]: ac.newRole(memberAc.statements),
  [toAuthRole('DESIGNER')]: ac.newRole(memberAc.statements),
  [toAuthRole('ANALYST')]: ac.newRole(memberAc.statements),
  [toAuthRole('VIEWER')]: ac.newRole(memberAc.statements),
};

export interface AuthHooks {
  /** Provision tenant defaults (workspace, Free subscription) for a newly created organization. */
  onOrganizationCreated(organizationId: string, userId: string): Promise<void>;
}

export function createAuth(env: Env, prisma: PrismaClient, hooks: AuthHooks) {
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : undefined;

  return betterAuth({
    appName: 'ZatGo AI Marketing',
    baseURL: env.API_URL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: env.WEB_ORIGIN,
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      // Email verification is enforced in Phase 2 once an email provider is configured.
      requireEmailVerification: false,
    },
    ...(google ? { socialProviders: google } : {}),
    user: {
      additionalFields: {
        locale: { type: 'string', required: false, defaultValue: 'en', input: false },
        timezone: { type: 'string', required: false, defaultValue: 'Asia/Kolkata', input: false },
      },
    },
    databaseHooks: {
      session: {
        create: {
          // New sessions (e.g. signing in again) resume the user's most recently joined organization.
          before: async (session) => {
            const membership = await prisma.member.findFirst({
              where: { userId: session.userId },
              orderBy: { createdAt: 'desc' },
              select: { organizationId: true },
            });
            return { data: { ...session, activeOrganizationId: membership?.organizationId ?? null } };
          },
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // refresh daily
    },
    advanced: {
      cookiePrefix: 'zatma',
      useSecureCookies: env.NODE_ENV === 'production',
      database: { generateId: () => crypto.randomUUID() },
    },
    rateLimit: {
      enabled: env.NODE_ENV !== 'test',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 10 },
        '/sign-up/email': { window: 60, max: 5 },
      },
    },
    plugins: [
      organization({
        ac,
        roles: authRoles,
        creatorRole: toAuthRole('ORGANIZATION_OWNER'),
        allowUserToCreateOrganization: true,
        organizationLimit: 20,
        membershipLimit: 500,
        organizationHooks: {
          afterCreateOrganization: async ({ organization: org, user }) => {
            await hooks.onOrganizationCreated(org.id, user.id);
          },
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;
