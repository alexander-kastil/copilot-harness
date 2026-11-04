// PAYG (pay-as-you-go) models: the BYOK models and providers that the PAYG models tile counts and
// the PAYG models page shows and configures. No vscode import. Never carries an API key value.
// Owned by the PAYG feature; extend by adding fields and union members.
import {
  DEFAULT_RETRY,
  isProviderRow,
  listProviders,
  formatModelId,
  MODEL_FIELDS,
  type GlobalField,
} from './byok-models';
import type { HFApiMode, HFModelItem, RetryConfig } from './byok-types';

/** Where a provider's key comes from: its own stored key, the generic key, or nowhere. */
export type PaygKeySource = 'own' | 'generic' | 'none';

export interface PaygProvider {
  id: string;
  baseUrl: string;
  apiMode: HFApiMode;
  /** Header names only: a header value can be a token. */
  headerNames: string[];
  modelCount: number;
  key: PaygKeySource;
}

export interface PaygModel {
  id: string;
  configId?: string;
  /** The model id with its config id, as the model picker shows it. */
  label: string;
  provider: string;
  displayName?: string;
  contextLength: number;
  maxOutput: number;
  vision: boolean;
  /** The text of every editable field except headers; empty when the field is not set. */
  values: Record<string, string>;
  headerNames: string[];
}

export interface PaygGlobal {
  /** The text of every global setting, by field name. */
  values: Record<GlobalField, string>;
  /** Whether a generic API key is stored; never the key. */
  genericKey: boolean;
}

export interface PaygFetched {
  provider: string;
  models: { id: string; contextLength?: number; added: boolean }[];
  error?: string;
}

export interface PaygPending {
  kind: 'importFile' | 'importOai';
  message: string;
}

export interface PaygNotice {
  id: number;
  level: 'info' | 'error';
  text: string;
}

/** Host to webview, posted as { type: 'payg', state }. */
export interface PaygState {
  /** Configured models, provider rows excluded: the tile's count. */
  models: number;
  providers: PaygProvider[];
  items: PaygModel[];
  global: PaygGlobal;
  /** The model list a provider returned for the add models form. */
  fetched?: PaygFetched;
  /** An import that waits for the page's confirmation. */
  pending?: PaygPending;
  notice?: PaygNotice;
}

export interface PaygSettings {
  delay: number;
  readFileLines: number;
  retry: RetryConfig;
  commitLanguage: string;
  commitMessagePrompt: string;
  commitGitmoji: boolean;
  prMessagePrompt: string;
  prBaseBranch: string;
  logLevel: string;
}

export interface PaygInput {
  models: HFModelItem[];
  baseUrl: string;
  settings: PaygSettings;
  /** Lower case ids of the providers that have their own stored key. */
  providerKeys: string[];
  genericKey: boolean;
}

const namesOf = (headers: Record<string, string> | undefined): string[] => Object.keys(headers ?? {});

function fieldText(value: unknown): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/** The number of configured models: provider rows excluded. */
export function countModels(models: HFModelItem[]): number {
  return models.filter((m) => !isProviderRow(m)).length;
}

export function buildPaygState(input: PaygInput): PaygState {
  const own = new Set(input.providerKeys.map((k) => k.toLowerCase()));
  const items = input.models.filter((m) => !isProviderRow(m));
  const retry = { ...DEFAULT_RETRY, ...input.settings.retry };
  return {
    models: items.length,
    providers: listProviders(input.models, input.baseUrl).map((p) => ({
      id: p.id,
      baseUrl: p.baseUrl,
      apiMode: p.apiMode,
      headerNames: namesOf(p.headers),
      modelCount: p.modelCount,
      key: own.has(p.id.toLowerCase()) ? 'own' : input.genericKey ? 'generic' : 'none',
    })),
    items: items.map((m) => {
      const values: Record<string, string> = {};
      for (const def of MODEL_FIELDS) {
        if (def.kind !== 'headers') values[def.key] = fieldText((m as unknown as Record<string, unknown>)[def.key]);
      }
      return {
        id: m.id,
        ...(m.configId ? { configId: m.configId } : {}),
        label: formatModelId(m),
        provider: m.owned_by,
        ...(m.displayName ? { displayName: m.displayName } : {}),
        contextLength: m.context_length ?? 128000,
        maxOutput: m.max_completion_tokens ?? m.max_tokens ?? 4096,
        vision: m.vision === true,
        values,
        headerNames: namesOf(m.headers),
      };
    }),
    global: {
      genericKey: input.genericKey,
      values: {
        baseUrl: input.baseUrl,
        delay: String(input.settings.delay),
        readFileLines: String(input.settings.readFileLines),
        'retry.enabled': String(retry.enabled),
        'retry.max_attempts': String(retry.max_attempts),
        'retry.interval_ms': String(retry.interval_ms),
        'retry.status_codes': (retry.status_codes ?? []).join(', '),
        commitLanguage: input.settings.commitLanguage,
        commitMessagePrompt: input.settings.commitMessagePrompt,
        commitGitmoji: String(input.settings.commitGitmoji),
        prMessagePrompt: input.settings.prMessagePrompt,
        prBaseBranch: input.settings.prBaseBranch,
        logLevel: input.settings.logLevel,
      },
    },
  };
}

/** Which model a message means: id plus config id. */
export interface PaygModelRef {
  id: string;
  configId?: string;
}

/** Webview to host messages of the PAYG models page. */
export type PaygToHost =
  | { type: 'paygAddProvider'; id: string; baseUrl: string; apiMode: HFApiMode; headers: string; askKey: boolean }
  /** headers: undefined keeps them, an empty text removes them, a JSON object replaces them. */
  | { type: 'paygEditProvider'; id: string; baseUrl: string; apiMode: HFApiMode; headers?: string }
  | { type: 'paygRemoveProvider'; id: string }
  | { type: 'paygSetKey'; provider: string }
  | { type: 'paygRemoveKey'; provider: string }
  | { type: 'paygFetchModels'; provider: string }
  | { type: 'paygAddModels'; provider: string; ids: string[]; contextLength: string; maxTokens: string; vision: boolean; displayName: string }
  /** values: the text of the fields to change; an empty text removes the field. */
  | { type: 'paygSaveModel'; model: PaygModelRef; values: Record<string, string> }
  | { type: 'paygRemoveModel'; model: PaygModelRef }
  /** values: the text of the global settings to change, by field name. */
  | { type: 'paygSaveGlobal'; values: Record<string, string> }
  | { type: 'paygSetGenericKey' }
  | { type: 'paygRemoveGenericKey' }
  | { type: 'paygImportOai' }
  | { type: 'paygImportFile' }
  | { type: 'paygImportApply' }
  | { type: 'paygImportCancel' }
  | { type: 'paygExport' }
  | { type: 'paygReloadWindow' };
