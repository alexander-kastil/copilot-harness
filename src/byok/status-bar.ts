import * as vscode from 'vscode';
import { LanguageModelChatInformation, LanguageModelChatRequestMessage, LanguageModelChatTool } from 'vscode';
import { countMessageTokens, countToolTokens } from './provide-token';

export function initStatusBar(context: vscode.ExtensionContext): vscode.StatusBarItem {
  const tokenCountStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  tokenCountStatusBarItem.name = 'Token Count';
  tokenCountStatusBarItem.text = '$(symbol-numeric) Ready';
  tokenCountStatusBarItem.tooltip = 'Current model token usage - Click to manage BYOK models';
  tokenCountStatusBarItem.command = 'copilotHarness.byok.manage';
  context.subscriptions.push(tokenCountStatusBarItem);

  tokenCountStatusBarItem.show();
  return tokenCountStatusBarItem;
}

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000_000) {
    return (value / 1_000_000_000).toFixed(1) + 'B';
  } else if (value >= 1_000_000) {
    return (value / 1_000_000).toFixed(1) + 'M';
  } else if (value >= 1_000) {
    return (value / 1_000).toFixed(1) + 'K';
  }
  return value.toLocaleString();
}

export function createProgressBar(usedTokens: number, maxTokens: number): string {
  const blocks = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  const usagePercentage = Math.min((usedTokens / maxTokens) * 100, 100);
  const blockIndex = Math.min(Math.floor((usagePercentage / 100) * blocks.length), blocks.length - 1);

  return `${blocks[blockIndex]} ${usagePercentage.toFixed(1)}%`;
}

export async function updateContextStatusBar(
  messages: readonly LanguageModelChatRequestMessage[],
  tools: readonly LanguageModelChatTool[] | undefined,
  model: LanguageModelChatInformation,
  statusBarItem: vscode.StatusBarItem,
  modelConfig: { includeReasoningInRequest: boolean },
): Promise<void> {
  const tokenCountPromises = messages.map((message) => countMessageTokens(message, modelConfig));

  const tokenCounts = await Promise.all(tokenCountPromises);
  const messagesTokens = tokenCounts.reduce((sum, count) => sum + count, 0);

  let toolTokens = 0;
  if (tools && tools.length > 0) {
    toolTokens = await countToolTokens(tools);
  }

  const totalTokenCount = messagesTokens + toolTokens;
  const maxTokens = model.maxInputTokens + model.maxOutputTokens;

  const progressBar = createProgressBar(totalTokenCount, maxTokens);
  const displayText = `$(symbol-parameter) ${progressBar}`;
  statusBarItem.text = displayText;
  statusBarItem.tooltip = `Token Usage: ${formatTokenCount(totalTokenCount)} / ${formatTokenCount(maxTokens)}\n
${progressBar}\n
  - Messages: ${formatTokenCount(messagesTokens)}  (${Math.min((messagesTokens / maxTokens) * 100, 100).toFixed(1)}%)
  - Tools: ${formatTokenCount(toolTokens)}  (${Math.min((toolTokens / maxTokens) * 100, 100).toFixed(1)}%) \n
Click to manage BYOK models`;

  const usagePercentage = (totalTokenCount / maxTokens) * 100;
  if (usagePercentage >= 90) {
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
  } else if (usagePercentage >= 70) {
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    statusBarItem.backgroundColor = undefined;
  }

  statusBarItem.show();
}
