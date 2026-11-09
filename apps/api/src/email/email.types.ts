export const EMAIL_QUEUE = 'email';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Short machine-readable category, e.g. `verify-email`. */
  tag: string;
  /** Organization the email relates to, if any (for logging / future per-org branding). */
  organizationId?: string;
}

export interface CapturedEmail extends EmailMessage {
  id: string;
  sentAt: string;
}

export interface EmailTransport {
  readonly name: string;
  send(message: EmailMessage): Promise<{ id: string }>;
}

export const EMAIL_TRANSPORT = Symbol('EMAIL_TRANSPORT');
