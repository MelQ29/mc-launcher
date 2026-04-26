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
  bannerLogo: $('bannerLogo') as HTMLImageElement,
  banner: $('frameBanner'),
  background: $('frameBackground'),
  installedVersion: $('installedVersion'),
  buildVersion: $('buildVersion'),
  updateState: $('updateState'),
  progressBar: $('progressBar') as HTMLProgressElement,
  progressText: $('progressText'),
  progressSpeed: $('progressSpeed'),
  ramInput: $('ramInput') as HTMLInputElement,
  installPathInput: $('installPathInput') as HTMLInputElement,
  buildUrlInput: $('buildUrlInput') as HTMLInputElement,
  uiUrlInput: $('uiUrlInput') as HTMLInputElement,
  pickPathBtn: $('pickPathBtn') as HTMLButtonElement,
  saveSettingsBtn: $('saveSettingsBtn') as HTMLButtonElement,
  launchBtn: $('launchBtn') as HTMLButtonElement,
  launchBtnImg: $('launchBtnImg') as HTMLImageElement,
  launchBtnText: $('launchBtnText'),
  logView: $('logView'),
};

let busy = false;
let updateNeeded = false;

function setLaunchEnabled(enabled: boolean, label?: string): void {
  els.launchBtn.disabled = !enabled;
  if (label) els.launchBtnText.textContent = label;
}

function appendLog(entry: LogEntry): void {
  const line = document.createElement('span');
  line.className = `l-${entry.level}`;
  line.textContent = `[${entry.ts.slice(11, 19)}] [${entry.scope}] ${entry.message}\n`;
  els.logView.appendChild(line);
  // Cap log buffer to keep DOM lean.
  while (els.logView.childNodes.length > 1000) els.logView.firstChild?.remove();
  els.logView.scrollTop = els.logView.scrollHeight;
}

async function loadConfigIntoUi(): Promise<LauncherConfig> {
  const cfg = await api.getConfig();
  els.ramInput.value = String(cfg.ramMb);
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
  // Banner logo is optional. The bundled fallback Iss_logo.png is a 1×1
  // placeholder — once it loads, we can detect that and collapse the banner
  // row. If the user later ships a real logo via ui_manifest.json, the
  // `naturalHeight` check will be > 8 and the banner stays visible.
  const probe = new Image();
  probe.onload = () => {
    if (probe.naturalHeight < 8) document.body.classList.add('no-banner');
    else els.bannerLogo.src = logoUrl;
  };
  probe.onerror = () => document.body.classList.add('no-banner');
  probe.src = logoUrl;
}

function applyState(state: UpdateState): void {
  els.updateState.textContent = state.message;
  if (state.progress) {
    const { totalBytes, downloadedBytes, speed } = state.progress;
    const pct = totalBytes > 0 ? Math.min(100, (downloadedBytes / totalBytes) * 100) : 0;
    els.progressBar.value = pct;
    els.progressText.textContent = `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)} (${pct.toFixed(1)}%)`;
    els.progressSpeed.textContent = speed ? `${formatBytes(speed)}/s` : '';
  } else {
    els.progressBar.value = 0;
    els.progressText.textContent = state.message;
    els.progressSpeed.textContent = '';
  }
  if (state.stage === 'error') {
    els.progressText.textContent = state.error ?? state.message;
    setLaunchEnabled(false, 'Ошибка');
  }
  if (state.stage === 'ready' && !busy) setLaunchEnabled(true, 'Запуск');
}

async function refreshVersionInfo(): Promise<void> {
  const installed = await api.getInstalledVersion();
  els.installedVersion.textContent = installed ?? 'не установлено';
  try {
    const result = await api.checkForUpdates();
    if (result.error) {
      els.buildVersion.textContent = `недоступно (${result.error.split(':')[0]})`;
      if (installed) setLaunchEnabled(true, 'Запуск (оффлайн)');
      else setLaunchEnabled(false, 'Манифест недоступен');
      return;
    }
    els.buildVersion.textContent = result.buildVersion;
    updateNeeded = result.needsUpdate;
    if (result.needsUpdate) setLaunchEnabled(true, 'Обновить и запустить');
    else setLaunchEnabled(true, 'Запуск');
  } catch (err) {
    els.buildVersion.textContent = `недоступно: ${(err as Error).message}`;
    if (installed) setLaunchEnabled(true, 'Запуск (оффлайн)');
    else setLaunchEnabled(false, 'Нет соединения');
  }
}

async function handleLaunch(): Promise<void> {
  if (busy) return;
  busy = true;
  setLaunchEnabled(false, 'Работа...');
  try {
    if (updateNeeded || !(await api.getInstalledVersion())) {
      await api.runUpdate();
      updateNeeded = false;
    }
    const result = await api.launchGame();
    if (result.ok) setLaunchEnabled(false, 'Запущено');
    else setLaunchEnabled(true, 'Открой Minecraft Launcher вручную');
  } catch (err) {
    setLaunchEnabled(true, 'Повторить');
    appendLog({ ts: new Date().toISOString(), level: 'error', scope: 'ui', message: (err as Error).message });
  } finally {
    busy = false;
  }
}

async function handleSaveSettings(): Promise<void> {
  const patch: Partial<LauncherConfig> = {
    ramMb: Number(els.ramInput.value) || 4096,
    installPath: els.installPathInput.value.trim() || null,
    buildManifestUrl: els.buildUrlInput.value.trim(),
    uiManifestUrl: els.uiUrlInput.value.trim(),
  };
  await api.saveConfig(patch);
  await refreshVersionInfo();
}

async function handlePickPath(): Promise<void> {
  const picked = await api.pickInstallPath();
  if (picked) els.installPathInput.value = picked;
}

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
  els.saveSettingsBtn.addEventListener('click', () => { void handleSaveSettings(); });
  els.pickPathBtn.addEventListener('click', () => { void handlePickPath(); });

  await loadConfigIntoUi();
  await loadAssets();
  await refreshVersionInfo();
}

bootstrap().catch((err) => {
  appendLog({ ts: new Date().toISOString(), level: 'error', scope: 'ui-bootstrap', message: String(err) });
});
