// The skills locks of `npx skills` (vercel-labs/skills): the global ~/.agents/.skill-lock.json (version 3, hash
// `skillFolderHash`) and a repository's skills-lock.json (version 1, hash `computedHash`). Read only. No vscode import.
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { SkillLock, SkillLockSkill, SkillsCommand, SkillsState, SkillSource } from '../shared/skills';

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

const SAFE_NAME = /^[\w.-]+$/;

async function readLock(file: string, version: number, hashKey: string): Promise<Omit<SkillLockSkill, 'present'>[] | undefined> {
  let data: unknown;
  try {
    data = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return undefined;
  }
  // `npx skills` discards a lock of another version rather than migrating it: it is not read here either.
  if (!isRecord(data) || data.version !== version || !isRecord(data.skills)) return undefined;
  const out: Omit<SkillLockSkill, 'present'>[] = [];
  for (const [name, entry] of Object.entries(data.skills)) {
    if (!SAFE_NAME.test(name) || !isRecord(entry)) continue;
    const skill: Omit<SkillLockSkill, 'present'> = { name, source: text(entry.source) ?? '', sourceType: text(entry.sourceType) ?? '' };
    for (const [key, from] of [['sourceUrl', 'sourceUrl'], ['skillPath', 'skillPath'], ['hash', hashKey], ['installedAt', 'installedAt'], ['updatedAt', 'updatedAt']] as const) {
      const v = text(entry[from]);
      if (v) skill[key] = v;
    }
    out.push(skill);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function hasSkill(dirs: string[], name: string): Promise<boolean> {
  for (const d of dirs) {
    if (await fs.stat(path.join(d, name, 'SKILL.md')).then((s) => s.isFile(), () => false)) return true;
  }
  return false;
}

/** The global lock of a home folder, with whether each skill is still in a skill folder of the home. */
export async function readGlobalLock(home: string): Promise<SkillLock | undefined> {
  const file = path.join(home, '.agents', '.skill-lock.json');
  const skills = await readLock(file, 3, 'skillFolderHash');
  if (!skills) return undefined;
  const dirs = [path.join(home, '.agents', 'skills'), path.join(home, '.claude', 'skills'), path.join(home, '.copilot', 'skills')];
  return { global: true, path: home, label: 'Global', file, skills: await Promise.all(skills.map(async (s) => ({ ...s, present: await hasSkill(dirs, s.name) }))) };
}

/** A repository's skills-lock.json, with whether each skill is in one of the repository's skill folders. */
export async function readRepoLock(repo: string): Promise<SkillLock | undefined> {
  const file = path.join(repo, 'skills-lock.json');
  const skills = await readLock(file, 1, 'computedHash');
  if (!skills) return undefined;
  const dirs = [path.join(repo, '.agents', 'skills'), path.join(repo, '.claude', 'skills'), path.join(repo, '.github', 'skills')];
  return { global: false, path: repo, label: path.basename(repo) || repo, file, skills: await Promise.all(skills.map(async (s) => ({ ...s, present: await hasSkill(dirs, s.name) }))) };
}

/** The global lock and the lock of every repository that has one, global first. */
export async function readSkillsState(home: string, repos: string[]): Promise<SkillsState> {
  const locks: SkillLock[] = [];
  const global = await readGlobalLock(home);
  if (global) locks.push(global);
  const seen = new Set<string>();
  for (const r of repos) {
    const key = path.resolve(r).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const lock = await readRepoLock(r);
    if (lock) locks.push(lock);
  }
  return { locks };
}

/** The lock entry of the skill whose SKILL.md is `skillFile`, for the element page. A skill under the home folder (and not in a repository inside it) belongs to the global lock. */
export async function sourceOfSkill(skillFile: string, home: string, repoRoot: string | undefined): Promise<SkillSource | undefined> {
  const name = path.basename(path.dirname(skillFile));
  const norm = (p: string) => path.resolve(p).toLowerCase();
  const under = (dir: string) => norm(skillFile).startsWith(norm(dir) + path.sep);
  const global = under(home) && !(repoRoot && under(repoRoot));
  const lock = global ? await readGlobalLock(home) : repoRoot ? await readRepoLock(repoRoot) : undefined;
  const hit = lock?.skills.find((s) => s.name === name);
  if (!lock || !hit) return undefined;
  const { present: _present, name: _name, ...rest } = hit;
  return { ...rest, global: lock.global, path: lock.path };
}

/** The command line of a skills action, or undefined for a name that is not safe to hand to a terminal or an action that has no such command (restore is a repository action). */
export function skillsCommandLine(action: SkillsCommand, global: boolean, skill?: string): string | undefined {
  if (skill !== undefined && !SAFE_NAME.test(skill)) return undefined;
  if (action === 'check') return 'npx skills check';
  if (action === 'restore') return global ? undefined : 'npx skills experimental_install';
  return `npx skills update${skill ? ` ${skill}` : ''} ${global ? '-g' : '-p'}`;
}
