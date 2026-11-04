import * as path from 'path';
import * as vscode from 'vscode';
import { abortCommitGeneration, generateCommitMsg } from './commit/commit-message-generator';
import { migrateAiCommit } from './commit/migrate-ai-commit';
import { generatePrMessage } from './commit/pr-message-generator';
import { logger } from './logger';
import { showRootMenu } from './menu/root';
import { ByokStore } from './menu/store';
import { ByokChatModelProvider } from './provider';
import { initStatusBar } from './status-bar';
import { TokenizerManager } from './tokenizer/tokenizer-manager';

const VENDOR = 'copilotharness';
const SECRET_PREFIX = 'copilotHarness.byok.apiKey';

export function registerByok(context: vscode.ExtensionContext): void {
  logger.init(path.join(context.globalStorageUri.fsPath, 'byok-logs'));
  TokenizerManager.initialize(context.extensionPath);

  const statusItem = initStatusBar(context);
  const provider = new ByokChatModelProvider(context.secrets, statusItem);
  const store = new ByokStore(context.secrets, () => provider.refreshModels());
  void migrateAiCommit(context);

  context.subscriptions.push(
    provider,
    vscode.lm.registerLanguageModelChatProvider(VENDOR, provider),
    vscode.commands.registerCommand('copilotHarness.byok.manage', () => showRootMenu({ store })),
    vscode.commands.registerCommand('copilotHarness.byok.generateGitCommitMessage', (scm) =>
      generateCommitMsg(context.secrets, scm),
    ),
    vscode.commands.registerCommand('copilotHarness.byok.abortGitCommitMessage', () => abortCommitGeneration()),
    vscode.commands.registerCommand('copilotHarness.byok.generateGitPrMessage', (scm) =>
      generatePrMessage(context.secrets, scm),
    ),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('copilotHarness.byok.logLevel')) logger.reloadConfig();
      if (e.affectsConfiguration('copilotHarness.byok')) provider.refreshModels();
    }),
    context.secrets.onDidChange((e) => {
      if (e.key.startsWith(SECRET_PREFIX)) provider.refreshModels();
    }),
  );
}
