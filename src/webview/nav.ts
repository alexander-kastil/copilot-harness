// The left nav: toolbar, search, tree and rail. Mounted by main.ts into the shell's nav column.
// Ported from Claude Harness's sidebar: a Copilot region (global kinds), a Repositories region (each repo with a Sessions
// child and its kinds), region and group folds, a rail with counts (Alt+Shift+B), a keyboard tree and persisted state.
import { KINDS, type Kind } from '../shared/customizations';
import type { NavGroup, NavItem, NavRepo, NavSaved, NavSession, NavState } from '../shared/nav';
import { activeEntry, railCount, railEntries, railFromSaved, revealEntry } from '../shared/nav-rail';
import { post } from './bridge';
import { el, fmtAgo, icon, ms, plural } from './dom';
import { focusedKey, navItems, treeItem, wireTree } from './nav-tree';
import type { Overview } from './overview';
import { currentPage, onPage, showPage } from './pages';
import { getMarkets, onMarkets } from './market-data';
import { currentMarket, showMarket, SOURCE_ICONS, sourceTip } from './markets';
import { aiGroup, openSession } from './session-ui';
import { showElement } from './element-page';
import { entryOf } from './harness-data';

export interface Nav {
  update(state: NavState): void;
}

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

const NAV_ID = 'nav-pane';
const NAV_KEYS = 'Alt+Shift+B';
const SESSIONS_SHOWN = 10;
const DAY = 864e5;

const startOfDay = () => new Date(new Date().toDateString()).getTime();
// [id, label, glyph, test on a start time]; a session lands in the first group that takes it.
const SESSION_DAYS: [string, string, string, (t: number) => boolean][] = [
  ['today', 'Today', 'calendar', (t) => t >= startOfDay()],
  ['yesterday', 'Yesterday', 'calendar', (t) => t >= startOfDay() - DAY],
  ['week', 'Previous 7 days', 'calendar', (t) => t >= startOfDay() - 7 * DAY],
  ['earlier', 'Earlier', 'history', () => true],
];

type Selection = { entry: string; key: string };

const iconBtn = (glyph: string, title: string, onclick: (e: MouseEvent) => void): HTMLButtonElement =>
  el('button', { type: 'button', className: 'icon-btn', title, 'aria-label': title, onclick }, icon(glyph));

const sessionTitle = (s: NavSession): string => s.title ?? `${s.sourceLabel} session ${s.id.slice(0, 8)}`;
const sessionWhen = (s: NavSession): string => fmtAgo(ms(s.end ?? s.start));
const itemMatches = (kind: Kind, i: NavItem, q: string): boolean => !q || `${i.name} ${KINDS[kind].label} ${i.pluginId ?? ''}`.toLowerCase().includes(q);
const total = (groups: NavGroup[]): number => groups.reduce((n, g) => n + g.items.length, 0);

export function createNav(host: HTMLElement, overview: Overview): Nav {
  const st = {
    filter: '',
    expanded: new Set<string>(),
    openRepos: new Set<string>(),
    foldedGroups: new Set<string>(),
    repoSort: 'recent' as 'recent' | 'name',
    navRail: false,
  };
  const allSessions = new Set<string>();
  let state: NavState | undefined;
  let applied = false;
  let sel: Selection | undefined;
  let railTarget: string | undefined;
  let hoverTimer: number | undefined;
  let hover: HTMLElement | undefined;

  const wide = window.matchMedia('(min-width: 641px)');

  const save = () => {
    const saved: NavSaved = {
      filter: st.filter,
      expanded: [...st.expanded],
      openRepos: [...st.openRepos],
      foldedGroups: [...st.foldedGroups],
      repoSort: st.repoSort,
      navRail: st.navRail,
    };
    post({ type: 'navSave', saved });
  };

  // ---- Frame: built once; render() refills the parts that change. ----
  const search = el('input', {
    type: 'search',
    placeholder: 'Search the harness',
    'aria-label': 'Search the harness',
    oninput: (e: Event) => {
      st.filter = (e.target as HTMLInputElement).value;
      save();
      render();
    },
  });
  const head = el('div', { className: 'sidebar-head' });
  const listSlot = el('div', { className: 'list-slot' });
  const full = el('div', { className: 'sidebar-full' }, head, el('div', { className: 'search' }, search), listSlot);
  let rail = el('nav', { className: 'rail' });
  const aside = el('aside', { className: 'sidebar', id: NAV_ID }, full, rail);
  host.append(aside);

  const syncRail = () => {
    const on = st.navRail && wide.matches;
    full.toggleAttribute('inert', on);
    rail.toggleAttribute('inert', !on);
  };

  function setRail(next: boolean, byMouse = false): void {
    const hadFocus = aside.contains(document.activeElement) && !byMouse;
    st.navRail = next;
    save();
    hideHover();
    host.classList.add('rail-anim');
    host.classList.toggle('rail-on', next);
    syncRail();
    document.querySelectorAll('.nav-toggle').forEach((b) => b.setAttribute('aria-expanded', next ? 'false' : 'true'));
    if (hadFocus && wide.matches) aside.querySelector<HTMLElement>(next ? '.rail .nav-toggle' : '.sidebar-full .nav-toggle')?.focus();
  }

  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyB') {
      e.preventDefault();
      setRail(!st.navRail);
    }
  });
  wide.addEventListener('change', syncRail);

  // The collapse button of the top bar and the expand button of the rail: one control, `aria-expanded` says which way it goes.
  const navToggle = (collapsed: boolean) => {
    const label = collapsed ? 'Expand navigation' : 'Collapse navigation';
    const b = iconBtn(collapsed ? 'layout-sidebar-left' : 'layout-sidebar-left-off', `${label}\n${NAV_KEYS}`, (e) => setRail(!collapsed, e.detail > 0));
    b.classList.add('nav-toggle');
    b.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    b.setAttribute('aria-controls', NAV_ID);
    b.setAttribute('aria-keyshortcuts', NAV_KEYS);
    return b;
  };

  const foldAllButton = () => {
    const keys = ['region|copilot', 'region|repos'];
    const anyOpen = keys.some((k) => !st.foldedGroups.has(k));
    return iconBtn(anyOpen ? 'collapse-all' : 'expand-all', anyOpen ? 'Collapse all' : 'Expand all', () => {
      for (const k of keys) anyOpen ? st.foldedGroups.add(k) : st.foldedGroups.delete(k);
      save();
      render();
    });
  };

  // The top bar's buttons: the page first, then the actions.
  const topActions = () => [
    iconBtn('home', 'Overview', () => {
      sel = undefined;
      overview.setFilter('');
      showOverview();
    }),
    foldAllButton(),
    iconBtn('refresh', 'Refresh', () => post({ type: 'navRefresh' })),
  ];

  // The overview is the page the nav opens for repositories and sessions.
  const showOverview = () => {
    showPage('overview');
    render();
  };

  // ---- Hover card of a repository. ----
  function hideHover(): void {
    window.clearTimeout(hoverTimer);
    hover?.remove();
    hover = undefined;
  }

  function showHover(repo: NavRepo, at: { x: number; y: number }): void {
    hover?.remove();
    const kinds = repo.groups.filter((g) => g.items.length);
    hover = el(
      'div',
      { className: 'nav-hover' },
      el('div', { className: 'nh-head' }, icon('repo'), el('span', { className: 'nh-name' }, repo.name), repo.open ? el('span', { className: 'nh-tag' }, 'this workspace') : null),
      el('div', { className: 'nh-path' }, repo.path),
      kinds.length
        ? el('div', { className: 'nh-grid' }, kinds.map((g) => el('div', { className: 'nh-stat' }, el('span', { className: 'nh-k' }, g.label), el('span', { className: 'nh-v' }, String(g.items.length)))))
        : el('div', { className: 'nh-text' }, 'No Copilot customization files yet.'),
      el('div', { className: 'nh-text' }, repo.sessions.length ? `${plural(repo.sessions.length, 'session')} - last ${fmtAgo(ms(repo.lastSession))}` : 'No session ran here yet.')
    );
    document.body.append(hover);
    hover.style.left = `${Math.max(8, Math.min(at.x + 12, window.innerWidth - hover.offsetWidth - 8))}px`;
    hover.style.top = `${Math.max(8, Math.min(at.y + 14, window.innerHeight - hover.offsetHeight - 8))}px`;
  }

  // ---- Tree parts. ----
  const groupHead = (cls: string, foldKey: string, folded: boolean, glyph: string, label: string, count: number) =>
    el(
      'div',
      {
        className: cls,
        onclick: () => {
          folded ? st.foldedGroups.delete(foldKey) : st.foldedGroups.add(foldKey);
          save();
          render();
        },
      },
      icon(folded ? 'chevron-right' : 'chevron-down'),
      icon(glyph),
      el('span', { className: 'label' }, label),
      el('span', { className: 'count' }, count)
    );

  function regionHead(key: string, glyph: string, label: string, title: string, tools: HTMLElement[], count: number): [boolean, HTMLElement] {
    const folded = st.foldedGroups.has(`region|${key}`) && !st.filter;
    const fold = () => {
      folded ? st.foldedGroups.delete(`region|${key}`) : st.foldedGroups.add(`region|${key}`);
      save();
      render();
    };
    const node = el(
      'div',
      { className: 'scope-head', title, onclick: (e: MouseEvent) => ((e.target as HTMLElement).closest('button') ? undefined : fold()) },
      icon(folded ? 'chevron-right' : 'chevron-down'),
      icon(glyph),
      el('span', { className: 'label' }, label),
      ...tools,
      el('span', { className: 'count' }, count)
    );
    return [folded, treeItem(node, `r|${key}`, 1, !folded, fold)];
  }

  function itemRow(item: NavItem, kind: Kind, entry: string, level: number, nested: boolean): HTMLElement {
    const selected = sel?.key === `r|${item.file}`;
    const lock = item.readOnly ? `Read-only: supplied by ${item.pluginId ?? 'a plugin'}` : '';
    const note = item.status !== 'ok' ? item.status : '';
    return treeItem(
      el(
        'div',
        {
          className: `row${nested ? ' nested' : ''}${selected ? ' selected' : ''}${item.status === 'disabled' ? ' disabled' : ''}`,
          title: [item.name, item.file, lock, note].filter(Boolean).join('\n'),
          onclick: () => {
            sel = { entry, key: `r|${item.file}` };
            showElement(entryOf(item.file) ?? { kind, name: item.name, file: item.file, status: item.status, readOnly: item.readOnly, scope: 'global', scopeLabel: 'Global', ...(item.pluginId ? { pluginId: item.pluginId } : {}) });
            render();
          },
        },
        icon(KIND_ICON[kind]),
        el('span', { className: 'name' }, item.name),
        item.pluginId || note ? el('span', { className: `desc${note && note !== 'disabled' ? ' warn' : ''}` }, [item.readOnly ? icon('lock') : null, item.pluginId ?? note]) : null
      ),
      `r|${item.file}`,
      level
    );
  }

  function renderGroups(list: HTMLElement, scope: string, groups: NavGroup[], q: string, nested: boolean): void {
    for (const g of groups) {
      const items = g.items.filter((i) => itemMatches(g.kind, i, q));
      if (!items.length && (q || nested)) continue;
      const key = `${scope}|${g.kind}`;
      const collapsed = !st.expanded.has(key) && !q;
      const fold = () => {
        collapsed ? st.expanded.add(key) : st.expanded.delete(key);
        save();
        render();
      };
      const entry = activeEntry({ kind: g.kind, scope }) ?? '';
      const head = el(
        'div',
        { className: `section-head${nested ? ' nested' : ''}${sel?.key === `s|${key}` ? ' selected' : ''}`, onclick: fold },
        el('span', { className: 'twistie' }, icon(collapsed ? 'chevron-right' : 'chevron-down')),
        el('span', { className: 'label' }, g.label),
        el('span', { className: 'count' }, items.length)
      );
      list.append(treeItem(head, `s|${key}`, nested ? 2 : 1, !collapsed, fold));
      if (collapsed) continue;
      if (!items.length) list.append(el('div', { className: 'empty' }, 'None'));
      list.append(...items.map((i) => itemRow(i, g.kind, entry, nested ? 3 : 2, nested)));
    }
  }

  function renderSessions(list: HTMLElement, repo: NavRepo, q: string): void {
    const all = repo.sessions.filter((s) => !q || sessionTitle(s).toLowerCase().includes(q));
    if (q && !all.length) return;
    const key = `${repo.path}|sessions`;
    const collapsed = !st.expanded.has(key) && !q;
    const fold = () => {
      collapsed ? st.expanded.add(key) : st.expanded.delete(key);
      save();
      render();
    };
    const head = el(
      'div',
      { className: 'section-head nested', onclick: fold },
      el('span', { className: 'twistie' }, icon(collapsed ? 'chevron-right' : 'chevron-down')),
      el('span', { className: 'label' }, 'Sessions'),
      iconBtn('search', 'Search sessions', (e) => {
        e.stopPropagation();
        openRepoInOverview(repo);
      }),
      el('span', { className: 'count' }, state?.sessionsReady ? all.length : '...')
    );
    list.append(treeItem(head, `s|${key}`, 2, !collapsed, fold));
    if (collapsed) return;
    if (!all.length) {
      list.append(el('div', { className: 'empty' }, state?.sessionsReady ? 'None' : 'Reading the sessions...'));
      return;
    }
    const shown = allSessions.has(repo.path) || q ? all : all.slice(0, SESSIONS_SHOWN);
    const dayOf = (s: NavSession) => SESSION_DAYS.find((d) => d[3](ms(s.start ?? s.end) ?? 0))![0];
    const groups = SESSION_DAYS.map(([id, label, glyph]) => ({ id, label, glyph, members: shown.filter((s) => dayOf(s) === id) })).filter((g) => g.members.length);
    const row = (s: NavSession) =>
      treeItem(
        el(
          'div',
          {
            className: `row nested${groups.length > 1 ? ' in-group' : ''}${sel?.key === `x|${repo.path}|${s.id}` ? ' selected' : ''}`,
            title: `${sessionTitle(s)}\n${s.sourceLabel}, ${sessionWhen(s)}`,
            onclick: () => {
              sel = { entry: activeEntry({ scope: repo.path }) ?? '', key: `x|${repo.path}|${s.id}` };
              openSession(s.id);
            },
          },
          icon('comment-discussion'),
          el('span', { className: 'name' }, sessionTitle(s)),
          el('span', { className: 'desc' }, sessionWhen(s))
        ),
        `x|${repo.path}|${s.id}`,
        groups.length > 1 ? 4 : 3
      );
    if (groups.length < 2) list.append(...shown.map(row));
    else {
      for (const g of groups) {
        const foldKey = `${key}|${g.id}`;
        const folded = st.foldedGroups.has(foldKey) && !q;
        list.append(treeItem(groupHead('origin-head nested', foldKey, folded, g.glyph, g.label, g.members.length), `g|${foldKey}`, 3, !folded));
        if (!folded) list.append(...g.members.map(row));
      }
    }
    if (all.length > shown.length)
      list.append(
        treeItem(
          el(
            'div',
            {
              className: 'row nested',
              onclick: () => {
                allSessions.add(repo.path);
                render();
              },
            },
            icon('ellipsis'),
            el('span', { className: 'name' }, `Show all ${all.length} sessions`)
          ),
          `m|${repo.path}`,
          3
        )
      );
  }

  function openRepoInOverview(repo: NavRepo): void {
    sel = { entry: activeEntry({ repo: repo.path }) ?? '', key: `p|${repo.path}` };
    overview.setFilter(repo.name);
    showOverview();
  }

  const repoCount = (repo: NavRepo, q: string): number => (q ? repo.groups.reduce((n, g) => n + g.items.filter((i) => itemMatches(g.kind, i, q)).length, 0) : total(repo.groups));

  function sortedRepos(q: string): NavRepo[] {
    const repos = (state?.repos ?? []).filter((r) => !q || r.name.toLowerCase().includes(q) || r.groups.some((g) => g.items.some((i) => itemMatches(g.kind, i, q))));
    return repos.sort((a, b) => Number(b.open) - Number(a.open) || (st.repoSort === 'recent' ? (ms(b.lastSession) ?? 0) - (ms(a.lastSession) ?? 0) : 0) || a.name.localeCompare(b.name));
  }

  function renderRepo(list: HTMLElement, repo: NavRepo, q: string): void {
    const open = st.openRepos.has(repo.path) || !!q;
    const count = repoCount(repo, q);
    const fold = () => {
      open ? st.openRepos.delete(repo.path) : st.openRepos.add(repo.path);
      save();
      render();
    };
    const head = el(
      'div',
      {
        className: `repo-head${sel?.key === `p|${repo.path}` ? ' selected' : ''}`,
        'aria-label': `${repo.name} ${count}, ${repo.path}`,
        onclick: () => {
          hideHover();
          open ? st.openRepos.delete(repo.path) : st.openRepos.add(repo.path);
          save();
          openRepoInOverview(repo);
        },
        onmouseenter: (e: MouseEvent) => {
          window.clearTimeout(hoverTimer);
          const at = { x: e.clientX, y: e.clientY };
          hoverTimer = window.setTimeout(() => showHover(repo, at), 350);
        },
        onmouseleave: hideHover,
      },
      icon(open ? 'chevron-down' : 'chevron-right'),
      icon('repo'),
      el('span', { className: 'label' }, repo.name),
      aiGroup(
        'compact',
        iconBtn('terminal', `Open Copilot in ${repo.name}`, (e) => {
          e.stopPropagation();
          post({ type: 'repoAi', path: repo.path });
        })
      ),
      el('span', { className: 'count' }, count)
    );
    list.append(treeItem(head, `p|${repo.path}`, 1, open, fold));
    if (!open) return;
    renderSessions(list, repo, q);
    renderGroups(list, repo.path, repo.groups, q, true);
  }

  // The marketplaces Copilot knows, under the global kinds. The head folds and opens Marketplace health, the way a kind head
  // opens its page; a row opens the marketplace's own page.
  function renderMarkets(list: HTMLElement, q: string): void {
    const all = (getMarkets() ?? []).filter((m) => !q || m.name.toLowerCase().includes(q) || m.plugins.some((p) => p.name.toLowerCase().includes(q)));
    if (q && !all.length) return;
    const key = 'global|markets';
    const collapsed = !st.expanded.has(key) && !q;
    const fold = () => {
      collapsed ? st.expanded.add(key) : st.expanded.delete(key);
      save();
      render();
    };
    const page = currentPage();
    const head = el(
      'div',
      {
        className: `section-head${page === 'marketplaces' ? ' selected' : ''}`,
        onclick: () => {
          fold();
          showPage('marketplaces');
        },
      },
      el('span', { className: 'twistie' }, icon(collapsed ? 'chevron-right' : 'chevron-down')),
      el('span', { className: 'label' }, 'Marketplaces'),
      el('span', { className: 'count' }, getMarkets() ? all.length : '...')
    );
    list.append(treeItem(head, `s|${key}`, 1, !collapsed, fold));
    if (collapsed) return;
    if (!all.length) {
      list.append(el('div', { className: 'empty' }, getMarkets() ? 'None' : 'Reading the marketplaces...'));
      return;
    }
    for (const m of all) {
      const ahead = m.plugins.filter((p) => p.ahead).length;
      list.append(
        treeItem(
          el(
            'div',
            { className: `row${page === 'marketplace' && currentMarket() === m.name ? ' selected' : ''}`, title: `${m.name}\n${sourceTip(m)}`, onclick: () => showMarket(m.name) },
            icon(SOURCE_ICONS[m.kind]),
            el('span', { className: 'name' }, m.name),
            el('span', { className: `desc${ahead ? ' warn' : ''}` }, `${plural(m.plugins.length, 'plugin')}${ahead ? ` · ${ahead} ahead` : ''}`)
          ),
          `k|${m.name}`,
          2
        )
      );
    }
  }

  function buildList(q: string): { list: HTMLElement; repos: NavRepo[]; globalGroups: NavGroup[] } {
    const list = el('div', { className: 'list', onscroll: hideHover });
    const globalGroups = state?.global ?? [];
    const [copilotFolded, copilotHead] = regionHead(
      'copilot',
      'copilot',
      'Copilot',
      'Copilot\nWhat every Copilot session loads, from your user profile, ~/.copilot, your home folders and installed plugins.',
      [],
      q ? globalGroups.reduce((n, g) => n + g.items.filter((i) => itemMatches(g.kind, i, q)).length, 0) : total(globalGroups)
    );
    list.append(copilotHead);
    if (!copilotFolded) {
      const block = el('div', { className: 'scope-block' });
      renderGroups(block, 'global', globalGroups, q, false);
      renderMarkets(block, q);
      list.append(block);
    }
    const repos = sortedRepos(q);
    const sortToggle = (id: 'recent' | 'name', glyph: string, title: string) => {
      const b = iconBtn(glyph, title, () => {
        if (st.repoSort === id) return;
        st.repoSort = id;
        save();
        render();
      });
      b.classList.add('toggle');
      b.classList.toggle('active', st.repoSort === id);
      b.setAttribute('aria-pressed', st.repoSort === id ? 'true' : 'false');
      return b;
    };
    const [reposFolded, reposHead] = regionHead(
      'repos',
      'github',
      'Repositories',
      '',
      [sortToggle('recent', 'history', 'Sort by last session'), sortToggle('name', 'case-sensitive', 'Sort A-Z'), iconBtn('repo-create', 'Add repo...', () => post({ type: 'navAddRepo' })), iconBtn('trash', 'Remove repo...', () => post({ type: 'navRemoveRepo' }))],
      repos.length
    );
    reposHead.removeAttribute('title');
    list.append(reposHead);
    if (!reposFolded) {
      repos.forEach((repo, i) => {
        if (i > 0 && repos[i - 1].open && !repo.open) list.append(el('div', { className: 'repo-separator' }));
        renderRepo(list, repo, q);
      });
      if (!repos.length) list.append(el('div', { className: 'empty' }, state ? 'None' : 'Reading...'));
    }
    wireTree(list);
    return { list, repos, globalGroups };
  }

  function renderRail(globalGroups: NavGroup[], repos: NavRepo[]): HTMLElement {
    const input = {
      copilot: { label: 'Copilot', count: total(globalGroups), groups: [...globalGroups.map((g) => ({ id: `global|${g.kind}`, label: g.label, glyph: KIND_ICON[g.kind], count: g.items.length })), { id: 'global|markets', label: 'Marketplaces', glyph: 'package', count: getMarkets()?.length ?? 0 }] },
      repos: { label: 'Repositories', count: repos.length, repos: repos.map((r) => ({ id: r.path, label: r.name, count: total(r.groups) })) },
      active: sel?.entry,
    };
    const noun = (id: string, count: number) => (id === 'region:repos' ? plural(count, 'repository') : plural(count, 'item')).replace(/^\d+ /, '');
    const button = (e: ReturnType<typeof railEntries>[number]) => {
      const b = el(
        'button',
        {
          type: 'button',
          className: `rail-btn${e.level === 0 ? ' region' : ''}${e.active ? ' active' : ''}`,
          title: `${e.label}\n${e.count} ${noun(e.id, e.count)}`,
          'aria-label': `${e.label}, ${e.count}`,
          'aria-current': e.active ? 'true' : undefined,
          onclick: () => {
            railTarget = revealEntry(e, st);
            save();
            setRail(false);
            render();
          },
        },
        icon(e.glyph),
        el('span', { className: 'rail-count', 'aria-hidden': 'true' }, railCount(e.count))
      );
      b.dataset.rail = e.id;
      return b;
    };
    const top = el('div', { className: 'rail-top' }, navToggle(true), topActions());
    top.querySelectorAll('button').forEach((b, i) => (b.dataset.rail = `top${i}`));
    return el('nav', { className: 'rail', 'aria-label': 'Copilot harness, collapsed' }, top, el('div', { className: 'rail-list' }, railEntries(input).map(button)));
  }

  // Scrolls the list so `row` is in view, below the sticky region head; a row out of view is centred.
  const scrollToRow = (list: HTMLElement, row: HTMLElement) => {
    const a = row.getBoundingClientRect();
    const b = list.getBoundingClientRect();
    const top = b.top + 34;
    const bottom = b.bottom - 6;
    if (a.top >= top && a.bottom <= bottom) return;
    list.scrollTop += a.top - top - Math.max(0, (bottom - top - a.height) / 2);
  };

  function render(): void {
    const q = st.filter.toLowerCase();
    const focused = document.activeElement?.closest?.('.sidebar .list [data-nav]') as HTMLElement | null;
    const refocus = focused?.dataset.nav ?? focusedKey();
    const hadTreeFocus = !!focused;
    const railFocus = (document.activeElement?.closest?.('.rail [data-rail]') as HTMLElement | null)?.dataset.rail;
    const scroll = listSlot.querySelector<HTMLElement>('.list')?.scrollTop ?? 0;

    const { list, repos, globalGroups } = buildList(q);
    head.replaceChildren(el('span', { className: 'nav-title' }, icon('copilot'), 'Copilot Harness'), el('span', { className: 'spacer' }), ...topActions(), navToggle(false));
    listSlot.replaceChildren(list);
    list.scrollTop = scroll;
    const next = renderRail(globalGroups, repos);
    rail.replaceWith(next);
    rail = next;
    if (search.value !== st.filter) search.value = st.filter;
    host.classList.toggle('rail-on', st.navRail);
    syncRail();

    queueMicrotask(() => {
      if (railTarget) {
        const target = navItems(list).find((n) => n.dataset.nav === railTarget);
        railTarget = undefined;
        if (target) {
          scrollToRow(list, target);
          target.focus({ preventScroll: true });
        }
      } else if (railFocus && (!document.activeElement || document.activeElement === document.body)) {
        const again = [...rail.querySelectorAll<HTMLElement>('[data-rail]')].find((b) => b.dataset.rail === railFocus);
        if (again && !rail.hasAttribute('inert')) again.focus({ preventScroll: true });
      } else if (hadTreeFocus && (!document.activeElement || document.activeElement === document.body)) {
        const again = navItems(list).find((n) => n.dataset.nav === refocus);
        again?.focus({ preventScroll: true });
      }
    });
  }

  function apply(saved: Partial<NavSaved>): void {
    st.filter = saved.filter ?? '';
    st.expanded = new Set(saved.expanded ?? []);
    st.openRepos = new Set(saved.openRepos ?? []);
    st.foldedGroups = new Set(saved.foldedGroups ?? []);
    st.repoSort = saved.repoSort === 'name' ? 'name' : 'recent';
    st.navRail = railFromSaved(saved);
  }

  // The nav marks a selection only while the overview is the page on show.
  onPage((id) => {
    if (id !== 'overview' && sel) {
      sel = undefined;
      render();
    } else if (id === 'marketplaces' || id === 'marketplace' || wasMarket) render();
    wasMarket = id === 'marketplaces' || id === 'marketplace';
  });
  let wasMarket = false;
  onMarkets(() => render());

  render();

  return {
    update(next: NavState): void {
      state = next;
      if (!applied && next.saved) {
        applied = true;
        apply(next.saved);
      }
      render();
    },
  };
}
