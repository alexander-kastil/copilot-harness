// Host side of the left nav: reads the customization inventories and the latest session read, posts the nav's
// tree (global kinds, repositories with their kinds and sessions), keeps its saved state, and answers its presses.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { HarnessPanel } from './panel';
import type { AllSessions } from './readers/all-sessions';
import { readCustomizations, readWorkspace } from './readers/customizations';
import { folderOf, mergeSessions, repositoryFolders, SOURCE_LABEL } from './readers/overview';
import { currentEnv } from './readers/paths';
import type { SessionService } from './session-service';
import { KINDS, type CustomizationItem, type Kind } from './shared/customizations';
import type { NavGroup, NavRepo, NavSaved, NavState } from './shared/nav';

const PARENT_SETTING = 'chat.useCustomizationsInParentRepositories';
const SAVED_KEY = 'copilotHarness.nav';
const ADDED_KEY = 'copilotHarness.navAddedRepos';
const REMOVED_KEY = 'copilotHarness.navRemovedRepos';
const CONCURRENCY = 8;
const SESSION_CAP = 200;

const emptyRead = (source: keyof AllSessions): AllSessions[keyof AllSessions] => ({ source, sessions: [], roots: [], skipped: 0 });
const emptyAll = (): AllSessions => ({ chatSessions: emptyRead('chatSessions'), debugLogs: emptyRead('debugLogs'), traceDb: emptyRead('traceDb'), cli: emptyRead('cli') });

let listedFiles = new Set<string>();
let latestNav: NavState | undefined;

/** The nav's latest listing of Global and every repository; the Plugin Hunter builds its catalog from it. */
export const navListing = (): NavState | undefined => latestNav;

/** True for a file the nav listed: the element page reads, reveals and hands to Copilot only those. */
export const isListedFile = (file: string): boolean => listedFiles.has(file);

const keyOf = (p: string): string => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));

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

function groupsOf(items: CustomizationItem[], keepEmpty: boolean): NavGroup[] {
  const out: NavGroup[] = [];
  for (const kind of Object.keys(KINDS) as Kind[]) {
    const mine = items
      .filter((i) => i.kind === kind)
      .map((i) => ({ name: i.name, file: i.file, status: i.status, readOnly: i.readOnly, ...(i.pluginId ? { pluginId: i.pluginId } : {}), ...(i.url ? { url: i.url } : {}) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (mine.length || keepEmpty) out.push({ kind, label: KINDS[kind].label, items: mine });
  }
  return out;
}

export function registerNav(context: vscode.ExtensionContext, sessions: SessionService): void {
  let state: NavState | undefined;
  let known = new Set<string>();
  let running = false;
  let again = false;

  const list = (key: string): string[] => context.globalState.get<string[]>(key) ?? [];

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
        const all = latest ?? emptyAll();
        const open = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
        const openKeys = new Set(open.map(keyOf));
        const parentLookup = vscode.workspace.getConfiguration().get<boolean>(PARENT_SETTING) === true;
        const global = (await readCustomizations(currentEnv(), { workspaceFolders: [], parentLookup: false })).items;

        const folders = repositoryFolders(all, open);
        const have = new Set(folders.map(keyOf));
        for (const added of list(ADDED_KEY)) if (!have.has(keyOf(added))) folders.push(added);
        const removed = new Set(list(REMOVED_KEY).map(keyOf));
        const shown = folders.filter((f) => !removed.has(keyOf(f)));

        const read = await mapPool(shown, CONCURRENCY, async (folder) => [folder, await readWorkspace({ workspaceFolders: [folder], parentLookup })] as const);
        const merged = mergeSessions(all);
        const repos: NavRepo[] = read.map(([folder, items]) => {
          const key = keyOf(folder);
          const mine = merged.filter((s) => {
            const f = folderOf(s.workspace);
            return f !== undefined && keyOf(f) === key;
          });
          const last = mine[0];
          const repo: NavRepo = {
            path: folder,
            name: path.basename(folder) || folder,
            open: openKeys.has(key),
            groups: groupsOf(items, false),
            sessions: mine.slice(0, SESSION_CAP).map((s) => ({
              id: s.id,
              sourceLabel: SOURCE_LABEL[s.source],
              ...(s.title ? { title: s.title } : {}),
              ...(s.start ? { start: s.start } : {}),
              ...(s.end ? { end: s.end } : {}),
            })),
          };
          const lastTime = last ? (last.end ?? last.start) : undefined;
          if (lastTime) repo.lastSession = lastTime;
          return repo;
        });
        repos.sort((a, b) => Number(b.open) - Number(a.open) || Date.parse(b.lastSession ?? '') - Date.parse(a.lastSession ?? '') || a.name.localeCompare(b.name));

        known = new Set([...global, ...read.flatMap(([, items]) => items)].map((i) => i.file));
        listedFiles = known;
        state = { global: groupsOf(global, true), repos, sessionsReady: latest !== undefined };
        latestNav = state;
        post();
      } while (again);
    } catch {
      // A read that fails leaves the nav as it was; the next session read tries again.
    } finally {
      running = false;
    }
  };

  const post = (): void => {
    if (state) HarnessPanel.post({ type: 'nav', state: { ...state, saved: context.globalState.get<Partial<NavSaved>>(SAVED_KEY) } });
  };

  const open = async (file: string, readOnly: boolean): Promise<void> => {
    if (!known.has(file)) return;
    const uri = vscode.Uri.file(file);
    try {
      if (fs.statSync(file).isDirectory()) {
        await vscode.commands.executeCommand('revealFileInOS', uri);
        return;
      }
      await vscode.window.showTextDocument(uri, { preview: true });
      if (readOnly) await vscode.commands.executeCommand('workbench.action.files.setActiveEditorReadonlyInSession');
    } catch (e) {
      void vscode.window.showWarningMessage(`Could not open ${path.basename(file)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const addRepo = async (): Promise<void> => {
    const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: true, openLabel: 'Add repository' });
    if (!picked?.length) return;
    const keys = new Set(picked.map((u) => keyOf(u.fsPath)));
    const added = list(ADDED_KEY).filter((p) => !keys.has(keyOf(p)));
    await context.globalState.update(ADDED_KEY, [...added, ...picked.map((u) => u.fsPath)]);
    await context.globalState.update(REMOVED_KEY, list(REMOVED_KEY).filter((p) => !keys.has(keyOf(p))));
    await build();
  };

  const removeRepo = async (): Promise<void> => {
    const repos = state?.repos ?? [];
    if (!repos.length) return;
    const picked = await vscode.window.showQuickPick(
      repos.map((r) => ({ label: r.name, description: r.path, path: r.path })),
      { canPickMany: true, placeHolder: 'Remove repositories from the nav (their files and sessions stay on disk)' }
    );
    if (!picked?.length) return;
    const keys = new Set(picked.map((p) => keyOf(p.path)));
    await context.globalState.update(ADDED_KEY, list(ADDED_KEY).filter((p) => !keys.has(keyOf(p))));
    await context.globalState.update(REMOVED_KEY, [...list(REMOVED_KEY), ...picked.map((p) => p.path)]);
    await build();
  };

  context.subscriptions.push(
    sessions.onDidRead(() => void build()),
    HarnessPanel.onMessage((m) => {
      if (m.type === 'ready') {
        post();
        void build();
      } else if (m.type === 'navSave') void context.globalState.update(SAVED_KEY, m.saved);
      else if (m.type === 'navOpen') void open(m.file, m.readOnly);
      else if (m.type === 'navAddRepo') void addRepo();
      else if (m.type === 'navRemoveRepo') void removeRepo();
      else if (m.type === 'navRefresh') void sessions.refresh().then(() => build());
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void build())
  );
}
