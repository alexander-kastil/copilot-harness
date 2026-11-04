import * as vscode from 'vscode';
import {
  CancellationToken,
  LanguageModelChatRequestMessage,
  ProvideLanguageModelChatResponseOptions,
  LanguageModelResponsePart2,
  Progress,
} from 'vscode';

import type { HFModelItem } from '../../shared/byok-types';

import type {
  AnthropicMessage,
  AnthropicRequestBody,
  AnthropicContentBlock,
  AnthropicCacheControl,
  AnthropicTextBlock,
  AnthropicToolUseBlock,
  AnthropicToolResultBlock,
  AnthropicStreamChunk,
} from './anthropic-types';

import { isImageMimeType, isToolResultPart, collectToolResultText, convertToolsToOpenAI, mapRole } from '../utils';

import { CommonApi } from '../common-api';
import { logger } from '../logger';

export class AnthropicApi extends CommonApi<AnthropicMessage, AnthropicRequestBody> {
  private readonly _cacheControlEnabled: boolean;

  constructor(modelId: string, cacheControlEnabled = true) {
    super(modelId);
    this._cacheControlEnabled = cacheControlEnabled;
  }

  private decodeCacheControlPart(part: vscode.LanguageModelDataPart): AnthropicCacheControl {
    const fallback: AnthropicCacheControl = { type: 'ephemeral' };
    try {
      const text = new TextDecoder().decode(part.data);
      if (!text) {
        return fallback;
      }
      const parsed = JSON.parse(text) as { type?: string; ttl?: string };
      if (parsed && typeof parsed === 'object' && parsed.type === 'ephemeral') {
        const cc: AnthropicCacheControl = { type: 'ephemeral' };
        if (parsed.ttl === '1h' || parsed.ttl === '5m') {
          cc.ttl = parsed.ttl;
        }
        return cc;
      }
    } catch {}
    return fallback;
  }

  convertMessages(
    messages: readonly LanguageModelChatRequestMessage[],
    modelConfig: { includeReasoningInRequest: boolean },
  ): AnthropicMessage[] {
    const out: AnthropicMessage[] = [];

    for (const m of messages) {
      const role = mapRole(m);
      const textParts: string[] = [];
      const imageParts: vscode.LanguageModelDataPart[] = [];
      const toolCalls: AnthropicToolUseBlock[] = [];
      const toolResults: AnthropicToolResultBlock[] = [];
      const thinkingParts: string[] = [];

      const pendingCacheControls: { afterPartIndex: number; cc: AnthropicCacheControl }[] = [];
      let collectedParts = 0;

      for (const part of m.content ?? []) {
        if (part instanceof vscode.LanguageModelTextPart) {
          textParts.push(part.value);
          collectedParts++;
        } else if (part instanceof vscode.LanguageModelDataPart && part.mimeType === 'cache_control') {
          if (this._cacheControlEnabled) {
            pendingCacheControls.push({
              afterPartIndex: collectedParts,
              cc: this.decodeCacheControlPart(part),
            });
          }
        } else if (part instanceof vscode.LanguageModelDataPart && isImageMimeType(part.mimeType)) {
          imageParts.push(part);
          collectedParts++;
        } else if (part instanceof vscode.LanguageModelToolCallPart) {
          const id = part.callId || `toolu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          toolCalls.push({
            type: 'tool_use',
            id,
            name: part.name,
            input: (part.input as Record<string, unknown>) ?? {},
          });
          collectedParts++;
        } else if (isToolResultPart(part)) {
          const callId = (part as { callId?: string }).callId ?? '';
          const content = collectToolResultText(part as { content?: ReadonlyArray<unknown> });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: callId,
            content,
          });
          collectedParts++;
        } else if (part instanceof vscode.LanguageModelThinkingPart) {
          const content = Array.isArray(part.value) ? part.value.join('') : part.value;
          thinkingParts.push(content);
          collectedParts++;
        }
      }

      const joinedText = textParts.join('').trim();
      const joinedThinking = thinkingParts.join('').trim();

      if (role === 'system') {
        if (joinedText) {
          this._systemContent = joinedText;
        }
        continue;
      }

      const contentBlocks: AnthropicContentBlock[] = [];

      if (joinedText) {
        contentBlocks.push({
          type: 'text',
          text: joinedText,
        });
      }

      for (const imagePart of imageParts) {
        const base64Data = Buffer.from(imagePart.data).toString('base64');
        contentBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: imagePart.mimeType,
            data: base64Data,
          },
        });
      }

      if (role === 'assistant' && modelConfig.includeReasoningInRequest) {
        contentBlocks.push({
          type: 'thinking',
          thinking: joinedThinking || 'Next step.',
        });
      }

      for (const toolCall of toolCalls) {
        contentBlocks.push(toolCall);
      }

      if (role === 'user' && toolResults.length > 0) {
        for (const toolResult of toolResults) {
          contentBlocks.push(toolResult);
        }
      } else if (toolResults.length > 0) {
        console.warn('[Anthropic Provider] Tool results found in non-user message, ignoring');
        logger.warn('anthropic.tool-results.non-user', {
          messageRole: role,
          toolResultCount: toolResults.length,
        });
      }

      for (const { afterPartIndex, cc } of pendingCacheControls) {
        if (contentBlocks.length === 0) {
          continue;
        }
        const target = Math.min(Math.max(afterPartIndex - 1, 0), contentBlocks.length - 1);
        contentBlocks[target].cache_control = cc;
      }

      if (contentBlocks.length > 0) {
        out.push({
          role,
          content: contentBlocks,
        });
      }
    }

    return out;
  }

  prepareRequestBody(
    rb: AnthropicRequestBody,
    um: HFModelItem | undefined,
    options?: ProvideLanguageModelChatResponseOptions,
  ): AnthropicRequestBody {
    if (um?.max_tokens !== undefined) {
      rb.max_tokens = um.max_tokens;
    }

    if (this._systemContent) {
      if (this._cacheControlEnabled) {
        const systemBlock: AnthropicTextBlock = {
          type: 'text',
          text: this._systemContent,
          cache_control: { type: 'ephemeral' },
        };
        rb.system = [systemBlock];
      } else {
        rb.system = this._systemContent;
      }
    }

    if (um?.temperature !== undefined && um.temperature !== null) {
      rb.temperature = um.temperature;
    }

    if (um?.top_p !== undefined && um.top_p !== null) {
      rb.top_p = um.top_p;
    }

    if (um?.top_k !== undefined) {
      rb.top_k = um.top_k;
    }

    const toolConfig = convertToolsToOpenAI(options);
    if (toolConfig.tools) {
      rb.tools = toolConfig.tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters,
      }));

      if (this._cacheControlEnabled && rb.tools.length > 0) {
        rb.tools[rb.tools.length - 1].cache_control = { type: 'ephemeral' };
      }
    }

    if (toolConfig.tool_choice) {
      if (toolConfig.tool_choice === 'auto') {
        rb.tool_choice = { type: 'auto' };
      } else if (typeof toolConfig.tool_choice === 'object' && toolConfig.tool_choice.type === 'function') {
        rb.tool_choice = { type: 'tool', name: toolConfig.tool_choice.function.name };
      }
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

    if (this._cacheControlEnabled) {
      this.enforceCacheControlBudget(rb);
    }

    return rb;
  }

  private enforceCacheControlBudget(rb: AnthropicRequestBody): void {
    const MAX = 4;

    let total = 0;
    const systemBlocksWithCC: AnthropicTextBlock[] = [];
    const toolsWithCC: { name: string }[] = [];
    const msgBlocksWithCC: { cache_control?: AnthropicCacheControl }[] = [];

    if (Array.isArray(rb.system)) {
      for (const block of rb.system) {
        if (block.cache_control) {
          systemBlocksWithCC.push(block);
          total++;
        }
      }
    }
    if (rb.tools) {
      for (const tool of rb.tools) {
        if (tool.cache_control) {
          toolsWithCC.push(tool);
          total++;
        }
      }
    }
    for (const msg of rb.messages) {
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          const b = block as { cache_control?: AnthropicCacheControl };
          if (b.cache_control) {
            msgBlocksWithCC.push(b);
            total++;
          }
        }
      }
    }

    if (total <= MAX) {
      return;
    }

    let toRemove = total - MAX;
    const removalLog: string[] = [];

    for (const block of msgBlocksWithCC) {
      if (toRemove === 0) {
        break;
      }
      delete block.cache_control;
      toRemove--;
      removalLog.push('message');
    }

    for (const tool of toolsWithCC) {
      if (toRemove === 0) {
        break;
      }
      delete (tool as { cache_control?: unknown }).cache_control;
      toRemove--;
      removalLog.push('tool');
    }

    for (const block of systemBlocksWithCC) {
      if (toRemove === 0) {
        break;
      }
      delete block.cache_control;
      toRemove--;
      removalLog.push('system');
    }

    logger.debug('anthropic.cache_control.trim', {
      modelId: this._modelId,
      originalCount: total,
      finalCount: MAX,
      dropped: removalLog,
    });
  }

  async processStreamingResponse(
    responseBody: ReadableStream<Uint8Array>,
    progress: Progress<LanguageModelResponsePart2>,
    token: CancellationToken,
  ): Promise<void> {
    const modelId = this._modelId;
    logger.debug('anthropic.stream.start', { modelId });

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
          if (line.trim() === '') {
            continue;
          }
          if (!line.startsWith('data:')) {
            continue;
          }

          const data = line.slice(5).trim();
          logger.debug('anthropic.stream.chunk', { modelId, data });
          if (data === '[DONE]') {
            await this.flushToolCallBuffers(progress, false);
            continue;
          }

          try {
            const chunk: AnthropicStreamChunk = JSON.parse(data);
            await this.processAnthropicChunk(chunk, progress);
          } catch (e) {
            console.error('[Anthropic Provider] Failed to parse SSE chunk:', e, 'data:', data);
            logger.error('anthropic.stream.chunk.error', {
              modelId,
              error: e instanceof Error ? e.message : String(e),
              data,
            });
          }
        }
      }
      logger.debug('anthropic.stream.done', { modelId });
    } catch (e) {
      console.error('[Anthropic Provider] Streaming response error:', e);
      logger.error('anthropic.stream.error', { modelId, error: e instanceof Error ? e.message : String(e) });
      throw e;
    } finally {
      reader.releaseLock();

      this.reportEndThinking(progress);

      this.reportUsage(progress);
    }
  }

  private async processAnthropicChunk(
    chunk: AnthropicStreamChunk,
    progress: Progress<LanguageModelResponsePart2>,
  ): Promise<void> {
    if (chunk.type === 'ping') {
      return;
    }

    if (chunk.type === 'error') {
      const errorType = chunk.error?.type || 'unknown_error';
      const errorMessage = chunk.error?.message || 'Anthropic API streaming error';
      console.error(`[Anthropic Provider] Streaming error: ${errorType} - ${errorMessage}`);

      return;
    }

    if (chunk.type === 'message_start' && chunk.message) {
      return;
    }

    if (chunk.type === 'message_delta') {
      if (chunk.usage) {
        const inputTokens = chunk.usage.input_tokens ?? 0;
        const cacheCreateTokens = chunk.usage.cache_creation_input_tokens ?? 0;
        const cacheReadTokens = chunk.usage.cache_read_input_tokens ?? 0;
        const promptTokens = inputTokens + cacheCreateTokens + cacheReadTokens;
        this._usage = {
          prompt_tokens: promptTokens,
          completion_tokens: chunk.usage.output_tokens ?? 0,
          total_tokens: promptTokens + (chunk.usage.output_tokens ?? 0),
          prompt_tokens_details: {
            cached_tokens: cacheReadTokens,
          },
        };
        logger.debug('usage.capture', { modelId: this._modelId, usage: this._usage });
      }
      return;
    }

    if (chunk.type === 'content_block_start' && chunk.content_block) {
      if (chunk.content_block.type === 'thinking') {
        if (chunk.content_block.thinking) {
          this.bufferThinkingContent(chunk.content_block.thinking, progress);
        }
      } else if (chunk.content_block.type === 'tool_use') {
        if (!this._emittedBeginToolCallsHint && this._hasEmittedAssistantText) {
          progress.report(new vscode.LanguageModelTextPart(' '));
          this._emittedBeginToolCallsHint = true;
        }
        const idx = (chunk.index as number) ?? 0;
        this._toolCallBuffers.set(idx, {
          id: chunk.content_block.id,
          name: chunk.content_block.name,
          args: '',
        });
      } else if (chunk.content_block.type === 'text') {
      }
    } else if (chunk.type === 'content_block_delta' && chunk.delta) {
      if (chunk.delta.type === 'text_delta' && chunk.delta.text) {
        progress.report(new vscode.LanguageModelTextPart(chunk.delta.text));
        this._hasEmittedAssistantText = true;
      } else if (chunk.delta.type === 'thinking_delta' && chunk.delta.thinking) {
        this.bufferThinkingContent(chunk.delta.thinking, progress);
      } else if (chunk.delta.type === 'input_json_delta' && chunk.delta.partial_json) {
        const idx = (chunk.index as number) ?? 0;
        const buf = this._toolCallBuffers.get(idx);
        if (buf) {
          buf.args += chunk.delta.partial_json;
          this._toolCallBuffers.set(idx, buf);

          await this.tryEmitBufferedToolCall(idx, progress);
        }
      } else if (chunk.delta.type === 'signature_delta' && chunk.delta.signature) {
      }
    } else if (chunk.type === 'content_block_stop' || chunk.type === 'message_stop') {
      await this.flushToolCallBuffers(progress, false);
      this.reportEndThinking(progress);
    }
  }

  async *createMessage(
    model: HFModelItem,
    systemPrompt: string,
    messages: { role: string; content: string }[],
    baseUrl: string,
    apiKey: string,
  ): AsyncGenerator<{ type: 'text'; text: string }> {
    const anthropicMessages: AnthropicMessage[] = messages.map((m) => ({
      role: m.role === 'user' || m.role === 'assistant' ? m.role : 'user',
      content: m.content,
    }));
    this._systemContent = systemPrompt;

    let requestBody: AnthropicRequestBody = {
      model: model.id,
      messages: anthropicMessages,
      stream: true,
    };
    requestBody = this.prepareRequestBody(requestBody, model, undefined);

    const headers = CommonApi.prepareHeaders(apiKey, model.apiMode ?? 'openai', model.headers);

    const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');

    const url = normalizedBaseUrl.endsWith('/v1')
      ? `${normalizedBaseUrl}/messages`
      : `${normalizedBaseUrl}/v1/messages`;

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API request failed: [${response.status}] ${response.statusText}\n${errorText}`);
    }

    if (!response.body) {
      throw new Error('No response body from Anthropic API');
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
          if (line.trim() === '') continue;
          if (!line.startsWith('data:')) continue;

          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;

          try {
            const chunk: AnthropicStreamChunk = JSON.parse(data);

            if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta' && chunk.delta?.text) {
              yield { type: 'text', text: chunk.delta.text };
            }

            if (chunk.type === 'message_stop') break;

            if (chunk.type === 'error') {
              const errorType = chunk.error?.type || 'unknown_error';
              const errorMessage = chunk.error?.message || 'Anthropic API streaming error';
              console.error(`[Anthropic Provider] Streaming error: ${errorType} - ${errorMessage}`);
            }
          } catch (e) {
            console.error('[Anthropic Provider] Failed to parse SSE chunk:', e, 'data:', data);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
