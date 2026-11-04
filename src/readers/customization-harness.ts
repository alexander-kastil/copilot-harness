// The six harness kinds around the core customizations: subagents, tools, agentic workflows, GitHub Actions
// workflows, environment files and governance files. Names, file paths and times only: no file text is
// kept, and a .env style file is never opened. No vscode import.
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { CustomizationItem } from '../shared/customizations';
import { isFile, listFiles, makeItem, markdownItem, readJson, type ScanContext } from './customization-scan';
import { readFrontmatter } from './frontmatter';

async function plainItem(ctx: ScanContext, kind: CustomizationItem['kind'], name: string, file: string): Promise<CustomizationItem> {
  try {
    return makeItem(ctx, kind, name, file, (await fs.stat(file)).mtimeMs, 'ok');
  } catch {
    return makeItem(ctx, kind, name, file, undefined, 'unreadable');
  }
}

async function namedFiles(ctx: ScanContext, kind: CustomizationItem['kind'], files: string[]): Promise<CustomizationItem[]> {
  const out: CustomizationItem[] = [];
  for (const f of files) if (await isFile(f)) out.push(await plainItem(ctx, kind, path.basename(f), f));
  return out;
}

/** The top-level files of a folder whose name passes the filter, sorted. */
async function topFiles(dir: string, accept: (name: string) => boolean): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && accept(e.name)).map((e) => path.join(dir, e.name)).sort();
  } catch {
    return [];
  }
}

const isSetupSteps = (n: string): boolean => /^copilot-setup-steps\.ya?ml$/i.test(n);
const isLock = (n: string): boolean => /\.lock\.ya?ml$/i.test(n);

/**
 * The harness files of one workspace root.
 * Agentic workflows: GitHub Agentic Workflows keeps the Markdown source and its compiled `.lock.yml` in `.github/workflows/`.
 * GitHub Actions: the other workflow YAML files there. Environment: `copilot-setup-steps.yml` (Copilot coding agent) and dev containers.
 * Governance: CODEOWNERS in `.github/`, the root or `docs/`, and `.github/workflows/aw.json` (strict mode of Agentic Workflows).
 */
export async function scanHarnessRoot(root: string, ctx: ScanContext): Promise<CustomizationItem[]> {
  const out: CustomizationItem[] = [];
  const workflows = path.join(root, '.github', 'workflows');
  for (const f of await topFiles(workflows, (n) => /\.md$/i.test(n))) out.push(await markdownItem(ctx, 'agentic', f, path.basename(f).replace(/\.md$/i, '')));
  for (const f of await topFiles(workflows, (n) => /\.ya?ml$/i.test(n) && !isLock(n) && !isSetupSteps(n))) out.push(await plainItem(ctx, 'ci', path.basename(f), f));
  for (const f of await topFiles(workflows, isSetupSteps)) out.push(await plainItem(ctx, 'env', path.basename(f), f));

  const dev = path.join(root, '.devcontainer');
  const devFiles = [path.join(dev, 'devcontainer.json'), path.join(root, '.devcontainer.json')];
  try {
    for (const e of (await fs.readdir(dev, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory()) devFiles.push(path.join(dev, e.name, 'devcontainer.json'));
    }
  } catch {
    // no .devcontainer folder
  }
  for (const f of devFiles) {
    if (await isFile(f)) out.push(await plainItem(ctx, 'env', path.relative(root, f).replace(/\\/g, '/'), f));
  }

  out.push(...(await namedFiles(ctx, 'governance', [path.join(root, '.github', 'CODEOWNERS'), path.join(root, 'CODEOWNERS'), path.join(root, 'docs', 'CODEOWNERS'), path.join(workflows, 'aw.json')])));
  return out;
}

/** VS Code tool set files (`*.toolsets.jsonc`) in a user profile prompts folder. */
export async function scanToolSets(ctx: ScanContext, dir: string): Promise<CustomizationItem[]> {
  const files = await listFiles(dir, (n) => n.toLowerCase().endsWith('.toolsets.jsonc'));
  return Promise.all(files.map((f) => plainItem(ctx, 'tool', path.basename(f).replace(/\.toolsets\.jsonc$/i, ''), f)));
}

/** The Copilot CLI's config.json when it holds trusted folders: the folder permissions of the CLI. The folder list itself is not read out. */
export async function scanCliTrust(ctx: ScanContext, file: string): Promise<CustomizationItem[]> {
  const json = await readJson(file);
  if (!json?.ok || !json.data || typeof json.data !== 'object') return [];
  const trusted = (json.data as Record<string, unknown>).trustedFolders;
  return Array.isArray(trusted) && trusted.length ? [makeItem(ctx, 'governance', 'config.json trusted folders', file, json.mtime, 'ok')] : [];
}

/** Every agent item that other agents may call as a subagent, as a 'subagent' item; `disable-model-invocation: true` (or the old `infer: false`) keeps an agent out. */
export async function subagentsOf(items: CustomizationItem[]): Promise<CustomizationItem[]> {
  const out: CustomizationItem[] = [];
  for (const i of items) {
    if (i.kind !== 'agent' || i.status === 'unreadable' || i.status === 'invalid') continue;
    const read = await readFrontmatter(i.file);
    if (read?.fm.disableModelInvocation) continue;
    out.push({ ...i, kind: 'subagent' });
  }
  return out;
}
