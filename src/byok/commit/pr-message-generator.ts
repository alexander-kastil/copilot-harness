// Pull request title and description from the commits and the diff of the current branch against its base,
// written by the BYOK model selected for commit messages. The result opens as an untitled Markdown
// document (title on the first line) and is copied to the clipboard, ready for the pull request form.
import * as path from 'path';
import * as vscode from 'vscode';
import { buildPrPrompt, parsePrMessage } from '../../shared/ai-commit';
import { logger } from '../logger';
import { getBranchContext } from './git-utils';
import { runCommitModel } from './run-model';

async function pickRepository(scm?: vscode.SourceControl): Promise<string> {
  const git = vscode.extensions.getExtension('vscode.git')?.exports?.getAPI(1);
  if (!git) throw new Error('Git extension not found');
  const repos: { rootUri: vscode.Uri }[] = git.repositories;
  if (!repos.length) throw new Error('No Git repositories available');
  if (scm?.rootUri) {
    const hit = git.getRepository(scm.rootUri);
    if (hit) return hit.rootUri.fsPath;
  }
  if (repos.length === 1) return repos[0].rootUri.fsPath;
  const pick = await vscode.window.showQuickPick(
    repos.map((r) => ({ label: path.basename(r.rootUri.fsPath), description: r.rootUri.fsPath, root: r.rootUri.fsPath })),
    { placeHolder: 'Select repository for the pull request message' },
  );
  if (!pick) throw new Error('cancelled');
  return pick.root;
}

export async function generatePrMessage(secrets: vscode.SecretStorage, scm?: vscode.SourceControl): Promise<void> {
  try {
    const cwd = await pickRepository(scm);
    const config = vscode.workspace.getConfiguration();
    const text = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Generating pull request message...', cancellable: true },
      async (_progress, token) => {
        const ctx = await getBranchContext(cwd, config.get<string>('copilotHarness.byok.prBaseBranch', ''));
        const { system, user } = buildPrPrompt({
          branch: ctx.branch,
          base: ctx.base,
          commits: ctx.commits,
          diff: ctx.diff,
          language: config.get<string>('copilotHarness.byok.commitLanguage', 'English'),
          customPrompt: config.get<string>('copilotHarness.byok.prMessagePrompt', ''),
        });
        const abort = new AbortController();
        token.onCancellationRequested(() => abort.abort());
        return runCommitModel(secrets, system, user, abort.signal, () => undefined, 'pr');
      },
    );
    const { title, body } = parsePrMessage(text);
    if (!title) throw new Error('empty API response');
    const content = body ? `${title}\n\n${body}\n` : `${title}\n`;
    await vscode.env.clipboard.writeText(content);
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content });
    await vscode.window.showTextDocument(doc, { preview: false });
    vscode.window.showInformationMessage('Pull request message generated and copied. The first line is the title.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'cancelled' || /abort/i.test(message)) return;
    logger.error('pr.error', { error: message });
    vscode.window.showErrorMessage(`Failed to generate pull request message: ${message}`);
  }
}
