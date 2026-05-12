#!/usr/bin/env node
/**
 * Publish UI assets for one build. Reads local assets from --assets <dir>
 * (default assets/<id>-ui), uploads them to /var/www/eclipsefantasy/<id>/ui/,
 * generates a per-build ui_manifest.json, uploads it.
 *
 * Usage:
 *   node scripts/release-ui.js --build-id eclipse [--assets ./assets/eclipse-ui]
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const o = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { o[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return o;
}

const args = parseArgs(process.argv);
const buildId = args['build-id'];
if (!buildId) { console.error('Missing --build-id'); process.exit(1); }
const assetsDir = args.assets || `assets/${buildId}-ui`;
if (!fs.existsSync(assetsDir)) {
  console.error(`Assets dir not found: ${assetsDir}`);
  process.exit(1);
}

const VPS_BASE = `/var/www/eclipsefantasy/${buildId}/ui`;
const URL_BASE = `http://141.98.189.63/${buildId}/ui`;
const MANIFEST_VPS = `/var/www/eclipsefantasy/${buildId}/ui_manifest.json`;
const VPS_ALIAS = process.env.EF_VPS_SSH_ALIAS || 'darkfantasy_vps';

const ASSETS = fs.readdirSync(assetsDir)
  .filter((f) => /\.(png|mp4|mkv|webm|jpg)$/i.test(f))
  .map((name) => ({ local: path.join(assetsDir, name), out: name, vps: `${VPS_BASE}/${name}` }));

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function bumpVersion(prev) {
  const today = new Date().toISOString().slice(0, 10);
  const m = (prev || '').match(/^(\d{4}-\d{2}-\d{2})-(\d+)$/);
  if (m && m[1] === today) return `${today}-${parseInt(m[2], 10) + 1}`;
  return `${today}-1`;
}
function run(cmd, a) {
  console.log(`$ ${cmd} ${a.join(' ')}`);
  const r = spawnSync(cmd, a, { stdio: 'inherit', shell: false, env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
  if (r.status !== 0) { console.error(`exit ${r.status}`); process.exit(r.status || 1); }
}

const previous = fs.existsSync(`manifests/${buildId}-ui_manifest.json`)
  ? JSON.parse(fs.readFileSync(`manifests/${buildId}-ui_manifest.json`, 'utf8'))
  : {};
const newVersion = bumpVersion(previous.version);
console.log(`UI manifest ${buildId}: ${previous.version || '(new)'} -> ${newVersion}`);

for (const a of ASSETS) run('python', ['-u', 'scripts/sftp-upload.py', VPS_ALIAS, a.local, a.vps]);

const manifest = {
  version: newVersion,
  files: ASSETS.map((a) => ({
    path: a.out, url: `${URL_BASE}/${a.out}`,
    sha256: sha256(a.local), size: fs.statSync(a.local).size,
  })),
  generatedAt: new Date().toISOString(),
};
fs.mkdirSync('manifests', { recursive: true });
const localManifest = `manifests/${buildId}-ui_manifest.json`;
fs.writeFileSync(localManifest, JSON.stringify(manifest, null, 2));
run('python', ['-u', 'scripts/sftp-upload.py', VPS_ALIAS, localManifest, MANIFEST_VPS]);

console.log(`\n✓ UI release for ${buildId} published (v${newVersion}, ${ASSETS.length} files).`);
