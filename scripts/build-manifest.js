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
  // Streaming so multi-GB modpack archives don't blow Node's Buffer limit.
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const s = fs.createReadStream(file);
    s.on('data', (c) => hash.update(c));
    s.on('end', () => resolve(hash.digest('hex')));
    s.on('error', reject);
  });
}

function walk(root, base = root, out = []) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else if (entry.isFile()) out.push(path.relative(base, full).replace(/\\/g, '/'));
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const required = ['build-id', 'instance', 'archive', 'version', 'minecraft', 'fabric', 'archive-url', 'out'];
  for (const r of required) {
    if (!args[r]) {
      console.error(`Missing --${r}`);
      console.error('Usage: see comment at the top of this file');
      process.exit(1);
    }
  }
  const relPaths = walk(args.instance);
  console.log(`Hashing ${relPaths.length} files...`);
  const files = [];
  let i = 0;
  for (const rel of relPaths) {
    const abs = path.join(args.instance, rel);
    files.push({
      path: rel,
      sha256: await sha256(abs),
      size: fs.statSync(abs).size,
    });
    i++;
    if (i % 200 === 0) console.log(`  ${i}/${relPaths.length}`);
  }
  console.log('Hashing archive...');
  const archiveSha = await sha256(args.archive);
  const archiveStat = fs.statSync(args.archive);
  const manifest = {
    version: args.version,
    minecraft: args.minecraft,
    fabricLoader: args.fabric,
    archiveUrl: args['archive-url'],
    archiveSha256: archiveSha,
    archiveSize: archiveStat.size,
    files,
    generatedAt: new Date().toISOString(),
  };
  if (args['build-id']) manifest.buildId = args['build-id'];
  if (args['branding-video'] || args['branding-play']) {
    manifest.branding = {
      video: args['branding-video'] ?? 'background.mkv',
      playButton: args['branding-play'] ?? 'play_button.png',
      optionsButton: args['branding-options'] ?? 'options_button.png',
      replaceButton: args['branding-replace'] ?? 'replace_button.png',
    };
  }
  fs.writeFileSync(args.out, JSON.stringify(manifest, null, 2));
  console.log(`Wrote ${args.out} (${files.length} files, archive ${archiveStat.size} bytes)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
