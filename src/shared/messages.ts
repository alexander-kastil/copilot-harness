// Message contract between the extension host and the webview. No vscode import.
// Backward compatible: extend only by adding union members or optional fields, never rename or
// remove one a running host or webview still sends.

/** Host to webview. */
export type ToWebview =
  | { type: 'init'; version: string }
  | { type: 'theme'; kind: 'light' | 'dark' | 'highContrast' };

/** Webview to host. */
export type ToHost =
  | { type: 'ready' };
