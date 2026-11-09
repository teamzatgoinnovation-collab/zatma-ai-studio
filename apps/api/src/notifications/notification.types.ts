export const NOTIFICATIONS_QUEUE = 'notifications';

export type NotificationType = 'organization.welcome' | 'member.invited' | 'system.test';

export interface NotificationJob {
  type: NotificationType;
  organizationId: string;
  userId?: string;
  payload: Record<string, unknown>;
}
