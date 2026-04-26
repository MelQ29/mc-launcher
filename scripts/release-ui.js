#!/usr/bin/env node
/**
 * Publish a UI release: hash local Iss_*.png assets, upload them to the VPS,
 * regenerate ui_manifest.json with new hashes + bumped version, and push the
 * manifest to the latest GitHub release.
 *
 * Pre-requisites:
 *   - SSH alias `eclipse-vps` configured in ~/.ssh/config
 *   - `gh` CLI authenticated against the repo
 *   - python + paramiko available (used by sftp-upload.py)
 *
 * Usage:
 *   node scripts/release-ui.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ASSETS = [
  // localPath, manifestPath, vpsPath
  { local: 'assets/Iss_background.png',  out: 'background.png',  vps: '/var/www/eclipsefantasy/ui/background.png'  },
  { local: 'assets/Iss_play_button.png', out: 'play_button.png', vps: '/var/www/eclipsefantasy/ui/play_button.png' },
];

const ARCHIVE_BASE_URL = 'http://141.98.189.63/ui';
const REPO = 'MelQ29/mc-launcher';
const RELEASE_TAG = 'v1.0.5';

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function bumpVersion(prev) {
  // Encode as YYYY.MM.DD-N so consecutive same-day releases bump the suffix.
  const today = new Date().toISOString().slice(0, 10);
  const m = (prev || '').match(/^(\d{4}-\d{2}-\d{2})-(\d+)$/);
  if (m && m[1] === today) return `${today}-${parseInt(m[2], 10) + 1}`;
  return `${today}-1`;
}

function run(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false, ...opts });
  if (r.status !== 0) {
    console.error(`Command failed (exit ${r.status})`);
    process.exit(r.status || 1);
  }
}

function main() {
  for (const a of ASSETS) {
    if (!fs.existsSync(a.local)) {
      console.error(`Missing local asset: ${a.local}`);
      process.exit(1);
    }
  }

  // Read previous manifest if present, to bump the version sensibly.
  let previous = {};
  if (fs.existsSync('ui_manifest.json')) {
    previous = JSON.parse(fs.readFileSync('ui_manifest.json', 'utf8'));
  }
  const newVersion = bumpVersion(previous.version);
  console.log(`UI manifest version ${previous.version || '(new)'} -> ${newVersion}`);

  // Upload each asset to the VPS via the existing sftp-upload helper.
  for (const a of ASSETS) {
    run('python', ['-u', 'scripts/sftp-upload.py', 'eclipse-vps', a.local, a.vps], {
      env: { ...process.env, MSYS_NO_PATHCONV: '1' },
    });
  }

  // Build new manifest.
  const manifest = {
    version: newVersion,
    files: ASSETS.map((a) => ({
      path: a.out,
      url: `${ARCHIVE_BASE_URL}/${a.out}`,
      sha256: sha256(a.local),
      size: fs.statSync(a.local).size,
    })),
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync('ui_manifest.json', JSON.stringify(manifest, null, 2));
  console.log('Wrote ui_manifest.json');

  // Sync the manifest itself to the VPS so the launcher (which now reads
  // manifests from there, not from GitHub) sees the new version.
  run('python', ['-u', 'scripts/sftp-upload.py', 'eclipse-vps', 'ui_manifest.json', '/var/www/eclipsefantasy/ui_manifest.json'], {
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  });
  if (fs.existsSync('build_manifest.json')) {
    run('python', ['-u', 'scripts/sftp-upload.py', 'eclipse-vps', 'build_manifest.json', '/var/www/eclipsefantasy/build_manifest.json'], {
      env: { ...process.env, MSYS_NO_PATHCONV: '1' },
    });
  }

  // Mirror to the GitHub launcher release as a backup so users with old
  // configs (pre-VPS-manifests) still get something. Best-effort.
  try {
    run('gh', ['release', 'upload', RELEASE_TAG, 'ui_manifest.json', '--clobber', '--repo', REPO]);
  } catch (e) {
    console.warn('GH release upload failed (non-fatal):', e.message);
  }

  console.log('\n✓ UI release published.');
  console.log('  Restart the launcher — it will see the new uiVersion and re-download assets.');
}

main();
