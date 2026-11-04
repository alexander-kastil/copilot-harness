import * as vscode from 'vscode';
import type { HFModelItem, RetryConfig } from '../shared/byok-types';
import { OpenAIFunctionToolDef } from './openai/openai-types';

import { logger } from './logger';

const RETRY_MAX_ATTEMPTS = 3;
const RETRY_INTERVAL_MS = 1000;
const RETRY_BACKOFF_FACTOR = 2;
const RETRY_MAX_INTERVAL_MS = 60000;

const RETRYABLE_STATUS_CODES = [429, 500, 502, 503, 504];

const networkErrorPatterns = [
  'fetch failed',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNREFUSED',
  'timeout',
  'TIMEOUT',
  'network error',
  'NetworkError',
];

export { getModelProviderId, normalizeUserModels, parseModelId, type ParsedModelId } from '../shared/byok-models';

export function mapRole(message: vscode.LanguageModelChatRequestMessage): 'user' | 'assistant' | 'system' {
  const USER = vscode.LanguageModelChatMessageRole.User as unknown as number;
  const ASSISTANT = vscode.LanguageModelChatMessageRole.Assistant as unknown as number;
  const r = message.role as unknown as number;
  if (r === USER) {
    return 'user';
  }
  if (r === ASSISTANT) {
    return 'assistant';
  }
  return 'system';
}

export function convertToolsToOpenAI(options?: vscode.ProvideLanguageModelChatResponseOptions): {
  tools?: OpenAIFunctionToolDef[];
  tool_choice?: 'auto' | { type: 'function'; function: { name: string } };
} {
  const tools = options?.tools ?? [];
  if (!tools || tools.length === 0) {
    return {};
  }

  const toolDefs: OpenAIFunctionToolDef[] = tools
    .filter((t) => t && typeof t === 'object')
    .map((t) => {
      const name = t.name;
      const description = typeof t.description === 'string' ? t.description : '';
      const params = t.inputSchema ?? { type: 'object', properties: {} };
      return {
        type: 'function' as const,
        function: {
          name,
          description,
          parameters: params,
        },
      } satisfies OpenAIFunctionToolDef;
    });

  let tool_choice: 'auto' | { type: 'function'; function: { name: string } } = 'auto';
  if (options?.toolMode === vscode.LanguageModelChatToolMode.Required) {
    if (tools.length !== 1) {
      console.error('[Copilot Harness BYOK] ToolMode.Required but multiple tools:', tools.length);
      throw new Error('LanguageModelChatToolMode.Required is not supported with more than one tool');
    }
    tool_choice = { type: 'function', function: { name: tools[0].name } };
  }

  return { tools: toolDefs, tool_choice };
}

export interface OpenAIResponsesFunctionToolDef {
  type: 'function';
  name: string;
  description?: string;
  parameters?: object;
}

export type OpenAIResponsesToolChoice = 'auto' | { type: 'function'; name: string };

export function convertToolsToOpenAIResponses(options?: vscode.ProvideLanguageModelChatResponseOptions): {
  tools?: OpenAIResponsesFunctionToolDef[];
  tool_choice?: OpenAIResponsesToolChoice;
} {
  const toolConfig = convertToolsToOpenAI(options);
  if (!toolConfig.tools || toolConfig.tools.length === 0) {
    return {};
  }

  const tools: OpenAIResponsesFunctionToolDef[] = toolConfig.tools.map((t) => {
    const out: OpenAIResponsesFunctionToolDef = {
      type: 'function',
      name: t.function.name,
    };
    if (t.function.description) {
      out.description = t.function.description;
    }
    if (t.function.parameters) {
      out.parameters = t.function.parameters;
    }
    return out;
  });

  let tool_choice: OpenAIResponsesToolChoice | undefined;
  if (toolConfig.tool_choice === 'auto') {
    tool_choice = 'auto';
  } else if (toolConfig.tool_choice?.type === 'function') {
    tool_choice = { type: 'function', name: toolConfig.tool_choice.function.name };
  }

  return { tools, tool_choice };
}

export function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/') && ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mimeType);
}

export function createDataUrl(dataPart: vscode.LanguageModelDataPart): string {
  const base64Data = Buffer.from(dataPart.data).toString('base64');
  return `data:${dataPart.mimeType};base64,${base64Data}`;
}

export function isToolResultPart(value: unknown): value is { callId: string; content?: ReadonlyArray<unknown> } {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const obj = value as Record<string, unknown>;
  const hasCallId = typeof obj.callId === 'string';
  const hasContent = 'content' in obj;
  return hasCallId && hasContent;
}

export function collectToolResultText(pr: { content?: ReadonlyArray<unknown> }): string {
  let text = '';
  for (const c of pr.content ?? []) {
    if (c instanceof vscode.LanguageModelTextPart) {
      text += c.value;
    } else if (typeof c === 'string') {
      text += c;
    } else if (c instanceof vscode.LanguageModelDataPart && c.mimeType === 'cache_control') {
    } else {
      try {
        text += JSON.stringify(c);
      } catch {}
    }
  }
  return text;
}

export function tryParseJSONObject(text: string): { ok: true; value: Record<string, unknown> } | { ok: false } {
  try {
    if (!text || !/[{]/.test(text)) {
      return { ok: false };
    }
    const value = JSON.parse(text);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return { ok: true, value };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

export function createRetryConfig(): RetryConfig {
  const config = vscode.workspace.getConfiguration();
  const retryConfig = config.get<RetryConfig>('copilotHarness.byok.retry', {
    enabled: true,
    max_attempts: RETRY_MAX_ATTEMPTS,
    interval_ms: RETRY_INTERVAL_MS,
  });

  return {
    enabled: retryConfig.enabled ?? true,
    max_attempts: retryConfig.max_attempts ?? RETRY_MAX_ATTEMPTS,
    interval_ms: retryConfig.interval_ms ?? RETRY_INTERVAL_MS,
    status_codes: retryConfig.status_codes,
  };
}

export async function executeWithRetry<T>(fn: () => Promise<T>, retryConfig: RetryConfig): Promise<T> {
  if (!retryConfig.enabled) {
    return await fn();
  }

  const maxAttempts = retryConfig.max_attempts ?? RETRY_MAX_ATTEMPTS;
  const baseIntervalMs = retryConfig.interval_ms ?? RETRY_INTERVAL_MS;

  const retryableStatusCodes = retryConfig.status_codes
    ? [...new Set([...RETRYABLE_STATUS_CODES, ...retryConfig.status_codes])]
    : RETRYABLE_STATUS_CODES;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      const isRetryableStatusError = retryableStatusCodes.some((code) => lastError?.message.includes(`[${code}]`));

      const isRetryableNetworkError = networkErrorPatterns.some((pattern) => lastError?.message.includes(pattern));
      const isRetryableError = isRetryableStatusError || isRetryableNetworkError;

      if (!isRetryableError || attempt === maxAttempts) {
        throw lastError;
      }

      const delayMs = Math.min(baseIntervalMs * Math.pow(RETRY_BACKOFF_FACTOR, attempt), RETRY_MAX_INTERVAL_MS);

      logger.warn('retry.attempt', {
        attempt: attempt + 1,
        maxAttempts,
        delayMs,
        errorName: lastError.name,
        errorMessage: lastError.message,
      });

      console.error(
        `[Copilot Harness BYOK] Retryable error detected, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxAttempts}). Error:`,
        lastError instanceof Error ? { name: lastError.name, message: lastError.message } : String(lastError),
      );

      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }

  logger.error('retry.exhausted', {
    maxAttempts,
    lastError: lastError ? { name: lastError.name, message: lastError.message } : String(lastError),
  });
  throw lastError || new Error('Retry failed');
}
