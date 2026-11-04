// The confirm card every marketplace and plugin action asks first, and the actions themselves. Ported from Claude Harness's
// cards (sync, uninstall, rename): a card under the button names what will change; nothing runs until its button is pressed.
import type { MarketHealth, MarketPlugin } from '../shared/markets';
import { post } from './bridge';
import { el, icon, plural } from './dom';
import { aheadOf, runOp, setPlanListener } from './market-data';

export interface AskOptions {
  title: string;
  text?: string;
  /** Lines under the text; a list of more than ten scrolls. */
  items?: string[];
  label: string;
  glyph: string;
  danger?: boolean;
  /** A text box in the card; the button waits for `check` to return nothing. */
  input?: { label: string; placeholder: string; value?: string; check(value: string): string | undefined; onInput?(value: string): void };
}

export interface AskHandle {
  setItems(items: string[], error?: string): void;
  close(): void;
}

const OPEN = 'body > .ai-confirm.float.market-confirm';

export function ask(anchor: HTMLElement, o: AskOptions, run: (value: string) => void): AskHandle {
  document.querySelector(OPEN)?.remove();
  setPlanListener(undefined);
  let box: HTMLInputElement | undefined;
  const hint = el('div', { className: 'confirm-hint' });
  const list = el('div', { className: 'confirm-list' });
  const draw = (items: string[]) => {
    list.replaceChildren(...items.map((i) => el('div', { className: 'confirm-line', title: i }, i)));
    list.hidden = !items.length;
    list.classList.toggle('scroll', items.length > 10);
  };
  const close = () => {
    document.removeEventListener('mousedown', outside, true);
    setPlanListener(undefined);
    card.remove();
    anchor.focus();
  };
  const outside = (e: Event) => {
    if (!card.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  let planError: string | undefined;
  const go = el(
    'button',
    {
      className: `payg-btn${o.danger ? ' danger' : ''}`,
      onclick: () => {
        close();
        run(box?.value.trim() ?? '');
      },
    },
    icon(o.glyph),
    o.label
  );
  const validate = () => {
    const problem = box ? box.value.trim() && (o.input!.check(box.value.trim()) ?? planError) : undefined;
    const empty = !!box && !box.value.trim();
    hint.textContent = problem ?? '';
    go.disabled = empty || !!problem;
  };
  if (o.input) {
    box = el('input', { type: 'text', className: 'payg-input', placeholder: o.input.placeholder, 'aria-label': o.input.label, value: o.input.value ?? '', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
    box.addEventListener('input', () => {
      planError = undefined;
      validate();
      const v = box!.value.trim();
      if (v && !o.input!.check(v)) o.input!.onInput?.(v);
      else draw([]);
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !go.disabled) go.click();
    });
  }
  const card = el(
    'div',
    { className: 'ai-confirm float market-confirm', role: 'alertdialog', 'aria-label': o.title, onkeydown: (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } } },
    el('div', { className: 'ai-confirm-text' }, el('b', {}, o.title), o.text ? el('span', {}, o.text) : null),
    box ? el('label', { className: 'confirm-field' }, el('span', {}, o.input!.label), box) : null,
    hint,
    list,
    el('div', { className: 'ai-confirm-actions' }, go, el('button', { className: 'payg-btn secondary', onclick: close }, 'Cancel'))
  );
  draw(o.items ?? []);
  validate();
  document.addEventListener('mousedown', outside, true);
  document.body.append(card);
  const at = anchor.getBoundingClientRect();
  const width = Math.min(440, window.innerWidth - 16);
  card.style.width = `${width}px`;
  card.style.left = `${Math.max(8, Math.min(at.right - width, window.innerWidth - width - 8))}px`;
  card.style.top = `${Math.max(8, Math.min(at.bottom + 6, window.innerHeight - card.offsetHeight - 8))}px`;
  (box ?? go).focus();
  return {
    setItems(items, error) {
      planError = error;
      draw(items);
      validate();
    },
    close,
  };
}

const NAME = /^[a-z0-9][a-z0-9-]*$/;

export function syncPlugin(anchor: HTMLElement, m: MarketHealth, p: MarketPlugin): void {
  ask(anchor, { title: `Sync ${p.name}`, text: `Refreshes ${m.name}, then updates ${p.name} from ${p.installed} to ${p.source}. Open Copilot sessions pick the new version up after a restart.`, label: 'Sync plugin', glyph: 'sync' }, () => runOp({ op: 'sync', market: m.name, plugin: p.name }));
}

export function syncAll(anchor: HTMLElement, m: MarketHealth): void {
  const ahead = aheadOf(m);
  ask(
    anchor,
    {
      title: `Sync ${plural(ahead.length, 'plugin')}`,
      text: `Refreshes ${m.name} once, then updates each plugin whose source is ahead of the installed copy. A plugin that fails does not stop the others.`,
      items: ahead.map((p) => `${p.name}  ${p.installed} to ${p.source}`),
      label: `Sync ${plural(ahead.length, 'plugin')}`,
      glyph: 'sync',
    },
    () => runOp({ op: 'sync', market: m.name })
  );
}

export function uninstallPlugin(anchor: HTMLElement, m: MarketHealth, p: MarketPlugin): void {
  ask(anchor, { title: `Uninstall ${p.name}`, text: `Runs copilot plugin uninstall ${p.key}. Its skills, agents and hooks stop loading in Copilot.`, label: 'Uninstall', glyph: 'trash', danger: true }, () => runOp({ op: 'uninstall', market: m.name, plugin: p.name }));
}

export function togglePlugin(anchor: HTMLElement, m: MarketHealth, p: MarketPlugin): void {
  const on = !p.enabled;
  ask(anchor, { title: `${on ? 'Enable' : 'Disable'} ${p.name}`, text: `Runs copilot plugin ${on ? 'enable' : 'disable'} ${p.key}, which sets ${p.key} under enabledPlugins in ~/.copilot/settings.json.`, label: on ? 'Enable' : 'Disable', glyph: on ? 'pass' : 'circle-slash' }, () => runOp({ op: on ? 'enable' : 'disable', market: m.name, plugin: p.name }));
}

export function renameMarket(anchor: HTMLElement, m: MarketHealth, all: MarketHealth[]): void {
  const check = (v: string) => (NAME.test(v) ? (all.some((x) => x.name === v) ? `${v} already exists.` : undefined) : 'Lowercase letters, digits and dashes.');
  const handle = ask(
    anchor,
    {
      title: `Rename ${m.name}`,
      text: 'Writes the files below, then a terminal removes the marketplace, adds it again and installs its plugins under the new name.',
      label: 'Rename',
      glyph: 'edit',
      input: {
        label: 'New name',
        placeholder: 'lowercase-with-dashes',
        check,
        onInput: (to) => post({ type: 'marketsPlan', market: m.name, to }),
      },
    },
    (to) => runOp({ op: 'rename', market: m.name, to })
  );
  setPlanListener((plan) => handle.setItems(plan.error ? [] : [...plan.files.map((f) => `${f.file}  ${f.detail}`), ...plan.commands.map((c, i) => `${i + 1}. ${c}`)], plan.error));
}
