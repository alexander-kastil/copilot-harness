// The left nav's data: what the host sends the nav and what the nav asks of the host. No vscode import.
// Owned by the nav feature; extend by adding fields and union members. Holds names, paths and counts, never file text.
import type { ItemStatus, Kind } from './customizations';

export interface NavItem {
  name: string;
  /** The file that defines the item (a plugin's folder for kind 'plugin'). */
  file: string;
  status: ItemStatus;
  /** Plugin items are read-only and name their plugin (`name@marketplace`). */
  readOnly: boolean;
  pluginId?: string;
  /** A web page that shows the item (Copilot Memory lives in the repository's GitHub settings). */
  url?: string;
}

export interface NavGroup {
  kind: Kind;
  label: string;
  items: NavItem[];
}

export interface NavSession {
  id: string;
  /** Title Copilot stored for the session; blank when none. */
  title?: string;
  sourceLabel: string;
  /** ISO 8601. */
  start?: string;
  end?: string;
}

export interface NavRepo {
  path: string;
  name: string;
  /** True for a folder open in this window. */
  open: boolean;
  /** ISO 8601 of the newest session. */
  lastSession?: string;
  /** Kinds of the repository's own files; empty kinds are left out. */
  groups: NavGroup[];
  sessions: NavSession[];
}

/** What the nav keeps between sessions (VS Code global state). */
export interface NavSaved {
  filter: string;
  /** Group ids unfolded: `global|<kind>` and `<repoPath>|<kind>`, `<repoPath>|sessions`. */
  expanded: string[];
  /** Repository paths unfolded. */
  openRepos: string[];
  /** `region|<key>` and group fold keys. */
  foldedGroups: string[];
  repoSort: 'recent' | 'name';
  /** True when the nav is collapsed to the rail. */
  navRail: boolean;
}

/** Host to webview, posted as { type: 'nav', state }. */
export interface NavState {
  /** Global items (user profile, ~/.copilot, home, plugins) by kind, in KINDS order. */
  global: NavGroup[];
  repos: NavRepo[];
  /** False until the first session read finished: the Sessions rows then say they are still reading. */
  sessionsReady: boolean;
  saved?: Partial<NavSaved>;
}

/** Webview to host messages of the nav. */
export type NavToHost =
  | { type: 'navSave'; saved: NavSaved }
  /** Opens the file in an editor (read-only for plugin items); a folder is revealed. Only files the host listed are opened. */
  | { type: 'navOpen'; file: string; readOnly: boolean }
  | { type: 'navAddRepo' }
  | { type: 'navRemoveRepo' }
  | { type: 'navRefresh' };
