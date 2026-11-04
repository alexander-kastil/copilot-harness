import * as vscode from 'vscode';
import { HarnessPanel } from './panel';
import { currentEnv } from './readers/paths';
import { SessionService } from './session-service';
import { registerSetupCheck } from './setup-check';
import { registerCredits } from './credits';
import { registerSnapshots } from './snapshots';
import { registerOverview } from './overview-host';
import { registerNav } from './nav-host';
import { registerSessions } from './sessions-host';
import { registerElements } from './element-host';
import { registerByok } from './byok';
import { registerPayg } from './payg-host';
import { registerPointers } from './pointers-host';
import { registerHunt } from './hunt-host';
import { registerMarkets } from './markets-host';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand('copilotHarness.open', () => HarnessPanel.show(context)));

  const sessions = new SessionService(currentEnv());
  context.subscriptions.push(sessions);
  // Features register here, one line each: registerX(context, sessions).
  registerSetupCheck(context, sessions);
  registerCredits(context, sessions);
  registerSnapshots(context, sessions);
  registerOverview(context, sessions);
  registerPayg(context);
  registerNav(context, sessions);
  registerSessions(context, sessions);
  registerElements(context, sessions);
  registerByok(context);
  registerPointers(context, sessions);
  registerHunt(context);
  registerMarkets(context);
  sessions.start();

  const status = vscode.window.createStatusBarItem('copilotHarness.status', vscode.StatusBarAlignment.Left, 0);
  status.name = 'Copilot Harness';
  status.text = '$(copilot) Copilot Harness';
  status.tooltip = 'Open the Copilot harness';
  status.command = 'copilotHarness.open';
  status.show();
  context.subscriptions.push(status);
}

export function deactivate(): void {}
