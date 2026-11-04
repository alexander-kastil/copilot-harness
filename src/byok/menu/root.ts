import * as vscode from 'vscode';
import { formatModelId, isProviderRow, listProviders, type ProviderSummary } from '../../shared/byok-models';
import type { HFModelItem } from '../../shared/byok-types';
import { editModel, addModels, removeModel } from './models';
import type { MenuContext } from './prompts';
import { addProvider, editProvider, removeProvider, removeProviderKey, setProviderKey } from './providers';
import { editGlobalSettings } from './settings';
import { exportToFile, importFromFile, importFromOai } from './transfer';

type Run = (ctx: MenuContext) => Promise<void>;

interface RootItem extends vscode.QuickPickItem {
  run?: Run;
  buttonRuns?: Run[];
}

const KEY = new vscode.ThemeIcon('key');
const EDIT = new vscode.ThemeIcon('edit');
const TRASH = new vscode.ThemeIcon('trash');

function button(icon: vscode.ThemeIcon, tooltip: string): vscode.QuickInputButton {
  return { iconPath: icon, tooltip };
}

async function providerItem(ctx: MenuContext, p: ProviderSummary): Promise<RootItem> {
  let host = p.baseUrl;
  try {
    host = new URL(p.baseUrl).host;
  } catch {
    host = p.baseUrl;
  }
  const hasKey = !!(await ctx.store.providerKey(p.id));
  return {
    label: p.id,
    description: `${host}  ${p.apiMode}`,
    detail: `${p.modelCount} model(s), ${hasKey ? 'key stored' : (await ctx.store.genericKey()) ? 'uses the generic key' : 'no key'}`,
    buttons: [button(KEY, 'Set or rotate key'), button(EDIT, 'Edit provider'), button(TRASH, 'Remove provider')],
    run: (c) => editProvider(c, p),
    buttonRuns: [(c) => setProviderKey(c, p), (c) => editProvider(c, p), (c) => removeProvider(c, p)],
  };
}

function modelItem(m: HFModelItem): RootItem {
  const vision = m.vision ? ', vision' : '';
  return {
    label: formatModelId(m),
    description: m.owned_by,
    detail: `${m.context_length ?? 128000} context, ${m.max_completion_tokens ?? m.max_tokens ?? 4096} output${vision}`,
    buttons: [button(EDIT, 'Edit model'), button(TRASH, 'Remove model')],
    run: (c) => editModel(c, m),
    buttonRuns: [(c) => editModel(c, m), (c) => removeModel(c, m)],
  };
}

function action(label: string, description: string, run: Run): RootItem {
  return { label, description, run };
}

async function buildItems(ctx: MenuContext, changed: boolean): Promise<RootItem[]> {
  const models = ctx.store.models();
  const providers = listProviders(models, ctx.store.globalBaseUrl());
  const items: RootItem[] = [{ label: 'Providers', kind: vscode.QuickPickItemKind.Separator }];
  for (const p of providers) items.push(await providerItem(ctx, p));
  if (providers.length === 0) items.push({ label: 'No providers yet', description: 'Use Add provider below' });
  items.push({ label: 'Models', kind: vscode.QuickPickItemKind.Separator });
  const visible = models.filter((m) => !isProviderRow(m));
  for (const m of visible) items.push(modelItem(m));
  if (visible.length === 0) items.push({ label: 'No models yet', description: 'Use Add model below' });
  items.push({ label: 'Actions', kind: vscode.QuickPickItemKind.Separator });
  items.push(
    action('$(add) Add provider', 'ID, base URL, API mode, headers, key', addProvider),
    action('$(add) Add model', 'From the live model list of a provider', (c) => addModels(c)),
    action('$(settings-gear) Global settings', 'Base URL, generic key, retry, delay, commit messages, logging', editGlobalSettings),
    action('$(cloud-download) Import from OAI Compatible', 'Reads oaicopilot.models and oaicopilot.baseUrl', importFromOai),
    action('$(folder-opened) Import from file', 'A file written by Export to file', importFromFile),
    action('$(save) Export to file', 'Writes keys in plain text', exportToFile),
    action(
      '$(refresh) Reload Window',
      changed ? 'Use this if the model picker does not show your changes' : 'Fallback when the model picker is stale',
      async () => {
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
      },
    ),
  );
  return items;
}

export async function showRootMenu(ctx: MenuContext): Promise<void> {
  let changed = false;
  for (;;) {
    const items = await buildItems(ctx, changed);
    const chosen = await new Promise<{ item: RootItem; run?: Run } | undefined>((resolve) => {
      const qp = vscode.window.createQuickPick<RootItem>();
      qp.title = 'Copilot Harness: Manage BYOK Models';
      qp.placeholder = 'Pick a provider, a model or an action';
      qp.ignoreFocusOut = true;
      qp.matchOnDescription = true;
      qp.items = items;
      let done = false;
      const finish = (value: { item: RootItem; run?: Run } | undefined) => {
        if (done) return;
        done = true;
        resolve(value);
        qp.dispose();
      };
      qp.onDidAccept(() => {
        const item = qp.selectedItems[0];
        if (item?.run) finish({ item, run: item.run });
      });
      qp.onDidTriggerItemButton((e) => {
        const index = (e.item.buttons ?? []).indexOf(e.button);
        finish({ item: e.item, run: e.item.buttonRuns?.[index] });
      });
      qp.onDidHide(() => finish(undefined));
      qp.show();
    });
    if (!chosen?.run) return;
    await chosen.run(ctx);
    changed = true;
  }
}
