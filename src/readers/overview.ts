// The overview page's numbers: kind tiles, the merged session list, the repository table and the
// recently changed list. Pure: the host reads the inventories and passes them in. No vscode import.
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KINDS, type CustomizationItem, type Kind } from '../shared/customizations';
import type { ChangedRow, KindTile, OverviewState, RepoRow, SessionRow } from '../shared/overview';
import { creditsOf, SOURCE_PRIORITY } from '../shared/reconcile';
import type { SessionDetail, SessionSource, SessionSummary } from '../shared/session-model';
import type { AllSessions } from './all-sessions';

const DAY = 86_400_000;
const SESSION_CAP = 300;
const CHANGED_CAP = 100;
const REPO_CAP = 150;

export const SOURCE_LABEL: Record<SessionSource, string> = {
  chatSessions: 'Chat',
  debugLogs: 'Debug log',
  traceDb: 'Trace DB',
  cli: 'CLI',
};

const DETAIL_RANK: Record<SessionDetail, number> = { perCall: 3, perTurn: 2, totalsOnly: 1, none: 0 };
const REPO_KINDS: Kind[] = ['instruction', 'prompt', 'agent', 'skill', 'hook', 'mcp'];

/** A workspace string from a reader (file URI or plain path) as a local folder path; undefined for anything else. */
export function folderOf(workspace: string | undefined): string | undefined {
  if (!workspace) return undefined;
  if (/^file:/i.test(workspace)) {
    try {
      return fileURLToPath(workspace);
    } catch {
      return undefined;
    }
  }
  return /^(?:[a-zA-Z]:[\\/]|\/)/.test(workspace) ? workspace : undefined;
}

const keyOf = (p: string): string => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));

function timeOf(s: { end?: string; start?: string }): number {
  const t = Date.parse(s.end ?? s.start ?? '');
  return Number.isNaN(t) ? 0 : t;
}

const rank = (s: SessionSummary): number => DETAIL_RANK[s.detail] * 10 + (SOURCE_PRIORITY.length - SOURCE_PRIORITY.indexOf(s.source));

/** One session per id: the richest source's record, with title, workspace and times filled in from the others. */
export function mergeSessions(all: AllSessions): SessionSummary[] {
  const byId = new Map<string, SessionSummary[]>();
  for (const source of SOURCE_PRIORITY) {
    for (const s of all[source].sessions) {
      const list = byId.get(s.id);
      if (list) list.push(s);
      else byId.set(s.id, [s]);
    }
  }
  const out: SessionSummary[] = [];
  for (const group of byId.values()) {
    const best = [...group].sort((a, b) => rank(b) - rank(a))[0];
    const merged: SessionSummary = { ...best };
    for (const other of group) {
      merged.title ??= other.title;
      merged.workspace ??= other.workspace;
      merged.start ??= other.start;
      merged.end ??= other.end;
      if (!merged.models.length) merged.models = other.models;
    }
    if (merged.credits === undefined && merged.nanoAiu === undefined) {
      const other = group.find((g) => creditsOf(g));
      if (other) {
        merged.credits = other.credits;
        merged.nanoAiu = other.nanoAiu;
      }
    }
    if (!merged.tokens || (merged.tokens.input === undefined && merged.tokens.output === undefined)) {
      const other = group.find((g) => g.tokens && (g.tokens.input !== undefined || g.tokens.output !== undefined));
      if (other) merged.tokens = other.tokens;
    }
    out.push(merged);
  }
  return out.sort((a, b) => timeOf(b) - timeOf(a));
}

function tokenTotal(s: SessionSummary): number | undefined {
  const t = s.tokens;
  if (!t || (t.input === undefined && t.output === undefined)) return undefined;
  return (t.input ?? 0) + (t.output ?? 0);
}

function sessionRow(s: SessionSummary): SessionRow {
  const folder = folderOf(s.workspace);
  const row: SessionRow = {
    id: s.id,
    source: s.source,
    sourceLabel: SOURCE_LABEL[s.source],
    turns: s.turns,
    models: s.models,
  };
  const label = folder ? path.basename(folder) || folder : s.repository;
  if (label) row.workspace = label;
  if (folder ?? s.workspace) row.workspacePath = folder ?? s.workspace;
  if (s.title) row.title = s.title;
  if (s.start) row.start = s.start;
  if (s.end) row.end = s.end;
  const tokens = tokenTotal(s);
  if (tokens !== undefined) row.tokens = tokens;
  const credits = creditsOf(s)?.value;
  if (credits !== undefined) row.credits = credits;
  return row;
}

/** The folders the repository table lists: open folders first, then every distinct local folder the sessions name. */
export function repositoryFolders(all: AllSessions, openFolders: string[]): string[] {
  const seen = new Map<string, string>();
  for (const f of openFolders) seen.set(keyOf(f), f);
  for (const s of mergeSessions(all)) {
    const folder = folderOf(s.workspace);
    if (folder && !seen.has(keyOf(folder))) seen.set(keyOf(folder), folder);
  }
  return [...seen.values()];
}

export interface OverviewInput {
  all: AllSessions;
  /** False until the first session read finished. */
  sessionsReady: boolean;
  /** Items of the user profile, ~/.copilot, home folders and installed plugins. */
  globalItems: CustomizationItem[];
  openFolders: string[];
  /** Workspace-scope items per folder path, as repositoryFolders lists them. */
  repoItems: Record<string, CustomizationItem[]>;
  now: number;
}

const SCOPE_NAME: Record<CustomizationItem['scope'], string> = {
  workspace: 'Workspace',
  userProfile: 'User profile',
  copilotHome: '~/.copilot',
  home: 'Home',
  plugin: 'Plugin',
};

export function computeOverview(input: OverviewInput): OverviewState {
  const { all, globalItems, openFolders, repoItems, now } = input;
  const merged = mergeSessions(all);

  const tiles: KindTile[] = (Object.keys(KINDS) as Kind[]).map((kind) => ({
    kind,
    label: KINDS[kind].label,
    count: globalItems.filter((i) => i.kind === kind).length,
  }));

  const openKeys = new Set(openFolders.map(keyOf));
  const folders = repositoryFolders(all, openFolders);
  const since = now - 7 * DAY;
  const repos: RepoRow[] = folders.map((folder) => {
    const key = keyOf(folder);
    const mine = merged.filter((s) => {
      const f = folderOf(s.workspace);
      return f !== undefined && keyOf(f) === key;
    });
    const counts: RepoRow['counts'] = {};
    for (const item of repoItems[folder] ?? []) counts[item.kind] = (counts[item.kind] ?? 0) + 1;
    const week = mine.filter((s) => timeOf(s) >= since);
    const figures = week.map((s) => creditsOf(s)?.value).filter((v): v is number => v !== undefined);
    const last = mine.length ? mine[0] : undefined;
    const row: RepoRow = {
      path: folder,
      name: path.basename(folder) || folder,
      open: openKeys.has(key),
      counts,
      sessions7d: week.length,
    };
    if (figures.length) row.credits7d = figures.reduce((a, b) => a + b, 0);
    const lastTime = last ? (last.end ?? last.start) : undefined;
    if (lastTime) row.lastSession = lastTime;
    return row;
  });
  repos.sort((a, b) => Number(b.open) - Number(a.open) || Date.parse(b.lastSession ?? '') - Date.parse(a.lastSession ?? '') || a.name.localeCompare(b.name));

  const changedItems = [...globalItems, ...Object.values(repoItems).flat()].filter((i) => i.mtime !== undefined);
  const changed: ChangedRow[] = changedItems
    .map((i) => {
      const scopeLabel = i.scope === 'plugin' ? (i.pluginId ?? SCOPE_NAME.plugin) : i.scope === 'workspace' ? repoNameOf(i.file, folders) : SCOPE_NAME[i.scope];
      return { kind: i.kind, scope: i.scope, scopeLabel, name: i.name, file: i.file, mtime: i.mtime as number };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, CHANGED_CAP);

  return {
    globalAssets: globalItems.length,
    repositories: repos.length,
    tiles,
    sessions: merged.slice(0, SESSION_CAP).map(sessionRow),
    repos: repos.slice(0, REPO_CAP),
    changed,
    sessionsReady: input.sessionsReady,
    now,
  };
}

/** The folder of the repository table that holds the file, by its name; the deepest match wins. */
function repoNameOf(file: string, folders: string[]): string {
  const f = keyOf(file);
  let best: string | undefined;
  for (const folder of folders) {
    const k = keyOf(folder);
    if ((f === k || f.startsWith(k + path.sep)) && (!best || k.length > keyOf(best).length)) best = folder;
  }
  return best ? path.basename(best) || best : SCOPE_NAME.workspace;
}

export { REPO_KINDS };
