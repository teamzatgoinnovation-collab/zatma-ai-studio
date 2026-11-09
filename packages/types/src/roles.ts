/** Organization-level roles. SUPER_ADMIN is a platform role and is never granted via membership. */
export const ORG_ROLES = [
  'ORGANIZATION_OWNER',
  'ADMIN',
  'MARKETING_MANAGER',
  'CRM_MANAGER',
  'SALES_AGENT',
  'DESIGNER',
  'ANALYST',
  'VIEWER',
] as const;

export type OrgRole = (typeof ORG_ROLES)[number];

export const PLATFORM_ROLES = ['SUPER_ADMIN'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

/** Better Auth stores member roles as lowercase strings; these helpers map between the two. */
export const toAuthRole = (role: OrgRole): string => role.toLowerCase();

export function fromAuthRole(role: string | null | undefined): OrgRole | null {
  if (!role) return null;
  // Better Auth allows comma-separated multi-roles; we use the first recognised one.
  for (const part of role.split(',')) {
    const upper = part.trim().toUpperCase();
    if ((ORG_ROLES as readonly string[]).includes(upper)) return upper as OrgRole;
  }
  return null;
}

export const ROLE_LABELS: Record<OrgRole, string> = {
  ORGANIZATION_OWNER: 'Owner',
  ADMIN: 'Admin',
  MARKETING_MANAGER: 'Marketing Manager',
  CRM_MANAGER: 'CRM Manager',
  SALES_AGENT: 'Sales Agent',
  DESIGNER: 'Designer',
  ANALYST: 'Analyst',
  VIEWER: 'Viewer',
};
