import type { UpdateState } from '../api';

const STAGE_LABEL: Record<string, string> = {
  'check': 'Проверка обновлений…',
  'download-archive': 'Скачиваю архив сборки',
  'extract': 'Распаковка архива…',
  'verify': 'Проверка целостности…',
  'download-ui': 'Загрузка UI…',
  'cleanup': 'Очистка…',
  'launching': 'Запуск…',
};

export interface ProgressEls {
  block: HTMLElement;
  status: HTMLElement;
  fill: HTMLElement;
  text: HTMLElement;
  speed: HTMLElement;
}

export function applyProgress(els: ProgressEls, state: UpdateState | undefined): void {
  if (!state || state.stage === 'idle' || state.stage === 'ready') {
    els.block.hidden = true;
    return;
  }
  els.block.hidden = false;
  els.status.textContent = state.stage === 'error'
    ? (state.error ?? state.message)
    : (STAGE_LABEL[state.stage] ?? state.message);

  const p = state.progress;
  if (p && (p.totalBytes > 0 || p.filesTotal > 0)) {
    let pct = 0; const parts: string[] = [];
    if (p.totalBytes > 0) {
      pct = Math.min(100, (p.downloadedBytes / p.totalBytes) * 100);
      parts.push(`${fmt(p.downloadedBytes)} / ${fmt(p.totalBytes)}`);
    } else if (p.filesTotal > 0) {
      pct = (p.filesDone / p.filesTotal) * 100;
      parts.push(`${p.filesDone} / ${p.filesTotal} файлов`);
    }
    parts.push(`${pct.toFixed(1)}%`);
    els.fill.style.width = `${pct}%`;
    els.text.textContent = parts.join('  •  ');
    els.speed.textContent = p.speed && p.speed > 0
      ? `${fmt(p.speed)}/s${eta(p.totalBytes - p.downloadedBytes, p.speed)}`
      : '';
  } else {
    els.fill.style.width = '0%';
    els.text.textContent = '';
    els.speed.textContent = '';
  }
}

function eta(rem: number, speed: number): string {
  if (!Number.isFinite(rem) || rem <= 0 || speed <= 0) return '';
  const s = rem / speed;
  return `  •  ETA ${Math.floor(s / 60)}m ${Math.floor(s % 60).toString().padStart(2, '0')}s`;
}

function fmt(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const u = ['B','KiB','MiB','GiB']; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${u[i]}`;
}
