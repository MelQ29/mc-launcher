import type { RendererApi, LauncherConfig, BuildState, PerBuildConfig, BuildId } from '../api';

export interface SettingsModalEls {
  card: HTMLElement;
  buildName: HTMLElement;
  ramSlider: HTMLInputElement; ramInput: HTMLInputElement; ramRecHint: HTMLElement;
  useRecommendedBtn: HTMLButtonElement;
  installPathInput: HTMLInputElement; pickPathBtn: HTMLButtonElement;
  installInfoPath: HTMLElement; installInfoStats: HTMLElement; openInstallBtn: HTMLButtonElement;
  devModeToggle: HTMLInputElement;
  devPrompt: HTMLElement; devPasswordInput: HTMLInputElement;
  devSubmitBtn: HTMLButtonElement; devCancelBtn: HTMLButtonElement;
  devError: HTMLElement;
  devSection: HTMLElement;
  concInput: HTMLInputElement; retriesInput: HTMLInputElement; registryUrlInput: HTMLInputElement;
  requireSigToggle: HTMLInputElement; pubKeyInput: HTMLInputElement;
  devResetUiBtn: HTMLButtonElement; devResetLockBtn: HTMLButtonElement;
  settingsSavedHint: HTMLElement;
}

export class SettingsModal {
  private recommendedRam: number | undefined;

  constructor(
    private readonly api: RendererApi,
    private readonly els: SettingsModalEls,
  ) { this.attach(); }

  async show(state: BuildState, recommendedRamMb: number | undefined): Promise<void> {
    this.recommendedRam = recommendedRamMb;
    this.els.buildName.textContent = state.displayName;
    const cfg = await this.api.getConfig();
    const pb: PerBuildConfig = cfg.perBuild[state.id] ?? { ramMb: recommendedRamMb ?? 4096, installPath: null };
    this.els.ramInput.value = String(pb.ramMb);
    this.els.ramSlider.value = String(clamp(pb.ramMb, +this.els.ramSlider.min, +this.els.ramSlider.max));
    this.els.installPathInput.value = pb.installPath ?? '';
    this.refreshRamHint();

    this.els.devModeToggle.checked = cfg.developerMode === true;
    this.els.devSection.hidden = !cfg.developerMode;
    this.els.devPrompt.hidden = true;
    this.els.devError.hidden = true;
    this.els.concInput.value = String(cfg.downloadConcurrency);
    this.els.retriesInput.value = String(cfg.downloadRetries);
    this.els.registryUrlInput.value = cfg.buildsRegistryUrl;
    this.els.requireSigToggle.checked = cfg.requireValidSignature === true;
    this.els.pubKeyInput.value = cfg.signaturePublicKey ?? '';

    await this.refreshInstallInfo(state.id);
    (this.els.card.parentElement as HTMLElement).hidden = false;
  }

  private attach(): void {
    const save = debounce(() => this.saveAll(), 350);
    this.els.ramInput.addEventListener('input', () => {
      const v = clamp(+this.els.ramInput.value || 0, 512, 65536);
      if (v >= +this.els.ramSlider.min && v <= +this.els.ramSlider.max) this.els.ramSlider.value = String(v);
      this.refreshRamHint(); save();
    });
    this.els.ramSlider.addEventListener('input', () => {
      this.els.ramInput.value = this.els.ramSlider.value;
      this.refreshRamHint(); save();
    });
    this.els.installPathInput.addEventListener('change', save);
    this.els.useRecommendedBtn.addEventListener('click', () => {
      if (!this.recommendedRam) return;
      this.els.ramInput.value = String(this.recommendedRam);
      this.els.ramSlider.value = String(clamp(this.recommendedRam, +this.els.ramSlider.min, +this.els.ramSlider.max));
      this.refreshRamHint(); save();
    });
    this.els.pickPathBtn.addEventListener('click', async () => {
      const p = await this.api.pickInstallPath();
      if (p) { this.els.installPathInput.value = p; save(); }
    });

    this.els.devModeToggle.addEventListener('change', async () => {
      if (this.els.devModeToggle.checked) {
        // Need password
        this.els.devModeToggle.checked = false;  // not yet
        this.els.devPrompt.hidden = false;
        this.els.devPasswordInput.value = '';
        this.els.devError.hidden = true;
        this.els.devPasswordInput.focus();
      } else {
        // disable
        await this.api.saveConfig({ developerMode: false });
        this.els.devSection.hidden = true;
      }
    });
    this.els.devSubmitBtn.addEventListener('click', () => this.tryUnlockDev());
    this.els.devPasswordInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.tryUnlockDev();
    });
    this.els.devCancelBtn.addEventListener('click', () => {
      this.els.devPrompt.hidden = true;
      this.els.devModeToggle.checked = false;
    });

    this.els.concInput.addEventListener('change', save);
    this.els.retriesInput.addEventListener('change', save);
    this.els.registryUrlInput.addEventListener('change', save);
    this.els.requireSigToggle.addEventListener('change', save);
    this.els.pubKeyInput.addEventListener('change', save);

    this.els.devResetUiBtn.addEventListener('click', async () => {
      await this.api.devMode.resetUiCache();
      this.toast('UI-кеш сборки очищен');
    });
    this.els.devResetLockBtn.addEventListener('click', async () => {
      await this.api.devMode.resetManifestLock();
      this.toast('manifest.lock удалён — при следующем PLAY будет полный апдейт');
    });
  }

  private async tryUnlockDev(): Promise<void> {
    const ok = await this.api.devMode.unlock(this.els.devPasswordInput.value);
    if (ok) {
      this.els.devModeToggle.checked = true;
      this.els.devPrompt.hidden = true;
      this.els.devSection.hidden = false;
    } else {
      this.els.devError.hidden = false;
    }
  }

  private async refreshInstallInfo(id: BuildId): Promise<void> {
    try {
      const info = await this.api.getInstallInfo(id);
      this.els.installInfoPath.textContent = info.path + (info.isCustomPath ? '  (кастомный)' : '');
      if (!info.exists) {
        this.els.installInfoStats.textContent = 'Папка ещё не создана — будет создана при первой установке';
        return;
      }
      const total = Object.values(info.counts).reduce((s, n) => s + n, 0);
      const sizeText = info.totalBytes > 0 ? `, ${fmtBytes(info.totalBytes)}` : '';
      const parts: string[] = [];
      for (const [k, v] of Object.entries(info.counts)) parts.push(`${k}: ${v}`);
      this.els.installInfoStats.textContent = `${total} файлов${sizeText} • ${parts.join(' • ')}`;
    } catch (err) {
      this.els.installInfoStats.textContent = `недоступно: ${(err as Error).message}`;
    }
  }

  private refreshRamHint(): void {
    if (this.recommendedRam && this.recommendedRam > 0) {
      this.els.ramRecHint.textContent = `Рекомендуется: ${this.recommendedRam} MB`;
      const cur = +this.els.ramInput.value;
      this.els.useRecommendedBtn.hidden = cur >= this.recommendedRam;
    } else {
      this.els.ramRecHint.textContent = 'Рекомендуемое значение не задано в манифесте';
      this.els.useRecommendedBtn.hidden = true;
    }
  }

  private async saveAll(): Promise<void> {
    const cfg = await this.api.getConfig();
    const id = cfg.activeBuildId;

    // installPath confirmation — if changing path of an already-installed build
    const existingPath = cfg.perBuild[id]?.installPath ?? null;
    const newPath = this.els.installPathInput.value.trim() || null;
    if (existingPath !== newPath) {
      const info = await this.api.getInstallInfo(id);
      if (info.exists && info.totalBytes > 0) {
        const ok = window.confirm(
          `Сборка ${id} уже установлена в ${info.path} (${fmtBytes(info.totalBytes)}). ` +
          `Лаунчер сменит путь, но физически не переместит файлы. Продолжить?`
        );
        if (!ok) {
          this.els.installPathInput.value = existingPath ?? '';
          return;
        }
      }
    }

    const pb: Partial<PerBuildConfig> = {
      ramMb: clamp(+this.els.ramInput.value || 4096, 512, 65536),
      installPath: newPath,
    };
    await this.api.saveBuildConfig(id, pb);
    const patch: Partial<LauncherConfig> = {
      downloadConcurrency: clamp(+this.els.concInput.value || 4, 1, 16),
      downloadRetries: clamp(+this.els.retriesInput.value || 5, 0, 20),
      buildsRegistryUrl: this.els.registryUrlInput.value.trim(),
      requireValidSignature: this.els.requireSigToggle.checked,
      signaturePublicKey: this.els.pubKeyInput.value.trim() || undefined,
    };
    await this.api.saveConfig(patch);
    this.toast('Сохранено ✓');

    // installPath might have changed — force a registry refresh so the
    // main process re-validates installedVersion (sentinel file check)
    // and the renderer's PLAY label switches to "Скачать и запустить"
    // if the new folder is empty.
    if (existingPath !== newPath) {
      await this.api.refreshBuilds().catch(() => { /* ignore */ });
      await this.refreshInstallInfo(id);
    }
  }

  private toast(msg: string): void {
    this.els.settingsSavedHint.textContent = msg;
  }
}

function clamp(n: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, n)); }

function debounce<T extends (...a: unknown[]) => void>(fn: T, ms: number): T {
  let t: ReturnType<typeof setTimeout> | null = null;
  return ((...args: unknown[]) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => { (fn as (...a: unknown[]) => void)(...args); }, ms);
  }) as T;
}

function fmtBytes(n: number): string {
  const u = ['B','KiB','MiB','GiB']; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${u[i]}`;
}
