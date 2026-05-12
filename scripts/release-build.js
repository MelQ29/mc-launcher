#!/usr/bin/env node
/**
 * Atomic release of one build's manifest: hashes the instance dir, generates
 * build_manifest.json with buildId + branding, uploads it to VPS.
 *
 * Usage:
 *   node scripts/release-build.js \
 *     --build-id eclipse \
 *     --instance ./eclipse-source \
 *     --archive ./EclipseFantasy-v1.0.5.zip \
 *     --version 1.0.5 \
 *     --minecraft 1.20.1 \
 *     --fabric 0.16.14 \
 *     --archive-url http://141.98.189.63/EclipseFantasy-v1.0.5.zip \
 *     [--recommended-ram 6144]
 *     [--upload-archive]
 *     [--branding-video background.mp4]       (default: auto-detect from assets/<id>-ui/)
 *     [--branding-play play_button.png]
 *     [--branding-options options_button.png]
 *     [--branding-replace replace_button.png]
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const o = {};
  for (let i = 2; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) o[key] = true;
    else { o[key] = next; i++; }
  }
  return o;
}
function run(cmd, a) {
  console.log(`$ ${cmd} ${a.join(' ')}`);
  const r = spawnSync(cmd, a, { stdio: 'inherit', shell: false, env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
  if (r.status !== 0) { console.error(`exit ${r.status}`); process.exit(r.status || 1); }
}

const args = parseArgs(process.argv);
const required = ['build-id','instance','archive','version','minecraft','fabric','archive-url'];
for (const r of required) if (!args[r]) { console.error(`Missing --${r}`); process.exit(1); }
const buildId = args['build-id'];
const VPS_ALIAS = process.env.EF_VPS_SSH_ALIAS || 'darkfantasy_vps';
const outLocal = `manifests/${buildId}_build_manifest.json`;
fs.mkdirSync('manifests', { recursive: true });

// Auto-detect the per-build video filename from assets/<id>-ui/ unless the
// operator overrode it. The renderer's <video> src maps directly to this
// name via ef-asset://<id>/<video>, so it MUST match the actual file in
// the published UI assets (mkv for Eclipse, mp4 for Summermon, etc.).
function detectVideo() {
  if (args['branding-video']) return args['branding-video'];
  const assetsDir = `assets/${buildId}-ui`;
  if (!fs.existsSync(assetsDir)) return 'background.mkv';  // fallback
  const videoExt = /\.(mkv|mp4|webm|mov)$/i;
  const f = fs.readdirSync(assetsDir).find((n) => /^background\./i.test(n) && videoExt.test(n));
  return f || 'background.mkv';
}

const subArgs = [
  'scripts/build-manifest.js',
  '--build-id', buildId,
  '--instance', args.instance,
  '--archive', args.archive,
  '--version', args.version,
  '--minecraft', args.minecraft,
  '--fabric', args.fabric,
  '--archive-url', args['archive-url'],
  '--out', outLocal,
  '--branding-video', detectVideo(),
  '--branding-play', args['branding-play'] || 'play_button.png',
  '--branding-options', args['branding-options'] || 'options_button.png',
  '--branding-replace', args['branding-replace'] || 'replace_button.png',
];
run('node', subArgs);

if (args['recommended-ram']) {
  const m = JSON.parse(fs.readFileSync(outLocal, 'utf8'));
  m.recommendedRamMb = parseInt(args['recommended-ram'], 10);
  fs.writeFileSync(outLocal, JSON.stringify(m, null, 2));
}

if (process.env.EF_SIGNING_KEY) {
  run('node', ['scripts/sign-manifest.js', outLocal, process.env.EF_SIGNING_KEY]);
}

if (args['upload-archive']) {
  const remoteArchive = `/var/www/eclipsefantasy/${path.basename(args.archive)}`;
  run('python', ['-u', 'scripts/sftp-upload.py', VPS_ALIAS, args.archive, remoteArchive]);
}

run('python', ['-u', 'scripts/sftp-upload.py', VPS_ALIAS, outLocal,
  `/var/www/eclipsefantasy/${buildId}/build_manifest.json`]);

console.log(`\n✓ Build ${buildId} v${args.version} manifest published.`);
