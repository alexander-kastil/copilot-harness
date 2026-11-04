// The kind page: every element of one kind, with a search, filter chips, presets and facets, in one table per scope.
// Ported from Claude Harness's type page. Every kind of the KINDS table gets this page. A row opens the element page.
import type { Kind } from '../shared/customizations';
import type { ElementEntry } from '../shared/element';
import { el, icon, plural } from './dom';
import { showElement } from './element-page';
import { entriesOf, GLOBAL_SCOPE, kindIcon, kindLabel, kindSingular, onNavData, PLUGIN_SCOPE } from './harness-data';
import { showPage } from './pages';
import { cmd, cmdBar, cmdBox } from './cmd-bar';
import { highlight } from './session-ui';
import { gridTable, type Column } from './tables';

interface Facet {
  kind: string;
  value: string;
  label: string;
}

interface KindState {
  kind: Kind;
  query: string;
  facets: Facet[];
  open: boolean;
  active: number;
}

type Preset = [string, string, (e: ElementEntry) => boolean];

const PRESETS: Preset[] = [
  ['plugin', 'From plugins', (e) => e.scope === PLUGIN_SCOPE],
  ['repo', 'In repositories', (e) => e.scope !== PLUGIN_SCOPE && e.scope !== GLOBAL_SCOPE],
  ['attention', 'Needs attention', (e) => e.status === 'invalid' || e.status === 'incomplete' || e.status === 'unreadable'],
  ['disabled', 'Disabled', (e) => e.status === 'disabled'],
];

// [key, label, glyph, values of an entry, display name of a value]
const GROUPS: [string, string, string, (e: ElementEntry) => string[], (v: string, pool: ElementEntry[]) => string][] = [
  ['scope', 'Scope', 'repo', (e) => [e.scope], (v, pool) => pool.find((e) => e.scope === v)?.scopeLabel ?? v],
  ['plugin', 'Plugin', 'extensions', (e) => (e.pluginId ? [e.pluginId] : []), (v) => v],
  ['status', 'Status', 'pulse', (e) => [e.status], (v) => v],
];

const STATUS_WORD: Record<string, string> = { ok: 'Valid', invalid: 'Invalid', incomplete: 'Incomplete', unreadable: 'Unreadable', disabled: 'Disabled' };

const groupOf = (key: string) => GROUPS.find((g) => g[0] === key);
const valueName = (g: (typeof GROUPS)[number], v: string, pool: ElementEntry[]) => (g[0] === 'status' ? (STATUS_WORD[v] ?? v) : g[4](v, pool));

const textOf = (e: ElementEntry) => [e.name, e.scopeLabel, e.pluginId, STATUS_WORD[e.status], e.file].filter(Boolean).join(' ').toLowerCase();

function testOf(f: Facet): (e: ElementEntry) => boolean {
  if (f.kind === 'preset') return PRESETS.find((p) => p[0] === f.value)?.[2] ?? (() => true);
  const g = groupOf(f.kind);
  return (e) => !g || g[3](e).includes(f.value);
}

/** Facets of one group widen the list, facets of different groups and presets narrow it. */
export function filterEntries(list: ElementEntry[], q: string, facets: Facet[]): ElementEntry[] {
  const groups = new Map<string, ((e: ElementEntry) => boolean)[]>();
  for (const f of facets) {
    const key = f.kind === 'preset' ? `preset:${f.value}` : f.kind;
    groups.set(key, [...(groups.get(key) ?? []), testOf(f)]);
  }
  const tests = [...groups.values()];
  return list.filter((e) => tests.every((any) => any.some((t) => t(e))) && (!q || textOf(e).includes(q)));
}

const groupsIn = (list: ElementEntry[]) => GROUPS.filter((g) => (g[0] === 'scope' ? new Set(list.map((e) => e.scope)).size > 1 : list.some((e) => g[3](e).length)));

function facetValues(g: (typeof GROUPS)[number], pool: ElementEntry[]): (Facet & { n: number })[] {
  const counts = new Map<string, number>();
  for (const e of pool) for (const v of new Set(g[3](e))) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts]
    .map(([value, n]) => ({ kind: g[0], value, label: `${g[1]}: ${valueName(g, value, pool)}`, n }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
}

type Suggestion = (Facet & { n: number; what: 'facet' }) | { what: 'group'; g: (typeof GROUPS)[number]; label: string; n: number } | { what: 'item'; e: ElementEntry; label: string };

function suggestions(entries: ElementEntry[], q: string, facets: Facet[]): Suggestion[] {
  const has = (f: Facet) => facets.some((x) => x.kind === f.kind && x.value === f.value);
  const groups = groupsIn(entries);
  const pool = filterEntries(entries, '', facets);
  const m = /^([a-z ]+):\s*(.*)$/.exec(q);
  const gq = m && groups.find((g) => g[1].toLowerCase() === m[1].trim());
  if (gq) return facetValues(gq, pool).filter((f) => !has(f) && f.label.toLowerCase().includes((m as RegExpExecArray)[2].trim())).map((f) => ({ ...f, what: 'facet' as const }));
  const counted = filterEntries(entries, q, facets);
  const presets = PRESETS.map(([value, label, test]) => ({ kind: 'preset', value, label, n: counted.filter(test).length, what: 'facet' as const })).filter((f) => f.n > 0 && !has(f) && (!q || f.label.toLowerCase().includes(q)));
  const openers = groups.map((g) => ({ what: 'group' as const, g, label: `${g[1]}:`, n: facetValues(g, pool).length })).filter((f) => f.n > 0 && (!q || f.g[1].toLowerCase().startsWith(q)));
  if (!q) return [...presets, ...openers];
  const values = groups.flatMap((g) => facetValues(g, pool)).filter((f) => !has(f) && f.label.toLowerCase().includes(q)).map((f) => ({ ...f, what: 'facet' as const }));
  const items = pool.filter((e) => e.name.toLowerCase().includes(q)).slice(0, 5).map((e) => ({ what: 'item' as const, e, label: e.name }));
  return [...openers, ...presets.slice(0, 3), ...values.slice(0, 6), ...items];
}

let current: KindState | undefined;
let redraw: (() => void) | undefined;

/** Opens the kind page. From the Overview a tile lists the Global scope; the Scope chip widens it. */
export function showKind(kind: Kind, ...scopes: string[]): void {
  const entries = entriesOf(kind);
  const facets = scopes.flatMap((scope): Facet[] => {
    const label = entries.find((e) => e.scope === scope)?.scopeLabel;
    return label ? [{ kind: 'scope', value: scope, label: `Scope: ${label}` }] : [];
  });
  current = { kind, query: '', facets, open: false, active: 0 };
  redraw?.();
  showPage('kind');
}

export interface KindPage {
  root: HTMLElement;
}

export function createKindPage(): KindPage {
  const root = el('section', { className: 'main kind-page' });
  const folded = new Set<string>();

  redraw = () => {
    const p = current;
    if (!p) return;
    const entries = entriesOf(p.kind);
    const lower = kindLabel(p.kind).toLowerCase();
    const results = el('div', { className: 'kind-results' });
    const filters = el('div', { className: 'filter-bar' });
    const suggest = el('div', { className: 'suggest', role: 'listbox', id: 'kind-suggest', hidden: true });
    const hint = groupsIn(entries).find((g) => g[0] !== 'scope');
    const input = el('input', {
      type: 'search',
      id: 'kind-search',
      placeholder: `Search ${lower} by name${hint ? `, or type ${hint[1].toLowerCase()}: to filter` : ''}`,
      value: p.query,
      autocomplete: 'off',
      spellcheck: 'false',
      role: 'combobox',
      'aria-label': `Search ${lower}`,
      'aria-expanded': 'false',
      'aria-controls': 'kind-suggest',
    });
    let items: Suggestion[] = [];
    const q = () => p.query.trim().toLowerCase();
    const textQ = () => (/^[a-z ]+:/.test(q()) && groupsIn(entries).some((g) => q().startsWith(`${g[1].toLowerCase()}:`)) ? '' : q());
    const same = (a: Facet, b: Facet) => a.kind === b.kind && a.value === b.value;
    const has = (f: Facet) => p.facets.some((x) => same(x, f));
    const toggle = (f: Facet) => {
      p.facets = has(f) ? p.facets.filter((x) => !same(x, f)) : [...p.facets, { kind: f.kind, value: f.value, label: f.label }];
      update();
    };
    const back = {
      label: kindLabel(p.kind),
      go: () => {
        current = p;
        redraw?.();
        showPage('kind');
      },
    };

    const columns = (list: ElementEntry[], scoped: boolean): Column<ElementEntry>[] => [
      { head: kindSingular(p.kind), track: 'minmax(140px, 2fr)', cls: 'at-name', cell: (e) => [icon(kindIcon(p.kind)), el('span', { className: 'at-label' }, highlight(e.name, textQ()))], title: (e) => e.name },
      ...(scoped ? [{ head: 'Scope', track: 'minmax(80px, 1fr)', muted: true, cell: (e: ElementEntry) => e.scopeLabel, title: (e: ElementEntry) => e.scope } as Column<ElementEntry>] : []),
      ...(list.some((e) => e.pluginId) ? [{ head: 'Plugin', track: 'minmax(80px, 1.2fr)', muted: true, wide: true, cell: (e: ElementEntry) => e.pluginId ?? '', title: (e: ElementEntry) => e.pluginId } as Column<ElementEntry>] : []),
      { head: 'Status', track: '96px', muted: true, cell: (e) => (e.readOnly && e.status === 'ok' ? 'Read-only' : (STATUS_WORD[e.status] ?? e.status)), title: (e) => (e.readOnly ? `Read-only: supplied by ${e.pluginId ?? 'a plugin'}` : undefined) },
      { head: 'File', track: 'minmax(120px, 3fr)', muted: true, wide: true, cell: (e) => e.file.split(/[\\/]/).slice(-2).join('/'), title: (e) => e.file },
    ];

    const openRows = (table: HTMLElement, rows: ElementEntry[]) => {
      const body = [...table.querySelectorAll<HTMLElement>('.at-row:not(.at-head)')];
      body.forEach((row, i) => {
        const go = () => showElement(rows[i], back);
        row.classList.add('open');
        row.setAttribute('tabindex', '0');
        row.addEventListener('click', go);
        row.addEventListener('keydown', (ev) => {
          if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === row) {
            ev.preventDefault();
            go();
          }
        });
      });
      return table;
    };

    const drawResults = () => {
      const hits = filterEntries(entries, textQ(), p.facets);
      const scopes = new Map<string, ElementEntry[]>();
      for (const e of hits) scopes.set(e.scope, [...(scopes.get(e.scope) ?? []), e]);
      const order = [...scopes.keys()].sort((a, b) => (a === GLOBAL_SCOPE ? -1 : b === GLOBAL_SCOPE ? 1 : a === PLUGIN_SCOPE ? 1 : b === PLUGIN_SCOPE ? -1 : 0));
      const body =
        order.length > 1
          ? order.map((scope) => {
              const list = scopes.get(scope)!;
              const key = `${p.kind}|${scope}`;
              const isFolded = folded.has(key);
              const glyph = scope === GLOBAL_SCOPE ? 'globe' : scope === PLUGIN_SCOPE ? 'extensions' : 'repo';
              const head = el(
                'div',
                {
                  className: 'origin-label',
                  role: 'button',
                  tabindex: '0',
                  'aria-expanded': String(!isFolded),
                  onclick: () => {
                    isFolded ? folded.delete(key) : folded.add(key);
                    drawResults();
                  },
                },
                icon(isFolded ? 'chevron-right' : 'chevron-down'),
                icon(glyph),
                el('span', { className: 'label', title: scope }, list[0].scopeLabel),
                el('span', { className: 'origin-n' }, list.length)
              );
              return el('div', { className: 'origin-section' }, head, isFolded ? null : openRows(gridTable(columns(list, false), list, list[0].scopeLabel), list));
            })
          : hits.length
            ? [openRows(gridTable(columns(hits, false), hits, kindLabel(p.kind)), hits)]
            : [];
      results.replaceChildren(
        el('div', { className: 'group-label' }, hits.length === entries.length ? `${entries.length} ${lower}` : `${hits.length} of ${entries.length} ${lower}`),
        ...(hits.length ? body : [el('div', { className: 'empty flush' }, entries.length ? 'Nothing matches. Press Esc to clear the search, then the filters.' : `No ${lower} found yet.`)])
      );
    };

    const drawFilters = () => {
      const chips = p.facets
        .filter((f) => f.kind !== 'preset')
        .map((f) =>
          el(
            'button',
            { className: 'chip', title: `Remove the filter ${f.label}`, onclick: () => (toggle(f), input.focus()) },
            icon(groupOf(f.kind)?.[2] ?? 'filter'),
            el('span', {}, f.label),
            icon('close')
          )
        );
      const presets = PRESETS.map(([value, label, test]) => {
        const f: Facet = { kind: 'preset', value, label };
        const on = has(f);
        const n = filterEntries(entries, textQ(), p.facets.filter((x) => !same(x, f))).filter(test).length;
        return on || n ? el('button', { className: `preset${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false', onclick: () => toggle(f) }, el('span', {}, label), el('span', { className: 'preset-n' }, n)) : null;
      });
      const openers = groupsIn(entries).map((g) =>
        el('button', { className: 'filter-add', 'aria-label': `Filter by ${g[1].toLowerCase()}`, onclick: () => openGroup(g) }, icon('add'), g[1])
      );
      const on = el('span', { className: 'filter-on', title: p.facets.map((f) => f.label).join(', ') }, `${p.facets.length} filters on`);
      filters.replaceChildren(...[p.facets.length > 1 ? on : null, chips, presets, openers.length ? el('span', { className: 'filter-sep', 'aria-hidden': 'true' }) : null, openers].flat().filter(Boolean) as Node[]);
    };

    const drawSuggest = () => {
      items = suggestions(entries, q(), p.facets);
      if (p.active >= items.length) p.active = 0;
      suggest.replaceChildren(
        ...items.map((it, i) =>
          el(
            'div',
            {
              className: `suggest-item${i === p.active ? ' active' : ''}`,
              role: 'option',
              id: `kind-suggest-${i}`,
              'aria-selected': i === p.active ? 'true' : 'false',
              onmousedown: (ev: Event) => {
                ev.preventDefault();
                pick(it);
              },
            },
            icon(it.what === 'item' ? kindIcon(p.kind) : it.what === 'group' ? it.g[2] : (groupOf(it.kind)?.[2] ?? 'filter')),
            el('span', { className: 'name' }, it.what === 'item' ? highlight(it.label, q()) : it.label),
            el('span', { className: 'desc' }, it.what === 'item' ? 'Open' : it.what === 'group' ? plural(it.n, 'value') : `${it.n} ${it.n === 1 ? kindSingular(p.kind).toLowerCase() : lower}`)
          )
        )
      );
      const show = p.open && items.length > 0;
      suggest.hidden = !show;
      input.setAttribute('aria-expanded', show ? 'true' : 'false');
    };

    const update = () => {
      drawFilters();
      drawResults();
      drawSuggest();
    };
    const openGroup = (g: (typeof GROUPS)[number]) => {
      input.value = `${g[1].toLowerCase()}: `;
      p.query = input.value;
      p.open = true;
      p.active = 0;
      input.focus();
      update();
    };
    const pick = (it: Suggestion) => {
      if (it.what === 'item') return showElement(it.e, back);
      if (it.what === 'group') return openGroup(it.g);
      p.facets = [...p.facets, { kind: it.kind, value: it.value, label: it.label }];
      p.query = '';
      input.value = '';
      p.active = 0;
      update();
    };
    input.addEventListener('input', () => {
      p.query = input.value;
      p.open = true;
      p.active = 0;
      update();
    });
    input.addEventListener('focus', () => {
      p.open = true;
      drawSuggest();
    });
    input.addEventListener('blur', () => {
      p.open = false;
      drawSuggest();
    });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        if (p.query) {
          p.query = '';
          input.value = '';
        } else p.facets = [];
        p.active = 0;
        update();
      } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        p.open = true;
        if (items.length) p.active = (p.active + (ev.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
        drawSuggest();
      } else if (ev.key === 'Enter') {
        if (p.open && items[p.active]) {
          ev.preventDefault();
          pick(items[p.active]);
        }
      } else if (ev.key === 'Backspace' && !input.value && p.facets.length) {
        p.facets = p.facets.slice(0, -1);
        update();
      }
    });
    update();

    const scopeCount = new Set(entries.map((e) => e.scope)).size;
    root.replaceChildren(
      el(
        'header',
        { className: 'main-head detail-head' },
        el(
          'div',
          { className: 'title' },
          el('div', { className: 'dh-line' }, el('span', { className: 'dh-kind', title: `${kindLabel(p.kind)}\nThe kind of element this page lists.` }, icon(kindIcon(p.kind)), el('span', {}, 'Type')), el('h1', {}, kindLabel(p.kind))),
          el('div', { className: 'path meta' }, `${entries.length} in ${plural(scopeCount, 'scope')}`)
        ),
        cmdBar(cmdBox('Page', cmd('arrow-left', 'Back', 'Back to the overview', () => showPage('overview'))))
      ),
      el('div', { className: 'main-body' }, el('div', { className: 'kind-search' }, el('div', { className: 'combo' }, icon('search'), input, suggest), filters), results)
    );
  };

  onNavData(() => {
    // Redraw only while the page shows; typing in the search box is kept in `current`.
    if (!root.hidden && !root.contains(document.activeElement)) redraw?.();
  });

  return { root };
}
