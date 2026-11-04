// Message contract between the extension host and the webview. No vscode import.
// Backward compatible: extend only by adding union members or optional fields, never rename or
// remove one a running host or webview still sends.

/** Host to webview. */
export type ToWebview =
  | { type: 'init'; version: string }
  | { type: 'theme'; kind: 'light' | 'dark' | 'highContrast' }
  | { type: 'setup'; state: import('./setup').SetupState }
  | { type: 'setupResult'; key: string; ok: boolean; message: string }
  | { type: 'credits'; state: import('./credits').CreditsState }
  | { type: 'snapshots'; state: import('./snapshots').SnapshotsState }
  | { type: 'overview'; state: import('./overview').OverviewState };

/** Webview to host. */
export type ToHost =
  | { type: 'ready' }
  | { type: 'setupEnable'; key: string; scope: 'user' | 'workspace'; /** true after the second confirmation in the card; required for plain-text settings */ confirmed?: boolean }
  | { type: 'setupDismiss' }
  | { type: 'setupRecheck' }
  | { type: 'creditsManualQuota'; used: number }
  | { type: 'creditsClearManual' }
  | { type: 'creditsReadGithub' };
