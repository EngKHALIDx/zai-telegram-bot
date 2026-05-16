/**
 * Z.ai Telegram Agent v16.0
 * Full Agent mode like chat.z.ai
 * Features: Iterative tool calling, real-time display, stop button, streaming, model selection
 */
import {
  getUpdates, deleteWebhook, getMe, sendMessage, answerCallbackQuery,
  sendChatAction, editMessageText, escapeHtml, truncateText,
  getFile, getFileUrl,
  type TelegramUpdate, type TelegramMessage, type TelegramCallbackQuery,
} from './telegram.js';
import { chatCompletion, visionChat, testConnection, type ChatMessage } from './zai.js';
import { executeTool, parseToolCalls, getAgentSystemPrompt } from './tools.js';
import {
  startOperation, getOperation, isRunning, stopOperation,
  updateDisplay, finishDisplay, cleanup, getAbortSignal,
} from './operations.js';

const ALLOWED = (process.env.ALLOWED_USERNAMES || '').split(',').map(u => u.trim().replace('@', '').toLowerCase()).filter(u => u);
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'glm-4-flash';

let lastUpdateId = 0;
let isPolling = false;
const startTime = Date.now();

// ─── Session Storage ────────────────────────────────────────

interface Session {
  id: string;
  chatId: number;
  messages: ChatMessage[];
  model: string;
  thinking: boolean;
  createdAt: number;
}

const sessions: Map<number, Session> = new Map();

function getSession(chatId: number): Session {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 8),
      chatId,
      messages: [{ role: 'system', content: getAgentSystemPrompt() }],
      model: DEFAULT_MODEL,
      thinking: false,
      createdAt: Date.now(),
    });
  }
  return sessions.get(chatId)!;
}

function resetSession(chatId: number): Session {
  sessions.delete(chatId);
  return getSession(chatId);
}

// ─── Auth ──────────────────────────────────────────────────

function isAllowed(from?: { username?: string; id?: number }): boolean {
  if (!from) return false;
  if (ALLOWED.length === 0) return true;
  return !!from.username && ALLOWED.includes(from.username.toLowerCase());
}

// ─── Agent Execution (Iterative Tool Loop) ────────────────

async function runAgent(chatId: number, userText: string): Promise<void> {
  if (isRunning(chatId)) {
    await sendMessage(chatId, '⏳ <b>هناك عملية جارية بالفعل!</b>\nاضغط ⏹️ إيقاف أولاً.', {
      reply_markup: { inline_keyboard: [[{ text: '⏹️ إيقاف', callback_data: 'stop_op' }]] },
    });
    return;
  }

  const session = getSession(chatId);
  const op = startOperation(chatId, userText);

  // Add user message to session
  session.messages.push({ role: 'user', content: userText });

  // Send initial status
  await sendMessage(chatId, `⏳ <b>جاري التحليل...</b>\n📝 ${escapeHtml(userText.substring(0, 100))}`);
  await updateDisplay(chatId);

  // Start typing indicator
  const typingInterval = setInterval(() => {
    if (op.status === 'running') {
      sendChatAction(chatId, 'typing').catch(() => {});
    }
  }, 4000);

  const MAX_ITERATIONS = 15;
  let iteration = 0;
  let finalResponse = '';

  try {
    while (iteration < MAX_ITERATIONS && op.status === 'running') {
      iteration++;

      // Keep context manageable - last 20 messages
      const contextMessages = session.messages.slice(-20);

      // Call AI
      const response = await chatCompletion(contextMessages, {
        model: session.model,
        thinking: session.thinking,
      });

      // Check if stopped during API call
      if (op.status !== 'running') break;

      // Parse tool calls from the response
      const toolCalls = parseToolCalls(response);

      // Extract text content (remove tool call tags)
      const textContent = response
        .replace(/<tool_call[\s\S]*?<\/tool_call[=\s]*>/g, '')
        .replace(/<think[\s\S]*?<\/think>/g, '')
        .trim();

      if (toolCalls.length === 0) {
        // No tools - this is the final response
        finalResponse = textContent || response.replace(/<think[\s\S]*?<\/think>/g, '').trim();
        // Add assistant response to session
        if (finalResponse) {
          session.messages.push({ role: 'assistant', content: finalResponse });
        }
        break;
      }

      // If there's text before tools, send it as a progress update
      if (textContent) {
        await sendMessage(chatId, `💭 ${truncateText(escapeHtml(textContent), 1500)}`);
      }

      // Execute each tool with real-time display
      const toolResults: Array<{ tool: string; result: any }> = [];

      for (const call of toolCalls) {
        if (op.status !== 'running') break;

        // Show what tool is being called
        await sendMessage(chatId, `🔧 <b>تنفيذ:</b> ${escapeHtml(call.tool)}(${escapeHtml(Object.entries(call.params).map(([k, v]) => `${k}=${String(v).substring(0, 30)}`).join(', '))})`);

        const result = await executeTool(call.tool, call.params, chatId);
        toolResults.push({ tool: call.tool, result });

        // Send tool result summary
        const icon = result.success ? '✅' : '❌';
        const resultPreview = result.output.substring(0, 500);
        await sendMessage(chatId, `${icon} <b>${escapeHtml(call.tool)}</b>:\n<code>${escapeHtml(resultPreview)}</code>`);
      }

      // Build assistant message for context
      let assistantMsg = textContent || 'تم تنفيذ العمليات.';
      for (const tr of toolResults) {
        assistantMsg += `\n[${tr.tool}: ${tr.result.success ? 'OK' : 'FAIL'}]`;
      }
      session.messages.push({ role: 'assistant', content: assistantMsg });

      // Add tool results as next user message for context
      let toolContext = 'نتائج العمليات المنفذة:\n\n';
      for (const tr of toolResults) {
        const icon = tr.result.success ? '✅' : '❌';
        toolContext += `${icon} ${tr.tool}:\n${tr.result.output.substring(0, 1500)}\n\n`;
      }
      toolContext += '\nاستمر في التنفيذ أو قدم النتيجة النهائية للمستخدم إذا انتهيت.';
      session.messages.push({ role: 'user', content: toolContext });

      // Show iteration progress
      const doneCount = op.steps.filter(s => s.status === 'done').length;
      const failCount = op.steps.filter(s => s.status === 'failed').length;
      await sendMessage(chatId, `🔄 <b>الخطوة ${iteration}/${MAX_ITERATIONS}</b> — ✅${doneCount} ❌${failCount} ⏳متابعة...`, {
        reply_markup: { inline_keyboard: [[{ text: '⏹️ إيقاف', callback_data: 'stop_op' }]] },
      });
    }

    if (iteration >= MAX_ITERATIONS && !finalResponse) {
      finalResponse = 'تم الوصول للحد الأقصى من الخطوات. إليك ما تم إنجازه.';
    }

    // If stopped by user
    if (op.status === 'stopped') {
      finalResponse = '⏹️ تم إيقاف العملية بواسطتك.';
    }

    // Show final results
    await finishDisplay(chatId, finalResponse || 'تم تنفيذ المهمة.');

  } catch (error: any) {
    if (op.status === 'running') {
      op.status = 'failed';
      await sendMessage(chatId, `❌ <b>خطأ!</b>\n\n${escapeHtml((error.message || 'Unknown error').substring(0, 300))}`, {
        reply_markup: { inline_keyboard: [[{ text: '🔄 إعادة', callback_data: 'retry_last' }]] },
      });
    }
  } finally {
    clearInterval(typingInterval);
    cleanup(chatId);
  }
}

// ─── Command Handlers ──────────────────────────────────────

async function handleStart(chatId: number) {
  await sendMessage(chatId, `
🤖 <b>Z.ai Agent v16.0</b>

أنا وكيل ذكي يعمل مثل وضع Agent في chat.z.ai!
أستطيع بناء تطبيقات، كتابة كود، تنفيذ أوامر، بحث الويب، وأكثر.

🏗️ <b>ما يمكنني فعله:</b>
• بناء مواقع وتطبيقات كاملة
• إنشاء مشاريع ورفعها على GitHub
• كتابة وتنفيذ كود JavaScript/Python/Bash
• بحث في الويب وإنشاء صور بالذكاء الاصطناعي
• تحليل الملفات والإجابة على الأسئلة
• تنفيذ أوامر Shell على النظام مباشرة

📋 <b>الأوامر:</b>
/new — مهمة جديدة (جلسة نظيفة)
/model — اختيار النموذج
/think — التفكير العميق
/stop — إيقاف العملية الحالية
/status — حالة العملية الجارية
/reset — إعادة تعيين كل شيء

💡 <b>أرسل أي طلب وسأبدأ العمل فوراً!</b>
`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🆕 مهمة جديدة', callback_data: 'new_agent' }],
        [
          { text: '🌟 النموذج', callback_data: 'models' },
          { text: '🧠 التفكير', callback_data: 'toggle_thinking' },
        ],
        [{ text: '📊 حالة النظام', callback_data: 'status' }],
      ],
    },
  });
}

async function handleStatus(chatId: number) {
  const session = getSession(chatId);
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  const sessionAge = Math.floor((Date.now() - session.createdAt) / 60000);
  const running = isRunning(chatId);

  let text = `📊 <b>حالة النظام</b>\n\n`;
  text += `🟢 البوت: يعمل\n`;
  text += `⏱️ مدة التشغيل: ${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m\n`;
  text += `🤖 النموذج: <code>${session.model}</code>\n`;
  text += `🧠 التفكير: ${session.thinking ? '✅ مفعل' : '❌ معطل'}\n`;
  text += `📝 الجلسة: ${session.messages.length} رسالة (${sessionAge} دقيقة)\n`;
  text += `⏳ العمليات: ${running ? '🔴 جارية' : '🟢 لا توجد'}\n`;

  if (running) {
    const op = getOperation(chatId);
    if (op) {
      const doneCount = op.steps.filter(s => s.status === 'done').length;
      const failCount = op.steps.filter(s => s.status === 'failed').length;
      const elapsed = Math.floor((Date.now() - op.startedAt) / 1000);
      text += `\n📋 <b>العملية الجارية:</b>\n`;
      text += `📝 ${escapeHtml(op.userMessage.substring(0, 80))}\n`;
      text += `⏱️ ${elapsed}s | ✅${doneCount} ❌${failCount} / ${op.steps.length} خطوة`;
    }
  }

  await sendMessage(chatId, text, {
    reply_markup: running ? { inline_keyboard: [[{ text: '⏹️ إيقاف', callback_data: 'stop_op' }]] } : undefined,
  });
}

async function handleModels(chatId: number) {
  const session = getSession(chatId);
  const models = [
    { id: 'glm-4-flash', name: 'GLM-4 Flash ⚡', desc: 'سريع وفعال' },
    { id: 'glm-4-plus', name: 'GLM-4 Plus 💎', desc: 'متميز' },
    { id: 'glm-4v', name: 'GLM-4V 🖼️', desc: 'بصري' },
    { id: 'glm-5.1', name: 'GLM-5.1 🌟', desc: 'الأحدث مع تفكير' },
    { id: 'glm-5.1-plus', name: 'GLM-5.1 Plus 👑', desc: 'أقصى جودة' },
    { id: 'glm-5.1v', name: 'GLM-5.1V 👁️', desc: 'بصري متقدم' },
  ];

  const buttons = models.map(m => [{
    text: `${m.name}${m.id === session.model ? ' ✅' : ''} — ${m.desc}`,
    callback_data: `model_${m.id}`,
  }]);

  await sendMessage(chatId, `🌟 <b>اختيار النموذج</b>\n\nالحالي: <code>${session.model}</code>`, {
    reply_markup: { inline_keyboard: buttons },
  });
}

// ─── Last message tracking for retry ──────────────────────

const lastUserMessage: Map<number, string> = new Map();

// ─── Callback Handler ──────────────────────────────────────

async function handleCallback(cb: TelegramCallbackQuery) {
  const chatId = cb.message?.chat?.id;
  if (!chatId) return;
  const data = cb.data || '';
  await answerCallbackQuery(cb.id);

  if (data === 'stop_op') {
    const stopped = stopOperation(chatId);
    if (stopped) {
      await sendMessage(chatId, '⏹️ <b>تم إيقاف العملية!</b>');
      await updateDisplay(chatId);
    } else {
      await sendMessage(chatId, 'ℹ️ لا توجد عملية جارية حالياً.');
    }
  }
  else if (data === 'new_agent') {
    resetSession(chatId);
    await sendMessage(chatId, '🆕 <b>مهمة جديدة!</b>\n\nجلسة نظيفة — أرسل طلبك وسأبدأ العمل.', {
      reply_markup: { inline_keyboard: [[{ text: '🌟 النموذج', callback_data: 'models' }]] },
    });
  }
  else if (data === 'models') { await handleModels(chatId); }
  else if (data === 'toggle_thinking') {
    const s = getSession(chatId);
    s.thinking = !s.thinking;
    await sendMessage(chatId, `🧠 التفكير العميق: ${s.thinking ? '✅ مفعل' : '❌ معطل'}`);
  }
  else if (data === 'status') { await handleStatus(chatId); }
  else if (data === 'show_results') {
    const op = getOperation(chatId);
    if (op) {
      let results = '📊 <b>النتائج:</b>\n\n';
      for (const step of op.steps) {
        const icon = step.status === 'done' ? '✅' : step.status === 'failed' ? '❌' : '⏹️';
        results += `${icon} ${step.tool}: ${escapeHtml((step.output || '').substring(0, 150))}\n`;
      }
      await sendMessage(chatId, results);
    }
  }
  else if (data === 'retry_last') {
    const lastMsg = lastUserMessage.get(chatId);
    if (lastMsg) {
      await sendMessage(chatId, '🔄 <b>إعادة المحاولة...</b>');
      await runAgent(chatId, lastMsg);
    } else {
      await sendMessage(chatId, '❌ لا توجد رسالة سابقة لإعادة المحاولة.');
    }
  }
  else if (data.startsWith('model_')) {
    const modelId = data.replace('model_', '');
    const session = getSession(chatId);
    session.model = modelId;
    await sendMessage(chatId, `✅ تم تغيير النموذج إلى: <b>${modelId}</b>`);
  }
}

// ─── Message Handler ───────────────────────────────────────

async function handleMessage(msg: TelegramMessage) {
  const chatId = msg.chat.id;
  if (!msg.from) return;
  if (!isAllowed(msg.from)) {
    await sendMessage(chatId, '🚫 غير مصرح لك باستخدام هذا البوت.');
    return;
  }

  const text = msg.text || '';

  // Commands
  if (text.startsWith('/start') || text.startsWith('/help')) { await handleStart(chatId); return; }
  if (text.startsWith('/new')) { resetSession(chatId); await sendMessage(chatId, '🆕 <b>جلسة جديدة!</b>\nأرسل طلبك وسأبدأ العمل.'); return; }
  if (text.startsWith('/model')) { await handleModels(chatId); return; }
  if (text.startsWith('/think')) {
    const s = getSession(chatId);
    s.thinking = !s.thinking;
    await sendMessage(chatId, `🧠 التفكير العميق: ${s.thinking ? '✅ مفعل' : '❌ معطل'}`);
    return;
  }
  if (text.startsWith('/stop')) {
    const st = stopOperation(chatId);
    await sendMessage(chatId, st ? '⏹️ تم الإيقاف' : 'ℹ️ لا توجد عملية جارية');
    return;
  }
  if (text.startsWith('/status')) { await handleStatus(chatId); return; }
  if (text.startsWith('/reset')) {
    resetSession(chatId);
    await sendMessage(chatId, '🔄 تم إعادة تعيين كل شيء. أرسل طلبك من جديد.');
    return;
  }

  // Handle images with vision
  if (msg.photo || msg.document) {
    const session = getSession(chatId);
    if (isRunning(chatId)) {
      await sendMessage(chatId, '⏳ هناك عملية جارية بالفعل!', {
        reply_markup: { inline_keyboard: [[{ text: '⏹️ إيقاف', callback_data: 'stop_op' }]] },
      });
      return;
    }

    await sendChatAction(chatId, 'typing');

    try {
      let fileUrl = '';
      if (msg.photo && msg.photo.length > 0) {
        const file = await getFile(msg.photo[msg.photo.length - 1].file_id);
        if (file?.file_path) fileUrl = getFileUrl(file.file_path);
      } else if (msg.document) {
        const file = await getFile(msg.document.file_id);
        if (file?.file_path) fileUrl = getFileUrl(file.file_path);
      }

      if (fileUrl) {
        const caption = msg.caption || 'حلل هذه الصورة';
        const visionModel = session.model.includes('v') ? session.model : 'glm-4v';
        const response = await visionChat([{
          role: 'user',
          content: [
            { type: 'text', text: caption },
            { type: 'image_url', image_url: { url: fileUrl } },
          ],
        }], { model: visionModel });

        await sendMessage(chatId, `👁️ ${truncateText(escapeHtml(response))}`);
      }
    } catch (e: any) {
      await sendMessage(chatId, `❌ خطأ في تحليل الصورة: ${escapeHtml(e.message?.substring(0, 200))}`);
    }
    return;
  }

  // Text message - run agent
  if (text && !text.startsWith('/')) {
    lastUserMessage.set(chatId, text);
    await runAgent(chatId, text);
  }
}

// ─── Polling ──────────────────────────────────────────────

let pollRetryCount = 0;

async function poll(): Promise<void> {
  if (isPolling) return;
  isPolling = true;
  try {
    const result = await getUpdates(lastUpdateId + 1, 30);
    if (!result?.ok) {
      const desc = result?.description || 'Unknown';
      if (desc.includes('Conflict')) {
        pollRetryCount++;
        if (pollRetryCount > 5) {
          console.warn('[Poll] Conflict persists, waiting 30s...');
          await new Promise(r => setTimeout(r, 30000));
          pollRetryCount = 0;
        } else {
          console.warn(`[Poll] Conflict (${pollRetryCount}), retrying...`);
          await new Promise(r => setTimeout(r, 3000));
        }
      } else {
        console.error('[Poll] Error:', desc);
      }
      isPolling = false;
      return;
    }
    pollRetryCount = 0;
    const updates: TelegramUpdate[] = result.result || [];
    for (const u of updates) {
      if (u.update_id > lastUpdateId) lastUpdateId = u.update_id;
      try {
        if (u.message) {
          const from = u.message.from?.first_name || 'Unknown';
          const text = u.message.text || '[Media]';
          console.log(`[Msg] ${from}: ${text.substring(0, 100)}`);
          await handleMessage(u.message);
        }
        else if (u.callback_query) {
          console.log(`[CB] ${u.callback_query.from.first_name}: ${u.callback_query.data}`);
          await handleCallback(u.callback_query);
        }
      } catch (e) { console.error('[Handler] Error:', e); }
    }
  } catch (e) { console.error('[Poll] Fatal:', e); }
  finally { isPolling = false; }
}

// ─── Main ──────────────────────────────────────────────────

async function main() {
  console.log('[Bot] Z.ai Agent v16.0 starting...');

  // Test Telegram connection
  const me = await getMe();
  if (!me?.ok) { console.error('[FATAL] Bad bot token:', me?.description); process.exit(1); }
  console.log(`[Bot] Connected: @${me.result.username} (${me.result.first_name})`);
  console.log(`[Bot] Allowed: ${ALLOWED.length > 0 ? ALLOWED.join(', ') : 'Everyone'}`);

  // Test Z.ai API connection
  const apiTest = await testConnection();
  if (apiTest.ok) {
    console.log(`[API] Connected! Model: ${apiTest.model}`);
  } else {
    console.warn(`[API] Warning: ${apiTest.error}`);
    console.warn('[API] Bot will start but API calls may fail');
  }

  await deleteWebhook();
  console.log('[Bot] Webhook deleted, starting polling...');

  // Poll loop - short polling with 1s interval to avoid conflicts
  const loop = () => poll().finally(() => setTimeout(loop, 1000));
  loop();

  // Heartbeat
  setInterval(() => {
    const up = Math.floor((Date.now() - startTime) / 1000);
    console.log(`[Heartbeat] ${new Date().toISOString()} | Up: ${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m | Sessions: ${sessions.size}`);
  }, 60000);
}

process.on('SIGINT', () => { console.log('\n[Bot] Shutting down...'); process.exit(0); });
process.on('SIGTERM', () => { console.log('\n[Bot] SIGTERM received'); process.exit(0); });
process.on('uncaughtException', (e) => console.error('[Uncaught]:', e));
process.on('unhandledRejection', (r) => console.error('[Unhandled]:', r));

main();
