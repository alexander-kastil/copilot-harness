// DOM builders and formatters with no state of their own.

type Child = Node | string | number | false | null | undefined | Child[];
type Attrs = Record<string, unknown> | undefined;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'className') node.className = String(v);
    else if (k === 'value') (node as unknown as HTMLInputElement).value = String(v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity as 1) as Child[]) if (c !== undefined && c !== null && c !== false) node.append(typeof c === 'object' ? (c as Node) : String(c));
  return node;
}

export const icon = (name: string): HTMLElement => el('span', { className: `codicon codicon-${name}` });

/** A source, scope or plugin value: a plain tag. */
export const tag = (word: string, title?: string): HTMLElement | string => (word ? el('span', { className: 'tag', title }, word) : '');

export const plural = (n: number, word: string): string => `${n} ${n === 1 ? word : /[^aeiou]y$/.test(word) ? `${word.slice(0, -1)}ies` : `${word}s`}`;

export const fmtAgo = (t: number | undefined): string => {
  if (!t) return '-';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  if (m < 30 * 1440) return `${Math.round(m / 1440)} d ago`;
  return new Date(t).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
};

export const fmtDate = (t: number): string => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export const fmtNum = (n: number): string => (n >= 999500 ? `${(n / 1e6).toFixed(1)} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(n));

export const fmtCredits = (n: number): string => n.toFixed(2);

/** Epoch milliseconds of an ISO string, undefined when absent or not a date. */
export const ms = (iso: string | undefined): number | undefined => {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? undefined : t;
};

/** A div that acts as a button: clickable, focusable, and opened with Enter or Space. */
export const pressable = (fn: () => void): Record<string, unknown> => ({
  role: 'button',
  tabindex: '0',
  onclick: fn,
  onkeydown: (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    fn();
  },
});
