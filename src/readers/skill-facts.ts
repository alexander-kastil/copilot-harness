// What the panel says about a skill folder beyond its frontmatter: which agents load it, whether its SKILL.md meets the
// Agent Skills spec (agentskills.io/specification), and the Codex file agents/openai.yaml. No vscode import.
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ElementField } from '../shared/element';
import type { OpenAiInfo, SkillInfo } from '../shared/skills';
import { readFrontmatter } from './frontmatter';
import { sourceOfSkill } from './skill-locks';

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Problems of a SKILL.md against the Agent Skills spec; empty when it meets it. `folder` is the skill's folder name. */
export function specProblems(folder: string, data: Record<string, unknown> | undefined): string[] {
  const d = data ?? {};
  const out: string[] = [];
  const name = d.name;
  if (typeof name !== 'string' || !name.trim()) out.push('name is required');
  else {
    if (name.length > 64) out.push(`name is ${name.length} characters, at most 64`);
    if (!NAME_RE.test(name)) out.push('name may use only lowercase a-z, 0-9 and single hyphens, with no hyphen at the start or end');
    if (name !== folder) out.push(`name "${name}" must match the folder name "${folder}"`);
  }
  const description = d.description;
  if (typeof description !== 'string' || !description.trim()) out.push('description is required');
  else if (description.trim().length > 1024) out.push(`description is ${description.trim().length} characters, at most 1024`);
  if (d.license !== undefined && typeof d.license !== 'string') out.push('license must be text');
  if (d.compatibility !== undefined) {
    if (typeof d.compatibility !== 'string') out.push('compatibility must be text');
    else if (d.compatibility.length > 500) out.push(`compatibility is ${d.compatibility.length} characters, at most 500`);
  }
  if (d.metadata !== undefined) {
    const m = d.metadata;
    if (!m || typeof m !== 'object' || Array.isArray(m) || !Object.values(m).every((v) => typeof v === 'string')) out.push('metadata must map text keys to text values');
  }
  const tools = d['allowed-tools'];
  if (tools !== undefined && typeof tools !== 'string' && !(Array.isArray(tools) && tools.every((t) => typeof t === 'string'))) out.push('allowed-tools must be text (space separated tool names)');
  return out;
}

/** Agents that read a skill folder. Sources: GitHub Docs and VS Code docs (Copilot), code.claude.com, learn.chatgpt.com (Codex), cursor.com, geminicli.com, opencode.ai. */
const AGENTS = ['Claude Code', 'GitHub Copilot', 'Codex', 'Cursor', 'Gemini CLI', 'OpenCode'];

const readers = (dot: string, home: boolean): string[] => {
  if (dot === '.agents') return ['GitHub Copilot', 'Codex', 'Cursor', 'Gemini CLI', 'OpenCode'];
  if (dot === '.claude') return home ? ['Claude Code', 'Cursor', 'OpenCode'] : ['Claude Code', 'GitHub Copilot', 'Cursor', 'OpenCode'];
  if (dot === '.github' && !home) return ['GitHub Copilot'];
  if (dot === '.copilot' && home) return ['GitHub Copilot'];
  return [];
};

const same = (a: string, b: string): boolean => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);

/** The agents that load the skill at `file` (a SKILL.md) from its folder, and the agents of the list that do not. Both empty for a folder no agent is known to read (a plugin's). */
export function skillLoaders(file: string, home: string): { loadedBy: string[]; notReadBy: string[] } {
  const skillsDir = path.dirname(path.dirname(file));
  const dotDir = path.dirname(skillsDir);
  const loadedBy = path.basename(skillsDir) === 'skills' ? readers(path.basename(dotDir), same(path.dirname(dotDir), home)) : [];
  return { loadedBy, notReadBy: loadedBy.length ? AGENTS.filter((a) => !loadedBy.includes(a)) : [] };
}

/** The loaders of a skill by name: a skill copied to several skill folders of one root is listed once, so every copy's readers count. */
export async function loadersOfSkill(file: string, home: string): Promise<{ loadedBy: string[]; notReadBy: string[] }> {
  const name = path.basename(path.dirname(file));
  const root = path.dirname(path.dirname(path.dirname(path.dirname(file))));
  const copies = [file];
  for (const dot of ['.github', '.claude', '.agents', '.copilot']) {
    const other = path.join(root, dot, 'skills', name, 'SKILL.md');
    if (!same(other, file) && (await fs.stat(other).then((s) => s.isFile(), () => false))) copies.push(other);
  }
  const loadedBy = AGENTS.filter((a) => copies.some((c) => skillLoaders(c, home).loadedBy.includes(a)));
  return { loadedBy, notReadBy: loadedBy.length ? AGENTS.filter((a) => !loadedBy.includes(a)) : [] };
}

const flat = (value: unknown, prefix: string, out: ElementField[]): void => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) flat(v, prefix ? `${prefix}.${k}` : k, out);
  } else if (prefix) out.push({ key: prefix, value: typeof value === 'string' ? value : JSON.stringify(value) });
};

/** agents/openai.yaml next to a SKILL.md, or undefined when the skill has none or it cannot be read. */
export async function readOpenAi(skillFile: string): Promise<OpenAiInfo | undefined> {
  const file = path.join(path.dirname(skillFile), 'agents', 'openai.yaml');
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch {
    return undefined;
  }
  let data: unknown;
  try {
    data = parseYaml(text);
  } catch {
    // A file that does not parse still shows, with no fields.
    return { file, fields: [], implicit: true };
  }
  const fields: ElementField[] = [];
  flat(data, '', fields);
  const policy = data && typeof data === 'object' ? (data as Record<string, unknown>).policy : undefined;
  const implicit = !(policy && typeof policy === 'object' && (policy as Record<string, unknown>).allow_implicit_invocation === false);
  return { file, fields, implicit };
}

/** Everything the element page shows about the skill whose SKILL.md is `file`. `repoRoot` is the repository the skill lives in, when it lives in one. */
export async function skillInfo(file: string, home: string, repoRoot: string | undefined): Promise<SkillInfo> {
  const fm = (await readFrontmatter(file))?.fm;
  const source = await sourceOfSkill(file, home, repoRoot);
  const openai = await readOpenAi(file);
  return {
    ...(await loadersOfSkill(file, home)),
    // A frontmatter that does not parse is already reported as such.
    problems: fm?.ok ? specProblems(path.basename(path.dirname(file)), fm.data) : [],
    ...(source ? { source } : {}),
    ...(openai ? { openai } : {}),
  };
}

/** The agents that read an AGENTS file, in words, or undefined for a file that is not one. Per code.claude.com, learn.chatgpt.com and docs.cline.bot. */
export function agentsReadBy(file: string, home: string): string | undefined {
  const base = path.basename(file).toLowerCase();
  const dir = path.dirname(file);
  if (base === 'agents.md') {
    if (same(dir, path.join(home, '.codex'))) return 'Codex, as its global file (AGENTS.override.md in the same folder wins when present).';
    if (same(dir, path.join(home, '.agents'))) return 'Cline, as a global file. Only the Cline docs name it; no other agent documents ~/.agents/AGENTS.md.';
    return 'GitHub Copilot in VS Code, Codex, Cursor, OpenCode and Cline. Claude Code reads it in place of CLAUDE.md. Gemini CLI reads it only when context.fileName lists it.';
  }
  if (base === 'agents.override.md') return 'Codex: in each folder it reads AGENTS.override.md before AGENTS.md. Claude Code does not read it.';
  if (base === 'agents.local.md') return 'No agent documents reading it. Claude Code does not read it.';
  return undefined;
}
