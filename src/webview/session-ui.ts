// Pieces the Sessions page and the session detail page share: formatters, the AI group, the confirm card,
// the model picker and the row that opens a session.
import type { SessionAiAction } from '../shared/sessions';
import { post } from './bridge';
import { el, icon } from './dom';
import { currentPage, showPage, type PageId } from './pages';

/** What the host last said about the AI actions; the model choice lives here until the panel reloads. */
export const prefs = { skipConfirm: false, models: [] as string[], model: '' };

export const fmtDur = (ms: number | undefined): string => {
  if (ms === undefined) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
};

export const shortModel = (m: string | undefined): string => (m ?? '').replace(/^(copilot|github|openai|anthropic)[/:]/i, '');

/** Marks the matches of `q` in `text`. */
export function highlight(text: string, q: string): (Node | string)[] {
  const at = q ? text.toLowerCase().indexOf(q) : -1;
  if (at < 0) return [text];
  return [text.slice(0, at), el('mark', {}, text.slice(at, at + q.length)), text.slice(at + q.length)];
}

export const iconBtn = (name: string, title: string, onclick: () => void, disabled = false): HTMLElement =>
  el('button', { className: 'icon-btn', title, 'aria-label': title, onclick, disabled }, icon(name));

/** The AI group: every action that starts Copilot sits in one boxed group, led by the Copilot mark. */
export function aiGroup(cls: string, ...items: (Node | null | undefined | false)[]): HTMLElement | null {
  const live = items.filter(Boolean) as Node[];
  if (!live.length) return null;
  return el(
    'span',
    { className: `ai-group${cls ? ` ${cls}` : ''}`, role: 'group', 'aria-label': 'Copilot' },
    el('span', { className: 'ai-mark', title: 'Copilot\nEach action in this box starts Copilot CLI in a terminal and counts against your Copilot credits.' }, icon('copilot')),
    ...live
  );
}

/**
 * Asks before an AI action starts, unless the user chose Don't ask again. With an `anchor` (the button that asked) the card
 * floats under that button and closes on Esc, Cancel or a click outside; without one it sits at the top of `host`.
 */
export function askAi(host: HTMLElement, title: string, text: string, run: () => void, anchor?: HTMLElement): void {
  host.querySelector(':scope > .ai-confirm')?.remove();
  document.querySelector('body > .ai-confirm.float')?.remove();
  if (prefs.skipConfirm) {
    run();
    return;
  }
  const again = el('input', { type: 'checkbox', id: 'ai-skip', role: 'switch' }) as HTMLInputElement;
  const close = () => {
    document.removeEventListener('mousedown', outside, true);
    card.remove();
    anchor?.focus();
  };
  const outside = (e: Event) => {
    if (!card.contains(e.target as Node) && !anchor?.contains(e.target as Node)) close();
  };
  const card = el(
    'div',
    { className: `ai-confirm${anchor ? ' float' : ''}`, role: 'alertdialog', 'aria-label': title, onkeydown: (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } } },
    el('div', { className: 'ai-confirm-text' }, el('b', {}, title), el('span', {}, text)),
    el('label', { className: 'ai-confirm-skip' }, again, "Don't ask again"),
    el(
      'div',
      { className: 'ai-confirm-actions' },
      el(
        'button',
        {
          className: 'payg-btn',
          onclick: () => {
            if (again.checked) {
              prefs.skipConfirm = true;
              post({ type: 'sessionSkipConfirm' });
            }
            close();
            run();
          },
        },
        icon('terminal'),
        'Open terminal'
      ),
      el('button', { className: 'payg-btn secondary', onclick: close }, 'Cancel')
    )
  );
  if (!anchor) {
    host.prepend(card);
    return;
  }
  document.body.append(card);
  const at = anchor.getBoundingClientRect();
  const width = Math.min(420, window.innerWidth - 16);
  card.style.width = `${width}px`;
  card.style.left = `${Math.max(8, Math.min(at.right - width, window.innerWidth - width - 8))}px`;
  card.style.top = `${Math.min(at.bottom + 6, window.innerHeight - card.offsetHeight - 8)}px`;
  document.addEventListener('mousedown', outside, true);
  (card.querySelector('.payg-btn') as HTMLElement).focus();
}

export function startAi(action: SessionAiAction, id: string, model?: string): void {
  post({ type: 'sessionAi', action, id, ...(model ? { model } : {}) });
}

/** The model picker of the AI actions: the models Copilot sessions used, or Copilot's own default. */
export function modelPicker(disabled = false): HTMLElement {
  const options = ['', ...new Set([...prefs.models, ...(prefs.model ? [prefs.model] : [])])];
  const select = el(
    'select',
    {
      className: 'payg-input',
      'aria-label': 'Model',
      disabled,
      onchange: (e: Event) => {
        prefs.model = (e.target as HTMLSelectElement).value;
      },
    },
    options.map((m) => el('option', { value: m, selected: prefs.model === m }, m ? shortModel(m) : 'Default model'))
  );
  return el('label', { className: 'style-model' }, el('span', {}, 'Model'), select);
}

let from: PageId = 'overview';
let opener: ((id: string) => void) | undefined;

/** Registered by the session page: shows its loading state for the id before the host answers. */
export function setOpener(fn: (id: string) => void): void {
  opener = fn;
}

/** The page the session page's back button returns to. */
export const backTarget = (): PageId => from;

/** Opens a session's detail page from the overview, the nav or the Sessions page. */
export function openSession(id: string): void {
  const page = currentPage();
  if (page !== 'session') from = page === 'sessions' || page === 'element' ? page : 'overview';
  opener?.(id);
  post({ type: 'sessionOpen', id });
  showPage('session');
}

/** Makes the body rows of a grid table open their session on a click or Enter. */
export function rowsOpen<R extends { id: string }>(table: HTMLElement, rows: R[]): HTMLElement {
  const body = [...table.querySelectorAll<HTMLElement>('.at-row:not(.at-head)')];
  body.forEach((row, i) => {
    const id = rows[i].id;
    row.classList.add('open');
    row.setAttribute('tabindex', '0');
    row.setAttribute('role', 'row');
    row.addEventListener('click', () => openSession(id));
    row.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === row) {
        e.preventDefault();
        openSession(id);
      }
    });
  });
  return table;
}
