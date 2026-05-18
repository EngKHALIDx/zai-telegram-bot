/**
 * Z.ai Multi-Provider API Client v19.0
 * Supports three providers:
 * 1. ZhipuAI Public API — JWT token generation from API key
 * 2. OpenCode Zen API — API key with Bearer auth
 * 3. Z.ai Internal Gateway — custom headers
 * Auto-detects provider based on model selection
 */

import { createHmac } from 'crypto';
import { getModel, getProviderBaseURL, requiresOpenCodeKey, type Provider } from './models.js';

const ZAI_API_KEY = process.env.ZAI_API_KEY || '';
const ZAI_BASE_URL = process.env.ZAI_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4';
const ZAI_CHAT_ID = process.env.ZAI_CHAT_ID || '';
const ZAI_USER_ID = process.env.ZAI_USER_ID || '';
const ZAI_TOKEN = process.env.ZAI_TOKEN || '';

const OPENCODE_API_KEY = process.env.OPENCODE_API_KEY || '';
const OPENCODE_BASE_URL = process.env.OPENCODE_BASE_URL || 'https://opencode.ai/api/v1';

// Check if we're using the Z.ai internal gateway
const isZAIGateway = ZAI_BASE_URL.includes('172.') || ZAI_BASE_URL.includes('z.ai') || ZAI_API_KEY === 'Z.ai';

// ─── JWT Token Generation for ZhipuAI ─────────────────────

let cachedZhipuToken: { token: string; expiresAt: number } | null = null;

function generateZhipuAIJWT(): string {
  // Check cache (refresh 5 min before expiry)
  if (cachedZhipuToken && Date.now() < cachedZhipuToken.expiresAt - 300000) {
    return cachedZhipuToken.token;
  }

  const parts = ZAI_API_KEY.split('.');
  if (parts.length !== 2) return ZAI_API_KEY; // Not a ZhipuAI key format

  const [id, secret] = parts;
  const now = Date.now();

  const header = Buffer.from(JSON.stringify({ alg: 'HS256', sign_type: 'SIGN' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ api_key: id, exp: now + 3600000, timestamp: now })).toString('base64url');
  const signature = createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  const token = header + '.' + payload + '.' + signature;

  cachedZhipuToken = { token, expiresAt: now + 3600000 };
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
}

// ─── Provider Detection ───────────────────────────────────

function getProviderForModel(modelId: string): Provider {
  const model = getModel(modelId);
  if (model) return model.provider;
  // Default: if model contains known OpenCode names, use opencode
  const opencodeModels = ['big-pickle', 'deepseek', 'minimax', 'nemotron'];
  if (opencodeModels.some(m => modelId.includes(m))) return 'opencode';
  return 'zhipuai';
}

function getBaseURLForModel(modelId: string): string {
  const provider = getProviderForModel(modelId);
  switch (provider) {
    case 'opencode':
      return OPENCODE_BASE_URL;
    case 'zhipuai':
    case 'zhipuai-coding':
    default:
      return ZAI_BASE_URL;
  }
}

// ─── Build Headers per Provider ───────────────────────────

function buildHeaders(modelId: string): Record<string, string> {
  const provider = getProviderForModel(modelId);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  switch (provider) {
    case 'opencode':
      // OpenCode API — simple Bearer auth
      headers['Authorization'] = `Bearer ${OPENCODE_API_KEY}`;
      break;

    case 'zhipuai-coding':
      // ZhipuAI Coding API — JWT auth
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
        // ZhipuAI public API — JWT auth
        headers['Authorization'] = `Bearer ${generateZhipuAIJWT()}`;
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
  const baseURL = getBaseURLForModel(modelId);
  const url = `${baseURL}/chat/completions`;
  const headers = buildHeaders(modelId);

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

  // Add tools only if model supports them
  const modelDef = getModel(modelId);
  if (options.tools && options.tools.length > 0 && modelDef?.supportsTools !== false) {
    body.tools = options.tools;
  }

  if (options.thinking && modelDef?.supportsThinking) {
    body.thinking = { type: 'enabled' };
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`API ${response.status} (${modelId}): ${errText.substring(0, 500)}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    if (!choice) throw new Error('No choices in API response');

    return {
      content: choice.message?.content || null,
      toolCalls: choice.message?.tool_calls || [],
      finishReason: choice.finish_reason || 'stop',
      usage: data.usage,
    };
  } catch (e: any) {
    console.error(`[API] Chat error (${modelId}):`, e.message?.substring(0, 300));
    throw e;
  }
}

export async function visionChat(
  messages: any[],
  options: { model?: string } = {}
): Promise<string> {
  const modelId = options.model || 'glm-4v-flash';
  const baseURL = getBaseURLForModel(modelId);
  const url = `${baseURL}/chat/completions`;
  const headers = buildHeaders(modelId);

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
      throw new Error(`Vision API ${response.status}: ${errText.substring(0, 300)}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (e: any) {
    console.error('[API] Vision error:', e.message?.substring(0, 200));
    return `Vision error: ${e.message?.substring(0, 200)}`;
  }
}

export async function generateImage(prompt: string): Promise<string | null> {
  // Use ZhipuAI for image generation (OpenCode doesn't support it)
  const url = `${ZAI_BASE_URL}/images/generations`;
  const headers = buildHeaders('glm-4-flash');

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
  // Use ZhipuAI for web search (OpenCode doesn't support it)
  const url = `${ZAI_BASE_URL}/functions/invoke`;
  const headers = buildHeaders('glm-4-flash');

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

export async function testConnection(): Promise<{ ok: boolean; model: string; error?: string }> {
  try {
    const response = await chatCompletion(
      [{ role: 'user', content: 'Say "OK"' }],
      { model: 'glm-4-flash', maxTokens: 5 }
    );
    return { ok: true, model: 'glm-4-flash' };
  } catch (e: any) {
    return { ok: false, model: '', error: e.message?.substring(0, 300) };
  }
}

export async function testOpenCodeConnection(): Promise<{ ok: boolean; model: string; error?: string }> {
  if (!OPENCODE_API_KEY) {
    return { ok: false, model: '', error: 'OPENCODE_API_KEY not configured' };
  }
  try {
    const response = await chatCompletion(
      [{ role: 'user', content: 'Say "OK"' }],
      { model: 'big-pickle', maxTokens: 5 }
    );
    return { ok: true, model: 'big-pickle' };
  } catch (e: any) {
    return { ok: false, model: 'big-pickle', error: e.message?.substring(0, 300) };
  }
}

// Log provider info on load
console.log(`[API] ZhipuAI Gateway: ${isZAIGateway ? 'Internal' : 'Public'} | URL: ${ZAI_BASE_URL}`);
console.log(`[API] OpenCode URL: ${OPENCODE_BASE_URL} | Key: ${OPENCODE_API_KEY ? '✅' : '❌'}`);
