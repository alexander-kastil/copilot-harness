export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface OpenAIFunctionToolDef {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: object;
  };
}

export interface OpenAIChatMessage {
  role: OpenAIChatRole;
  content?: string | ChatMessageContent[];
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
}

export interface ChatMessageContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
  };
}

export type OpenAIChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ReasoningDetailCommon {
  id: string | null;
  format: string;
  index?: number;
}

export interface ReasoningSummaryDetail extends ReasoningDetailCommon {
  type: 'reasoning.summary';
  summary: string;
}

export interface ReasoningEncryptedDetail extends ReasoningDetailCommon {
  type: 'reasoning.encrypted';
  data: string;
}

export interface ReasoningTextDetail extends ReasoningDetailCommon {
  type: 'reasoning.text';
  text: string;
  signature?: string | null;
}

export type ReasoningDetail = ReasoningSummaryDetail | ReasoningEncryptedDetail | ReasoningTextDetail;
