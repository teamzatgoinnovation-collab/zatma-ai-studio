import { createApiClient } from '@zatma/sdk';

/** Browser API client (same-origin `/api/v1`, cookies included). */
export const api = createApiClient({ baseUrl: '/api/v1' });
