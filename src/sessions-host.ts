// Host side of the Sessions page and the session detail page: posts the session list and one session's
// detail, copies a session's files out, and starts Copilot CLI in a terminal for the AI actions.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { HarnessPanel } from './panel';
import type { AllSessions } from './readers/all-sessions';
import { folderOf } from './readers/overview';
import { analyzePrompt, modelsSeen, sessionDetail, sessionFiles, sessionListRows } from './readers/session-view';
import type { SessionService } from './session-service';
import type { SessionAiAction, SessionsState } from './shared/sessions';
import { sessionLabel } from './shared/sessions';

const SKIP_KEY = 'copilotHarness.sessionAiSkipConfirm';

export function registerSessions(context: vscode.ExtensionContext, sessions: SessionService): void {
  const state = (): SessionsState => {
    const latest = sessions.latest;
    const rows = latest ? sessionListRows(latest) : [];
    return { sessions: rows, models: modelsSeen(rows), ready: latest !== undefined, skipConfirm: context.globalState.get<boolean>(SKIP_KEY) === true };
  };
  const postList = () => HarnessPanel.post({ type: 'sessions', state: state() });
  const postDetail = (id: string) => {
    const latest = sessions.latest;
    if (!latest) {
      HarnessPanel.post({ type: 'sessionDetail', id, error: 'The sessions are still being read.' });
      return;
    }
    const detail = sessionDetail(latest, id);
    HarnessPanel.post(detail ? { type: 'sessionDetail', id, detail } : { type: 'sessionDetail', id, error: 'No Copilot session with this id is on this machine any more.' });
  };

  const exportFiles = async (all: AllSessions, id: string): Promise<void> => {
    const files = sessionFiles(all, id);
    if (!files.length) {
      void vscode.window.showWarningMessage('This session has no files left to export.');
      return;
    }
    const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: 'Export here', title: 'Export the session files to a folder' });
    if (!picked?.length) return;
    const dest = path.join(picked[0].fsPath, `copilot-session-${id.slice(0, 8)}`);
    for (const f of files) {
      const to = path.join(dest, f.source, path.basename(f.file));
      await fs.promises.mkdir(path.dirname(to), { recursive: true });
      await fs.promises.cp(f.file, to, { recursive: true });
    }
    void vscode.window.showInformationMessage(`Exported ${files.length === 1 ? '1 item' : `${files.length} items`} to ${dest}`);
  };

  const runAi = (all: AllSessions, action: SessionAiAction, id: string, model: string | undefined): void => {
    const detail = sessionDetail(all, id);
    if (!detail) return;
    const folder = folderOf(detail.workspacePath);
    const cwd = folder && fs.existsSync(folder) ? folder : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const pick = model && /^[\w.:/-]+$/.test(model) ? ` --model ${model}` : '';
    const terminal = vscode.window.createTerminal({ name: action === 'analyze' ? `Analyze ${id.slice(0, 8)}` : `Continue ${id.slice(0, 8)}`, cwd });
    terminal.show();
    if (action === 'continue') {
      terminal.sendText(`copilot --resume=${id}${pick}`);
      return;
    }
    const files = sessionFiles(all, id).map((f) => f.file);
    terminal.sendText(`copilot${pick} -i "${analyzePrompt(id, sessionLabel(detail), files)}"`);
  };

  context.subscriptions.push(
    sessions.onDidRead(() => postList()),
    HarnessPanel.onMessage((m) => {
      const latest = sessions.latest;
      switch (m.type) {
        case 'ready':
        case 'sessionsRefresh':
          if (m.type === 'sessionsRefresh') void sessions.refresh();
          postList();
          break;
        case 'sessionOpen':
          postDetail(m.id);
          break;
        case 'sessionExport':
          if (latest) void exportFiles(latest, m.id);
          break;
        case 'sessionAi':
          if (latest) runAi(latest, m.action, m.id, m.model);
          break;
        case 'sessionSkipConfirm':
          void context.globalState.update(SKIP_KEY, true);
          break;
      }
    })
  );
}
