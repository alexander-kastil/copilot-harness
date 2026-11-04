import * as vscode from 'vscode';
import { HarnessPanel } from './panel';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand('copilotHarness.open', () => HarnessPanel.show(context)));

  const status = vscode.window.createStatusBarItem('copilotHarness.status', vscode.StatusBarAlignment.Left, 0);
  status.name = 'Copilot Harness';
  status.text = '$(copilot) Copilot Harness';
  status.tooltip = 'Open the Copilot harness';
  status.command = 'copilotHarness.open';
  status.show();
  context.subscriptions.push(status);
}

export function deactivate(): void {}
