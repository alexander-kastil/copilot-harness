// The overview page: header, kind tiles, three tabbed lists, a search box, and the cards below.
import { KINDS, type Kind } from '../shared/customizations';
import type { ChangedRow, OverviewState, RepoRow, SessionRow } from '../shared/overview';
import type { PaygState } from '../shared/payg';
import { el, fmtAgo, fmtCredits, fmtDate, fmtNum, icon, ms, plural, pressable, tag } from './dom';
import { showPage } from './pages';
import type { ElementEntry } from '../shared/element';
import { rowsOpenElement } from './element-page';
import { entryOf, GLOBAL_SCOPE, PLUGIN_SCOPE } from './harness-data';
import { showKind } from './kind-page';
import { sessionLabel } from '../shared/sessions';
import { huntButton } from './hunt';
import { rowsOpen } from './session-ui';
import { gridTable, type Column } from './tables';

const KIND_ICON: Record<Kind, string> = {
  instruction: 'book',
  stack: 'file-code',
  prompt: 'comment',
  agent: 'robot',
  skill: 'mortar-board',
  hook: 'zap',
  mcp: 'server',
  plugin: 'extensions',
  subagent: 'organization',
  tool: 'tools',
  agentic: 'type-hierarchy',
  ci: 'play-circle',
  env: 'vm',
  governance: 'shield',
  memory: 'lightbulb',
  deterministic: 'gear',
};

const SOURCE_ICON: Record<string, string> = {
  chatSessions: 'comment-discussion',
  debugLogs: 'debug',
  traceDb: 'database',
  cli: 'terminal',
};

const REPO_COLUMNS: [string, Kind, string][] = [
  ['General', 'instruction', '64px'],
  ['Stack', 'stack', '56px'],
  ['Prompts', 'prompt', '68px'],
  ['Agents', 'agent', '60px'],
  ['Skills', 'skill', '56px'],
  ['Scripted', 'deterministic', '64px'],
  ['Hooks', 'hook', '56px'],
  ['MCP', 'mcp', '52px'],
];

// The lists show as many rows as the panel's height holds, never fewer than this.
const MIN_ROWS = 10;

type TabId = 'sessions' | 'repos' | 'changed';

export interface Overview {
  root: HTMLElement;
  update(state: OverviewState): void;
  /** Sets the overview search box and redraws the list (used by the left nav). */
  setFilter(text: string): void;
  /** The PAYG models figures for the PAYG models tile. */
  setPayg(state: PaygState): void;
}

/** Hides the rows of the list that would end below the bottom of the page body; the table holds every row. */
function fitRows(body: HTMLElement, box: HTMLElement): void {
  const rows = [...box.querySelectorAll<HTMLElement>('.at-row:not(.at-head)')];
  rows.forEach((r) => (r.style.display = ''));
  const top = body.getBoundingClientRect().top - body.scrollTop;
  const limit = body.clientHeight - 12;
  const kept = Math.max(MIN_ROWS, rows.filter((r) => r.getBoundingClientRect().bottom - top <= limit).length);
  rows.forEach((r, i) => (r.style.display = i < kept ? '' : 'none'));
}

const sessionText = (s: SessionRow) => [s.title, s.sourceLabel, s.workspace, s.workspacePath, s.start ? fmtDate(ms(s.start)!) : '', s.models.join(' ')].filter(Boolean).join(' ').toLowerCase();
const repoText = (r: RepoRow) => `${r.name} ${r.path}`.toLowerCase();
const changedText = (c: ChangedRow) => `${c.name} ${KINDS[c.kind].label} ${c.scopeLabel}`.toLowerCase();

function sessionsTable(rows: SessionRow[]): HTMLElement {
  const cols: Column<SessionRow>[] = [
    { head: 'Session', track: 'minmax(160px, 3fr)', cls: 'at-name', cell: (s) => [icon(SOURCE_ICON[s.source] ?? 'comment'), el('span', { className: 'at-label' }, sessionLabel(s))], title: (s) => sessionLabel(s) },
    { head: 'Source', track: 'minmax(72px, 1fr)', muted: true, wide: true, cell: (s) => tag(s.sourceLabel), title: () => 'The source whose figures this row shows' },
    { head: 'Repository', track: 'minmax(84px, 1.4fr)', muted: true, cell: (s) => s.workspace ?? '', title: (s) => s.workspacePath },
    { head: 'Started', track: '120px', num: true, cell: (s) => (ms(s.start) ? fmtDate(ms(s.start)!) : '') },
    { head: 'Turns', track: '52px', num: true, wide: true, cell: (s) => String(s.turns) },
    { head: 'Models', track: 'minmax(80px, 1.2fr)', muted: true, wide: true, cell: (s) => s.models.join(', '), title: (s) => s.models.join(', ') },
    { head: 'Tokens', track: '64px', num: true, wide: true, cell: (s) => (s.tokens === undefined ? '' : fmtNum(s.tokens)), title: () => 'Input plus output tokens, from the source shown' },
    { head: 'Credits', track: '64px', num: true, cell: (s) => (s.credits === undefined ? '' : fmtCredits(s.credits)), title: () => 'AI credits (AIC) from the source shown; blank when no source carries them' },
  ];
  const table = rowsOpen(gridTable(cols, rows, 'Last sessions'), rows);
  const all = el('div', { className: 'row all-sessions', ...pressable(() => showPage('sessions')) }, icon('search'), el('span', { className: 'name' }, 'Search all sessions'), el('span', { className: 'desc' }, 'filters, model, repository and AI actions'));
  return el('div', {}, table, all);
}

function reposTable(rows: RepoRow[]): HTMLElement {
  const cols: Column<RepoRow>[] = [
    { head: 'Repository', track: 'minmax(76px, 1fr)', cls: 'at-name', cell: (r) => [icon('repo'), el('span', { className: 'at-label' }, r.name)], title: (r) => r.path },
    ...REPO_COLUMNS.map(([head, kind, track]): Column<RepoRow> => ({ head, track, num: true, wide: true, cell: (r) => String(r.counts[kind] ?? 0), title: (r) => `${r.counts[kind] ?? 0} ${KINDS[kind].label.toLowerCase()}` })),
    { head: 'Sessions 7d', track: '84px', num: true, low: true, cell: (r) => String(r.sessions7d), title: () => 'Sessions in the last 7 days, all sources' },
    { head: 'Credits 7d', track: '76px', num: true, low: true, cell: (r) => (r.credits7d === undefined ? '' : fmtCredits(r.credits7d)), title: () => 'AI credits over the last 7 days; blank when no session carries a figure' },
    { head: 'Last session', track: 'minmax(84px, 90px)', num: true, cell: (r) => (r.lastSession ? fmtAgo(ms(r.lastSession)) : 'none') },
  ];
  return gridTable(cols, rows, 'Repositories');
}

function changedTable(rows: ChangedRow[]): HTMLElement {
  const cols: Column<ChangedRow>[] = [
    { head: 'Name', track: 'minmax(100px, 2fr)', cls: 'at-name', cell: (c) => [icon(KIND_ICON[c.kind]), el('span', { className: 'at-label' }, c.name)], title: (c) => c.file },
    { head: 'Type', track: 'minmax(0, 1fr)', muted: true, wide: true, cell: (c) => KINDS[c.kind].label },
    { head: 'Scope', track: 'minmax(72px, 1fr)', muted: true, cell: (c) => tag(c.scopeLabel), title: (c) => c.scopeLabel },
    { head: 'Changed', track: '120px', num: true, cell: (c) => fmtDate(c.mtime) },
  ];
  const toEntry = (c: ChangedRow): ElementEntry =>
    entryOf(c.file) ?? {
      kind: c.kind,
      name: c.name,
      file: c.file,
      status: 'ok',
      readOnly: c.scope === 'plugin',
      scope: c.scope === 'workspace' ? c.scopeLabel : c.scope === 'plugin' ? PLUGIN_SCOPE : GLOBAL_SCOPE,
      scopeLabel: c.scope === 'plugin' ? 'Plugins' : c.scopeLabel,
    };
  return rowsOpenElement(gridTable(cols, rows, 'Recently changed'), rows, toEntry, { label: 'the overview', go: () => showPage('overview') });
}

export function createOverview(cardsHost: HTMLElement): Overview {
  let state: OverviewState | undefined;
  let tab: TabId = 'sessions';
  let filter = '';
  let paygModels = 0;
  let paygProviders = 0;

  const subtitle = el('div', { className: 'path meta' }, 'Reading...');
  const head = el('header', { className: 'main-head' }, el('span', { className: 'big' }, el('span', { className: 'logo logo-lg' })), el('div', { className: 'title' }, el('h1', {}, 'Copilot Harness'), subtitle));
  const tiles = el('div', { className: 'overview compact' });
  const tabsBox = el('div', { className: 'overview-tabs' });
  const list = el('div', { className: 'overview-list recent' });
  const input = el('input', { type: 'search', placeholder: 'Search the harness and sessions', 'aria-label': 'Search the harness and sessions' });
  const search = el('div', { className: 'overview-search' }, input);
  const body = el('div', { className: 'main-body' }, tiles, tabsBox, search, list, cardsHost);
  const root = el('section', { className: 'main' }, head, body);

  // The kind tiles, then the PAYG models tile: its press opens the PAYG models page.
  const drawTiles = () => {
    if (!state) return;
    tiles.replaceChildren(
      ...state.tiles.map((t) =>
        el(
          'div',
          { className: `tile press${t.count ? '' : ' zero'}`, title: `Open the ${t.label.toLowerCase()} page`, ...pressable(() => showKind(t.kind, GLOBAL_SCOPE, PLUGIN_SCOPE)) },
          el('span', { className: 'n' }, t.count),
          el('span', { className: 'l' }, icon(KIND_ICON[t.kind] ?? 'file'), t.label)
        )
      ),
      el(
        'div',
        { className: `tile press${paygModels ? '' : ' zero'}`, title: 'Open the PAYG models page', ...pressable(() => showPage('payg')) },
        el('span', { className: 'n' }, paygModels),
        el('span', { className: 'l' }, icon('credit-card'), 'PAYG models')
      ),
      el(
        'div',
        { className: `tile press${paygProviders ? '' : ' zero'}`, title: 'Open the providers page', ...pressable(() => showPage('providers')) },
        el('span', { className: 'n' }, paygProviders),
        el('span', { className: 'l' }, icon('server-environment'), 'Providers')
      )
    );
  };

  const drawTabs = () => {
    if (!state) return;
    const defs: [TabId, string, string, number?][] = [
      ['sessions', 'Last sessions', 'history'],
      ...(state.repos.length ? [['repos', 'Repositories', 'repo', state.repositories] as [TabId, string, string, number]] : []),
      ['changed', 'Recently changed', 'edit'],
    ];
    if (!defs.some((d) => d[0] === tab)) tab = 'sessions';
    const bar = el('div', { className: 'view-tabs', role: 'tablist', 'aria-label': 'Overview lists' });
    for (const [id, text, glyph, count] of defs) {
      const on = id === tab;
      bar.append(
        el(
          'button',
          {
            className: `view-tab${on ? ' active' : ''}`,
            role: 'tab',
            'aria-selected': on ? 'true' : 'false',
            tabindex: on ? '0' : '-1',
            onclick: () => {
              tab = id;
              drawTabs();
              drawList();
            },
            // The inactive tabs are out of the Tab order: the arrow keys move between them.
            onkeydown: (e: KeyboardEvent) => {
              const at = defs.findIndex((d) => d[0] === id);
              const to = e.key === 'ArrowRight' ? (at + 1) % defs.length : e.key === 'ArrowLeft' ? (at - 1 + defs.length) % defs.length : e.key === 'Home' ? 0 : e.key === 'End' ? defs.length - 1 : -1;
              if (to < 0) return;
              e.preventDefault();
              tab = defs[to][0];
              drawTabs();
              drawList();
              tabsBox.querySelector<HTMLElement>('[role=tab][aria-selected=true]')?.focus();
            },
          },
          icon(glyph),
          el('span', {}, text),
          count === undefined ? null : el('span', { className: 'tab-count' }, count)
        )
      );
    }
    tabsBox.replaceChildren(bar, huntButton());
  };

  const noMatch = (q: string, n: number) =>
    el(
      'div',
      { className: 'search-empty', role: 'status' },
      icon('search'),
      el('div', { className: 'se-title' }, `No match for "${q}"`),
      el('div', { className: 'se-hint' }, `Searched ${n} rows of this list. Try a shorter or different word.`)
    );

  const drawList = () => {
    if (!state) return;
    const q = filter.trim().toLowerCase();
    let table: HTMLElement | undefined;
    let empty = '';
    let total = 0;
    if (tab === 'sessions') {
      const rows = q ? state.sessions.filter((s) => sessionText(s).includes(q)) : state.sessions;
      total = state.sessions.length;
      if (rows.length) table = sessionsTable(rows);
      else empty = state.sessionsReady ? 'No Copilot session found on this machine yet.' : 'Reading the sessions...';
    } else if (tab === 'repos') {
      const rows = q ? state.repos.filter((r) => repoText(r).includes(q)) : state.repos;
      total = state.repos.length;
      if (rows.length) table = reposTable(rows);
      else empty = 'No repository found yet.';
    } else {
      const rows = q ? state.changed.filter((c) => changedText(c).includes(q)) : state.changed;
      total = state.changed.length;
      if (rows.length) table = changedTable(rows);
      else empty = 'No customization found.';
    }
    if (table) list.replaceChildren(table);
    else list.replaceChildren(q && total ? noMatch(filter.trim(), total) : el('div', { className: 'empty flush' }, empty));
    fit();
  };

  const fit = () => {
    if (!body.isConnected || filter.trim()) return;
    fitRows(body, list);
  };

  input.addEventListener('input', () => {
    filter = input.value;
    drawList();
  });
  new ResizeObserver(fit).observe(body);

  return {
    root,
    setFilter(text) {
      input.value = text;
      filter = text;
      drawList();
    },
    setPayg(paygState) {
      paygModels = paygState.models;
      paygProviders = paygState.providers.length;
      drawTiles();
    },
    update(next) {
      state = next;
      subtitle.textContent = `${plural(next.globalAssets, 'global asset')} · ${plural(next.repositories, 'repository')}`;
      drawTiles();
      drawTabs();
      drawList();
    },
  };
}
