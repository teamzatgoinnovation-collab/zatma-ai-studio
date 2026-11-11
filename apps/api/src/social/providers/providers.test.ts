import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LinkedInProvider } from './linkedin.provider.js';
import { MetaProvider, parseSignedRequest, verifyMetaSignature } from './meta.provider.js';
import { pkcePair, ProviderAuthError, ProviderError, type FetchLike } from './provider.js';
import { YouTubeProvider } from './youtube.provider.js';

type Route = (url: URL, init?: RequestInit) => { status?: number; body: unknown } | undefined;
function fakeFetch(routes: Route[]) {
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const impl: FetchLike = async (u, init) => {
    const url = new URL(u);
    calls.push({ url, init });
    for (const r of routes) {
      const res = r(url, init);
      if (res) return new Response(JSON.stringify(res.body), { status: res.status ?? 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: { message: `unexpected ${url.pathname}` } }), { status: 404 });
  };
  return { impl, calls };
}

const META = { appId: 'app1', appSecret: 'secret1', graphVersion: 'v24.0', graphUrl: 'https://graph.test', oauthUrl: 'https://www.fb.test' };

describe('MetaProvider', () => {
  it('builds the login URL with Pages + Instagram permissions', () => {
    const url = new URL(new MetaProvider(META).authorizeUrl({ state: 'st', redirectUri: 'https://api.test/cb' }));
    expect(url.origin + url.pathname).toBe('https://www.fb.test/v24.0/dialog/oauth');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: 'app1', redirect_uri: 'https://api.test/cb', state: 'st', response_type: 'code' });
    expect(url.searchParams.get('scope')).toContain('instagram_content_publish');
  });

  it('exchanges the code for a long-lived token with appsecret_proof and granted scopes', async () => {
    const f = fakeFetch([
      (u) => (u.pathname === '/v24.0/oauth/access_token' && u.searchParams.get('code') === 'c1' ? { body: { access_token: 'short' } } : undefined),
      (u) => (u.pathname === '/v24.0/oauth/access_token' && u.searchParams.get('grant_type') === 'fb_exchange_token' ? { body: { access_token: 'long', expires_in: 5_184_000 } } : undefined),
      (u) => (u.pathname === '/v24.0/me' ? { body: { id: 'u1', name: 'Zain' } } : undefined),
      (u) => (u.pathname === '/v24.0/me/permissions' ? { body: { data: [{ permission: 'pages_show_list', status: 'granted' }, { permission: 'instagram_basic', status: 'declined' }] } } : undefined),
    ]);
    const meta = new MetaProvider(META, f.impl);
    const g = await meta.exchangeCode({ code: 'c1', redirectUri: 'https://api.test/cb' });
    expect(g).toMatchObject({ accessToken: 'long', refreshToken: null, externalUserId: 'u1', displayName: 'Zain', scopes: ['pages_show_list'] });
    expect(g.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 59 * 86_400_000);
    const me = f.calls.find((c) => c.url.pathname === '/v24.0/me')!;
    expect(me.url.searchParams.get('appsecret_proof')).toBe(createHmac('sha256', 'secret1').update('long').digest('hex'));
  });

  it('lists Pages with page tokens and their linked Instagram accounts, following pagination', async () => {
    const f = fakeFetch([
      (u) =>
        u.pathname === '/v24.0/me/accounts' && !u.searchParams.get('after')
          ? {
              body: {
                data: [{ id: 'p1', name: 'ZatGo Kochi', access_token: 'pt1', picture: { data: { url: 'https://img/p1' } }, instagram_business_account: { id: 'ig1', username: 'zatgo.kochi', profile_picture_url: 'https://img/ig1' } }],
                paging: { next: 'https://graph.test/v24.0/me/accounts?after=X' },
              },
            }
          : undefined,
      (u) => (u.pathname === '/v24.0/me/accounts' && u.searchParams.get('after') === 'X' ? { body: { data: [{ id: 'p2', name: 'ZatGo Dubai', access_token: 'pt2' }] } } : undefined),
    ]);
    const accounts = await new MetaProvider(META, f.impl).listAccounts('long');
    expect(accounts.map((a) => [a.platform, a.externalId, a.name, a.username, a.accountToken])).toEqual([
      ['FACEBOOK_PAGE', 'p1', 'ZatGo Kochi', null, 'pt1'],
      ['INSTAGRAM_BUSINESS', 'ig1', 'zatgo.kochi', 'zatgo.kochi', 'pt1'],
      ['FACEBOOK_PAGE', 'p2', 'ZatGo Dubai', null, 'pt2'],
    ]);
    expect(accounts[1]!.capabilities).toEqual({ pageId: 'p1' });
  });

  it('maps expired tokens to re-auth and other errors to ERROR', async () => {
    const expired = fakeFetch([() => ({ status: 400, body: { error: { message: 'Error validating access token: Session has expired', code: 190 } } })]);
    expect(await new MetaProvider(META, expired.impl).checkAccount({ platform: 'FACEBOOK_PAGE', externalId: 'p1', token: 't' })).toEqual({ status: 'NEEDS_REAUTH', error: 'Error validating access token: Session has expired' });
    const down = fakeFetch([() => ({ status: 500, body: { error: { message: 'Service temporarily unavailable', code: 2 } } })]);
    expect(await new MetaProvider(META, down.impl).checkAccount({ platform: 'FACEBOOK_PAGE', externalId: 'p1', token: 't' })).toEqual({ status: 'ERROR', error: 'Service temporarily unavailable' });
    await expect(new MetaProvider(META, expired.impl).listAccounts('t')).rejects.toBeInstanceOf(ProviderAuthError);
  });

  it('verifies webhook signatures and signed requests', () => {
    const body = Buffer.from('{"object":"page"}');
    const sig = 'sha256=' + createHmac('sha256', 'secret1').update(body).digest('hex');
    expect(verifyMetaSignature(body, sig, 'secret1')).toBe(true);
    expect(verifyMetaSignature(body, sig, 'other')).toBe(false);
    expect(verifyMetaSignature(body, undefined, 'secret1')).toBe(false);
    const payload = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: 'u1', issued_at: 1 })).toString('base64url');
    const sr = `${createHmac('sha256', 'secret1').update(payload).digest('base64url')}.${payload}`;
    expect(parseSignedRequest(sr, 'secret1')).toMatchObject({ user_id: 'u1' });
    expect(parseSignedRequest(sr, 'wrong')).toBeNull();
    expect(parseSignedRequest('nonsense', 'secret1')).toBeNull();
  });
});

const LI = { clientId: 'li1', clientSecret: 'lis', apiVersion: '202510', apiUrl: 'https://api.li.test', oauthUrl: 'https://www.li.test/oauth/v2' };

describe('LinkedInProvider', () => {
  it('exchanges the code, reads the member and lists administered organizations with version headers', async () => {
    const f = fakeFetch([
      (u, i) => (u.pathname === '/oauth/v2/accessToken' && String(i?.body).includes('grant_type=authorization_code') ? { body: { access_token: 'lat', expires_in: 5_184_000, refresh_token: 'lrt', scope: 'openid,profile,w_organization_social' } } : undefined),
      (u) => (u.pathname === '/v2/userinfo' ? { body: { sub: 'm1', name: 'Zain S' } } : undefined),
      (u) => (u.pathname === '/rest/organizationAcls' ? { body: { elements: [{ organization: 'urn:li:organization:101', role: 'ADMINISTRATOR', state: 'APPROVED' }] } } : undefined),
      (u) => (u.pathname === '/rest/organizations/101' ? { body: { id: 101, localizedName: 'ZatGo Innovation', vanityName: 'zatgo' } } : undefined),
    ]);
    const li = new LinkedInProvider(LI, f.impl);
    expect(new URL(li.authorizeUrl({ state: 's', redirectUri: 'https://api.test/cb' })).searchParams.get('scope')).toBe('openid profile w_organization_social r_organization_social rw_organization_admin');
    const g = await li.exchangeCode({ code: 'c', redirectUri: 'https://api.test/cb' });
    expect(g).toMatchObject({ accessToken: 'lat', refreshToken: 'lrt', externalUserId: 'm1', displayName: 'Zain S', scopes: ['openid', 'profile', 'w_organization_social'] });
    const accounts = await li.listAccounts('lat');
    expect(accounts).toEqual([{ platform: 'LINKEDIN_PAGE', externalId: '101', name: 'ZatGo Innovation', username: 'zatgo', avatarUrl: null, accountToken: null, capabilities: { urn: 'urn:li:organization:101' } }]);
    const acl = f.calls.find((c) => c.url.pathname === '/rest/organizationAcls')!;
    expect(acl.init?.headers).toMatchObject({ 'LinkedIn-Version': '202510', 'X-Restli-Protocol-Version': '2.0.0', Authorization: 'Bearer lat' });
  });

  it('refreshes tokens and treats a rejected refresh as re-auth', async () => {
    const ok = fakeFetch([(u, i) => (String(i?.body).includes('grant_type=refresh_token') ? { body: { access_token: 'new', expires_in: 100 } } : undefined)]);
    expect(await new LinkedInProvider(LI, ok.impl).refresh({ refreshToken: 'lrt' })).toMatchObject({ accessToken: 'new', refreshToken: 'lrt' });
    const bad = fakeFetch([() => ({ status: 400, body: { error: 'invalid_grant', error_description: 'The token used in the request has been revoked' } })]);
    await expect(new LinkedInProvider(LI, bad.impl).refresh({ refreshToken: 'x' })).rejects.toThrow(ProviderAuthError);
  });
});

const YT = { clientId: 'g1', clientSecret: 'gs', authUrl: 'https://accounts.g.test/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.g.test/token', revokeUrl: 'https://oauth2.g.test/revoke', apiUrl: 'https://yt.g.test/youtube/v3' };

describe('YouTubeProvider', () => {
  it('uses offline access with PKCE and lists channels', async () => {
    const { verifier, challenge } = pkcePair();
    const yt0 = new YouTubeProvider(YT);
    const url = new URL(yt0.authorizeUrl({ state: 's', redirectUri: 'https://api.test/cb', codeChallenge: challenge }));
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ access_type: 'offline', prompt: 'consent', code_challenge: challenge, code_challenge_method: 'S256' });

    const f = fakeFetch([
      (u, i) => (u.pathname === '/token' && String(i?.body).includes(`code_verifier=${verifier}`) ? { body: { access_token: 'yat', expires_in: 3599, refresh_token: 'yrt', scope: YT_SCOPES } } : undefined),
      (u) => (u.pathname === '/youtube/v3/channels' ? { body: { items: [{ id: 'UC1', snippet: { title: 'ZatGo TV', customUrl: '@zatgotv', thumbnails: { default: { url: 'https://img/yt' } } } }] } } : undefined),
    ]);
    const yt = new YouTubeProvider(YT, f.impl);
    const g = await yt.exchangeCode({ code: 'c', redirectUri: 'https://api.test/cb', codeVerifier: verifier });
    expect(g).toMatchObject({ accessToken: 'yat', refreshToken: 'yrt', externalUserId: 'UC1', displayName: 'ZatGo TV' });
    expect(await yt.listAccounts('yat')).toEqual([{ platform: 'YOUTUBE_CHANNEL', externalId: 'UC1', name: 'ZatGo TV', username: '@zatgotv', avatarUrl: 'https://img/yt', accountToken: null, capabilities: {} }]);
  });

  it('maps invalid_grant to re-auth and other failures to ProviderError', async () => {
    const bad = fakeFetch([() => ({ status: 400, body: { error: 'invalid_grant' } })]);
    await expect(new YouTubeProvider(YT, bad.impl).refresh({ refreshToken: 'x' })).rejects.toBeInstanceOf(ProviderAuthError);
    const quota = fakeFetch([() => ({ status: 429, body: { error: { message: 'Quota exceeded' } } })]);
    await expect(new YouTubeProvider(YT, quota.impl).listAccounts('t')).rejects.toBeInstanceOf(ProviderError);
  });
});

const YT_SCOPES = 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload';
