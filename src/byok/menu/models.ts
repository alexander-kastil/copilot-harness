import * as vscode from 'vscode';
import {
  formatModelId,
  listProviders,
  MODEL_FIELDS,
  parseFieldText,
  sameModel,
  validateFieldText,
  type FieldDef,
  type FieldParse,
  type ProviderSummary,
} from '../../shared/byok-models';
import type { HFModelItem } from '../../shared/byok-types';
import { MultiStepInput, type InputStep } from './multi-step-input';
import { createModels, deleteModel, updateModel } from './ops';
import { checkKey, confirm, headerNames, notify, type MenuContext, type ValueItem } from './prompts';

const TITLE = 'Add model';
const MANUAL = '$(edit) Enter model ID manually';

interface ModelDraft {
  provider?: ProviderSummary;
  ids: string[];
  manual: boolean;
  contextLength: string;
  maxTokens: string;
  vision: boolean;
  displayName: string;
  fetchedContext?: number;
}

function positiveInt(min: number, max: number) {
  return async (value: string): Promise<string | undefined> => {
    const n = Number(value.trim());
    return Number.isInteger(n) && n >= min && n <= max ? undefined : `Enter a whole number from ${min} to ${max}.`;
  };
}

export async function addModels(ctx: MenuContext, presetProvider?: string): Promise<void> {
  const providers = listProviders(ctx.store.models(), ctx.store.globalBaseUrl());
  if (providers.length === 0) {
    notify('Add a provider first.');
    return;
  }
  const draft: ModelDraft = {
    provider: presetProvider ? providers.find((p) => p.id.toLowerCase() === presetProvider.toLowerCase()) : undefined,
    ids: [],
    manual: false,
    contextLength: '128000',
    maxTokens: '4096',
    vision: false,
    displayName: '',
  };
  const preset = draft.provider !== undefined;
  const offset = preset ? 0 : 1;
  const total = 5 + offset;

  const askProvider: InputStep = async (input) => {
    const items = providers.map((p) => ({
      label: p.id,
      description: `${p.apiMode}  ${p.baseUrl}`,
      detail: `${p.modelCount} model(s)`,
      provider: p,
    }));
    const [picked] = await input.showQuickPick({
      title: TITLE,
      step: 1,
      totalSteps: total,
      items,
      activeItem: items.find((i) => i.provider === draft.provider),
      placeholder: 'Provider of the new model',
    });
    draft.provider = picked.provider;
    return askIds;
  };

  const askIds: InputStep = async (input) => {
    const provider = draft.provider!;
    const known = new Map<string, HFModelItem>();
    const manualItem: vscode.QuickPickItem = { label: MANUAL, alwaysShow: true };
    const picked = await input.showQuickPick<vscode.QuickPickItem>({
      title: `${TITLE} to ${provider.id}`,
      step: 1 + offset,
      totalSteps: total,
      items: [manualItem],
      canSelectMany: true,
      placeholder: 'Loading the model list of the provider...',
      loadItems: async () => {
        const key = (await ctx.store.keyFor(provider.id)) ?? '';
        const owned = ctx.store.models().find((m) => m.owned_by.toLowerCase() === provider.id.toLowerCase());
        const result = await checkKey(provider.baseUrl, provider.apiMode, owned?.headers ?? provider.headers, key);
        if (!result.ok) {
          void vscode.window.showWarningMessage(`Model list unavailable: ${result.error}`);
          return [manualItem];
        }
        const existing = ctx.store.models();
        for (const m of result.models) known.set(m.id, m);
        return [
          manualItem,
          ...result.models.map((m) => ({
            label: m.id,
            description: existing.some((e) => sameModel(e, { id: m.id })) ? 'already added' : undefined,
          })),
        ];
      },
    });
    draft.manual = picked.some((p) => p.label === MANUAL);
    draft.ids = picked.filter((p) => p.label !== MANUAL).map((p) => p.label);
    if (draft.ids.length === 1) {
      const fetched = known.get(draft.ids[0])?.context_length;
      if (fetched) draft.contextLength = String(fetched);
    }
    return draft.manual ? askManual : askContext;
  };

  const askManual: InputStep = async (input) => {
    const text = await input.showInputBox({
      title: TITLE,
      step: 1 + offset,
      totalSteps: total,
      value: '',
      prompt: 'Model ID (separate several with commas)',
      validate: async (v) => (v.trim() || draft.ids.length ? undefined : 'A model ID is required.'),
    });
    const typed = text
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    draft.ids = [...new Set([...draft.ids, ...typed])];
    return askContext;
  };

  const askContext: InputStep = async (input) => {
    draft.contextLength = await input.showInputBox({
      title: TITLE,
      step: 2 + offset,
      totalSteps: total,
      value: draft.contextLength,
      prompt: 'Context length in tokens',
      validate: positiveInt(1000, 10_000_000),
    });
    return askMax;
  };

  const askMax: InputStep = async (input) => {
    draft.maxTokens = await input.showInputBox({
      title: TITLE,
      step: 3 + offset,
      totalSteps: total,
      value: draft.maxTokens,
      prompt: 'Maximum output tokens',
      validate: positiveInt(1, 10_000_000),
    });
    return askVision;
  };

  const askVision: InputStep = async (input) => {
    const items: ValueItem<boolean>[] = [
      { label: 'No image input', value: false },
      { label: 'Supports image input', value: true },
    ];
    const [picked] = await input.showQuickPick({
      title: TITLE,
      step: 4 + offset,
      totalSteps: total,
      items,
      activeItem: items.find((i) => i.value === draft.vision),
      placeholder: 'Vision',
    });
    draft.vision = picked.value;
    return draft.ids.length === 1 ? askName : undefined;
  };

  const askName: InputStep = async (input) => {
    draft.displayName = await input.showInputBox({
      title: TITLE,
      step: 5 + offset,
      totalSteps: total,
      value: draft.displayName,
      prompt: 'Display name in the model picker (optional)',
    });
    return undefined;
  };

  if (!(await MultiStepInput.run(preset ? askIds : askProvider))) return;
  const provider = draft.provider;
  if (!provider || draft.ids.length === 0) return;

  const { added, skipped } = await createModels(ctx.store, provider, draft.ids, {
    contextLength: Number(draft.contextLength),
    maxTokens: Number(draft.maxTokens),
    vision: draft.vision,
    displayName: draft.displayName,
  });
  const tail = skipped.length ? ` Already present: ${skipped.join(', ')}.` : '';
  notify(`${added.length} model(s) added to ${provider.id}.${tail}`);
}

function describe(def: FieldDef, value: unknown): string {
  if (value === undefined) return '(not set)';
  if (def.kind === 'headers') return headerNames(value as Record<string, string>);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const UNSET = Symbol('unset');

async function askValue(def: FieldDef, current: unknown): Promise<unknown | typeof UNSET | undefined> {
  const title = def.label;
  if (def.kind === 'boolean' || def.kind === 'enum') {
    const values = def.kind === 'boolean' ? ['true', 'false'] : (def.options ?? []);
    const items: ValueItem<string | typeof UNSET>[] = [
      ...values.map((v) => ({ label: v, description: String(current) === v ? 'current' : undefined, value: v })),
      { label: '$(discard) Unset', value: UNSET },
    ];
    const picked = await vscode.window.showQuickPick(items, { title, ignoreFocusOut: true });
    if (!picked) return undefined;
    if (picked.value === UNSET) return UNSET;
    return def.kind === 'boolean' ? picked.value === 'true' : picked.value;
  }
  const shown =
    current === undefined ? '' : typeof current === 'object' ? JSON.stringify(current) : String(current);
  const text = await vscode.window.showInputBox({
    title,
    value: shown,
    ignoreFocusOut: true,
    prompt: def.key === 'id' ? undefined : 'Empty removes the value.',
    validateInput: (v) => validateFieldText(def, v),
  });
  if (text === undefined) return undefined;
  const parsed = parseFieldText(def, text);
  return parsed.ok && !parsed.unset ? parsed.value : UNSET;
}

export async function editModel(ctx: MenuContext, model: HFModelItem): Promise<void> {
  let current = model;
  for (;;) {
    const items: (vscode.QuickPickItem & { def?: FieldDef })[] = [
      { label: '$(check) Done' },
      ...MODEL_FIELDS.map((def) => ({
        label: def.label,
        description: describe(def, current[def.key]),
        def,
      })),
    ];
    const picked = await vscode.window.showQuickPick(items, {
      title: `Edit ${formatModelId(current)}`,
      ignoreFocusOut: true,
      matchOnDescription: true,
    });
    if (!picked?.def) return;
    const value = await askValue(picked.def, current[picked.def.key]);
    if (value === undefined) continue;
    const parsed: FieldParse = value === UNSET ? { ok: true, unset: true } : { ok: true, unset: false, value };
    const result = await updateModel(ctx.store, current, picked.def.key, parsed);
    if (!result.ok) {
      void vscode.window.showErrorMessage(result.error);
      continue;
    }
    current = result.model;
  }
}

export async function removeModel(ctx: MenuContext, model: HFModelItem): Promise<void> {
  const name = formatModelId(model);
  if (!(await confirm(`Remove model ${name}`, 'The model disappears from the picker.', 'Remove model'))) return;
  await deleteModel(ctx.store, model);
  notify(`Model ${name} removed.`);
}
