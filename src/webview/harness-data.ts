// The customization entries the kind page and the element page list, built from the nav's state (the nav already holds
// every kind of the global scope and of each repository). Kinds come from the KINDS table, so a new kind needs no change here.
import { KINDS, type Kind } from '../shared/customizations';
import type { ElementEntry } from '../shared/element';
import type { NavGroup, NavState } from '../shared/nav';

const ICONS: Partial<Record<Kind, string>> = {
  instruction: 'book',
  stack: 'file-code',
  prompt: 'comment',
  agent: 'robot',
  skill: 'mortar-board',
  hook: 'zap',
  mcp: 'server',
  plugin: 'extensions',
  subagent: 'organization',
  tool: 'tools',
  agentic: 'workflow',
  ci: 'play-circle',
  env: 'vm',
  governance: 'shield',
  memory: 'lightbulb',
  deterministic: 'gear',
};

export const kindIcon = (kind: Kind): string => ICONS[kind] ?? 'file';
export const kindLabel = (kind: Kind): string => KINDS[kind]?.label ?? kind;
export const kindSingular = (kind: Kind): string => kindLabel(kind).replace(/ies$/, 'y').replace(/s$/, '');

export const GLOBAL_SCOPE = 'global';
export const PLUGIN_SCOPE = 'plugin';

let entries: ElementEntry[] = [];
const listeners = new Set<() => void>();

function collect(groups: NavGroup[], scope: (pluginId?: string) => [string, string]): ElementEntry[] {
  return groups.flatMap((g) =>
    g.items.map((i): ElementEntry => {
      const [id, label] = scope(i.pluginId);
      return { kind: g.kind, name: i.name, file: i.file, status: i.status, readOnly: i.readOnly, ...(i.pluginId ? { pluginId: i.pluginId } : {}), ...(i.url ? { url: i.url } : {}), scope: id, scopeLabel: label };
    })
  );
}

export function setNavData(state: NavState): void {
  entries = [
    ...collect(state.global, (plugin) => (plugin ? [PLUGIN_SCOPE, 'Plugins'] : [GLOBAL_SCOPE, 'Global'])),
    ...state.repos.flatMap((r) => collect(r.groups, (plugin) => (plugin ? [PLUGIN_SCOPE, 'Plugins'] : [r.path, r.name]))),
  ];
  for (const fn of listeners) fn();
}

/** Called after every nav update, e.g. so an open kind page redraws. */
export function onNavData(fn: () => void): void {
  listeners.add(fn);
}

export const entriesOf = (kind: Kind): ElementEntry[] => entries.filter((e) => e.kind === kind);

export const entryOf = (file: string): ElementEntry | undefined => entries.find((e) => e.file === file);

/** Every kind of the KINDS table, in its order. */
export const allKinds = (): Kind[] => Object.keys(KINDS) as Kind[];
