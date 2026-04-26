import type { LauncherConfig, UpdateState, LogEntry, RendererApi } from './api';

declare global {
  interface Window { eclipseApi: RendererApi; }
}

const api = window.eclipseApi;

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const els = {
  background: $('frameBackground'),
  banner: $('frameBanner'),
  bannerLogo: $('bannerLogo') as HTMLImageElement,

  buildVersion: $('buildVersion'),
  installedVersion: $('installedVersion'),

  progressWrap: $('progressWrap'),
  progressFill: $('progressFill'),
  progressText: $('progressText'),
  progressSpeed: $('progressSpeed'),
  statusLine: $('statusLine'),

  launchBtn: $('launchBtn') as HTMLButtonElement,
  launchBtnImg: $('launchBtnImg') as HTMLImageElement,
  launchBtnText: $('launchBtnText'),

  // Tools
  settingsBtn: $('settingsBtn') as HTMLButtonElement,
  logsBtn: $('logsBtn') as HTMLButtonElement,

  // Settings modal
  settingsModal: $('settingsModal'),
  ramSlider: $('ramSlider') as HTMLInputElement,
  ramInput: $('ramInput') as HTMLInputElement,
  ramRecHint: $('ramRecHint'),
  useRecommendedBtn: $('useRecommendedBtn') as HTMLButtonElement,
  installPathInput: $('installPathInput') as HTMLInputElement,
  buildUrlInput: $('buildUrlInput') as HTMLInputElement,
  uiUrlInput: $('uiUrlInput') as HTMLInputElement,
  pickPathBtn: $('pickPathBtn') as HTMLButtonElement,
  settingsSavedHint: $('settingsSavedHint'),

  // Logs modal
  logsModal: $('logsModal'),
  logView: $('logView'),
  logFilter: $('logFilter') as HTMLSelectElement,
  clearLogsBtn: $('clearLogsBtn') as HTMLButtonElement,
};

let busy = false;
let updateNeeded = false;
let recommendedRamMb: number | undefined;

function setLaunchEnabled(enabled: boolean, label?: string): void {
  els.launchBtn.disabled = !enabled;
  if (label) els.launchBtnText.textContent = label;
}

function setStatus(text: string): void {
  els.statusLine.textContent = text;
}

function appendLog(entry: LogEntry): void {
  const line = document.createElement('span');
  line.className = `l-${entry.level}`;
  line.textContent = `[${entry.ts.slice(11, 19)}] [${entry.scope}] ${entry.message}\n`;
  els.logView.appendChild(line);
  while (els.logView.childNodes.length > 1500) els.logView.firstChild?.remove();
  els.logView.scrollTop = els.logView.scrollHeight;
}

async function loadConfigIntoUi(): Promise<LauncherConfig> {
  const cfg = await api.getConfig();
  els.ramInput.value = String(cfg.ramMb);
  els.ramSlider.value = String(Math.min(Number(els.ramSlider.max), Math.max(Number(els.ramSlider.min), cfg.ramMb)));
  els.installPathInput.value = cfg.installPath ?? '';
  els.buildUrlInput.value = cfg.buildManifestUrl;
  els.uiUrlInput.value = cfg.uiManifestUrl;
  document.title = `${cfg.name} Launcher`;
  return cfg;
}

async function loadAssets(): Promise<void> {
  const [logoUrl, bgUrl, btnUrl] = await Promise.all([
    api.resolveAssetUrl('logo.png'),
    api.resolveAssetUrl('background.png'),
    api.resolveAssetUrl('play_button.png'),
  ]);
  els.background.style.backgroundImage = `url("${bgUrl}")`;
  els.launchBtnImg.src = btnUrl;
  // Banner is optional. Probe the logo: if it's the 1×1 fallback (no real
  // logo bundled or fetched), collapse the row entirely.
  const probe = new Image();
  probe.onload = () => {
    if (probe.naturalHeight < 8) document.body.classList.add('no-banner');
    else els.bannerLogo.src = logoUrl;
  };
  probe.onerror = () => document.body.classList.add('no-banner');
  probe.src = logoUrl;
}

function applyState(state: UpdateState): void {
  setStatus(state.message);
  if (state.progress && (state.progress.totalBytes > 0 || state.progress.filesTotal > 0)) {
    els.progressWrap.hidden = false;
    const { totalBytes, downloadedBytes, speed, filesDone, filesTotal } = state.progress;
    let pct = 0;
    let textParts: string[] = [];
    if (totalBytes > 0) {
      pct = Math.min(100, (downloadedBytes / totalBytes) * 100);
      textParts.push(`${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`);
    } else if (filesTotal > 0) {
      pct = (filesDone / filesTotal) * 100;
      textParts.push(`${filesDone} / ${filesTotal} файлов`);
    }
    textParts.push(`${pct.toFixed(1)}%`);
    els.progressFill.style.width = `${pct}%`;
    els.progressText.textContent = textParts.join('  •  ');
    els.progressSpeed.textContent = speed && speed > 0
      ? `${formatBytes(speed)}/s${etaText(totalBytes - downloadedBytes, speed)}`
      : '';
  } else {
    els.progressWrap.hidden = true;
  }
  if (state.stage === 'error') {
    setStatus(state.error ?? state.message);
    setLaunchEnabled(false, 'Ошибка');
  }
  if (state.stage === 'ready' && !busy) setLaunchEnabled(true, 'Запуск');
}

function etaText(remainingBytes: number, speed: number): string {
  if (!Number.isFinite(remainingBytes) || remainingBytes <= 0 || speed <= 0) return '';
  const secs = remainingBytes / speed;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `  •  ETA ${m}m ${s.toString().padStart(2, '0')}s`;
}

async function refreshVersionInfo(): Promise<void> {
  const installed = await api.getInstalledVersion();
  els.installedVersion.textContent = installed ?? 'не установлено';
  try {
    const result = await api.checkForUpdates();
    if (result.error) {
      els.buildVersion.textContent = 'недоступно';
      if (installed) setLaunchEnabled(true, 'Запуск (оффлайн)');
      else setLaunchEnabled(false, 'Манифест недоступен');
      return;
    }
    els.buildVersion.textContent = result.buildVersion;
    updateNeeded = result.needsUpdate;
    recommendedRamMb = result.recommendedRamMb;
    refreshRecommendedRamHint();
    if (result.needsUpdate) setLaunchEnabled(true, 'Обновить и запустить');
    else setLaunchEnabled(true, 'Запуск');
  } catch (err) {
    els.buildVersion.textContent = 'недоступно';
    if (installed) setLaunchEnabled(true, 'Запуск (оффлайн)');
    else setLaunchEnabled(false, 'Нет соединения');
  }
}

function refreshRecommendedRamHint(): void {
  if (recommendedRamMb && recommendedRamMb > 0) {
    els.ramRecHint.textContent = `Рекомендуется: ${recommendedRamMb} MB`;
    const current = Number(els.ramInput.value);
    els.useRecommendedBtn.hidden = current >= recommendedRamMb;
  } else {
    els.ramRecHint.textContent = 'Рекомендуемое значение не задано в манифесте';
    els.useRecommendedBtn.hidden = true;
  }
}

async function handleLaunch(): Promise<void> {
  if (busy) return;
  busy = true;
  setLaunchEnabled(false, 'Работаю...');
  try {
    if (updateNeeded || !(await api.getInstalledVersion())) {
      await api.runUpdate();
      updateNeeded = false;
    }
    const result = await api.launchGame();
    if (result.ok) {
      // The official Minecraft Launcher detaches immediately, so we can't
      // observe its lifecycle. Flash "Запущено" briefly and then re-enable
      // the button so the user can launch again (e.g. after closing MC).
      setLaunchEnabled(false, 'Запущено');
      window.setTimeout(() => {
        if (!busy) setLaunchEnabled(true, updateNeeded ? 'Обновить и запустить' : 'Запуск');
      }, 2500);
    } else {
      setLaunchEnabled(true, 'Открой Minecraft Launcher вручную');
    }
  } catch (err) {
    setLaunchEnabled(true, 'Повторить');
    appendLog({ ts: new Date().toISOString(), level: 'error', scope: 'ui', message: (err as Error).message });
  } finally {
    busy = false;
  }
}

/* ─────────── Settings auto-save ─────────── */

let saveTimer: number | null = null;
function scheduleSave(): void {
  if (saveTimer != null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { void handleSaveSettings(); }, 350);
  els.settingsSavedHint.textContent = 'Сохраняю...';
}

async function handleSaveSettings(): Promise<void> {
  const ram = clamp(Number(els.ramInput.value) || 4096, 512, 65536);
  const patch: Partial<LauncherConfig> = {
    ramMb: ram,
    installPath: els.installPathInput.value.trim() || null,
    buildManifestUrl: els.buildUrlInput.value.trim(),
    uiManifestUrl: els.uiUrlInput.value.trim(),
  };
  await api.saveConfig(patch);
  els.settingsSavedHint.textContent = 'Сохранено ✓';
  // Reflect any normalisation back into the inputs.
  els.ramInput.value = String(ram);
  els.ramSlider.value = String(Math.min(Number(els.ramSlider.max), Math.max(Number(els.ramSlider.min), ram)));
  refreshRecommendedRamHint();
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/* ─────────── Modals ─────────── */

function openModal(id: string): void {
  const m = document.getElementById(id);
  if (m) m.hidden = false;
}
function closeModal(id: string): void {
  const m = document.getElementById(id);
  if (m) m.hidden = true;
}

/* ─────────── Boot ─────────── */

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let u = 0;
  let v = n;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[u]}`;
}

async function bootstrap(): Promise<void> {
  api.onLog(appendLog);
  api.onUpdateState(applyState);

  els.launchBtn.addEventListener('click', () => { void handleLaunch(); });

  // Tool buttons
  els.settingsBtn.addEventListener('click', () => openModal('settingsModal'));
  els.logsBtn.addEventListener('click', () => openModal('logsModal'));
  document.querySelectorAll('[data-close]').forEach((el) => {
    el.addEventListener('click', () => closeModal((el as HTMLElement).dataset.close!));
  });
  // ESC closes any open modal.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      els.settingsModal.hidden = true;
      els.logsModal.hidden = true;
    }
  });

  // Settings: keep slider/input in sync, autosave on change.
  els.ramInput.addEventListener('input', () => {
    const v = clamp(Number(els.ramInput.value) || 0, 512, 65536);
    if (v >= Number(els.ramSlider.min) && v <= Number(els.ramSlider.max)) {
      els.ramSlider.value = String(v);
    }
    refreshRecommendedRamHint();
    scheduleSave();
  });
  els.ramSlider.addEventListener('input', () => {
    els.ramInput.value = els.ramSlider.value;
    refreshRecommendedRamHint();
    scheduleSave();
  });
  els.installPathInput.addEventListener('change', scheduleSave);
  els.buildUrlInput.addEventListener('change', scheduleSave);
  els.uiUrlInput.addEventListener('change', scheduleSave);
  els.useRecommendedBtn.addEventListener('click', () => {
    if (!recommendedRamMb) return;
    els.ramInput.value = String(recommendedRamMb);
    els.ramSlider.value = String(Math.min(Number(els.ramSlider.max), Math.max(Number(els.ramSlider.min), recommendedRamMb)));
    refreshRecommendedRamHint();
    scheduleSave();
  });
  els.pickPathBtn.addEventListener('click', async () => {
    const picked = await api.pickInstallPath();
    if (picked) {
      els.installPathInput.value = picked;
      scheduleSave();
    }
  });

  // Logs filter + clear
  els.logFilter.addEventListener('change', () => {
    const f = els.logFilter.value;
    els.logView.className = f === 'all' ? '' : `f-${f}`;
  });
  els.clearLogsBtn.addEventListener('click', () => { els.logView.innerHTML = ''; });

  await loadConfigIntoUi();
  await loadAssets();
  await refreshVersionInfo();
}

bootstrap().catch((err) => {
  appendLog({ ts: new Date().toISOString(), level: 'error', scope: 'ui-bootstrap', message: String(err) });
});
