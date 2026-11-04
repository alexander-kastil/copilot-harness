// The Sessions page: every Copilot session on this machine, a search with filter chips, and a row per session
// that opens its detail page. The Copilot counterpart of Claude Harness's sessions search.
import { durationOf, sessionLabel, type SessionListRow, type SessionsState } from '../shared/sessions';
import { post } from './bridge';
import { el, fmtCredits, fmtDate, icon, ms, plural } from './dom';
import { showPage } from './pages';
import { aiGroup, askAi, highlight, fmtDur, iconBtn, openSession, prefs, rowsOpen, startAi } from './session-ui';
import { gridTable, type Column } from './tables';

export interface SessionsPage {
  root: HTMLElement;
  update(state: SessionsState): void;
}

interface Facet {
  kind: 'state' | 'model' | 'source' | 'repo' | 'branch';
  value: string;
  label: string;
}

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

const STATE_FACETS: [string, string, (s: SessionListRow) => boolean][] = [
  ['today', 'Started today', (s) => { const t = ms(s.start); return t !== undefined && sameDay(t, Date.now()); }],
  ['agents', 'With subagents', (s) => s.subagents > 0],
  ['credits', 'With credits', (s) => s.credits !== undefined],
  ['resumable', 'Resumable in Copilot CLI', (s) => s.resumable],
];

const FACET_ICONS: Record<Facet['kind'], string> = { state: 'filter', model: 'chip', source: 'database', repo: 'repo', branch: 'git-branch' };

const SOURCE_ICON: Record<string, string> = { chatSessions: 'comment-discussion', debugLogs: 'debug', traceDb: 'database', cli: 'terminal' };

const facetTest = (f: Facet): ((s: SessionListRow) => boolean) => {
  switch (f.kind) {
    case 'model': return (s) => s.models.includes(f.value);
    case 'source': return (s) => s.sourceLabel === f.value;
    case 'repo': return (s) => s.repository === f.value;
    case 'branch': return (s) => s.branch === f.value;
    default: return STATE_FACETS.find((x) => x[0] === f.value)?.[2] ?? (() => true);
  }
};

const searchText = (s: SessionListRow) => [sessionLabel(s), s.repository, s.branch, s.sourceLabel, ...s.models, s.start ? fmtDate(ms(s.start)!) : ''].join(' ').toLowerCase();

export const filterSessions = (list: SessionListRow[], q: string, facets: Facet[]): SessionListRow[] =>
  list.filter((s) => facets.every((f) => facetTest(f)(s)) && (!q || searchText(s).includes(q)));

type Suggestion = { kind: 'facet'; facet: Facet; n: number } | { kind: 'session'; s: SessionListRow };

function suggestionsFor(list: SessionListRow[], q: string, facets: Facet[]): Suggestion[] {
  const has = (f: Facet) => facets.some((x) => x.kind === f.kind && x.value === f.value);
  const pool = filterSessions(list, '', facets);
  const distinct = (pick: (s: SessionListRow) => string[]) => [...new Set(pool.flatMap(pick).filter(Boolean))].sort();
  const all: Facet[] = [
    ...STATE_FACETS.map(([value, label]): Facet => ({ kind: 'state', value, label })),
    ...distinct((s) => [s.sourceLabel]).map((value): Facet => ({ kind: 'source', value, label: `Source: ${value}` })),
    ...distinct((s) => s.models).map((value): Facet => ({ kind: 'model', value, label: `Model: ${value}` })),
    ...distinct((s) => [s.repository ?? '']).map((value): Facet => ({ kind: 'repo', value, label: `Repository: ${value}` })),
    ...distinct((s) => [s.branch ?? '']).map((value): Facet => ({ kind: 'branch', value, label: `Branch: ${value}` })),
  ];
  const items: Suggestion[] = all
    .map((facet): Suggestion => ({ kind: 'facet', facet, n: pool.filter(facetTest(facet)).length }))
    .filter((x) => x.kind === 'facet' && x.n > 0 && !has(x.facet) && (!q || x.facet.label.toLowerCase().includes(q)));
  const hits: Suggestion[] = q ? pool.filter((s) => sessionLabel(s).toLowerCase().includes(q)).slice(0, 5).map((s): Suggestion => ({ kind: 'session', s })) : [];
  return [...items.slice(0, q ? 4 : 8), ...hits].slice(0, 11);
}

const durOf = (s: SessionListRow) => durationOf(s.start, s.end);

/** The session rows as a table; a click on a row opens its detail page, the button at its end analyzes it in Copilot CLI. */
export function sessionTable(list: SessionListRow[], label: string, host: HTMLElement, q = ''): HTMLElement {
  const cols: Column<SessionListRow>[] = [
    { head: 'Session', track: 'minmax(180px, 3fr)', cls: 'at-name', cell: (s) => [icon(SOURCE_ICON[s.source] ?? 'comment'), el('span', { className: 'at-label' }, highlight(sessionLabel(s), q))], title: (s) => `${sessionLabel(s)}\n${[s.repository, s.branch, s.start ? fmtDate(ms(s.start)!) : ''].filter(Boolean).join(' · ')}` },
    { head: 'Repository', track: 'minmax(84px, 1.2fr)', muted: true, cell: (s) => s.repository ?? '', title: (s) => s.workspacePath },
    { head: 'Branch', track: 'minmax(0, 1fr)', muted: true, wide: true, cell: (s) => s.branch ?? '' },
    { head: 'Started', track: '120px', num: true, cell: (s) => (ms(s.start) ? fmtDate(ms(s.start)!) : '') },
    { head: 'Duration', track: '76px', num: true, wide: true, cell: (s) => fmtDur(durOf(s)) },
    { head: 'Subagents', track: '76px', num: true, wide: true, cell: (s) => String(s.subagents) },
    { head: 'Credits', track: '64px', num: true, cell: (s) => (s.credits === undefined ? '' : fmtCredits(s.credits)), title: () => 'AI credits (AIC) from the source shown' },
    {
      head: '',
      track: '58px',
      cell: (s) =>
        aiGroup(
          'compact row-ai',
          el(
            'button',
            {
              className: 'icon-btn row-act',
              title: 'Analyze\nA new Copilot CLI in a terminal at the repository, asked to read this session and explain it. The session stays untouched.',
              'aria-label': 'Analyze this session',
              onclick: (e: Event) => {
                e.stopPropagation();
                askAi(host, 'Analyze this session', 'Opens a new Copilot CLI in a terminal and asks it to read this session. It counts against your Copilot credits.', () => startAi('analyze', s.id, prefs.model), e.currentTarget as HTMLElement);
              },
              onkeydown: (e: Event) => e.stopPropagation(),
            },
            icon('comment-discussion')
          )
        ) ?? '',
    },
  ];
  return rowsOpen(gridTable(cols, list, label), list);
}

export function createSessionsPage(): SessionsPage {
  let state: SessionsState = { sessions: [], models: [], ready: false, skipConfirm: false };
  let query = '';
  let facets: Facet[] = [];
  let open = false;
  let active = 0;
  let items: Suggestion[] = [];
  let focusPending = true;

  const input = el('input', {
    type: 'search',
    id: 'session-search',
    placeholder: 'Search sessions by name, repository, branch, model or date',
    autocomplete: 'off',
    spellcheck: 'false',
    role: 'combobox',
    'aria-label': 'Search sessions',
    'aria-expanded': 'false',
    'aria-controls': 'session-suggest',
    'aria-autocomplete': 'list',
  }) as HTMLInputElement;
  const suggest = el('div', { className: 'suggest', role: 'listbox', id: 'session-suggest', hidden: true });
  const chips = el('div', { className: 'chips', hidden: true });
  const results = el('div', { className: 'recent' });
  const subtitle = el('div', { className: 'path meta' }, 'Reading...');
  const back = iconBtn('arrow-left', 'Back to the overview', () => showPage('overview'));
  const reload = iconBtn('refresh', 'Read the sessions again', () => {
    post({ type: 'sessionsRefresh' });
  });
  const head = el('header', { className: 'main-head' }, icon('history'), el('div', { className: 'title' }, el('h1', {}, 'Sessions'), subtitle), back, reload);
  const body = el('div', { className: 'main-body' }, el('div', { className: 'session-search' }, el('div', { className: 'combo' }, icon('search'), input, suggest), chips), results);
  const root = el('section', { className: 'main sessions-page' }, head, body);
  const q = () => query.trim().toLowerCase();

  const drawResults = () => {
    if (!state.ready && !state.sessions.length) {
      results.replaceChildren(el('div', { className: 'empty flush' }, 'Reading the sessions...'));
      return;
    }
    const hits = filterSessions(state.sessions, q(), facets);
    results.replaceChildren(
      el('div', { className: 'group-label' }, q() || facets.length ? `${hits.length} of ${state.sessions.length} sessions` : plural(state.sessions.length, 'session')),
      hits.length ? sessionTable(hits, 'Sessions', results, q()) : el('div', { className: 'empty flush' }, 'No session matches. Esc clears the search.')
    );
  };
  const drawChips = () => {
    chips.replaceChildren(
      ...facets.map((f) =>
        el('button', { className: 'chip', title: `Remove the filter ${f.label}`, onclick: () => { facets = facets.filter((x) => x !== f); update(); input.focus(); } }, icon(FACET_ICONS[f.kind]), el('span', {}, f.label), icon('close'))
      )
    );
    chips.hidden = !facets.length;
  };
  const drawSuggest = () => {
    items = suggestionsFor(state.sessions, q(), facets);
    if (active >= items.length) active = 0;
    suggest.replaceChildren(
      ...items.map((it, i) =>
        el(
          'div',
          {
            className: `suggest-item${i === active ? ' active' : ''}`,
            role: 'option',
            id: `session-suggest-${i}`,
            'aria-selected': i === active ? 'true' : 'false',
            onmousedown: (e: Event) => {
              e.preventDefault();
              pick(it);
            },
          },
          it.kind === 'session' ? icon(SOURCE_ICON[it.s.source] ?? 'comment') : icon(FACET_ICONS[it.facet.kind]),
          el('span', { className: 'name' }, it.kind === 'session' ? highlight(sessionLabel(it.s), q()) : it.facet.label),
          el('span', { className: 'desc' }, it.kind === 'session' ? 'Open' : plural(it.n, 'session'))
        )
      )
    );
    const show = open && items.length > 0;
    suggest.hidden = !show;
    input.setAttribute('aria-expanded', show ? 'true' : 'false');
    if (show) input.setAttribute('aria-activedescendant', `session-suggest-${active}`);
    else input.removeAttribute('aria-activedescendant');
  };
  const update = () => {
    drawChips();
    drawResults();
    drawSuggest();
  };
  const pick = (it: Suggestion) => {
    if (it.kind === 'session') {
      openSession(it.s.id);
      return;
    }
    facets = [...facets, it.facet];
    query = '';
    input.value = '';
    active = 0;
    update();
  };
  const cancel = () => {
    query = '';
    facets = [];
    open = false;
    active = 0;
    input.value = '';
    update();
  };
  input.addEventListener('input', () => {
    query = input.value;
    open = true;
    active = 0;
    update();
  });
  input.addEventListener('blur', () => {
    open = false;
    drawSuggest();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      open = true;
      if (items.length) active = (active + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      drawSuggest();
    } else if (e.key === 'Enter') {
      if (open && items[active]) {
        e.preventDefault();
        pick(items[active]);
      }
    } else if (e.key === 'Backspace' && !input.value && facets.length) {
      facets = facets.slice(0, -1);
      update();
    }
  });
  new MutationObserver(() => {
    if (root.hidden) focusPending = true;
    else if (focusPending) {
      focusPending = false;
      requestAnimationFrame(() => input.focus());
    }
  }).observe(root, { attributes: true, attributeFilter: ['hidden'] });

  update();
  return {
    root,
    update(next) {
      state = next;
      prefs.skipConfirm = next.skipConfirm;
      prefs.models = next.models;
      subtitle.textContent = next.ready ? `${plural(next.sessions.length, 'session')} on this machine` : 'Reading...';
      update();
    },
  };
}
