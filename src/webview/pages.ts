// The pages of the panel's main column. One page shows at a time; the left nav and the overview
// tiles switch between them. Extend PageId only by adding members.
export type PageId = 'overview' | 'payg' | 'providers' | 'sessions' | 'session' | 'kind' | 'element' | 'hunt' | 'marketplaces' | 'marketplace';

const pages = new Map<PageId, HTMLElement>();
const listeners = new Set<(id: PageId) => void>();
let host: HTMLElement | undefined;
let current: PageId = 'overview';

/** The element that holds every page; set once by main.ts before any page registers. */
export function mountPages(el: HTMLElement): void {
  host = el;
}

export function registerPage(id: PageId, root: HTMLElement): void {
  pages.set(id, root);
  root.hidden = id !== current;
  host?.append(root);
}

export function showPage(id: PageId): void {
  current = id;
  for (const [key, root] of pages) root.hidden = key !== id;
  for (const listener of listeners) listener(id);
}

export function currentPage(): PageId {
  return current;
}

/** Called after every page switch, e.g. so the nav marks the active entry. */
export function onPage(listener: (id: PageId) => void): void {
  listeners.add(listener);
}
