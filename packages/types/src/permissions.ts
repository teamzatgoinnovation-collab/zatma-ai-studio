import type { OrgRole } from './roles.js';

/**
 * Permission catalogue. Authorization checks are always made against permissions,
 * never role names, so custom roles can be introduced later without touching controllers.
 * Later phases append resources (design, lead, deal, campaign, ...).
 */
export const PERMISSIONS = [
  'organization:read',
  'organization:update',
  'organization:delete',
  'member:read',
  'member:invite',
  'member:update',
  'member:remove',
  'workspace:read',
  'workspace:create',
  'workspace:update',
  'workspace:delete',
  'billing:read',
  'billing:manage',
  'audit:read',
  'file:upload',
  'file:read',
  'ai:read',
  'ai:generate',
  'design:read',
  'design:write',
  'copy:read',
  'copy:write',
  'crm:read',
  'crm:write',
  'crm:delete',
  'campaign:read',
  'campaign:write',
  'social:read',
  'social:draft',
  'social:publish',
  'social:connect',
  'ads:read',
  'ads:manage',
  /** Start spending: activate, resume or raise budgets (Owner/Admin). */
  'ads:approve',
  'analytics:read',
  'automation:read',
  'automation:write',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: readonly Permission[] = PERMISSIONS;

const READ_ONLY: Permission[] = [
  'organization:read',
  'member:read',
  'workspace:read',
  'file:read',
  'ai:read',
  'design:read',
  'copy:read',
  'crm:read',
  'campaign:read',
  'social:read',
  'ads:read',
  'analytics:read',
  'automation:read',
];

const without = (list: readonly Permission[], ...excluded: Permission[]): Permission[] =>
  list.filter((p) => !excluded.includes(p));

export const ROLE_PERMISSIONS: Record<OrgRole, readonly Permission[]> = {
  ORGANIZATION_OWNER: ALL,
  ADMIN: without(ALL, 'organization:delete', 'billing:manage'),
  MARKETING_MANAGER: [
    ...READ_ONLY,
    'workspace:create',
    'workspace:update',
    'file:upload',
    'ai:generate',
    'design:write',
    'copy:write',
    'campaign:write',
    'social:draft',
    'social:publish',
    'social:connect',
    'ads:manage',
    'automation:write',
  ],
  CRM_MANAGER: [...READ_ONLY, 'file:upload', 'ai:generate', 'crm:write', 'crm:delete', 'automation:write'],
  SALES_AGENT: [...READ_ONLY, 'file:upload', 'ai:generate', 'crm:write'],
  DESIGNER: [...READ_ONLY, 'file:upload', 'ai:generate', 'design:write', 'copy:write', 'social:draft'],
  ANALYST: [...READ_ONLY, 'audit:read'],
  VIEWER: READ_ONLY,
};

export function permissionsForRole(role: OrgRole | null | undefined): readonly Permission[] {
  return role ? ROLE_PERMISSIONS[role] : [];
}

export function hasPermissions(role: OrgRole | null | undefined, required: readonly Permission[]): boolean {
  const granted = permissionsForRole(role);
  return required.every((p) => granted.includes(p));
}
