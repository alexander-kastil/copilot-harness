// The nav as a keyboard tree: one Tab stop, arrows move, Left and Right fold, Enter opens, Space folds.
// Ported from Claude Harness's sidebar.
const folders = new WeakMap<HTMLElement, () => void>();

// The key of the item that last had focus: the tree's one Tab stop, and the item a repaint gives the focus back to.
let navKey: string | undefined;

export const focusedKey = (): string | undefined => navKey;

/** `fold` toggles a head without opening anything; an item without one is toggled or opened by its click. */
export function treeItem(node: HTMLElement, key: string, level: number, expanded?: boolean, fold?: () => void): HTMLElement {
  node.setAttribute('role', 'treeitem');
  node.setAttribute('tabindex', '-1');
  node.setAttribute('aria-level', String(level));
  if (expanded !== undefined) node.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  if (node.classList.contains('selected')) node.setAttribute('aria-selected', 'true');
  node.dataset.nav = key;
  if (fold) folders.set(node, fold);
  return node;
}

export const navItems = (list: HTMLElement): HTMLElement[] => [...list.querySelectorAll<HTMLElement>('[role=treeitem]')];

export function wireTree(list: HTMLElement): void {
  list.setAttribute('role', 'tree');
  list.setAttribute('aria-label', 'Copilot harness');
  const items = navItems(list);
  const stop = items.find((n) => n.dataset.nav === navKey) ?? items.find((n) => n.classList.contains('selected')) ?? items[0];
  // The buttons of a head are reached from the head itself, so the tree is one Tab stop plus the buttons of its current row.
  const roving = (current: HTMLElement | undefined) => {
    items.forEach((n) => n.setAttribute('tabindex', n === current ? '0' : '-1'));
    list.querySelectorAll('[role=treeitem] button').forEach((b) => b.setAttribute('tabindex', current?.contains(b) ? '0' : '-1'));
  };
  roving(undefined);
  stop?.setAttribute('tabindex', '0');
  list.addEventListener('focusin', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('[role=treeitem]');
    if (!item) return;
    navKey = item.dataset.nav;
    roving(item);
  });
  list.addEventListener('focusout', (e) => {
    const next = e.relatedTarget as Node | null;
    if (!next || !list.contains(next)) roving(items.find((n) => n.dataset.nav === navKey) ?? stop);
  });
  list.addEventListener('keydown', (e) => {
    const item = e.target as HTMLElement;
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || !item.matches('[role=treeitem]')) return;
    const all = navItems(list);
    const i = all.indexOf(item);
    const level = Number(item.getAttribute('aria-level'));
    const open = item.getAttribute('aria-expanded');
    const fold = () => (folders.get(item) ?? (() => item.click()))();
    const go = (n: HTMLElement | undefined) => {
      if (!n) return;
      e.preventDefault();
      n.focus();
    };
    if (e.key === 'ArrowDown') go(all[i + 1]);
    else if (e.key === 'ArrowUp') go(all[i - 1]);
    else if (e.key === 'Home') go(all[0]);
    else if (e.key === 'End') go(all[all.length - 1]);
    else if (e.key === 'ArrowRight') {
      if (open === 'false') {
        e.preventDefault();
        fold();
      } else if (open === 'true' && all[i + 1] && Number(all[i + 1].getAttribute('aria-level')) > level) go(all[i + 1]);
    } else if (e.key === 'ArrowLeft') {
      if (open === 'true') {
        e.preventDefault();
        fold();
      } else go(all.slice(0, i).reverse().find((n) => Number(n.getAttribute('aria-level')) < level));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      item.click();
    } else if (e.key === ' ') {
      e.preventDefault();
      if (open !== null && folders.has(item)) fold();
      else item.click();
    }
  });
}
