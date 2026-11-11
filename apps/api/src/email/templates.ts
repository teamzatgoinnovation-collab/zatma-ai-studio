import type { EmailMessage } from './email.types.js';

/** Escapes text for safe interpolation into HTML. All user-provided values must pass through this. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

interface LayoutInput {
  preheader: string;
  heading: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  footnote?: string;
}

/** Branded, email-client-safe layout (table based, inline styles). Inputs must already be plain text. */
function layout({ preheader, heading, paragraphs, action, footnote }: LayoutInput): { html: string; text: string } {
  const p = paragraphs.map((t) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155">${escapeHtml(t)}</p>`).join('');
  const button = action
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0 24px"><tr><td style="border-radius:12px;background:#4f46e5">
        <a href="${escapeHtml(action.url)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:12px">${escapeHtml(action.label)}</a>
      </td></tr></table>
      <p style="margin:0 0 16px;font-size:12px;line-height:1.6;color:#64748b">If the button doesn't work, copy this link into your browser:<br><a href="${escapeHtml(action.url)}" style="color:#4f46e5;word-break:break-all">${escapeHtml(action.url)}</a></p>`
    : '';
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;background:#f4f4fb;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif">
<span style="display:none;max-height:0;overflow:hidden">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:16px;border:1px solid #e5e7f0">
<tr><td style="padding:24px 28px;border-bottom:1px solid #eef0f6;font-size:16px;font-weight:700;color:#1e1b4b">ZatGo <span style="color:#4f46e5">AI Marketing</span></td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font-size:22px;color:#0f172a">${escapeHtml(heading)}</h1>${p}${button}
${footnote ? `<p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8">${escapeHtml(footnote)}</p>` : ''}
</td></tr></table>
<p style="margin:16px 0 0;font-size:12px;color:#94a3b8">ZatGo Innovation · Create. Market. Grow. Powered by AI.</p>
</td></tr></table></body></html>`;
  const text = [heading, '', ...paragraphs, ...(action ? ['', `${action.label}: ${action.url}`] : []), ...(footnote ? ['', footnote] : [])].join('\n');
  return { html, text };
}

type Template = Omit<EmailMessage, 'to'>;

export const emailTemplates = {
  socialReauth(input: { name: string; accountName: string; platformLabel: string; reason: string; url: string }): Template {
    return {
      tag: 'social-reauth',
      subject: `Reconnect ${input.accountName} (${input.platformLabel}) on ZatGo AI Marketing`,
      ...layout({
        preheader: `${input.accountName} needs to be reconnected before you can publish to it.`,
        heading: 'Reconnect your account',
        paragraphs: [
          `Hi ${input.name}, ZatGo AI Marketing can no longer access ${input.accountName} (${input.platformLabel}).`,
          `Reason reported by the platform: ${input.reason}`,
          'Scheduled posts to this account will not publish until you reconnect it.',
        ],
        action: { label: 'Reconnect account', url: input.url },
        footnote: 'You are receiving this because you connected this account.',
      }),
    };
  },

  verifyEmail(input: { name: string; url: string }): Template {
    return {
      tag: 'verify-email',
      subject: 'Verify your email for ZatGo AI Marketing',
      ...layout({
        preheader: 'Confirm your email address to finish setting up your account.',
        heading: `Welcome, ${input.name}!`,
        paragraphs: ['Please confirm your email address to activate your ZatGo AI Marketing account.'],
        action: { label: 'Verify email', url: input.url },
        footnote: "This link expires in 24 hours. If you didn't create an account, you can ignore this email.",
      }),
    };
  },

  resetPassword(input: { name: string; url: string }): Template {
    return {
      tag: 'reset-password',
      subject: 'Reset your ZatGo AI Marketing password',
      ...layout({
        preheader: 'Use this link to choose a new password.',
        heading: 'Reset your password',
        paragraphs: [`Hi ${input.name}, we received a request to reset your password.`],
        action: { label: 'Choose a new password', url: input.url },
        footnote: "This link expires in 1 hour. If you didn't request a reset, you can safely ignore this email; your password won't change.",
      }),
    };
  },

  invitation(input: { inviterName: string; organizationName: string; roleLabel: string; url: string }): Template {
    return {
      tag: 'invitation',
      subject: `${input.inviterName} invited you to ${input.organizationName} on ZatGo AI Marketing`,
      ...layout({
        preheader: `Join ${input.organizationName} as ${input.roleLabel}.`,
        heading: `Join ${input.organizationName}`,
        paragraphs: [`${input.inviterName} has invited you to join ${input.organizationName} as ${input.roleLabel}.`],
        action: { label: 'Accept invitation', url: input.url },
        footnote: "This invitation expires in 7 days. If you weren't expecting it, you can ignore this email.",
      }),
    };
  },

  deleteAccount(input: { name: string; url: string }): Template {
    return {
      tag: 'delete-account',
      subject: 'Confirm deleting your ZatGo AI Marketing account',
      ...layout({
        preheader: 'Confirm permanent deletion of your account.',
        heading: 'Confirm account deletion',
        paragraphs: [`Hi ${input.name}, you asked to permanently delete your account. This cannot be undone.`],
        action: { label: 'Delete my account', url: input.url },
        footnote: "If you didn't request this, ignore this email and consider changing your password.",
      }),
    };
  },

  trialEnding(input: { organizationName: string; planName: string; daysLeft: number; url: string }): Template {
    return {
      tag: 'trial-ending',
      subject: `Your ${input.planName} trial ends in ${input.daysLeft} day${input.daysLeft === 1 ? '' : 's'}`,
      ...layout({
        preheader: 'Choose a plan to keep your features.',
        heading: 'Your trial is ending soon',
        paragraphs: [
          `The ${input.planName} trial for ${input.organizationName} ends in ${input.daysLeft} day${input.daysLeft === 1 ? '' : 's'}.`,
          'Choose a plan to keep your features. Otherwise your organization moves to the Free plan.',
        ],
        action: { label: 'Choose a plan', url: input.url },
      }),
    };
  },

  paymentFailed(input: { organizationName: string; planName: string; url: string }): Template {
    return {
      tag: 'payment-failed',
      subject: `Payment failed for ${input.organizationName}`,
      ...layout({
        preheader: 'Update your payment method to avoid interruption.',
        heading: 'We could not process your payment',
        paragraphs: [`The payment for the ${input.planName} plan of ${input.organizationName} failed. Please update your payment method.`],
        action: { label: 'Manage billing', url: input.url },
      }),
    };
  },
};
