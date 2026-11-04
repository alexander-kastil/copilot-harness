// Reads one customization file for the element page: its frontmatter fields and its text. No vscode import.
// A .env style file is never opened. Reads at most MAX_BYTES of a file.
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { AgentsMdInfo, ElementDetail, ElementField } from '../shared/element';

const MAX_BYTES = 256 * 1024;

const text = (v: unknown): string => (typeof v === 'string' ? v : Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number') ? v.join(', ') : JSON.stringify(v));

const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(/[,\n]/) : []).map((s) => s.trim()).filter(Boolean);

export interface AgentsMdSettings {
  useAgentsMdFile: { value: boolean; from: string };
  useNestedAgentsMdFiles: { value: boolean; from: string };
}

/** Which folder an AGENTS.md applies to and whether VS Code chat loads it (chat.useAgentsMdFile attaches the root file; chat.useNestedAgentsMdFiles lists subfolder files for on-demand loading, Local sessions). */
export function agentsMdInfo(file: string, repoRoot: string, s: AgentsMdSettings): AgentsMdInfo {
  const rel = path.relative(repoRoot, path.dirname(file)).replace(/\\/g, '/');
  const nested = rel !== '' && !rel.startsWith('..');
  const appliesTo = nested ? `${rel}/ and below (the nearest AGENTS.md wins)` : 'The whole repository';
  const on = (k: keyof AgentsMdSettings) => `chat.${k} is ${s[k].value ? 'on' : 'off'} (${s[k].from})`;
  if (!s.useAgentsMdFile.value) return { appliesTo, loaded: false, vscode: `Not loaded: ${on('useAgentsMdFile')}` };
  if (!nested) return { appliesTo, loaded: true, vscode: `Attached to every Local chat request: ${on('useAgentsMdFile')}` };
  if (!s.useNestedAgentsMdFiles.value) return { appliesTo, loaded: false, vscode: `Not loaded: ${on('useNestedAgentsMdFiles')}` };
  return { appliesTo, loaded: true, vscode: `Listed for on-demand loading in Local sessions: ${on('useNestedAgentsMdFiles')}` };
}

/** Splits a markdown file into its frontmatter fields and the text after them. */
export function splitMarkdown(src: string): { fields: ElementField[]; body: string; invalid: boolean; data: Record<string, unknown> } {
  const t = src.replace(/^﻿/, '');
  const lines = t.split(/\r?\n/);
  if (lines[0]?.trimEnd() !== '---') return { fields: [], body: t, invalid: false, data: {} };
  const end = lines.findIndex((l, i) => i > 0 && l.trimEnd() === '---');
  if (end < 0) return { fields: [], body: t, invalid: true, data: {} };
  const body = lines.slice(end + 1).join('\n').replace(/^\n+/, '');
  try {
    const data: unknown = parseYaml(lines.slice(1, end).join('\n'));
    if (data === null || data === undefined) return { fields: [], body, invalid: false, data: {} };
    if (typeof data !== 'object' || Array.isArray(data)) return { fields: [], body, invalid: true, data: {} };
    const rec = data as Record<string, unknown>;
    return { fields: Object.entries(rec).map(([key, value]) => ({ key, value: text(value) })), body, invalid: false, data: rec };
  } catch {
    return { fields: [], body, invalid: true, data: {} };
  }
}

export async function readElement(file: string, markdown: boolean): Promise<ElementDetail> {
  const empty: ElementDetail = { file, folder: false, fields: [], body: '', tools: [], applyTo: [] };
  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    return empty;
  }
  if (stat.isDirectory()) {
    const entries = await fs.readdir(file, { withFileTypes: true }).catch(() => []);
    return { ...empty, folder: true, mtime: stat.mtimeMs, entries: entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort() };
  }
  const base = { ...empty, mtime: stat.mtimeMs, bytes: stat.size };
  if (/^\.env/i.test(path.basename(file))) return base;
  let raw: string;
  try {
    const handle = await fs.open(file, 'r');
    try {
      const buf = Buffer.alloc(Math.min(MAX_BYTES, stat.size));
      const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
      raw = buf.subarray(0, bytesRead).toString('utf8');
    } finally {
      await handle.close();
    }
  } catch {
    return base;
  }
  const truncated = stat.size > MAX_BYTES ? true : undefined;
  if (!markdown) return { ...base, body: raw, ...(truncated ? { truncated } : {}) };
  const split = splitMarkdown(raw);
  return {
    ...base,
    fields: split.fields,
    body: split.body,
    ...(split.invalid ? { invalid: true } : {}),
    ...(truncated ? { truncated } : {}),
    tools: list(split.data.tools ?? split.data['allowed-tools']),
    applyTo: list(split.data.applyTo),
  };
}

/** The prompt the Edit action hands to Copilot CLI. */
export const editPrompt = (kind: string, name: string, file: string): string =>
  `Read ${file}, a Copilot ${kind} named ${name}. Say what to improve, and make the changes I agree to.`;

/** The command line of the Try it action, or undefined when the kind cannot be tried. */
export function tryCommand(kind: string, name: string): string | undefined {
  if (!/^[\w.-]+$/.test(name)) return undefined;
  if (kind === 'agent' || kind === 'subagent') return `copilot --agent ${name}`;
  if (kind === 'skill' || kind === 'deterministic') return `copilot -i "/${name}"`;
  return undefined;
}
