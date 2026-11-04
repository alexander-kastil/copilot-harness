// The Plugin Hunter's read of the harness: the skills and agents it can choose from, where their copies are, and the
// inventory Copilot is shown. Built from the nav's listing (every kind of Global and of each repository). No vscode import.
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { Kind } from '../shared/customizations';
import type { HuntAsset, HuntCatalogItem, HuntProposal } from '../shared/hunt';
import type { NavGroup, NavItem, NavState } from '../shared/nav';

type AssetKind = 'skill' | 'agent';

/** Skills and agents are the elements a plugin carries; a subagent is an agent file, a deterministic skill a skill folder. */
const ASSET_KIND: Partial<Record<Kind, AssetKind>> = { skill: 'skill', deterministic: 'skill', agent: 'agent', subagent: 'agent' };

export const keyOf = (a: { kind: string; name: string }) => `${a.kind}:${a.name}`;
export const samePath = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/** The path a copy is taken from: a skill's folder, an agent's file. */
export const pathOf = (kind: AssetKind, file: string) => (kind === 'skill' ? path.dirname(file) : file);

/** The plugin an installed item belongs to, without its marketplace. */
const pluginName = (id: string) => id.split('@')[0];

const SKIP = new Set(['node_modules', '.git']);

function filesUnder(dir: string, rel = ''): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (SKIP.has(e.name)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...filesUnder(dir, r));
    else if (e.isFile()) out.push(r);
  }
  return out;
}

/** The files of a skill folder, relative and with forward slashes; an agent is its one file. */
export const filesIn = (p: string): string[] => (fs.statSync(p).isDirectory() ? filesUnder(p) : [path.basename(p)]);

/** A hash of everything in a copy; two copies with the same hash are the same. */
export function contentHash(p: string): string {
  const h = crypto.createHash('sha1');
  try {
    const dir = fs.statSync(p).isDirectory();
    for (const f of filesIn(p)) {
      h.update(f);
      h.update(fs.readFileSync(dir ? path.join(p, f) : p));
    }
  } catch {
    return '';
  }
  return h.digest('hex');
}

/** The `description` of a skill or agent file's frontmatter; empty when it has none. */
export function descriptionOf(file: string): string {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(16 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const lines = buf.subarray(0, n).toString('utf8').replace(/^﻿/, '').split(/\r?\n/);
    if (lines[0]?.trimEnd() !== '---') return '';
    const end = lines.findIndex((l, i) => i > 0 && l.trimEnd() === '---');
    if (end < 0) return '';
    const data = parseYaml(lines.slice(1, end).join('\n')) as Record<string, unknown> | null;
    const d = data && typeof data === 'object' ? data.description : undefined;
    return typeof d === 'string' ? d.replace(/\s+/g, ' ').trim() : '';
  } catch {
    return '';
  }
}

interface Copy {
  /** global, or the repository's name. */
  repo: string;
  isGlobal: boolean;
  item: NavItem;
}

interface Source {
  groups: NavGroup[];
  repo: string;
  isGlobal: boolean;
}

const sources = (nav: NavState): Source[] => [{ groups: nav.global, repo: 'global', isGlobal: true }, ...nav.repos.map((r) => ({ groups: r.groups, repo: r.name, isGlobal: false }))];

/** Every item of one asset kind in a source; a subagent that is also listed as an agent is one element. */
function itemsOf(s: Source, kind: AssetKind): NavItem[] {
  const seen = new Set<string>();
  const out: NavItem[] = [];
  for (const g of s.groups)
    if (ASSET_KIND[g.kind] === kind)
      for (const i of g.items) {
        if (seen.has(i.file.toLowerCase())) continue;
        seen.add(i.file.toLowerCase());
        out.push(i);
      }
  return out;
}

/** The plugin that already ships each element name, from the items an installed plugin supplies. */
function shippedBy(nav: NavState, kind: AssetKind): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of sources(nav)) for (const i of itemsOf(s, kind)) if (i.pluginId && !out.has(i.name)) out.set(i.name, pluginName(i.pluginId));
  return out;
}

/** The elements the owner owns: those an installed plugin supplies are the plugin's, not copies to take. */
const owned = (items: NavItem[]) => items.filter((i) => !i.pluginId && !i.readOnly);

/** Every skill and agent of Global and of the repositories, with where its copies are; plugin copies only mark `inPlugin`. */
export function buildCatalog(nav: NavState): HuntCatalogItem[] {
  const out: HuntCatalogItem[] = [];
  for (const kind of ['skill', 'agent'] as const) {
    const names = new Map<string, Copy[]>();
    for (const s of sources(nav))
      for (const item of owned(itemsOf(s, kind))) {
        const copy: Copy = { repo: s.repo, isGlobal: s.isGlobal, item };
        const copies = names.get(item.name);
        if (copies) copies.push(copy);
        else names.set(item.name, [copy]);
      }
    const shipped = shippedBy(nav, kind);
    for (const [name, copies] of names) {
      const global = copies.find((c) => c.isGlobal);
      const base = global ?? copies[0];
      const others = copies.filter((c) => !c.isGlobal && c !== base);
      // Only a name with several copies is compared; the hash reads every file of the folder.
      const baseHash = others.length ? contentHash(pathOf(kind, base.item.file)) : '';
      const repos = others.map((c) => ({ repo: c.repo, path: pathOf(kind, c.item.file), same: contentHash(pathOf(kind, c.item.file)) === baseHash, replace: false }));
      // With no global copy the first repo copy is the plugin's version and is listed as the repo row.
      if (!global) repos.unshift({ repo: base.repo, path: pathOf(kind, base.item.file), same: true, replace: false });
      out.push({
        description: descriptionOf(base.item.file),
        asset: { kind, name, include: false, why: '', global: global ? { path: pathOf(kind, global.item.file), replace: false } : undefined, repos, inPlugin: shipped.get(name) },
      });
    }
  }
  return out.sort((a, b) => a.asset.kind.localeCompare(b.asset.kind) || a.asset.name.localeCompare(b.asset.name));
}

const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 3)}...` : text);

/**
 * The inventory in the order of the prompt: Global, then the open repositories, then every other known one. It lists exactly
 * the elements of the catalog (one line each, so the page's count and Copilot's agree); a plugin only marks the elements it ships.
 */
export function inventoryText(nav: NavState): string {
  const open = new Set(nav.repos.filter((r) => r.open).map((r) => r.name));
  const rank = (s: Source) => (s.isGlobal ? 0 : open.has(s.repo) ? 1 : 2);
  const places = sources(nav).sort((a, b) => rank(a) - rank(b));
  const lines: string[] = [];
  for (const kind of ['skill', 'agent'] as const) {
    const shipped = shippedBy(nav, kind);
    const byName = new Map<string, { where: string[]; description: string }>();
    for (const s of places)
      for (const i of owned(itemsOf(s, kind))) {
        const e = byName.get(i.name) ?? { where: [], description: descriptionOf(i.file) };
        if (!e.where.includes(s.repo)) e.where.push(s.repo);
        byName.set(i.name, e);
      }
    for (const [name, e] of byName) lines.push(`- ${kind} ${name} [${e.where.join(', ')}${shipped.has(name) ? `; shipped by plugin ${shipped.get(name)}` : ''}]: ${clip(e.description, 160)}`);
  }
  return lines.join('\n');
}

const replaceOf = (c?: { replace?: boolean }) => !!c?.replace;

/** Saved cards against the disk as it is now: paths, copies and plugins are re-read, the owner's ticks stay where the path is still there. */
export function reconcile(proposals: HuntProposal[], catalog: HuntCatalogItem[], created: Record<string, string> = {}): HuntProposal[] {
  const have = new Map(catalog.map((c) => [keyOf(c.asset), c.asset]));
  // A created card is a record of what went into the plugin: its replaced copies are off the disk now, so it is never re-read.
  return proposals.map((p) =>
    created[p.id]
      ? p
      : {
          ...p,
          assets: p.assets.map((a): HuntAsset => {
            const now = have.get(keyOf(a));
            if (!now) return { ...a, include: false, global: undefined, repos: [], inPlugin: undefined };
            return {
              ...a,
              inPlugin: now.inPlugin,
              global: now.global ? { path: now.global.path, replace: a.global?.path === now.global.path && replaceOf(a.global) } : undefined,
              repos: now.repos.map((r) => ({ ...r, replace: replaceOf(a.repos.find((o) => o.path === r.path)) })),
            };
          }),
        }
  );
}
