// The Plugin Hunter's data and messages, shared by the host (src/hunt-host.ts, src/readers/hunt*.ts) and the page
// (src/webview/hunt*.ts). No vscode import. Change only by adding optional fields or union members.

export interface HuntAsset {
  kind: 'skill' | 'agent';
  name: string;
  include: boolean;
  why: string;
  /** `replace`: once the plugin is installed this copy is backed up and removed, and the plugin's version takes its place. Off leaves it untouched. */
  global?: { path: string; replace: boolean };
  repos: { repo: string; path: string; same: boolean; replace: boolean }[];
  /** Already shipped by this installed plugin. */
  inPlugin?: string;
  /** The name the element gets inside the plugin, when a comment to Copilot renamed it. */
  as?: string;
}

export interface HuntProposal {
  id: string;
  prompt: string;
  created: number;
  name: string;
  description: string;
  category: string;
  assets: HuntAsset[];
}

/** A skill or agent the owner can pick on a card: the asset with its paths filled in, and its description. */
export interface HuntCatalogItem {
  asset: HuntAsset;
  description: string;
}

/** A registered marketplace. Only one the owner owns on disk (a local folder with a marketplace.json) can receive a plugin. */
export interface HuntMarket {
  name: string;
  location: string;
  /** local, github, git or url. */
  kind: string;
  owned: boolean;
  /** Whether the marketplace keeps its plugins in category folders (`./plugins/<category>/<name>`). */
  categorized: boolean;
  /** The category folders it already has. */
  categories: string[];
  /** Why it cannot be picked, when it is not owned. */
  note?: string;
}

/** A message of the Plugin Hunter's conversation. */
export interface HuntTurn {
  role: 'owner' | 'copilot';
  text: string;
  at: number;
  /** The card the turn belongs to; empty when it came before any card. */
  card?: string;
}

export interface HuntInfo {
  markets: HuntMarket[];
  /** The remembered pick, when it can still be used. */
  picked?: string;
  catalog: HuntCatalogItem[];
  proposals: HuntProposal[];
  /** The conversation, oldest first. */
  chat: HuntTurn[];
  /** What Create said, by card id, for the cards that were created: they are done. */
  created: Record<string, string>;
  /** True while the first message of a conversation still needs the confirm card. */
  ask: boolean;
  /** How many skills and agents Copilot is shown with the first message. */
  items: number;
}

/** What the card before Create lists: every file written and every copy replaced. */
export interface HuntCreateAsk {
  id: string;
  name: string;
  market: string;
  location: string;
  files: string[];
  replaced: string[];
  kept: string[];
}

export type HuntToWebview =
  | { type: 'hunt'; info: HuntInfo }
  | { type: 'huntRun'; state: 'running' | 'done' | 'error'; error?: string; card?: string }
  | { type: 'huntCreate'; id: string; state: 'running' | 'done' | 'error'; text?: string }
  | { type: 'huntCreateAsk'; ask: HuntCreateAsk };

export type HuntToHost =
  | { type: 'huntInfo' }
  | { type: 'huntSave'; proposals: HuntProposal[]; market?: string }
  | { type: 'huntRun'; prompt: string; card?: string; /** true after the confirm card */ confirmed?: boolean; /** Don't ask again */ remember?: boolean }
  | { type: 'huntClear' }
  | { type: 'huntCreate'; id: string; market: string; confirmed?: boolean }
  | { type: 'huntMerge'; path: string; kind: 'skill' | 'agent' };
