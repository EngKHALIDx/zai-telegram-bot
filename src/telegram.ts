/**
 * Telegram API Helper - Real-time messaging with edit support
 * Supports: sendMessage, editMessage, deleteMessage, answerCallbackQuery
 */
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

interface InlineKeyboardButton { text: string; callback_data?: string; url?: string; }

async function apiCall(method: string, body: Record<string, unknown>): Promise<any> {
  try {
    const res = await fetch(`${API_BASE}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) console.error(`TG API error [${method}]:`, data.description);
    return data;
  } catch (error) {
    console.error(`TG API failed [${method}]:`, error);
    return null;
  }
}

export async function sendMessage(chatId: number, text: string, options?: {
  parse_mode?: 'Markdown' | 'HTML';
  reply_markup?: { inline_keyboard?: InlineKeyboardButton[][] };
}): Promise<any> {
  return apiCall('sendMessage', {
    chat_id: chatId, text,
    parse_mode: options?.parse_mode || 'HTML',
    reply_markup: options?.reply_markup,
  });
}

export async function editMessageText(chatId: number, messageId: number, text: string, options?: {
  parse_mode?: 'Markdown' | 'HTML';
  reply_markup?: { inline_keyboard?: InlineKeyboardButton[][] };
}): Promise<any> {
  return apiCall('editMessageText', {
    chat_id: chatId, message_id: messageId, text,
    parse_mode: options?.parse_mode || 'HTML',
    reply_markup: options?.reply_markup,
  });
}

export async function deleteMessage(chatId: number, messageId: number): Promise<any> {
  return apiCall('deleteMessage', { chat_id: chatId, message_id: messageId });
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<any> {
  return apiCall('answerCallbackQuery', { callback_query_id: callbackQueryId, text: text || '' });
}

export async function sendChatAction(chatId: number, action: 'typing' | 'upload_photo' | 'upload_document' = 'typing'): Promise<any> {
  return apiCall('sendChatAction', { chat_id: chatId, action });
}

export async function sendDocumentBuffer(chatId: number, buffer: Buffer, fileName: string, caption?: string): Promise<any> {
  try {
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('document', buffer, { filename: fileName, contentType: 'application/octet-stream' });
    if (caption) form.append('caption', caption);
    const res = await fetch(`${API_BASE}/sendDocument`, { method: 'POST', body: form as any, headers: form.getHeaders() });
    return await res.json();
  } catch (e) { console.error('sendDocumentBuffer error:', e); return null; }
}

export async function sendPhotoBuffer(chatId: number, buffer: Buffer, fileName: string, caption?: string): Promise<any> {
  try {
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('photo', buffer, { filename: fileName, contentType: 'image/png' });
    if (caption) form.append('caption', caption);
    const res = await fetch(`${API_BASE}/sendPhoto`, { method: 'POST', body: form as any, headers: form.getHeaders() });
    return await res.json();
  } catch (e) { console.error('sendPhotoBuffer error:', e); return null; }
}

export async function getFile(fileId: string): Promise<{ file_path?: string } | null> {
  const r = await apiCall('getFile', { file_id: fileId });
  return r?.ok ? r.result : null;
}
export function getFileUrl(fp: string): string { return `https://api.telegram.org/file/bot${BOT_TOKEN}/${fp}`; }
export async function getUpdates(offset = 0, timeout = 30): Promise<any> {
  return apiCall('getUpdates', { offset, timeout, allowed_updates: ['message', 'callback_query'] });
}
export async function deleteWebhook(): Promise<any> { return apiCall('deleteWebhook', {}); }
export async function getMe(): Promise<any> { return apiCall('getMe', {}); }
export function escapeHtml(t: string): string { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
export function truncateText(t: string, m = 4000): string { return t.length <= m ? t : t.substring(0, m) + '\n\n... (trimmed)'; }

export interface TelegramMessage {
  message_id: number; from?: { id: number; first_name: string; last_name?: string; username?: string; language_code?: string; };
  chat: { id: number; type: string; }; text?: string;
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number; };
  photo?: Array<{ file_id: string; width: number; height: number; }>;
  voice?: { file_id: string; duration: number; mime_type?: string; };
  video?: { file_id: string; width: number; height: number; duration: number; mime_type?: string; };
  caption?: string;
}
export interface TelegramCallbackQuery { id: string; from: { id: number; first_name: string; last_name?: string; username?: string; }; message?: TelegramMessage; data?: string; }
export interface TelegramUpdate { update_id: number; message?: TelegramMessage; callback_query?: TelegramCallbackQuery; }
