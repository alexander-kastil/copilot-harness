// The three diagrams of the session page, drawn as SVG from the subagent runs: Timeline, Concurrency, Scatter.
import type { SessionDetailData, SessionSubagent } from '../shared/sessions';
import { fmtDate, fmtNum, ms } from './dom';

const NS = 'http://www.w3.org/2000/svg';
type Attrs = Record<string, string | number>;

function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (SVGElement | string)[]): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  for (const kid of kids) node.append(kid);
  return node;
}

export interface Span {
  agent: SessionSubagent;
  from: number;
  to: number;
  label: string;
}

/** Runs with both times, in start order, named like their lane. */
export function spansOf(agents: SessionSubagent[]): Span[] {
  const out: Span[] = [];
  agents.forEach((agent, i) => {
    const from = ms(agent.start);
    const to = ms(agent.end);
    if (from === undefined || to === undefined) return;
    out.push({ agent, from, to: Math.max(from, to), label: agent.name ?? `Subagent ${i + 1}` });
  });
  return out.sort((a, b) => a.from - b.from);
}

/** The time window of the diagrams: the session, widened to every run. */
export function windowOf(d: SessionDetailData, spans: Span[]): { from: number; to: number } | undefined {
  const times = [ms(d.start), ms(d.end), ...spans.flatMap((x) => [x.from, x.to])].filter((t): t is number => t !== undefined);
  if (!times.length) return undefined;
  const from = Math.min(...times);
  const to = Math.max(...times);
  return { from, to: to > from ? to : from + 1000 };
}

const W = 900;
const PAD = { l: 140, r: 16, t: 14, b: 26 };

function axis(svg: SVGSVGElement, w: { from: number; to: number }, height: number): (t: number) => number {
  const x = (t: number) => PAD.l + ((t - w.from) / (w.to - w.from)) * (W - PAD.l - PAD.r);
  for (let i = 0; i <= 4; i++) {
    const t = w.from + ((w.to - w.from) * i) / 4;
    svg.append(
      s('line', { x1: x(t), x2: x(t), y1: PAD.t, y2: height - PAD.b, class: 'dg-grid' }),
      s('text', { x: x(t), y: height - 8, class: 'dg-tick', 'text-anchor': i === 0 ? 'start' : i === 4 ? 'end' : 'middle' }, fmtDate(t))
    );
  }
  return x;
}

const frame = (height: number): SVGSVGElement => s('svg', { viewBox: `0 0 ${W} ${height}`, class: 'dg-svg', role: 'img', width: '100%' }) as SVGSVGElement;

export function drawTimeline(host: HTMLElement, d: SessionDetailData, spans: Span[], selected: string | undefined, pick: (id: string) => void): void {
  const w = windowOf(d, spans);
  if (!w || !spans.length) {
    host.replaceChildren(empty('No subagent ran in this session, or the source gave no times for them.'));
    return;
  }
  const lane = 24;
  const height = PAD.t + PAD.b + lane * (spans.length + 1);
  const svg = frame(height);
  svg.setAttribute('aria-label', 'Timeline of the session and its subagents');
  const x = axis(svg, w, height);
  const main = { from: ms(d.start) ?? w.from, to: ms(d.end) ?? w.to };
  const row = (i: number, label: string, from: number, to: number, cls: string, id?: string, tip?: string) => {
    const y = PAD.t + i * lane;
    const g = s('g', { class: `tl-lane${id && id === selected ? ' sel' : ''}`, ...(id ? { tabindex: 0, role: 'button', 'data-agent': id } : {}) });
    g.append(
      s('text', { x: PAD.l - 8, y: y + lane / 2 + 4, class: 'dg-label', 'text-anchor': 'end' }, label.length > 20 ? `${label.slice(0, 19)}...` : label),
      s('rect', { x: x(from), y: y + 4, width: Math.max(3, x(to) - x(from)), height: lane - 8, rx: 3, class: `dg-bar ${cls}` }, ...(tip ? [titleEl(tip)] : []))
    );
    if (id) {
      g.addEventListener('click', () => pick(id));
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pick(id);
        }
      });
    }
    svg.append(g);
  };
  row(0, 'Main thread', main.from, main.to, 'tone-main');
  spans.forEach((sp, i) => row(i + 1, sp.label, sp.from, sp.to, `tone-${i % 6}`, sp.agent.id, `${sp.label}\n${fmtDate(sp.from)}`));
  host.replaceChildren(svg);
}

const titleEl = (text: string): SVGElement => s('title', {}, text);
const empty = (text: string): HTMLElement => Object.assign(document.createElement('div'), { className: 'empty flush', textContent: text });

export function drawConcurrency(host: HTMLElement, d: SessionDetailData, spans: Span[]): void {
  const w = windowOf(d, spans);
  if (!w || !spans.length) {
    host.replaceChildren(empty('No subagent ran in this session, or the source gave no times for them.'));
    return;
  }
  const height = 190;
  const svg = frame(height);
  svg.setAttribute('aria-label', 'How many subagents ran at the same time');
  const x = axis(svg, w, height);
  const edges = spans.flatMap((sp) => [[sp.from, 1], [sp.to, -1]] as [number, number][]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const peak = Math.max(1, ...runningCounts(edges));
  const y = (n: number) => height - PAD.b - (n / peak) * (height - PAD.b - PAD.t - 6);
  let n = 0;
  let path = `M ${x(w.from)} ${y(0)}`;
  for (const [t, delta] of edges) {
    path += ` L ${x(t)} ${y(n)}`;
    n += delta;
    path += ` L ${x(t)} ${y(n)}`;
  }
  path += ` L ${x(w.to)} ${y(0)} Z`;
  svg.append(s('path', { d: path, class: 'dg-area' }), s('text', { x: PAD.l - 8, y: y(peak) + 4, class: 'dg-label', 'text-anchor': 'end' }, `${peak} at once`), s('text', { x: PAD.l - 8, y: y(0), class: 'dg-label', 'text-anchor': 'end' }, '0'));
  host.replaceChildren(svg);
}

function runningCounts(edges: [number, number][]): number[] {
  let n = 0;
  return edges.map(([, d]) => (n += d));
}

export function drawScatter(host: HTMLElement, d: SessionDetailData, spans: Span[], selected: string | undefined, pick: (id: string) => void): void {
  const w = windowOf(d, spans);
  const pts = spans.map((sp) => ({ sp, tokens: (sp.agent.tokens?.input ?? 0) + (sp.agent.tokens?.output ?? 0) })).filter((p) => p.tokens > 0);
  if (!w || !pts.length) {
    host.replaceChildren(empty('No subagent carries token figures in this session.'));
    return;
  }
  const height = 220;
  const svg = frame(height);
  svg.setAttribute('aria-label', 'Every subagent by start time and tokens');
  const x = axis(svg, w, height);
  const top = Math.max(...pts.map((p) => p.tokens));
  const y = (v: number) => height - PAD.b - (v / top) * (height - PAD.b - PAD.t - 12);
  const credits = Math.max(0.0001, ...pts.map((p) => p.sp.agent.credits ?? 0));
  svg.append(s('text', { x: PAD.l - 8, y: y(top) + 4, class: 'dg-label', 'text-anchor': 'end' }, `${fmtNum(top)} tokens`));
  pts.forEach((p, i) => {
    const r = 5 + 9 * Math.sqrt((p.sp.agent.credits ?? 0) / credits);
    const c = s('circle', { cx: x(p.sp.from), cy: y(p.tokens), r, class: `dg-dot tone-${i % 6}${p.sp.agent.id === selected ? ' sel' : ''}`, tabindex: 0, role: 'button' }, titleEl(`${p.sp.label}\n${fmtNum(p.tokens)} tokens${p.sp.agent.credits === undefined ? '' : `, ${p.sp.agent.credits.toFixed(2)} credits`}`));
    c.addEventListener('click', () => pick(p.sp.agent.id));
    c.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        pick(p.sp.agent.id);
      }
    });
    svg.append(c);
  });
  host.replaceChildren(svg);
}
