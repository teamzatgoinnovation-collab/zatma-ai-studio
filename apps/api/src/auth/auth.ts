import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { organization } from 'better-auth/plugins';
import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements, memberAc, ownerAc } from 'better-auth/plugins/organization/access';
import { fromAuthRole, ROLE_LABELS, toAuthRole } from '@zatma/types';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import type { Env } from '../config/env.js';
import { emailTemplates } from '../email/templates.js';
import type { EmailMessage } from '../email/email.types.js';

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

const OWNER_ROLE = toAuthRole('ORGANIZATION_OWNER');
const roleLabel = (role: string | null | undefined) => {
  const r = fromAuthRole(role);
  return r ? ROLE_LABELS[r] : 'Member';
};

export interface AuthDeps {
  /** Provision tenant defaults (workspace, subscription/trial) for a newly created organization. */
  onOrganizationCreated(organizationId: string, userId: string): Promise<void>;
  sendEmail(message: EmailMessage): Promise<void>;
  /** Rewrites a Better Auth link (API origin) onto the public web origin. */
  publicLink(url: string): string;
  webUrl(path: string): string;
  /** Max members (members + pending invitations) allowed by the org's plan; -1 = unlimited. */
  memberLimit(organizationId: string): Promise<number>;
  memberUsage(organizationId: string): Promise<number>;
}

export function createAuth(env: Env, prisma: PrismaClient, deps: AuthDeps) {
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            redirectURI: `${env.WEB_URL}/api/auth/callback/google`,
          },
        }
      : undefined;

  const requireVerification = env.REQUIRE_EMAIL_VERIFICATION;

  const audit = (data: Omit<Prisma.AuditLogUncheckedCreateInput, 'id' | 'createdAt'>) =>
    prisma.auditLog.create({ data }).catch(() => undefined);

  return betterAuth({
    appName: 'ZatGo AI Marketing',
    baseURL: env.API_URL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [...new Set([...env.WEB_ORIGIN, env.WEB_URL])],
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      requireEmailVerification: requireVerification,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await deps.sendEmail({ to: user.email, ...emailTemplates.resetPassword({ name: user.name, url: deps.publicLink(url) }) });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      // The web app re-sends the link itself (with the correct callback URL) when sign-in fails as unverified.
      sendOnSignIn: false,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url }) => {
        await deps.sendEmail({ to: user.email, ...emailTemplates.verifyEmail({ name: user.name, url: deps.publicLink(url) }) });
      },
    },
    ...(google ? { socialProviders: google } : {}),
    account: {
      // Google accounts are only linked to an existing user when Google has verified the email.
      accountLinking: { enabled: true, trustedProviders: ['google'] },
    },
    user: {
      additionalFields: {
        locale: { type: 'string', required: false, defaultValue: 'en', input: false },
        timezone: { type: 'string', required: false, defaultValue: 'Asia/Kolkata', input: false },
      },
      deleteUser: {
        enabled: true,
        sendDeleteAccountVerification: async ({ user, url }) => {
          await deps.sendEmail({ to: user.email, ...emailTemplates.deleteAccount({ name: user.name, url: deps.publicLink(url) }) });
        },
        beforeDelete: async (user) => {
          const owned = await prisma.member.findMany({ where: { userId: user.id, role: OWNER_ROLE }, select: { organizationId: true } });
          const soloOrgs: string[] = [];
          for (const { organizationId } of owned) {
            const [others, otherOwners] = await Promise.all([
              prisma.member.count({ where: { organizationId, userId: { not: user.id } } }),
              prisma.member.count({ where: { organizationId, userId: { not: user.id }, role: OWNER_ROLE } }),
            ]);
            if (others === 0) soloOrgs.push(organizationId);
            else if (otherOwners === 0) {
              throw new APIError('BAD_REQUEST', {
                code: 'SOLE_OWNER',
                message: 'Transfer ownership or remove other members before deleting your account.',
              });
            }
          }
          // Organizations with no other members are removed with the account (cascades their data).
          if (soloOrgs.length) await prisma.organization.deleteMany({ where: { id: { in: soloOrgs } } });
        },
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
        '/request-password-reset': { window: 300, max: 5 },
        '/send-verification-email': { window: 300, max: 5 },
      },
    },
    plugins: [
      organization({
        ac,
        roles: authRoles,
        creatorRole: OWNER_ROLE,
        allowUserToCreateOrganization: true,
        organizationLimit: 20,
        membershipLimit: async (_user, org) => {
          const limit = await deps.memberLimit(org.id);
          return limit === -1 ? Number.MAX_SAFE_INTEGER : limit;
        },
        invitationExpiresIn: 60 * 60 * 24 * 7,
        cancelPendingInvitationsOnReInvite: true,
        sendInvitationEmail: async ({ id, email, role, organization: org, inviter }) => {
          await deps.sendEmail({
            to: email,
            organizationId: org.id,
            ...emailTemplates.invitation({
              inviterName: inviter.user.name,
              organizationName: org.name,
              roleLabel: roleLabel(role),
              url: deps.webUrl(`/accept-invitation/${id}`),
            }),
          });
        },
        organizationHooks: {
          afterCreateOrganization: async ({ organization: org, user }) => {
            await deps.onOrganizationCreated(org.id, user.id);
          },
          beforeDeleteOrganization: async ({ organization: org }) => {
            const sub = await prisma.subscription.findUnique({ where: { organizationId: org.id } });
            if (sub?.externalId && sub.provider && (sub.status === 'ACTIVE' || sub.status === 'PAST_DUE') && !sub.cancelAtPeriodEnd) {
              throw new APIError('BAD_REQUEST', {
                code: 'ACTIVE_SUBSCRIPTION',
                message: 'Cancel the paid subscription in Billing before deleting the organization.',
              });
            }
          },
          beforeCreateInvitation: async ({ invitation }) => {
            const role = invitation.role.split(',').map((r) => r.trim());
            if (role.some((r) => !fromAuthRole(r))) {
              throw new APIError('BAD_REQUEST', { code: 'INVALID_ROLE', message: 'Unknown role' });
            }
            const limit = await deps.memberLimit(invitation.organizationId);
            if (limit !== -1 && (await deps.memberUsage(invitation.organizationId)) + 1 > limit) {
              throw new APIError('PAYMENT_REQUIRED', {
                code: 'PLAN_LIMIT_REACHED',
                message: `Your plan allows ${limit} team member${limit === 1 ? '' : 's'}. Upgrade to invite more.`,
              });
            }
          },
          afterCreateInvitation: async ({ invitation, inviter }) => {
            await audit({ organizationId: invitation.organizationId, actorId: inviter.id, action: 'member.invited', resourceType: 'invitation', resourceId: invitation.id, metadata: { email: invitation.email, role: invitation.role } });
          },
          afterCancelInvitation: async ({ invitation, cancelledBy }) => {
            await audit({ organizationId: invitation.organizationId, actorId: cancelledBy.id, action: 'invitation.canceled', resourceType: 'invitation', resourceId: invitation.id });
          },
          afterAcceptInvitation: async ({ invitation, member, user }) => {
            await audit({ organizationId: invitation.organizationId, actorId: user.id, action: 'member.joined', resourceType: 'member', resourceId: member.id, metadata: { role: member.role } });
          },
          beforeUpdateMemberRole: async ({ newRole }) => {
            if (newRole.split(',').some((r) => !fromAuthRole(r.trim()))) {
              throw new APIError('BAD_REQUEST', { code: 'INVALID_ROLE', message: 'Unknown role' });
            }
          },
          // In these hooks `user` is the affected member's user, not the actor, so it goes into metadata.
          afterUpdateMemberRole: async ({ member, previousRole, user }) => {
            await audit({ organizationId: member.organizationId, action: 'member.role_changed', resourceType: 'member', resourceId: member.id, metadata: { userId: user.id, from: previousRole, to: member.role } });
          },
          afterRemoveMember: async ({ member }) => {
            await audit({ organizationId: member.organizationId, action: 'member.removed', resourceType: 'member', resourceId: member.id, metadata: { userId: member.userId } });
          },
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;
