// Host side of the element page: reads the file of one customization for the page, reveals it, and starts Copilot CLI
// in a terminal for its AI actions (Edit, Try it) and for "Open Copilot in <repo>". Only files the nav listed are touched.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { isListedFile } from './nav-host';
import { HarnessPanel } from './panel';
import { agentsMdInfo, editPrompt, readElement, tryCommand, type AgentsMdSettings } from './readers/element-view';
import { skillUsage } from './readers/session-view';
import type { SessionService } from './session-service';
import { KINDS } from './shared/customizations';

const SHELL_UNSAFE = /["`$%\r\n]/;

// The repository an AGENTS.md belongs to: its workspace folder, else the nearest folder above it with a .git.
function repoRootOf(file: string): string {
  const lower = (p: string) => path.resolve(p).toLowerCase();
  const folder = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath).filter((d) => lower(file).startsWith(lower(d) + path.sep)).sort((a, b) => b.length - a.length)[0];
  if (folder) return folder;
  for (let d = path.dirname(file); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git')) || path.dirname(d) === d) return d;
  }
}

function agentsMdSettings(): AgentsMdSettings {
  const read = (key: string, fallback: boolean) => {
    const i = vscode.workspace.getConfiguration('chat').inspect<boolean>(key);
    if (i?.workspaceFolderValue !== undefined) return { value: i.workspaceFolderValue, from: 'workspace folder settings' };
    if (i?.workspaceValue !== undefined) return { value: i.workspaceValue, from: 'workspace settings' };
    if (i?.globalValue !== undefined) return { value: i.globalValue, from: 'user settings' };
    return { value: fallback, from: 'default' };
  };
  return { useAgentsMdFile: read('useAgentsMdFile', true), useNestedAgentsMdFiles: read('useNestedAgentsMdFiles', false) };
}

export function registerElements(context: vscode.ExtensionContext, sessions: SessionService): void {
  // The skill whose Used in tab is open; its answer is posted again after every session read.
  let watched: string | undefined;
  const postUsage = (): void => {
    if (!watched) return;
    const latest = sessions.latest;
    const found = latest ? skillUsage(latest, watched) : { sessions: [], days: [] };
    HarnessPanel.post({ type: 'elementUsage', name: watched, ready: latest !== undefined, ...found });
  };
  context.subscriptions.push(sessions.onDidRead(postUsage));

  const cwdFor = (repo: string | undefined, file?: string): string | undefined => {
    if (repo && fs.existsSync(repo) && (!file || file.startsWith(repo))) return repo;
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  };

  const run = (title: string, cwd: string | undefined, line: string): void => {
    const terminal = vscode.window.createTerminal({ name: title, cwd });
    terminal.show();
    terminal.sendText(line);
  };

  context.subscriptions.push(
    HarnessPanel.onMessage((m) => {
      switch (m.type) {
        case 'elementOpen': {
          if (!isListedFile(m.file)) {
            HarnessPanel.post({ type: 'elementDetail', file: m.file, error: 'This file is not in the harness any more.' });
            return;
          }
          // A repository's .git/config can hold credentials in a remote address: it is never read, only its time.
          if (/[\\/]\.git[\\/]config$/i.test(m.file)) {
            void fs.promises.stat(m.file).then(
              (s) => HarnessPanel.post({ type: 'elementDetail', file: m.file, detail: { file: m.file, folder: false, mtime: s.mtimeMs, fields: [], body: '', tools: [], applyTo: [] } }),
              () => HarnessPanel.post({ type: 'elementDetail', file: m.file, error: 'This file is not on disk any more.' })
            );
            return;
          }
          void readElement(m.file, /\.(md|mdx)$/i.test(m.file)).then((detail) => {
            if (path.basename(m.file) === 'AGENTS.md') detail.agentsMd = agentsMdInfo(m.file, repoRootOf(m.file), agentsMdSettings());
            HarnessPanel.post({ type: 'elementDetail', file: m.file, detail });
          });
          break;
        }
        case 'elementUrl':
          if (isListedFile(m.file) && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/settings\/copilot\/memory$/.test(m.url)) void vscode.env.openExternal(vscode.Uri.parse(m.url));
          break;
        case 'elementUsageOpen':
          watched = m.name;
          postUsage();
          break;
        case 'elementReveal':
          if (isListedFile(m.file)) void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(m.file));
          break;
        case 'elementAi': {
          if (!isListedFile(m.file) || !(m.kind in KINDS)) return;
          const cwd = cwdFor(m.repo, m.file);
          if (m.action === 'edit') {
            if (SHELL_UNSAFE.test(m.file) || SHELL_UNSAFE.test(m.name)) {
              void vscode.window.showWarningMessage('This name or path holds a character that cannot be passed to the terminal safely.');
              return;
            }
            run(`Edit ${m.name}`, cwd, `copilot -i "${editPrompt(KINDS[m.kind].label.toLowerCase(), m.name, m.file)}"`);
            return;
          }
          const line = tryCommand(m.kind, m.name);
          if (line) run(`Try ${m.name}`, cwd, line);
          break;
        }
        case 'repoAi':
          if (fs.existsSync(m.path)) run(`Copilot in ${m.path.split(/[\\/]/).pop()}`, m.path, 'copilot');
          break;
      }
    })
  );
}
