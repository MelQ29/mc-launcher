# Fallback assets

These files are bundled with the launcher and used when the remote UI manifest
is unreachable. The protocol handler in `src/main/main.ts` resolves
`ef-asset://<name>` to:

1. `<userData>/ui/<name>` — populated from `ui_manifest.json`
2. `<bundledAssets>/Iss_<name>` — fallback shipped here
3. `<bundledAssets>/<name>` — last resort

Currently shipped:

- `Iss_logo.png` — 1×1 transparent placeholder. Replace with the actual server
  logo (recommended ~512×128 PNG, transparent background).
- `Iss_background.png` — 1×1 transparent placeholder. Replace with the actual
  background image (recommended ≥1280×720 PNG/JPG).

Replacing these files does not require rebuilding the launcher in development —
they're read from `extraResources/assets` at runtime in packaged builds, and
straight from this directory during `npm run dev`.
