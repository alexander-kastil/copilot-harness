import * as path from 'path';
import * as vscode from 'vscode';
import { getGitDiff } from './git-utils';
import { OpenaiApi } from '../openai/openai-api';
import { OpenaiResponsesApi } from '../openai/openai-responses-api';
import { AnthropicApi } from '../anthropic/anthropic-api';
import { OllamaApi } from '../ollama/ollama-api';
import { normalizeUserModels } from '../utils';
import { logger } from '../logger';
import type { HFModelItem } from '../../shared/byok-types';

let commitGenerationAbortController: AbortController | undefined;

const DEFAULT_PROMPT = {
  system:
    'You are a helpful assistant that generates informative git commit messages based on git diffs output. Skip preamble and remove all backticks surrounding the commit message.\nBased on the provided git diff, generate a conventional format commit message.',
  user: 'Notes from developer (ignore if not relevant): {{USER_CURRENT_INPUT}}',
};

export async function generateCommitMsg(secrets: vscode.SecretStorage, scm?: vscode.SourceControl) {
  try {
    const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
    if (!gitExtension) {
      throw new Error('Git extension not found');
    }

    const git = gitExtension.getAPI(1);
    if (git.repositories.length === 0) {
      throw new Error('No Git repositories available');
    }

    if (scm) {
      const repository = git.getRepository(scm.rootUri);

      if (!repository) {
        throw new Error('Repository not found for provided SCM');
      }

      await generateCommitMsgForRepository(secrets, repository);
      return;
    }

    await orchestrateWorkspaceCommitMsgGeneration(secrets, git.repositories);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`[Commit Generation Failed] ${errorMessage}`);
  }
}

async function orchestrateWorkspaceCommitMsgGeneration(secrets: vscode.SecretStorage, repos: any[]) {
  const reposWithChanges = await filterForReposWithChanges(repos);

  if (reposWithChanges.length === 0) {
    vscode.window.showInformationMessage(`No changes found in any workspace repositories.`);
    return;
  }

  if (reposWithChanges.length === 1) {
    const repo = reposWithChanges[0];
    await generateCommitMsgForRepository(secrets, repo);
    return;
  }

  const selection = await promptRepoSelection(reposWithChanges);

  if (!selection) {
    return;
  }

  if (selection.repo === null) {
    for (const repo of reposWithChanges) {
      try {
        await generateCommitMsgForRepository(secrets, repo);
      } catch (error) {
        console.error(`Failed to generate commit message for ${repo.rootUri.fsPath}:`, error);
      }
    }
  } else {
    await generateCommitMsgForRepository(secrets, selection.repo);
  }
}

async function filterForReposWithChanges(repos: any[]) {
  const reposWithChanges = [];

  for (const repo of repos) {
    try {
      const gitDiff = await getGitDiff(repo.rootUri.fsPath);
      if (gitDiff) {
        reposWithChanges.push(repo);
      }
    } catch (error) {}
  }
  return reposWithChanges;
}

async function promptRepoSelection(repos: any[]) {
  const repoItems = repos.map((repo) => ({
    label: repo.rootUri.fsPath.split(path.sep).pop() || repo.rootUri.fsPath,
    description: repo.rootUri.fsPath,
    repo: repo,
  }));

  repoItems.unshift({
    label: '$(git-commit) Generate for all repositories with changes',
    description: `Generate commit messages for ${repos.length} repositories`,
    repo: null as any,
  });

  return await vscode.window.showQuickPick(repoItems, {
    placeHolder: 'Select repository for commit message generation',
  });
}

async function generateCommitMsgForRepository(secrets: vscode.SecretStorage, repository: any) {
  const inputBox = repository.inputBox;
  const repoPath = repository.rootUri.fsPath;
  const gitDiff = await getGitDiff(repoPath);

  if (!gitDiff) {
    throw new Error(`No changes in repository ${repoPath.split(path.sep).pop() || 'repository'} for commit message`);
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.SourceControl,
      title: `Generating commit message for ${repoPath.split(path.sep).pop() || 'repository'}...`,
      cancellable: true,
    },
    () => performCommitMsgGeneration(secrets, gitDiff, inputBox),
  );
}

async function performCommitMsgGeneration(secrets: vscode.SecretStorage, gitDiff: string, inputBox: any) {
  const startTime = Date.now();
  let modelId: string | undefined;
  try {
    vscode.commands.executeCommand('setContext', 'copilotHarness.byok.isGeneratingCommit', true);
    const config = vscode.workspace.getConfiguration();

    const customSystemPrompt = config.get<string>('copilotHarness.byok.commitMessagePrompt', '');
    const PROMPT = {
      system: customSystemPrompt || DEFAULT_PROMPT.system,
      user: DEFAULT_PROMPT.user,
    };

    const prompts: string[] = [];

    const currentInput = inputBox.value?.trim() || '';
    if (currentInput) {
      prompts.push(PROMPT.user.replace('{{USER_CURRENT_INPUT}}', currentInput));
    }

    const truncatedDiff =
      gitDiff.length > 5000 ? gitDiff.substring(0, 5000) + '\n\n[Diff truncated due to size]' : gitDiff;
    prompts.push(truncatedDiff);
    const prompt = prompts.join('\n\n');

    const userModels = normalizeUserModels(config.get<unknown>('copilotHarness.byok.models', []));

    const commitModels = userModels.filter((model: HFModelItem) => model.useForCommitGeneration === true);

    if (commitModels.length === 0) {
      throw new Error(
        "No models configured for commit message generation. Please set 'useForCommitGeneration' to true for at least one model in your configuration.",
      );
    }

    const selectedModel = commitModels[0];
    modelId = selectedModel.id;
    logger.info('commit.start', { modelId });

    const apiKey = await ensureApiKey(secrets, selectedModel.owned_by);
    if (!apiKey) {
      throw new Error('Copilot Harness API key not found');
    }

    const baseUrl = selectedModel.baseUrl || config.get<string>('copilotHarness.byok.baseUrl', '');
    if (!baseUrl || !baseUrl.startsWith('http')) {
      throw new Error(`Invalid base URL configuration.`);
    }

    const commitLanguage = config.get<string>('copilotHarness.byok.commitLanguage', 'English');

    const systemPrompt = PROMPT.system + ` Generate commit message in ${commitLanguage}.`;

    const messages = [{ role: 'user', content: prompt }];

    let apiInstance;
    const apiMode = selectedModel.apiMode ?? 'openai';

    if (apiMode === 'anthropic') {
      apiInstance = new AnthropicApi(modelId);
    } else if (apiMode === 'ollama') {
      apiInstance = new OllamaApi(modelId);
    } else if (apiMode === 'openai-responses') {
      apiInstance = new OpenaiResponsesApi(modelId);
    } else {
      apiInstance = new OpenaiApi(modelId);
    }

    commitGenerationAbortController = new AbortController();
    const stream = apiInstance.createMessage(selectedModel, systemPrompt, messages, baseUrl, apiKey);

    let response = '';
    for await (const chunk of stream) {
      commitGenerationAbortController.signal.throwIfAborted();
      if (chunk.type === 'text') {
        response += chunk.text;
        inputBox.value = extractCommitMessage(response);
      }
    }

    inputBox.value = removeThinkTags(inputBox.value);

    if (!inputBox.value) {
      throw new Error('empty API response');
    }

    logger.info('commit.end', { modelId, durationMs: Date.now() - startTime });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('commit.error', { modelId: modelId ?? 'unknown', error: errorMessage });
    vscode.window.showErrorMessage(`Failed to generate commit message: ${errorMessage}`);
  } finally {
    vscode.commands.executeCommand('setContext', 'copilotHarness.byok.isGeneratingCommit', false);
  }
}

export function abortCommitGeneration() {
  commitGenerationAbortController?.abort();
  vscode.commands.executeCommand('setContext', 'copilotHarness.byok.isGeneratingCommit', false);
}

function extractCommitMessage(str: string): string {
  return str
    .trim()
    .replace(/^```[^\n]*\n?|```$/g, '')
    .trim();
}

function removeThinkTags(text: string): string {
  const regex = /<think>.*?<\/think>/gs;
  return text.replace(regex, '').trim();
}

async function ensureApiKey(secrets: vscode.SecretStorage, provider: string): Promise<string | undefined> {
  let apiKey: string | undefined;
  if (provider && provider.trim() !== '') {
    const normalizedProvider = provider.trim().toLowerCase();
    const providerKey = `copilotHarness.byok.apiKey.${normalizedProvider}`;
    apiKey = await secrets.get(providerKey);
  }

  if (!apiKey) {
    apiKey = await secrets.get('copilotHarness.byok.apiKey');
  }

  return apiKey;
}
