// Scanners for one folder layout each: a markdown folder, a skills folder, a hook file, an MCP file.
// They return items and never throw: a missing folder gives nothing, a broken file gives an item
// with a status. No vscode import.
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parse as parseJsonc, type ParseError } from 'jsonc-parser';
import type { CustomizationItem, ItemStatus, Kind, Scope } from '../shared/customizations';
import { readFrontmatter } from './frontmatter';

/** What every item of one scan has in common. */
export interface ScanContext {
  scope: Scope;
  pluginId?: string;
  readOnly?: boolean;
  origin?: string;
  inParent?: boolean;
  /** Status given to every item that would be 'ok', for the contents of a disabled plugin. */
  disabled?: boolean;
}

const MAX_DEPTH = 3;

export async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

export async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

/** Files under dir whose name passes the filter, down to MAX_DEPTH folders. Missing dir gives []. */
export async function listFiles(dir: string, accept: (name: string) => boolean, depth = 0): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, e.name);
    const dirLike = e.isDirectory() || (e.isSymbolicLink() && (await isDir(full)));
    if (dirLike) {
      if (depth < MAX_DEPTH) out.push(...(await listFiles(full, accept, depth + 1)));
    } else if (accept(e.name)) out.push(full);
  }
  return out;
}

function item(ctx: ScanContext, kind: Kind, name: string, file: string, mtime: number | undefined, status: ItemStatus, keys?: string[]): CustomizationItem {
  const out: CustomizationItem = {
    scope: ctx.scope,
    kind,
    name,
    file,
    mtime,
    readOnly: ctx.readOnly ?? false,
    status: status === 'ok' && ctx.disabled ? 'disabled' : status,
  };
  if (keys) out.keys = keys;
  if (ctx.pluginId) out.pluginId = ctx.pluginId;
  if (ctx.origin) out.origin = ctx.origin;
  if (ctx.inParent) out.inParent = true;
  return out;
}

/** One markdown file as an item of the given kind; `fallback` names it when the frontmatter has no name. */
export async function markdownItem(ctx: ScanContext, kind: Kind, file: string, fallback: string, requireName = false): Promise<CustomizationItem> {
  const read = await readFrontmatter(file);
  if (!read) return item(ctx, kind, fallback, file, undefined, 'unreadable', []);
  const { fm, mtime } = read;
  const status: ItemStatus = !fm.ok ? 'invalid' : requireName && !fm.name ? 'incomplete' : 'ok';
  // An instructions file whose applyTo matches every file is always on, so it is a general instruction.
  return item(ctx, kind === 'stack' && fm.alwaysOn ? 'instruction' : kind, fm.name ?? fallback, file, mtime, status, fm.keys);
}

const stripSuffix = (file: string, suffixes: string[]): string => {
  const base = path.basename(file);
  const hit = suffixes.find((s) => base.toLowerCase().endsWith(s));
  return hit ? base.slice(0, -hit.length) : base.replace(/\.md$/i, '');
};

/** Markdown files in a folder (recursive to a small depth), one item each. */
export async function scanMarkdownDir(ctx: ScanContext, dir: string, kind: Kind, suffixes: string[]): Promise<CustomizationItem[]> {
  const files = await listFiles(dir, (n) => suffixes.some((s) => n.toLowerCase().endsWith(s)));
  return Promise.all(files.map((f) => markdownItem(ctx, kind, f, stripSuffix(f, suffixes))));
}

/** A folder of skills: <dir>/<skill>/SKILL.md. */
export async function scanSkillsDir(ctx: ScanContext, dir: string): Promise<CustomizationItem[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: CustomizationItem[] = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const skillFile = path.join(dir, e.name, 'SKILL.md');
    if (!(await isFile(skillFile))) continue;
    const skill = await markdownItem(ctx, 'skill', skillFile, e.name, true);
    out.push((await isDeterministicSkill(path.join(dir, e.name), skillFile)) ? { ...skill, kind: 'deterministic' } : skill);
  }
  return out;
}

/**
 * A deterministic skill hands its parameters to a bundled script: its folder has a scripts/ folder with a file in it
 * and its SKILL.md body names a path under scripts/. Every other skill is instructions only (orchestration).
 */
async function isDeterministicSkill(folder: string, skillFile: string): Promise<boolean> {
  let hasScript = false;
  try {
    hasScript = (await fs.readdir(path.join(folder, 'scripts'), { withFileTypes: true })).some((e) => e.isFile() || e.isDirectory());
  } catch {
    return false;
  }
  if (!hasScript || !(await listFiles(path.join(folder, 'scripts'), () => true)).length) return false;
  try {
    return /scripts[\\/][\w.-]/.test(await fs.readFile(skillFile, 'utf8'));
  } catch {
    return false;
  }
}

/** Single markdown files named exactly (copilot-instructions.md, AGENTS.md, CLAUDE.md). */
export async function scanNamedFiles(ctx: ScanContext, kind: Kind, files: string[]): Promise<CustomizationItem[]> {
  const out: CustomizationItem[] = [];
  for (const f of files) {
    if (await isFile(f)) out.push(await markdownItem(ctx, kind, f, path.basename(f)));
  }
  return out;
}

interface Json {
  data: unknown;
  ok: boolean;
  mtime: number | undefined;
  readable: boolean;
}

export async function readJson(file: string): Promise<Json | undefined> {
  if (!(await isFile(file))) return undefined;
  try {
    const [text, stat] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)]);
    const errors: ParseError[] = [];
    const data = parseJsonc(text, errors, { allowTrailingComma: true });
    return { data, ok: errors.length === 0 && data !== undefined, mtime: stat.mtimeMs, readable: true };
  } catch {
    return { data: undefined, ok: false, mtime: undefined, readable: false };
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A hook definition file: one item named after the file. `hooksKey` reads the hooks from a key of a larger file (settings.json). */
export async function scanHookFile(ctx: ScanContext, file: string, hooksKey?: string): Promise<CustomizationItem[]> {
  const json = await readJson(file);
  if (!json) return [];
  const name = hooksKey ? `${path.basename(file)} hooks` : path.basename(file);
  if (!json.readable) return [item(ctx, 'hook', name, file, undefined, 'unreadable')];
  if (!json.ok || !isRecord(json.data)) return hooksKey && json.ok ? [] : [item(ctx, 'hook', name, file, json.mtime, 'invalid')];
  if (hooksKey) {
    const hooks = json.data[hooksKey];
    if (!isRecord(hooks) || Object.keys(hooks).length === 0) return [];
  }
  return [item(ctx, 'hook', name, file, json.mtime, 'ok')];
}

/** An MCP file: one item per server. `serversKey` is 'servers' (.vscode/mcp.json) or 'mcpServers' (.mcp.json, mcp-config.json). */
export async function scanMcpFile(ctx: ScanContext, file: string, serversKey: string): Promise<CustomizationItem[]> {
  const json = await readJson(file);
  if (!json) return [];
  const base = path.basename(file);
  if (!json.readable) return [item(ctx, 'mcp', base, file, undefined, 'unreadable')];
  if (!json.ok || !isRecord(json.data)) return [item(ctx, 'mcp', base, file, json.mtime, 'invalid')];
  const servers = json.data[serversKey];
  if (servers === undefined) return [];
  if (!isRecord(servers)) return [item(ctx, 'mcp', base, file, json.mtime, 'invalid')];
  return Object.keys(servers).map((name) => item(ctx, 'mcp', name, file, json.mtime, isRecord(servers[name]) ? 'ok' : 'invalid'));
}

export { item as makeItem };
