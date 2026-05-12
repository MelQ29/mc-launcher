import type { BuildEntry, BuildId } from '../api';

export interface TabsHost {
  onSelect(id: BuildId): void;
  isBusy(): boolean;
}

export function renderTabs(
  container: HTMLElement,
  entries: BuildEntry[],
  activeId: BuildId,
  host: TabsHost,
): void {
  container.innerHTML = '';
  for (const e of entries.filter((b) => b.enabled)) {
    const btn = document.createElement('button');
    btn.className = 'tab' + (e.id === activeId ? ' active' : '');
    btn.dataset.buildId = e.id;
    btn.textContent = e.shortName;
    btn.addEventListener('click', () => {
      if (host.isBusy()) return;
      if (e.id === activeId) return;
      host.onSelect(e.id);
    });
    container.appendChild(btn);
  }
}

export function setActiveTab(container: HTMLElement, id: BuildId): void {
  for (const btn of container.querySelectorAll<HTMLButtonElement>('.tab')) {
    btn.classList.toggle('active', btn.dataset.buildId === id);
  }
}
