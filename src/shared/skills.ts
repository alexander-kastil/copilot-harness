// Skills installed with `npx skills add` (vercel-labs/skills) and what the panel knows about a skill folder: who loads it,
// where it came from, whether it meets the Agent Skills spec, its Codex file. No vscode import.
// Change only by adding optional fields or union members.
import type { ElementField } from './element';

/** One entry of a skills lock (~/.agents/.skill-lock.json, version 3, or a repository's skills-lock.json, version 1). */
export interface SkillLockSkill {
  name: string;
  source: string;
  sourceType: string;
  sourceUrl?: string;
  skillPath?: string;
  /** skillFolderHash (global lock) or computedHash (repository lock): what `npx skills check` compares. */
  hash?: string;
  installedAt?: string;
  updatedAt?: string;
  /** False when no skill folder of that name exists in the scope's skill folders. */
  present: boolean;
}

/** One lock file: the global one or one repository's. */
export interface SkillLock {
  global: boolean;
  /** The home folder (global) or the repository folder. */
  path: string;
  label: string;
  file: string;
  skills: SkillLockSkill[];
}

export interface SkillsState {
  locks: SkillLock[];
}

export type SkillsCommand = 'check' | 'update' | 'restore';

export type SkillsToWebview = { type: 'skillsLock'; state: SkillsState };

/** `skill` limits an update to one skill; the host runs only a command for a lock it read itself. */
export type SkillsToHost = { type: 'skillsRun'; action: SkillsCommand; path: string; global: boolean; skill?: string };

/** The npx source of a skill the element page shows, from the lock. */
export interface SkillSource {
  source: string;
  sourceType: string;
  sourceUrl?: string;
  skillPath?: string;
  hash?: string;
  installedAt?: string;
  updatedAt?: string;
  global: boolean;
  /** The lock's home or repository folder, for the update commands. */
  path: string;
}

/** agents/openai.yaml of a skill folder (the Codex UI file). */
export interface OpenAiInfo {
  file: string;
  /** Every key as a dotted path (interface.display_name, policy.allow_implicit_invocation), values as text. */
  fields: ElementField[];
  /** policy.allow_implicit_invocation is not false: Codex may pick the skill on its own. */
  implicit: boolean;
}

/** What the element page shows about a skill folder, beyond its frontmatter. */
export interface SkillInfo {
  /** The agents that load a skill from this folder, per their documentation. */
  loadedBy: string[];
  /** The agents of the list that do not read this folder. */
  notReadBy: string[];
  /** Ways the SKILL.md breaks the Agent Skills spec; empty when it meets it. */
  problems: string[];
  source?: SkillSource;
  openai?: OpenAiInfo;
}
