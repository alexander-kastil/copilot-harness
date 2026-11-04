// The overview page's data (shared by the host and the webview). No vscode import.
// Change only by adding optional fields. Holds names, paths, counts and figures, never message text.
import type { Kind, Scope } from './customizations';
import type { SessionSource } from './session-model';

export interface KindTile {
  kind: Kind;
  label: string;
  /** Global items of the kind: user profile, ~/.copilot, home folders and installed plugins. */
  count: number;
}

export interface SessionRow {
  id: string;
  /** The source of the figures shown (the richest source when several hold the session). */
  source: SessionSource;
  sourceLabel: string;
  /** Folder name of the workspace or repository; the full path is in `workspacePath`. */
  workspace?: string;
  workspacePath?: string;
  /** A title Copilot stored for the session; blank when none. */
  title?: string;
  /** ISO 8601. */
  start?: string;
  end?: string;
  turns: number;
  models: string[];
  /** Input plus output tokens; undefined when no source carries them. */
  tokens?: number;
  /** Credits (AIC); undefined when no source carries them, never 0 for missing. */
  credits?: number;
}

export interface RepoRow {
  /** Folder path, or the workspace string the session reader gave when it is not a local folder. */
  path: string;
  name: string;
  /** True for a folder open in this window. */
  open: boolean;
  /** Customizations of the folder, per kind (workspace scope). */
  counts: Partial<Record<Kind, number>>;
  sessions7d: number;
  /** Credits over the last 7 days; undefined when no session of the period carries a figure. */
  credits7d?: number;
  /** ISO 8601 of the newest session. */
  lastSession?: string;
}

export interface ChangedRow {
  kind: Kind;
  scope: Scope;
  /** What the scope column shows: the repository folder, the plugin id, or the scope's name. */
  scopeLabel: string;
  name: string;
  file: string;
  /** Epoch milliseconds. */
  mtime: number;
}

export interface OverviewState {
  globalAssets: number;
  repositories: number;
  tiles: KindTile[];
  sessions: SessionRow[];
  repos: RepoRow[];
  changed: ChangedRow[];
  /** False until the first session read finished: the session tables then say they are still reading. */
  sessionsReady: boolean;
  /** Epoch milliseconds the page was computed, for "x ago" columns. */
  now: number;
}
