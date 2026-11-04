// Pure helpers of the BYOK models setting and its menu. No vscode import.
import type { HFApiMode, HFModelItem } from './byok-types';

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
