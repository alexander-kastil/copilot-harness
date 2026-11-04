import * as vscode from 'vscode';
import {
  formatModelId,
  normalizeUserModels,
  parseConfigFile,
  planOaiImport,
  providerSecretName,
  type ExportConfig,
} from '../../shared/byok-models';
import { VersionManager } from '../version-manager';
import { askPassword, confirm, keyHint, notify, type MenuContext } from './prompts';

async function askKeysOnce(ctx: MenuContext, providers: string[]): Promise<void> {
  for (const provider of providers) {
    const key = await askPassword(
      `API key for ${provider}`,
      `${keyHint(await ctx.store.providerKey(provider))} Leave empty to keep it as it is.`,
    );
    if (key?.trim()) await ctx.store.setProviderKey(provider, key);
  }
}

export async function importFromOai(ctx: MenuContext): Promise<void> {
  const config = vscode.workspace.getConfiguration();
  const models = config.get<unknown>('oaicopilot.models') ?? config.inspect<unknown>('oaicopilot.models')?.globalValue;
  const baseUrl =
    config.get<string>('oaicopilot.baseUrl') ?? config.inspect<string>('oaicopilot.baseUrl')?.globalValue ?? '';
  if (!Array.isArray(models) || models.length === 0) {
    notify('No oaicopilot.models found in your settings.');
    return;
  }
  const plan = planOaiImport(models, baseUrl, ctx.store.models());
  if (plan.toAdd.length === 0) {
    notify(`Nothing to import. ${plan.duplicates.length} already exist.`);
    return;
  }
  const note = plan.duplicates.length ? `, ${plan.duplicates.length} already present are skipped` : '';
  const message = `Imports ${plan.toAdd.length} model(s) from ${plan.providers.length} provider(s)${note}.`;
  if (!(await confirm('Import from OAI Compatible', message, 'Import'))) return;
  await ctx.store.setModels([...ctx.store.models(), ...plan.toAdd]);
  notify(`${plan.toAdd.length} model(s) imported. Now the keys.`);
  await askKeysOnce(ctx, plan.providers);
}

export async function importFromFile(ctx: MenuContext): Promise<void> {
  const uris = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: { 'JSON Files': ['json'] },
    title: 'Import Copilot Harness BYOK configuration',
  });
  if (!uris?.length) return;
  const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uris[0]));
  const parsed = parseConfigFile(text);
  if (!parsed.ok) {
    void vscode.window.showErrorMessage(parsed.error);
    return;
  }
  const data = parsed.value;
  const message = `Replaces the BYOK models (${data.models.length}) and settings with the file's content.`;
  if (!(await confirm('Import from file', message, 'Replace'))) return;
  const store = ctx.store;
  await store.setSetting('baseUrl', data.baseUrl);
  await store.setSetting('delay', data.delay);
  if (data.retry !== undefined) await store.setSetting('retry', data.retry);
  await store.setSetting('readFileLines', data.readFileLines);
  await store.setSetting('commitLanguage', data.commitLanguage);
  if (data.apiKey) await store.setGenericKey(data.apiKey);
  else await store.deleteGenericKey();
  await store.setModels(data.models);
  for (const [provider, key] of Object.entries(data.providerKeys)) {
    if (key) await store.setProviderKey(provider, key);
    else await store.deleteProviderKey(provider);
  }
  notify('Configuration imported.');
}

export async function exportToFile(ctx: MenuContext): Promise<void> {
  const message = 'The file contains your API keys in plain text.';
  if (!(await confirm('Export to file', message, 'Choose file'))) return;
  const store = ctx.store;
  const models = normalizeUserModels(store.models());
  const found = models.find((m) => m.useForCommitGeneration === true);
  const providerKeys: Record<string, string> = {};
  for (const provider of new Set(models.map((m) => m.owned_by).filter(Boolean))) {
    const key = await ctx.store.secrets.get(providerSecretName(provider));
    if (key) providerKeys[provider] = key;
  }
  const data: ExportConfig = {
    version: VersionManager.getVersion(),
    exportDate: new Date().toISOString(),
    baseUrl: store.globalBaseUrl(),
    apiKey: (await store.genericKey()) ?? '',
    delay: store.setting('delay', 0),
    retry: store.setting<unknown>('retry', {}),
    commitLanguage: store.setting('commitLanguage', 'English'),
    commitModel: found ? formatModelId(found) : '',
    models,
    readFileLines: store.setting('readFileLines', 0),
    providerKeys,
  };
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(`copilot-harness-byok-${new Date().toISOString().split('T')[0]}.json`),
    filters: { 'JSON Files': ['json'] },
    title: 'Export Copilot Harness BYOK configuration',
  });
  if (!uri) return;
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(JSON.stringify(data, null, 2)));
  notify(`Configuration exported to ${uri.fsPath}`);
}
