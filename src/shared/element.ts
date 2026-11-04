// The element page's data (one customization file) and the messages of the kind and element pages. No vscode import.
// Change only by adding optional fields or union members.
import type { ItemStatus, Kind } from './customizations';
import type { SkillInfo } from './skills';

export interface ElementField {
  key: string;
  /** The value as text: lists joined with a comma, other structures as compact JSON. */
  value: string;
}

export interface ElementDetail {
  file: string;
  /** True when `file` is a folder (a plugin): `entries` lists its top level. */
  folder: boolean;
  entries?: string[];
  /** Epoch milliseconds; undefined when the file could not be read. */
  mtime?: number;
  bytes?: number;
  /** Frontmatter fields of a markdown file, in file order. */
  fields: ElementField[];
  /** The text after the frontmatter (markdown kinds) or the whole text (other kinds). */
  body: string;
  /** True when the file is longer than the host sent. */
  truncated?: boolean;
  /** Frontmatter did not parse. */
  invalid?: boolean;
  /** Names of the tools the file lists (`tools`, `allowed-tools`), when it has such a key. */
  tools: string[];
  /** The `applyTo` globs of an instructions file. */
  applyTo: string[];
  /** AGENTS.md only: the folder it applies to and whether VS Code chat loads it under the current settings. */
  agentsMd?: AgentsMdInfo;
  /** Skills only: who loads the folder, spec problems, the npx source and the Codex file. */
  skill?: SkillInfo;
}

export interface AgentsMdInfo {
  /** "The whole repository" or the folder, relative to the repository root. */
  appliesTo: string;
  /** Whether VS Code chat (Local sessions) loads it, and which setting decides. */
  vscode: string;
  /** False when a setting keeps it from loading. */
  loaded: boolean;
  /** The agents that read this file, per their documentation. */
  readBy?: string;
}

export type ElementAiAction = 'edit' | 'try';

/** One session that called a skill, from the skill.invoked events of Copilot CLI. */
export interface UsedInSession {
  id: string;
  title?: string;
  repository?: string;
  /** ISO 8601 of the newest call. */
  last?: string;
  /** Calls in this session. */
  count: number;
}

/** Calls per day for the last 7 days, oldest first, today last. `at` is epoch milliseconds of the day's start. */
export interface UsedInDay {
  at: number;
  n: number;
}

/** Host to webview. */
export type ElementToWebview =
  | { type: 'elementDetail'; file: string; detail?: ElementDetail; error?: string }
  | { type: 'elementUsage'; name: string; ready: boolean; sessions: UsedInSession[]; days: UsedInDay[] };

/** Webview to host. Only files the nav listed are read, revealed or handed to Copilot. */
export type ElementToHost =
  | { type: 'elementOpen'; file: string }
  | { type: 'elementReveal'; file: string }
  /** Asks which sessions called the skill of this name; answered with `elementUsage`. */
  | { type: 'elementUsageOpen'; name: string }
  /** Opens the web page of an item that has a `url` (Copilot Memory) in the browser; the host checks the address. */
  | { type: 'elementUrl'; file: string; url: string }
  | { type: 'elementAi'; action: ElementAiAction; kind: Kind; name: string; file: string; /** Repository folder the file lives in, for the terminal's folder. */ repo?: string }
  | { type: 'repoAi'; path: string };

export interface ElementEntry {
  kind: Kind;
  name: string;
  file: string;
  status: ItemStatus;
  readOnly: boolean;
  pluginId?: string;
  /** A web page that shows the item; the File box opens it in the browser. */
  url?: string;
  /** 'global' (user profile, ~/.copilot, home), 'plugin', or the repository folder path. */
  scope: string;
  scopeLabel: string;
}
