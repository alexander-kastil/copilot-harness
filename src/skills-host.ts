// Host side of the skills lock card and the skill page's update buttons: reads the `npx skills` locks of the home folder
// and of every repository the nav lists, and runs `npx skills check`, `update` or `experimental_install` in a terminal after the
// webview's confirm card. A command runs only for a lock this host read itself.
import * as vscode from 'vscode';
import { navListing, onNavBuilt } from './nav-host';
import { HarnessPanel } from './panel';
import { currentEnv } from './readers/paths';
import { readSkillsState, skillsCommandLine } from './readers/skill-locks';
import type { SkillsState } from './shared/skills';

export function registerSkills(context: vscode.ExtensionContext): void {
  let last = '';
  const read = (): Promise<SkillsState> => readSkillsState(currentEnv().home, (navListing()?.repos ?? []).map((r) => r.path));

  const post = async (force = false): Promise<void> => {
    const state = await read();
    const json = JSON.stringify(state);
    if (!force && json === last) return;
    last = json;
    HarnessPanel.post({ type: 'skillsLock', state });
  };

  context.subscriptions.push(
    onNavBuilt(() => void post()),
    HarnessPanel.onMessage((m) => {
      if (m.type === 'ready') void post(true);
      if (m.type !== 'skillsRun') return;
      void read().then((state) => {
        const lock = state.locks.find((l) => l.global === m.global && l.path === m.path);
        if (!lock || (m.skill !== undefined && !lock.skills.some((s) => s.name === m.skill))) return;
        const line = skillsCommandLine(m.action, lock.global, m.skill);
        if (!line) return;
        const terminal = vscode.window.createTerminal({ name: `Skills: ${m.action}`, cwd: lock.path });
        terminal.show();
        terminal.sendText(line);
      });
    })
  );
}
