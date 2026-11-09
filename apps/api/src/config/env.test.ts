import { describe, expect, it } from 'vitest';
import { EnvValidationError, loadEnv } from './env.js';

const base = {
  API_URL: 'http://localhost:4000',
  WEB_ORIGIN: 'http://localhost:3000, https://marketing.zatgoinnovation.com',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  BETTER_AUTH_SECRET: 'x'.repeat(40),
  S3_BUCKET: 'bucket',
  S3_ACCESS_KEY_ID: 'a',
  S3_SECRET_ACCESS_KEY: 'b',
};

describe('environment validation', () => {
  it('parses a valid environment with defaults', () => {
    const env = loadEnv(base);
    expect(env.PORT).toBe(4000);
    expect(env.WEB_ORIGIN).toEqual(['http://localhost:3000', 'https://marketing.zatgoinnovation.com']);
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
  });

  it('fails fast listing every missing variable', () => {
    try {
      loadEnv({});
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EnvValidationError);
      expect((e as EnvValidationError).issues.join()).toMatch(/DATABASE_URL.*BETTER_AUTH_SECRET|BETTER_AUTH_SECRET/s);
    }
  });

  it('rejects short secrets and half-configured Google OAuth', () => {
    expect(() => loadEnv({ ...base, BETTER_AUTH_SECRET: 'short' })).toThrow(EnvValidationError);
    expect(() => loadEnv({ ...base, GOOGLE_CLIENT_ID: 'id' })).toThrow(/GOOGLE_CLIENT_ID/);
  });

  it('refuses placeholder secrets in production', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', BETTER_AUTH_SECRET: 'change-me-' + 'x'.repeat(30) })).toThrow(/production/);
  });
});
