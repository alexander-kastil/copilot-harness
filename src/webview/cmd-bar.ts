// The command bar's parts, ported from Claude Harness (detail.ts cmd and cmdBox). One rule: every command sits in a
// labelled box for what it acts on (Page, File, Model, ...), no command sits loose, a box with nothing in it is not drawn,
// and the AI group (aiGroup in session-ui.ts) is the last item, at the right end of the bar.
import { el, icon } from './dom';

/** One command: an icon and a label. `tip` is the hover card (title line, then what it does). */
export const cmd = (glyph: string, label: string, tip: string, onclick: (e: MouseEvent) => void, disabled = false): HTMLElement =>
  el('button', { type: 'button', className: 'view-tab dg-mode', title: tip, 'aria-label': label, disabled, onclick }, icon(glyph), el('span', {}, label));

/** A box of commands; a box without a command is not drawn. */
export const cmdBox = (label: string, ...items: (Node | null | undefined | false)[]): HTMLElement | null => {
  const live = items.filter(Boolean) as Node[];
  return live.length ? el('div', { className: 'dg-modes', role: 'group', 'aria-label': label }, live) : null;
};

/** The bar under a page's title: boxes first, the AI group last. */
export const cmdBar = (...boxes: (Node | null | undefined | false)[]): HTMLElement => el('div', { className: 'cmd-bar' }, boxes.filter(Boolean) as Node[]);
