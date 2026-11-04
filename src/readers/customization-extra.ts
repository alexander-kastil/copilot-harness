// What the demo folders of the agentic harness class add to the core inventory: the two layers of
// instructions (general and stack-specific), the folders the VS Code settings name for instructions
// and plugins, AGENTS.md in subfolders and hooks declared in an agent file. Names, paths and times
// only. No vscode import.
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CustomizationItem } from '../shared/customizations';
import { scanPluginDir } from './customization-plugins';
import { isDir, isFile, makeItem, markdownItem, readJson, scanMarkdownDir, type ScanContext } from './customization-scan';

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A setting that maps paths to true or false, read from a settings.json (JSON with comments); [] when absent. */
export async function readPathSetting(file: string, key: string): Promise<[string, boolean][]> {
  const json = await readJson(file);
  if (!json?.ok || !isRecord(json.data)) return [];
  const value = json.data[key];
  if (!isRecord(value)) return [];
  return Object.entries(value).map(([p, on]) => [p, on === true] as [string, boolean]);
}

/** A path from a setting: `~` is the home folder, a relative path is relative to `base`; undefined for a glob or a relative path without a base. */
export function settingPath(raw: string, base: string | undefined): string | undefined {
  if (!raw || /[*?{}]/.test(raw)) return undefined;
  if (raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\')) return path.join(os.homedir(), raw.slice(1));
  if (path.isAbsolute(raw)) return path.resolve(raw);
  return base ? path.resolve(base, raw) : undefined;
}

/** Folders and files of `chat.instructionsFilesLocations`: a folder gives its `*.instructions.md` files, a file is general unless it is a `.instructions.md` file. */
export async function scanInstructionLocations(ctx: ScanContext, entries: [string, boolean][], base: string | undefined): Promise<CustomizationItem[]> {
  const out: CustomizationItem[] = [];
  for (const [raw, on] of entries) {
    const p = on ? settingPath(raw, base) : undefined;
    if (!p) continue;
    if (await isDir(p)) out.push(...(await scanMarkdownDir(ctx, p, 'stack', ['.instructions.md'])));
    else if (await isFile(p)) {
      const stack = p.toLowerCase().endsWith('.instructions.md');
      out.push(await markdownItem(ctx, stack ? 'stack' : 'instruction', p, path.basename(p)));
    }
  }
  return out;
}

/** Plugin folders of `chat.pluginLocations`; a folder set to false is listed as disabled. */
export async function scanPluginLocations(
  scope: 'workspace' | 'userProfile',
  entries: [string, boolean][],
  base: string | undefined,
  origin?: string
): Promise<CustomizationItem[]> {
  const out: CustomizationItem[] = [];
  for (const [raw, on] of entries) {
    const p = settingPath(raw, base);
    if (!p || !(await isDir(p))) continue;
    const name = path.basename(p);
    out.push(...(await scanPluginDir(scope, p, `${name}@local`, name, on, origin)));
  }
  return out;
}

/** The first boolean among the keys of a settings.json; undefined when none is set. */
async function readBoolSetting(file: string, keys: string[]): Promise<boolean | undefined> {
  const json = await readJson(file);
  if (!json?.ok || !isRecord(json.data)) return undefined;
  for (const k of keys) if (typeof json.data[k] === 'boolean') return json.data[k] as boolean;
  return undefined;
}

/** The two settings that switch Copilot Memory on: the one the class demo names and the one the VS Code memory docs name. */
const MEMORY_SETTINGS = ['github.copilot.chat.copilotMemory.enabled', 'chat.copilot.memory.enabled'];

/** `owner/repo` of a GitHub remote url (https, scp-like or ssh), or undefined for any other host. */
export function githubRepoOf(url: string): { owner: string; repo: string } | undefined {
  const m = /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|[^@/\s]+@)github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(url.trim());
  return m ? { owner: m[1], repo: m[2] } : undefined;
}

/** The first GitHub remote of a `.git/config`, `origin` first. */
async function githubRemote(config: string): Promise<{ owner: string; repo: string } | undefined> {
  let text: string;
  try {
    text = await fs.readFile(config, 'utf8');
  } catch {
    return undefined;
  }
  const remotes: { name: string; url: string }[] = [];
  let current: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const section = /^\s*\[remote\s+"([^"]+)"\]/.exec(line);
    if (section) current = section[1];
    else if (/^\s*\[/.test(line)) current = undefined;
    else if (current) {
      const url = /^\s*url\s*=\s*(.+?)\s*$/.exec(line);
      if (url) remotes.push({ name: current, url: url[1] });
    }
  }
  remotes.sort((a, b) => Number(b.name === 'origin') - Number(a.name === 'origin'));
  for (const r of remotes) {
    const repo = githubRepoOf(r.url);
    if (repo) return repo;
  }
  return undefined;
}

/**
 * Copilot Memory of a repository. The memories themselves are kept in the repository's GitHub settings (Settings > Copilot > Memory)
 * and GitHub documents no way to list them, so the item shows the local switch and links to that page. The experimental
 * repository-local store `.github/copilot-memories.jsonl` is listed when the file exists; its text is never read.
 */
export async function scanCopilotMemory(ctx: ScanContext, root: string, userSettings: string[]): Promise<CustomizationItem[]> {
  const out: CustomizationItem[] = [];
  const config = path.join(root, '.git', 'config');
  const remote = await githubRemote(config);
  if (remote) {
    let on = await readBoolSetting(path.join(root, '.vscode', 'settings.json'), MEMORY_SETTINGS);
    for (const f of userSettings) if (on === undefined) on = await readBoolSetting(f, MEMORY_SETTINGS);
    const url = `https://github.com/${remote.owner}/${remote.repo}/settings/copilot/memory`;
    const base = makeItem(ctx, 'memory', `${remote.owner}/${remote.repo}: memory ${on ? 'on' : 'off'}`, config, undefined, 'ok');
    let mtime: number | undefined;
    try {
      mtime = (await fs.stat(config)).mtimeMs;
    } catch {
      // keep undefined
    }
    out.push({ ...base, mtime, url });
  }
  const local = path.join(root, '.github', 'copilot-memories.jsonl');
  if (await isFile(local)) {
    try {
      out.push(makeItem(ctx, 'memory', 'copilot-memories.jsonl', local, (await fs.stat(local)).mtimeMs, 'ok'));
    } catch {
      out.push(makeItem(ctx, 'memory', 'copilot-memories.jsonl', local, undefined, 'unreadable'));
    }
  }
  return out;
}

/** `.claude/rules` files: a rule with a `paths` (or `applyTo`) key loads only for those files, so it is stack-specific; the others are always on. */
export function classifyRules(items: CustomizationItem[]): CustomizationItem[] {
  return items.map((i) => (i.kind === 'instruction' && (i.keys?.includes('paths') || i.keys?.includes('applyTo')) ? { ...i, kind: 'stack' as const } : i));
}

const SKIP_DIRS = new Set(['node_modules', 'out', 'dist', 'build', 'bin', 'obj', 'target', 'vendor', '__pycache__']);
const NESTED_DEPTH = 4;
/** AGENTS.md and its variants: Codex's per-folder AGENTS.override.md, and AGENTS.local.md. */
const AGENTS_FILES = ['AGENTS.md', 'AGENTS.override.md', 'AGENTS.local.md'];
const NESTED_DIR_CAP = 1500;

/** AGENTS.md files below the root (the nearest one to an edited file applies); dot folders and build output folders are not entered. */
export async function scanNestedAgentsMd(ctx: ScanContext, root: string): Promise<CustomizationItem[]> {
  const out: CustomizationItem[] = [];
  let visited = 0;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (visited++ >= NESTED_DIR_CAP) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    if (dir !== root) {
      for (const name of AGENTS_FILES) {
        if (entries.some((e) => e.isFile() && e.name === name)) out.push(await markdownItem(ctx, 'instruction', path.join(dir, name), path.relative(root, path.join(dir, name)).replace(/\\/g, '/')));
      }
    }
    if (depth >= NESTED_DEPTH) return;
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name)) await walk(path.join(dir, e.name), depth + 1);
    }
  };
  await walk(root, 0);
  return out;
}

/** Hooks declared in an agent file (the `hooks` frontmatter key) count as hooks, one item per agent file. */
export function agentHooksOf(items: CustomizationItem[]): CustomizationItem[] {
  return items
    .filter((i) => i.kind === 'agent' && i.status === 'ok' && i.keys?.includes('hooks'))
    .map((i) => makeItem({ scope: i.scope, readOnly: i.readOnly, pluginId: i.pluginId, origin: i.origin, inParent: i.inParent }, 'hook', `${i.name} hooks`, i.file, i.mtime, 'ok'));
}

const keyOf = (i: CustomizationItem): string => `${i.kind}|${process.platform === 'win32' ? i.file.toLowerCase() : i.file}|${i.name}`;

/** One item per kind, file and name: a folder named twice (by default and by a setting) lists its files once. */
export function dedupe(items: CustomizationItem[]): CustomizationItem[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const k = keyOf(i);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
