// Host side of the setup check (#11): reads the setting values, builds the source statuses from the
// latest session read, answers the setup card, and writes the one named setting when the user asks.
// Questions live in the webview card; nothing here shows a dialog or a notification.
import * as vscode from 'vscode';
import { HarnessPanel } from './panel';
import type { AllSessions } from './readers/all-sessions';
import { AGENT_HOST_DEBUG_LOG, computeStatuses, FILE_DEBUG_LOG, TRACE_DB, writableSetting, type SettingsSnapshot } from './readers/source-status';
import type { SessionService } from './session-service';
import type { ToHost } from './shared/messages';
import type { SetupState } from './shared/setup';

const DISMISSED_KEY = 'copilotHarness.setup.dismissed';
const KEYS = [AGENT_HOST_DEBUG_LOG, FILE_DEBUG_LOG, TRACE_DB];

/** A setting is known when VS Code registered it: an unregistered key has no default value. All three are booleans with a default. */
function snapshot(): SettingsSnapshot {
  const config = vscode.workspace.getConfiguration();
  const out: SettingsSnapshot = {};
  for (const key of KEYS) {
    const info = config.inspect<boolean>(key);
    const known = typeof info?.defaultValue === 'boolean';
    out[key] = { known, value: known ? config.get<boolean>(key) : undefined };
  }
  return out;
}

export function registerSetupCheck(context: vscode.ExtensionContext, sessions: SessionService): void {
  const state = (all: AllSessions): SetupState => ({
    statuses: computeStatuses(all, snapshot()),
    dismissed: context.globalState.get<boolean>(DISMISSED_KEY) === true,
    workspaceOpen: (vscode.workspace.workspaceFolders?.length ?? 0) > 0,
  });
  const post = (all: AllSessions | undefined) => {
    if (all) HarnessPanel.post({ type: 'setup', state: state(all) });
  };
  const result = (key: string, ok: boolean, message: string) => HarnessPanel.post({ type: 'setupResult', key, ok, message });

  const enable = async (m: Extract<ToHost, { type: 'setupEnable' }>) => {
    const def = writableSetting(m.key);
    if (!def) return result(m.key, false, 'This setting is not one the setup check changes.');
    if (!snapshot()[m.key]?.known) return result(m.key, false, 'Not available in this version of VS Code.');
    if (def.plainText && m.confirmed !== true) return result(m.key, false, 'Confirm the plain-text warning first.');
    if (def.userOnly && m.scope !== 'user') return result(m.key, false, 'This setting is honoured in user settings only.');
    if (m.scope === 'workspace' && !vscode.workspace.workspaceFolders?.length) return result(m.key, false, 'No folder is open, so there is no workspace to write to.');
    try {
      const target = m.scope === 'workspace' ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
      await vscode.workspace.getConfiguration().update(m.key, true, target);
      result(m.key, true, m.scope === 'workspace' ? 'Turned on in workspace settings.' : 'Turned on in user settings.');
    } catch (err) {
      result(m.key, false, err instanceof Error ? err.message : String(err));
    }
    post(await sessions.refresh());
  };

  context.subscriptions.push(
    sessions.onDidRead(post),
    HarnessPanel.onMessage((m) => {
      if (m.type === 'ready' || m.type === 'setupRecheck') {
        // The first read can still be pending: its result reaches the card through onDidRead.
        if (m.type === 'setupRecheck' || !sessions.latest) void sessions.refresh();
        post(sessions.latest);
      } else if (m.type === 'setupEnable') void enable(m);
      else if (m.type === 'setupDismiss') {
        void context.globalState.update(DISMISSED_KEY, true).then(() => post(sessions.latest));
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (KEYS.some((k) => e.affectsConfiguration(k))) post(sessions.latest);
    })
  );
}
