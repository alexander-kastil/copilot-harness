import * as vscode from 'vscode';
import {
  CancellationToken,
  LanguageModelChatRequestMessage,
  ProvideLanguageModelChatResponseOptions,
  LanguageModelResponsePart2,
  Progress,
} from 'vscode';

import type { HFModelItem } from '../../shared/byok-types';

import type { OllamaMessage, OllamaRequestBody, OllamaStreamChunk, OllamaToolCall } from './ollama-types';

import { isToolResultPart, collectToolResultText, convertToolsToOpenAI, mapRole } from '../utils';

import { CommonApi } from '../common-api';
import { logger } from '../logger';

export class OllamaApi extends CommonApi<OllamaMessage, OllamaRequestBody> {
  constructor(modelId: string) {
    super(modelId);
  }

  convertMessages(
    messages: readonly LanguageModelChatRequestMessage[],
    _modelConfig: { includeReasoningInRequest: boolean },
  ): OllamaMessage[] {
    const out: OllamaMessage[] = [];

    for (const m of messages) {
      const role = mapRole(m);
      const textParts: string[] = [];
      const imageParts: string[] = [];
      let thinkingContent = '';
      const toolCalls: OllamaToolCall[] = [];
      const toolResults: { toolName: string; content: string }[] = [];

      for (const part of m.content ?? []) {
        if (part instanceof vscode.LanguageModelTextPart) {
          textParts.push(part.value);
        } else if (part instanceof vscode.LanguageModelDataPart) {
          if (part.mimeType.startsWith('image/')) {
            const base64Data = Buffer.from(part.data).toString('base64');
            imageParts.push(base64Data);
          }
        } else if (part instanceof vscode.LanguageModelThinkingPart) {
          const content = Array.isArray(part.value) ? part.value.join('') : part.value;
          thinkingContent += content;
        } else if (part instanceof vscode.LanguageModelToolCallPart) {
          toolCalls.push({
            function: {
              name: part.name,
              arguments: (part.input as Record<string, unknown>) ?? {},
            },
          });
        } else if (isToolResultPart(part)) {
          const content = collectToolResultText(part);
          const toolName = (part as { toolName?: string }).toolName ?? 'unknown';
          toolResults.push({ toolName, content });
        }
      }

      for (const tr of toolResults) {
        out.push({
          role: 'tool',
          content: tr.content,
          tool_name: tr.toolName,
        });
      }

      if (textParts.length > 0 || imageParts.length > 0 || toolCalls.length > 0) {
        const content = textParts.join('').trim();

        const ollamaMessage: OllamaMessage = {
          role,
          content,
        };

        if (imageParts.length > 0) {
          ollamaMessage.images = imageParts;
        }

        if (thinkingContent.trim() && role === 'assistant') {
          ollamaMessage.thinking = thinkingContent;
        }

        if (toolCalls.length > 0 && role === 'assistant') {
          ollamaMessage.tool_calls = toolCalls;
        }

        out.push(ollamaMessage);
      }
    }

    return out;
  }

  prepareRequestBody(
    rb: OllamaRequestBody,
    um: HFModelItem | undefined,
    options?: ProvideLanguageModelChatResponseOptions,
  ): OllamaRequestBody {
    if (
      um?.temperature !== undefined ||
      um?.top_p !== undefined ||
      um?.top_k !== undefined ||
      um?.max_tokens !== undefined
    ) {
      rb.options = {};
      if (um.temperature !== undefined && um.temperature !== null) {
        rb.options.temperature = um.temperature;
      }
      if (um.top_p !== undefined && um.top_p !== null) {
        rb.options.top_p = um.top_p;
      }
      if (um.top_k !== undefined) {
        rb.options.top_k = um.top_k;
      }
      if (um.max_tokens !== undefined) {
        rb.options.num_predict = um.max_tokens;
      }
    }

    const toolConfig = convertToolsToOpenAI(options);
    if (toolConfig.tools) {
      rb.tools = toolConfig.tools;
    }

    if (um?.extra && typeof um.extra === 'object') {
      for (const [key, value] of Object.entries(um.extra)) {
        if (value !== undefined) {
          if (key === 'tools' && Array.isArray(value) && rb.tools) {
            rb.tools = [...rb.tools, ...value];
          } else {
            (rb as unknown as Record<string, unknown>)[key] = value;
          }
        }
      }
    }

    return rb;
  }

  async processStreamingResponse(
    responseBody: ReadableStream<Uint8Array>,
    progress: Progress<LanguageModelResponsePart2>,
    token: CancellationToken,
  ): Promise<void> {
    const modelId = this._modelId;
    logger.debug('ollama.stream.start', { modelId });

    const reader = responseBody.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        if (token.isCancellationRequested) {
          break;
        }

        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }

          try {
            const chunk: OllamaStreamChunk = JSON.parse(line);
            logger.debug('ollama.stream.chunk', { modelId, data: chunk });
            await this.processOllamaDelta(chunk, progress);

            if (chunk.done) {
              this.reportEndThinking(progress);

              const promptTokens = chunk.prompt_eval_count ?? 0;
              const completionTokens = chunk.eval_count ?? 0;
              this._usage = {
                prompt_tokens: promptTokens,
                completion_tokens: completionTokens,
                total_tokens: promptTokens + completionTokens,
              };
              logger.debug('usage.capture', { modelId: this._modelId, usage: this._usage });
            }
          } catch (e) {
            console.error('[Ollama Provider] Failed to parse streaming chunk:', e, 'data:', line);
            logger.error('ollama.stream.chunk.error', {
              modelId,
              error: e instanceof Error ? e.message : String(e),
              data: line,
            });
          }
        }
      }
      logger.debug('ollama.stream.done', { modelId });
    } catch (e) {
      console.error('[Ollama Provider] Streaming response error:', e);
      logger.error('ollama.stream.error', { modelId, error: e instanceof Error ? e.message : String(e) });
      throw e;
    } finally {
      reader.releaseLock();

      this.reportEndThinking(progress);

      this.reportUsage(progress);
    }
  }

  private async processOllamaDelta(
    chunk: OllamaStreamChunk,
    progress: Progress<LanguageModelResponsePart2>,
  ): Promise<void> {
    const message = chunk.message;
    if (!message) {
      return;
    }

    if (message.thinking) {
      this.bufferThinkingContent(message.thinking, progress);
    }

    if (message.tool_calls && message.tool_calls.length > 0) {
      this.reportEndThinking(progress);

      for (const tc of message.tool_calls) {
        const id = `ollama_tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        progress.report(new vscode.LanguageModelToolCallPart(id, tc.function.name, tc.function.arguments));
      }
    }

    if (message.content) {
      this.reportEndThinking(progress);

      progress.report(new vscode.LanguageModelTextPart(message.content));
    }
  }

  async *createMessage(
    model: HFModelItem,
    systemPrompt: string,
    messages: { role: string; content: string }[],
    baseUrl: string,
    apiKey: string,
  ): AsyncGenerator<{ type: 'text'; text: string }> {
    const ollamaMessages: OllamaMessage[] = [];

    if (systemPrompt) {
      ollamaMessages.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of messages) {
      const role = msg.role === 'user' || msg.role === 'assistant' ? msg.role : 'user';
      ollamaMessages.push({ role, content: msg.content });
    }

    let requestBody: OllamaRequestBody = {
      model: model.id,
      messages: ollamaMessages,
      stream: true,
    };

    requestBody = this.prepareRequestBody(requestBody, model, undefined);

    const headers = CommonApi.prepareHeaders(apiKey, model.apiMode ?? 'ollama', model.headers);

    const url = `${baseUrl.replace(/\/+$/, '')}/api/chat`;

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API request failed: [${response.status}] ${response.statusText}\n${errorText}`);
    }

    if (!response.body) {
      throw new Error('No response body from Ollama API');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const chunk: OllamaStreamChunk = JSON.parse(line);
            if (chunk.message?.content) {
              yield { type: 'text', text: chunk.message.content };
            }

            if (chunk.done) {
              break;
            }
          } catch (e) {
            console.error('[Ollama Provider] Failed to parse streaming chunk:', e, 'data:', line);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

export async function fetchOllamaModels(
  baseUrl: string,
  _apiKey: string,
  customHeaders?: Record<string, string>,
): Promise<HFModelItem[]> {
  const trimmed = baseUrl.replace(/\/+$/, '');
  const url = `${trimmed}/api/tags`;

  const baseHeaders: Record<string, string> = { Accept: 'application/json' };
  const headers = customHeaders ? { ...baseHeaders, ...customHeaders } : baseHeaders;
  const resp = await fetch(url, {
    method: 'GET',
    headers,
  });

  if (!resp.ok) {
    let errorText = '';
    try {
      errorText = await resp.text();
    } catch (error) {
      console.error('[Copilot Harness BYOK] Failed to read response text', error);
    }
    throw new Error(
      `Ollama API error: [${resp.status}] ${resp.statusText}${errorText ? `\n${errorText}` : ''}\nURL: ${url}`,
    );
  }

  const parsed = (await resp.json()) as import('./ollama-types').OllamaTagsResponse;
  const entries = parsed.models ?? [];

  const models: HFModelItem[] = [];
  for (const entry of entries) {
    models.push({
      id: entry.model,
      displayName: entry.name,
      owned_by: 'ollama',
      apiMode: 'ollama',
    } as HFModelItem);
  }

  return models;
}
