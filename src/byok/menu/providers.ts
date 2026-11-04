import * as vscode from 'vscode';
import {
  API_MODES,
  isProviderRow,
  listProviders,
  parseHeadersJson,
  PROVIDER_ROW_PREFIX,
  type ProviderSummary,
} from '../../shared/byok-models';
import type { HFApiMode, HFModelItem } from '../../shared/byok-types';
import { MultiStepInput, type InputStep } from './multi-step-input';
import { askPassword, checkKey, confirm, headerNames, keyHint, notify, type MenuContext, type ValueItem } from './prompts';
import { addModels } from './models';

interface ProviderDraft {
  id: string;
  baseUrl: string;
  apiMode: HFApiMode;
  headers: string;
  key: string;
}

const TITLE = 'Add provider';
const STEPS = 5;

function validUrl(value: string): string | undefined {
  return /^https?:\/\/\S+$/.test(value.trim()) ? undefined : 'The base URL must start with http:// or https://';
}

function validHeaders(value: string): string | undefined {
  return parseHeadersJson(value).ok ? undefined : 'Enter a JSON object of string values, or leave empty.';
}

export async function addProvider(ctx: MenuContext): Promise<void> {
  const draft: ProviderDraft = { id: '', baseUrl: ctx.store.globalBaseUrl(), apiMode: 'openai', headers: '', key: '' };
  const existing = new Set(listProviders(ctx.store.models(), '').map((p) => p.id.toLowerCase()));

  const askId: InputStep = async (input) => {
    draft.id = (
      await input.showInputBox({
        title: TITLE,
        step: 1,
        totalSteps: STEPS,
        value: draft.id,
        prompt: 'Provider ID, for example deepseek (stored in lower case)',
        validate: async (v) => {
          const id = v.trim();
          if (!id) return 'A provider ID is required.';
          if (id.includes('::')) return 'The provider ID cannot contain "::".';
          return existing.has(id.toLowerCase()) ? 'That provider already exists.' : undefined;
        },
      })
    )
      .trim()
      .toLowerCase();
    return askBase;
  };
  const askBase: InputStep = async (input) => {
    draft.baseUrl = (
      await input.showInputBox({
        title: TITLE,
        step: 2,
        totalSteps: STEPS,
        value: draft.baseUrl,
        prompt: 'Base URL of the API, for example https://api.deepseek.com',
        validate: async (v) => validUrl(v),
      })
    ).trim();
    return askMode;
  };
  const askMode: InputStep = async (input) => {
    const items: ValueItem<HFApiMode>[] = API_MODES.map((m) => ({ label: m, value: m }));
    const [picked] = await input.showQuickPick({
      title: TITLE,
      step: 3,
      totalSteps: STEPS,
      items,
      activeItem: items.find((i) => i.value === draft.apiMode),
      placeholder: 'API mode',
    });
    draft.apiMode = picked.value;
    return askHeaders;
  };
  const askHeaders: InputStep = async (input) => {
    draft.headers = await input.showInputBox({
      title: TITLE,
      step: 4,
      totalSteps: STEPS,
      value: draft.headers,
      prompt: 'Custom headers as JSON (optional), for example {"x-org": "acme"}',
      validate: async (v) => validHeaders(v),
    });
    return askKey;
  };
  const askKey: InputStep = async (input) => {
    draft.key = (
      await input.showInputBox({
        title: TITLE,
        step: 5,
        totalSteps: STEPS,
        value: '',
        password: true,
        prompt: 'API key (optional, checked against the provider model list). Leave empty to skip.',
      })
    ).trim();
    if (!draft.key) return undefined;
    const headers = parseHeadersJson(draft.headers);
    const result = await checkKey(draft.baseUrl, draft.apiMode, headers.ok ? headers.value : undefined, draft.key);
    if (result.ok) return undefined;
    return keyFailed(result.error);
  };
  const keyFailed =
    (error: string): InputStep =>
    async (input) => {
      const items: ValueItem<boolean>[] = [
        { label: '$(key) Enter a different key', value: false },
        { label: '$(save) Save the key anyway', value: true },
      ];
      const [picked] = await input.showQuickPick({
        title: TITLE,
        step: 5,
        totalSteps: STEPS,
        items,
        placeholder: `Key check failed: ${error}`,
      });
      return picked.value ? undefined : askKey;
    };

  if (!(await MultiStepInput.run(askId)) || !draft.id) return;

  const headers = parseHeadersJson(draft.headers);
  const row: HFModelItem = {
    id: `${PROVIDER_ROW_PREFIX}${draft.id}`,
    owned_by: draft.id,
    baseUrl: draft.baseUrl,
    apiMode: draft.apiMode,
    ...(headers.ok && headers.value ? { headers: headers.value } : {}),
  };
  await ctx.store.setModels([...ctx.store.models(), row]);
  if (draft.key) await ctx.store.setProviderKey(draft.id, draft.key);
  notify(`Provider ${draft.id} added.`);

  const items: ValueItem<boolean>[] = [
    { label: '$(add) Add models now', value: true },
    { label: 'Not now', value: false },
  ];
  const next = await vscode.window.showQuickPick(items, { title: `Provider ${draft.id} added`, ignoreFocusOut: true });
  if (next?.value) await addModels(ctx, draft.id);
}

export async function editProvider(ctx: MenuContext, provider: ProviderSummary): Promise<void> {
  for (;;) {
    const current = listProviders(ctx.store.models(), ctx.store.globalBaseUrl()).find(
      (p) => p.id.toLowerCase() === provider.id.toLowerCase(),
    );
    if (!current) return;
    const fields: ValueItem<string>[] = [
      { label: '$(check) Done', value: 'done' },
      { label: 'Base URL', description: current.baseUrl || '(not set)', value: 'baseUrl' },
      { label: 'API mode', description: current.apiMode, value: 'apiMode' },
      { label: 'Headers', description: headerNames(current.headers), value: 'headers' },
    ];
    const picked = await vscode.window.showQuickPick(fields, {
      title: `Edit provider ${current.id}`,
      ignoreFocusOut: true,
      matchOnDescription: true,
    });
    if (!picked || picked.value === 'done') return;
    const patch = await askProviderField(picked.value, current);
    if (!patch) continue;
    const owner = current.id.toLowerCase();
    const models = ctx.store
      .models()
      .map((m) => (m.owned_by.toLowerCase() === owner ? applyPatch(m, patch) : m));
    await ctx.store.setModels(models);
  }
}

function applyPatch(model: HFModelItem, patch: Partial<HFModelItem>): HFModelItem {
  const next = { ...model, ...patch };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete (next as Record<string, unknown>)[k];
  }
  return next;
}

async function askProviderField(field: string, current: ProviderSummary): Promise<Partial<HFModelItem> | undefined> {
  if (field === 'baseUrl') {
    const value = await vscode.window.showInputBox({
      title: `Base URL for ${current.id}`,
      value: current.baseUrl,
      ignoreFocusOut: true,
      validateInput: validUrl,
    });
    return value === undefined ? undefined : { baseUrl: value.trim() };
  }
  if (field === 'apiMode') {
    const items: ValueItem<HFApiMode>[] = API_MODES.map((m) => ({ label: m, value: m }));
    const picked = await vscode.window.showQuickPick(items, { title: `API mode for ${current.id}`, ignoreFocusOut: true });
    return picked ? { apiMode: picked.value } : undefined;
  }
  const value = await vscode.window.showInputBox({
    title: `Headers for ${current.id}`,
    prompt: 'JSON object of string values. Empty removes all headers.',
    value: current.headers ? JSON.stringify(current.headers) : '',
    ignoreFocusOut: true,
    validateInput: validHeaders,
  });
  if (value === undefined) return undefined;
  const parsed = parseHeadersJson(value);
  return { headers: parsed.ok ? parsed.value : undefined };
}

export async function setProviderKey(ctx: MenuContext, provider: ProviderSummary): Promise<void> {
  const current = await ctx.store.providerKey(provider.id);
  const key = await askPassword(`API key for ${provider.id}`, `${keyHint(current)} Enter the new key.`);
  if (!key?.trim()) return;
  await ctx.store.setProviderKey(provider.id, key);
  notify(`Key for ${provider.id} saved.`);
}

export async function removeProviderKey(ctx: MenuContext, provider: ProviderSummary): Promise<void> {
  if (!(await ctx.store.providerKey(provider.id))) {
    notify(`No key is stored for ${provider.id}.`);
    return;
  }
  if (!(await confirm(`Remove key for ${provider.id}`, 'The stored key is deleted.', 'Remove key'))) return;
  await ctx.store.deleteProviderKey(provider.id);
  notify(`Key for ${provider.id} removed.`);
}

export async function removeProvider(ctx: MenuContext, provider: ProviderSummary): Promise<void> {
  const message = `Deletes ${provider.modelCount} model(s) and the stored key.`;
  if (!(await confirm(`Remove provider ${provider.id}`, message, 'Remove provider'))) return;
  const owner = provider.id.toLowerCase();
  await ctx.store.setModels(ctx.store.models().filter((m) => m.owned_by.toLowerCase() !== owner));
  await ctx.store.deleteProviderKey(provider.id);
  notify(`Provider ${provider.id} removed.`);
}

export function visibleModels(models: HFModelItem[]): HFModelItem[] {
  return models.filter((m) => !isProviderRow(m));
}
