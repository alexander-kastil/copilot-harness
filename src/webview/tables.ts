// The grid table every list on the overview uses.
import { el } from './dom';

type Cell = Node | string | (Node | string)[];

/** A column: `track` is its CSS grid width; `num` right-aligns; `muted` dims; `wide` drops out when the panel is narrow; `low` drops out next. */
export interface Column<R> {
  head: string;
  track: string;
  cls?: string;
  num?: boolean;
  muted?: boolean;
  wide?: boolean;
  low?: boolean;
  tip?: string;
  cell(row: R): Cell;
  title?(row: R): string | undefined;
}

export function gridTable<R>(cols: Column<R>[], rows: R[], label: string): HTMLElement {
  const cellClass = (c: Column<R>) => [c.cls, c.num ? 'at-fact' : 'at-cell', c.muted ? 'at-muted' : '', c.wide ? 'at-wide' : '', c.low ? 'at-low' : ''].filter(Boolean).join(' ');
  const table = el(
    'div',
    { className: 'asset-table', role: 'table', 'aria-label': label },
    el('div', { className: 'at-row at-head', role: 'row' }, cols.map((c) => el('span', { className: cellClass(c), role: 'columnheader', title: c.tip }, c.head))),
    rows.map((r) =>
      el('div', { className: 'at-row static', role: 'row' }, cols.map((c) => el('span', { className: cellClass(c), role: 'cell', title: c.title?.(r) || undefined }, c.cell(r))))
    )
  );
  table.style.setProperty('--at-cols', cols.map((c) => c.track).join(' '));
  table.style.setProperty('--at-cols-narrow', cols.filter((c) => !c.wide).map((c) => c.track).join(' '));
  // A table whose fixed columns need more than the stylesheet's 620 px breakpoint drops its `wide` columns as soon as it would
  // run past its box; a `low` column goes next, when even the rest does not fit.
  const need = (list: Column<R>[]) => list.reduce((n, c) => n + Number(/^(?:minmax\()?(\d+)px/.exec(c.track)?.[1] ?? 0), 0) + 16 * (list.length - 1) + 24;
  const kept = cols.filter((c) => !c.wide);
  table.style.setProperty('--at-cols-narrow2', kept.filter((c) => !c.low).map((c) => c.track).join(' '));
  const low = cols.some((c) => c.low);
  if ((need(cols) > 620 && cols.some((c) => c.wide)) || low) {
    const fit = () => {
      const w = table.clientWidth;
      if (!w) return;
      table.classList.toggle('at-compact', w < need(cols));
      table.classList.toggle('at-compact2', low && w < need(kept));
    };
    new ResizeObserver(fit).observe(table);
  }
  return table;
}
