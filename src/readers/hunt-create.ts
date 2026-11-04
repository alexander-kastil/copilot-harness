// Creating a plugin from a card: the plan shown before anything happens, the folder and catalog entry written, the install,
// the replaced copies. No vscode import.
//
// The plugin follows the GitHub Copilot CLI plugin format
// (https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference): a folder with the manifest at
// .github/plugin/plugin.json ({ name, version, description, author }), skills in skills/<name>/SKILL.md and agents in
// agents/<name>.agent.md (the default locations, so the manifest needs no path fields). VS Code agent plugins read the same
// folder (https://code.visualstudio.com/docs/copilot/customization/agent-plugins).
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { applyEdits, modify, parse as parseJsonc } from 'jsonc-parser';
import type { HuntAsset, HuntMarket, HuntProposal } from '../shared/hunt';
import { filesIn, keyOf } from './hunt-catalog';
import { catalogFileOf, catalogOf, layoutOf, readJson, sourceFor } from './hunt-market';

const NAME = /^[a-z0-9][a-z0-9._-]*$/;

export interface CreateCtx {
  /** Copilot's own root (COPILOT_HOME or ~/.copilot). */
  root: string;
  market: HuntMarket;
  backupRoot: string;
}

export interface CreatePlan {
  problems: string[];
  /** Every file written, relative to the marketplace folder. */
  files: string[];
  /** Every copy replaced, in words. */
  retired: string[];
  /** Copies the owner ticked that stay, with why. */
  kept: string[];
  source: string;
  dir: string;
  chosen: { asset: HuntAsset; from: string; kind: 'skill' | 'agent' }[];
  retires: { path: string; label: string }[];
}

const SKIP = new Set(['node_modules', '.git']);

/** The folder name of an agent file: agent.md and .agent.md both stand for the agent's name. */
const agentFileOf = (to: string) => `${to}.agent.md`;

export function planCreate(p: HuntProposal, ctx: CreateCtx): CreatePlan {
  const problems: string[] = [];
  const plan: CreatePlan = { problems, files: [], retired: [], kept: [], source: '', dir: '', chosen: [], retires: [] };
  const entries = ctx.market.owned ? catalogOf(ctx.market.location) : [];
  if (!ctx.market.owned) problems.push(`${ctx.market.name} is not a marketplace folder of yours on disk.`);
  if (!NAME.test(p.name)) problems.push('Give the plugin a name: lowercase letters, digits, dots, dashes or underscores.');
  if (ctx.market.owned && layoutOf(entries).categorized && !NAME.test(p.category)) problems.push(`${ctx.market.name} keeps plugins in category folders: give the card a category.`);
  if (p.category && !NAME.test(p.category)) problems.push('The category needs lowercase letters, digits, dots, dashes or underscores.');
  if (!/^[\w.@-]+$/.test(ctx.market.name)) problems.push('The marketplace name has characters the install command cannot take.');
  const included = p.assets.filter((a) => a.include);
  if (!included.length) problems.push('Tick at least one skill or agent.');
  if (problems.length && !ctx.market.owned) return plan;
  if (entries.some((e) => e.name === p.name)) problems.push(`${ctx.market.name} already has a plugin called ${p.name}. Give this card another name.`);
  plan.source = sourceFor(entries, p.name, p.category);
  plan.dir = path.resolve(ctx.market.location, plan.source);
  if (!plan.dir.toLowerCase().startsWith(path.resolve(ctx.market.location).toLowerCase() + path.sep)) problems.push('The plugin folder would be outside the marketplace.');
  else if (fs.existsSync(plan.dir)) problems.push(`The folder ${plan.source} already exists.`);
  const rel = (...parts: string[]) => [plan.source.replace(/^\.\//, ''), ...parts].join('/');
  plan.files.push(rel('.github', 'plugin', 'plugin.json'));
  const names = new Set<string>();
  for (const a of included) {
    if (names.has(keyOf(a))) continue;
    names.add(keyOf(a));
    if (a.name.includes('..') || a.name.startsWith('/')) {
      problems.push(`${a.name} is not a valid name.`);
      continue;
    }
    const to = a.as ?? a.name;
    if (!NAME.test(to)) {
      problems.push(`${to} is not a valid name for ${a.name}.`);
      continue;
    }
    if (included.some((o) => o !== a && o.kind === a.kind && (o.as ?? o.name) === to)) {
      problems.push(`Two ${a.kind}s would be called ${to} in the plugin.`);
      continue;
    }
    // The global copy is the plugin's version; a repo copy only when there is no global one.
    const from = a.global?.path ?? a.repos[0]?.path;
    if (!from || !fs.existsSync(from)) {
      problems.push(`The ${a.kind} ${a.name} is gone from disk. Remove it from the card.`);
      continue;
    }
    plan.chosen.push({ asset: a, from, kind: a.kind });
    if (a.kind === 'skill') {
      const files = filesIn(from);
      plan.files.push(...(files.length > 12 ? [rel('skills', to, `... ${files.length} files`)] : files.map((f) => rel('skills', to, f))));
    } else plan.files.push(rel('agents', agentFileOf(to)));
    const retire = (file: string, label: string) => {
      if (!fs.existsSync(file)) return void problems.push(`The copy of ${a.name} in ${label} is gone from disk. Untick it.`);
      if (path.resolve(file).toLowerCase().startsWith(path.resolve(ctx.market.location).toLowerCase() + path.sep)) return void plan.kept.push(`${a.name} in ${label} stays: it is inside the marketplace folder.`);
      plan.retires.push({ path: file, label });
      plan.retired.push(`${a.kind} ${a.name} in ${label}`);
    };
    // Only a copy whose Replace switch is on is touched; an off copy is left exactly as it is.
    if (a.global?.replace) retire(a.global.path, 'Global');
    for (const r of a.repos) if (r.replace) retire(r.path, r.repo);
  }
  plan.files.push(`${path.basename(ctx.market.location)}/${path.relative(ctx.market.location, catalogFileOf(ctx.market.location)).split(path.sep).join('/')} (adds ${p.name})`);
  return plan;
}

const eolOf = (text: string) => (text.includes('\r\n') ? '\r\n' : '\n');
const format = (text: string) => ({ insertSpaces: true, tabSize: 2, eol: eolOf(text) });

/** A renamed element's copy in the plugin: the `name` line of its front matter says the new name, the rest of the file stays. */
function renameIn(file: string, name: string): void {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  const head = /^---\r?\n[\s\S]*?\r?\n---/.exec(text);
  if (!head) return;
  fs.writeFileSync(file, text.replace(head[0], () => head[0].replace(/^name:.*$/m, () => `name: ${name}`)));
}

/** The chosen elements copied into the plugin folder: a skill's folder without the skipped files, an agent's file; a renamed one gets its new name. */
async function copyElements(plan: CreatePlan): Promise<void> {
  for (const c of plan.chosen) {
    const to = c.asset.as ?? c.asset.name;
    if (c.kind === 'skill') {
      const dest = path.join(plan.dir, 'skills', to);
      await fs.promises.cp(c.from, dest, { recursive: true, dereference: true, filter: (src) => !SKIP.has(path.basename(src)) });
      if (c.asset.as) renameIn(path.join(dest, 'SKILL.md'), to);
    } else {
      const dest = path.join(plan.dir, 'agents', agentFileOf(to));
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await fs.promises.copyFile(c.from, dest);
      if (c.asset.as) renameIn(dest, to);
    }
  }
}

/** The plugin folder and the marketplace entry. A failure removes the folder it made. */
export async function writePlugin(p: HuntProposal, plan: CreatePlan, market: HuntMarket): Promise<void> {
  const catalogFile = catalogFileOf(market.location);
  const catalogText = fs.readFileSync(catalogFile, 'utf8');
  const catalog = (parseJsonc(catalogText) ?? {}) as Record<string, any>;
  const entries = (Array.isArray(catalog.plugins) ? catalog.plugins : []) as unknown[];
  const manifest: Record<string, unknown> = { name: p.name, version: '0.1.0', description: p.description };
  // The marketplace owner is the author.
  const owner = catalog.owner;
  if (owner && typeof owner === 'object' && typeof owner.name === 'string') manifest.author = { name: owner.name, ...(typeof owner.email === 'string' ? { email: owner.email } : {}) };
  try {
    await fs.promises.mkdir(path.join(plan.dir, '.github', 'plugin'), { recursive: true });
    await fs.promises.writeFile(path.join(plan.dir, '.github', 'plugin', 'plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await copyElements(plan);
    const edits = modify(catalogText, ['plugins', entries.length], { name: p.name, source: plan.source, description: p.description }, { isArrayInsertion: true, formattingOptions: format(catalogText) });
    await fs.promises.writeFile(catalogFile, applyEdits(catalogText, edits));
  } catch (e) {
    await fs.promises.rm(plan.dir, { recursive: true, force: true });
    throw e;
  }
}

export interface CliResult {
  code: number;
  out: string;
}

/**
 * The program and leading arguments that start copilot, without a shell option: `copilot` itself, `copilot.exe` from the PATH on
 * Windows, or `copilot.cmd` (the npm install) through cmd.exe, which Node cannot start directly.
 */
export function copilotLauncher(env: NodeJS.ProcessEnv): string[] {
  if (process.platform !== 'win32') return ['copilot'];
  // Windows variable names are case-insensitive, a copied environment is not.
  const get = (name: string) => env[Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase()) ?? name];
  const dirs = (get('PATH') ?? '').split(path.delimiter).filter(Boolean);
  for (const ext of ['.exe', '.cmd'])
    for (const dir of dirs) {
      const file = path.join(dir, `copilot${ext}`);
      if (!fs.existsSync(file)) continue;
      return ext === '.exe' ? [file] : [get('ComSpec') ?? path.join(get('SystemRoot') ?? 'C:\\Windows', 'System32', 'cmd.exe'), '/d', '/s', '/c', file];
    }
  return ['copilot'];
}

/** Copilot's own root: COPILOT_HOME when set, else ~/.copilot. */
export const copilotRoot = (): string => process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot');

/** Runs the copilot CLI; `input` goes to its standard input, so a long prompt never meets the command line limit. */
export function runCopilot(args: string[], opts: { timeout?: number; cwd?: string; input?: string } = {}): Promise<CliResult> {
  const [file, ...lead] = copilotLauncher(process.env);
  return new Promise((resolve) => {
    const child = execFile(file, [...lead, ...args], { env: process.env, windowsHide: true, timeout: opts.timeout ?? 180000, cwd: opts.cwd ?? os.tmpdir(), maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : -1) : 0, out: `${stdout ?? ''}${err ? stderr ?? '' : ''}`.trim() })
    );
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(opts.input ?? '');
  });
}

/** True when `copilot plugin list --json` shows the plugin from the marketplace. */
export async function isInstalled(p: string, market: string, run = runCopilot): Promise<boolean> {
  const r = await run(['plugin', 'list', '--json']);
  try {
    const list = JSON.parse(r.out.slice(r.out.indexOf('['))) as { name?: string; marketplace?: string }[];
    return list.some((x) => x.name === p && x.marketplace === market);
  } catch {
    return false;
  }
}

/** The marketplace is refreshed so the CLI sees the new entry, then the plugin is installed. */
export async function installPlugin(p: HuntProposal, market: HuntMarket, run = runCopilot): Promise<void> {
  await run(['plugin', 'marketplace', 'update', market.name]);
  const key = `${p.name}@${market.name}`;
  const r = await run(['plugin', 'install', key]);
  if (r.code !== 0) throw new Error(`copilot plugin install ${key} failed: ${r.out.split('\n').filter(Boolean).slice(-1)[0] ?? `exit ${r.code}`}`);
  if (!(await isInstalled(p.name, market.name, run))) throw new Error(`copilot plugin install ${key} exited 0 but copilot plugin list does not show the plugin.`);
}

/** The replaced copies, each backed up first. Returns the backup folder. */
export function retireCopies(plan: CreatePlan, backupRoot: string, stamp: string): string {
  for (const r of plan.retires) {
    const target = path.join(backupRoot, stamp, path.relative(path.parse(r.path).root, r.path));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(r.path, target, { recursive: true });
    fs.rmSync(r.path, { recursive: true, force: true });
  }
  return path.join(backupRoot, stamp);
}

export const backupStamp = (): string => new Date().toISOString().replace(/[:.]/g, '-');

/** Undoes `writePlugin` after a failed install, so Create can be pressed again: the folder and the marketplace entry go. */
export function unwritePlugin(p: HuntProposal, plan: CreatePlan, market: HuntMarket): void {
  fs.rmSync(plan.dir, { recursive: true, force: true });
  const file = catalogFileOf(market.location);
  const text = fs.readFileSync(file, 'utf8');
  const entries = ((readJson(file).plugins ?? []) as { name?: string }[]);
  const index = entries.findIndex((e) => e.name === p.name);
  if (index < 0) return;
  fs.writeFileSync(file, applyEdits(text, modify(text, ['plugins', index], undefined, { formattingOptions: format(text) })));
}
