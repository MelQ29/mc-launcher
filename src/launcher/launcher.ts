import { promises as fs } from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { logger } from '../core/logger';
import { Paths } from '../core/paths';
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
    await this.writeProfile(dotMc, instancePath, config, minecraft, fabricLoader);
    const exe = await this.findOfficialLauncher();
    if (exe) {
      logger.info('launcher', `Spawning official launcher: ${exe}`);
      try {
        const child = spawn(exe, [], { detached: true, stdio: 'ignore' });
        child.unref();
        return { ok: true, profileId: this.profileId };
      } catch (err) {
        logger.warn('launcher', `Could not spawn official launcher: ${(err as Error).message}`);
      }
    }
    logger.info('launcher', 'Profile written; user must open Minecraft Launcher manually');
    return { ok: false, profileId: this.profileId };
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
        path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Minecraft Launcher', 'MinecraftLauncher.exe'),
        path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Minecraft Launcher', 'MinecraftLauncher.exe'),
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
