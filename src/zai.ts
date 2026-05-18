/**
 * Z.ai / ZhipuAI / OpenCode API Client v19.0
 * Supports three providers:
 * 1. Z.ai Gateway (internal) - uses apiKey directly with custom headers
 * 2. ZhipuAI Public API - uses JWT token generation from API key
 * 3. OpenCode Zen API - uses OpenAI-compatible format with API key
 * Auto-detects provider based on model selection
 */

import { createHmac } from 'crypto';
import { getModel, getProviderBaseURL, type Provider } from './models.js';

// ─── Configuration ────────────────────────────────────────

const ZAI_API_KEY = process.env.ZAI_API_KEY || '';
const ZAI_BASE_URL = process.env.ZAI_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4';
const ZAI_CHAT_ID = process.env.ZAI_CHAT_ID || '';
const ZAI_USER_ID = process.env.ZAI_USER_ID || '';
const ZAI_TOKEN = process.env.ZAI_TOKEN || '';

const OPENCODE_API_KEY = process.env.OPENCODE_API_KEY || '';
const OPENCODE_BASE_URL = process.env.OPENCODE_BASE_URL || 'https://api.opencode.ai/v1';

const CODING_BASE_URL = process.env.ZAI_CODING_BASE_URL || 'https://open.bigmodel.cn/api/coding/paas/v4';

// Check if we're using the Z.ai internal gateway
const isZAIGateway = ZAI_BASE_URL.includes('172.') || ZAI_BASE_URL.includes('z.ai') || ZAI_API_KEY === 'Z.ai';

// ─── JWT Token Generation for ZhipuAI ─────────────────────

let cachedToken: { token: string; expiresAt: number } | null = null;

function generateZhipuAIJWT(): string {
  // Check cache (refresh 5 min before expiry)
  if (cachedToken && Date.now() < cachedToken.expiresAt - 300000) {
    return cachedToken.token;
  }

  const parts = ZAI_API_KEY.split('.');
  if (parts.length !== 2) return ZAI_API_KEY; // Not a ZhipuAI key format

  const [id, secret] = parts;
  const now = Date.now();

  const header = Buffer.from(JSON.stringify({ alg: 'HS256', sign_type: 'SIGN' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ api_key: id, exp: now + 3600000, timestamp: now })).toString('base64url');
  const signature = createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  const token = header + '.' + payload + '.' + signature;

  cachedToken = { token, expiresAt: now + 3600000 };
  return token;
}

// ─── Types ────────────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required: string[];
    };
  };
}

interface ChatCompletionOptions {
  model?: string;
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  thinking?: boolean;
}

export interface ChatCompletionResponse {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  provider: Provider;
  model: string;
}

// ─── Provider Detection ───────────────────────────────────

function getProviderForModel(modelId: string): Provider {
  const model = getModel(modelId);
  if (model) return model.provider;
  // Default: if model starts with known OpenCode patterns, use OpenCode
  if (modelId.includes('big-pickle') || modelId.includes('deepseek-v4-flash') ||
      modelId.includes('minimax-m2.5') || modelId.includes('nemotron')) {
    return 'opencode';
  }
  return 'zhipuai';
}

function getBaseURLForProvider(provider: Provider): string {
  switch (provider) {
    case 'opencode':
      return OPENCODE_BASE_URL;
    case 'zhipuai-coding':
      return CODING_BASE_URL;
    case 'zhipuai':
    default:
      return ZAI_BASE_URL;
  }
}

// ─── Build Headers ────────────────────────────────────────

function buildHeaders(provider: Provider): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  switch (provider) {
    case 'opencode':
      // OpenCode uses OpenAI-compatible API key format
      headers['Authorization'] = `Bearer ${OPENCODE_API_KEY}`;
      break;

    case 'zhipuai-coding':
      // ZhipuAI Coding Plan uses JWT auth
      headers['Authorization'] = `Bearer ${generateZhipuAIJWT()}`;
      break;

    case 'zhipuai':
    default:
      if (isZAIGateway) {
        // Z.ai internal gateway mode
        headers['Authorization'] = `Bearer ${ZAI_API_KEY}`;
        headers['X-Z-AI-From'] = 'Z';
        if (ZAI_CHAT_ID) headers['X-Chat-Id'] = ZAI_CHAT_ID;
        if (ZAI_USER_ID) headers['X-User-Id'] = ZAI_USER_ID;
        if (ZAI_TOKEN) headers['X-Token'] = ZAI_TOKEN;
      } else {
        // ZhipuAI public API mode - JWT auth
        headers['Authorization'] = `Bearer ${generateZhipuAIJWT()}`;
        headers['X-Z-AI-From'] = 'Z';
      }
      break;
  }

  return headers;
}

// ─── API Calls ────────────────────────────────────────────

export async function chatCompletion(
  messages: ChatMessage[],
  options: ChatCompletionOptions = {}
): Promise<ChatCompletionResponse> {
  const modelId = options.model || 'glm-4-flash';
  const provider = getProviderForModel(modelId);
  const baseURL = getBaseURLForProvider(provider);
  const url = `${baseURL}/chat/completions`;
  const headers = buildHeaders(provider);

  const body: any = {
    model: modelId,
    messages: messages.map(m => ({
      role: m.role,
      content: m.content,
      ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
      ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
      ...(m.name ? { name: m.name } : {}),
    })),
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens || 8192,
  };

  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
  }

  if (options.thinking) {
    // Only GLM models support thinking mode
    if (modelId.startsWith('glm-')) {
      body.thinking = { type: 'enabled' };
    }
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`API ${response.status} (${provider}): ${errText.substring(0, 500)}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    if (!choice) throw new Error('No choices in API response');

    return {
      content: choice.message?.content || null,
      toolCalls: choice.message?.tool_calls || [],
      finishReason: choice.finish_reason || 'stop',
      usage: data.usage,
      provider,
      model: modelId,
    };
  } catch (e: any) {
    console.error(`[API] Chat error (${provider}/${modelId}):`, e.message?.substring(0, 300));

    // Fallback: if OpenCode provider fails, try ZhipuAI as fallback
    if (provider === 'opencode' && ZAI_API_KEY) {
      console.log(`[API] Falling back to ZhipuAI for model ${modelId}...`);
      try {
        const fallbackUrl = `${ZAI_BASE_URL}/chat/completions`;
        const fallbackHeaders = buildHeaders('zhipuai');
        const fallbackBody = { ...body, model: 'glm-4-flash' }; // Fallback to GLM-4 Flash

        const fallbackResponse = await fetch(fallbackUrl, {
          method: 'POST',
          headers: fallbackHeaders,
          body: JSON.stringify(fallbackBody),
        });

        if (fallbackResponse.ok) {
          const fallbackData = await fallbackResponse.json();
          const fallbackChoice = fallbackData.choices?.[0];
          if (fallbackChoice) {
            return {
              content: fallbackChoice.message?.content || null,
              toolCalls: fallbackChoice.message?.tool_calls || [],
              finishReason: fallbackChoice.finish_reason || 'stop',
              usage: fallbackData.usage,
              provider: 'zhipuai',
              model: 'glm-4-flash',
            };
          }
        }
      } catch (fallbackErr: any) {
        console.error('[API] Fallback also failed:', fallbackErr.message?.substring(0, 200));
      }
    }

    throw e;
  }
}

export async function visionChat(
  messages: any[],
  options: { model?: string } = {}
): Promise<string> {
  const modelId = options.model || 'glm-4v-flash';
  const provider = getProviderForModel(modelId);
  const baseURL = getBaseURLForProvider(provider);

  // Vision endpoint varies by provider
  const url = provider === 'opencode'
    ? `${baseURL}/chat/completions`
    : `${baseURL}/chat/completions`;

  const headers = buildHeaders(provider);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: modelId,
        messages,
        stream: false,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Vision API ${response.status} (${provider}): ${errText.substring(0, 300)}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (e: any) {
    console.error(`[API] Vision error (${provider}/${modelId}):`, e.message?.substring(0, 200));
    return `Vision error: ${e.message?.substring(0, 200)}`;
  }
}

export async function generateImage(prompt: string): Promise<string | null> {
  // Image generation always uses ZhipuAI
  const url = `${ZAI_BASE_URL}/images/generations`;
  const headers = buildHeaders('zhipuai');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt, size: '1024x1024' }),
    });

    if (!response.ok) return null;
    const data = await response.json();

    if (data.data?.[0]?.base64) return data.data[0].base64;
    if (data.data?.[0]?.url) {
      const imgRes = await fetch(data.data[0].url);
      const buf = Buffer.from(await imgRes.arrayBuffer());
      return buf.toString('base64');
    }

    return null;
  } catch (e: any) {
    console.error('[API] Image gen error:', e.message?.substring(0, 200));
    return null;
  }
}

export async function webSearch(query: string, num = 5): Promise<Array<{ url: string; name: string; snippet: string }>> {
  // Web search always uses ZhipuAI
  const url = `${ZAI_BASE_URL}/functions/invoke`;
  const headers = buildHeaders('zhipuai');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ function_name: 'web_search', arguments: { query, num } }),
    });

    if (!response.ok) return [];
    const data = await response.json();
    return data.result || data || [];
  } catch {
    return [];
  }
}

export async function testConnection(): Promise<{ ok: boolean; model: string; provider: string; error?: string }> {
  // Test ZhipuAI connection first
  try {
    const response = await chatCompletion(
      [{ role: 'user', content: 'Say "OK"' }],
      { model: 'glm-4-flash', maxTokens: 5 }
    );
    return { ok: true, model: 'glm-4-flash', provider: response.provider };
  } catch (e: any) {
    // If ZhipuAI fails, try OpenCode
    if (OPENCODE_API_KEY) {
      try {
        const response = await chatCompletion(
          [{ role: 'user', content: 'Say "OK"' }],
          { model: 'big-pickle', maxTokens: 5 }
        );
        return { ok: true, model: 'big-pickle', provider: response.provider };
      } catch (ocErr: any) {
        return { ok: false, model: '', provider: '', error: `ZhipuAI: ${e.message?.substring(0, 150)} | OpenCode: ${ocErr.message?.substring(0, 150)}` };
      }
    }
    return { ok: false, model: '', provider: '', error: e.message?.substring(0, 300) };
  }
}

/**
 * Test a specific model's connection
 */
export async function testModelConnection(modelId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await chatCompletion(
      [{ role: 'user', content: 'Say "OK"' }],
      { model: modelId, maxTokens: 5 }
    );
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message?.substring(0, 200) };
  }
}

// ─── Provider Status ──────────────────────────────────────

export function getProviderStatus(): { provider: string; configured: boolean; baseURL: string }[] {
  return [
    {
      provider: 'ZhipuAI',
      configured: !!ZAI_API_KEY,
      baseURL: ZAI_BASE_URL.replace(/\/api\/.*$/, '/api/...'),
    },
    {
      provider: 'OpenCode',
      configured: !!OPENCODE_API_KEY,
      baseURL: OPENCODE_BASE_URL,
    },
    {
      provider: 'ZhipuAI Coding',
      configured: !!ZAI_API_KEY,
      baseURL: CODING_BASE_URL.replace(/\/api\/.*$/, '/api/...'),
    },
  ];
}

// Log gateway mode on load
console.log(`[API] ZhipuAI Gateway: ${isZAIGateway ? 'Internal' : 'Public'} | URL: ${ZAI_BASE_URL}`);
console.log(`[API] OpenCode Gateway: ${OPENCODE_API_KEY ? 'Configured' : 'Not configured'} | URL: ${OPENCODE_BASE_URL}`);
console.log(`[API] Coding Plan URL: ${CODING_BASE_URL}`);
