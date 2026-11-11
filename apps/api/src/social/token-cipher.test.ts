import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TokenCipher, TokenCipherError } from './token-cipher.js';

const key = () => randomBytes(32).toString('base64');

describe('TokenCipher', () => {
  const k1 = key();
  const cipher = new TokenCipher(`k1:${k1}`);

  it('round-trips and produces different ciphertexts each time', () => {
    const a = cipher.encrypt('EAAG-secret-token', 'org1:conn1');
    const b = cipher.encrypt('EAAG-secret-token', 'org1:conn1');
    expect(a).not.toBe(b);
    expect(a).not.toContain('secret');
    expect(a.startsWith('v1.k1.')).toBe(true);
    expect(cipher.decrypt(a, 'org1:conn1')).toBe('EAAG-secret-token');
  });

  it('rejects tampering and ciphertexts moved to another row or organization', () => {
    const c = cipher.encrypt('token', 'org1:conn1');
    expect(() => cipher.decrypt(c, 'org2:conn1')).toThrow(TokenCipherError);
    const parts = c.split('.');
    parts[4] = Buffer.from('x' + Buffer.from(parts[4]!, 'base64url').toString('latin1').slice(1), 'latin1').toString('base64url');
    expect(() => cipher.decrypt(parts.join('.'), 'org1:conn1')).toThrow('failed authentication');
    expect(() => cipher.decrypt('garbage', 'org1:conn1')).toThrow('Malformed');
  });

  it('supports key rotation', () => {
    const old = cipher.encrypt('legacy', 'aad');
    const rotated = new TokenCipher(`k2:${key()},k1:${k1}`);
    expect(rotated.decrypt(old, 'aad')).toBe('legacy');
    expect(rotated.needsRotation(old)).toBe(true);
    const fresh = rotated.encrypt('new', 'aad');
    expect(fresh.split('.')[1]).toBe('k2');
    expect(rotated.needsRotation(fresh)).toBe(false);
    expect(() => new TokenCipher(`k3:${key()}`).decrypt(old, 'aad')).toThrow('Unknown encryption key');
  });

  it('validates key configuration', () => {
    expect(() => new TokenCipher('k1:short')).toThrow(TokenCipherError);
    expect(() => new TokenCipher('')).toThrow(TokenCipherError);
  });
});
