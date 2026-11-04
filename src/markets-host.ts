// Host side of the marketplace pages: reads the marketplaces for the nav and the pages, and runs the plugin and
// marketplace actions the pages ask for with Copilot CLI (`copilot plugin ...`). The pages confirm every action first.
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { HarnessPanel } from './panel';
import { planRename, readMarkets } from './readers/markets';
import { currentEnv } from './readers/paths';
import type { MarketHealth, MarketOp } from './shared/markets';

const NAME = /^[\w.-]+$/;
// A source is typed by the owner but goes into a shell line: no character a shell reads as syntax.
const UNSAFE = /["`$%&|<>^\r\n]/;
const TIMEOUT = 180000;

interface Step {
  title: string;
  args: string[];
}

function vscodeMarkets(): string[] {
  const value = vscode.workspace.getConfiguration('chat.plugins').get<unknown>('marketplaces');
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (value && typeof value === 'object') return Object.entries(value as Record<string, unknown>).filter(([, on]) => on !== false).map(([k]) => k);
  return [];
}

const quote = (s: string) => (/[\s]/.test(s) ? `"${s}"` : s);

function runCopilot(args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    let out = '';
    const child = spawn(`copilot ${args.map(quote).join(' ')}`, { shell: true, windowsHide: true, env: process.env });
    const timer = setTimeout(() => child.kill(), TIMEOUT);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: 1, out: e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, out });
    });
  });
}

/** The plugin commands of an action. Returns an error text when a name or source is not safe to pass on. */
function stepsOf(op: MarketOp, markets: MarketHealth[]): Step[] | string {
  const names = [('market' in op ? op.market : ''), ('plugin' in op && op.plugin ? op.plugin : '')].filter(Boolean);
  if (names.some((n) => !NAME.test(n))) return 'That name holds a character that cannot be passed to Copilot CLI safely.';
  const market = 'market' in op ? markets.find((m) => m.name === op.market) : undefined;
  switch (op.op) {
    case 'sync': {
      const targets = op.plugin ? [op.plugin] : (market?.plugins ?? []).filter((p) => p.ahead).map((p) => p.name);
      return [{ title: `Refresh ${op.market}`, args: ['plugin', 'marketplace', 'update', op.market] }, ...targets.map((p) => ({ title: `Update ${p}`, args: ['plugin', 'update', `${p}@${op.market}`] }))];
    }
    case 'uninstall':
      return [{ title: `Uninstall ${op.plugin}`, args: ['plugin', 'uninstall', `${op.plugin}@${op.market}`] }];
    case 'enable':
    case 'disable':
      return [{ title: `${op.op === 'enable' ? 'Enable' : 'Disable'} ${op.plugin}`, args: ['plugin', op.op, `${op.plugin}@${op.market}`] }];
    default:
      return 'Unknown action.';
  }
}

export function registerMarkets(context: vscode.ExtensionContext): void {
  let busy = false;

  const read = (): MarketHealth[] => readMarkets(currentEnv(), vscodeMarkets());
  const post = (): MarketHealth[] => {
    const markets = read();
    HarnessPanel.post({ type: 'markets', markets });
    return markets;
  };
  const result = (ok: boolean, message: string): void => HarnessPanel.post({ type: 'marketsResult', ok, message });

  const rename = (op: Extract<MarketOp, { op: 'rename' }>): void => {
    const plan = planRename(currentEnv(), read(), op.market, op.to);
    if (plan.error) return result(false, plan.error);
    // The files first, as Claude Harness does; the terminal commands finish the rename, so the owner watches them.
    for (const e of plan.edits) fs.writeFileSync(e.file, e.after, 'utf8');
    const terminal = vscode.window.createTerminal({ name: `Rename ${op.market}` });
    terminal.show();
    for (const line of plan.commands) terminal.sendText(line);
    result(true, `Renamed ${op.market} to ${op.to}: ${plan.files.length} ${plan.files.length === 1 ? 'file' : 'files'} written, the commands run in the terminal.`);
    post();
  };

  const run = async (op: MarketOp): Promise<void> => {
    if (busy) return result(false, 'Another marketplace action is still running.');
    if (op.op === 'rename') return rename(op);
    const steps = stepsOf(op, read());
    if (typeof steps === 'string') return result(false, steps);
    busy = true;
    try {
      const failures: string[] = [];
      let done = 0;
      for (const step of steps) {
        const r = await runCopilot(step.args);
        if (r.code === 0) done++;
        else failures.push(`${step.title}: ${r.out.trim().split(/\r?\n/).filter(Boolean).pop() ?? 'failed'}`);
      }
      const what = op.op === 'sync' ? (op.plugin ? `Synced ${op.plugin}` : `Synced ${Math.max(0, done - 1)} of ${steps.length - 1} plugins`) : steps[0].title;
      result(failures.length === 0, failures.length ? `${what}. ${failures.join(' ')}` : `${what}: done. Open Copilot sessions pick it up after a restart.`);
    } finally {
      busy = false;
      post();
    }
  };

  context.subscriptions.push(
    HarnessPanel.onMessage((m) => {
      if (m.type === 'ready' || m.type === 'marketsRead') post();
      else if (m.type === 'marketsPlan') {
        const plan = planRename(currentEnv(), read(), m.market, m.to);
        HarnessPanel.post({ type: 'marketsPlan', market: m.market, to: m.to, files: plan.files, commands: plan.commands, ...(plan.error ? { error: plan.error } : {}) });
      } else if (m.type === 'marketsRun') void run(m.op);
    })
  );
}
