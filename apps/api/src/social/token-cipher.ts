import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export class TokenCipherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenCipherError';
  }
}

const b64 = (b: Buffer) => b.toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url');

/**
 * AES-256-GCM encryption for OAuth tokens at rest.
 * Format: `v1.<kid>.<iv>.<tag>.<ciphertext>` (base64url). The associated data (e.g. organization id + row id)
 * is authenticated, so a ciphertext copied into another row or organization will not decrypt.
 * Several keys may be configured: the first encrypts, any listed key decrypts (rotation).
 */
export class TokenCipher {
  private readonly keys: Map<string, Buffer>;
  private readonly primary: string;

  constructor(spec: string) {
    this.keys = new Map();
    for (const entry of spec.split(',')) {
      const [kid, key] = entry.trim().split(':');
      const buf = key ? Buffer.from(key, 'base64') : Buffer.alloc(0);
      if (!kid || buf.length !== 32) throw new TokenCipherError('Invalid TOKEN_ENCRYPTION_KEYS entry');
      this.keys.set(kid, buf);
    }
    const first = spec.split(',')[0]!.trim().split(':')[0];
    if (!first) throw new TokenCipherError('No encryption key configured');
    this.primary = first;
  }

  encrypt(plaintext: string, aad: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.primary)!, iv);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return ['v1', this.primary, b64(iv), b64(cipher.getAuthTag()), b64(ct)].join('.');
  }

  decrypt(payload: string, aad: string): string {
    const parts = payload.split('.');
    if (parts.length !== 5 || parts[0] !== 'v1') throw new TokenCipherError('Malformed encrypted token');
    const [, kid, iv, tag, ct] = parts as [string, string, string, string, string];
    const key = this.keys.get(kid);
    if (!key) throw new TokenCipherError(`Unknown encryption key "${kid}"`);
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, unb64(iv));
      decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(unb64(tag));
      return Buffer.concat([decipher.update(unb64(ct)), decipher.final()]).toString('utf8');
    } catch {
      throw new TokenCipherError('Encrypted token failed authentication');
    }
  }

  /** True when the payload was encrypted with an older key and should be re-encrypted. */
  needsRotation(payload: string): boolean {
    return payload.split('.')[1] !== this.primary;
  }
}
