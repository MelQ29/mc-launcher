#!/usr/bin/env node
/**
 * Helper that walks a directory of unpacked modpack files and emits a
 * build_manifest.json with SHA-256 hashes and sizes.
 *
 * Usage:
 *   node scripts/build-manifest.js \
 *     --instance ./modpack-source \
 *     --archive  ./EclipseFantasy-modpack.zip \
 *     --version  2026.04.26-1 \
 *     --minecraft 1.20.1 \
 *     --fabric 0.16.14 \
 *     --archive-url https://github.com/MelQ29/mc-launcher/releases/download/build-2026.04.26-1/EclipseFantasy-modpack.zip \
 *     --out ./build_manifest.json
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 2) {
    const k = argv[i].replace(/^--/, '');
    out[k] = argv[i + 1];
  }
  return out;
}

function sha256(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function walk(root, base = root, out = []) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else if (entry.isFile()) out.push(path.relative(base, full).replace(/\\/g, '/'));
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const required = ['instance', 'archive', 'version', 'minecraft', 'fabric', 'archive-url', 'out'];
  for (const r of required) {
    if (!args[r]) {
      console.error(`Missing --${r}`);
      console.error('Usage: see comment at the top of this file');
      process.exit(1);
    }
  }
  const files = walk(args.instance).map((rel) => {
    const abs = path.join(args.instance, rel);
    return {
      path: rel,
      sha256: sha256(abs),
      size: fs.statSync(abs).size,
    };
  });
  const archiveStat = fs.statSync(args.archive);
  const manifest = {
    version: args.version,
    minecraft: args.minecraft,
    fabricLoader: args.fabric,
    archiveUrl: args['archive-url'],
    archiveSha256: sha256(args.archive),
    archiveSize: archiveStat.size,
    files,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(args.out, JSON.stringify(manifest, null, 2));
  console.log(`Wrote ${args.out} (${files.length} files, archive ${archiveStat.size} bytes)`);
}

main();
