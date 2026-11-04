// The confirm cards of the `npx skills` commands, shared by the skills lock card and the skill page. Nothing runs until the card's
// button is pressed; the host then starts the command in a terminal, for a lock it read itself.
import type { SkillsCommand } from '../shared/skills';
import { post } from './bridge';
import { ask } from './market-ui';

export interface LockRef {
  global: boolean;
  /** The home folder (global) or the repository folder. */
  path: string;
  label: string;
}

/** The text of the command, as the terminal will run it. */
export const commandLine = (action: SkillsCommand, global: boolean, skill?: string): string =>
  action === 'check' ? 'npx skills check' : action === 'restore' ? 'npx skills experimental_install' : `npx skills update${skill ? ` ${skill}` : ''} ${global ? '-g' : '-p'}`;

/** Asks under `anchor`, then asks the host to run the command; `items` lists what it touches. */
export function askSkills(anchor: HTMLElement, action: SkillsCommand, lock: LockRef, skill?: string, items: string[] = []): void {
  const where = lock.global ? 'your home folder' : lock.label;
  const t =
    action === 'check'
      ? { title: 'Check for skill updates', text: `Runs ${commandLine(action, lock.global)} in a terminal at ${where}. It compares each skill the lock lists with its source and changes nothing.`, label: 'Check', glyph: 'refresh' }
      : action === 'restore'
        ? { title: 'Restore missing skills', text: `Runs ${commandLine(action, lock.global)} in a terminal at ${lock.label}. It installs the skills skills-lock.json lists into .agents/skills; skills already there stay as they are.`, label: 'Restore', glyph: 'cloud-download' }
        : { title: skill ? `Update ${skill}` : 'Update all skills', text: `Runs ${commandLine(action, lock.global, skill)} in a terminal at ${where}. It replaces the skill folder with the latest version from its source.`, label: 'Update', glyph: 'sync' };
  ask(anchor, { ...t, items }, () => post({ type: 'skillsRun', action, path: lock.path, global: lock.global, ...(skill ? { skill } : {}) }));
}
