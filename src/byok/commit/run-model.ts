// Runs one request on the BYOK model selected for commit messages (the first model with
// useForCommitGeneration), shared by the commit message and the pull request message generators.
import * as vscode from 'vscode';
import { OpenaiApi } from '../openai/openai-api';
import { OpenaiResponsesApi } from '../openai/openai-responses-api';
import { AnthropicApi } from '../anthropic/anthropic-api';
import { OllamaApi } from '../ollama/ollama-api';
import { normalizeUserModels } from '../utils';
import { logger } from '../logger';
import type { HFModelItem } from '../../shared/byok-types';

export async function ensureApiKey(secrets: vscode.SecretStorage, provider: string): Promise<string | undefined> {
  let apiKey: string | undefined;
  if (provider && provider.trim() !== '') {
    apiKey = await secrets.get(`copilotHarness.byok.apiKey.${provider.trim().toLowerCase()}`);
  }
  return apiKey ?? (await secrets.get('copilotHarness.byok.apiKey'));
}

/** Streams the answer to the callback with the text so far and returns the whole text. */
export async function runCommitModel(
  secrets: vscode.SecretStorage,
  system: string,
  user: string,
  signal: AbortSignal,
  onText: (textSoFar: string) => void,
  label: string,
): Promise<string> {
  const config = vscode.workspace.getConfiguration();
  const userModels = normalizeUserModels(config.get<unknown>('copilotHarness.byok.models', []));
  const commitModels = userModels.filter((model: HFModelItem) => model.useForCommitGeneration === true);
  if (commitModels.length === 0) {
    throw new Error(
      "No models configured for commit message generation. Set 'useForCommitGeneration' to true for at least one model.",
    );
  }
  const selected = commitModels[0];
  const modelId = selected.id;
  logger.info(`${label}.start`, { modelId });
  const apiKey = await ensureApiKey(secrets, selected.owned_by);
  if (!apiKey) throw new Error('Copilot Harness API key not found');
  const baseUrl = selected.baseUrl || config.get<string>('copilotHarness.byok.baseUrl', '');
  if (!baseUrl || !baseUrl.startsWith('http')) throw new Error(`Invalid base URL configuration.`);

  const apiMode = selected.apiMode ?? 'openai';
  const api =
    apiMode === 'anthropic'
      ? new AnthropicApi(modelId)
      : apiMode === 'ollama'
        ? new OllamaApi(modelId)
        : apiMode === 'openai-responses'
          ? new OpenaiResponsesApi(modelId)
          : new OpenaiApi(modelId);
  const started = Date.now();
  let response = '';
  for await (const chunk of api.createMessage(selected, system, [{ role: 'user', content: user }], baseUrl, apiKey)) {
    signal.throwIfAborted();
    if (chunk.type === 'text') {
      response += chunk.text;
      onText(response);
    }
  }
  logger.info(`${label}.end`, { modelId, durationMs: Date.now() - started });
  return response;
}
