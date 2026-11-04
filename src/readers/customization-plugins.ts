// Installed plugins: ~/.copilot/config.json lists them (installedPlugins), settings.json holds the
// enabled state (enabledPlugins), the files sit in ~/.copilot/installed-plugins/<marketplace>/<plugin>/.
// A plugin folder is also scanned for its skills, agents, commands, hooks and MCP servers.
// No vscode import.
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { CustomizationItem } from '../shared/customizations';
import { copilotHome, type Env } from './paths';
import {
  isDir,
  makeItem,
  readJson,
  scanHookFile,
  scanMarkdownDir,
  scanMcpFile,
  scanSkillsDir,
  type ScanContext,
} from './customization-scan';
import type { Scope } from '../shared/customizations';

/** Where a plugin manifest may sit: Claude layout, the plain plugin folder, the GitHub layout, the folder root. */
const MANIFESTS = ['.claude-plugin/plugin.json', '.plugin/plugin.json', '.github/plugin/plugin.json', 'plugin.json'];

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A path from a manifest, resolved inside the plugin folder; undefined when it points outside. */
function inside(root: string, rel: unknown): string | undefined {
  if (typeof rel !== 'string' || !rel) return undefined;
  const full = path.resolve(root, rel);
  const r = path.relative(root, full);
  return r.startsWith('..') || path.isAbsolute(r) ? undefined : full;
}

function paths(root: string, value: unknown, fallback: string): string[] {
  const list = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [fallback];
  return list.map((v) => inside(root, v)).filter((v): v is string => !!v);
}

/** The plugin itself plus everything inside it, for one plugin folder. */
export async function scanPluginDir(scope: Scope, dir: string, id: string, fallbackName: string, enabled: boolean, origin?: string): Promise<CustomizationItem[]> {
  const ctx: ScanContext = { scope, pluginId: id, readOnly: true, disabled: !enabled, origin };
  if (!(await isDir(dir))) return [makeItem({ scope, readOnly: true, pluginId: id, origin }, 'plugin', fallbackName, dir, undefined, 'unreadable')];

  let manifest: Record<string, unknown> = {};
  let manifestMtime: number | undefined;
  let status: 'ok' | 'invalid' | 'incomplete' = 'incomplete';
  for (const m of MANIFESTS) {
    const json = await readJson(path.join(dir, m));
    if (!json) continue;
    manifestMtime = json.mtime;
    if (json.ok && isRecord(json.data)) {
      manifest = json.data;
      status = 'ok';
    } else status = 'invalid';
    break;
  }
  const name = typeof manifest.name === 'string' && manifest.name ? manifest.name : fallbackName;
  const out: CustomizationItem[] = [makeItem(ctx, 'plugin', name, dir, manifestMtime, status)];

  for (const d of paths(dir, manifest.skills, 'skills')) out.push(...(await scanSkillsDir(ctx, d)));
  for (const d of paths(dir, manifest.agents, 'agents')) out.push(...(await scanMarkdownDir(ctx, d, 'agent', ['.agent.md', '.md'])));
  for (const d of paths(dir, manifest.commands, 'commands')) out.push(...(await scanMarkdownDir(ctx, d, 'prompt', ['.prompt.md', '.md'])));

  const hookFiles = typeof manifest.hooks === 'string' ? paths(dir, manifest.hooks, '') : [path.join(dir, 'hooks', 'hooks.json'), path.join(dir, 'copilot-hooks.json')];
  for (const f of hookFiles) out.push(...(await scanHookFile(ctx, f)));

  const mcpFiles = typeof manifest.mcpServers === 'string' ? paths(dir, manifest.mcpServers, '') : [path.join(dir, '.mcp.json')];
  for (const f of mcpFiles) out.push(...(await scanMcpFile(ctx, f, 'mcpServers')));
  return out;
}

async function subdirs(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const names = entries.filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => e.name);
    return names.sort();
  } catch {
    return [];
  }
}

const norm = (p: string): string => path.resolve(p).toLowerCase();

/** Every installed plugin of ~/.copilot: those config.json lists, plus folders it does not list. */
export async function readInstalledPlugins(env: Env): Promise<CustomizationItem[]> {
  const home = copilotHome(env);
  const config = await readJson(path.join(home, 'config.json'));
  const settings = await readJson(path.join(home, 'settings.json'));
  const enabledMap = isRecord(settings?.data) && isRecord(settings.data.enabledPlugins) ? settings.data.enabledPlugins : {};
  const listed = isRecord(config?.data) && Array.isArray(config.data.installedPlugins) ? config.data.installedPlugins : [];

  const out: CustomizationItem[] = [];
  const seen = new Set<string>();

  for (const entry of listed) {
    if (!isRecord(entry) || typeof entry.name !== 'string') continue;
    const marketplace = typeof entry.marketplace === 'string' && entry.marketplace ? entry.marketplace : '_direct';
    const id = `${entry.name}@${marketplace}`;
    const cache = typeof entry.cache_path === 'string' && entry.cache_path ? entry.cache_path : path.join(home, 'installed-plugins', marketplace, entry.name);
    seen.add(norm(cache));
    const fromSettings = enabledMap[id];
    const enabled = typeof fromSettings === 'boolean' ? fromSettings : entry.enabled !== false;
    out.push(...(await scanPluginDir('plugin', cache, id, entry.name, enabled, marketplace)));
  }

  const root = path.join(home, 'installed-plugins');
  for (const marketplace of await subdirs(root)) {
    for (const plugin of await subdirs(path.join(root, marketplace))) {
      const dir = path.join(root, marketplace, plugin);
      if (seen.has(norm(dir))) continue;
      const id = `${plugin}@${marketplace}`;
      const fromSettings = enabledMap[id];
      out.push(...(await scanPluginDir('plugin', dir, id, plugin, fromSettings !== false, marketplace)));
    }
  }
  return out;
}
