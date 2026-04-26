import { promises as fs } from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import type { LogEntry } from './types';

class Logger extends EventEmitter {
  private filePath: string | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  /** Initialise the file sink. Until called, logs go to stdout + emitter only. */
  async init(logDir: string): Promise<void> {
    await fs.mkdir(logDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.filePath = path.join(logDir, `launcher-${stamp}.log`);
    await this.rotate(logDir).catch(() => {
      /* rotation is best-effort */
    });
  }

  debug(scope: string, message: string): void { this.emitEntry('debug', scope, message); }
  info(scope: string, message: string): void { this.emitEntry('info', scope, message); }
  warn(scope: string, message: string): void { this.emitEntry('warn', scope, message); }
  error(scope: string, message: string, err?: unknown): void {
    const detail = err instanceof Error ? `${message}: ${err.message}\n${err.stack ?? ''}` : message;
    this.emitEntry('error', scope, detail);
  }

  private emitEntry(level: LogEntry['level'], scope: string, message: string): void {
    const entry: LogEntry = { ts: new Date().toISOString(), level, scope, message };
    const formatted = `[${entry.ts}] [${level.toUpperCase()}] [${scope}] ${message}`;
    if (level === 'error') console.error(formatted);
    else console.log(formatted);
    this.emit('entry', entry);
    if (this.filePath) {
      const target = this.filePath;
      this.writeQueue = this.writeQueue
        .then(() => fs.appendFile(target, formatted + '\n', 'utf8'))
        .catch(() => undefined);
    }
  }

  /** Keep at most the 10 most recent log files. */
  private async rotate(logDir: string): Promise<void> {
    const files = (await fs.readdir(logDir))
      .filter((f) => f.startsWith('launcher-') && f.endsWith('.log'))
      .sort();
    const excess = files.length - 10;
    if (excess <= 0) return;
    for (let i = 0; i < excess; i++) {
      await fs.unlink(path.join(logDir, files[i])).catch(() => undefined);
    }
  }
}

export const logger = new Logger();
