import * as vscode from 'vscode';
import {
  CancellationToken,
  LanguageModelChatRequestMessage,
  ProvideLanguageModelChatResponseOptions,
  LanguageModelResponsePart2,
  Progress,
} from 'vscode';

import type { HFModelItem, ReasoningConfig, TokenUsage } from '../../shared/byok-types';
import { getConfiguredReasoningEffort, isReasoningEffortPickerEnabled } from '../model-configuration';

import type {
  OpenAIChatMessage,
  OpenAIToolCall,
  ChatMessageContent,
  ReasoningDetail,
  ReasoningSummaryDetail,
  ReasoningTextDetail,
} from './openai-types';

import {
  isImageMimeType,
  createDataUrl,
  isToolResultPart,
  collectToolResultText,
  convertToolsToOpenAI,
  mapRole,
} from '../utils';

import { CommonApi } from '../common-api';
import { logger } from '../logger';

export class OpenaiApi extends CommonApi<OpenAIChatMessage, Record<string, unknown>> {
  constructor(modelId: string) {
    super(modelId);
  }

  convertMessages(
    messages: readonly LanguageModelChatRequestMessage[],
    modelConfig: { includeReasoningInRequest: boolean },
  ): OpenAIChatMessage[] {
    const out: OpenAIChatMessage[] = [];
    for (const m of messages) {
      const role = mapRole(m);
      const textParts: string[] = [];
      const imageParts: vscode.LanguageModelDataPart[] = [];
      const toolCalls: OpenAIToolCall[] = [];
      const toolResults: { callId: string; content: string }[] = [];
      const reasoningParts: string[] = [];

      for (const part of m.content ?? []) {
        if (part instanceof vscode.LanguageModelTextPart) {
          textParts.push(part.value);
        } else if (part instanceof vscode.LanguageModelDataPart && isImageMimeType(part.mimeType)) {
          imageParts.push(part);
        } else if (part instanceof vscode.LanguageModelToolCallPart) {
          const id = part.callId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          let args = '{}';
          try {
            args = JSON.stringify(part.input ?? {});
          } catch {
            args = '{}';
          }
          toolCalls.push({ id, type: 'function', function: { name: part.name, arguments: args } });
        } else if (isToolResultPart(part)) {
          const callId = (part as { callId?: string }).callId ?? '';
          const content = collectToolResultText(part as { content?: ReadonlyArray<unknown> });
          toolResults.push({ callId, content });
        } else if (part instanceof vscode.LanguageModelThinkingPart) {
          const content = Array.isArray(part.value) ? part.value.join('') : part.value;
          reasoningParts.push(content);
        }
      }

      const joinedText = textParts.join('').trim();
      const joinedThinking = reasoningParts.join('').trim();

      if (role === 'assistant') {
        const assistantMessage: OpenAIChatMessage = {
          role: 'assistant',
        };

        if (joinedText) {
          assistantMessage.content = joinedText;
        }

        if (modelConfig.includeReasoningInRequest) {
          assistantMessage.reasoning_content = joinedThinking || 'Next step.';
        }

        if (toolCalls.length > 0) {
          assistantMessage.tool_calls = toolCalls;
        }

        if (assistantMessage.content || assistantMessage.reasoning_content || assistantMessage.tool_calls) {
          out.push(assistantMessage);
        }
      }

      for (const tr of toolResults) {
        out.push({ role: 'tool', tool_call_id: tr.callId, content: tr.content || '' });
      }

      if (role === 'user') {
        if (imageParts.length > 0) {
          const contentArray: ChatMessageContent[] = [];

          if (joinedText) {
            contentArray.push({
              type: 'text',
              text: joinedText,
            });
          }

          for (const imagePart of imageParts) {
            const dataUrl = createDataUrl(imagePart);
            contentArray.push({
              type: 'image_url',
              image_url: {
                url: dataUrl,
              },
            });
          }
          out.push({ role, content: contentArray });
        } else {
          if (joinedText) {
            out.push({ role, content: joinedText });
          }
        }
      }

      if (role === 'system' && joinedText) {
        out.push({ role, content: joinedText });
      }
    }
    return out;
  }

  prepareRequestBody(
    rb: Record<string, unknown>,
    um: HFModelItem | undefined,
    options?: ProvideLanguageModelChatResponseOptions,
  ): Record<string, unknown> {
    if (um?.temperature !== undefined && um.temperature !== null) {
      rb.temperature = um.temperature;
    }

    if (um?.top_p !== undefined && um.top_p !== null) {
      rb.top_p = um.top_p;
    }

    if (um?.max_completion_tokens !== undefined) {
      rb.max_completion_tokens = um.max_completion_tokens;
    } else if (um?.max_tokens !== undefined) {
      rb.max_tokens = um.max_tokens;
    }

    if (isReasoningEffortPickerEnabled(um)) {
      rb.reasoning_effort = getConfiguredReasoningEffort(options, um.reasoning_effort);
    } else if (um?.reasoning_effort !== undefined) {
      rb.reasoning_effort = um.reasoning_effort;
    }

    const enableThinking = um?.enable_thinking;
    if (enableThinking !== undefined) {
      rb.enable_thinking = enableThinking;

      if (um?.thinking_budget !== undefined) {
        rb.thinking_budget = um.thinking_budget;
      }
    }

    if (um?.thinking?.type !== undefined) {
      rb.thinking = {
        type: um.thinking.type,
      };
    }

    if (um?.reasoning !== undefined) {
      const reasoningConfig: ReasoningConfig = um.reasoning as ReasoningConfig;
      if (reasoningConfig.enabled !== false) {
        const reasoningObj: Record<string, unknown> = {};
        const effort = reasoningConfig.effort;
        const maxTokensReasoning = reasoningConfig.max_tokens || 2000;
        if (effort && effort !== 'auto') {
          reasoningObj.effort = effort;
        } else {
          reasoningObj.max_tokens = maxTokensReasoning;
        }
        if (reasoningConfig.exclude !== undefined) {
          reasoningObj.exclude = reasoningConfig.exclude;
        }
        rb.reasoning = reasoningObj;
      }
    }

    if (options?.modelOptions) {
      const mo = options.modelOptions as Record<string, unknown>;
      if (typeof mo.stop === 'string' || Array.isArray(mo.stop)) {
        rb.stop = mo.stop;
      }
    }

    const toolConfig = convertToolsToOpenAI(options);
    if (toolConfig.tools) {
      rb.tools = toolConfig.tools;
    }
    if (toolConfig.tool_choice) {
      rb.tool_choice = toolConfig.tool_choice;
    }

    if (um?.top_k !== undefined) {
      rb.top_k = um.top_k;
    }
    if (um?.min_p !== undefined) {
      rb.min_p = um.min_p;
    }
    if (um?.frequency_penalty !== undefined) {
      rb.frequency_penalty = um.frequency_penalty;
    }
    if (um?.presence_penalty !== undefined) {
      rb.presence_penalty = um.presence_penalty;
    }
    if (um?.repetition_penalty !== undefined) {
      rb.repetition_penalty = um.repetition_penalty;
    }

    if (um?.extra && typeof um.extra === 'object') {
      for (const [key, value] of Object.entries(um.extra)) {
        if (value !== undefined) {
          if (key === 'tools' && Array.isArray(value) && Array.isArray(rb.tools)) {
            rb.tools = [...rb.tools, ...value];
          } else {
            rb[key] = value;
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
    logger.debug('openai.stream.start', { modelId });

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
          if (!line.startsWith('data:')) {
            continue;
          }
          const data = line.slice(5).trim();
          logger.debug('openai.stream.chunk', { modelId, data });
          if (data === '[DONE]') {
            await this.flushToolCallBuffers(progress, false);
            continue;
          }

          try {
            const parsed = JSON.parse(data);

            if (parsed.usage && typeof parsed.usage === 'object') {
              this._usage = parsed.usage as TokenUsage;
              logger.debug('usage.capture', { modelId: this._modelId, usage: this._usage });
            }
            await this.processDelta(parsed, progress);
          } catch (e) {
            console.error('[OpenAI Provider] Failed to parse SSE chunk:', e, 'data:', data);
            logger.error('openai.stream.chunk.error', {
              modelId,
              error: e instanceof Error ? e.message : String(e),
              data,
            });
          }
        }
      }
      logger.debug('openai.stream.done', { modelId });
    } catch (e) {
      console.error('[OpenAI Provider] Streaming response error:', e);
      logger.error('openai.stream.error', { modelId, error: e instanceof Error ? e.message : String(e) });
      throw e;
    } finally {
      reader.releaseLock();

      this.reportEndThinking(progress);

      this.reportUsage(progress);
    }
  }

  private async processDelta(
    delta: Record<string, unknown>,
    progress: Progress<LanguageModelResponsePart2>,
  ): Promise<boolean> {
    let emitted = false;
    const choice = (delta.choices as Record<string, unknown>[] | undefined)?.[0];
    if (!choice) {
      return false;
    }

    const deltaObj = choice.delta as Record<string, unknown> | undefined;

    try {
      let maybeThinking =
        (choice as Record<string, unknown> | undefined)?.thinking ??
        (deltaObj as Record<string, unknown> | undefined)?.thinking ??
        (deltaObj as Record<string, unknown> | undefined)?.reasoning ??
        (deltaObj as Record<string, unknown> | undefined)?.reasoning_content;

      const maybeReasoningDetails =
        (deltaObj as Record<string, unknown>)?.reasoning_details ??
        (choice as Record<string, unknown>)?.reasoning_details;
      if (maybeReasoningDetails && Array.isArray(maybeReasoningDetails) && maybeReasoningDetails.length > 0) {
        const details: Array<ReasoningDetail> = maybeReasoningDetails as Array<ReasoningDetail>;

        const sortedDetails = details.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

        for (const detail of sortedDetails) {
          let extractedText = '';
          if (detail.type === 'reasoning.summary') {
            extractedText = (detail as ReasoningSummaryDetail).summary;
          } else if (detail.type === 'reasoning.text') {
            extractedText = (detail as ReasoningTextDetail).text;
          } else if (detail.type === 'reasoning.encrypted') {
            extractedText = '[REDACTED]';
          } else {
            extractedText = JSON.stringify(detail);
          }

          if (extractedText) {
            this.bufferThinkingContent(extractedText, progress);
            emitted = true;
          }
        }
        maybeThinking = null;
      }

      if (maybeThinking !== undefined && maybeThinking !== null) {
        let text = '';

        if (maybeThinking && typeof maybeThinking === 'object') {
          const mt = maybeThinking as Record<string, unknown>;
          text = typeof mt['text'] === 'string' ? (mt['text'] as string) : JSON.stringify(mt);
        } else if (typeof maybeThinking === 'string') {
          text = maybeThinking;
        }
        if (text) {
          this.bufferThinkingContent(text, progress);
          emitted = true;
        }
      }
    } catch (e) {
      console.error('[Copilot Harness BYOK] Failed to process thinking/reasoning_details:', e);
    }

    if (deltaObj?.content) {
      const content = String(deltaObj.content);

      const xmlRes = this.processXmlThinkBlocks(content, progress);
      if (xmlRes.emittedAny) {
        emitted = true;
      } else {
        this.reportEndThinking(progress);

        const res = this.processTextContent(content, progress);
        if (res.emittedAny) {
          this._hasEmittedAssistantText = true;
          emitted = true;
        }
      }
    }

    if (deltaObj?.tool_calls) {
      this.reportEndThinking(progress);

      const toolCalls = deltaObj.tool_calls as Array<Record<string, unknown>>;

      if (!this._emittedBeginToolCallsHint && this._hasEmittedAssistantText && toolCalls.length > 0) {
        progress.report(new vscode.LanguageModelTextPart(' '));
        this._emittedBeginToolCallsHint = true;
      }

      for (const tc of toolCalls) {
        const idx = (tc.index as number) ?? 0;

        if (this._completedToolCallIndices.has(idx)) {
          continue;
        }
        const buf = this._toolCallBuffers.get(idx) ?? { args: '' };
        if (tc.id && typeof tc.id === 'string') {
          buf.id = tc.id as string;
        }
        const func = tc.function as Record<string, unknown> | undefined;
        if (func?.name && typeof func.name === 'string') {
          buf.name = func.name as string;
        }
        if (typeof func?.arguments === 'string') {
          buf.args += func.arguments as string;
        }
        this._toolCallBuffers.set(idx, buf);

        await this.tryEmitBufferedToolCall(idx, progress);
      }
    }

    const finish = (choice.finish_reason as string | undefined) ?? undefined;
    if (finish === 'tool_calls' || finish === 'stop') {
      await this.flushToolCallBuffers(progress, true);
    }
    return emitted;
  }

  async *createMessage(
    model: HFModelItem,
    systemPrompt: string,
    messages: { role: string; content: string }[],
    baseUrl: string,
    apiKey: string,
  ): AsyncGenerator<{ type: 'text'; text: string }> {
    const openaiMessages = [...messages];
    if (systemPrompt) {
      openaiMessages.unshift({ role: 'system', content: systemPrompt });
    }

    let requestBody: Record<string, unknown> = {
      model: model.id,
      messages: openaiMessages,
      stream: true,
    };
    requestBody = this.prepareRequestBody(requestBody, model, undefined);

    const headers = CommonApi.prepareHeaders(apiKey, model.apiMode ?? 'openai', model.headers);

    const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API request failed: [${response.status}] ${response.statusText}\n${errorText}`);
    }

    if (!response.body) {
      throw new Error('No response body from OpenAI API');
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
          if (!line.startsWith('data:')) {
            continue;
          }
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);

            const choice = (parsed.choices as Record<string, unknown>[] | undefined)?.[0];
            if (!choice) continue;

            const deltaObj = choice.delta as Record<string, unknown> | undefined;
            if (deltaObj?.content) {
              const content = String(deltaObj.content);
              yield { type: 'text', text: content };
            }

            if (choice.finish_reason) break;
          } catch (e) {
            console.error('[OpenAI Provider] Failed to parse SSE chunk:', e, 'data:', data);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
