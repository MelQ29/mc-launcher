// Copies renderer non-TS assets (HTML, CSS) into dist/renderer so the packaged
// app can load them as static files. Run automatically as part of build:renderer.
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'src', 'renderer');
const DEST = path.resolve(__dirname, '..', 'dist', 'renderer');

const ASSET_EXTS = new Set(['.html', '.css', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.ico']);

function walk(dir, base) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(SRC, full);
    if (entry.isDirectory()) {
      walk(full, base);
      continue;
    }
    if (!ASSET_EXTS.has(path.extname(entry.name).toLowerCase())) continue;
    const out = path.join(DEST, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(full, out);
  }
}

if (!fs.existsSync(SRC)) {
  console.error('renderer src missing:', SRC);
  process.exit(1);
}
fs.mkdirSync(DEST, { recursive: true });
walk(SRC, SRC);
console.log('Renderer assets copied ->', DEST);
