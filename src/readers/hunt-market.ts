// The Plugin Hunter's read of the marketplaces Copilot CLI knows: which ones the owner owns on disk and how their plugin
// folders are laid out. No vscode import.
//
// Format (GitHub Copilot CLI plugin reference, https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference):
// a marketplace is a folder with .github/plugin/marketplace.json (also read, in order: marketplace.json, .plugin/marketplace.json,
// .claude-plugin/marketplace.json) holding { name, owner: { name }, plugins: [{ name, source, description }] }; `source` is a
// relative path such as "./plugins/my-plugin".
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseJsonc } from 'jsonc-parser';
import type { HuntMarket } from '../shared/hunt';

export const readJson = (file: string): Record<string, any> => {
  try {
    const value = parseJsonc(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
};

export type Entry = { name?: string; source?: unknown; description?: string; version?: unknown };

/** Where Copilot CLI looks for a marketplace's catalog, in order. */
export const CATALOG_FILES = [['.github', 'plugin', 'marketplace.json'], ['marketplace.json'], ['.plugin', 'marketplace.json'], ['.claude-plugin', 'marketplace.json']];

/** The catalog file of a marketplace folder: the first that exists, else the Copilot-native one (the place a new file would go). */
export const catalogFileOf = (location: string): string => {
  const found = CATALOG_FILES.map((p) => path.join(location, ...p)).find((f) => fs.existsSync(f));
  return found ?? path.join(location, ...CATALOG_FILES[0]);
};

export const hasCatalog = (location: string): boolean => CATALOG_FILES.some((p) => fs.existsSync(path.join(location, ...p)));
export const catalogOf = (location: string): Entry[] => {
  const plugins = readJson(catalogFileOf(location)).plugins;
  return Array.isArray(plugins) ? (plugins as Entry[]) : [];
};
export const sourcesOf = (entries: Entry[]): string[] => entries.map((p) => p.source).filter((s): s is string => typeof s === 'string' && s.startsWith('./'));

/** The layout of a marketplace's plugin folders, read from the sources it already lists. */
export function layoutOf(entries: Entry[]): { categorized: boolean; root: string; categories: string[] } {
  const parts = sourcesOf(entries).map((s) => s.slice(2).split('/').filter(Boolean));
  const deep = parts.filter((p) => p.length === 3);
  if (deep.length * 2 > parts.length) return { categorized: true, root: deep[0][0], categories: [...new Set(deep.map((p) => p[1]))].sort() };
  const flat = parts.find((p) => p.length >= 2);
  return { categorized: false, root: flat ? flat.slice(0, -1).join('/') : parts.length ? '' : 'plugins', categories: [] };
}

/** One row of `copilot plugin marketplace list --json`. */
export interface ListedMarket {
  name: string;
  /** "Local: <path>", "GitHub: <owner/repo>" and so on. */
  source: string;
  isDefault?: boolean;
}

/** Every marketplace Copilot CLI knows; the local folder ones are the owner's own and can receive a plugin. */
export function readMarkets(listed: ListedMarket[]): HuntMarket[] {
  return listed
    .filter((m) => m && typeof m.name === 'string' && typeof m.source === 'string')
    .map((m): HuntMarket => {
      const at = m.source.indexOf(':');
      const label = at < 0 ? m.source : m.source.slice(0, at);
      const kind = label.trim().toLowerCase() || 'unknown';
      const location = at < 0 ? '' : m.source.slice(at + 1).trim();
      const owned = kind === 'local' && !!location && hasCatalog(location);
      const layout = owned ? layoutOf(catalogOf(location)) : { categorized: false, categories: [] as string[] };
      const note = owned ? undefined : kind === 'local' ? 'This folder has no marketplace.json.' : 'Copilot CLI refreshes it from its source.';
      return { name: m.name, location, kind, owned, categorized: layout.categorized, categories: layout.categories, note };
    })
    .sort((a, b) => Number(b.owned) - Number(a.owned) || a.name.localeCompare(b.name));
}

/** Where a new plugin goes in a marketplace, as the `./` source its catalog entry lists; the category counts only where the marketplace keeps category folders. */
export function sourceFor(entries: Entry[], name: string, category: string): string {
  const layout = layoutOf(entries);
  if (layout.categorized) return `./${layout.root || 'plugins'}/${category}/${name}`;
  return `./${layout.root ? `${layout.root}/` : ''}${name}`;
}
