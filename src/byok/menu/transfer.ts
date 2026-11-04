import * as vscode from 'vscode';
import { parseConfigFile, planOaiImport } from '../../shared/byok-models';
import { applyImport, applyOaiImport, buildExport, readImportFile, readOaiSettings, writeExportFile } from './ops';
import { askPassword, confirm, keyHint, notify, type MenuContext } from './prompts';

export async function askKeysOnce(ctx: MenuContext, providers: string[]): Promise<void> {
  for (const provider of providers) {
    const key = await askPassword(
      `API key for ${provider}`,
      `${keyHint(await ctx.store.providerKey(provider))} Leave empty to keep it as it is.`,
    );
    if (key?.trim()) await ctx.store.setProviderKey(provider, key);
  }
}

export async function importFromOai(ctx: MenuContext): Promise<void> {
  const { models, baseUrl } = readOaiSettings();
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
  await applyOaiImport(ctx.store, plan.toAdd);
  notify(`${plan.toAdd.length} model(s) imported. Now the keys.`);
  await askKeysOnce(ctx, plan.providers);
}

export async function importFromFile(ctx: MenuContext): Promise<void> {
  const text = await readImportFile();
  if (text === undefined) return;
  const parsed = parseConfigFile(text);
  if (!parsed.ok) {
    void vscode.window.showErrorMessage(parsed.error);
    return;
  }
  const data = parsed.value;
  const message = `Replaces the BYOK models (${data.models.length}) and settings with the file's content.`;
  if (!(await confirm('Import from file', message, 'Replace'))) return;
  await applyImport(ctx.store, data);
  notify('Configuration imported.');
}

export async function exportToFile(ctx: MenuContext): Promise<void> {
  const message = 'The file contains your API keys in plain text.';
  if (!(await confirm('Export to file', message, 'Choose file'))) return;
  const uri = await writeExportFile(await buildExport(ctx.store));
  if (!uri) return;
  notify(`Configuration exported to ${uri.fsPath}`);
}
