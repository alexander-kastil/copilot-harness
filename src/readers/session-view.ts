// The Sessions page and session detail page data, built from the merged session read. Pure: no vscode import.
import * as path from 'node:path';
import { creditsOf, SOURCE_PRIORITY } from '../shared/reconcile';
import type { SessionSummary, SubagentRun } from '../shared/session-model';
import type { UsedInDay, UsedInSession } from '../shared/element';
import type { SessionDetailData, SessionListRow, SessionSubagent } from '../shared/sessions';
import type { AllSessions } from './all-sessions';
import { folderOf, mergeSessions, SOURCE_LABEL } from './overview';

interface Extras {
  branch?: string;
  repository?: string;
  resumable: boolean;
  sources: string[];
  skills?: number;
  toolCalls?: number;
  subagents?: SubagentRun[];
  snapshots?: number;
  cliFile?: string;
}

/** What only some of a session's records know (branch, CLI snapshots), joined by session id. */
function extrasById(all: AllSessions): Map<string, Extras> {
  const out = new Map<string, Extras>();
  for (const source of SOURCE_PRIORITY) {
    for (const s of all[source].sessions) {
      const e = out.get(s.id) ?? { resumable: false, sources: [] };
      e.sources.push(SOURCE_LABEL[source]);
      e.branch ??= s.branch;
      e.repository ??= s.repository;
      e.skills ??= s.skills;
      e.toolCalls ??= s.toolCalls;
      if (!e.subagents?.length && s.subagents?.length) e.subagents = s.subagents;
      if (source === 'cli') {
        e.resumable = true;
        e.cliFile = s.file;
      }
      if (s.snapshotDir) e.snapshots = s.snapshotDir.count;
      out.set(s.id, e);
    }
  }
  return out;
}

const tokenTotal = (s: SessionSummary): number | undefined => {
  const t = s.tokens;
  if (!t || (t.input === undefined && t.output === undefined)) return undefined;
  return (t.input ?? 0) + (t.output ?? 0);
};

/** The sessions that called the skill `name` (case-insensitive), newest first, and its calls per day over the last 7 days. */
export function skillUsage(all: AllSessions, name: string, now = Date.now()): { sessions: UsedInSession[]; days: UsedInDay[] } {
  const want = name.trim().toLowerCase();
  const titles = new Map(sessionListRows(all).map((r) => [r.id, r]));
  const sessions: UsedInSession[] = [];
  const stamps: number[] = [];
  for (const s of all.cli.sessions) {
    const uses = (s.skillUses ?? []).filter((u) => u.name.toLowerCase() === want);
    if (!uses.length) continue;
    const times = uses.map((u) => Date.parse(u.at ?? '')).filter((t) => !Number.isNaN(t));
    stamps.push(...times);
    const row = titles.get(s.id);
    const last = times.length ? new Date(Math.max(...times)).toISOString() : undefined;
    sessions.push({ id: s.id, ...(row?.title ? { title: row.title } : {}), ...(row?.repository ? { repository: row.repository } : {}), ...(last ? { last } : {}), count: uses.length });
  }
  sessions.sort((a, b) => Date.parse(b.last ?? '') - Date.parse(a.last ?? '') || 0);
  const today = new Date(new Date(now).toDateString()).getTime();
  const days: UsedInDay[] = Array.from({ length: 7 }, (_, i) => {
    const at = today - (6 - i) * 864e5;
    return { at, n: stamps.filter((t) => t >= at && t < at + 864e5).length };
  });
  return { sessions, days };
}

function rowOf(s: SessionSummary, e: Extras | undefined): SessionListRow {
  const folder = folderOf(s.workspace);
  const label = folder ? path.basename(folder) || folder : (s.repository ?? e?.repository);
  const row: SessionListRow = {
    id: s.id,
    source: s.source,
    sourceLabel: SOURCE_LABEL[s.source],
    turns: s.turns,
    models: s.models,
    subagents: (s.subagents ?? e?.subagents)?.length ?? 0,
    resumable: e?.resumable ?? false,
  };
  if (s.title) row.title = s.title;
  if (label) row.repository = label;
  if (folder ?? s.workspace) row.workspacePath = folder ?? s.workspace;
  const branch = s.branch ?? e?.branch;
  if (branch) row.branch = branch;
  if (s.start) row.start = s.start;
  if (s.end) row.end = s.end;
  const tokens = tokenTotal(s);
  if (tokens !== undefined) row.tokens = tokens;
  const credits = creditsOf(s)?.value;
  if (credits !== undefined) row.credits = credits;
  const toolCalls = s.toolCalls ?? e?.toolCalls;
  if (toolCalls !== undefined) row.toolCalls = toolCalls;
  return row;
}

export function sessionListRows(all: AllSessions, cap = 1000): SessionListRow[] {
  const extras = extrasById(all);
  return mergeSessions(all)
    .slice(0, cap)
    .map((s) => rowOf(s, extras.get(s.id)));
}

/** Models any session used, most used first. */
export function modelsSeen(rows: SessionListRow[]): string[] {
  const count = new Map<string, number>();
  for (const r of rows) for (const m of r.models) count.set(m, (count.get(m) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([m]) => m);
}

const agentOf = (a: SubagentRun): SessionSubagent => {
  const out: SessionSubagent = { id: a.id };
  if (a.name) out.name = a.name;
  if (a.model) out.model = a.model;
  if (a.start) out.start = a.start;
  if (a.end) out.end = a.end;
  if (a.tokens) out.tokens = a.tokens;
  if (a.credits !== undefined) out.credits = a.credits;
  if (a.toolCalls !== undefined) out.toolCalls = a.toolCalls;
  return out;
}

/** One session in full, or undefined when no source holds the id. */
export function sessionDetail(all: AllSessions, id: string): SessionDetailData | undefined {
  const extras = extrasById(all);
  const merged = mergeSessions(all).find((s) => s.id === id);
  if (!merged) return undefined;
  const e = extras.get(id);
  const runs = merged.subagents ?? e?.subagents ?? [];
  const detail: SessionDetailData = {
    ...rowOf(merged, e),
    sources: e?.sources ?? [],
    agents: runs.map(agentOf),
    exportable: !merged.fromSnapshot,
  };
  if (merged.tokens) detail.tokenFigures = merged.tokens;
  const skills = merged.skills ?? e?.skills;
  if (skills !== undefined) detail.skills = skills;
  if (e?.snapshots !== undefined) detail.snapshots = e.snapshots;
  return detail;
}

/** The files or folders that hold a session, for export and the AI actions. */
export function sessionFiles(all: AllSessions, id: string): { file: string; source: string }[] {
  const out: { file: string; source: string }[] = [];
  for (const source of SOURCE_PRIORITY) for (const s of all[source].sessions) if (s.id === id && !s.fromSnapshot) out.push({ file: s.file, source });
  return out;
}

const slash = (p: string) => p.replace(/\\/g, '/');

/** The first prompt of an Analyze run. Plain words and forward slashes only, so any terminal shell takes it inside double quotes. */
export function analyzePrompt(id: string, title: string, files: string[]): string {
  const where = files.length ? ` Its files are ${files.map(slash).join(' and ')}.` : '';
  return `Analyze the GitHub Copilot session ${id} named ${title.replace(/["'$\`\\]/g, ' ')}.${where} Read them without changing anything. Say what the session did, where its tokens and credits went and which subagents ran. Then wait for my questions.`;
}
