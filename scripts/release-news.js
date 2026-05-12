#!/usr/bin/env node
/**
 * Manage per-build news.json on the VPS.
 *
 * Usage:
 *   node scripts/release-news.js init    --build-id <id>
 *   node scripts/release-news.js add     --build-id <id>
 *   node scripts/release-news.js publish --build-id <id> --from <draft.json>
 *   node scripts/release-news.js remove  --build-id <id> --id <entry-id>
 */
const fs = require('fs');
const readline = require('readline');
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
function sftpDownload(remote, local) {
  return spawnSync('python', ['-u', 'scripts/sftp-upload.py', VPS_ALIAS, '--download', remote, local],
    { stdio: 'inherit', shell: false }).status === 0;
}

const VPS_ALIAS = process.env.EF_VPS_SSH_ALIAS || 'darkfantasy_vps';
const args = parseArgs(process.argv);
const buildId = args['build-id'];
if (!buildId || !args.cmd) { console.error('Usage: see top of file'); process.exit(1); }

const localCache = `manifests/${buildId}_news.json`;
const remotePath = `/var/www/eclipsefantasy/${buildId}/news.json`;
fs.mkdirSync('manifests', { recursive: true });

function readCurrent() {
  if (sftpDownload(remotePath, localCache) && fs.existsSync(localCache)) {
    return JSON.parse(fs.readFileSync(localCache, 'utf8'));
  }
  return { schemaVersion: 1, buildId, entries: [] };
}

function writeAndUpload(feed) {
  feed.entries.sort((a, b) => b.date.localeCompare(a.date));
  feed.generatedAt = new Date().toISOString();
  feed.schemaVersion = 1;
  feed.buildId = buildId;
  fs.writeFileSync(localCache, JSON.stringify(feed, null, 2));
  if (process.env.EF_SIGNING_KEY) {
    run('node', ['scripts/sign-manifest.js', localCache, process.env.EF_SIGNING_KEY]);
  }
  run('python', ['-u', 'scripts/sftp-upload.py', VPS_ALIAS, localCache, remotePath]);
  console.log(`✓ news.json (${buildId}) updated, ${feed.entries.length} entries.`);
}

async function promptEntry() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const q = (s) => new Promise((res) => rl.question(s, (a) => res(a)));
  const date = (await q('Date (YYYY-MM-DD) [today]: ')) || new Date().toISOString().slice(0, 10);
  const type = (await q('Type (changelog|event|notice) [changelog]: ')) || 'changelog';
  const title = await q('Title: ');
  const body = await q('Body: ');
  let eventStart, eventEnd;
  if (type === 'event') {
    eventStart = (await q('Event start (ISO 8601, optional): ')) || undefined;
    eventEnd = (await q('Event end (ISO 8601, optional): ')) || undefined;
  }
  rl.close();
  const id = `${date}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)}`;
  return { id, date, type, title, body, eventStart, eventEnd };
}

(async () => {
  if (args.cmd === 'init') {
    writeAndUpload({ schemaVersion: 1, buildId, entries: [] });
    return;
  }
  const feed = readCurrent();
  if (args.cmd === 'add') {
    const entry = await promptEntry();
    feed.entries.push(entry);
    writeAndUpload(feed);
  } else if (args.cmd === 'publish') {
    if (!args.from) { console.error('Missing --from'); process.exit(1); }
    const fresh = JSON.parse(fs.readFileSync(args.from, 'utf8'));
    writeAndUpload({ ...feed, ...fresh });
  } else if (args.cmd === 'remove') {
    if (!args.id) { console.error('Missing --id'); process.exit(1); }
    feed.entries = feed.entries.filter((e) => e.id !== args.id);
    writeAndUpload(feed);
  } else {
    console.error(`Unknown command: ${args.cmd}`); process.exit(1);
  }
})();
