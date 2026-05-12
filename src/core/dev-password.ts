import { createHash, timingSafeEqual } from 'crypto';

/**
 * SHA-256 of the developer password. Plaintext is documented in internal
 * runbooks — not in source code. Hash here guards against accidental
 * toggling of developer-only controls by regular users; it is NOT
 * cryptographic security (the Electron app source is shipped to users).
 */
const DEV_PASSWORD_SHA256 =
  'f80511865de9af3705eef57c9f0b6477d89d0ceff84f1c3bd03c2f80f94b81ec';

export function verifyDevPassword(input: string): boolean {
  const got = createHash('sha256').update(input, 'utf8').digest('hex');
  const a = Buffer.from(got, 'hex');
  const b = Buffer.from(DEV_PASSWORD_SHA256, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
