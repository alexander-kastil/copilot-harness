import * as vscode from 'vscode';
import { LanguageModelChatRequestMessage, LanguageModelChatTool } from 'vscode';
import { tokenizerManager } from './tokenizer/tokenizer-manager';
import { getImageDimensions } from './tokenizer/image-utils';
import { createDataUrl } from './utils';

export const BaseTokensPerMessage = 3;

export const BaseTokensPerName = 1;

export async function countMessageTokens(
  text: string | LanguageModelChatRequestMessage,
  modelConfig: { includeReasoningInRequest: boolean },
): Promise<number> {
  if (typeof text === 'string') {
    return textTokenLength(text);
  } else {
    let totalTokens = BaseTokensPerMessage + BaseTokensPerName;

    for (const part of text.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        totalTokens += await textTokenLength(part.value);
      } else if (part instanceof vscode.LanguageModelDataPart) {
        if (part.mimeType.startsWith('image/')) {
          totalTokens += calculateImageTokenCost(createDataUrl(part));
        } else if (part.mimeType === 'cache_control') {
        } else {
          totalTokens += calculateNonImageBinaryTokens(part.data.byteLength);
        }
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        totalTokens += BaseTokensPerName;
        totalTokens += await textTokenLength(JSON.stringify(part.input));
      } else if (part instanceof vscode.LanguageModelToolResultPart) {
        totalTokens += await textTokenLength(JSON.stringify(part.content));
      } else if (part instanceof vscode.LanguageModelThinkingPart) {
        if (modelConfig.includeReasoningInRequest) {
          const thinkingText = Array.isArray(part.value) ? part.value.join('') : part.value;
          totalTokens += await textTokenLength(thinkingText);
        }
      } else {
        console.warn(`Unknown part type: ${JSON.stringify(part)}`);
      }
    }
    return totalTokens;
  }
}

export async function textTokenLength(text: string): Promise<number> {
  try {
    return tokenizerManager.countTokens(text);
  } catch (e) {
    return 0;
  }
}

export async function countToolTokens(tools: readonly LanguageModelChatTool[]): Promise<number> {
  const baseToolTokens = 16;
  let numTokens = 0;
  if (tools.length) {
    numTokens += baseToolTokens;
  }

  const baseTokensPerTool = 8;
  for (const tool of tools) {
    numTokens += baseTokensPerTool;
    numTokens += await textTokenLength(JSON.stringify(tool));
  }

  return numTokens;
}

function calculateImageTokenCost(imageUrl: string): number {
  let { width, height } = getImageDimensions(imageUrl);

  if (width <= 0 || height <= 0) {
    return 0;
  }

  if (width > 2048 || height > 2048) {
    const scaleFactor = 2048 / Math.max(width, height);
    width = Math.round(width * scaleFactor);
    height = Math.round(height * scaleFactor);
  }

  const scaleFactor = 768 / Math.min(width, height);
  width = Math.round(width * scaleFactor);
  height = Math.round(height * scaleFactor);

  const tiles = Math.ceil(width / 512) * Math.ceil(height / 512);

  return tiles * 170 + 85;
}

function calculateNonImageBinaryTokens(byteLength: number): number {
  if (!byteLength) {
    return 0;
  }
  const base = 20;
  const per16Kb = Math.ceil(byteLength / 16384);
  return Math.min(200, base + per16Kb);
}
