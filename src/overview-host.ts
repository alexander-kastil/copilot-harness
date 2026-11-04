// Host side of the overview page: reads the customization inventories, computes the overview from the
// latest session read, and posts it to the page on `ready` and after every session read.
import * as vscode from 'vscode';
import { HarnessPanel } from './panel';
import type { AllSessions } from './readers/all-sessions';
import { readCustomizations, readWorkspace } from './readers/customizations';
import { computeOverview, repositoryFolders } from './readers/overview';
import { currentEnv } from './readers/paths';
import type { SessionService } from './session-service';
import type { CustomizationItem } from './shared/customizations';
import type { OverviewState } from './shared/overview';

const PARENT_SETTING = 'chat.useCustomizationsInParentRepositories';
const CONCURRENCY = 8;

const emptyRead = (source: keyof AllSessions): AllSessions[keyof AllSessions] => ({ source, sessions: [], roots: [], skipped: 0 });
const emptyAll = (): AllSessions => ({ chatSessions: emptyRead('chatSessions'), debugLogs: emptyRead('debugLogs'), traceDb: emptyRead('traceDb'), cli: emptyRead('cli') });

async function mapPool<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await run(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export function registerOverview(context: vscode.ExtensionContext, sessions: SessionService): void {
  let state: OverviewState | undefined;
  let running = false;
  let again = false;

  const build = async (): Promise<void> => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        const latest = sessions.latest;
        const open = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
        const parentLookup = vscode.workspace.getConfiguration().get<boolean>(PARENT_SETTING) === true;
        const env = currentEnv();
        const global = (await readCustomizations(env, { workspaceFolders: [], parentLookup: false })).items;
        const folders = repositoryFolders(latest ?? emptyAll(), open);
        const read = await mapPool(folders, CONCURRENCY, async (folder) => [folder, await readWorkspace({ workspaceFolders: [folder], parentLookup })] as const);
        const repoItems: Record<string, CustomizationItem[]> = {};
        for (const [folder, items] of read) repoItems[folder] = items;
        state = computeOverview({ all: latest ?? emptyAll(), sessionsReady: latest !== undefined, globalItems: global, openFolders: open, repoItems, now: Date.now() });
        HarnessPanel.post({ type: 'overview', state });
      } while (again);
    } catch {
      // A read that fails leaves the page as it was; the next session read tries again.
    } finally {
      running = false;
    }
  };

  context.subscriptions.push(
    sessions.onDidRead(() => void build()),
    HarnessPanel.onMessage((m) => {
      if (m.type !== 'ready') return;
      if (state) HarnessPanel.post({ type: 'overview', state });
      void build();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void build())
  );
}
