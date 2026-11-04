import * as vscode from 'vscode';
import {
  ProvideLanguageModelChatResponseOptions,
  LanguageModelChatRequestMessage,
  LanguageModelToolCallPart,
  LanguageModelResponsePart2,
  LanguageModelThinkingPart,
  Progress,
  CancellationToken,
} from 'vscode';
import { HFModelItem, CustomDataPartMimeTypes, TokenUsage } from '../shared/byok-types';
import { tryParseJSONObject } from './utils';
import { logger } from './logger';
import { VersionManager } from './version-manager';

export abstract class CommonApi<TMessage, TRequestBody> {
  protected _toolCallBuffers: Map<number, { id?: string; name?: string; args: string }> = new Map<
    number,
    { id?: string; name?: string; args: string }
  >();

  protected _completedToolCallIndices = new Set<number>();

  protected _hasEmittedAssistantText = false;

  protected _hasEmittedText = false;

  protected _hasEmittedThinking = false;

  protected _emittedBeginToolCallsHint = false;

  protected _xmlThinkActive = false;
  protected _xmlThinkDetectionAttempted = false;

  protected _currentThinkingId: string | null = null;

  protected _thinkingBuffer = '';

  protected _thinkingFlushTimer: NodeJS.Timeout | null = null;

  protected _systemContent: string | undefined;

  protected _modelId = '';

  protected _usage: TokenUsage | null = null;

  constructor(modelId: string) {
    this._modelId = modelId;
  }

  abstract convertMessages(
    messages: readonly LanguageModelChatRequestMessage[],
    modelConfig: { includeReasoningInRequest: boolean },
  ): TMessage[];

  abstract prepareRequestBody(
    rb: TRequestBody,
    um: HFModelItem | undefined,
    options?: ProvideLanguageModelChatResponseOptions,
  ): TRequestBody;

  abstract processStreamingResponse(
    responseBody: ReadableStream<Uint8Array>,
    progress: Progress<LanguageModelResponsePart2>,
    token: CancellationToken,
  ): Promise<void>;

  abstract createMessage(
    model: HFModelItem,
    systemPrompt: string,
    messages: { role: string; content: string }[],
    baseUrl: string,
    apiKey: string,
  ): AsyncGenerator<{ type: 'text'; text: string }>;

  protected async tryEmitBufferedToolCall(
    index: number,
    progress: Progress<LanguageModelResponsePart2>,
  ): Promise<void> {
    const buf = this._toolCallBuffers.get(index);
    if (!buf) {
      return;
    }
    if (!buf.name) {
      return;
    }
    const canParse = tryParseJSONObject(buf.args);
    if (!canParse.ok) {
      return;
    }
    const id = buf.id ?? `call_${Math.random().toString(36).slice(2, 10)}`;
    let parameters = canParse.value;
    parameters = this.adjustReadFileParameters(buf.name, parameters);
    progress.report(new LanguageModelToolCallPart(id, buf.name, parameters));
    this._toolCallBuffers.delete(index);
    this._completedToolCallIndices.add(index);
  }

  protected async flushToolCallBuffers(
    progress: Progress<LanguageModelResponsePart2>,
    throwOnInvalid: boolean,
  ): Promise<void> {
    if (this._toolCallBuffers.size === 0) {
      return;
    }
    for (const [idx, buf] of Array.from(this._toolCallBuffers.entries())) {
      const argsText = buf.args.trim() || '{}';
      const parsed = tryParseJSONObject(argsText);
      if (!parsed.ok) {
        if (throwOnInvalid) {
          console.error('[Copilot Harness BYOK] Invalid JSON for tool call', {
            idx,
            snippet: (buf.args || '').slice(0, 200),
          });
          throw new Error('Invalid JSON for tool call');
        }

        continue;
      }
      const id = buf.id ?? `call_${Math.random().toString(36).slice(2, 10)}`;
      const name = buf.name ?? 'unknown_tool';
      let parameters = parsed.value;
      parameters = this.adjustReadFileParameters(name, parameters);
      progress.report(new LanguageModelToolCallPart(id, name, parameters));
      this._toolCallBuffers.delete(idx);
      this._completedToolCallIndices.add(idx);
    }
  }

  protected adjustReadFileParameters(toolName: string, parameters: Record<string, unknown>): Record<string, unknown> {
    if (toolName !== 'read_file') {
      return parameters;
    }
    const config = vscode.workspace.getConfiguration();
    const defaultLines = config.get<number>('copilotHarness.byok.readFileLines', 0);
    if (defaultLines <= 0) {
      return parameters;
    }

    const startLine = typeof parameters.startLine === 'number' ? parameters.startLine : 1;
    const endLine = typeof parameters.endLine === 'number' ? parameters.endLine : startLine;
    if (endLine < startLine + defaultLines) {
      return { ...parameters, endLine: startLine + defaultLines };
    }
    return parameters;
  }

  protected reportEndThinking(progress: Progress<LanguageModelResponsePart2>) {
    if (!this._currentThinkingId) {
      return;
    }

    try {
      this.flushThinkingBuffer(progress);

      progress.report(new LanguageModelThinkingPart('', this._currentThinkingId));
    } catch (e) {
      console.error('[Copilot Harness BYOK] Failed to end thinking sequence:', e);
    }
    this._currentThinkingId = null;

    this._thinkingBuffer = '';
    if (this._thinkingFlushTimer) {
      clearTimeout(this._thinkingFlushTimer);
      this._thinkingFlushTimer = null;
    }
  }

  protected generateThinkingId(): string {
    return `thinking_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  protected bufferThinkingContent(text: string, progress: Progress<LanguageModelResponsePart2>): void {
    this._hasEmittedThinking = true;

    if (!this._currentThinkingId) {
      this._currentThinkingId = this.generateThinkingId();
    }

    this._thinkingBuffer += text;

    if (!this._thinkingFlushTimer) {
      this._thinkingFlushTimer = setTimeout(() => {
        this.flushThinkingBuffer(progress);
      }, 100);
    }
  }

  protected flushThinkingBuffer(progress: Progress<LanguageModelResponsePart2>): void {
    if (this._thinkingFlushTimer) {
      clearTimeout(this._thinkingFlushTimer);
      this._thinkingFlushTimer = null;
    }

    if (this._thinkingBuffer && this._currentThinkingId) {
      const text = this._thinkingBuffer;
      this._thinkingBuffer = '';
      progress.report(new LanguageModelThinkingPart(text, this._currentThinkingId));
    }
  }

  public static prepareHeaders(
    apiKey: string,
    apiMode: string,
    customHeaders?: Record<string, string>,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': VersionManager.getUserAgent(),
    };

    if (apiMode === 'anthropic') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else if (apiMode === 'ollama' && apiKey !== 'ollama') {
      headers['Authorization'] = `Bearer ${apiKey}`;
    } else if (apiMode === 'gemini') {
      headers['x-goog-api-key'] = apiKey;
      headers['Accept'] = 'text/event-stream';
    } else {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    if (customHeaders) {
      return { ...headers, ...customHeaders };
    }

    return headers;
  }

  protected processTextContent(input: string, progress: Progress<LanguageModelResponsePart2>): { emittedAny: boolean } {
    let emittedAny = false;

    const textToEmit = input;
    if (textToEmit && textToEmit.length > 0) {
      progress.report(new vscode.LanguageModelTextPart(textToEmit));
      emittedAny = true;
    }

    return { emittedAny };
  }

  protected processXmlThinkBlocks(
    input: string,
    progress: Progress<LanguageModelResponsePart2>,
  ): { emittedAny: boolean } {
    if (this._xmlThinkDetectionAttempted && !this._xmlThinkActive) {
      return { emittedAny: false };
    }

    const THINK_START = '<think>';
    const THINK_END = '</think>';

    let data = input;
    let emittedAny = false;

    while (data.length > 0) {
      if (!this._xmlThinkActive) {
        const startIdx = data.indexOf(THINK_START);
        if (startIdx === -1) {
          this._xmlThinkDetectionAttempted = true;
          data = '';
          break;
        }

        emittedAny = true;
        this._xmlThinkActive = true;

        data = data.slice(startIdx + THINK_START.length);
        continue;
      }

      const endIdx = data.indexOf(THINK_END);
      if (endIdx === -1) {
        this.bufferThinkingContent(data, progress);
        emittedAny = true;
        data = '';
        break;
      }

      const thinkContent = data.slice(0, endIdx);
      this.bufferThinkingContent(thinkContent, progress);

      emittedAny = true;
      this._xmlThinkActive = false;
      data = data.slice(endIdx + THINK_END.length);
    }

    return { emittedAny };
  }

  protected reportUsage(progress: Progress<LanguageModelResponsePart2>): void {
    if (!this._usage) {
      return;
    }
    logger.info('usage.report', { modelId: this._modelId, usage: this._usage });
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(this._usage));
      progress.report(new vscode.LanguageModelDataPart(bytes, CustomDataPartMimeTypes.Usage));
    } catch (e) {
      logger.error('usage.report.error', { modelId: this._modelId, error: e instanceof Error ? e.message : String(e) });
    }
  }
}
