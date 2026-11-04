import * as vscode from 'vscode';
import { CancellationToken, LanguageModelChatInformation } from 'vscode';

import type { HFApiMode, HFModelItem, HFModelsResponse } from '../shared/byok-types';
import {
  createReasoningEffortConfigurationSchema,
  type ModelPickerChatInformation,
  isReasoningEffortValue,
} from './model-configuration';
import { normalizeUserModels } from './utils';
import { VersionManager } from './version-manager';
import { fetchGeminiModels } from './gemini/gemini-api';
import { fetchOllamaModels } from './ollama/ollama-api';
import { logger } from './logger';

const DEFAULT_CONTEXT_LENGTH = 128000;
const DEFAULT_MAX_TOKENS = 4096;
const EXTENSION_LABEL = 'Copilot Harness';

export async function prepareLanguageModelChatInformation(
  options: { silent: boolean },
  _token: CancellationToken,
  secrets: vscode.SecretStorage,
): Promise<LanguageModelChatInformation[]> {
  const config = vscode.workspace.getConfiguration();
  const userModels = normalizeUserModels(config.get<unknown>('copilotHarness.byok.models', []));

  let infos: ModelPickerChatInformation[];
  if (userModels && userModels.length > 0) {
    infos = userModels
      .filter((m) => !m.id.startsWith('__provider__'))
      .map((m) => {
        const contextLen = m?.context_length ?? DEFAULT_CONTEXT_LENGTH;
        const maxOutput = m?.max_completion_tokens ?? m?.max_tokens ?? DEFAULT_MAX_TOKENS;
        const maxInput = Math.max(1, contextLen - maxOutput);

        const modelId = m.configId ? `${m.id}::${m.configId}` : m.id;
        const modelName = m.displayName || (m.configId ? `${m.id}::${m.configId}` : `${m.id}`);
        const detail = m.owned_by ? `${m.owned_by} (${EXTENSION_LABEL})` : EXTENSION_LABEL;
        const reasoningEffort = isReasoningEffortValue(m.reasoning_effort) ? m.reasoning_effort : undefined;

        return {
          id: modelId,
          name: modelName,
          detail: detail,
          tooltip: detail,
          family: m.family ?? EXTENSION_LABEL,
          version: '1.0.0',
          maxInputTokens: maxInput,
          maxOutputTokens: maxOutput,
          isUserSelectable: true,
          isBYOK: true,
          ...(reasoningEffort
            ? { configurationSchema: createReasoningEffortConfigurationSchema(reasoningEffort) }
            : {}),
          capabilities: {
            toolCalling: true,
            imageInput: m?.vision ?? false,
          },
        } satisfies ModelPickerChatInformation;
      });
  } else {
    const apiKey = await ensureApiKey(options.silent, secrets);
    if (!apiKey) {
      if (options.silent) {
        return [];
      } else {
        throw new Error('Copilot Harness API key not found');
      }
    }

    const config = vscode.workspace.getConfiguration();
    const BASE_URL = config.get<string>('copilotHarness.byok.baseUrl', '');
    if (!BASE_URL || !BASE_URL.startsWith('http')) {
      throw new Error(`Invalid base URL configuration.`);
    }
    const { models } = await fetchModels(BASE_URL, apiKey);

    infos = models.flatMap((m) => {
      const providers = m?.providers ?? [];
      const modalities = m.architecture?.input_modalities ?? [];
      const vision = Array.isArray(modalities) && modalities.includes('image');

      const toolProviders = providers.filter((p) => p.supports_tools === true);
      const entries: ModelPickerChatInformation[] = [];

      for (const p of toolProviders) {
        const contextLen = p?.context_length ?? DEFAULT_CONTEXT_LENGTH;
        const maxOutput = DEFAULT_MAX_TOKENS;
        const maxInput = Math.max(1, contextLen - maxOutput);
        const detail = p.provider ? `${p.provider} (${EXTENSION_LABEL})` : EXTENSION_LABEL;
        entries.push({
          id: `${m.id}:${p.provider}`,
          name: `${m.id}`,
          detail: detail,
          tooltip: detail,
          family: m.family ?? EXTENSION_LABEL,
          version: '1.0.0',
          maxInputTokens: maxInput,
          maxOutputTokens: maxOutput,
          isUserSelectable: true,
          isBYOK: true,
          capabilities: {
            toolCalling: true,
            imageInput: vision,
          },
        } satisfies LanguageModelChatInformation);
      }

      if (entries.length === 0) {
        const base = providers.length > 0 ? providers[0] : null;
        const contextLen = base?.context_length ?? DEFAULT_CONTEXT_LENGTH;
        const maxOutput = DEFAULT_MAX_TOKENS;
        const maxInput = Math.max(1, contextLen - maxOutput);
        entries.push({
          id: `${m.id}`,
          name: `${m.id}`,
          detail: EXTENSION_LABEL,
          tooltip: EXTENSION_LABEL,
          family: m.family ?? EXTENSION_LABEL,
          version: '1.0.0',
          maxInputTokens: maxInput,
          maxOutputTokens: maxOutput,
          isUserSelectable: true,
          isBYOK: true,
          capabilities: {
            toolCalling: true,
            imageInput: true,
          },
        } satisfies LanguageModelChatInformation);
      }

      return entries;
    });
  }

  logger.info('models.loaded', { count: infos.length, source: userModels && userModels.length > 0 ? 'config' : 'api' });
  return infos;
}

export async function fetchModels(
  baseUrl: string,
  apiKey: string,
  apiMode?: HFApiMode | string,
  customHeaders?: Record<string, string>,
): Promise<{ models: HFModelItem[] }> {
  const normalizedApiMode = apiMode ?? 'openai';
  if (normalizedApiMode === 'gemini') {
    const models = await fetchGeminiModels(baseUrl, apiKey, customHeaders);
    return { models };
  } else if (normalizedApiMode === 'ollama') {
    const models = await fetchOllamaModels(baseUrl, apiKey, customHeaders);
    return { models };
  }

  const modelsList = (async () => {
    const baseHeaders: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      'User-Agent': VersionManager.getUserAgent(),
    };
    const headers = customHeaders ? { ...baseHeaders, ...customHeaders } : baseHeaders;
    const resp = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
      method: 'GET',
      headers,
    });
    if (!resp.ok) {
      let text = '';
      try {
        text = await resp.text();
      } catch (error) {
        console.error('[Copilot Harness BYOK] Failed to read response text', error);
      }
      const err = new Error(
        `Failed to fetch Copilot Harness models: ${resp.status} ${resp.statusText}${text ? `\n${text}` : ''}`,
      );
      console.error('[Copilot Harness BYOK] Failed to fetch Copilot Harness models', err);
      throw err;
    }
    const parsed = (await resp.json()) as HFModelsResponse;
    return parsed.data ?? [];
  })();

  try {
    const models = await modelsList;
    return { models };
  } catch (err) {
    const errorObj = err instanceof Error ? err : new Error(String(err));
    console.error('[Copilot Harness BYOK] Failed to fetch Copilot Harness models', err);
    logger.error('models.fetch.error', { baseUrl, error: errorObj.message });
    throw err;
  }
}

async function ensureApiKey(silent: boolean, secrets: vscode.SecretStorage): Promise<string | undefined> {
  let apiKey = await secrets.get('copilotHarness.byok.apiKey');

  if (!apiKey && !silent) {
    const entered = await vscode.window.showInputBox({
      title: 'Copilot Harness API Key',
      prompt: 'Enter your Copilot Harness API key',
      ignoreFocusOut: true,
      password: true,
    });
    if (entered && entered.trim()) {
      apiKey = entered.trim();
      await secrets.store('copilotHarness.byok.apiKey', apiKey);
    }
  }
  return apiKey;
}
