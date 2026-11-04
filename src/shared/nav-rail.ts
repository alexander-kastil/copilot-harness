// The collapsed left nav: a rail with one button per region and top-level group. The state and the entries are plain data,
// so the unit tests cover them without a DOM. Ported from Claude Harness (Copilot region instead of Claude Code, no Cowork).

/** What the saved state keeps: true when the nav is collapsed to the rail. The default is expanded. */
export const railFromSaved = (saved: { navRail?: boolean } | undefined): boolean => !!saved && saved.navRail === true;

export type RailRegion = 'copilot' | 'repos';

export interface RailEntry {
  /** The nav's own key for the group: `global|<kind>`, `repo:<path>`, or `region:<key>` for a region. */
  id: string;
  region: RailRegion;
  level: 0 | 1;
  label: string;
  glyph: string;
  count: number;
  active: boolean;
}

export interface RailInput {
  copilot?: { label: string; count: number; groups: { id: string; label: string; glyph: string; count: number }[] };
  repos: { label: string; count: number; repos: { id: string; label: string; count: number }[] };
  /** The group that is marked, as an entry id. */
  active?: string;
}

const REGION_GLYPH: Record<RailRegion, string> = { copilot: 'copilot', repos: 'github' };

/** The rail's buttons in nav order: the Copilot region and its groups, then Repositories and one button per repo. */
export function railEntries(input: RailInput): RailEntry[] {
  const out: RailEntry[] = [];
  const region = (key: RailRegion, label: string, count: number) => out.push({ id: `region:${key}`, region: key, level: 0, label, glyph: REGION_GLYPH[key], count, active: false });
  const r = input.copilot;
  if (r) {
    region('copilot', r.label, r.count);
    for (const g of r.groups) out.push({ id: g.id, region: 'copilot', level: 1, label: g.label, glyph: g.glyph, count: g.count, active: g.id === input.active });
  }
  region('repos', input.repos.label, input.repos.count);
  for (const x of input.repos.repos) out.push({ id: `repo:${x.id}`, region: 'repos', level: 1, label: x.label, glyph: 'repo', count: x.count, active: `repo:${x.id}` === input.active });
  return out;
}

/** The rail's count text: three digits do not fit the rail. */
export const railCount = (n: number): string => (n > 99 ? '99+' : String(n));

export interface RailFolds {
  expanded: Set<string>;
  openRepos: Set<string>;
  foldedGroups: Set<string>;
}

/** What pressing an entry opens in the full nav: its region, and the group or repo itself. Nothing is ever closed, so the groups
 * keep their own state. Returns the nav key to scroll to. */
export function revealEntry(entry: RailEntry, folds: RailFolds): string {
  folds.foldedGroups.delete(`region|${entry.region}`);
  if (entry.id.startsWith('region:')) return `r|${entry.region}`;
  if (entry.id.startsWith('repo:')) {
    folds.openRepos.add(entry.id.slice(5));
    return `p|${entry.id.slice(5)}`;
  }
  folds.expanded.add(entry.id);
  return `s|${entry.id}`;
}

/** The entry id of the group the nav last opened, from the pieces of its selection. */
export function activeEntry(sel: { kind?: string; scope?: string; repo?: string }): string | undefined {
  const scope = sel.scope;
  if (sel.kind && scope) return scope === 'global' ? `global|${sel.kind}` : `repo:${scope}`;
  if (scope && scope !== 'global') return `repo:${scope}`;
  if (sel.repo) return `repo:${sel.repo}`;
  return undefined;
}
