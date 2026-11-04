// The writes of the BYOK configuration. The Manage BYOK Models menu and the PAYG models page both call
// these, so a change made in either one is the same change.
import * as vscode from 'vscode';
import {
  addModelsTo,
  buildProviderRow,
  DEFAULT_RETRY,
  formatModelId,
  globalWrite,
  normalizeUserModels,
  patchProvider,
  providerSecretName,
  sameModel,
  withModelField,
  type ExportConfig,
  type FieldParse,
  type GlobalField,
  type NewModelOptions,
  type ProviderSummary,
} from '../../shared/byok-models';
import type { HFApiMode, HFModelItem, RetryConfig } from '../../shared/byok-types';
import { VersionManager } from '../version-manager';
import type { ByokStore } from './store';

export async function createProvider(
  store: ByokStore,
  p: { id: string; baseUrl: string; apiMode: HFApiMode; headers?: Record<string, string>; key?: string },
): Promise<void> {
  await store.setModels([...store.models(), buildProviderRow(p)]);
  if (p.key) await store.setProviderKey(p.id, p.key);
}

export async function updateProvider(store: ByokStore, providerId: string, patch: Partial<HFModelItem>): Promise<void> {
  await store.setModels(patchProvider(store.models(), providerId, patch));
}

export async function deleteProvider(store: ByokStore, providerId: string): Promise<void> {
  const owner = providerId.toLowerCase();
  await store.setModels(store.models().filter((m) => m.owned_by.toLowerCase() !== owner));
  await store.deleteProviderKey(providerId);
}

export async function createModels(
  store: ByokStore,
  provider: ProviderSummary,
  ids: string[],
  opts: NewModelOptions,
): Promise<{ added: string[]; skipped: string[] }> {
  const { models, added, skipped } = addModelsTo(store.models(), provider, ids, opts);
  await store.setModels(models);
  return { added, skipped };
}

/** Sets or removes one field of a model; refuses a change that would duplicate another model. */
export async function updateModel(
  store: ByokStore,
  current: HFModelItem,
  key: keyof HFModelItem,
  parsed: FieldParse,
): Promise<{ ok: true; model: HFModelItem } | { ok: false; error: string }> {
  const next = withModelField(current, key, parsed);
  const all = store.models();
  if (!sameModel(next, current) && all.some((m) => sameModel(m, next))) {
    return { ok: false, error: `Model ${formatModelId(next)} already exists.` };
  }
  await store.setModels(all.map((m) => (sameModel(m, current) ? next : m)));
  return { ok: true, model: next };
}

export async function deleteModel(store: ByokStore, model: { id: string; configId?: string }): Promise<void> {
  await store.setModels(store.models().filter((m) => !sameModel(m, model)));
}

export function currentRetry(store: ByokStore): RetryConfig {
  return { ...DEFAULT_RETRY, ...store.setting<RetryConfig>('retry', DEFAULT_RETRY) };
}

export async function writeGlobal(store: ByokStore, field: GlobalField, value: unknown): Promise<void> {
  const w = globalWrite(field, value, currentRetry(store));
  await store.setSetting(w.name, w.value);
}

export async function buildExport(store: ByokStore): Promise<ExportConfig> {
  const models = normalizeUserModels(store.models());
  const found = models.find((m) => m.useForCommitGeneration === true);
  const providerKeys: Record<string, string> = {};
  for (const provider of new Set(models.map((m) => m.owned_by).filter(Boolean))) {
    const key = await store.secrets.get(providerSecretName(provider));
    if (key) providerKeys[provider] = key;
  }
  return {
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
}

export async function writeExportFile(data: ExportConfig): Promise<vscode.Uri | undefined> {
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(`copilot-harness-byok-${new Date().toISOString().split('T')[0]}.json`),
    filters: { 'JSON Files': ['json'] },
    title: 'Export Copilot Harness BYOK configuration',
  });
  if (!uri) return undefined;
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(JSON.stringify(data, null, 2)));
  return uri;
}

/** Replaces the models, settings and keys with the content of an export file. */
export async function applyImport(store: ByokStore, data: ExportConfig): Promise<void> {
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
}

/** The oaicopilot.models and oaicopilot.baseUrl settings of the OAI Compatible extension. */
export function readOaiSettings(): { models: unknown; baseUrl: string } {
  const config = vscode.workspace.getConfiguration();
  return {
    models: config.get<unknown>('oaicopilot.models') ?? config.inspect<unknown>('oaicopilot.models')?.globalValue,
    baseUrl: config.get<string>('oaicopilot.baseUrl') ?? config.inspect<string>('oaicopilot.baseUrl')?.globalValue ?? '',
  };
}

export async function applyOaiImport(store: ByokStore, toAdd: HFModelItem[]): Promise<void> {
  await store.setModels([...store.models(), ...toAdd]);
}

export async function readImportFile(): Promise<string | undefined> {
  const uris = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: { 'JSON Files': ['json'] },
    title: 'Import Copilot Harness BYOK configuration',
  });
  if (!uris?.length) return undefined;
  return new TextDecoder().decode(await vscode.workspace.fs.readFile(uris[0]));
}
