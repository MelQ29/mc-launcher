import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import * as path from 'path';
import type { NewsFeed, NewsEntry, NewsEntryType, BuildId } from '../core/types';
import { fetchText } from '../downloader/downloader';
import { logger } from '../core/logger';

const VALID_TYPES: ReadonlyArray<NewsEntryType> = ['changelog', 'event', 'notice'];

export function parseNewsFeed(raw: string): NewsFeed {
  const obj = JSON.parse(raw) as Partial<NewsFeed>;
  if (obj.schemaVersion !== 1) throw new Error(`Unsupported news.json schemaVersion: ${obj.schemaVersion}`);
  if (!Array.isArray(obj.entries)) throw new Error('news.json missing entries[]');
  const entries: NewsEntry[] = obj.entries.map((e) => normalize(e as Partial<NewsEntry>));
  entries.sort((a, b) => b.date.localeCompare(a.date));
  return {
    schemaVersion: 1,
    buildId: (obj.buildId ?? '') as BuildId,
    generatedAt: obj.generatedAt,
    entries,
    signature: obj.signature,
  };
}

function normalize(e: Partial<NewsEntry>): NewsEntry {
  const type: NewsEntryType = VALID_TYPES.includes(e.type as NewsEntryType)
    ? (e.type as NewsEntryType)
    : 'notice';
  return {
    id: String(e.id ?? ''),
    date: String(e.date ?? ''),
    type,
    title: String(e.title ?? ''),
    body: String(e.body ?? ''),
    eventStart: e.eventStart,
    eventEnd: e.eventEnd,
    url: e.url,
  };
}

export class NewsService extends EventEmitter {
  private cached: NewsEntry[] = [];

  constructor(
    private readonly buildId: BuildId,
    private readonly url: string,
    private readonly cachePath: string,
  ) { super(); }

  current(): NewsEntry[] { return this.cached; }

  async fetch(): Promise<{ entries: NewsEntry[]; fromCache: boolean }> {
    try {
      const raw = await fetchText(this.url);
      const feed = parseNewsFeed(raw);
      await fs.mkdir(path.dirname(this.cachePath), { recursive: true });
      await fs.writeFile(this.cachePath, raw, 'utf8');
      this.cached = feed.entries;
      this.emit('updated', feed.entries);
      return { entries: feed.entries, fromCache: false };
    } catch (err) {
      logger.warn(`news:${this.buildId}`, `Fetch failed (${(err as Error).message}); trying cache`);
      try {
        const raw = await fs.readFile(this.cachePath, 'utf8');
        const feed = parseNewsFeed(raw);
        this.cached = feed.entries;
        this.emit('updated', feed.entries);
        return { entries: feed.entries, fromCache: true };
      } catch {
        return { entries: [], fromCache: true };
      }
    }
  }
}
