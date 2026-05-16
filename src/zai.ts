/**
 * Z.ai Client v16.0 - Direct API client with proper authentication
 * Works with internal Z.ai gateway and ZhipuAI external API
 * Supports streaming for real-time display
 */
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import os from 'os';

// ─── Config ────────────────────────────────────────────────

interface ZAIConfig {
  baseUrl: string;
  apiKey: string;
  chatId?: string;
  token?: string;
  userId?: string;
}

let config: ZAIConfig | null = null;

function loadConfig(): ZAIConfig {
  if (config) return config;

  // Try config files
  const paths = [
    join(process.cwd(), '.z-ai-config'),
    join(os.homedir(), '.z-ai-config'),
    '/etc/.z-ai-config',
  ];

  for (const p of paths) {
    try {
      const c = JSON.parse(readFileSync(p, 'utf-8'));
      if (c.baseUrl && c.apiKey) { config = c; return config!; }
    } catch {}
  }

  // Fall back to env vars
  const baseUrl = process.env.ZAI_BASE_URL;
  const apiKey = process.env.ZAI_API_KEY;
  if (baseUrl && apiKey) {
    config = {
      baseUrl,
      apiKey,
      chatId: process.env.ZAI_CHAT_ID,
      token: process.env.ZAI_TOKEN,
      userId: process.env.ZAI_USER_ID,
    };
    // Write config for SDK compatibility
    writeFileSync(join(process.cwd(), '.z-ai-config'), JSON.stringify(config, null, 2), 'utf-8');
    return config!;
  }

  throw new Error('No Z.ai config found. Set ZAI_BASE_URL and ZAI_API_KEY env vars.');
}

// ─── API Client ────────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionOptions {
  model?: string;
  thinking?: boolean;
  stream?: boolean;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Direct chat completion call - bypasses SDK for full control
 */
export async function chatCompletion(
  messages: ChatMessage[],
  options: ChatCompletionOptions = {}
): Promise<string> {
  const cfg = loadConfig();
  const url = `${cfg.baseUrl}/chat/completions`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${cfg.apiKey}`,
    'X-Z-AI-From': 'Z',
  };
  if (cfg.chatId) headers['X-Chat-Id'] = cfg.chatId;
  if (cfg.userId) headers['X-User-Id'] = cfg.userId;
  if (cfg.token) headers['X-Token'] = cfg.token;

  const body: any = {
    model: options.model || 'glm-4-flash',
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens || 8192,
    thinking: { type: options.thinking ? 'enabled' : 'disabled' },
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`API ${response.status}: ${errText.substring(0, 300)}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (e: any) {
    console.error('[Z.ai] Chat error:', e.message?.substring(0, 200));
    throw e;
  }
}

/**
 * Streaming chat completion - yields content chunks in real-time
 */
export async function* chatCompletionStream(
  messages: ChatMessage[],
  options: ChatCompletionOptions = {}
): AsyncGenerator<string> {
  const cfg = loadConfig();
  const url = `${cfg.baseUrl}/chat/completions`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${cfg.apiKey}`,
    'X-Z-AI-From': 'Z',
  };
  if (cfg.chatId) headers['X-Chat-Id'] = cfg.chatId;
  if (cfg.userId) headers['X-User-Id'] = cfg.userId;
  if (cfg.token) headers['X-Token'] = cfg.token;

  const body: any = {
    model: options.model || 'glm-4-flash',
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens || 8192,
    stream: true,
    thinking: { type: options.thinking ? 'enabled' : 'disabled' },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`API ${response.status}: ${errText.substring(0, 300)}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;

      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') return;

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {}
    }
  }
}

/**
 * Vision chat - analyze images
 */
export async function visionChat(
  messages: any[],
  options: { model?: string } = {}
): Promise<string> {
  const cfg = loadConfig();
  const url = `${cfg.baseUrl}/chat/completions/vision`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${cfg.apiKey}`,
    'X-Z-AI-From': 'Z',
  };
  if (cfg.chatId) headers['X-Chat-Id'] = cfg.chatId;
  if (cfg.userId) headers['X-User-Id'] = cfg.userId;
  if (cfg.token) headers['X-Token'] = cfg.token;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: options.model || 'glm-4v',
        messages,
        stream: false,
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
    return `❌ خطأ في تحليل الصورة: ${e.message?.substring(0, 200)}`;
  }
}

/**
 * Generate image using Z.ai
 */
export async function generateImage(prompt: string): Promise<string | null> {
  const cfg = loadConfig();
  const url = `${cfg.baseUrl}/images/generations`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${cfg.apiKey}`,
    'X-Z-AI-From': 'Z',
  };
  if (cfg.chatId) headers['X-Chat-Id'] = cfg.chatId;
  if (cfg.userId) headers['X-User-Id'] = cfg.userId;
  if (cfg.token) headers['X-Token'] = cfg.token;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt, size: '1024x1024' }),
    });

    if (!response.ok) return null;
    const data = await response.json();

    // Handle base64 response
    if (data.data?.[0]?.base64) return data.data[0].base64;

    // Handle URL response - download and convert
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

/**
 * Web search using Z.ai functions
 */
export async function webSearch(query: string, num = 5): Promise<Array<{ url: string; name: string; snippet: string }>> {
  const cfg = loadConfig();
  const url = `${cfg.baseUrl}/functions/invoke`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${cfg.apiKey}`,
    'X-Z-AI-From': 'Z',
  };
  if (cfg.chatId) headers['X-Chat-Id'] = cfg.chatId;
  if (cfg.userId) headers['X-User-Id'] = cfg.userId;
  if (cfg.token) headers['X-Token'] = cfg.token;

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

/**
 * Test API connectivity
 */
export async function testConnection(): Promise<{ ok: boolean; model: string; error?: string }> {
  try {
    const cfg = loadConfig();
    const url = `${cfg.baseUrl}/chat/completions`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.apiKey}`,
      'X-Z-AI-From': 'Z',
    };
    if (cfg.chatId) headers['X-Chat-Id'] = cfg.chatId;
    if (cfg.userId) headers['X-User-Id'] = cfg.userId;
    if (cfg.token) headers['X-Token'] = cfg.token;

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'glm-4-flash',
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 5,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return { ok: false, model: '', error: `API ${response.status}: ${errText.substring(0, 200)}` };
    }

    const data = await response.json();
    return { ok: true, model: data.model || 'glm-4-flash' };
  } catch (e: any) {
    return { ok: false, model: '', error: e.message?.substring(0, 200) };
  }
}
