/**
 * Z.ai Telegram Agent v15.0
 * Real-time agent mode like chat.z.ai
 * Features: Live operation display, stop button, step counter, timer
 *           Session-based, iterative tool calling, model selection
 */
import { getUpdates, deleteWebhook, getMe, sendMessage, answerCallbackQuery, sendChatAction, editMessageText, escapeHtml, truncateText, getFile, getFileUrl, type TelegramUpdate, type TelegramMessage, type TelegramCallbackQuery } from './telegram.js';
import { agentChat, visionChat, generateImage, webSearch, type ChatMessage } from './zai.js';
import { executeTool, parseToolCalls, getAgentSystemPrompt } from './tools.js';
import { startOperation, getOperation, isRunning, stopOperation, updateDisplay, finishDisplay, cleanup } from './operations.js';

const ALLOWED = (process.env.ALLOWED_USERNAMES || '').split(',').map(u => u.trim().replace('@', '').toLowerCase()).filter(u => u);
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'glm-5.1';

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
      thinking: true,
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
    await sendMessage(chatId, '⏳ <b>هناك عملية جارية بالفعل!</b>\n\nاضغط ⏹️ إيقاف أولاً.', {
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

  // Maximum 10 iterations (tool calls + responses)
  const MAX_ITERATIONS = 10;
  let iteration = 0;
  let finalResponse = '';

  try {
    while (iteration < MAX_ITERATIONS && op.status === 'running') {
      iteration++;

      // Call AI
      const response = await agentChat(session.messages, {
        model: session.model,
        thinking: session.thinking,
      });

      if ((op as any).status === 'stopped') break;

      // Parse tool calls
      const toolCalls = parseToolCalls(response);

      // Extract text before tool calls
      const textBeforeTools = response.split('<tool_call')[0].trim();

      if (toolCalls.length === 0) {
        // No tools - this is the final response
        finalResponse = response.replace(/<tool_call[\s\S]*?<\/tool_call[=\s]*>/g, '').trim();
        break;
      }

      // Execute tools with real-time display
      const toolResults: Array<{ tool: string; result: any }> = [];

      for (const call of toolCalls) {
        if ((op as any).status === 'stopped') break;

        const result = await executeTool(call.tool, call.params, chatId);
        toolResults.push({ tool: call.tool, result });
      }

      // Build assistant message with tool results for context
      let assistantMsg = textBeforeTools || 'تم تنفيذ العمليات المطلوبة.';
      for (const tr of toolResults) {
        assistantMsg += `\n\n[${tr.tool}: ${tr.result.success ? '✅' : '❌'} ${tr.result.output.substring(0, 300)}]`;
      }

      session.messages.push({ role: 'assistant', content: assistantMsg });

      // Add tool results as user message for next iteration
      let toolContext = 'نتائج العمليات:\n\n';
      for (const tr of toolResults) {
        const icon = tr.result.success ? '✅' : '❌';
        toolContext += `${icon} ${tr.tool}:\n${tr.result.output.substring(0, 1000)}\n\n`;
      }
      toolContext += '\nاستمر في التنفيذ أو قدم النتيجة النهائية للمستخدم.';

      session.messages.push({ role: 'user', content: toolContext });

      // Show progress message
      const doneCount = op.steps.filter(s => s.status === 'done').length;
      const failCount = op.steps.filter(s => s.status === 'failed').length;
      await sendMessage(chatId, `🔄 <b>الخطوة ${iteration}</b> - ✅ ${doneCount} نجح | ❌ ${failCount} فشل | ⏳ متابعة...`, {
        reply_markup: { inline_keyboard: [[{ text: '⏹️ إيقاف', callback_data: 'stop_op' }]] },
      });
    }

    if (iteration >= MAX_ITERATIONS) {
      finalResponse = 'تم الوصول للحد الأقصى من الخطوات (10). إليك ما تم إنجازه:\n\n' + finalResponse;
    }

    // Show final results
    await finishDisplay(chatId, finalResponse || 'تم تنفيذ المهمة.');

    // Save assistant response
    if (finalResponse) {
      session.messages.push({ role: 'assistant', content: finalResponse });
    }

  } catch (error: any) {
    if (op.status === 'running') {
      op.status = 'failed';
      await sendMessage(chatId, `❌ <b>خطأ!</b>\n\n${escapeHtml(error.message?.substring(0, 300) || 'Unknown error')}`, {
        reply_markup: { inline_keyboard: [[{ text: '🔄 إعادة المحاولة', callback_data: 'retry' }]] },
      });
    }
  } finally {
    cleanup(chatId);
  }
}

// ─── Command Handlers ──────────────────────────────────────

async function handleStart(chatId: number) {
  await sendMessage(chatId, `
🤖 <b>Z.ai Agent v15.0</b>

أنا وكيل ذكي يعمل مثل وضع Agent في chat.z.ai!

🏗️ <b>ما يمكنني فعله:</b>
• بناء مواقع وتطبيقات كاملة
• إنشاء مشاريع ورفعها على GitHub
• كتابة وتنفيذ كود JavaScript/Python/Bash
• بحث في الويب وإنشاء صور
• تحليل الملفات والإجابة على الأسئلة
• تنفيذ أوامر Shell مباشرة على النظام

📋 <b>الأوامر:</b>
/new - مهمة جديدة (جلسة نظيفة)
/model - اختيار النموذج
/think - التفكير العميق
/stop - إيقاف العملية الحالية
/status - حالة العملية الجارية
/sessions - عرض الجلسات
/reset - إعادة تعيين كل شيء

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
  if (isRunning(chatId)) {
    await updateDisplay(chatId);
  } else {
    const session = getSession(chatId);
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const sessionAge = Math.floor((Date.now() - session.createdAt) / 60000);
    await sendMessage(chatId, `
📊 <b>حالة النظام</b>

🟢 البوت: يعمل
⏱️ مدة التشغيل: ${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m
🤖 النموذج: ${session.model}
🧠 التفكير: ${session.thinking ? 'مفعل' : 'معطل'}
📝 الجلسة: ${session.messages.length} رسالة (${sessionAge} دقيقة)
⏳ العمليات: لا توجد عمليات جارية
`);
  }
}

async function handleModels(chatId: number) {
  const session = getSession(chatId);
  const models = [
    { id: 'glm-5.1', name: 'GLM-5.1 🌟', desc: 'الأحدث مع تفكير عميق' },
    { id: 'glm-5.1-plus', name: 'GLM-5.1 Plus 👑', desc: 'أقصى جودة' },
    { id: 'glm-5.1v', name: 'GLM-5.1V 👁️', desc: 'بصري مع استدلال' },
    { id: 'glm-4-flash', name: 'GLM-4 Flash ⚡', desc: 'سريع' },
    { id: 'glm-4-plus', name: 'GLM-4 Plus 💎', desc: 'متميز' },
    { id: 'glm-4v', name: 'GLM-4V 🖼️', desc: 'بصري' },
  ];

  const buttons = models.map(m => [{
    text: `${m.name}${m.id === session.model ? ' ✅' : ''} - ${m.desc}`,
    callback_data: `model_${m.id}`,
  }]);

  await sendMessage(chatId, `🌟 <b>اختيار النموذج</b>\n\nالحالي: ${session.model}`, {
    reply_markup: { inline_keyboard: buttons },
  });
}

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
      await sendMessage(chatId, 'ℹ️ لا توجد عملية جارية.');
    }
  }
  else if (data === 'new_agent') {
    resetSession(chatId);
    await sendMessage(chatId, '🆕 <b>مهمة جديدة!</b>\n\nجلسة نظيفة - أرسل طلبك وسأبدأ العمل.', {
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
        results += `${icon} ${step.tool}: ${escapeHtml((step.output || '').substring(0, 200))}\n`;
      }
      await sendMessage(chatId, results);
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
    await sendMessage(chatId, '🚫 غير مصرح');
    return;
  }

  const text = msg.text || '';

  // Commands
  if (text.startsWith('/start') || text.startsWith('/help')) { await handleStart(chatId); return; }
  if (text.startsWith('/new') || text.startsWith('/reset')) { resetSession(chatId); await sendMessage(chatId, '🆕 جلسة جديدة! أرسل طلبك.'); return; }
  if (text.startsWith('/model')) { await handleModels(chatId); return; }
  if (text.startsWith('/think')) { const s = getSession(chatId); s.thinking = !s.thinking; await sendMessage(chatId, `🧠 التفكير: ${s.thinking ? 'مفعل' : 'معطل'}`); return; }
  if (text.startsWith('/stop')) { const st = stopOperation(chatId); await sendMessage(chatId, st ? '⏹️ تم الإيقاف' : 'لا توجد عملية'); return; }
  if (text.startsWith('/status')) { await handleStatus(chatId); return; }

  // Handle images with vision
  if (msg.photo || msg.document) {
    const session = getSession(chatId);
    if (isRunning(chatId)) {
      await sendMessage(chatId, '⏳ هناك عملية جارية!', {
        reply_markup: { inline_keyboard: [[{ text: '⏹️ إيقاف', callback_data: 'stop_op' }]] },
      });
      return;
    }

    await sendChatAction(chatId, 'typing');

    // Get file URL
    let fileUrl = '';
    if (msg.photo && msg.photo.length > 0) {
      const file = await getFile(msg.photo[msg.photo.length - 1].file_id);
      if (file?.file_path) fileUrl = getFileUrl(file.file_path);
    } else if (msg.document) {
      const file = await getFile(msg.document.file_id);
      if (file?.file_path) fileUrl = getFileUrl(file.file_path);
    }

    if (fileUrl) {
      const caption = msg.caption || 'حلل هذا';
      const visionModel = session.model.includes('v') ? session.model : 'glm-4v';
      const response = await visionChat([{
        role: 'user',
        content: [
          { type: 'text', text: caption },
          { type: 'image_url', image_url: { url: fileUrl } },
        ],
      }], { model: visionModel });

      await sendMessage(chatId, `👁️ ${truncateText(response)}`, {
        reply_markup: { inline_keyboard: [[{ text: '⏹️ إيقاف', callback_data: 'stop_op' }]] },
      });
    }
    return;
  }

  // Text message - run agent
  if (text && !text.startsWith('/')) {
    await runAgent(chatId, text);
  }
}

// ─── Polling ──────────────────────────────────────────────

async function poll(): Promise<void> {
  if (isPolling) return;
  isPolling = true;
  try {
    const result = await getUpdates(lastUpdateId + 1, 30);
    if (!result?.ok) { console.error('[Poll] Error:', result?.description); isPolling = false; return; }
    const updates: TelegramUpdate[] = result.result || [];
    for (const u of updates) {
      if (u.update_id > lastUpdateId) lastUpdateId = u.update_id;
      try {
        if (u.message) { console.log(`[Msg] ${u.message.from?.first_name}: ${u.message.text || '[Media]'}`); await handleMessage(u.message); }
        else if (u.callback_query) { console.log(`[CB] ${u.callback_query.from.first_name}: ${u.callback_query.data}`); await handleCallback(u.callback_query); }
      } catch (e) { console.error('[Handler] Error:', e); }
    }
  } catch (e) { console.error('[Poll] Fatal:', e); }
  finally { isPolling = false; }
}

// ─── Main ──────────────────────────────────────────────────

async function main() {
  const me = await getMe();
  if (!me?.ok) { console.error('[FATAL] Bad bot token'); process.exit(1); }
  console.log(`[Bot] Connected: @${me.result.username} (${me.result.first_name})`);
  console.log(`[Bot] Allowed: ${ALLOWED.length > 0 ? ALLOWED.join(', ') : 'Everyone'}`);

  await deleteWebhook();
  console.log('[Bot] Webhook deleted, polling...');

  // Poll loop
  const loop = () => poll().finally(() => setTimeout(loop, 1000));
  loop();

  // Heartbeat
  setInterval(() => {
    const up = Math.floor((Date.now() - startTime) / 1000);
    console.log(`[Heartbeat] ${new Date().toISOString()} | Uptime: ${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m | Sessions: ${sessions.size}`);
  }, 60000);
}

process.on('SIGINT', () => { console.log('\n[Bot] Shutting down...'); process.exit(0); });
process.on('SIGTERM', () => { console.log('\n[Bot] SIGTERM'); process.exit(0); });
process.on('uncaughtException', (e) => console.error('[Uncaught]:', e));
process.on('unhandledRejection', (r) => console.error('[Unhandled]:', r));

main();
