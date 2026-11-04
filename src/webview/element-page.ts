// The element page: one customization as a page. Ported from Claude Harness's detail page: header with the kind chip,
// name, source chip and path; a command bar of Page, File and AI groups; a summary card; and the file as tabs
// (content with an outline, frontmatter, tools, applies to). Opened from a kind page, the nav, Recently changed or a search hit.
import { KINDS } from '../shared/customizations';
import type { ElementDetail, ElementEntry, ElementToWebview, UsedInDay, UsedInSession } from '../shared/element';
import { post } from './bridge';
import { el, fmtAgo, fmtDate, icon, ms, plural } from './dom';
import { gridTable } from './tables';
import { entryOf, kindIcon, kindSingular, PLUGIN_SCOPE } from './harness-data';
import { renderMarkdown } from './markdown';
import { showPage } from './pages';
import { cmd, cmdBar, cmdBox } from './cmd-bar';
import { aiGroup, askAi, prefs, rowsOpen, startAi } from './session-ui';
import { onMarkets } from './market-data';
import type { OpenAiInfo } from '../shared/skills';
import { pluginBox } from './plugin-actions';
import { askSkills } from './skills-ui';

export interface Back {
  label: string;
  go(): void;
}

export interface ElementPage {
  root: HTMLElement;
  update(file: string, detail?: ElementDetail, error?: string): void;
  /** The sessions that called the open skill, from the host. */
  usage(message: Extract<ElementToWebview, { type: 'elementUsage' }>): void;
}

type TabId = 'content' | 'fields' | 'tools' | 'applies' | 'used' | 'codex';

type Usage = Extract<ElementToWebview, { type: 'elementUsage' }>;
let usage: Usage | undefined;

const STATUS_TEXT: Record<string, string> = {
  ok: 'Valid',
  invalid: 'Invalid: the frontmatter or JSON does not parse, or a skill breaks the Agent Skills spec',
  incomplete: 'Incomplete: a required field is missing',
  unreadable: 'Unreadable',
  disabled: 'Disabled',
};

const fmtBytes = (n: number): string => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

const shortPath = (file: string): string => file.replace(/^[a-z]:\\users\\[^\\]+|^\/(?:home|Users)\/[^/]+/i, '~');

let entry: ElementEntry | undefined;
let detail: ElementDetail | undefined;
let error: string | undefined;
let back: Back | undefined;
let tab: TabId = 'content';
let redraw: (() => void) | undefined;

/** Opens the element page for an entry; `from` is where its Back button returns to (the overview when absent). */
export function showElement(next: ElementEntry, from?: Back): void {
  entry = entryOf(next.file) ?? next;
  detail = undefined;
  error = undefined;
  back = from;
  tab = 'content';
  redraw?.();
  post({ type: 'elementOpen', file: entry.file });
  usage = undefined;
  if (entry.kind === 'skill' || entry.kind === 'deterministic') post({ type: 'elementUsageOpen', name: entry.name });
  showPage('element');
}

/** Makes the body rows of a grid table open their element's page on a click or Enter. */
export function rowsOpenElement<R>(table: HTMLElement, rows: R[], entryFor: (row: R) => ElementEntry, from?: Back): HTMLElement {
  [...table.querySelectorAll<HTMLElement>('.at-row:not(.at-head)')].forEach((row, i) => {
    const go = () => showElement(entryFor(rows[i]), from);
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
}

function sourceChip(e: ElementEntry): HTMLElement {
  const [glyph, label, tip] =
    e.scope === PLUGIN_SCOPE ? ['extensions', e.pluginId?.split('@')[0] ?? 'Plugin', `Plugin ${e.pluginId ?? ''}`] : e.scope === 'global' ? ['globe', 'Global', 'Global\nYour user folders, for every repository.'] : ['repo', e.scopeLabel, e.scope];
  return el('span', { className: 'dh-source', title: tip }, icon(glyph), el('span', {}, label));
}

function pathLine(file: string): HTMLElement {
  const short = shortPath(file);
  const cut = Math.max(short.lastIndexOf('\\'), short.lastIndexOf('/'));
  const dir = (cut >= 0 ? short.slice(0, cut + 1) : '').split(/(?<=[\\/])/).flatMap((part, i) => (i ? [document.createElement('wbr'), part] : [part]));
  return el('div', { className: 'path', title: file }, el('span', { className: 'dir' }, ...dir), el('span', { className: 'file' }, cut >= 0 ? short.slice(cut + 1) : short));
}

const fact = (label: string, glyph: string, value: string, tip?: string): HTMLElement =>
  el('div', { className: 'dv-fact', title: tip }, el('span', { className: 'k' }, icon(glyph), label), el('span', { className: 'v' }, el('span', { className: 'ell' }, value)));

const card = (title: string, count: number | string | null, ...body: (Node | string | null)[]): HTMLElement =>
  el('div', { className: 'dv-card' }, el('div', { className: 'dv-card-head' }, el('span', { className: 'dv-card-title' }, title), count === null ? null : el('span', { className: 'dv-count' }, count)), ...body);

const weekday = (at: number) => new Date(at).toLocaleDateString([], { weekday: 'short' });

/** Calls per day for the last 7 days: one rounded bar per day, today last, each with the hover card of its day. */
function dayStrip(days: UsedInDay[]): HTMLElement {
  const max = Math.max(1, ...days.map((d) => d.n));
  const H = 40;
  const ns = 'http://www.w3.org/2000/svg';
  return el(
    'div',
    { className: 'us-strip', role: 'img', 'aria-label': `Uses in the last 7 days: ${days.map((d) => `${weekday(d.at)} ${d.n}`).join(', ')}` },
    days.map((d) => {
      const h = d.n ? Math.max(4, Math.round((d.n / max) * H)) : 2;
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('class', 'us-bars');
      svg.setAttribute('viewBox', `0 0 24 ${H}`);
      svg.setAttribute('aria-hidden', 'true');
      const rect = document.createElementNS(ns, 'rect');
      for (const [k, v] of Object.entries({ class: 'us-bar', x: 3, y: H - h, width: 18, height: h, rx: 3 })) rect.setAttribute(k, String(v));
      svg.append(rect);
      return el(
        'div',
        { className: `us-day${d.n ? '' : ' empty'}`, title: `${new Date(d.at).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}\n${d.n ? plural(d.n, 'use') : 'No use'}` },
        el('span', { className: 'us-n' }, d.n ? String(d.n) : ''),
        svg,
        el('span', { className: 'us-label' }, weekday(d.at))
      );
    })
  );
}

/** The Used in card of a skill: the Copilot CLI sessions that called it (skill.invoked events), newest first. */
function usedCard(e: ElementEntry): HTMLElement {
  const sessions = usage?.sessions;
  const host = el('div', { className: 'used-in' });
  const table = (rows: UsedInSession[]) =>
    rowsOpen(
      gridTable(
        [
          { head: 'Last used', track: '120px', muted: true, cell: (s: UsedInSession) => (ms(s.last) ? fmtDate(ms(s.last)!) : '') },
          { head: 'Repo', track: 'minmax(88px, 1.2fr)', muted: true, cell: (s: UsedInSession) => s.repository ?? '', title: (s: UsedInSession) => s.repository },
          { head: 'Session', track: 'minmax(100px, 3fr)', cls: 'at-name', cell: (s: UsedInSession) => [icon('comment-discussion'), el('span', { className: 'at-label' }, s.title ?? `Session ${s.id.slice(0, 8)}`)], title: (s: UsedInSession) => s.title },
          { head: 'Uses', track: '96px', num: true, cell: (s: UsedInSession) => plural(s.count, 'use') },
          {
            head: '',
            track: '58px',
            cell: (s: UsedInSession) =>
              aiGroup(
                'compact row-ai',
                el(
                  'button',
                  {
                    className: 'icon-btn row-act',
                    title: 'Analyze\nA new Copilot CLI in a terminal at the repository reads and explains this session. The session is not changed.',
                    'aria-label': 'Analyze this session',
                    onclick: (ev: Event) => {
                      ev.stopPropagation();
                      askAi(host, 'Analyze this session', 'Opens a new Copilot CLI in a terminal and asks it to read this session. It counts against your Copilot credits.', () => startAi('analyze', s.id, prefs.model), ev.currentTarget as HTMLElement);
                    },
                    onkeydown: (ev: Event) => ev.stopPropagation(),
                  },
                  icon('comment-discussion')
                )
              ) ?? '',
          },
        ],
        rows,
        'Sessions'
      ),
      rows
    );
  host.append(
    card(
      'Used in',
      usage?.ready ? sessions!.length : null,
      !usage || !usage.ready
        ? el('div', { className: 'dv-empty' }, 'Reading the sessions...')
        : !sessions!.length
          ? el('div', { className: 'dv-empty' }, `The skill ${e.name} was not called in any Copilot CLI session.`)
          : null,
      sessions?.length ? dayStrip(usage!.days) : null,
      sessions?.length ? table(sessions) : null
    )
  );
  return host;
}

const CODEX_NOTE = "policy.allow_implicit_invocation: false is Codex's counterpart of disable-model-invocation: the skill runs only when asked for by name.";

/** The facts a skill page adds: who loads its folder, where npx installed it from and its Codex policy. */
function skillFacts(d: ElementDetail): (HTMLElement | null)[] {
  const s = d.skill;
  if (!s) return [];
  const src = s.source;
  const from = src ? `${src.source}${src.sourceType ? ` (${src.sourceType})` : ''}` : '';
  const fromTip = src ? [src.sourceUrl ?? src.source, src.skillPath, src.updatedAt ? `Updated ${src.updatedAt}` : '', src.hash ? `Hash ${src.hash}` : ''].filter(Boolean).join('\n') : '';
  return [
    s.loadedBy.length ? fact('Loaded by', 'organization', s.loadedBy.join(', '), `Loaded by\n${s.loadedBy.join(', ')} read skills from this folder.`) : null,
    s.loadedBy.length && s.notReadBy.length ? fact('Not read by', 'circle-slash', s.notReadBy.join(', '), `Not read by\n${s.notReadBy.join(', ')} do not read skills from this folder.`) : null,
    src ? fact('Installed from', 'package', from, fromTip) : null,
    s.openai ? fact('Codex', 'file-code', s.openai.implicit ? 'agents/openai.yaml: Codex may pick it on its own' : 'agents/openai.yaml: only when asked for by name', CODEX_NOTE) : null,
  ];
}

/** The Codex tab: agents/openai.yaml of the skill folder, key by key. */
function codexCard(o: OpenAiInfo): HTMLElement {
  return card(
    'agents/openai.yaml',
    o.fields.length,
    el('div', { className: 'dv-notice' }, icon('info'), el('span', {}, `The file the Codex app reads for this skill. ${CODEX_NOTE}`)),
    o.fields.length ? el('div', { className: 'dv-facts' }, o.fields.map((f) => fact(f.key, 'symbol-field', f.value, f.value))) : el('div', { className: 'dv-empty' }, 'The file is empty or does not parse.')
  );
}

export function createElementPage(): ElementPage {
  const root = el('section', { className: 'main element-page' });

  const aiActions = (e: ElementEntry, body: HTMLElement): HTMLElement | null => {
    const file = !detail?.folder;
    const secret = e.kind === 'env' && /^\.env/i.test(e.file.split(/[\\/]/).pop() ?? '');
    const repo = e.scope !== 'global' && e.scope !== PLUGIN_SCOPE ? e.scope : undefined;
    const send = (action: 'edit' | 'try') => post({ type: 'elementAi', action, kind: e.kind, name: e.name, file: e.file, ...(repo ? { repo } : {}) });
    const tryable = e.kind === 'agent' || e.kind === 'subagent' || e.kind === 'skill' || e.kind === 'deterministic';
    return aiGroup(
      '',
      file && !e.readOnly && !secret && !e.url
        ? cmd('lightbulb-sparkle', 'Edit', `Edit\nA new Copilot CLI in a terminal reads this file, says what to improve and makes the changes you agree to.`, (ev) =>
            askAi(body, `Edit ${e.name}`, 'Opens a new Copilot CLI in a terminal and asks it to review this file. It counts against your Copilot credits.', () => send('edit'), ev.currentTarget as HTMLElement)
          )
        : null,
      tryable
        ? cmd('play', 'Try it', `Try it\nA new Copilot CLI in a terminal${e.kind === 'skill' || e.kind === 'deterministic' ? ` that runs /${e.name}` : ' started as this agent'}.`, (ev) =>
            askAi(body, `Try ${e.name}`, 'Opens a new Copilot CLI in a terminal. It counts against your Copilot credits.', () => send('try'), ev.currentTarget as HTMLElement)
          )
        : null
    );
  };

  // A skill npx skills installed: check and update it from its source, each after a confirm card.
  const skillBox = (e: ElementEntry): HTMLElement | null => {
    const src = detail?.file === e.file ? detail.skill?.source : undefined;
    if (!src) return null;
    const lock = { global: src.global, path: src.path, label: src.global ? 'your home folder' : src.path.split(/[\\/]/).pop() || src.path };
    return cmdBox(
      'Skills',
      cmd('refresh', 'Check for updates', 'Check for updates\nRuns npx skills check in a terminal, after you confirm. It changes nothing.', (ev) => askSkills(ev.currentTarget as HTMLElement, 'check', lock)),
      cmd('sync', 'Update', `Update ${e.name}\nRuns npx skills update ${e.name} in a terminal, after you confirm.`, (ev) => askSkills(ev.currentTarget as HTMLElement, 'update', lock, e.name))
    );
  };

  const head = (e: ElementEntry, body: HTMLElement): HTMLElement =>
    el(
      'header',
      { className: 'main-head detail-head' },
      el(
        'div',
        { className: 'title' },
        el(
          'div',
          { className: 'dh-line' },
          el('span', { className: 'dh-kind', title: kindSingular(e.kind) }, icon(kindIcon(e.kind)), el('span', {}, kindSingular(e.kind))),
          el('h1', { title: e.name }, el('span', { className: 'dh-name' }, e.name)),
          sourceChip(e)
        ),
        pathLine(e.file)
      ),
      cmdBar(
        cmdBox('Page', cmd('arrow-left', 'Back', `Back to ${back?.label ?? 'the overview'}`, () => (back ? back.go() : showPage('overview')))),
        e.url
          ? cmdBox('Web', cmd('link-external', 'Open on GitHub', `Open on GitHub\n${e.url}\nThe Copilot Memory settings of this repository, in your browser.`, () => post({ type: 'elementUrl', file: e.file, url: e.url! })))
          : cmdBox(
          'File',
          cmd('go-to-file', 'Open in editor', `Open in editor\nThe file in a VS Code editor tab${e.readOnly ? ', read-only: a plugin supplies it' : ''}.`, () => post({ type: 'navOpen', file: e.file, readOnly: e.readOnly })),
          cmd('folder-opened', 'Reveal', 'Reveal in File Explorer\nThe folder that holds the file.', () => post({ type: 'elementReveal', file: e.file }))
        ),
        pluginBox(e),
        skillBox(e),
        aiActions(e, body)
      )
    );

  const hero = (e: ElementEntry, d: ElementDetail): HTMLElement => {
    const field = (key: string) => d.fields.find((f) => f.key === key)?.value;
    const description = field('description');
    const facts = [
      fact('Scope', e.scope === PLUGIN_SCOPE ? 'extensions' : e.scope === 'global' ? 'globe' : 'repo', e.scope === PLUGIN_SCOPE ? (e.pluginId ?? 'Plugin') : e.scopeLabel, e.scope),
      fact('Status', e.status === 'ok' ? 'pass' : 'warning', STATUS_TEXT[e.status] ?? e.status),
      d.mtime ? fact('Changed', 'history', `${fmtDate(d.mtime)} · ${fmtAgo(d.mtime)}`) : null,
      d.bytes !== undefined ? fact('Size', 'file', fmtBytes(d.bytes)) : null,
      field('model') ? fact('Model', 'chip', field('model')!) : null,
      field('agent') ? fact('Agent', 'robot', field('agent')!) : null,
      d.tools.length ? fact('Tools', 'tools', plural(d.tools.length, 'tool')) : null,
      d.applyTo.length ? fact('Applies to', 'filter', d.applyTo.join(', ')) : null,
      d.agentsMd ? fact('Applies to', 'filter', d.agentsMd.appliesTo) : null,
      d.agentsMd?.vscode ? fact('VS Code chat', d.agentsMd.loaded ? 'pass' : 'warning', d.agentsMd.vscode, d.agentsMd.vscode) : null,
      d.agentsMd?.readBy ? fact('Read by', 'organization', d.agentsMd.readBy, d.agentsMd.readBy) : null,
      ...skillFacts(d),
      e.readOnly ? fact('Edit', 'lock', `Read-only: update the plugin ${e.pluginId ?? ''} to change it`.trim()) : null,
    ];
    return el(
      'div',
      { className: 'dv-hero' },
      el('div', { className: 'dv-kicker' }, kindSingular(e.kind), el('span', { className: 'dv-origin' }, e.scopeLabel)),
      description ? el('p', { className: 'dv-desc' }, description) : el('p', { className: 'dv-desc muted' }, KINDS[e.kind].markdown ? 'This file has no description.' : 'This kind has no description field.'),
      d.invalid ? el('div', { className: 'dv-notice warn' }, icon('warning'), el('span', {}, 'The frontmatter does not parse, so no field is shown.')) : null,
      d.skill?.problems.length ? el('div', { className: 'dv-notice warn' }, icon('warning'), el('span', {}, `This SKILL.md breaks the Agent Skills spec: ${d.skill.problems.join('; ')}.`)) : null,
      el('div', { className: 'dv-facts' }, facts)
    );
  };

  const contentTab = (e: ElementEntry, d: ElementDetail): HTMLElement => {
    if (d.folder) {
      return card('Files', d.entries?.length ?? 0, d.entries?.length ? el('div', { className: 'ref-list' }, d.entries.map((n) => el('div', { className: 'ref-row static' }, icon(n.endsWith('/') ? 'folder' : 'file'), el('span', { className: 'ref-name' }, n)))) : el('div', { className: 'dv-empty' }, 'The folder is empty.'));
    }
    if (!d.body && d.bytes !== undefined && e.kind === 'env' && /^\.env/i.test(e.file.split(/[\\/]/).pop() ?? '')) {
      return card('Content', null, el('div', { className: 'dv-empty' }, 'Not read: a .env style file can hold secrets.'));
    }
    if (e.url) return card('Content', null, el('div', { className: 'dv-empty' }, 'Copilot Memory is kept on GitHub: open it from the button above.'));
    if (!d.body) return card('Content', null, el('div', { className: 'dv-empty' }, d.mtime === undefined ? 'The file could not be read.' : 'The file is empty.'));
    const note = d.truncated ? el('div', { className: 'dv-notice' }, icon('info'), el('span', {}, 'Only the first 256 KB are shown.')) : null;
    if (!KINDS[e.kind].markdown && !/\.(md|mdx)$/i.test(e.file)) return card('Content', null, note, el('pre', { className: 'md-pre dv-code', tabindex: '0' }, d.body));
    const { node, headings } = renderMarkdown(d.body, { link: (href) => !/^https?:/i.test(href) });
    const list = headings.filter((h) => h.level <= 3);
    const top = list.length ? Math.min(...list.map((h) => h.level)) : 1;
    const outline =
      list.length >= 3
        ? card(
            'Outline',
            null,
            el(
              'nav',
              { className: 'dv-outline', 'aria-label': 'Outline' },
              list.map((h) => el('button', { type: 'button', className: `dv-outline-item depth-${h.level - top}`, onclick: () => document.getElementById(h.id)?.scrollIntoView({ block: 'start', behavior: 'smooth' }) }, h.text))
            )
          )
        : null;
    const doc = card('Instructions', null, note, node);
    return outline ? el('div', { className: 'dv-grid' }, el('div', { className: 'dv-main' }, doc), el('aside', { className: 'dv-side' }, outline)) : doc;
  };

  const tabs = (e: ElementEntry, d: ElementDetail): HTMLElement => {
    const defs: { id: TabId; label: string; glyph: string; count?: number; body: () => HTMLElement }[] = [
      { id: 'content', label: d.folder ? 'Files' : 'Content', glyph: 'book', body: () => contentTab(e, d) },
      ...(d.fields.length
        ? [{ id: 'fields' as const, label: 'Frontmatter', glyph: 'symbol-key', count: d.fields.length, body: () => card('Frontmatter', d.fields.length, el('div', { className: 'dv-facts' }, d.fields.map((f) => fact(f.key, 'symbol-field', f.value, f.value)))) }]
        : []),
      ...(d.tools.length
        ? [{ id: 'tools' as const, label: 'Tools', glyph: 'tools', count: d.tools.length, body: () => card('Tools', d.tools.length, el('div', { className: 'dv-chips' }, d.tools.map((t) => el('span', { className: 'dv-chip' }, icon('tools'), t)))) }]
        : []),
      ...(d.applyTo.length
        ? [{ id: 'applies' as const, label: 'Applies to', glyph: 'filter', count: d.applyTo.length, body: () => card('Applies to', d.applyTo.length, el('div', { className: 'ref-list' }, d.applyTo.map((g) => el('div', { className: 'ref-row static' }, icon('filter'), el('span', { className: 'ref-name' }, g))))) }]
        : []),
      ...(e.kind === 'skill' || e.kind === 'deterministic'
        ? [{ id: 'used' as const, label: 'Used in', glyph: 'history', count: usage?.ready ? usage.sessions.length : undefined, body: () => usedCard(e) }]
        : []),
      ...(d.skill?.openai
        ? [{ id: 'codex' as const, label: 'Codex', glyph: 'file-code', count: d.skill.openai.fields.length, body: () => codexCard(d.skill!.openai!) }]
        : []),
    ];
    if (!defs.some((t) => t.id === tab)) tab = 'content';
    const panel = el('div', { className: 'dv-panel', role: 'tabpanel' });
    const bar = el('div', { className: 'view-tabs', role: 'tablist', 'aria-label': `${kindSingular(e.kind)} views` });
    const draw = () => {
      bar.replaceChildren(
        ...defs.map((t) =>
          el(
            'button',
            {
              type: 'button',
              className: `view-tab${t.id === tab ? ' active' : ''}`,
              role: 'tab',
              'aria-selected': t.id === tab ? 'true' : 'false',
              onclick: () => {
                tab = t.id;
                draw();
              },
            },
            icon(t.glyph),
            el('span', {}, t.label),
            t.count === undefined ? null : el('span', { className: 'tab-count' }, t.count)
          )
        )
      );
      panel.replaceChildren(defs.find((t) => t.id === tab)!.body());
    };
    draw();
    return el('div', { className: 'recent dv-tabs' }, defs.length > 1 ? bar : null, panel);
  };

  redraw = () => {
    if (!entry) return;
    const e = entry;
    const body = el('div', { className: 'main-body' });
    if (error) body.append(el('div', { className: 'empty flush' }, error));
    else if (!detail) body.append(el('div', { className: 'empty flush' }, 'Reading the file...'));
    else body.append(el('div', { className: 'dv' }, hero(e, detail), tabs(e, detail)));
    root.replaceChildren(head(e, body), body);
  };

  // A plugin's commands follow its marketplace: after a sync, an enable or an uninstall the page draws again.
  onMarkets(() => {
    if (entry?.kind === 'plugin') redraw?.();
  });

  return {
    root,
    usage(message) {
      if (!entry || (entry.kind !== 'skill' && entry.kind !== 'deterministic') || message.name.toLowerCase() !== entry.name.toLowerCase()) return;
      usage = message;
      redraw?.();
    },
    update(file, next, err) {
      if (!entry || entry.file !== file) return;
      detail = next;
      error = err;
      redraw?.();
    },
  };
}
