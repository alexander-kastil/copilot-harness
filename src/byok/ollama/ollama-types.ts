import { OpenAIFunctionToolDef } from '../openai/openai-types';

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  images?: string[];
  thinking?: string;
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
}

export interface OllamaRequestBody {
  model: string;
  messages: OllamaMessage[];
  stream?: boolean;
  think?: boolean | string;
  options?: OllamaModelOptions;
  tools?: OpenAIFunctionToolDef[];
}

export interface OllamaModelOptions {
  seed?: number;
  temperature?: number;
  top_k?: number;
  top_p?: number;
  min_p?: number;
  stop?: string | string[];
  num_ctx?: number;
  num_predict?: number;
}

export interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface OllamaStreamChunk {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
    thinking?: string;
    tool_calls?: OllamaToolCall[];
  };
  done: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

export interface OllamaTagModel {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: {
    parent_model: string;
    format: string;
    family: string;
    families: string[];
    parameter_size: string;
    quantization_level: string;
  };
}

export interface OllamaTagsResponse {
  models: OllamaTagModel[];
}
