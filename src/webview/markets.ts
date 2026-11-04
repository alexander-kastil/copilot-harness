// Marketplace health and a marketplace's own page. Ported from Claude Harness's pages.ts (renderMarkets, renderMarket):
// the marketplaces in two groups, the plugin table with its Installed, Latest and Sync columns, Sync plugin and Sync all,
// rename for a directory marketplace. Drawing (Draw with Claude) is not ported: this extension has no drawing feature.
import type { MarketHealth, MarketKind, MarketPlugin } from '../shared/markets';
import { cmd, cmdBar, cmdBox } from './cmd-bar';
import { el, icon, plural } from './dom';
import { showElement } from './element-page';
import { entryOf } from './harness-data';
import { renameMarket, syncAll, syncPlugin } from './market-ui';
import { aheadOf, clearNotice, getMarkets, getNotice, isBusy, marketOf, onMarkets, reload } from './market-data';
import { showPage } from './pages';
import { gridTable, type Column } from './tables';

export const SOURCE_ICONS: Record<MarketKind, string> = { github: 'github', git: 'source-control', directory: 'folder', url: 'globe', unknown: 'question' };
const SOURCE_TOKENS: Record<MarketKind, string> = { github: 'github', git: 'git', directory: 'local', url: 'url', unknown: 'unknown' };

export const sourceToken = (m: MarketHealth): string => SOURCE_TOKENS[m.kind] ?? m.kind;
const sourceName = (m: MarketHealth): string => {
  if (m.kind === 'directory') return m.source.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || m.source;
  if (m.kind === 'url' || m.kind === 'git') return m.source.replace(/^[a-z+]+:\/\//, '').replace(/\.git$/, '');
  return m.source;
};
/** The hover card of a source: its kind, the full source and where the catalog sits. */
export const sourceTip = (m: MarketHealth): string =>
  [`Source · ${sourceToken(m)}`, m.source, m.location && m.location !== m.source ? `Catalog at ${m.location}` : '', `Registered in ${m.where.join(' and ')}${m.builtin ? ' (included with Copilot CLI)' : ''}`].filter(Boolean).join('\n');

const stateTag = (word: string, tone: 'ok' | 'none'): HTMLElement => el('span', { className: `tag ${tone}` }, word);

let back: { label: string; go(): void } | undefined;
let current: string | undefined;
const folded = new Set<string>();
let redraw: (() => void) | undefined;

/** Opens a marketplace's page. `from` is where its Back button returns to (Marketplace health when absent). */
export function showMarket(name: string, from?: { label: string; go(): void }): void {
  current = name;
  back = from;
  redraw?.();
  showPage('marketplace');
}

export const currentMarket = (): string | undefined => current;

// The version and sync columns of a marketplace's plugins, on Marketplace health and on the marketplace's own page.
function syncCols(m: MarketHealth): Column<MarketPlugin>[] {
  const ahead = aheadOf(m).length;
  return [
    { head: 'Installed', track: 'minmax(64px, 1fr)', muted: true, cell: (p) => p.installed ?? '', title: (p) => (p.live ? 'Installed\nLoaded live from the marketplace folder: nothing is copied, so it is always at the source version.' : undefined) },
    ...(m.plugins.some((p) => p.source) ? [{ head: 'Latest', track: 'minmax(64px, 1fr)', muted: true, tip: 'Latest\nThe version the marketplace offers', cell: (p: MarketPlugin) => p.source ?? '' }] : []),
    {
      // One Sync column: a plugin that is ahead has its Sync plugin button, the others say where they stand; while one is ahead,
      // the header is Sync all, for every plugin that is.
      head: ahead
        ? el('button', { type: 'button', className: 'payg-btn secondary at-head-btn', title: `Sync all\nRefresh ${m.name} once, then update the ${plural(ahead, 'plugin')} whose source is ahead of the installed copy.`, onclick: (e: MouseEvent) => syncAll(e.currentTarget as HTMLElement, m) }, icon('sync'), 'Sync all')
        : 'Sync',
      track: ahead ? 'minmax(120px, 1fr)' : 'minmax(120px, 1fr)',
      muted: true,
      cell: (p) =>
        p.ahead
          ? el('button', { type: 'button', className: 'payg-btn secondary', title: `Sync plugin\nRefresh ${m.name} and update ${p.name} from ${p.installed} to ${p.source}.`, onclick: (e: MouseEvent) => (e.stopPropagation(), syncPlugin(e.currentTarget as HTMLElement, m, p)) }, icon('sync'), 'Sync plugin')
          : p.installed
            ? stateTag('current', 'ok')
            : stateTag('uninstalled', 'none'),
      title: (p) => (p.ahead ? undefined : `Sync · ${p.installed ? 'Up to date' : 'Not installed'}\n${p.installed ? 'The installed copy matches the source.' : 'The plugin is not installed.'}${p.enabled ? '\nEnabled' : ''}`),
    },
  ];
}

const opensPlugin = (m: MarketHealth, p: MarketPlugin) => (p.dir ? entryOf(p.dir) : undefined);

function pluginRows(table: HTMLElement, m: MarketHealth, rows: MarketPlugin[], from: { label: string; go(): void }): HTMLElement {
  // Only a row of a plugin the harness lists opens its page; the others stay plain.
  const open = rows.map((p) => opensPlugin(m, p));
  const rowEls = [...table.querySelectorAll<HTMLElement>('.at-row:not(.at-head)')];
  rowEls.forEach((row, i) => {
    const entry = open[i];
    if (!entry) return;
    const go = () => showElement(entry, from);
    row.classList.add('open');
    row.setAttribute('tabindex', '0');
    row.addEventListener('click', (ev) => {
      if (!(ev.target as HTMLElement).closest('button')) go();
    });
    row.addEventListener('keydown', (ev) => {
      if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === row) {
        ev.preventDefault();
        go();
      }
    });
  });
  return table;
}

function header(glyph: string, title: string, sub: string, ...boxes: (Node | null)[]): HTMLElement {
  return el(
    'header',
    { className: 'main-head detail-head' },
    el('div', { className: 'title' }, el('div', { className: 'dh-line' }, el('span', { className: 'dh-kind' }, icon(glyph)), el('h1', { title }, el('span', { className: 'dh-name' }, title))), el('div', { className: 'path' }, sub)),
    cmdBar(...boxes)
  );
}

function notice(): HTMLElement | null {
  if (isBusy()) return el('div', { className: 'dv-notice market-notice' }, icon('loading codicon-modifier-spin'), el('span', {}, 'Copilot CLI is working...'));
  const n = getNotice();
  if (!n) return null;
  return el('div', { className: `dv-notice market-notice${n.ok ? '' : ' warn'}` }, icon(n.ok ? 'pass' : 'warning'), el('span', {}, n.message), el('button', { type: 'button', className: 'icon-btn', title: 'Dismiss', 'aria-label': 'Dismiss', onclick: clearNotice }, icon('close')));
}

export interface MarketPages {
  health: HTMLElement;
  market: HTMLElement;
}

export function createMarketPages(): MarketPages {
  const health = el('section', { className: 'main market-health' });
  const market = el('section', { className: 'main market-page-root' });

  const group = (title: string, glyph: string, items: MarketHealth[]): Node[] => [
    ...(title ? [el('div', { className: 'group-label market-group' }, icon(glyph), title, el('span', { className: 'count' }, String(items.length)))] : []),
    ...items.map((m) => {
      const ahead = aheadOf(m).length;
      const fold = () => {
        folded.has(m.name) ? folded.delete(m.name) : folded.add(m.name);
        draw();
      };
      return el(
        'div',
        { className: 'recent market-card' },
        el(
          'div',
          { className: 'market-head', onclick: (e: MouseEvent) => ((e.target as HTMLElement).closest('button') ? undefined : fold()) },
          icon(folded.has(m.name) ? 'chevron-right' : 'chevron-down'),
          icon('package'),
          el('span', { className: 'label', role: 'button', tabindex: '0', 'aria-expanded': String(!folded.has(m.name)), onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fold(); } } }, m.name),
          el('span', { className: 'market-source', title: sourceTip(m) }, icon(SOURCE_ICONS[m.kind]), `${sourceToken(m)} · ${sourceName(m)}`),
          ahead ? el('span', { className: 'tag warn' }, `${ahead} ahead`) : null,
          el('span', { className: 'spacer' }),
          m.kind === 'directory' ? el('button', { type: 'button', className: 'payg-btn secondary', onclick: (e: MouseEvent) => renameMarket(e.currentTarget as HTMLElement, m, getMarkets() ?? []) }, icon('edit'), 'Rename...') : null
        ),
        folded.has(m.name)
          ? null
          : m.plugins.length
            ? pluginRows(
                gridTable<MarketPlugin>([{ head: 'Plugin', track: 'minmax(120px, 2fr)', cls: 'at-name', cell: (p) => [icon('extensions'), el('span', { className: 'at-label' }, p.name)] }, ...syncCols(m)], m.plugins, `Plugins of ${m.name}`),
                m,
                m.plugins,
                { label: 'Marketplace health', go: () => showPage('marketplaces') }
              )
            : el('div', { className: 'empty flush' }, 'None installed')
      );
    }),
  ];

  const drawHealth = () => {
    const list = getMarkets();
    const body = el('div', { className: 'main-body' });
    body.append(notice() ?? '');
    if (!list) body.append(el('div', { className: 'empty flush' }, 'Reading the marketplaces...'));
    else if (!list.length) body.append(el('div', { className: 'empty flush' }, 'No marketplace registered. Add one with the Add marketplace button.'));
    else {
      // The owner's own marketplaces, the directory sources on disk, come first as a group of their own.
      const local = list.filter((m) => m.kind === 'directory');
      const hosted = list.filter((m) => m.kind !== 'directory');
      body.append(...(local.length ? group('Local, on disk', 'folder', local) : []), ...(hosted.length ? group(local.length ? 'Hosted' : '', 'cloud', hosted) : []));
    }
    const anyOpen = !!list?.some((m) => !folded.has(m.name));
    health.replaceChildren(
      header(
        'package',
        'Marketplace health',
        list ? plural(list.length, 'marketplace') : 'Reading...',
        cmdBox(
          'Page',
          cmd('refresh', 'Reload', 'Reload\nReads the marketplaces again.', reload),
          list?.length
            ? cmd(anyOpen ? 'collapse-all' : 'expand-all', anyOpen ? 'Collapse all' : 'Expand all', `${anyOpen ? 'Collapse all' : 'Expand all'}\nFolds or opens the plugin table of every marketplace.`, () => {
                anyOpen ? list.forEach((m) => folded.add(m.name)) : folded.clear();
                draw();
              })
            : null
        )
      ),
      body
    );
  };

  const drawMarket = () => {
    const list = getMarkets();
    const m = current ? marketOf(current) : undefined;
    const body = el('div', { className: 'main-body' });
    body.append(notice() ?? '');
    if (!list) body.append(el('div', { className: 'empty flush' }, 'Reading the marketplace...'));
    else if (!m) body.append(el('div', { className: 'empty flush' }, `${current ?? 'This marketplace'} is not a registered marketplace any more.`));
    else {
      const from = { label: m.name, go: () => showMarket(m.name, back) };
      body.append(
        el(
          'div',
          { className: 'market-page' },
          el('div', { className: 'market-head' }, el('span', { className: 'market-source', title: sourceTip(m) }, icon(SOURCE_ICONS[m.kind]), `${sourceToken(m)} · ${sourceName(m)}`)),
          el('div', { className: 'group-label' }, plural(m.plugins.length, 'plugin')),
          m.plugins.length
            ? pluginRows(
                gridTable<MarketPlugin>(
                  [
                    { head: 'Plugin', track: 'minmax(140px, 2fr)', cls: 'at-name', cell: (p) => [icon(p.enabled ? 'pass-filled' : 'circle-large-outline'), el('span', { className: 'at-label' }, p.name)], title: (p) => `${p.name}\n${p.enabled ? 'Enabled' : p.installed ? 'Installed, disabled' : 'Not installed'}` },
                    ...(m.plugins.some((p) => p.description) ? [{ head: 'Description', track: 'minmax(100px, 3fr)', muted: true, wide: true, cell: (p: MarketPlugin) => p.description ?? '', title: (p: MarketPlugin) => p.description } as Column<MarketPlugin>] : []),
                    ...syncCols(m),
                  ],
                  m.plugins,
                  `Plugins of ${m.name}`
                ),
                m,
                m.plugins,
                from
              )
            : el('div', { className: 'empty flush' }, m.kind === 'directory' ? 'Its catalog lists no plugins.' : 'None installed from it, and Copilot keeps no copy of its catalog on disk.')
        )
      );
    }
    const installed = m ? m.plugins.filter((p) => p.installed).length : 0;
    const enabled = m ? m.plugins.filter((p) => p.enabled).length : 0;
    const ahead = m ? aheadOf(m).length : 0;
    market.replaceChildren(
      header(
        'package',
        current ?? '',
        m ? [plural(m.plugins.length, 'plugin'), installed ? `${installed} installed` : '', enabled ? `${enabled} enabled` : '', ahead ? `${ahead} ahead` : ''].filter(Boolean).join(' · ') : list ? 'Not registered' : 'Reading...',
        cmdBox(
          'Page',
          back ? cmd('arrow-left', 'Back', `Back to ${back.label}`, () => back!.go()) : cmd('arrow-left', 'Back', 'Back to Marketplace health', () => showPage('marketplaces')),
          cmd('refresh', 'Reload', 'Reload\nReads the marketplace again.', reload)
        ),
        m
          ? cmdBox(
              'Marketplace',
              m.kind === 'directory' ? cmd('edit', 'Rename marketplace...', 'Rename marketplace\nRenames a directory marketplace and re-registers its plugins. A github marketplace takes its name from its marketplace.json, so rename it at its source.', (e) => renameMarket(e.currentTarget as HTMLElement, m, list ?? [])) : null,
              ahead ? cmd('sync', `Sync ${plural(ahead, 'plugin')}`, `Sync ${plural(ahead, 'plugin')}\nRefresh ${m.name} once, then update every plugin whose source is ahead of the installed copy.`, (e) => syncAll(e.currentTarget as HTMLElement, m)) : null
            )
          : null
      ),
      body
    );
  };

  const draw = () => {
    drawHealth();
    drawMarket();
  };
  redraw = draw;
  onMarkets(draw);
  draw();
  return { health, market };
}
