import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './index.js';

const jsonResponse = (status: number, body: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('api client', () => {
  it('sends credentials and builds query strings', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [], meta: {} }));
    const api = createApiClient({ baseUrl: 'http://api/api/v1/', fetch: fetchMock });
    await api.workspaces.list({ page: 2, pageSize: undefined });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://api/api/v1/workspaces?page=2');
    expect(init.credentials).toBe('include');
  });

  it('maps error envelopes to ApiError', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, { statusCode: 404, code: 'NOT_FOUND', message: 'Workspace not found' }));
    const api = createApiClient({ baseUrl: '/api/v1', fetch: fetchMock });
    const err = await api.workspaces.get('x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('NOT_FOUND');
    expect((err as ApiError).status).toBe(404);
  });

  it('handles 204 responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const api = createApiClient({ baseUrl: '/api/v1', fetch: fetchMock });
    await expect(api.workspaces.remove('x')).resolves.toBeUndefined();
  });
});
