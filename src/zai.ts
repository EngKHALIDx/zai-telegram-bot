/**
 * Z.ai Client - Chat completions with tool-calling support
 * Matches chat.z.ai agent behavior exactly
 */
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import ZAI from 'z-ai-web-dev-sdk';

let zaiInstance: ZAI | null = null;

async function ensureConfig(): Promise<void> {
  const cp = join(process.cwd(), '.z-ai-config');
  if (existsSync(cp)) { try { const c = JSON.parse(readFileSync(cp, 'utf-8')); if (c.baseUrl && c.apiKey) return; } catch {} }
  const baseUrl = process.env.ZAI_BASE_URL, apiKey = process.env.ZAI_API_KEY;
  if (!baseUrl || !apiKey) throw new Error('ZAI_BASE_URL and ZAI_API_KEY required');
  writeFileSync(cp, JSON.stringify({ baseUrl, apiKey, chatId: process.env.ZAI_CHAT_ID || '', token: process.env.ZAI_TOKEN || '', userId: process.env.ZAI_USER_ID || '' }, null, 2), 'utf-8');
}

async function getZAI(): Promise<ZAI> {
  if (!zaiInstance) { await ensureConfig(); zaiInstance = await ZAI.create(); }
  return zaiInstance;
}

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string; }

/**
 * Agent chat with tool calling - returns raw response content
 * The AI decides when to use tools by outputting <tool_call/> tags
 */
export async function agentChat(
  messages: ChatMessage[],
  options?: { model?: string; thinking?: boolean }
): Promise<string> {
  try {
    const zai = await getZAI();
    const model = options?.model || 'glm-5.1';
    const think = options?.thinking ?? true;
    const completion = await zai.chat.completions.create({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 8192,
      thinking: { type: think ? 'enabled' : 'disabled' },
    });
    return completion.choices[0]?.message?.content || '';
  } catch (e: any) {
    console.error('Z.ai error:', e.message);
    return `❌ خطأ: ${e.message?.substring(0, 300)}`;
  }
}

export async function visionChat(
  messages: any[],
  options?: { model?: string }
): Promise<string> {
  try {
    const zai = await getZAI();
    const completion = await zai.chat.completions.createVision({
      model: options?.model || 'glm-4v',
      messages, stream: false,
    });
    return completion.choices[0]?.message?.content || '';
  } catch (e: any) { return `❌ خطأ: ${e.message?.substring(0, 300)}`; }
}

export async function generateImage(prompt: string): Promise<string | null> {
  try {
    const zai = await getZAI();
    const r = await zai.images.generations.create({ prompt, size: '1024x1024' });
    return r.data[0]?.base64 || null;
  } catch { return null; }
}

export async function webSearch(query: string, num = 5): Promise<Array<{ url: string; name: string; snippet: string }>> {
  try {
    const zai = await getZAI();
    return await zai.functions.invoke('web_search', { query, num }) as any;
  } catch { return []; }
}
