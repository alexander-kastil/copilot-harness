import * as path from 'path';
import * as vscode from 'vscode';
import { getGitDiff } from './git-utils';
import { logger } from '../logger';
import { buildCommitPrompt } from '../../shared/ai-commit';
import { runCommitModel } from './run-model';

let commitGenerationAbortController: AbortController | undefined;

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
      const gitDiff = await getGitDiff(repo.rootUri.fsPath, false, 0);
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
  const gitDiff = await getGitDiff(repoPath, false, 0);

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
  try {
    vscode.commands.executeCommand('setContext', 'copilotHarness.byok.isGeneratingCommit', true);
    const config = vscode.workspace.getConfiguration();

    const { system, user } = buildCommitPrompt({
      diff: gitDiff,
      notes: inputBox.value,
      language: config.get<string>('copilotHarness.byok.commitLanguage', 'English'),
      gitmoji: config.get<boolean>('copilotHarness.byok.commitGitmoji', false),
      customPrompt: config.get<string>('copilotHarness.byok.commitMessagePrompt', ''),
    });

    commitGenerationAbortController = new AbortController();
    await runCommitModel(
      secrets,
      system,
      user,
      commitGenerationAbortController.signal,
      (text) => {
        inputBox.value = extractCommitMessage(text);
      },
      'commit',
    );

    inputBox.value = removeThinkTags(inputBox.value);

    if (!inputBox.value) {
      throw new Error('empty API response');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('commit.error', { error: errorMessage });
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
