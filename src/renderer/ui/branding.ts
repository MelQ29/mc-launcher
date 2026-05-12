import type { BuildEntry, BuildState } from '../api';

export function applyAccent(color: string): void {
  document.documentElement.style.setProperty('--build-accent', color);
  document.documentElement.style.setProperty('--play-grad-end', shade(color, -20));
}

export async function applyVideoAndButton(
  entry: BuildEntry,
  state: BuildState,
  resolve: (id: string, name: string) => Promise<string>,
): Promise<void> {
  const video = document.getElementById('bgVideo') as HTMLVideoElement;
  const fallback = document.getElementById('bgFallback') as HTMLElement;
  const btnImg = document.getElementById('launchBtnImg') as HTMLImageElement;

  const videoName = state.branding?.video ?? 'background.mkv';
  const playName = state.branding?.playButton ?? 'play_button.png';

  const [videoUrl, playUrl] = await Promise.all([
    resolve(entry.id, videoName),
    resolve(entry.id, playName),
  ]);

  // Cache-bust ef-asset:// URLs so Chromium doesn't reuse a previously
  // cached 404 (the file may have just been downloaded by runUiSync).
  // The main-process protocol handler strips ?... before path resolution.
  const bust = `?t=${Date.now()}`;

  video.pause();
  video.src = videoUrl + bust;
  video.load();
  video.play().catch(() => { /* fallback gradient stays */ });
  // Hide gradient fallback while video plays; show on error.
  video.addEventListener('playing', () => { fallback.style.opacity = '0'; }, { once: true });
  video.addEventListener('error', () => { fallback.style.opacity = '1'; }, { once: true });

  btnImg.src = playUrl + bust;
}

function shade(hex: string, percent: number): string {
  const m = hex.replace('#', '');
  if (m.length !== 6) return hex;
  const num = parseInt(m, 16);
  let r = (num >> 16) & 0xff;
  let g = (num >> 8) & 0xff;
  let b = num & 0xff;
  const f = (c: number) => Math.max(0, Math.min(255, c + (percent * 255) / 100));
  r = f(r); g = f(g); b = f(b);
  return '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
}
