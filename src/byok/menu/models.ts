import * as vscode from 'vscode';
import {
  formatModelId,
  isProviderRow,
  listProviders,
  parseHeadersJson,
  sameModel,
  type ProviderSummary,
} from '../../shared/byok-models';
import type { HFModelItem } from '../../shared/byok-types';
import { MultiStepInput, type InputStep } from './multi-step-input';
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

  const owner = provider.id.toLowerCase();
  const models = ctx.store.models().filter((m) => !(isProviderRow(m) && m.owned_by.toLowerCase() === owner));
  const added: string[] = [];
  const skipped: string[] = [];
  for (const id of draft.ids) {
    if (models.some((m) => sameModel(m, { id }))) {
      skipped.push(id);
      continue;
    }
    models.push({
      id,
      owned_by: provider.id,
      baseUrl: provider.baseUrl,
      apiMode: provider.apiMode,
      ...(provider.headers ? { headers: provider.headers } : {}),
      context_length: Number(draft.contextLength),
      max_tokens: Number(draft.maxTokens),
      vision: draft.vision,
      ...(draft.displayName.trim() && draft.ids.length === 1 ? { displayName: draft.displayName.trim() } : {}),
    });
    added.push(id);
  }
  await ctx.store.setModels(models);
  const tail = skipped.length ? ` Already present: ${skipped.join(', ')}.` : '';
  notify(`${added.length} model(s) added to ${provider.id}.${tail}`);
}

type FieldKind = 'string' | 'number' | 'boolean' | 'enum' | 'json' | 'headers';

interface FieldDef {
  key: keyof HFModelItem;
  label: string;
  kind: FieldKind;
  options?: string[];
  min?: number;
  max?: number;
  integer?: boolean;
}

const EFFORTS = ['max', 'xhigh', 'high', 'medium', 'low', 'minimal'];

export const MODEL_FIELDS: FieldDef[] = [
  { key: 'id', label: 'Model ID', kind: 'string' },
  { key: 'displayName', label: 'Display name', kind: 'string' },
  { key: 'configId', label: 'Config ID', kind: 'string' },
  { key: 'owned_by', label: 'Provider (owned_by)', kind: 'string' },
  { key: 'family', label: 'Family', kind: 'string' },
  { key: 'baseUrl', label: 'Base URL', kind: 'string' },
  {
    key: 'apiMode',
    label: 'API mode',
    kind: 'enum',
    options: ['openai', 'openai-responses', 'ollama', 'anthropic', 'gemini'],
  },
  { key: 'context_length', label: 'Context length', kind: 'number', min: 1000, max: 10_000_000, integer: true },
  { key: 'max_tokens', label: 'Max tokens', kind: 'number', min: 1, max: 10_000_000, integer: true },
  { key: 'max_completion_tokens', label: 'Max completion tokens', kind: 'number', min: 1, max: 10_000_000, integer: true },
  { key: 'vision', label: 'Vision', kind: 'boolean' },
  { key: 'reasoning_effort', label: 'Reasoning effort (picker)', kind: 'enum', options: EFFORTS },
  { key: 'thinking', label: 'Thinking (Zai)', kind: 'json' },
  { key: 'enable_thinking', label: 'Enable thinking', kind: 'boolean' },
  { key: 'thinking_budget', label: 'Thinking budget', kind: 'number', min: 128, max: 10_000_000, integer: true },
  { key: 'temperature', label: 'Temperature', kind: 'number', min: 0, max: 2 },
  { key: 'top_p', label: 'Top p', kind: 'number', min: 0, max: 1 },
  { key: 'top_k', label: 'Top k', kind: 'number', min: 1, integer: true },
  { key: 'min_p', label: 'Min p', kind: 'number', min: 0, max: 1 },
  { key: 'frequency_penalty', label: 'Frequency penalty', kind: 'number', min: -2, max: 2 },
  { key: 'presence_penalty', label: 'Presence penalty', kind: 'number', min: -2, max: 2 },
  { key: 'repetition_penalty', label: 'Repetition penalty', kind: 'number', min: 0, max: 2 },
  { key: 'reasoning', label: 'Reasoning (OpenRouter, xAI)', kind: 'json' },
  { key: 'extra', label: 'Extra request body', kind: 'json' },
  { key: 'headers', label: 'Headers', kind: 'headers' },
  { key: 'include_reasoning_in_request', label: 'Send reasoning back', kind: 'boolean' },
  { key: 'useForCommitGeneration', label: 'Use for commit messages', kind: 'boolean' },
  { key: 'delay', label: 'Delay between requests (ms)', kind: 'number', min: 0, integer: true },
  { key: 'cache_control', label: 'Anthropic cache control', kind: 'boolean' },
];

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
    validateInput: (v) => {
      const t = v.trim();
      if (!t) return def.key === 'id' || def.key === 'owned_by' ? 'A value is required.' : undefined;
      if (def.kind === 'number') {
        const n = Number(t);
        if (!Number.isFinite(n) || (def.integer && !Number.isInteger(n))) return 'Enter a number.';
        if (def.min !== undefined && n < def.min) return `At least ${def.min}.`;
        if (def.max !== undefined && n > def.max) return `At most ${def.max}.`;
      }
      if (def.kind === 'headers' && !parseHeadersJson(t).ok) return 'Enter a JSON object of string values.';
      if (def.kind === 'json') {
        try {
          const p = JSON.parse(t);
          if (!p || typeof p !== 'object' || Array.isArray(p)) return 'Enter a JSON object.';
        } catch {
          return 'Enter valid JSON.';
        }
      }
      return undefined;
    },
  });
  if (text === undefined) return undefined;
  const t = text.trim();
  if (!t) return UNSET;
  if (def.kind === 'number') return Number(t);
  if (def.kind === 'json' || def.kind === 'headers') return JSON.parse(t);
  return t;
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
    const next: HFModelItem = { ...current };
    if (value === UNSET) delete (next as unknown as Record<string, unknown>)[picked.def.key];
    else (next as unknown as Record<string, unknown>)[picked.def.key] = value;
    const all = ctx.store.models();
    if (!sameModel(next, current) && all.some((m) => sameModel(m, next))) {
      void vscode.window.showErrorMessage(`Model ${formatModelId(next)} already exists.`);
      continue;
    }
    await ctx.store.setModels(all.map((m) => (sameModel(m, current) ? next : m)));
    current = next;
  }
}

export async function removeModel(ctx: MenuContext, model: HFModelItem): Promise<void> {
  const name = formatModelId(model);
  if (!(await confirm(`Remove model ${name}`, 'The model disappears from the picker.', 'Remove model'))) return;
  await ctx.store.setModels(ctx.store.models().filter((m) => !sameModel(m, model)));
  notify(`Model ${name} removed.`);
}
