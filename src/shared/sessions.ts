// What the Sessions page and the session detail page share between host and webview. No vscode import.
// Numbers and names only, like SessionSummary: never prompt, response or tool-result text.
import type { SessionSource, TokenFigures } from './session-model';

/** One row of the Sessions page: the merged record of a session, one row per session id. */
export interface SessionListRow {
  id: string;
  source: SessionSource;
  sourceLabel: string;
  title?: string;
  /** Folder name of the workspace or repository; the full path is in `workspacePath`. */
  repository?: string;
  workspacePath?: string;
  branch?: string;
  /** ISO 8601. */
  start?: string;
  end?: string;
  turns: number;
  models: string[];
  tokens?: number;
  credits?: number;
  subagents: number;
  toolCalls?: number;
  /** True when Copilot CLI can resume the session (a CLI record exists). */
  resumable: boolean;
}

export interface SessionsState {
  sessions: SessionListRow[];
  /** Models seen in any session: the model picker of the AI actions offers these. */
  models: string[];
  /** False until the first session read finished. */
  ready: boolean;
  /** True when the user chose "Don't ask again" on the AI confirm card. */
  skipConfirm: boolean;
}

export interface SessionSubagent {
  id: string;
  name?: string;
  model?: string;
  start?: string;
  end?: string;
  tokens?: TokenFigures;
  credits?: number;
  toolCalls?: number;
}

/** One session in full, built from the merged record. */
export interface SessionDetailData extends SessionListRow {
  /** The sources that hold this session, in priority order. */
  sources: string[];
  tokenFigures?: TokenFigures;
  skills?: number;
  agents: SessionSubagent[];
  /** CLI rewind snapshots: how many backup entries the session holds. */
  snapshots?: number;
  /** True when the session's files can be exported. */
  exportable: boolean;
}

export type SessionAiAction = 'analyze' | 'continue';

export type SessionsToWebview =
  | { type: 'sessions'; state: SessionsState }
  | { type: 'sessionDetail'; id: string; detail?: SessionDetailData; error?: string };

export type SessionsToHost =
  | { type: 'sessionOpen'; id: string }
  | { type: 'sessionsRefresh' }
  | { type: 'sessionAi'; action: SessionAiAction; id: string; model?: string }
  | { type: 'sessionExport'; id: string }
  | { type: 'sessionSkipConfirm' };

const ms = (iso: string | undefined): number | undefined => {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? undefined : t;
};

/** Length of a run in milliseconds, undefined when either end is missing. */
export function durationOf(start: string | undefined, end: string | undefined): number | undefined {
  const a = ms(start);
  const b = ms(end);
  return a === undefined || b === undefined || b < a ? undefined : b - a;
}

/** The most subagents running at the same time; runs without both times do not count. */
export function peakParallel(agents: { start?: string; end?: string }[]): number {
  const edges: [number, number][] = [];
  for (const a of agents) {
    const s = ms(a.start);
    const e = ms(a.end);
    if (s === undefined || e === undefined) continue;
    edges.push([s, 1], [Math.max(e, s), -1]);
  }
  edges.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let now = 0;
  let peak = 0;
  for (const [, d] of edges) {
    now += d;
    peak = Math.max(peak, now);
  }
  return peak;
}

/** Share of the credits spent in subagents, 0 to 1; undefined when nothing carries credits. */
export function delegatedShare(total: number | undefined, agents: { credits?: number }[]): number | undefined {
  if (!total || total <= 0) return undefined;
  const inAgents = agents.reduce((n, a) => n + (a.credits ?? 0), 0);
  return Math.min(1, inAgents / total);
}

/** Share of input tokens served from the cache, 0 to 1; undefined when the source has no cached figure. */
export function cacheShare(t: TokenFigures | undefined): number | undefined {
  if (!t || t.cached === undefined || !t.input) return undefined;
  return Math.min(1, t.cached / t.input);
}

/** The name to show for a session: its stored title, else its id's first characters. */
export const sessionLabel = (s: { title?: string; id: string }): string => s.title?.trim() || `Session ${s.id.slice(0, 8)}`;
