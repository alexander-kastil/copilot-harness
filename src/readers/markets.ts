// The marketplaces Copilot knows, with their plugins and which installed plugins are behind their source. No vscode import.
//
// Where the data is (checked on a scratch Copilot CLI 1.0.105 home):
// - ~/.copilot/settings.json, `extraKnownMarketplaces`: name -> { source: { source: github | git | directory, repo | url | path } }. This is what
//   `copilot plugin marketplace add/list/remove` writes and reads; `enabledPlugins` ("plugin@marketplace": true) is the enabled state.
//   awesome-copilot (github/awesome-copilot) is built in and never listed there.
// - ~/.copilot/config.json, `installedPlugins`: one entry per copied plugin (name, marketplace, version, cache_path, enabled).
//   A plugin from a local folder marketplace is "live": loaded from the folder, listed in settings.json only, never in config.json.
// - VS Code: setting `chat.plugins.marketplaces` (passed in by the host), and ~/.vscode/agent-plugins/installed.json for the plugins VS Code
//   installed itself (pluginUri, marketplace "owner/repo"). VS Code clones a marketplace to ~/.vscode/agent-plugins/github.com/<owner>/<repo>.
// - A catalog is read from marketplace.json, .plugin/marketplace.json, .github/plugin/marketplace.json or .claude-plugin/marketplace.json
//   (https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEdits, modify, parse as parseJsonc } from 'jsonc-parser';
import type { MarketHealth, MarketKind, MarketPlugin, RenameFile } from '../shared/markets';
import { copilotHome, type Env } from './paths';

type Json = Record<string, any>;

const readText = (file: string): string | undefined => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
};

const readJson = (file: string): Json => {
  const text = readText(file);
  if (text === undefined) return {};
  try {
    const value = parseJsonc(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
};

const CATALOGS = [['.github', 'plugin', 'marketplace.json'], ['marketplace.json'], ['.plugin', 'marketplace.json'], ['.claude-plugin', 'marketplace.json']];
const MANIFESTS = [['.claude-plugin', 'plugin.json'], ['.plugin', 'plugin.json'], ['.github', 'plugin', 'plugin.json'], ['plugin.json']];

export const catalogFile = (location: string): string | undefined => (location ? CATALOGS.map((p) => path.join(location, ...p)).find((f) => fs.existsSync(f)) : undefined);

const manifestOf = (dir: string | undefined): Json => {
  if (!dir) return {};
  for (const m of MANIFESTS) {
    const j = readJson(path.join(dir, ...m));
    if (Object.keys(j).length) return j;
  }
  return {};
};

export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.replace(/^v/, '').split(/[.+-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const [p, q] = [x[i] ?? 0, y[i] ?? 0];
    if (p === q) continue;
    if (typeof p === 'number' && typeof q === 'number') return p - q;
    return String(p).localeCompare(String(q));
  }
  return 0;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** A marketplace named by one string, as `chat.plugins.marketplaces` lists it: `owner/repo`, a git URL or an scp-style address. */
function kindOfString(s: string): { kind: MarketKind; repo?: string } {
  if (/^[\w.-]+\/[\w.-]+$/.test(s)) return { kind: 'github', repo: s };
  const gh = /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i.exec(s);
  if (gh) return { kind: 'github', repo: gh[1] };
  return { kind: /^https?:/i.test(s) ? 'url' : 'git' };
}

interface Raw {
  name: string;
  source: string;
  kind: MarketKind;
  repo?: string;
  location: string;
  builtin?: boolean;
  where: MarketHealth['where'];
}

const sameRepo = (a: Raw, b: Raw) => !!a.repo && !!b.repo && a.repo.toLowerCase() === b.repo.toLowerCase();

export function readMarkets(env: Env, vscodeMarkets: string[] = []): MarketHealth[] {
  const home = copilotHome(env);
  const settings = readJson(path.join(home, 'settings.json'));
  const config = readJson(path.join(home, 'config.json'));
  const vscodeHome = path.join(env.home, '.vscode', 'agent-plugins');

  const raws: Raw[] = [];
  for (const [name, entry] of Object.entries((settings.extraKnownMarketplaces ?? {}) as Record<string, Json>)) {
    const s = (entry?.source ?? {}) as Json;
    const kind = (str(s.source) ?? 'unknown') as MarketKind;
    const repo = str(s.repo);
    const source = repo ?? str(s.url) ?? str(s.path) ?? '';
    raws.push({ name, source, kind, repo, location: kind === 'directory' ? path.resolve(str(s.path) ?? '') : '', where: ['Copilot CLI'] });
  }
  if (!raws.some((r) => r.name === 'awesome-copilot' || r.repo?.toLowerCase() === 'github/awesome-copilot')) {
    raws.push({ name: 'awesome-copilot', source: 'github/awesome-copilot', kind: 'github', repo: 'github/awesome-copilot', location: '', builtin: true, where: ['Copilot CLI'] });
  }
  for (const entry of vscodeMarkets) {
    // VS Code's own default is written with a ref: `github/awesome-copilot#marketplace`.
    const s = entry.replace(/#.*$/, '');
    const { kind, repo } = kindOfString(s);
    const mine: Raw = { name: repo ? repo.split('/')[1] : s.replace(/\.git$/, '').split(/[/:]/).pop() || s, source: repo ?? s, kind, repo, location: '', where: ['VS Code'] };
    const twin = raws.find((r) => sameRepo(r, mine) || (!mine.repo && r.source === mine.source));
    if (twin) twin.where.push('VS Code');
    else raws.push(mine);
  }

  const installedList = (Array.isArray(config.installedPlugins) ? config.installedPlugins : []) as Json[];
  const enabledMap = (settings.enabledPlugins ?? {}) as Record<string, unknown>;
  const vscodeInstalled = ((readJson(path.join(vscodeHome, 'installed.json')).installed ?? []) as Json[]).filter((e) => e && typeof e === 'object');

  return raws
    .map((r): MarketHealth => {
      let location = r.location;
      if (!location && r.repo) {
        const [owner, repo] = r.repo.split('/');
        location = [path.join(vscodeHome, 'github.com', owner, repo), path.join(home, 'marketplace-cache', `${owner}-${repo}`)].find((d) => catalogFile(d)) ?? '';
      }
      const catalog = (Array.isArray(readJson(catalogFile(location) ?? '').plugins) ? readJson(catalogFile(location) ?? '').plugins : []) as Json[];

      // name -> where the installed copy sits and which version it has
      const copies = new Map<string, { version?: string; dir?: string; enabled?: boolean; live?: boolean }>();
      for (const e of installedList) {
        if (str(e.name) && (str(e.marketplace) ?? '') === r.name) copies.set(e.name, { version: str(e.version), dir: str(e.cache_path), enabled: e.enabled !== false });
      }
      for (const e of vscodeInstalled) {
        if (!r.where.includes('VS Code') || (r.repo ? str(e.marketplace)?.toLowerCase() !== r.repo.toLowerCase() : str(e.marketplace) !== r.source)) continue;
        const rel = str(e.relativePath);
        let dir: string | undefined;
        try {
          dir = str(e.pluginUri) ? fileURLToPath(e.pluginUri) : undefined;
        } catch {
          dir = undefined;
        }
        const plugin = (rel ?? dir ?? '').split(/[\\/]/).filter(Boolean).pop();
        if (plugin && !copies.has(plugin)) copies.set(plugin, { dir, enabled: true });
      }
      // Copilot CLI's own folders: ~/.copilot/installed-plugins/<marketplace>/<plugin>
      try {
        for (const d of fs.readdirSync(path.join(home, 'installed-plugins', r.name), { withFileTypes: true })) {
          if (d.isDirectory() && !copies.has(d.name)) copies.set(d.name, { dir: path.join(home, 'installed-plugins', r.name, d.name), enabled: true });
        }
      } catch {
        // no folder, nothing installed there
      }
      const suffix = `@${r.name}`;
      const enabledKeys = Object.keys(enabledMap).filter((k) => k.endsWith(suffix) && k.length > suffix.length);
      const names = new Set<string>([...catalog.map((p) => str(p.name)).filter((n): n is string => !!n), ...copies.keys(), ...enabledKeys.map((k) => k.slice(0, -suffix.length))]);

      const plugins = [...names].map((name): MarketPlugin => {
        const entry = catalog.find((p) => p.name === name);
        const key = `${name}${suffix}`;
        const sourceDir = r.kind === 'directory' || location ? (typeof entry?.source === 'string' ? path.resolve(location, entry.source) : location ? path.join(location, name) : undefined) : undefined;
        const sourceManifest = manifestOf(sourceDir && fs.existsSync(sourceDir) ? sourceDir : undefined);
        const sourceVersion = str(entry?.version) ?? str(sourceManifest.version);
        const copy = copies.get(name);
        // A plugin enabled from a local folder without a copy is live: it runs from the marketplace's folder at its source version.
        const live = !copy && r.kind === 'directory' && key in enabledMap;
        const copyManifest = copy?.dir ? manifestOf(copy.dir) : {};
        const installed = live ? sourceVersion : copy ? (copy.version ?? str(copyManifest.version)) : undefined;
        const fromSettings = enabledMap[key];
        const enabled = copy || live ? (typeof fromSettings === 'boolean' ? fromSettings : copy?.enabled !== false) : false;
        return {
          name,
          key,
          ...(installed ? { installed } : {}),
          ...(sourceVersion ? { source: sourceVersion } : {}),
          ahead: !!(installed && sourceVersion && !live && compareVersions(sourceVersion, installed) > 0),
          enabled,
          ...(live ? { live: true } : {}),
          ...(str(entry?.description) ?? str(sourceManifest.description) ?? str(copyManifest.description) ? { description: str(entry?.description) ?? str(sourceManifest.description) ?? str(copyManifest.description) } : {}),
          ...((copy?.dir ?? sourceDir) ? { dir: copy?.dir ?? sourceDir } : {}),
        };
      });
      plugins.sort((a, b) => Number(b.ahead) - Number(a.ahead) || a.name.localeCompare(b.name));
      return { name: r.name, source: r.source, kind: r.kind, location, ...(r.builtin ? { builtin: true } : {}), where: r.where, plugins };
    })
    .sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name));
}

// ---- Rename a directory marketplace ----

export interface FileEdit {
  file: string;
  before: string;
  after: string;
}

const eolOf = (text: string) => (text.includes('\r\n') ? '\r\n' : '\n');

/** Copilot CLI's settings.json: the marketplace entry and the enabledPlugins keys of its plugins move to the new name. */
export function renameInSettings(file: string, from: string, to: string): FileEdit | undefined {
  const before = readText(file);
  if (before === undefined) return undefined;
  const data = readJson(file);
  const fmt = { formattingOptions: { insertSpaces: true, tabSize: 2, eol: eolOf(before) } };
  let text = before;
  for (const [key, value] of Object.entries((data.enabledPlugins ?? {}) as Record<string, unknown>)) {
    if (!key.endsWith(`@${from}`)) continue;
    text = applyEdits(text, modify(text, ['enabledPlugins', key], undefined, fmt));
    text = applyEdits(text, modify(text, ['enabledPlugins', `${key.slice(0, -from.length)}${to}`], value, fmt));
  }
  const markets = (data.extraKnownMarketplaces ?? {}) as Record<string, unknown>;
  if (from in markets) {
    text = applyEdits(text, modify(text, ['extraKnownMarketplaces', from], undefined, fmt));
    text = applyEdits(text, modify(text, ['extraKnownMarketplaces', to], markets[from], fmt));
  }
  return text === before ? undefined : { file, before, after: text };
}

/** The marketplace's own catalog: its `name` becomes the new name. */
export function renameCatalog(location: string, to: string): FileEdit | undefined {
  const file = catalogFile(location);
  const before = file && readText(file);
  if (!file || before === undefined || before === '') return undefined;
  const after = applyEdits(before, modify(before, ['name'], to, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: eolOf(before) } }));
  return after === before ? undefined : { file, before, after };
}

const NAME = /^[a-z0-9][a-z0-9-]*$/;

/** The terminal commands that re-register a renamed directory marketplace and install its plugins again. */
export function renameCommands(market: MarketHealth, to: string): string[] {
  const installed = market.plugins.filter((p) => p.installed).map((p) => p.name);
  return [`copilot plugin marketplace remove ${market.name} --force`, `copilot plugin marketplace add "${market.location}"`, ...installed.map((p) => `copilot plugin install ${p}@${to}`)];
}

export interface RenamePlan {
  edits: FileEdit[];
  files: RenameFile[];
  commands: string[];
  error?: string;
}

export function planRename(env: Env, markets: MarketHealth[], from: string, to: string): RenamePlan {
  const none = (error: string): RenamePlan => ({ edits: [], files: [], commands: [], error });
  const market = markets.find((m) => m.name === from);
  if (!market) return none(`There is no marketplace named ${from}.`);
  if (market.kind !== 'directory') return none(`${from} is a ${market.kind} marketplace: its name comes from the marketplace.json at its source, so rename it there.`);
  if (!NAME.test(to)) return none('The name takes lowercase letters, digits and dashes.');
  if (markets.some((m) => m.name === to)) return none(`${to} already exists.`);
  const edits = [renameInSettings(path.join(copilotHome(env), 'settings.json'), from, to), renameCatalog(market.location, to)].filter((e): e is FileEdit => !!e);
  return { edits, files: edits.map((e) => ({ file: e.file, detail: path.basename(e.file) === 'settings.json' ? `@${from} to @${to}` : `name: ${to}` })), commands: renameCommands(market, to) };
}
