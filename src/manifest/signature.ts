import { createPublicKey, verify } from 'crypto';
import { logger } from '../core/logger';

/**
 * Verifies an ed25519 signature over the canonical manifest body.
 *
 * The canonical body is the JSON-stringified manifest with the `signature`
 * field removed and keys sorted alphabetically. Producers must apply the
 * same canonicalisation before signing — see scripts/sign-manifest.example.js
 * in the README.
 *
 * Public key is supplied as a hex-encoded raw 32-byte ed25519 key OR as a
 * PEM string. Empty/missing key disables verification.
 */
export function verifyManifestSignature(
  manifest: Record<string, unknown>,
  publicKey: string | undefined,
  required: boolean,
): { ok: boolean; reason?: string } {
  const sig = typeof manifest.signature === 'string' ? manifest.signature : undefined;
  if (!sig) {
    if (required) return { ok: false, reason: 'manifest is unsigned but signature is required' };
    logger.warn('signature', 'Manifest is unsigned (signature field missing)');
    return { ok: true };
  }
  if (!publicKey) {
    if (required) return { ok: false, reason: 'no public key configured for verification' };
    logger.warn('signature', 'Manifest has signature but no public key configured — skipping verification');
    return { ok: true };
  }
  try {
    const body = canonicalize(stripSignature(manifest));
    const key = parseKey(publicKey);
    const ok = verify(null, Buffer.from(body, 'utf8'), key, Buffer.from(sig, 'hex'));
    if (!ok) return { ok: false, reason: 'signature verification failed' };
    logger.info('signature', 'Manifest signature verified');
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

function stripSignature(obj: Record<string, unknown>): Record<string, unknown> {
  const { signature: _omit, ...rest } = obj;
  return rest;
}

/** Deterministic JSON serializer with sorted object keys. */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
}

function parseKey(raw: string) {
  const trimmed = raw.trim();
  if (trimmed.startsWith('-----BEGIN')) return createPublicKey({ key: trimmed, format: 'pem' });
  // Raw 32-byte ed25519 hex public key, wrap in DER (SubjectPublicKeyInfo).
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    const der = Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'),
      Buffer.from(trimmed, 'hex'),
    ]);
    return createPublicKey({ key: der, format: 'der', type: 'spki' });
  }
  throw new Error('signaturePublicKey must be PEM or 64-char hex (raw ed25519)');
}
