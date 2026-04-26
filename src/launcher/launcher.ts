import { promises as fs } from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { logger } from '../core/logger';
import { Paths } from '../core/paths';
import { fetchText } from '../downloader/downloader';
import type { LauncherConfig } from '../core/types';

/**
 * Hands off launch to the official Minecraft Launcher by registering a
 * profile in launcher_profiles.json. This avoids embedding Microsoft OAuth
 * and complies with Mojang's auth flow — the user's existing session in the
 * official launcher is reused.
 *
 * Flow:
 *   1. Locate .minecraft directory.
 *   2. Read (or create) launcher_profiles.json.
 *   3. Insert/update an "EclipseFantasy" profile pointing at our instance,
 *      with lastVersionId = "fabric-loader-<loader>-<minecraft>".
 *   4. Spawn the Minecraft Launcher executable if we can find it; otherwise
 *      tell the renderer to ask the user to open it manually.
 *
 * The user must have run the official launcher at least once and installed
 * Fabric for the target version (the launcher does not bundle a JRE or
 * download Minecraft assets — those remain the official launcher's job).
 */
export class GameLauncher {
  private readonly profileId = 'eclipsefantasy';

  constructor(private readonly paths: Paths) {}

  async launch(config: LauncherConfig, instancePath: string, minecraft: string, fabricLoader: string): Promise<{ ok: boolean; profileId: string }> {
    const dotMc = Paths.defaultDotMinecraft();
    // The official launcher needs three things to start the modpack:
    //   1. our profile in launcher_profiles.json (gameDir, lastVersionId, args)
    //   2. the fabric-loader-X.Y.Z-MCVER version JSON in versions/<id>/<id>.json
    //      so the launcher's "version manifest" recognises lastVersionId
    //   3. vanilla MCVER (downloaded automatically once #2 is in place,
    //      because the fabric JSON has inheritsFrom: "<MCVER>")
    // Without (2) the launcher fails with REQUEST_FAILED / Unable to prepare
    // assets — that's exactly the bug that hit testers on a fresh PC.
    await this.ensureFabricVersion(dotMc, minecraft, fabricLoader);
    await this.writeProfile(dotMc, instancePath, config, minecraft, fabricLoader);

    // Try, in order: a known .exe path → minecraft:// URI handler → UWP shell
    // appsFolder route. The first one that doesn't throw wins. Each method
    // works on a different launcher edition (standalone / Xbox / MS Store).
    const exe = await this.findOfficialLauncher();
    if (exe) {
      logger.info('launcher', `Spawning official launcher: ${exe}`);
      try {
        const child = spawn(exe, [], { detached: true, stdio: 'ignore' });
        child.unref();
        return { ok: true, profileId: this.profileId };
      } catch (err) {
        logger.warn('launcher', `Could not spawn ${exe}: ${(err as Error).message}`);
      }
    }

    if (process.platform === 'win32') {
      // `cmd /c start ""` lets Windows resolve protocol/UWP handlers without
      // a console window staying open. The empty title arg is mandatory or
      // start treats the next quoted arg as the title.
      const tryStart = async (target: string, label: string): Promise<boolean> => {
        try {
          const child = spawn('cmd.exe', ['/c', 'start', '""', target], { detached: true, stdio: 'ignore', shell: false });
          child.unref();
          logger.info('launcher', `Launched via ${label}: ${target}`);
          return true;
        } catch (err) {
          logger.warn('launcher', `${label} failed: ${(err as Error).message}`);
          return false;
        }
      };
      if (await tryStart('minecraft://', 'protocol handler')) return { ok: true, profileId: this.profileId };
      if (await tryStart('shell:AppsFolder\\Microsoft.4297127D64EC6_8wekyb3d8bbwe!Minecraft', 'AppsFolder UWP route'))
        return { ok: true, profileId: this.profileId };
    }

    logger.info('launcher', 'Profile written; user must open Minecraft Launcher manually');
    return { ok: false, profileId: this.profileId };
  }

  /**
   * Downloads the Fabric loader version JSON from Fabric Meta and drops it
   * into `<dotMc>/versions/<id>/<id>.json`. The official Minecraft Launcher
   * scans that directory at startup, sees the new entry, and on first launch
   * downloads everything (vanilla MCVER + Fabric libs) using
   * `inheritsFrom`/`libraries` from the JSON.
   *
   * Idempotent — re-fetches the JSON on every launch, which doubles as a
   * "self-heal" if the user accidentally deletes that folder.
   */
  private async ensureFabricVersion(dotMc: string, minecraft: string, fabricLoader: string): Promise<void> {
    const id = `fabric-loader-${fabricLoader}-${minecraft}`;
    const dir = path.join(dotMc, 'versions', id);
    const file = path.join(dir, `${id}.json`);
    const url = `https://meta.fabricmc.net/v2/versions/loader/${minecraft}/${fabricLoader}/profile/json`;
    try {
      const body = await fetchText(url);
      // Sanity check: must parse and must self-identify as our id.
      const parsed = JSON.parse(body) as { id?: string; inheritsFrom?: string };
      if (parsed.id !== id) {
        throw new Error(`Fabric Meta returned id="${parsed.id}", expected "${id}"`);
      }
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(file, body, 'utf8');
      logger.info('launcher', `Fabric version JSON installed: ${file}`);
    } catch (err) {
      logger.error('launcher', `Could not install Fabric version ${id}`, err);
      // Don't throw — let the user try anyway. If the JSON already exists
      // from a previous successful launch, MC Launcher will still work; if
      // not, the same REQUEST_FAILED we had before will surface and the
      // user gets a logged reason for it.
    }
  }

  private async writeProfile(
    dotMc: string,
    instancePath: string,
    config: LauncherConfig,
    minecraft: string,
    fabricLoader: string,
  ): Promise<void> {
    await fs.mkdir(dotMc, { recursive: true });
    const profilesPath = path.join(dotMc, 'launcher_profiles.json');
    let data: Record<string, unknown> = { profiles: {}, settings: {}, version: 3 };
    try {
      const raw = await fs.readFile(profilesPath, 'utf8');
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e?.code !== 'ENOENT') logger.warn('launcher', `launcher_profiles.json unreadable, recreating: ${e?.message}`);
    }
    if (typeof data.profiles !== 'object' || data.profiles === null) data.profiles = {};
    const lastVersionId = `fabric-loader-${fabricLoader}-${minecraft}`;
    const javaArgs = `-Xmx${config.ramMb}M -Xms${Math.max(512, Math.floor(config.ramMb / 4))}M`;
    const profiles = data.profiles as Record<string, Record<string, unknown>>;
    profiles[this.profileId] = {
      ...profiles[this.profileId],
      name: config.name,
      type: 'custom',
      created: profiles[this.profileId]?.created ?? new Date().toISOString(),
      lastUsed: new Date().toISOString(),
      gameDir: instancePath,
      lastVersionId,
      javaArgs,
      icon: 'Furnace',
    };
    await fs.writeFile(profilesPath, JSON.stringify(data, null, 2), 'utf8');
    logger.info('launcher', `Wrote profile "${this.profileId}" -> gameDir=${instancePath}, version=${lastVersionId}`);
  }

  private async findOfficialLauncher(): Promise<string | null> {
    const platform = process.platform;
    const candidates: string[] = [];
    if (platform === 'win32') {
      candidates.push(
        // Game Pass / Xbox install (most common on Win 11) — exe is just `Minecraft.exe`.
        'C:\\XboxGames\\Minecraft Launcher\\Content\\Minecraft.exe',
        path.join(process.env['SystemDrive'] ?? 'C:', '\\XboxGames', 'Minecraft Launcher', 'Content', 'Minecraft.exe'),
        // Standalone installer from minecraft.net.
        path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Minecraft Launcher', 'MinecraftLauncher.exe'),
        path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Minecraft Launcher', 'MinecraftLauncher.exe'),
        // Older per-user install paths.
        path.join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'Minecraft', 'MinecraftLauncher.exe'),
        path.join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'Minecraft Launcher', 'MinecraftLauncher.exe'),
      );
    } else if (platform === 'darwin') {
      candidates.push('/Applications/Minecraft.app/Contents/MacOS/launcher');
    } else {
      candidates.push('/usr/bin/minecraft-launcher', '/opt/minecraft-launcher/minecraft-launcher', '/snap/bin/mc-installer');
    }
    for (const c of candidates) {
      try {
        const stat = await fs.stat(c);
        if (stat.isFile()) return c;
      } catch {
        /* try next */
      }
    }
    return null;
  }
}
