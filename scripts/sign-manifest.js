#!/usr/bin/env node
/**
 * Sign a manifest with an ed25519 private key. The launcher verifies the
 * signature using the canonical JSON of the manifest with the `signature`
 * field stripped (see src/manifest/signature.ts).
 *
 * Usage:
 *   node scripts/sign-manifest.js --in build_manifest.json --key private.pem --out build_manifest.json
 */
const fs = require('fs');
const crypto = require('crypto');

function args() {
  const o = {};
  for (let i = 2; i < process.argv.length; i += 2) o[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
  return o;
}

function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  const ks = Object.keys(v).sort();
  return '{' + ks.map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}

function main() {
  const a = args();
  if (!a.in || !a.key || !a.out) {
    console.error('usage: sign-manifest.js --in manifest.json --key key.pem --out signed.json');
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(a.in, 'utf8'));
  delete manifest.signature;
  const body = canonical(manifest);
  const key = crypto.createPrivateKey({ key: fs.readFileSync(a.key) });
  const sig = crypto.sign(null, Buffer.from(body, 'utf8'), key).toString('hex');
  manifest.signature = sig;
  fs.writeFileSync(a.out, JSON.stringify(manifest, null, 2));
  console.log(`Signed -> ${a.out}`);
}

main();
