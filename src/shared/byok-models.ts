// Pure helpers of the BYOK models setting and its menu. No vscode import.
import type { HFApiMode, HFModelItem, RetryConfig } from './byok-types';

export const GENERIC_KEY_SECRET = 'copilotHarness.byok.apiKey';
export const PROVIDER_ROW_PREFIX = '__provider__';
export const API_MODES: readonly HFApiMode[] = ['openai', 'openai-responses', 'ollama', 'anthropic', 'gemini'];

export interface ParsedModelId {
  baseId: string;
  configId?: string;
}

export interface ProviderSummary {
  id: string;
  baseUrl: string;
  apiMode: HFApiMode;
  headers?: Record<string, string>;
  modelCount: number;
}

export interface ExportConfig {
  version: string;
  exportDate: string;
  baseUrl: string;
  apiKey: string;
  delay: number;
  retry: unknown;
  commitLanguage: string;
  commitModel: string;
  models: HFModelItem[];
  readFileLines: number;
  providerKeys: Record<string, string>;
}

export interface OaiImportPlan {
  toAdd: HFModelItem[];
  duplicates: string[];
  skippedProviderRows: number;
  providers: string[];
}

export function getModelProviderId(model: unknown): string {
  if (!model || typeof model !== 'object') {
    return '';
  }
  const obj = model as Record<string, unknown>;
  const pick = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  return (
    pick(obj.owned_by) ||
    pick(obj.provide) ||
    pick(obj.provider) ||
    pick(obj.ownedBy) ||
    pick(obj.owner) ||
    pick(obj.vendor)
  );
}

export function normalizeUserModels(models: unknown): HFModelItem[] {
  const list = Array.isArray(models) ? models : [];
  const out: HFModelItem[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    out.push({ ...(item as HFModelItem), owned_by: getModelProviderId(item) });
  }
  return out;
}

export function parseModelId(modelId: string): ParsedModelId {
  const parts = modelId.split('::');
  if (parts.length >= 2) {
    return { baseId: parts[0], configId: parts.slice(1).join('::') };
  }
  return { baseId: modelId };
}

export function formatModelId(model: { id: string; configId?: string }): string {
  return model.configId ? `${model.id}::${model.configId}` : model.id;
}

export function isProviderRow(model: { id: string }): boolean {
  return model.id.startsWith(PROVIDER_ROW_PREFIX);
}

export function providerSecretName(ownedBy: string): string {
  return `${GENERIC_KEY_SECRET}.${ownedBy.trim().toLowerCase()}`;
}

export function sameModel(a: { id: string; configId?: string }, b: { id: string; configId?: string }): boolean {
  return a.id === b.id && (a.configId || '') === (b.configId || '');
}

export function listProviders(models: HFModelItem[], globalBaseUrl: string): ProviderSummary[] {
  const byId = new Map<string, ProviderSummary>();
  for (const m of models) {
    const owner = m.owned_by.trim();
    if (!owner) {
      continue;
    }
    const key = owner.toLowerCase();
    let entry = byId.get(key);
    if (!entry) {
      entry = { id: owner, baseUrl: '', apiMode: 'openai', modelCount: 0 };
      byId.set(key, entry);
    }
    if (m.baseUrl && !entry.baseUrl) {
      entry.baseUrl = m.baseUrl;
    }
    if (m.apiMode && (isProviderRow(m) || entry.apiMode === 'openai')) {
      entry.apiMode = m.apiMode;
    }
    if (m.headers && (isProviderRow(m) || !entry.headers)) {
      entry.headers = m.headers;
    }
    if (!isProviderRow(m)) {
      entry.modelCount += 1;
    }
  }
  for (const entry of byId.values()) {
    if (!entry.baseUrl) {
      entry.baseUrl = globalBaseUrl;
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function parseHeadersJson(text: string): { ok: true; value: Record<string, string> | undefined } | { ok: false } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: true, value: undefined };
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false };
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v !== 'string') {
        return { ok: false };
      }
      out[k] = v;
    }
    return { ok: true, value: out };
  } catch {
    return { ok: false };
  }
}

export function planOaiImport(source: unknown, sourceBaseUrl: string, existing: HFModelItem[]): OaiImportPlan {
  const plan: OaiImportPlan = { toAdd: [], duplicates: [], skippedProviderRows: 0, providers: [] };
  const taken: HFModelItem[] = [...existing];
  const providers = new Set<string>();
  for (const entry of normalizeUserModels(source)) {
    if (isProviderRow(entry)) {
      plan.skippedProviderRows += 1;
      continue;
    }
    if (typeof entry.id !== 'string' || !entry.id) {
      continue;
    }
    const { provider, provide, ...rest } = entry as HFModelItem & { provider?: string; provide?: string };
    void provider;
    void provide;
    const mapped: HFModelItem = { ...rest };
    if (!mapped.baseUrl && sourceBaseUrl) {
      mapped.baseUrl = sourceBaseUrl;
    }
    if (taken.some((t) => sameModel(t, mapped))) {
      plan.duplicates.push(formatModelId(mapped));
      continue;
    }
    taken.push(mapped);
    plan.toAdd.push(mapped);
    if (mapped.owned_by) {
      providers.add(mapped.owned_by.toLowerCase());
    }
  }
  plan.providers = [...providers].sort();
  return plan;
}

export function parseConfigFile(text: string): { ok: true; value: ExportConfig } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'The file is not valid JSON.' };
  }
  if (!data || typeof data !== 'object' || !Array.isArray((data as ExportConfig).models)) {
    return { ok: false, error: 'Invalid configuration file: models must be an array.' };
  }
  const d = data as Partial<ExportConfig>;
  return {
    ok: true,
    value: {
      version: d.version ?? '',
      exportDate: d.exportDate ?? '',
      baseUrl: d.baseUrl ?? '',
      apiKey: d.apiKey ?? '',
      delay: d.delay ?? 0,
      retry: d.retry,
      commitLanguage: d.commitLanguage ?? 'English',
      commitModel: d.commitModel ?? '',
      models: d.models as HFModelItem[],
      readFileLines: d.readFileLines ?? 0,
      providerKeys: d.providerKeys ?? {},
    },
  };
}

export const LANGUAGES = [
  'English',
  'French',
  'Italian',
  'German',
  'Spanish',
  'Russian',
  'Chinese (Simplified)',
  'Chinese (Traditional)',
  'Japanese',
  'Korean',
  'Czech',
  'Portuguese (Brazil)',
  'Turkish',
  'Polish',
];
export const LOG_LEVELS = ['off', 'debug', 'info', 'warn', 'error'];
export const DEFAULT_RETRY: RetryConfig = { enabled: true, max_attempts: 3, interval_ms: 1000, status_codes: [] };

export type FieldKind = 'string' | 'number' | 'boolean' | 'enum' | 'json' | 'headers';

export interface FieldDef {
  key: keyof HFModelItem;
  label: string;
  kind: FieldKind;
  options?: string[];
  min?: number;
  max?: number;
  integer?: boolean;
}

export const EFFORTS = ['max', 'xhigh', 'high', 'medium', 'low', 'minimal'];

/** Every field of a model the Manage BYOK Models menu and the PAYG models page can edit. */
export const MODEL_FIELDS: FieldDef[] = [
  { key: 'id', label: 'Model ID', kind: 'string' },
  { key: 'displayName', label: 'Display name', kind: 'string' },
  { key: 'configId', label: 'Config ID', kind: 'string' },
  { key: 'owned_by', label: 'Provider (owned_by)', kind: 'string' },
  { key: 'family', label: 'Family', kind: 'string' },
  { key: 'baseUrl', label: 'Base URL', kind: 'string' },
  { key: 'apiMode', label: 'API mode', kind: 'enum', options: [...API_MODES] },
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

/** The error of a field text, or undefined when it is acceptable. An empty text removes the value. */
export function validateFieldText(def: FieldDef, text: string): string | undefined {
  const t = text.trim();
  if (!t) return def.key === 'id' || def.key === 'owned_by' ? 'A value is required.' : undefined;
  if (def.kind === 'number') {
    const n = Number(t);
    if (!Number.isFinite(n) || (def.integer && !Number.isInteger(n))) return 'Enter a number.';
    if (def.min !== undefined && n < def.min) return `At least ${def.min}.`;
    if (def.max !== undefined && n > def.max) return `At most ${def.max}.`;
  }
  if (def.kind === 'boolean' && t !== 'true' && t !== 'false') return 'Enter true or false.';
  if (def.kind === 'enum' && !(def.options ?? []).includes(t)) return `Pick one of ${(def.options ?? []).join(', ')}.`;
  if (def.kind === 'headers' && !parseHeadersJson(t).ok) return 'Enter a JSON object of string values.';
  if (def.kind === 'json') {
    try {
      const p = JSON.parse(t) as unknown;
      if (!p || typeof p !== 'object' || Array.isArray(p)) return 'Enter a JSON object.';
    } catch {
      return 'Enter valid JSON.';
    }
  }
  return undefined;
}

export type FieldParse = { ok: true; unset: true } | { ok: true; unset: false; value: unknown } | { ok: false; error: string };

/** The typed value of a field text; an empty text unsets the field. */
export function parseFieldText(def: FieldDef, text: string): FieldParse {
  const error = validateFieldText(def, text);
  if (error) return { ok: false, error };
  const t = text.trim();
  if (!t) return { ok: true, unset: true };
  if (def.kind === 'number') return { ok: true, unset: false, value: Number(t) };
  if (def.kind === 'boolean') return { ok: true, unset: false, value: t === 'true' };
  if (def.kind === 'json' || def.kind === 'headers') return { ok: true, unset: false, value: JSON.parse(t) as unknown };
  return { ok: true, unset: false, value: t };
}

/** A model with one field set, or removed when the parse is an unset (or empty headers). */
export function withModelField(model: HFModelItem, key: keyof HFModelItem, parsed: FieldParse): HFModelItem {
  const next: HFModelItem = { ...model };
  const bag = next as unknown as Record<string, unknown>;
  if (!parsed.ok || parsed.unset) delete bag[key];
  else if (key === 'headers' && Object.keys(parsed.value as object).length === 0) delete bag[key];
  else bag[key] = parsed.value;
  return next;
}

/** The provider row that stores a provider's own base URL, API mode and headers. */
export function buildProviderRow(p: { id: string; baseUrl: string; apiMode: HFApiMode; headers?: Record<string, string> }): HFModelItem {
  return {
    id: `${PROVIDER_ROW_PREFIX}${p.id}`,
    owned_by: p.id,
    baseUrl: p.baseUrl,
    apiMode: p.apiMode,
    ...(p.headers ? { headers: p.headers } : {}),
  };
}

/** The models with a patch applied to every row of one provider; an undefined patch value removes the field. */
export function patchProvider(models: HFModelItem[], providerId: string, patch: Partial<HFModelItem>): HFModelItem[] {
  const owner = providerId.toLowerCase();
  return models.map((m) => {
    if (m.owned_by.toLowerCase() !== owner) return m;
    const next = { ...m, ...patch };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete (next as Record<string, unknown>)[k];
    }
    return next;
  });
}

export interface NewModelOptions {
  contextLength: number;
  maxTokens: number;
  vision: boolean;
  displayName?: string;
}

/** The models list after adding ids to a provider; the provider's placeholder row goes away. */
export function addModelsTo(
  existing: HFModelItem[],
  provider: ProviderSummary,
  ids: string[],
  opts: NewModelOptions,
): { models: HFModelItem[]; added: string[]; skipped: string[] } {
  const owner = provider.id.toLowerCase();
  const models = existing.filter((m) => !(isProviderRow(m) && m.owned_by.toLowerCase() === owner));
  const added: string[] = [];
  const skipped: string[] = [];
  for (const id of ids) {
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
      context_length: opts.contextLength,
      max_tokens: opts.maxTokens,
      vision: opts.vision,
      ...(opts.displayName?.trim() && ids.length === 1 ? { displayName: opts.displayName.trim() } : {}),
    });
    added.push(id);
  }
  return { models, added, skipped };
}

/** Global settings the menu and the page edit as one field each; retry.* fields live inside the retry object. */
export const GLOBAL_FIELDS = [
  'baseUrl',
  'delay',
  'readFileLines',
  'retry.enabled',
  'retry.max_attempts',
  'retry.interval_ms',
  'retry.status_codes',
  'commitLanguage',
  'commitMessagePrompt',
  'commitGitmoji',
  'prMessagePrompt',
  'prBaseBranch',
  'logLevel',
] as const;
export type GlobalField = (typeof GLOBAL_FIELDS)[number];

export type GlobalParse = { ok: true; value: unknown } | { ok: false; error: string };

/** The typed value of a global setting text, or the reason it is not acceptable. */
export function parseGlobalText(field: GlobalField, text: string): GlobalParse {
  const t = text.trim();
  const whole = (min: number, max?: number): GlobalParse => {
    const n = Number(t);
    if (!t || !Number.isInteger(n) || n < min || (max !== undefined && n > max)) {
      return { ok: false, error: `Enter a whole number from ${min}${max !== undefined ? ` to ${max}` : ''}.` };
    }
    return { ok: true, value: n };
  };
  switch (field) {
    case 'baseUrl':
      return /^https?:\/\/\S+$/.test(t) ? { ok: true, value: t } : { ok: false, error: 'Start with http:// or https://' };
    case 'delay':
      return whole(0);
    case 'readFileLines':
      return whole(0, 10000);
    case 'retry.max_attempts':
    case 'retry.interval_ms':
      return whole(1);
    case 'retry.enabled':
      return t === 'true' || t === 'false' ? { ok: true, value: t === 'true' } : { ok: false, error: 'Enter true or false.' };
    case 'retry.status_codes': {
      const parts = t.split(',').map((s) => s.trim()).filter(Boolean);
      if (!parts.every((s) => /^\d{3}$/.test(s))) return { ok: false, error: 'Enter three digit codes separated by commas.' };
      return { ok: true, value: parts.map(Number) };
    }
    case 'commitLanguage':
      return LANGUAGES.includes(t) ? { ok: true, value: t } : { ok: false, error: 'Pick one of the listed languages.' };
    case 'logLevel':
      return LOG_LEVELS.includes(t) ? { ok: true, value: t } : { ok: false, error: 'Pick one of the listed levels.' };
    case 'commitMessagePrompt':
    case 'prMessagePrompt':
      return { ok: true, value: text };
    case 'commitGitmoji':
      return t === 'true' || t === 'false' ? { ok: true, value: t === 'true' } : { ok: false, error: 'Enter true or false.' };
    case 'prBaseBranch':
      return /^\S*$/.test(t) ? { ok: true, value: t } : { ok: false, error: 'A branch name has no spaces.' };
  }
}

/** The setting name and value to write for a global field; retry.* fields merge into the current retry object. */
export function globalWrite(field: GlobalField, value: unknown, retry: RetryConfig): { name: string; value: unknown } {
  if (!field.startsWith('retry.')) return { name: field, value };
  return { name: 'retry', value: { ...DEFAULT_RETRY, ...retry, [field.slice('retry.'.length)]: value } };
}
