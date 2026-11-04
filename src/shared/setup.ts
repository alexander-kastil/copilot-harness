// Types of the setup check (#11), shared by the host and the setup card. No vscode import.
// Change only by adding optional fields.
import type { SessionSource } from './session-model';

/** off: not enabled and nothing found. empty: enabled (or always on) but no session found yet. data: sessions found. */
export type SourceState = 'off' | 'empty' | 'data';

export interface SettingStatus {
  key: string;
  /** False when this VS Code does not register the setting: the card says so and never writes it. */
  known: boolean;
  /** Effective value, false when unset. */
  enabled: boolean;
  /** Which sessions this setting makes Copilot record. */
  appliesTo: string;
  /** The setting is honoured in user settings only. */
  userOnly?: boolean;
  /** Turning it on stores prompts and responses in plain text: needs the plain-text warning and a second confirmation. */
  plainText?: boolean;
}

export interface SourceStatus {
  source: SessionSource;
  label: string;
  state: SourceState;
  /** True when the source has settings the user can switch on. */
  optIn: boolean;
  sessions: number;
  /** Newest record time, ISO 8601; the figure comes from the source's own reader. */
  newest?: string;
  settings: SettingStatus[];
  /** What is missing from a session when this source is off. */
  missing: string;
  /** Set when the reader could not run (for example node:sqlite unavailable). */
  reason?: string;
}

/** What the card needs to draw itself. */
export interface SetupState {
  statuses: SourceStatus[];
  /** True when the user pressed "Don't ask again". */
  dismissed: boolean;
  /** True when a folder is open, so the workspace scope can be offered. */
  workspaceOpen: boolean;
}
