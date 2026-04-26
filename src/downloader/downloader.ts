import { promises as fs, createWriteStream, createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { logger } from '../core/logger';
import type { DownloadProgress } from '../core/types';
import { sha256File } from './hash';

interface RequestResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  stream: http.IncomingMessage;
}

interface DownloadOptions {
  /** Where to put the file. */
  dest: string;
  /** Source URL. */
  url: string;
  /** Expected SHA-256 (lowercase hex). When provided, mismatches are fatal. */
  sha256?: string;
  /** Total expected size in bytes. */
  size?: number;
  /** Maximum retries on transient failure. */
  retries: number;
  /** Per-chunk callback for byte-level progress. */
  onProgress?: (deltaBytes: number) => void;
  /** Cancellation token. */
  signal?: AbortSignal;
}

interface BatchItem {
  /** Identifier shown in logs/progress (usually the manifest path). */
  id: string;
  url: string;
  dest: string;
  sha256?: string;
  size?: number;
}

/**
 * Multi-file downloader with:
 *  - parallel file downloads bounded by `concurrency`
 *  - per-file retry with exponential backoff
 *  - HTTP Range resume for interrupted downloads (writes to dest + ".part")
 *  - SHA-256 verification when checksum is provided
 *
 * "Многопоточная" here means "many files in flight at once". Single-file chunked
 * range download is supported indirectly via resume: a partial file from a prior
 * run continues from its existing length.
 */
export class Downloader {
  constructor(private readonly concurrency: number) {}

  async downloadOne(opts: DownloadOptions): Promise<void> {
    const partFile = opts.dest + '.part';
    await fs.mkdir(path.dirname(opts.dest), { recursive: true });
    let attempt = 0;
    let lastErr: Error | null = null;
    while (attempt <= opts.retries) {
      if (opts.signal?.aborted) throw new Error('aborted');
      try {
        await this.attempt(opts, partFile);
        if (opts.sha256) {
          const actual = await sha256File(partFile);
          if (actual.toLowerCase() !== opts.sha256.toLowerCase()) {
            // Hash mismatch is non-resumable — drop the partial and retry from zero.
            await fs.unlink(partFile).catch(() => undefined);
            throw new Error(
              `SHA-256 mismatch for ${path.basename(opts.dest)}: expected ${opts.sha256}, got ${actual}`,
            );
          }
        }
        await fs.rename(partFile, opts.dest);
        return;
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        attempt++;
        if (attempt > opts.retries) break;
        const delay = Math.min(30000, 500 * Math.pow(2, attempt));
        logger.warn(
          'downloader',
          `Attempt ${attempt} for ${opts.url} failed (${lastErr.message}); retrying in ${delay}ms`,
        );
        await sleep(delay);
      }
    }
    throw new Error(`Download failed after ${opts.retries + 1} attempts: ${lastErr?.message ?? 'unknown'}`);
  }

  /** Download many files with bounded concurrency. Reports byte-level progress. */
  async downloadBatch(
    items: BatchItem[],
    onProgress: (p: DownloadProgress) => void,
    retries: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const totalBytes = items.reduce((sum, it) => sum + (it.size ?? 0), 0);
    let downloadedBytes = 0;
    let filesDone = 0;
    let speedBytes = 0;
    let lastTick = Date.now();
    let bytesSinceTick = 0;
    let current: string | undefined;

    const emit = () => {
      const now = Date.now();
      const elapsed = (now - lastTick) / 1000;
      if (elapsed >= 0.25) {
        speedBytes = bytesSinceTick / elapsed;
        bytesSinceTick = 0;
        lastTick = now;
      }
      onProgress({
        totalBytes,
        downloadedBytes,
        filesDone,
        filesTotal: items.length,
        current,
        speed: speedBytes,
      });
    };

    const queue = [...items];
    const workers: Promise<void>[] = [];
    for (let w = 0; w < Math.min(this.concurrency, queue.length); w++) {
      workers.push((async () => {
        while (queue.length > 0) {
          const item = queue.shift();
          if (!item) break;
          if (signal?.aborted) throw new Error('aborted');
          current = item.id;
          emit();
          await this.downloadOne({
            url: item.url,
            dest: item.dest,
            sha256: item.sha256,
            size: item.size,
            retries,
            signal,
            onProgress: (delta) => {
              downloadedBytes += delta;
              bytesSinceTick += delta;
              emit();
            },
          });
          filesDone++;
          emit();
        }
      })());
    }
    await Promise.all(workers);
    current = undefined;
    emit();
  }

  /** A single download attempt with optional resume from .part file. */
  private async attempt(opts: DownloadOptions, partFile: string): Promise<void> {
    let from = 0;
    try {
      const stat = await fs.stat(partFile);
      if (stat.isFile()) from = stat.size;
    } catch {
      from = 0;
    }
    const headers: Record<string, string> = { 'User-Agent': 'EclipseFantasyLauncher/0.1' };
    if (from > 0) headers['Range'] = `bytes=${from}-`;
    const res = await this.request(opts.url, headers, 5);
    const resumed = res.status === 206;
    if (res.status === 200 && from > 0) {
      // Server ignored Range — restart from scratch.
      from = 0;
      await fs.unlink(partFile).catch(() => undefined);
    } else if (res.status !== 200 && res.status !== 206) {
      throw new Error(`HTTP ${res.status} for ${opts.url}`);
    }
    if (from > 0 && opts.onProgress) opts.onProgress(from); // count already-on-disk bytes once

    const out = createWriteStream(partFile, { flags: resumed ? 'a' : 'w' });
    res.stream.on('data', (chunk: Buffer) => {
      if (opts.onProgress) opts.onProgress(chunk.length);
    });
    if (opts.signal) {
      const onAbort = () => { res.stream.destroy(new Error('aborted')); };
      opts.signal.addEventListener('abort', onAbort, { once: true });
      try { await pipeline(res.stream, out); }
      finally { opts.signal.removeEventListener('abort', onAbort); }
    } else {
      await pipeline(res.stream, out);
    }
  }

  /** Issue an HTTP(S) GET, following redirects up to `maxRedirects`. */
  private request(urlStr: string, headers: Record<string, string>, maxRedirects: number): Promise<RequestResult> {
    return new Promise<RequestResult>((resolve, reject) => {
      const u = new URL(urlStr);
      const lib: typeof http | typeof https = u.protocol === 'https:' ? https : http;
      const req = lib.request(
        {
          method: 'GET',
          host: u.hostname,
          port: u.port || (u.protocol === 'https:' ? 443 : 80),
          path: u.pathname + u.search,
          headers,
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && maxRedirects > 0) {
            res.resume();
            const next = new URL(res.headers.location, urlStr).toString();
            this.request(next, headers, maxRedirects - 1).then(resolve, reject);
            return;
          }
          resolve({ status, headers: res.headers, stream: res });
        },
      );
      req.setTimeout(30000, () => req.destroy(new Error('request timeout')));
      req.on('error', reject);
      req.end();
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Convenience helper for one-shot text downloads (manifest fetch). */
export async function fetchText(url: string): Promise<string> {
  const dl = new Downloader(1);
  const tmp = path.join(
    require('os').tmpdir(),
    `ef-fetch-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
  );
  try {
    await dl.downloadOne({ url, dest: tmp, retries: 3 });
    const buf = await streamToBuffer(createReadStream(tmp));
    return buf.toString('utf8');
  } finally {
    await fs.unlink(tmp).catch(() => undefined);
  }
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}
