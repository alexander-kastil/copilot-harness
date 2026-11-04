// Types of the customization inventory (#7). No vscode import. Change only by adding members or
// optional fields. Holds names, file paths and frontmatter key names, never file text.

export type Kind = 'instruction' | 'prompt' | 'stack' | 'agent' | 'skill' | 'hook' | 'mcp' | 'plugin' | 'subagent' | 'tool' | 'agentic' | 'ci' | 'env' | 'governance' | 'memory' | 'deterministic';

/**
 * workspace: the open folders (and, with the parent lookup, their parent folders up to the repo root).
 * userProfile: the VS Code user folder (prompts, mcp.json), every installed variant and profile.
 * copilotHome: ~/.copilot (skills, instructions, agents, mcp-config.json).
 * home: harness-agnostic folders in the home directory (~/.claude, ~/.agents) that VS Code also reads.
 * plugin: the contents of an installed plugin.
 */
export type Scope = 'workspace' | 'userProfile' | 'copilotHome' | 'home' | 'plugin';

/** ok; invalid (frontmatter or JSON does not parse); incomplete (a required field is missing); unreadable; disabled (plugin switched off). */
export type ItemStatus = 'ok' | 'invalid' | 'incomplete' | 'unreadable' | 'disabled';

export interface KindInfo {
  label: string;
  /** Whether the file is markdown with frontmatter. */
  markdown: boolean;
  /** Documented frontmatter keys (VS Code custom agents, prompt files, instructions; the agent skills format). */
  frontmatter: readonly string[];
}

export const KINDS: Record<Kind, KindInfo> = {
  // General instructions: repository-wide, always loaded. Stack-specific: loaded when applyTo (or a Claude rule's paths) matches.
  instruction: { label: 'General instructions', markdown: true, frontmatter: ['name', 'description', 'applyTo'] },
  stack: { label: 'Stack-specific instructions', markdown: true, frontmatter: ['name', 'description', 'applyTo', 'paths'] },
  prompt: { label: 'Prompt files', markdown: true, frontmatter: ['name', 'description', 'argument-hint', 'agent', 'model', 'tools'] },
  agent: {
    label: 'Agents',
    markdown: true,
    frontmatter: ['name', 'description', 'tools', 'model', 'handoffs', 'mcp-servers', 'user-invocable', 'disable-model-invocation', 'argument-hint', 'target'],
  },
  // Orchestration skills are instructions only; deterministic skills hand their parameters to a script under scripts/.
  skill: {
    label: 'Orchestration skills',
    markdown: true,
    frontmatter: ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools', 'user-invocable', 'disable-model-invocation'],
  },
  deterministic: {
    label: 'Deterministic skills',
    markdown: true,
    frontmatter: ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools', 'user-invocable', 'disable-model-invocation'],
  },
  hook: { label: 'Hooks', markdown: false, frontmatter: [] },
  mcp: { label: 'MCP servers', markdown: false, frontmatter: [] },
  plugin: { label: 'Plugins', markdown: false, frontmatter: [] },
  subagent: { label: 'Subagents', markdown: true, frontmatter: ['name', 'description', 'tools', 'agents', 'model', 'user-invocable', 'disable-model-invocation'] },
  tool: { label: 'Tools', markdown: false, frontmatter: [] },
  agentic: { label: 'Agentic Workflows', markdown: true, frontmatter: ['on', 'permissions', 'safe-outputs', 'engine', 'tools', 'network'] },
  ci: { label: 'GitHub Actions / CI', markdown: false, frontmatter: [] },
  env: { label: 'Environment', markdown: false, frontmatter: [] },
  governance: { label: 'Governance & permissions', markdown: false, frontmatter: [] },
  // Copilot Memory is kept in the repository's GitHub settings; the item shows the local switch and links to that page.
  memory: { label: 'Copilot Memory', markdown: false, frontmatter: [] },
};

export interface CustomizationItem {
  scope: Scope;
  kind: Kind;
  name: string;
  /** The file that defines it (a plugin's folder for kind 'plugin'). */
  file: string;
  /** undefined when the file could not be read. */
  mtime: number | undefined;
  /** `name@marketplace` of the plugin that supplies the item. */
  pluginId?: string;
  /** A web page that shows the item when it does not live on disk (the repository's Copilot Memory settings). */
  url?: string;
  /** True for items supplied by an installed plugin: they are changed by updating the plugin. */
  readOnly: boolean;
  status: ItemStatus;
  /** Frontmatter key names present in the file, markdown kinds only. */
  keys?: string[];
  /** Which VS Code variant or profile the item came from (userProfile scope). */
  origin?: string;
  /** True when found in a parent folder of a workspace folder through the parent lookup. */
  inParent?: boolean;
}

export interface InventoryOptions {
  /** Open workspace folders, absolute paths. */
  workspaceFolders: string[];
  /** The chat.useCustomizationsInParentRepositories setting (off by default in VS Code). */
  parentLookup: boolean;
}

export interface Inventory {
  items: CustomizationItem[];
}
