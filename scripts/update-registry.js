#!/usr/bin/env node
/**
 * Manage builds.json on the VPS.
 *
 * Usage:
 *   node scripts/update-registry.js add --id eclipse --display-name "Eclipse Fantasy" --short-name ECLIPSE --accent "#ffd144" --order 1
 *   node scripts/update-registry.js disable    --id summermon
 *   node scripts/update-registry.js enable     --id summermon
 *   node scripts/update-registry.js remove     --id summermon
 *   node scripts/update-registry.js set-default --id eclipse
 */
const fs = require('fs');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const cmd = argv[2];
  const rest = {};
  for (let i = 3; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { rest[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return { cmd, ...rest };
}
function run(cmd, a) {
  const r = spawnSync(cmd, a, { stdio: 'inherit', shell: false, env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
  if (r.status !== 0) { console.error(`exit ${r.status}`); process.exit(r.status || 1); }
}
function tryDownload(remote, local) {
  return spawnSync('python', ['-u', 'scripts/sftp-upload.py', VPS_ALIAS, '--download', remote, local],
    { stdio: 'inherit', shell: false }).status === 0;
}

const VPS_ALIAS = process.env.EF_VPS_SSH_ALIAS || 'darkfantasy_vps';
const VPS_HOST = process.env.EF_VPS_HOST || '141.98.189.63';
const remotePath = '/var/www/eclipsefantasy/builds.json';
const localPath = 'manifests/builds.json';
fs.mkdirSync('manifests', { recursive: true });

const args = parseArgs(process.argv);
if (!args.cmd) { console.error('Usage: see top of file'); process.exit(1); }

function readCurrent() {
  if (tryDownload(remotePath, localPath) && fs.existsSync(localPath)) {
    return JSON.parse(fs.readFileSync(localPath, 'utf8'));
  }
  return { schemaVersion: 1, defaultBuildId: '', builds: [] };
}

function writeAndUpload(reg) {
  reg.generatedAt = new Date().toISOString();
  reg.schemaVersion = 1;
  reg.builds.sort((a, b) => a.order - b.order);
  fs.writeFileSync(localPath, JSON.stringify(reg, null, 2));
  if (process.env.EF_SIGNING_KEY) {
    run('node', ['scripts/sign-manifest.js', localPath, process.env.EF_SIGNING_KEY]);
  }
  run('python', ['-u', 'scripts/sftp-upload.py', VPS_ALIAS, localPath, remotePath]);
  console.log(`✓ builds.json updated (${reg.builds.length} builds, default=${reg.defaultBuildId}).`);
}

const reg = readCurrent();
const id = args.id;
if (!id && ['add', 'disable', 'enable', 'remove', 'set-default'].includes(args.cmd)) {
  console.error('Missing --id'); process.exit(1);
}
const idx = reg.builds.findIndex((b) => b.id === id);

if (args.cmd === 'add') {
  const entry = {
    id, displayName: args['display-name'] || id, shortName: args['short-name'] || id.toUpperCase(),
    buildManifestUrl: args['build-manifest-url'] || `http://${VPS_HOST}/${id}/build_manifest.json`,
    uiManifestUrl: args['ui-manifest-url'] || `http://${VPS_HOST}/${id}/ui_manifest.json`,
    newsUrl: args['news-url'] || `http://${VPS_HOST}/${id}/news.json`,
    accentColor: args.accent || '#d23a8b',
    enabled: true,
    order: parseInt(args.order ?? '99', 10),
  };
  if (idx >= 0) reg.builds[idx] = { ...reg.builds[idx], ...entry };
  else reg.builds.push(entry);
  if (!reg.defaultBuildId) reg.defaultBuildId = id;
  writeAndUpload(reg);
} else if (args.cmd === 'disable' || args.cmd === 'enable') {
  if (idx < 0) { console.error(`Unknown id: ${id}`); process.exit(1); }
  reg.builds[idx].enabled = args.cmd === 'enable';
  writeAndUpload(reg);
} else if (args.cmd === 'remove') {
  if (idx < 0) { console.error(`Unknown id: ${id}`); process.exit(1); }
  reg.builds.splice(idx, 1);
  if (reg.defaultBuildId === id) reg.defaultBuildId = reg.builds[0]?.id || '';
  writeAndUpload(reg);
} else if (args.cmd === 'set-default') {
  if (idx < 0) { console.error(`Unknown id: ${id}`); process.exit(1); }
  reg.defaultBuildId = id;
  writeAndUpload(reg);
} else {
  console.error(`Unknown command: ${args.cmd}`); process.exit(1);
}
