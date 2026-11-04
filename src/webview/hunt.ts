// The Plugin Hunter page: a marketplace picker and two tabs. New hunt is a chat with Copilot beside the card it proposes; History
// keeps the other cards with their chats. Ported from Claude Harness's Plugin Hunter.
import type { HuntCreateAsk, HuntToWebview } from '../shared/hunt';
import { post } from './bridge';
import { el, icon } from './dom';
import { card } from './hunt-card';
import { chatColumn, huntAi, startOver } from './hunt-chat';
import { confirmAt } from './hunt-confirm';
import { marketPicker } from './hunt-picker';
import { bindPage, hunt, newHunt, page, repaint, splitCards, tickWait } from './hunt-state';
import { showPage } from './pages';
import { iconBtn } from './session-ui';

export const openHunt = (): void => {
  post({ type: 'huntInfo' });
  showPage('hunt');
  repaint();
};

// The Plugin Hunter button, in the AI group since the hunt is Copilot's work and counts against the credits; like every AI group it sits last, at the right end of its bar.
export const huntButton = (): HTMLElement =>
  huntAi(
    'hunt-cta',
    el(
      'button',
      { className: 'secondary', title: 'Plugin Hunter\nCopilot proposes a plugin from the skills and agents you already have, and creates it in a marketplace you own. It counts against your Copilot credits.', 'aria-label': 'Plugin Hunter', onclick: openHunt },
      icon('telescope'),
      el('span', { className: 'cta-label' }, 'Plugin Hunter')
    )
  );

const tabBar = (tabs: [string, string, string, string, number?][], current: string, pick: (id: string) => void, label: string): HTMLElement =>
  el(
    'div',
    { className: 'view-tabs', role: 'tablist', 'aria-label': label },
    tabs.map(([id, text, glyph, about, count]) =>
      el(
        'button',
        { className: `view-tab${id === current ? ' active' : ''}`, role: 'tab', 'aria-selected': id === current ? 'true' : 'false', tabindex: id === current ? '0' : '-1', title: `${text}\n${about}`,
          onclick: () => pick(id),
          // The inactive tab is out of the Tab order: the arrow keys move between the tabs.
          onkeydown: (e: KeyboardEvent) => {
            const at = tabs.findIndex((t) => t[0] === id);
            const to = e.key === 'ArrowRight' ? (at + 1) % tabs.length : e.key === 'ArrowLeft' ? (at - 1 + tabs.length) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
            if (to < 0) return;
            e.preventDefault();
            pick(tabs[to][0]);
            queueMicrotask(() => [...document.querySelectorAll<HTMLElement>('[role=tablist]')].find((l) => l.getAttribute('aria-label') === label && l.offsetParent)?.querySelector<HTMLElement>('[aria-selected=true]')?.focus());
          },
        },
        icon(glyph),
        el('span', {}, text),
        count === undefined ? null : el('span', { className: 'tab-count' }, count)
      )
    )
  );

// Nothing to create in: the page says so.
const noMarket = (): HTMLElement | null =>
  hunt.info && !hunt.info.markets.some((k) => k.owned)
    ? el(
        'div',
        { className: 'notice', role: 'status' },
        el('div', {}, 'No marketplace of your own. Plugin Hunter writes plugins into a marketplace folder on your disk (a folder with a marketplace.json, added with copilot plugin marketplace add <folder>); GitHub and URL marketplaces are refreshed from their source on update.'),
        el('div', { className: 'hunt-notice-actions' }, el('button', { className: 'secondary', onclick: () => showPage('marketplaces') }, icon('package'), 'Open Marketplace health'))
      )
    : null;

const reading = 'Reading your skills and agents...';

function paint(root: HTMLElement): void {
  const split = splitCards();
  const bar = tabBar(
    [
      ['new', 'New hunt', 'sparkle', 'Talk to Copilot and pick what goes into the plugin.'],
      ['history', 'History', 'history', 'The plugin cards you have made or started, each with the chat that made it.', split.history.length],
    ],
    hunt.tab,
    (id) => {
      if (id === 'new') return newHunt();
      hunt.tab = 'history';
      repaint();
    },
    'Plugin Hunter views'
  );
  // The new hunt: half chat, like a traditional one with its composer at the bottom, half findings and selections, the artifact: the proposed card with its picker.
  const fresh = el(
    'div',
    { className: 'hunt-split' },
    chatColumn(split),
    el(
      'div',
      { className: 'hunt-col hunt-col-find' },
      el('div', { className: 'hunt-col-head' }, icon('checklist'), el('span', {}, 'Findings and selections'), split.working ? el('span', { className: 'hunt-col-count' }, `${split.working.assets.filter((a) => a.include).length} selected`) : null),
      split.working ? card(split.working) : el('div', { className: 'empty flush' }, hunt.info ? 'Nothing proposed yet. The skills and agents Copilot finds appear here, ready to keep or drop, once you send a message.' : reading)
    )
  );
  const history = split.history.length
    ? el('div', { className: 'hunt-history' }, split.history.map((p) => card(p, true)))
    : el('div', { className: 'empty flush' }, hunt.info ? 'No history yet. A plugin card you finish or set aside is kept here with its chat.' : reading);
  const count = hunt.info?.catalog.length ?? 0;
  const head = el(
    'header',
    { className: `main-head${hunt.running ? ' busy' : ''}` },
    el('span', { className: 'big' }, icon('telescope')),
    el('div', { className: 'title' }, el('h1', {}, 'Plugin Hunter'), el('div', { className: 'path meta' }, hunt.info ? `${count} ${count === 1 ? 'skill or agent' : 'skills and agents'}` : 'Reading...')),
    el('div', { className: 'toolbar' }, iconBtn('arrow-left', 'Back to Overview', () => showPage('overview')), marketPicker(), startOver())
  );
  root.replaceChildren(head, el('div', { className: 'main-body hunt-body' }, noMarket(), bar, hunt.tab === 'history' ? history : fresh));
}

/** The facts of the question before Create: every file written and every copy replaced, listed before anything happens. */
function askCreate(ask: HuntCreateAsk): void {
  const anchor = page().querySelector<HTMLElement>(`[data-card="${ask.id}"] .hunt-create`);
  if (!anchor) return;
  confirmAt(anchor, {
    title: `Create ${ask.name}`,
    sub: `in ${ask.market}`,
    facts: [
      { glyph: 'folder', text: el('span', {}, 'Writes the plugin into ', el('code', {}, ask.location), ':') },
      ...ask.files.map((f) => ({ glyph: 'file', text: el('code', {}, f) as Node })),
      { glyph: 'extensions', text: el('span', {}, 'Installs ', el('code', {}, `${ask.name}@${ask.market}`), " with copilot plugin install, then replaces the copies below with the plugin's version.") },
      ...ask.replaced.map((r) => ({ glyph: 'archive', text: `Replaces ${r}. A backup is kept.` })),
      ...(ask.replaced.length ? [] : [{ glyph: 'check', text: 'No copy is replaced.' }]),
      ...ask.kept.map((k) => ({ glyph: 'info', text: k })),
      { glyph: 'git-commit', text: 'Nothing is committed in the marketplace.' },
    ],
    action: 'Create',
    actionGlyph: 'package',
    onConfirm: () => post({ type: 'huntCreate', id: ask.id, market: ask.market, confirmed: true }),
  });
}

export interface HuntPage {
  root: HTMLElement;
  onMessage(message: HuntToWebview): void;
}

export function createHuntPage(): HuntPage {
  const root = el('section', { className: 'main hunt-page' });
  bindPage(root, () => paint(root));
  paint(root);
  return {
    root,
    onMessage(m) {
      if (m.type === 'hunt') {
        hunt.info = m.info;
        hunt.proposals = m.info.proposals;
        hunt.chat = m.info.chat;
        hunt.created = m.info.created;
        if (!hunt.picked || !m.info.markets.some((k) => k.name === hunt.picked && k.owned)) hunt.picked = m.info.picked;
      } else if (m.type === 'huntRun') {
        hunt.running = m.state === 'running';
        if (hunt.running) {
          hunt.startedAt = Date.now();
          hunt.error = '';
        }
        tickWait(hunt.running);
        hunt.pending = hunt.running ? hunt.prompt : '';
        hunt.error = m.state === 'error' ? (m.error ?? 'Copilot could not answer. Your message is still in the box.') : '';
        // The message is answered: gone from the box. A failed answer leaves it there.
        if (m.state === 'done') {
          hunt.prompt = '';
          hunt.reveal = m.card;
          hunt.showReply = true;
        }
      } else if (m.type === 'huntCreate') {
        hunt.results[m.id] = { state: m.state, text: m.text };
        if (m.state === 'done') {
          hunt.created = { ...hunt.created, [m.id]: m.text ?? '' };
          // The created card moves to the History; it opens there so the result and its chat are in view.
          hunt.tab = 'history';
          hunt.open[m.id] = true;
          hunt.reveal = m.id;
        }
      } else if (m.type === 'huntCreateAsk') {
        repaint();
        askCreate(m.ask);
        return;
      }
      repaint();
    },
  };
}
