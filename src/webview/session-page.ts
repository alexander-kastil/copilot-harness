// The session detail page: credits and tokens, key figures, the subagent diagrams, the subagent card and the
// AI actions. The Copilot counterpart of Claude Harness's session page; it shows what Copilot's records hold.
import { cacheShare, delegatedShare, durationOf, peakParallel, sessionLabel, type SessionDetailData, type SessionSubagent } from '../shared/sessions';
import { BILLING_PLANS, USD_PER_CREDIT, billingFormat, type BillingPlan } from '../shared/billing';
import { currentPlan, pickPlan } from './billing';
import { post } from './bridge';
import { el, fmtCredits, fmtDate, fmtNum, icon, ms, plural } from './dom';
import { showPage } from './pages';
import { drawConcurrency, drawScatter, drawTimeline, spansOf, type Span } from './session-charts';
import { cmd, cmdBar, cmdBox } from './cmd-bar';
import { aiGroup, askAi, backTarget, fmtDur, modelPicker, prefs, setOpener, shortModel, startAi } from './session-ui';
import { gridTable, type Column } from './tables';
import type { SessionDetailData as Detail } from '../shared/sessions';

export interface SessionPage {
  root: HTMLElement;
  update(id: string, detail: Detail | undefined, error: string | undefined): void;
}

const VIEWS: [string, string, string, string][] = [
  ['timeline', 'Timeline', 'graph-line', 'When the main thread and each subagent ran.'],
  ['concurrency', 'Concurrency', 'pulse', 'How many subagents were busy at the same time.'],
  ['scatter', 'Scatter', 'graph-scatter', 'Every subagent by start time and tokens, sized by credits.'],
];

const pct = (v: number) => `${Math.round(v * 100)}%`;

function bar(parts: { label: string; value: number; tone: string }[], total: number, label: string, fmt: (n: number) => string): HTMLElement {
  const box = el('div', { className: 'cost-bar', role: 'img', 'aria-label': `${label}: ${parts.map((p) => `${p.label} ${fmt(p.value)}`).join(', ')}` });
  for (const p of parts) {
    if (p.value <= 0) continue;
    const seg = el('span', { className: `swatch cost-seg ${p.tone}`, title: `${p.label}: ${fmt(p.value)} (${Math.max(1, Math.round((p.value / total) * 100))}%)` });
    seg.style.width = `${(p.value / total) * 100}%`;
    box.append(seg);
  }
  return box;
}

const legend = (parts: { label: string; value: number; tone: string }[], total: number, fmt: (n: number) => string): HTMLElement =>
  el(
    'div',
    { className: 'cost-legend' },
    parts.filter((p) => p.value > 0).map((p) => el('span', { className: 'cost-item' }, el('span', { className: `swatch ${p.tone}` }), el('span', { className: 'cost-name' }, p.label), el('b', {}, fmt(p.value)), el('span', { className: 'cost-pct' }, `${Math.max(1, Math.round((p.value / total) * 100))}%`)))
  );

function costCard(d: SessionDetailData): HTMLElement {
  const credits = d.credits;
  const agentCredits = d.agents.reduce((n, a) => n + (a.credits ?? 0), 0);
  const who = [{ label: 'Main thread', tone: 'tone-main', value: Math.max(0, (credits ?? 0) - agentCredits) }, ...d.agents.filter((a) => (a.credits ?? 0) > 0).map((a, i) => ({ label: a.name ?? `Subagent ${i + 1}`, tone: `tone-${i % 6}`, value: a.credits ?? 0 }))];
  const t = d.tokenFigures;
  const input = t?.input ?? 0;
  const cached = Math.min(t?.cached ?? 0, input);
  const kinds = [
    { label: 'Cached input', tone: 'kind-cacheRead', value: cached },
    { label: 'Fresh input', tone: 'kind-input', value: input - cached },
    { label: 'Output', tone: 'kind-output', value: t?.output ?? 0 },
  ];
  const kindTotal = kinds.reduce((n, k) => n + k.value, 0);
  // A plan shows the session's credits as a share of its monthly allowance, pay as you go as dollars.
  const plan = currentPlan();
  const fmt = billingFormat(plan);
  const about = (p: BillingPlan) => (p.note ? `${p.label}\n${p.note}` : p.allowance ? `${p.label}\nShare of one monthly allowance of ${p.allowance.toLocaleString()} AI credits.` : `${p.label}\nThis session in dollars, at $${USD_PER_CREDIT} per AI credit, with no allowance.`);
  const switcher = cmdBox(
    'Billing',
    ...BILLING_PLANS.map((p) =>
      el(
        'button',
        {
          type: 'button',
          className: `view-tab dg-mode${p.id === plan.id ? ' active' : ''}`,
          'aria-pressed': p.id === plan.id ? 'true' : 'false',
          'aria-label': p.label,
          title: about(p),
          'data-mode': p.id,
          onclick: () => {
            pickPlan(p.id);
            card.replaceWith(costCard(d));
            document.querySelector<HTMLElement>(`.cost-card .dg-mode[data-mode="${p.id}"]`)?.focus();
          },
        },
        icon(p.glyph),
        el('span', {}, p.short ?? p.label)
      )
    )
  );
  const card = el(
    'div',
    { className: 'cost-card' },
    el('div', { className: 'cost-head' }, el('div', {}, el('div', { className: 'cost-k' }, plan.id === 'free' ? 'Credits (AIC), Free allowance not published' : plan.allowance ? 'Monthly allowance used' : 'Estimated cost'), el('div', { className: 'cost-v' }, credits === undefined ? 'not recorded' : fmt(credits))), switcher),
    credits !== undefined && credits > 0 ? el('div', { className: 'cost-row' }, el('div', { className: 'cost-label' }, 'Who spent it'), bar(who, credits, 'Cost by thread', fmt), legend(who, credits, fmt)) : el('div', { className: 'empty flush' }, 'No source of this session carries credits.'),
    kindTotal > 0 ? el('div', { className: 'cost-row' }, el('div', { className: 'cost-label' }, 'Tokens spent on'), bar(kinds, kindTotal, 'Tokens by kind', fmtNum), legend(kinds, kindTotal, fmtNum)) : null
  );
  return card;
}

function agentCard(a: SessionSubagent): HTMLElement {
  const t = a.tokens;
  const facts: [string, string][] = [
    ['Model', shortModel(a.model) || '-'],
    ['Started', ms(a.start) ? fmtDate(ms(a.start)!) : '-'],
    ['Duration', fmtDur(durationOf(a.start, a.end)) || '-'],
    ['Input', t?.input === undefined ? '-' : fmtNum(t.input)],
    ['Cached', t?.cached === undefined ? '-' : fmtNum(t.cached)],
    ['Output', t?.output === undefined ? '-' : fmtNum(t.output)],
    ['Credits', a.credits === undefined ? '-' : fmtCredits(a.credits)],
    ['Tool calls', a.toolCalls === undefined ? '-' : String(a.toolCalls)],
  ];
  return el(
    'div',
    { className: 'hc agent-detail' },
    el('div', { className: 'hc-head' }, el('span', { className: 'hc-type' }, 'Subagent'), el('span', { className: 'hc-name' }, a.name ?? a.id)),
    el('div', { className: 'dv-chips' }, facts.map(([k, v]) => el('span', { className: 'dv-chip' }, el('span', { className: 'k' }, k), v)))
  );
}

export function createSessionPage(): SessionPage {
  let id = '';
  let data: Detail | undefined;
  let error: string | undefined;
  let selected: string | undefined;
  let view = 'timeline';
  const root = el('section', { className: 'main session-page' });

  const load = () => {
    data = undefined;
    error = undefined;
    selected = undefined;
    draw();
  };
  setOpener((next) => {
    id = next;
    load();
  });

  function draw(): void {
    // The command bar: every command in a labelled box (Page, Files), the AI group last at the right end.
    const pageBox = cmdBox(
      'Page',
      cmd('arrow-left', 'Back', backTarget() === 'sessions' ? 'Back to the sessions' : 'Back to the overview', () => showPage(backTarget())),
      cmd('refresh', 'Reload', 'Read the session again', () => {
        load();
        post({ type: 'sessionOpen', id });
      })
    );
    if (!data) {
      root.replaceChildren(
        el('header', { className: 'main-head detail-head session-head' }, el('div', { className: 'title' }, el('h1', {}, 'Session'), el('div', { className: 'path meta' }, id.slice(0, 8))), cmdBar(pageBox)),
        el('div', { className: 'main-body' }, el('div', { className: 'empty flush' }, error ?? 'Reading the session...'))
      );
      return;
    }
    const d = data;
    const spans = spansOf(d.agents);
    const sub = [d.repository, d.start ? `${fmtDate(ms(d.start)!)}${ms(d.end) ? ` to ${new Date(ms(d.end)!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}` : '', fmtDur(durationOf(d.start, d.end)), d.branch, d.models.map(shortModel).join(', '), d.sources.join(' + ')].filter(Boolean).join(' · ');
    const cwd = d.workspacePath ? ` at ${d.workspacePath}` : '';
    const head = el(
      'header',
      { className: 'main-head detail-head session-head' },
      el('div', { className: 'title' }, el('h1', { title: sessionLabel(d) }, sessionLabel(d).replace(/\s+/g, ' ').slice(0, 140)), el('div', { className: 'path meta', title: d.workspacePath }, sub)),
      cmdBar(
        pageBox,
        cmdBox('Files', cmd('export', 'Export', 'Export the session files to a folder', () => post({ type: 'sessionExport', id }), !d.exportable)),
        cmdBox('Model', modelPicker()),
        aiGroup(
          '',
          cmd('comment-discussion', 'Analyze', `Analyze\nA new Copilot CLI in a terminal${cwd}, asked to read this session and explain it. The session itself stays untouched.`, (ev) =>
            askAi(root, 'Analyze this session', 'Opens a new Copilot CLI in a terminal and asks it to read this session. It counts against your Copilot credits.', () => startAi('analyze', d.id, prefs.model), ev.currentTarget as HTMLElement)
          ),
          cmd(
            'debug-continue',
            'Continue',
            d.resumable ? 'Continue session\nResumes this very session in Copilot CLI, in a terminal, so what you say is added to it. Analyze works on a read-only look instead.' : 'Continue session\nOnly sessions Copilot CLI wrote can be resumed.',
            (ev) => askAi(root, 'Continue this session', 'Resumes this session in Copilot CLI in a terminal. What you say there is added to the session and counts against your Copilot credits.', () => startAi('continue', d.id, prefs.model), ev.currentTarget as HTMLElement),
            !d.resumable
          )
        )
      )
    );

    const delegated = delegatedShare(d.credits, d.agents);
    const cache = cacheShare(d.tokenFigures);
    const kpis: [string, string, string, string][] = [
      [String(d.agents.length), 'Subagents', 'type-hierarchy-sub', d.agents.length ? 'started in this session' : 'none started'],
      [String(peakParallel(d.agents)), 'Peak parallel', 'layers', 'subagents at once'],
      [delegated === undefined ? '-' : pct(delegated), 'Delegated', 'arrow-swap', 'of credits in subagents'],
      [cache === undefined ? '-' : pct(cache), 'Cache hits', 'database', 'of input tokens'],
    ];

    const diagram = el('div', { className: 'timeline' });
    const detailSlot = el('div', { className: 'agent-slot' });
    const drawAgent = () => {
      const a = d.agents.find((x) => x.id === selected);
      detailSlot.replaceChildren(...(a ? [agentCard(a)] : [el('div', { className: 'empty flush' }, spans.length ? 'Press a subagent in the diagram to see its figures.' : '')]));
    };
    const pick = (aid: string) => {
      selected = selected === aid ? undefined : aid;
      drawDiagram();
      drawAgent();
    };
    const drawDiagram = () => {
      if (view === 'concurrency') drawConcurrency(diagram, d, spans);
      else if (view === 'scatter') drawScatter(diagram, d, spans, selected, pick);
      else drawTimeline(diagram, d, spans, selected, pick);
    };
    const tabs = el('div', { className: 'view-tabs', role: 'tablist', 'aria-label': 'Session views' });
    const buttons = VIEWS.map(([vid, label, glyph, about]) =>
      el('button', { className: 'view-tab', role: 'tab', 'data-view': vid, title: `${label}\n${about}`, 'aria-description': about, onclick: () => { view = vid; sync(); drawDiagram(); } }, icon(glyph), el('span', {}, label))
    );
    const sync = () =>
      buttons.forEach((b) => {
        const on = b.dataset.view === view;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    tabs.append(...buttons);
    sync();
    drawDiagram();
    drawAgent();

    // The AI actions live in the header command bar; only a plain muted line stays in the body.
    const askBox = d.snapshots ? el('div', { className: 'cp-hint' }, `Copilot CLI kept ${plural(d.snapshots, 'rewind snapshot')} for this session.`) : null;

    const cols: Column<SessionSubagent>[] = [
      { head: 'Subagent', track: 'minmax(140px, 2fr)', cls: 'at-name', cell: (a) => [icon('type-hierarchy-sub'), el('span', { className: 'at-label' }, a.name ?? a.id)], title: (a) => a.id },
      { head: 'Model', track: 'minmax(80px, 1.2fr)', muted: true, wide: true, cell: (a) => shortModel(a.model) },
      { head: 'Started', track: '120px', num: true, cell: (a) => (ms(a.start) ? fmtDate(ms(a.start)!) : '') },
      { head: 'Duration', track: '76px', num: true, cell: (a) => fmtDur(durationOf(a.start, a.end)) },
      { head: 'Tokens', track: '64px', num: true, wide: true, cell: (a) => (a.tokens && (a.tokens.input !== undefined || a.tokens.output !== undefined) ? fmtNum((a.tokens.input ?? 0) + (a.tokens.output ?? 0)) : '') },
      { head: 'Credits', track: '64px', num: true, cell: (a) => (a.credits === undefined ? '' : fmtCredits(a.credits)) },
    ];
    const table = d.agents.length ? gridTable(cols, d.agents, 'Subagents') : null;

    root.replaceChildren(
      head,
      el(
        'div',
        { className: 'main-body' },
        costCard(d),
        el('div', { className: 'kpis' }, kpis.map(([n, l, i, note]) => el('div', { className: 'tile static' }, el('span', { className: 'n' }, n), el('span', { className: 'l' }, icon(i), l), el('span', { className: 'kpi-note' }, note)))),
        askBox,
        el('div', { className: 'recent' }, el('div', { className: 'group-label' }, 'How the work ran'), tabs, el('div', { className: 'view-box' }, diagram)),
        detailSlot,
        table ? el('div', { className: 'recent' }, el('div', { className: 'group-label' }, `Subagents (${d.agents.length})`), table) : null
      )
    );
  }

  draw();
  return {
    root,
    update(forId, detail, err) {
      if (forId !== id) return;
      data = detail;
      error = err;
      draw();
    },
  };
}
