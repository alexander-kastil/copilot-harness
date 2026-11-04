// Marketplace data and messages, shared by the host (src/markets-host.ts, src/readers/markets.ts) and the pages
// (src/webview/markets.ts). No vscode import. Extend only by adding fields and union members.

export interface MarketPlugin {
  name: string;
  /** `name@marketplace`. */
  key: string;
  /** The installed version; empty when not installed. A plugin from a local folder is loaded live, so it is installed at the source's version. */
  installed?: string;
  /** The version the marketplace offers. */
  source?: string;
  ahead: boolean;
  enabled: boolean;
  /** True when Copilot loads the plugin straight from the marketplace's folder (nothing is copied). */
  live?: boolean;
  description?: string;
  /** The plugin's folder: its installed copy, else its folder inside the marketplace. */
  dir?: string;
}

export type MarketKind = 'github' | 'git' | 'directory' | 'url' | 'unknown';

export interface MarketHealth {
  name: string;
  /** owner/repo, a git URL or the folder. */
  source: string;
  kind: MarketKind;
  /** The folder on disk that holds the catalog; empty when Copilot keeps none. */
  location: string;
  /** Included with Copilot CLI (awesome-copilot): it needs no add and cannot be removed. */
  builtin?: boolean;
  /** Where the marketplace is registered. */
  where: ('Copilot CLI' | 'VS Code')[];
  plugins: MarketPlugin[];
}

export type MarketOp =
  | { op: 'sync'; market: string; /** Absent: every plugin that is ahead. */ plugin?: string }
  | { op: 'uninstall' | 'enable' | 'disable'; market: string; plugin: string }
  | { op: 'rename'; market: string; to: string };

export interface RenameFile {
  file: string;
  detail: string;
}

export type MarketsToWebview =
  | { type: 'markets'; markets: MarketHealth[] }
  /** The answer to marketsPlan: what a rename writes and runs; `error` when it cannot go ahead. */
  | { type: 'marketsPlan'; market: string; to: string; files: RenameFile[]; commands: string[]; error?: string }
  | { type: 'marketsResult'; ok: boolean; message: string };

export type MarketsToHost =
  | { type: 'marketsRead' }
  | { type: 'marketsPlan'; market: string; to: string }
  | { type: 'marketsRun'; op: MarketOp };
