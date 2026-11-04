// The marketplaces the host last sent, the result of the last action, and the one place that starts an action.
// The nav, the two marketplace pages and the plugin page's commands read from here.
import type { MarketHealth, MarketOp, MarketPlugin, RenameFile } from '../shared/markets';
import { post } from './bridge';

export interface Notice {
  ok: boolean;
  message: string;
}

export interface Plan {
  market: string;
  to: string;
  files: RenameFile[];
  commands: string[];
  error?: string;
}

let markets: MarketHealth[] | undefined;
let notice: Notice | undefined;
let busy = false;
const listeners = new Set<() => void>();
let planListener: ((plan: Plan) => void) | undefined;

export const getMarkets = (): MarketHealth[] | undefined => markets;
export const getNotice = (): Notice | undefined => notice;
export const isBusy = (): boolean => busy;

/** Called after the marketplaces or the notice change. */
export function onMarkets(fn: () => void): void {
  listeners.add(fn);
}

const changed = () => {
  for (const fn of listeners) fn();
};

export function setMarkets(next: MarketHealth[]): void {
  markets = next;
  changed();
}

export function setResult(next: Notice): void {
  notice = next;
  busy = false;
  changed();
  // The nav's plugin lists change with an install, an uninstall or an update.
  if (next.ok) post({ type: 'navRefresh' });
}

export function clearNotice(): void {
  notice = undefined;
  changed();
}

export function setPlanListener(fn: ((plan: Plan) => void) | undefined): void {
  planListener = fn;
}

export function onPlan(plan: Plan): void {
  planListener?.(plan);
}

export function reload(): void {
  post({ type: 'marketsRead' });
}

export function runOp(op: MarketOp): void {
  busy = true;
  notice = undefined;
  changed();
  post({ type: 'marketsRun', op });
}

export const marketOf = (name: string): MarketHealth | undefined => markets?.find((m) => m.name === name);

/** The plugin `name@marketplace` and the marketplace it belongs to. */
export function pluginOf(key: string): { market: MarketHealth; plugin: MarketPlugin } | undefined {
  for (const market of markets ?? []) {
    const plugin = market.plugins.find((p) => p.key === key);
    if (plugin) return { market, plugin };
  }
  return undefined;
}

export const aheadOf = (m: MarketHealth): MarketPlugin[] => m.plugins.filter((p) => p.ahead);
