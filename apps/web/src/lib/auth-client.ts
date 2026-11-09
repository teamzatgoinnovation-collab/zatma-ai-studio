'use client';

import { createAuthClient } from 'better-auth/react';
import { organizationClient } from 'better-auth/client/plugins';

/** Better Auth client. Requests go to /api/auth on the same origin (proxied to the API). */
export const authClient = createAuthClient({
  basePath: '/api/auth',
  plugins: [organizationClient()],
});
