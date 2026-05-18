/**
 * Z.ai / ZhipuAI API Client v17.0
 * Supports two modes:
 * 1. Z.ai Gateway (internal) - uses apiKey directly with custom headers
 * 2. ZhipuAI Public API - uses JWT token generation from API key
 * Auto-detects mode based on ZAI_BASE_URL
 */

import { createHmac } from 'crypto';

const API_KEY = process.env.ZAI_API_KEY || '';
const BASE_URL = process.env.ZAI_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4';
const CHAT_ID = process.env.ZAI_CHAT_ID || '';
const USER_ID = process.env.ZAI_USER_ID || '';
const ZAI_TOKEN = process.env.ZAI_TOKEN || '';

// Check if we're using the Z.ai internal gateway
const isZAIGateway = BASE_URL.includes('172.') || BASE_URL.includes('z.ai') || API_KEY === 'Z.ai';

// ─── JWT Token Generation for ZhipuAI ─────────────────────

let cachedToken: { token: string; expiresAt: number } | null = null;

function generateZhipuAIJWT(): string {
  // Check cache (refresh 5 min before expiry)
  if (cachedToken && Date.now() < cachedToken.expiresAt - 300000) {
    return cachedToken.token;
  }

  const parts = API_KEY.split('.');
  if (parts.length !== 2) return API_KEY; // Not a ZhipuAI key format

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
}

// ─── Build Headers ────────────────────────────────────────

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Z-AI-From': 'Z',
  };

  if (isZAIGateway) {
    // Z.ai internal gateway mode
    headers['Authorization'] = `Bearer ${API_KEY}`;
    if (CHAT_ID) headers['X-Chat-Id'] = CHAT_ID;
    if (USER_ID) headers['X-User-Id'] = USER_ID;
    if (ZAI_TOKEN) headers['X-Token'] = ZAI_TOKEN;
  } else {
    // ZhipuAI public API mode - JWT auth
    headers['Authorization'] = `Bearer ${generateZhipuAIJWT()}`;
  }

  return headers;
}

// ─── API Calls ────────────────────────────────────────────

export async function chatCompletion(
  messages: ChatMessage[],
  options: ChatCompletionOptions = {}
): Promise<ChatCompletionResponse> {
  const url = `${BASE_URL}/chat/completions`;
  const headers = buildHeaders();

  const body: any = {
    model: options.model || 'glm-4-flash',
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
      throw new Error(`API ${response.status}: ${errText.substring(0, 500)}`);
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
    console.error('[Z.ai] Chat error:', e.message?.substring(0, 300));
    throw e;
  }
}

export async function visionChat(
  messages: any[],
  options: { model?: string } = {}
): Promise<string> {
  const url = `${BASE_URL}/chat/completions/vision`;
  const headers = buildHeaders();

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: options.model || 'glm-4v-flash',
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
    console.error('[Z.ai] Vision error:', e.message?.substring(0, 200));
    return `Vision error: ${e.message?.substring(0, 200)}`;
  }
}

export async function generateImage(prompt: string): Promise<string | null> {
  const url = `${BASE_URL}/images/generations`;
  const headers = buildHeaders();

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
    console.error('[Z.ai] Image gen error:', e.message?.substring(0, 200));
    return null;
  }
}

export async function webSearch(query: string, num = 5): Promise<Array<{ url: string; name: string; snippet: string }>> {
  const url = `${BASE_URL}/functions/invoke`;
  const headers = buildHeaders();

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

// Log gateway mode on load
console.log(`[Z.ai] Gateway mode: ${isZAIGateway ? 'Z.ai Internal' : 'ZhipuAI Public'}`);
console.log(`[Z.ai] Base URL: ${BASE_URL}`);
