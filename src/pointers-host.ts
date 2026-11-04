// AGENTS.md pointer check (ported from Claude Harness): a path, skill or agent named in backticks that does
// not exist gets a diagnostic, a CodeLens and quick fixes (repoint to the closest name, drop the line).
// Checks the repo's root AGENTS.md and the files it imports. Refreshes on save and when a repo's AGENTS.md changes.
import * as path from 'node:path';
import * as vscode from 'vscode';
import { readCustomizations } from './readers/customizations';
import { currentEnv } from './readers/paths';
import { checkedDocs, closest, deadPointers, pathCandidates, type PointerKind, type PointerToken, type Roster } from './readers/pointers';
import type { SessionService } from './session-service';

const BUILTIN_AGENTS = ['agent', 'ask', 'plan', 'edit'];
const ROSTER_TTL = 30_000;

const kindLabel = (k: PointerKind) => (k === 'path' ? 'Path' : k === 'skill' ? 'Skill' : 'Agent');
const POINTER_MESSAGE = /^(Path|Skill|Agent) `([^`]+)` not found$/;
const lineRange = (doc: vscode.TextDocument, line: number) =>
  line + 1 < doc.lineCount ? new vscode.Range(line, 0, line + 1, 0) : new vscode.Range(line, 0, line, doc.lineAt(line).text.length);

const selector: vscode.DocumentSelector = [
  { language: 'markdown', scheme: 'file' },
  { scheme: 'file', pattern: '**/AGENTS.md' },
];

export function registerPointers(context: vscode.ExtensionContext, sessions: SessionService): void {
  const collection = vscode.languages.createDiagnosticCollection('copilotHarness.pointers');
  const rosters = new Map<string, { at: number; roster: Roster }>();
  const changed = new vscode.EventEmitter<void>();

  const baseOf = (file: string): string | undefined =>
    (vscode.workspace.workspaceFolders ?? [])
      .map((f) => f.uri.fsPath)
      .filter((d) => path.resolve(file).toLowerCase().startsWith(path.resolve(d).toLowerCase() + path.sep))
      .sort((a, b) => b.length - a.length)[0];

  // The names Copilot knows in this repo: workspace, user profile, ~/.copilot, ~/.claude and installed plugins.
  const rosterOf = async (base: string): Promise<Roster> => {
    const hit = rosters.get(base);
    if (hit && Date.now() - hit.at < ROSTER_TTL) return hit.roster;
    const roster: Roster = { skills: new Set(), agents: new Set(BUILTIN_AGENTS) };
    const { items } = await readCustomizations(currentEnv(), { workspaceFolders: [base], parentLookup: false });
    for (const i of items) {
      const set = i.kind === 'skill' || i.kind === 'deterministic' ? roster.skills : i.kind === 'agent' || i.kind === 'subagent' ? roster.agents : undefined;
      if (!set) continue;
      set.add(i.name);
      if (i.pluginId) set.add(`${i.pluginId.split('@')[0]}:${i.name}`);
    }
    rosters.set(base, { at: Date.now(), roster });
    return roster;
  };

  const checked = (file: string): { base: string; kinds: PointerKind[] } | undefined => {
    if (!/\.md$/i.test(file)) return undefined;
    const base = baseOf(file);
    if (!base) return undefined;
    const key = path.resolve(file).toLowerCase();
    const hit = checkedDocs(base).find((d) => path.resolve(d.file).toLowerCase() === key);
    return hit && { base, kinds: hit.kinds };
  };

  const own = async (doc: vscode.TextDocument): Promise<PointerToken[]> => {
    if (doc.uri.scheme !== 'file') return [];
    const hit = checked(doc.uri.fsPath);
    if (!hit) return [];
    return deadPointers(doc.getText(), hit.base, await rosterOf(hit.base), hit.kinds, []);
  };

  const update = async (doc: vscode.TextDocument): Promise<void> => {
    const found = await own(doc);
    if (!checked(doc.uri.fsPath) && !found.length) {
      collection.delete(doc.uri);
      return;
    }
    collection.set(
      doc.uri,
      found.map((t) => {
        const d = new vscode.Diagnostic(new vscode.Range(t.line, t.start, t.line, t.end), `${kindLabel(t.kind)} \`${t.token}\` not found`, vscode.DiagnosticSeverity.Warning);
        d.source = 'Copilot Harness';
        d.code = 'pointer';
        return d;
      })
    );
  };

  const candidates = async (file: string, token: string, kind: PointerKind): Promise<string[]> => {
    const base = baseOf(file);
    if (!base) return [];
    if (kind === 'path') return pathCandidates(token, base);
    const roster = await rosterOf(base);
    return closest(token, kind === 'skill' ? roster.skills : roster.agents);
  };

  const lenses: vscode.CodeLensProvider = {
    onDidChangeCodeLenses: changed.event,
    provideCodeLenses: async (doc) => {
      const out: vscode.CodeLens[] = [];
      const at = (line: number) => doc.lineAt(Math.min(line, doc.lineCount - 1)).range;
      for (const t of await own(doc))
        out.push(
          new vscode.CodeLens(at(t.line), { title: `${kindLabel(t.kind)} not found: ${t.token}: Repoint...`, command: 'copilotHarness.pointers.repoint', arguments: [doc.uri, t.line, t.token, t.kind] }),
          new vscode.CodeLens(at(t.line), { title: 'Drop line', command: 'copilotHarness.pointers.removeLine', arguments: [doc.uri, t.line] })
        );
      return out;
    },
  };

  const actions: vscode.CodeActionProvider = {
    provideCodeActions: async (doc, _range, ctx) => {
      const out: vscode.CodeAction[] = [];
      for (const d of ctx.diagnostics) {
        const m = POINTER_MESSAGE.exec(d.message);
        if (!m || d.source !== 'Copilot Harness') continue;
        const line = d.range.start.line;
        const token = m[2];
        const col = doc.lineAt(line).text.indexOf(token);
        for (const c of col < 0 ? [] : await candidates(doc.uri.fsPath, token, m[1].toLowerCase() as PointerKind)) {
          const a = new vscode.CodeAction(`Repoint to ${c}`, vscode.CodeActionKind.QuickFix);
          a.edit = new vscode.WorkspaceEdit();
          a.edit.replace(doc.uri, new vscode.Range(line, col, line, col + token.length), c);
          a.diagnostics = [d];
          out.push(a);
        }
        const drop = new vscode.CodeAction('Drop line', vscode.CodeActionKind.QuickFix);
        drop.edit = new vscode.WorkspaceEdit();
        drop.edit.delete(doc.uri, lineRange(doc, line));
        drop.diagnostics = [d];
        out.push(drop);
      }
      return out;
    },
  };

  const removeLine = async (uri: vscode.Uri, line: number): Promise<void> => {
    const doc = await vscode.workspace.openTextDocument(uri);
    if (line >= doc.lineCount) return;
    const edit = new vscode.WorkspaceEdit();
    edit.delete(uri, lineRange(doc, line));
    await vscode.workspace.applyEdit(edit);
  };

  const repoint = async (uri: vscode.Uri, line: number, token: string, kind: PointerKind): Promise<void> => {
    const doc = await vscode.workspace.openTextDocument(uri);
    const col = doc.lineAt(line).text.indexOf(token);
    if (col < 0) return;
    const items: vscode.QuickPickItem[] = [...(await candidates(uri.fsPath, token, kind)).map((label) => ({ label })), { label: '$(edit) Type a value...', alwaysShow: true }];
    const pick = await vscode.window.showQuickPick(items, { title: `Repoint ${token}` });
    if (!pick) return;
    const value = pick.label.startsWith('$(edit)') ? await vscode.window.showInputBox({ prompt: `Replace ${token} with`, value: token }) : pick.label;
    if (!value || value === token) return;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, new vscode.Range(line, col, line, col + token.length), value);
    await vscode.workspace.applyEdit(edit);
  };

  const refreshAll = (): void => {
    rosters.clear();
    for (const doc of vscode.workspace.textDocuments) if (doc.uri.scheme === 'file') void update(doc);
    changed.fire();
  };

  context.subscriptions.push(
    collection,
    changed,
    vscode.languages.registerCodeLensProvider(selector, lenses),
    vscode.languages.registerCodeActionsProvider(selector, actions, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
    vscode.commands.registerCommand('copilotHarness.pointers.removeLine', removeLine),
    vscode.commands.registerCommand('copilotHarness.pointers.repoint', repoint),
    vscode.workspace.onDidOpenTextDocument((doc) => void update(doc)),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      refreshAll();
      // a changed AGENTS.md refreshes its repo in the panel
      if (path.basename(doc.uri.fsPath) === 'AGENTS.md') void sessions.refresh();
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => collection.delete(doc.uri))
  );
  refreshAll();
}
