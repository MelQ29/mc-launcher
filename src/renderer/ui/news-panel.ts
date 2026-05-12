import type { NewsEntry } from '../api';

const MONTHS = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];

export function renderNews(list: HTMLElement, entries: NewsEntry[]): void {
  list.innerHTML = '';
  for (const e of entries.slice(0, 5)) {
    const li = document.createElement('li');
    li.className = `news-item news-type-${e.type}`;
    li.dataset.id = e.id;
    li.innerHTML = `
      <div class="date">${escape(formatDate(e.date))}</div>
      <div class="title">${escape(e.title)}</div>
      ${e.body ? `<div class="body">${escape(e.body)}</div>` : ''}
      ${eventTag(e)}
    `;
    list.appendChild(li);
  }
}

function formatDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const day = parseInt(m[3], 10);
  const mon = MONTHS[parseInt(m[2], 10) - 1] ?? '?';
  return `${day} ${mon}`;
}

function eventTag(e: NewsEntry): string {
  if (e.type !== 'event' || !e.eventStart) return '';
  const start = new Date(e.eventStart).getTime();
  const end = e.eventEnd ? new Date(e.eventEnd).getTime() : start + 24 * 3600 * 1000;
  const now = Date.now();
  if (now < start) {
    const days = Math.ceil((start - now) / (24 * 3600 * 1000));
    return `<div class="event-tag">через ${days} дн.</div>`;
  }
  if (now <= end) return `<div class="event-tag live">идёт сейчас</div>`;
  return '';
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
