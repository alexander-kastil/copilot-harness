export interface HFProvider {
  provider: string;
  status: string;
  supports_tools?: boolean;
  supports_structured_output?: boolean;
  context_length?: number;
}

export interface HFArchitecture {
  input_modalities?: string[];
  output_modalities?: string[];
}

export interface HFModelItem {
  id: string;
  object?: string;
  created?: number;
  owned_by: string;
  configId?: string;
  displayName?: string;
  baseUrl?: string;
  providers?: HFProvider[];
  architecture?: HFArchitecture;
  context_length?: number;
  vision?: boolean;
  max_tokens?: number;

  max_completion_tokens?: number;
  reasoning_effort?: string;
  enable_thinking?: boolean;
  thinking_budget?: number;

  thinking?: ThinkingConfig;

  temperature?: number | null;

  top_p?: number | null;
  top_k?: number;
  min_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  repetition_penalty?: number;
  reasoning?: ReasoningConfig;

  family?: string;

  extra?: Record<string, unknown>;

  headers?: Record<string, string>;

  include_reasoning_in_request?: boolean;

  apiMode?: HFApiMode;

  useForCommitGeneration?: boolean;

  delay?: number;

  cache_control?: boolean;
}

export interface ReasoningConfig {
  effort?: string;
  exclude?: boolean;
  max_tokens?: number;
  enabled?: boolean;
}

export interface HFExtraModelInfo {
  id: string;
  pipeline_tag?: string;
}

export interface HFModelsResponse {
  object: string;
  data: HFModelItem[];
}

export interface ThinkingConfig {
  type?: string;
}

export interface RetryConfig {
  enabled?: boolean;
  max_attempts?: number;
  interval_ms?: number;
  status_codes?: number[];
}

export type HFApiMode = 'openai' | 'openai-responses' | 'ollama' | 'anthropic' | 'gemini';

export namespace CustomDataPartMimeTypes {
  export const CacheControl = 'cache_control';
  export const StatefulMarker = 'stateful_marker';
  export const ThinkingData = 'thinking';
  export const ContextManagement = 'context_management';
  export const PhaseData = 'phase_data';
  export const Usage = 'usage';
}

export interface TokenUsageDetails {
  cached_tokens: number;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: TokenUsageDetails;
}
