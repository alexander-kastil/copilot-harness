// Skills lock card: the skills `npx skills add` installed, from ~/.agents/.skill-lock.json and each repository's skills-lock.json,
// with their npx source, and the buttons that check, update and restore them. Every button asks in a confirm card first.
import type { ToWebview } from '../../shared/messages';
import type { SkillLock, SkillsState } from '../../shared/skills';
import { el, icon, plural } from '../dom';
import { askSkills } from '../skills-ui';
import { gridTable } from '../tables';
import type { Card } from './types';

let host: HTMLElement | undefined;
let state: SkillsState | undefined;

const button = (glyph: string, label: string, tip: string, onclick: (e: MouseEvent) => void): HTMLElement =>
  el('button', { type: 'button', className: 'payg-btn secondary', title: tip, onclick }, icon(glyph), label);

function lockSection(lock: SkillLock): HTMLElement {
  const missing = lock.skills.filter((s) => !s.present);
  const ref = { global: lock.global, path: lock.path, label: lock.label };
  const table = gridTable(
    [
      { head: 'Skill', track: 'minmax(120px, 2fr)', cls: 'at-name', cell: (s) => [icon('mortar-board'), el('span', { className: 'at-label' }, s.name)], title: (s) => s.skillPath },
      { head: 'Installed from', track: 'minmax(120px, 2fr)', muted: true, cell: (s) => (s.source ? `${s.source}${s.sourceType ? ` (${s.sourceType})` : ''}` : ''), title: (s) => s.sourceUrl },
      { head: 'Updated', track: '110px', muted: true, wide: true, cell: (s) => (s.updatedAt ? new Date(s.updatedAt).toLocaleDateString() : ''), title: (s) => s.updatedAt },
      { head: 'On disk', track: '86px', cell: (s) => (s.present ? 'Yes' : 'Missing'), title: (s) => (s.present ? undefined : 'No skill folder of this name; Restore reinstalls it') },
      {
        head: '',
        track: '86px',
        cell: (s) => (s.present ? button('sync', 'Update', `Update ${s.name}\nRuns npx skills update ${s.name} in a terminal, after you confirm.`, (e) => askSkills(e.currentTarget as HTMLElement, 'update', ref, s.name)) : ''),
      },
    ],
    lock.skills,
    `Skills of ${lock.label}`
  );
  return el(
    'div',
    { className: 'skills-lock' },
    el(
      'div',
      { className: 'skills-lock-head' },
      el('b', {}, lock.global ? 'Global' : lock.label),
      el('span', { className: 'skills-lock-meta', title: lock.file }, `${plural(lock.skills.length, 'skill')}${missing.length ? `, ${missing.length} missing` : ''} · ${lock.global ? '~/.agents/.skill-lock.json' : 'skills-lock.json'}`),
      el('span', { className: 'spacer' }),
      button('refresh', 'Check for updates', 'Check for updates\nRuns npx skills check in a terminal, after you confirm. It changes nothing.', (e) => askSkills(e.currentTarget as HTMLElement, 'check', ref)),
      button('sync', 'Update all', 'Update all\nRuns npx skills update in a terminal, after you confirm.', (e) => askSkills(e.currentTarget as HTMLElement, 'update', ref)),
      missing.length && !lock.global
        ? button('cloud-download', 'Restore missing', `Restore missing\nRuns npx skills experimental_install in ${lock.label}, after you confirm.`, (e) => askSkills(e.currentTarget as HTMLElement, 'restore', ref, undefined, missing.map((s) => s.name)))
        : null
    ),
    table
  );
}

function draw(): void {
  if (!host) return;
  if (!state) {
    host.replaceChildren(el('p', {}, 'Reading the skills locks...'));
    return;
  }
  if (!state.locks.length) {
    host.replaceChildren(el('p', {}, 'No skills lock found. npx skills add writes ~/.agents/.skill-lock.json (global) and skills-lock.json in a repository.'));
    return;
  }
  host.replaceChildren(...state.locks.map(lockSection));
}

export const skillsCard: Card = {
  id: 'skills',
  title: 'Skills installed with npx skills',
  render(body) {
    host = body;
    draw();
  },
  onMessage(message: ToWebview) {
    if (message.type === 'skillsLock') {
      state = message.state;
      draw();
    }
  },
};
