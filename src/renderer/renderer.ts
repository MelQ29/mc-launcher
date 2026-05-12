import type {
  RendererApi, LauncherConfig, UpdateState, LogEntry,
  BuildsRegistry, BuildEntry, BuildState, BuildId, NewsEntry,
  SelfUpdateState,
} from './api';
import { applyAccent, applyVideoAndButton } from './ui/branding';
import { renderTabs, setActiveTab } from './ui/tabs';
import { renderNews } from './ui/news-panel';
import { applyProgress, type ProgressEls } from './ui/progress';
import { SettingsModal } from './ui/settings-modal';

declare global { interface Window { eclipseApi: RendererApi; } }

const api = window.eclipseApi;
const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const els = {
  tabRow: $('tabRow'),
  versionChipValue: $('versionChipValue'),
  launchBtn: $('launchBtn') as HTMLButtonElement,
  launchBtnImg: $('launchBtnImg') as HTMLImageElement,
  launchSubLabel: $('launchSubLabel'),
  newsList: $('newsList'),
  versionInfo: $('versionInfo'),
  progressBlock: $('progressBlock'),
  progressStatus: $('progressStatus'),
  progressFill: $('progressFill'),
  progressText: $('progressText'),
  progressSpeed: $('progressSpeed'),
  selfUpdateBanner: $('selfUpdateBanner'),
  selfUpdateMsg: $('selfUpdateMsg'),
  selfUpdateBtn: $('selfUpdateBtn') as HTMLButtonElement,
  settingsBtn: $('settingsBtn'),
  logsBtn: $('logsBtn'),
  settingsModal: $('settingsModal'),
  logsModal: $('logsModal'),
  logView: $('logView'),
  logFilter: $('logFilter') as HTMLSelectElement,
  clearLogsBtn: $('clearLogsBtn'),
};

const progressEls: ProgressEls = {
  block: els.progressBlock, status: els.progressStatus,
  fill: els.progressFill, text: els.progressText, speed: els.progressSpeed,
};

const settingsModal = new SettingsModal(api, {
  card: $('settingsModal').querySelector('.modal-card') as HTMLElement,
  buildName: $('settingsBuildName'),
  ramSlider: $('ramSlider') as HTMLInputElement,
  ramInput: $('ramInput') as HTMLInputElement,
  ramRecHint: $('ramRecHint'),
  useRecommendedBtn: $('useRecommendedBtn') as HTMLButtonElement,
  installPathInput: $('installPathInput') as HTMLInputElement,
  pickPathBtn: $('pickPathBtn') as HTMLButtonElement,
  installInfoPath: $('installInfoPath'),
  installInfoStats: $('installInfoStats'),
  openInstallBtn: $('openInstallBtn') as HTMLButtonElement,
  devModeToggle: $('devModeToggle') as HTMLInputElement,
  devPrompt: $('devPrompt'),
  devPasswordInput: $('devPasswordInput') as HTMLInputElement,
  devSubmitBtn: $('devSubmitBtn') as HTMLButtonElement,
  devCancelBtn: $('devCancelBtn') as HTMLButtonElement,
  devError: $('devError'),
  devSection: $('devSection'),
  concInput: $('concInput') as HTMLInputElement,
  retriesInput: $('retriesInput') as HTMLInputElement,
  registryUrlInput: $('registryUrlInput') as HTMLInputElement,
  requireSigToggle: $('requireSigToggle') as HTMLInputElement,
  pubKeyInput: $('pubKeyInput') as HTMLInputElement,
  devResetUiBtn: $('devResetUiBtn') as HTMLButtonElement,
  devResetLockBtn: $('devResetLockBtn') as HTMLButtonElement,
  settingsSavedHint: $('settingsSavedHint'),
});

interface RuntimeState {
  registry: BuildsRegistry | null;
  states: Map<BuildId, BuildState>;
  newsByBuild: Map<BuildId, NewsEntry[]>;
  progressByBuild: Map<BuildId, UpdateState>;
  activeBuildId: BuildId | null;
  updateChecks: Map<BuildId, { recommendedRamMb?: number; needsUpdate: boolean; error?: string }>;
  busy: boolean;
}

const state: RuntimeState = {
  registry: null,
  states: new Map(),
  newsByBuild: new Map(),
  progressByBuild: new Map(),
  activeBuildId: null,
  updateChecks: new Map(),
  busy: false,
};

function activeEntry(): BuildEntry | null {
  if (!state.registry || !state.activeBuildId) return null;
  return state.registry.builds.find((b) => b.id === state.activeBuildId) ?? null;
}

function activeBuildState(): BuildState | null {
  return state.activeBuildId ? state.states.get(state.activeBuildId) ?? null : null;
}

function setBusy(v: boolean): void {
  state.busy = v;
  refreshLaunchButton();
}

function refreshLaunchButton(): void {
  const bs = activeBuildState();
  const check = state.activeBuildId ? state.updateChecks.get(state.activeBuildId) : undefined;
  if (!bs) { els.launchBtn.disabled = true; els.launchSubLabel.textContent = 'Загрузка…'; return; }
  if (state.busy) { els.launchBtn.disabled = true; els.launchSubLabel.textContent = 'Работаю…'; return; }
  if (check?.error) {
    if (bs.installed) { els.launchBtn.disabled = false; els.launchSubLabel.textContent = 'Запуск (оффлайн)'; }
    else { els.launchBtn.disabled = true; els.launchSubLabel.textContent = 'Нет соединения'; }
    return;
  }
  els.launchBtn.disabled = false;
  if (!bs.installed) els.launchSubLabel.textContent = 'Скачать и запустить';
  else if (check?.needsUpdate) els.launchSubLabel.textContent = 'Обновить и запустить';
  else els.launchSubLabel.textContent = 'Запуск';
}

async function selectBuild(id: BuildId): Promise<void> {
  if (state.busy) return;
  await api.setActiveBuild(id);
  state.activeBuildId = id;
  setActiveTab(els.tabRow, id);
  await renderActive();
  // Kick off async updates that don't block UI
  void api.fetchNews(id);
  void runUpdateCheck(id);
}

async function renderActive(): Promise<void> {
  const entry = activeEntry();
  const bs = activeBuildState();
  if (!entry || !bs) return;

  applyAccent(entry.accentColor);
  await applyVideoAndButton(entry, bs, api.resolveAssetUrl.bind(api));

  // Version chip
  els.versionChipValue.textContent = bs.installedVersion ?? '—';
  els.versionInfo.innerHTML = bs.installedVersion
    ? `v${escapeHtml(bs.installedVersion)} · Minecraft / Fabric`
    : 'не установлено';

  // News
  const news = state.newsByBuild.get(entry.id) ?? [];
  renderNews(els.newsList, news);

  // Progress
  applyProgress(progressEls, state.progressByBuild.get(entry.id));

  refreshLaunchButton();
}

async function runUpdateCheck(id: BuildId): Promise<void> {
  try {
    const r = await api.checkForUpdates(id);
    state.updateChecks.set(id, { recommendedRamMb: r.recommendedRamMb, needsUpdate: r.needsUpdate, error: r.error });
    if (state.activeBuildId === id) refreshLaunchButton();
  } catch (err) {
    state.updateChecks.set(id, { needsUpdate: false, error: (err as Error).message });
    if (state.activeBuildId === id) refreshLaunchButton();
  }
}

async function handleLaunch(): Promise<void> {
  if (state.busy) return;
  const id = state.activeBuildId; if (!id) return;
  setBusy(true);
  try {
    const check = state.updateChecks.get(id);
    const needs = check?.needsUpdate || !(await api.getInstalledVersion(id));
    if (needs) await api.runUpdate(id);
    const result = await api.launchGame(id);
    if (result.ok) {
      els.launchSubLabel.textContent = 'Запущено';
      setTimeout(() => { setBusy(false); refreshLaunchButton(); }, 2500);
    } else {
      els.launchSubLabel.textContent = 'Откройте Minecraft Launcher вручную';
      setBusy(false);
    }
    const installedVersion = (await api.getInstalledVersion(id)) ?? null;
    const prev = state.states.get(id);
    if (prev) {
      state.states.set(id, { ...prev, installed: installedVersion !== null, installedVersion });
    }
    if (check) state.updateChecks.set(id, { ...check, needsUpdate: false });
  } catch (err) {
    appendLog({ ts: new Date().toISOString(), level: 'error', scope: 'ui', message: (err as Error).message });
    els.launchSubLabel.textContent = 'Повторить';
    setBusy(false);
  }
}

function appendLog(entry: LogEntry): void {
  const span = document.createElement('span');
  span.className = `l-${entry.level}`;
  span.textContent = `[${entry.ts.slice(11, 19)}] [${entry.scope}] ${entry.message}\n`;
  els.logView.appendChild(span);
  while (els.logView.childNodes.length > 1500) els.logView.firstChild?.remove();
  els.logView.scrollTop = els.logView.scrollHeight;
}

function applySelfUpdate(s: SelfUpdateState): void {
  switch (s.status) {
    case 'idle': case 'checking': case 'not-available':
      els.selfUpdateBanner.hidden = true; break;
    case 'available':
      els.selfUpdateBanner.hidden = false;
      els.selfUpdateMsg.textContent = `Найдено обновление лаунчера v${s.version} — скачиваю…`;
      els.selfUpdateBtn.hidden = true; break;
    case 'downloading':
      els.selfUpdateBanner.hidden = false;
      els.selfUpdateMsg.textContent = `Скачиваю обновление лаунчера: ${(s.percent ?? 0).toFixed(0)}%`;
      els.selfUpdateBtn.hidden = true; break;
    case 'ready':
      els.selfUpdateBanner.hidden = false;
      els.selfUpdateMsg.textContent = `Готово к установке: лаунчер v${s.version}`;
      els.selfUpdateBtn.hidden = false; break;
    case 'error':
      els.selfUpdateBanner.hidden = true;
      appendLog({ ts: new Date().toISOString(), level: 'warn', scope: 'self-update', message: s.error ?? 'unknown error' });
      break;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]!);
}

async function bootstrap(): Promise<void> {
  // Subscriptions
  api.onLog(appendLog);
  api.onSelfUpdate(applySelfUpdate);
  api.onUpdateState((s) => {
    state.progressByBuild.set(s.buildId, s);
    if (state.activeBuildId === s.buildId) applyProgress(progressEls, s);
    if (s.stage === 'ready' && state.activeBuildId === s.buildId) {
      void runUpdateCheck(s.buildId);
    }
  });
  api.onNewsUpdated((m) => {
    state.newsByBuild.set(m.buildId, m.entries);
    if (m.buildId === state.activeBuildId) renderNews(els.newsList, m.entries);
  });
  api.onRegistryChanged(async (reg) => { await onRegistry(reg); });
  api.onActiveChanged(({ id }) => {
    state.activeBuildId = id;
    setActiveTab(els.tabRow, id);
    void renderActive();
  });

  els.launchBtn.addEventListener('click', () => { void handleLaunch(); });
  els.settingsBtn.addEventListener('click', async () => {
    const bs = activeBuildState(); if (!bs) return;
    const check = state.activeBuildId ? state.updateChecks.get(state.activeBuildId) : undefined;
    await settingsModal.show(bs, check?.recommendedRamMb);
  });
  els.logsBtn.addEventListener('click', () => { els.logsModal.hidden = false; });
  document.querySelectorAll('[data-close]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = (el as HTMLElement).dataset.close!;
      const m = document.getElementById(id); if (m) m.hidden = true;
    });
  });
  els.selfUpdateBtn.addEventListener('click', () => { void api.selfUpdate.install(); });
  els.logFilter.addEventListener('change', () => {
    const f = els.logFilter.value;
    els.logView.className = f === 'all' ? '' : `f-${f}`;
  });
  els.clearLogsBtn.addEventListener('click', () => { els.logView.innerHTML = ''; });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { els.settingsModal.hidden = true; els.logsModal.hidden = true; }
  });

  // Initial fetch
  const list = await api.listBuilds();
  state.registry = list.registry;
  state.activeBuildId = list.activeBuildId;
  for (const s of list.states) state.states.set(s.id, s);
  await onRegistry(list.registry);

  // Async news + update checks for all builds (so subsequent tab clicks are warm)
  for (const e of list.registry.builds) {
    void api.fetchNews(e.id);
    void runUpdateCheck(e.id);
  }
}

async function onRegistry(reg: BuildsRegistry): Promise<void> {
  if (!state.activeBuildId) state.activeBuildId = reg.defaultBuildId;
  renderTabs(els.tabRow, reg.builds, state.activeBuildId, {
    onSelect: (id) => { void selectBuild(id); },
    isBusy: () => state.busy,
  });
  await renderActive();
}

bootstrap().catch((err) => {
  appendLog({ ts: new Date().toISOString(), level: 'error', scope: 'ui-bootstrap', message: String(err) });
});
