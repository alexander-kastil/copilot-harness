// Shared session model for every Copilot session reader (#8 chat sessions, #9 debug logs and trace
// database, #10 CLI) and their consumers (#11 setup check, #12 snapshots, #13 reconciliation).
// Contract: change only by adding optional fields. No vscode import. Never holds prompt, response,
// system-prompt or tool-result text.

export type SessionSource = 'chatSessions' | 'debugLogs' | 'traceDb' | 'cli';

/** How much detail a source gave for this session. 'none' means "no detail available", never zeros. */
export type SessionDetail = 'perCall' | 'perTurn' | 'totalsOnly' | 'none';

export interface TokenFigures {
  input: number | undefined;
  output: number | undefined;
  /** undefined when the source does not carry cached tokens; never 0 for missing. */
  cached: number | undefined;
}

export type FigureName = 'tokens' | 'cachedTokens' | 'credits' | 'toolCalls' | 'subagents' | 'skills' | 'models';

export interface SubagentRun {
  id: string;
  /** Id of the tool call or span that started the run, when the source gives one. */
  parentId?: string;
  name?: string;
  model?: string;
  start?: string;
  end?: string;
  tokens?: TokenFigures;
  credits?: number;
  toolCalls?: number;
  /** Raw copilotUsageNanoAiu summed over the run, unit unconfirmed so not converted to credits (#9). */
  nanoAiu?: number;
}

/**
 * One raw usage record as the source wrote it (CLI session.shutdown or a usage checkpoint).
 * Kept per record and never summed until #13 settles whether the totals are cumulative.
 */
export interface UsageSnapshot {
  eventType: string;
  timestamp?: string;
  model?: string;
  tokens?: TokenFigures;
  credits?: number;
  /** Numeric and short scalar fields only, never message text. */
  raw: Record<string, number | string | boolean | null>;
}

export interface SessionSummary {
  source: SessionSource;
  /**
   * Session id as Copilot writes it. When two sources describe the same session and share its id
   * (confirm on disk), #13 joins on it to prevent double counting.
   */
  id: string;
  /** Source file or folder this summary was read from. */
  file: string;
  /** Workspace folder (VS Code, from workspace.json) or cwd (CLI); undefined when unknown. */
  workspace?: string;
  repository?: string;
  branch?: string;
  /** VS Code variant folder name (Code, Code - Insiders, ...) for VS Code sources. */
  variant?: string;
  /** A title Copilot itself stored for the session; never derived from prompt text. */
  title?: string;
  /** ISO 8601. */
  start?: string;
  end?: string;
  turns: number;
  models: string[];
  /** undefined when the source carries no token figures at all. */
  tokens: TokenFigures | undefined;
  /** undefined when the source carries no credit field; 0 only when the source says 0. */
  credits: number | undefined;
  toolCalls?: number;
  subagents?: SubagentRun[];
  skills?: number;
  usageSnapshots?: UsageSnapshot[];
  detail: SessionDetail;
  /** Which source supplied each figure; differs from `source` once #12 or #13 merges records. */
  provenance: Partial<Record<FigureName, SessionSource>>;
  /** Lines or records the reader could not interpret, counted and skipped. */
  skipped: number;
  /** Set by #12 when the source is gone and the figures come from the snapshot store. */
  fromSnapshot?: boolean;
  /** Raw copilotUsageNanoAiu summed over the session, unit unconfirmed so not converted to credits (#9). */
  nanoAiu?: number;
  /** Count of sidecar .json files (system prompts, tools, models) next to the log; counted, never copied (#9). */
  sidecarFiles?: number;
}

export interface ReadResult {
  source: SessionSource;
  sessions: SessionSummary[];
  /** Root folders or files the reader looked at, existing or not (#11 reports them). */
  roots: string[];
  /** Newest record time seen, ISO 8601. */
  newest?: string;
  /** Sum of `skipped` over all sessions plus records outside any session. */
  skipped: number;
  /** Why a reader returned nothing it could have read (for example node:sqlite unavailable); set by #9. */
  reason?: string;
}
