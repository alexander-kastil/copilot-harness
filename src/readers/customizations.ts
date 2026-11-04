// The customization inventory (#7): every Copilot customization of the workspace folders, the VS Code
// user profile, ~/.copilot, harness-agnostic home folders and installed plugins, as one typed list.
// Pure: paths come in through Env and InventoryOptions, nothing is written. No vscode import.
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { CustomizationItem, Inventory, InventoryOptions } from '../shared/customizations';
import { scanPluginDir, readInstalledPlugins } from './customization-plugins';
import {
  isDir,
  isFile,
  scanHookFile,
  scanMarkdownDir,
  scanMcpFile,
  scanNamedFiles,
  scanSkillsDir,
  type ScanContext,
} from './customization-scan';
import { agentHooksOf, classifyRules, dedupe, readPathSetting, scanInstructionLocations, scanCopilotMemory, scanNestedAgentsMd, scanPluginLocations } from './customization-extra';
import { scanCliTrust, scanHarnessRoot, scanToolSets, subagentsOf } from './customization-harness';
import { copilotHome, currentEnv, userDataDirs, userDir, type Env } from './paths';

const INSTRUCTION = ['.instructions.md'];
const AGENT = ['.agent.md', '.md'];

/** The folders of one workspace root, or of a parent folder reached by the parent lookup. */
async function scanWorkspaceRoot(root: string, inParent: boolean): Promise<CustomizationItem[]> {
  const ctx: ScanContext = { scope: 'workspace', inParent };
  const gh = path.join(root, '.github');
  const claude = path.join(root, '.claude');
  const out: CustomizationItem[] = [];
  // General instructions: always-on files. Stack-specific instructions: loaded when their applyTo (or paths) matches.
  out.push(
    ...(await scanNamedFiles(ctx, 'instruction', [
      path.join(gh, 'copilot-instructions.md'),
      path.join(root, '.copilot-instructions.md'),
      path.join(root, 'AGENTS.md'),
      path.join(root, 'CLAUDE.md'),
      path.join(claude, 'CLAUDE.md'),
    ]))
  );
  if (!inParent) {
    out.push(...(await scanNestedAgentsMd(ctx, root)));
    const userSettings = userDataDirs(currentEnv()).map((v) => path.join(userDir(v.dir), 'settings.json'));
    out.push(...(await scanCopilotMemory(ctx, root, userSettings)));
  }
  out.push(...(await scanMarkdownDir(ctx, path.join(gh, 'instructions'), 'stack', INSTRUCTION)));
  out.push(...classifyRules(await scanMarkdownDir(ctx, path.join(claude, 'rules'), 'instruction', ['.md'])));
  const settings = path.join(root, '.vscode', 'settings.json');
  out.push(...(await scanInstructionLocations(ctx, await readPathSetting(settings, 'chat.instructionsFilesLocations'), root)));
  out.push(...(await scanMarkdownDir(ctx, path.join(gh, 'prompts'), 'prompt', ['.prompt.md'])));
  out.push(...(await scanMarkdownDir(ctx, path.join(gh, 'agents'), 'agent', AGENT)));
  out.push(...(await scanMarkdownDir(ctx, path.join(claude, 'agents'), 'agent', ['.md'])));
  for (const d of [path.join(gh, 'skills'), path.join(claude, 'skills'), path.join(root, '.agents', 'skills')]) out.push(...(await scanSkillsDir(ctx, d)));
  for (const f of await listJson(path.join(gh, 'hooks'))) out.push(...(await scanHookFile(ctx, f)));
  // A hook installed as a folder (awesome-copilot): .github/hooks/<name>/hooks.json next to its scripts, named after the folder.
  for (const dir of await subdirs(path.join(gh, 'hooks'))) {
    for (const hit of await scanHookFile(ctx, path.join(dir, 'hooks.json'))) out.push({ ...hit, name: path.basename(dir) });
  }
  out.push(...(await scanHookFile(ctx, path.join(gh, 'hooks.json'))));
  for (const f of ['settings.json', 'settings.local.json']) out.push(...(await scanHookFile(ctx, path.join(claude, f), 'hooks')));
  out.push(...(await scanMcpFile(ctx, path.join(root, '.vscode', 'mcp.json'), 'servers')));
  out.push(...(await scanMcpFile(ctx, path.join(root, '.mcp.json'), 'mcpServers')));
  for (const dir of await subdirs(path.join(gh, 'plugins'))) {
    const name = path.basename(dir);
    const items = await scanPluginDir('workspace', dir, `${name}@workspace`, name, true);
    out.push(...items.map((i) => (inParent ? { ...i, inParent: true } : i)));
  }
  const located = await scanPluginLocations('workspace', await readPathSetting(settings, 'chat.pluginLocations'), root);
  out.push(...located.map((i) => (inParent ? { ...i, inParent: true } : i)));
  out.push(...(await scanHarnessRoot(root, ctx)));
  const found = dedupe(out);
  return [...found, ...(await subagentsOf(found)), ...agentHooksOf(found)];
}

async function listJson(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).filter((n) => n.toLowerCase().endsWith('.json')).sort().map((n) => path.join(dir, n));
  } catch {
    return [];
  }
}

async function subdirs(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name)).sort();
  } catch {
    return [];
  }
}

/** Parent folders of a workspace folder up to and including the first one with `.git`; none when no repo root is found. */
export async function parentFolders(folder: string): Promise<string[]> {
  const chain: string[] = [];
  let dir = path.resolve(folder);
  if (await hasGit(dir)) return [];
  for (;;) {
    const parent = path.dirname(dir);
    if (parent === dir) return [];
    chain.push(parent);
    if (await hasGit(parent)) return chain;
    dir = parent;
  }
}

async function hasGit(dir: string): Promise<boolean> {
  return (await isDir(path.join(dir, '.git'))) || (await isFile(path.join(dir, '.git')));
}

/** Workspace scope: the open folders, plus their parent folders up to the repo root when `parentLookup` is on. */
export async function readWorkspace(opts: InventoryOptions): Promise<CustomizationItem[]> {
  const roots = new Map<string, boolean>();
  for (const f of opts.workspaceFolders) roots.set(path.resolve(f), false);
  if (opts.parentLookup) {
    for (const f of opts.workspaceFolders) {
      for (const p of await parentFolders(f)) if (!roots.has(p)) roots.set(p, true);
    }
  }
  const out: CustomizationItem[] = [];
  for (const [root, inParent] of roots) out.push(...(await scanWorkspaceRoot(root, inParent)));
  return out;
}

async function scanUserDir(ctx: ScanContext, user: string): Promise<CustomizationItem[]> {
  const prompts = path.join(user, 'prompts');
  const settings = path.join(user, 'settings.json');
  return [
    ...(await scanMarkdownDir(ctx, prompts, 'prompt', ['.prompt.md'])),
    ...(await scanMarkdownDir(ctx, prompts, 'agent', ['.agent.md'])),
    ...(await scanMarkdownDir(ctx, prompts, 'stack', INSTRUCTION)),
    ...(await scanMcpFile(ctx, path.join(user, 'mcp.json'), 'servers')),
    ...(await scanToolSets(ctx, prompts)),
    ...(await scanInstructionLocations(ctx, await readPathSetting(settings, 'chat.instructionsFilesLocations'), undefined)),
    ...(await scanPluginLocations('userProfile', await readPathSetting(settings, 'chat.pluginLocations'), undefined, ctx.origin)),
  ];
}

/** VS Code user profile scope: prompts and mcp.json of every installed variant and every named profile. */
export async function readUserProfile(env: Env): Promise<CustomizationItem[]> {
  const out: CustomizationItem[] = [];
  for (const v of userDataDirs(env)) {
    const user = userDir(v.dir);
    if (!(await isDir(user))) continue;
    out.push(...(await scanUserDir({ scope: 'userProfile', origin: v.variant }, user)));
    for (const profile of await subdirs(path.join(user, 'profiles'))) {
      out.push(...(await scanUserDir({ scope: 'userProfile', origin: `${v.variant}/${path.basename(profile)}` }, profile)));
    }
  }
  return out;
}

/** ~/.copilot scope: skills, instructions, agents, copilot-instructions.md and mcp-config.json. */
export async function readCopilotHome(env: Env): Promise<CustomizationItem[]> {
  const home = copilotHome(env);
  const ctx: ScanContext = { scope: 'copilotHome' };
  return [
    ...(await scanSkillsDir(ctx, path.join(home, 'skills'))),
    ...(await scanMarkdownDir(ctx, path.join(home, 'instructions'), 'stack', INSTRUCTION)),
    ...(await scanMarkdownDir(ctx, path.join(home, 'agents'), 'agent', AGENT)),
    ...(await scanNamedFiles(ctx, 'instruction', [path.join(home, 'copilot-instructions.md')])),
    ...(await scanMcpFile(ctx, path.join(home, 'mcp-config.json'), 'mcpServers')),
    ...(await scanCliTrust(ctx, path.join(home, 'config.json'))),
  ];
}

/** Harness-agnostic home folders VS Code also reads: ~/.claude (rules, agents, skills, hooks) and ~/.agents/skills. */
export async function readHome(env: Env): Promise<CustomizationItem[]> {
  const ctx: ScanContext = { scope: 'home' };
  const claude = path.join(env.home, '.claude');
  return [
    ...(await scanNamedFiles(ctx, 'instruction', [path.join(claude, 'CLAUDE.md')])),
    ...classifyRules(await scanMarkdownDir(ctx, path.join(claude, 'rules'), 'instruction', ['.md'])),
    ...(await scanMarkdownDir(ctx, path.join(claude, 'agents'), 'agent', ['.md'])),
    ...(await scanMcpFile(ctx, path.join(env.home, '.mcp.json'), 'mcpServers')),
    ...(await scanSkillsDir(ctx, path.join(claude, 'skills'))),
    ...(await scanSkillsDir(ctx, path.join(env.home, '.agents', 'skills'))),
    ...(await scanHookFile(ctx, path.join(claude, 'settings.json'), 'hooks')),
  ];
}

/** The whole inventory: one item per customization across all scopes. */
export async function readCustomizations(env: Env, opts: InventoryOptions): Promise<Inventory> {
  const parts = await Promise.all([readWorkspace(opts), readUserProfile(env), readCopilotHome(env), readHome(env), readInstalledPlugins(env)]);
  // The workspace items carry their own subagents and agent hooks; the other scopes get them here.
  const rest = dedupe(parts.slice(1).flat());
  return { items: [...parts[0], ...rest, ...(await subagentsOf(rest)), ...agentHooksOf(rest)] };
}
