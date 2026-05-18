/**
 * Z.ai Telegram Agent v19.0 — GitHub Actions Only
 * Multi-provider: OpenCode Zen + ZhipuAI
 * Executes all commands in real Linux bash shell environment
 * Runs exclusively on GitHub Actions with auto-restart via cron
 * Production-ready Agent bot with isolated sandboxes, concurrency limits,
 * real-time operations display, file browser, process tracking, streaming
 */
import {
  getUpdates, deleteWebhook, getMe, sendMessage, answerCallbackQuery,
  sendChatAction, editMessageText, escapeHtml, truncateText,
  getFile, getFileUrl, buildFileBrowserKeyboard,
  type TelegramUpdate, type TelegramMessage, type TelegramCallbackQuery,
} from './telegram.js';
import { chatCompletion, visionChat, testConnection, testOpenCodeConnection, type ChatMessage } from './zai.js';
import { executeTool, AGENT_TOOLS } from './tools.js';
import {
  startOperation, getOperation, isRunning, stopOperation,
  updateDisplay, finishDisplay, cleanup, getAbortSignal,
} from './operations.js';
import {
  createSandbox, getOrCreateSandbox, getActiveSandbox, getSandboxById,
  releaseSandbox, listSandboxes, canCreateSandbox, getActiveCount,
  getMaxSandboxes, getSessionHistory, startIdleCleanup, stopIdleCleanup,
  touchSandbox, switchSandbox,
} from './sandbox.js';
import { killAllForChat, killProcess, getProcesses, getAllProcesses } from './process-manager.js';
import { getCommand, getAllCommands } from './commands.js';
import type { BotContext } from './commands.js';
import { getModel, getModelsByCategory, MODEL_CATEGORIES, MODELS, getFreeModels } from './models.js';
import { readdirSync, statSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ALLOWED = (process.env.ALLOWED_USERNAMES || '').split(',').map(u => u.trim().replace('@', '').toLowerCase()).filter(u => u);
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'glm-4-flash';
const IS_GITHUB_ACTIONS = !!process.env.GITHUB_ACTIONS;
const RUNNER_OS = process.env.RUNNER_OS || 'Linux';
const GITHUB_RUN_ID = process.env.GITHUB_RUN_ID || 'local';
const GITHUB_RUN_NUMBER = process.env.GITHUB_RUN_NUMBER || '0';
const GITHUB_WORKFLOW = process.env.GITHUB_WORKFLOW || 'unknown';

let lastUpdateId = 0;
let isPolling = false;
const startTime = Date.now();

// ─── Auth ──────────────────────────────────────────────────

function isAllowed(from?: { username?: string; id?: number }): boolean {
  if (!from) return false;
  if (ALLOWED.length === 0) return true;
  return !!from.username && ALLOWED.includes(from.username.toLowerCase());
}

// ─── Agent Execution (Iterative Native Tool Loop) ──────────

async function runAgent(chatId: number, userText: string): Promise<void> {
  if (isRunning(chatId)) {
    await sendMessage(chatId, '⏳ <b>هناك عملية جارية بالفعل!</b>\nاضغط ⏹️ إيقاف أولاً.', {
      reply_markup: { inline_keyboard: [[{ text: '⏹️ إيقاف', callback_data: 'stop_op' }]] },
    });
    return;
  }

  // Ensure sandbox exists and check limits
  let sandbox = getActiveSandbox(chatId);
  if (!sandbox) {
    if (!canCreateSandbox()) {
      const count = getActiveCount();
      const max = getMaxSandboxes();
      await sendMessage(chatId, `⚠️ <b>البيئات المعزولة النشطة تجاوزت الحد (${count}/${max})</b>\n\nيرجى تحرير البيئات غير الضرورية للمتابعة. استخدم /sandboxes أو /release`, {
        reply_markup: { inline_keyboard: [[{ text: '📦 البيئات', callback_data: 'sandboxes' }]] },
      });
      return;
    }
    sandbox = createSandbox(chatId)!;
  }

  const op = startOperation(chatId, userText);
  touchSandbox(chatId);

  // Add user message to session
  sandbox.messages.push({ role: 'user', content: userText });

  // Show model provider info
  const modelDef = getModel(sandbox.model);
  const providerInfo = modelDef ? ` | 📡 ${modelDef.provider === 'opencode' ? 'OpenCode' : 'ZhipuAI'}` : '';

  // Send initial status
  await sendMessage(chatId, `⏳ <b>جاري التحليل...</b>\n🤖 ${sandbox.model}${providerInfo}\n📝 ${escapeHtml(userText.substring(0, 100))}`);
  await updateDisplay(chatId);

  // Start typing indicator
  const typingInterval = setInterval(() => {
    if (op.status === 'running') {
      sendChatAction(chatId, 'typing').catch(() => {});
    }
  }, 4000);

  const MAX_ITERATIONS = 20;
  let iteration = 0;
  let finalResponse = '';

  try {
    while (iteration < MAX_ITERATIONS && op.status === 'running') {
      iteration++;

      // Update estimated steps
      op.totalStepsEstimate = Math.max(op.totalStepsEstimate, iteration * 2);

      // Keep context manageable - last 30 messages
      const contextMessages = sandbox.messages.slice(-30);

      // Call AI with native tool definitions
      const response = await chatCompletion(contextMessages, {
        model: sandbox.model,
        tools: AGENT_TOOLS,
        thinking: sandbox.thinking,
        maxTokens: 8192,
      });

      // Check if stopped during API call
      if (op.status !== 'running') break;

      // If no tool calls, this is the final response
      if (response.toolCalls.length === 0) {
        finalResponse = response.content || 'تم تنفيذ المهمة.';
        if (finalResponse) {
          sandbox.messages.push({ role: 'assistant', content: finalResponse });
        }
        break;
      }

      // Add assistant message with tool calls to context
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: response.content,
        tool_calls: response.toolCalls,
      };
      sandbox.messages.push(assistantMsg);

      // If there's text content before tools, show it
      if (response.content && response.content.trim()) {
        const preview = response.content.trim().substring(0, 1000);
        await sendMessage(chatId, `💭 ${truncateText(escapeHtml(preview), 1500)}`);
      }

      // Execute each tool
      for (const call of response.toolCalls) {
        if (op.status !== 'running') break;

        let params: Record<string, any> = {};
        try {
          params = JSON.parse(call.function.arguments);
        } catch {
          params = { raw: call.function.arguments };
        }

        // Show what tool is being called
        const paramPreview = Object.entries(params).map(([k, v]) => `${k}=${String(v).substring(0, 40)}`).join(', ');
        await sendMessage(chatId, `🔧 <b>تنفيذ:</b> ${escapeHtml(call.function.name)}(${escapeHtml(paramPreview.substring(0, 150))})`);

        // Execute the tool
        const result = await executeTool(call.function.name, params, chatId, sandbox);

        // Send tool result summary
        const icon = result.success ? '✅' : '❌';
        const resultPreview = result.output.substring(0, 600);
        await sendMessage(chatId, `${icon} <b>${escapeHtml(call.function.name)}</b>:\n<code>${escapeHtml(resultPreview)}</code>`);

        // Add tool result to session for context
        sandbox.messages.push({
          role: 'tool',
          content: result.output.substring(0, 3000),
          tool_call_id: call.id,
          name: call.function.name,
        });
      }

      // Show iteration progress
      const doneCount = op.steps.filter(s => s.status === 'done').length;
      const failCount = op.steps.filter(s => s.status === 'failed').length;
      await sendMessage(chatId, `🔄 <b>الخطوة ${iteration}/${MAX_ITERATIONS}</b> — ✅${doneCount} ❌${failCount} ⏳متابعة...`, {
        reply_markup: { inline_keyboard: [[{ text: '⏹️ إيقاف', callback_data: 'stop_op' }]] },
      });

      touchSandbox(chatId);
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
      const errMsg = (error.message || 'Unknown error').substring(0, 500);
      await sendMessage(chatId, `❌ <b>خطأ!</b>\n\n${escapeHtml(errMsg)}`, {
        reply_markup: { inline_keyboard: [[{ text: '🔄 إعادة', callback_data: 'retry_last' }]] },
      });
    }
  } finally {
    clearInterval(typingInterval);
    cleanup(chatId);
    touchSandbox(chatId);
  }
}

// ─── File Browser ──────────────────────────────────────────

async function handleFileBrowse(chatId: number, data: string): Promise<void> {
  const sandbox = getActiveSandbox(chatId);
  if (!sandbox) {
    await sendMessage(chatId, '❌ لا توجد جلسة نشطة. استخدم /new أولاً.');
    return;
  }

  const workDir = sandbox.workDir;

  if (data === 'browse_root') {
    // Show workspace root
    await showDirectory(chatId, workDir, '');
  } else if (data.startsWith('browse_dir_')) {
    const dirPath = data.replace('browse_dir_', '');
    const fullPath = join(workDir, dirPath);
    await showDirectory(chatId, fullPath, dirPath);
  } else if (data.startsWith('browse_file_')) {
    const filePath = data.replace('browse_file_', '');
    await showFile(chatId, workDir, filePath);
  } else if (data.startsWith('browse_send_')) {
    const filePath = data.replace('browse_send_', '');
    await sendFileFromWorkspace(chatId, workDir, filePath);
  }
}

async function showDirectory(chatId: number, dirPath: string, relativePath: string): Promise<void> {
  try {
    if (!existsSync(dirPath)) {
      await sendMessage(chatId, '❌ الدليل غير موجود.');
      return;
    }

    const entries = readdirSync(dirPath, { withFileTypes: true });
    const fileEntries = entries
      .filter(e => e.name !== 'node_modules' && e.name !== '.git' && e.name !== '.next')
      .map(e => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        size: e.isDirectory() ? undefined : statSync(join(dirPath, e.name)).size,
      }));

    const keyboard = buildFileBrowserKeyboard(fileEntries, relativePath);
    const dirName = relativePath || '/';
    const fileCount = fileEntries.filter(e => !e.isDirectory).length;
    const dirCount = fileEntries.filter(e => e.isDirectory).length;

    await sendMessage(chatId, `📂 <b>${escapeHtml(dirName)}</b>\n\n📁 ${dirCount} مجلد | 📄 ${fileCount} ملف`, {
      reply_markup: { inline_keyboard: keyboard },
    });
  } catch (e: any) {
    await sendMessage(chatId, `❌ خطأ في فتح الدليل: ${escapeHtml(e.message?.substring(0, 200))}`);
  }
}

async function showFile(chatId: number, workDir: string, filePath: string): Promise<void> {
  try {
    const fullPath = join(workDir, filePath);
    if (!existsSync(fullPath)) {
      await sendMessage(chatId, '❌ الملف غير موجود.');
      return;
    }

    const stat = statSync(fullPath);
    const sizeKB = (stat.size / 1024).toFixed(1);
    const content = readFileSync(fullPath, 'utf-8');
    const isLarge = content.length > 3500;
    const preview = content.substring(0, 3500);

    let text = `📄 <b>${escapeHtml(filePath)}</b>\n`;
    text += `📊 الحجم: ${sizeKB}KB\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n\n`;
    text += `<code>${escapeHtml(preview)}</code>`;
    if (isLarge) text += '\n\n... (محتوى مقطوع)';

    const buttons: Array<Array<{ text: string; callback_data: string }>> = [];

    // Send as document button
    buttons.push([{ text: '📨 إرسال كملف', callback_data: `browse_send_${filePath}` }]);

    // Go back to directory
    const parentDir = filePath.split('/').slice(0, -1).join('/');
    buttons.push([{ text: '📂 العودة للمجلد', callback_data: parentDir ? `browse_dir_${parentDir}` : 'browse_root' }]);

    await sendMessage(chatId, truncateText(text), {
      reply_markup: { inline_keyboard: buttons },
    });
  } catch (e: any) {
    await sendMessage(chatId, `❌ خطأ في قراءة الملف: ${escapeHtml(e.message?.substring(0, 200))}`);
  }
}

async function sendFileFromWorkspace(chatId: number, workDir: string, filePath: string): Promise<void> {
  try {
    const fullPath = join(workDir, filePath);
    if (!existsSync(fullPath)) {
      await sendMessage(chatId, '❌ الملف غير موجود.');
      return;
    }

    const { sendDocumentBuffer } = await import('./telegram.js');
    const buffer = readFileSync(fullPath);
    const fileName = filePath.split('/').pop() || 'file';
    await sendDocumentBuffer(chatId, Buffer.from(buffer), fileName, filePath);
    await sendMessage(chatId, `✅ تم إرسال: ${escapeHtml(filePath)}`);
  } catch (e: any) {
    await sendMessage(chatId, `❌ خطأ في إرسال الملف: ${escapeHtml(e.message?.substring(0, 200))}`);
  }
}

// ─── Last message tracking ─────────────────────────────────

const lastUserMessage: Map<number, string> = new Map();

// ─── Callback Handler ──────────────────────────────────────

async function handleCallback(cb: TelegramCallbackQuery): Promise<void> {
  const chatId = cb.message?.chat?.id;
  if (!chatId) return;
  const data = cb.data || '';
  await answerCallbackQuery(cb.id);

  try {
    // ─── Operation Controls ──────────────────────────────

    if (data === 'stop_op') {
      const stopped = stopOperation(chatId);
      if (stopped) {
        await sendMessage(chatId, '⏹️ <b>تم إيقاف العملية!</b>');
        await updateDisplay(chatId);
      } else {
        await sendMessage(chatId, 'ℹ️ لا توجد عملية جارية حالياً.');
      }
    }
    else if (data === 'noop') {
      // No-op button (for category headers in model list)
    }
    else if (data === 'new_agent') {
      if (!canCreateSandbox()) {
        const count = getActiveCount();
        const max = getMaxSandboxes();
        await sendMessage(chatId, `⚠️ البيئات المعزولة النشطة تجاوزت الحد (${count}/${max}). يرجى تحرير بيئة أولاً.`, {
          reply_markup: { inline_keyboard: [[{ text: '📦 البيئات', callback_data: 'sandboxes' }]] },
        });
        return;
      }
      const sb = createSandbox(chatId);
      if (!sb) {
        await sendMessage(chatId, '❌ فشل إنشاء بيئة جديدة.');
        return;
      }
      await sendMessage(chatId, `🆕 <b>مهمة جديدة!</b>\n\nجلسة معزولة — <code>${sb.id}</code>\n🤖 النموذج: <code>${sb.model}</code>\nأرسل طلبك وسأبدأ العمل.`, {
        reply_markup: { inline_keyboard: [[{ text: '🌟 النموذج', callback_data: 'models' }]] },
      });
    }
    else if (data === 'models') {
      const cmd = getCommand('model');
      if (cmd) {
        const sandbox = getActiveSandbox(chatId);
        await cmd.handler({
          chatId,
          sandbox,
          operation: getOperation(chatId),
          isRunning: isRunning(chatId),
          startTime,
          args: '',
        });
      }
    }
    else if (data.startsWith('model_')) {
      const modelId = data.replace('model_', '');
      const sandbox = getActiveSandbox(chatId);
      if (sandbox) {
        const modelDef = getModel(modelId);
        if (modelDef) {
          sandbox.model = modelId;
          const providerName = modelDef.provider === 'opencode' ? 'OpenCode 📡' : 'ZhipuAI 🇨🇳';
          const freeBadge = modelDef.free ? '🆓' : '💎';
          await sendMessage(chatId, `✅ تم تغيير النموذج إلى: <b>${modelDef.name}</b>\n📡 المزود: ${providerName} ${freeBadge}`, {
            reply_markup: { inline_keyboard: [[{ text: '🆕 مهمة جديدة', callback_data: 'new_agent' }]] },
          });
        } else {
          sandbox.model = modelId;
          await sendMessage(chatId, `✅ تم تغيير النموذج إلى: <b>${modelId}</b>`);
        }
      } else {
        await sendMessage(chatId, '❌ لا توجد جلسة نشطة.');
      }
    }
    else if (data === 'toggle_thinking') {
      const sandbox = getActiveSandbox(chatId);
      if (sandbox) {
        sandbox.thinking = !sandbox.thinking;
        await sendMessage(chatId, `🧠 التفكير العميق: ${sandbox.thinking ? '✅ مفعل' : '❌ معطل'}`);
      } else {
        await sendMessage(chatId, '❌ لا توجد جلسة نشطة.');
      }
    }
    else if (data === 'status') {
      const cmd = getCommand('status');
      if (cmd) {
        await cmd.handler({
          chatId,
          sandbox: getActiveSandbox(chatId),
          operation: getOperation(chatId),
          isRunning: isRunning(chatId),
          startTime,
          args: '',
        });
      }
    }
    else if (data === 'providers') {
      const cmd = getCommand('providers');
      if (cmd) {
        await cmd.handler({
          chatId,
          sandbox: getActiveSandbox(chatId),
          operation: getOperation(chatId),
          isRunning: isRunning(chatId),
          startTime,
          args: '',
        });
      }
    }
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
    else if (data === 'linux_info') {
      const cmd = getCommand('linux');
      if (cmd) {
        await cmd.handler({
          chatId,
          sandbox: getActiveSandbox(chatId),
          operation: getOperation(chatId),
          isRunning: isRunning(chatId),
          startTime,
          args: '',
        });
      }
    }
    else if (data === 'server_info') {
      const cmd = getCommand('servers');
      if (cmd) {
        await cmd.handler({
          chatId,
          sandbox: getActiveSandbox(chatId),
          operation: getOperation(chatId),
          isRunning: isRunning(chatId),
          startTime,
          args: '',
        });
      }
    }
    else if (data === 'sandboxes') {
      const cmd = getCommand('sandboxes');
      if (cmd) {
        await cmd.handler({
          chatId,
          sandbox: getActiveSandbox(chatId),
          operation: getOperation(chatId),
          isRunning: isRunning(chatId),
          startTime,
          args: '',
        });
      }
    }
    else if (data === 'history') {
      const cmd = getCommand('history');
      if (cmd) {
        await cmd.handler({
          chatId,
          sandbox: getActiveSandbox(chatId),
          operation: getOperation(chatId),
          isRunning: isRunning(chatId),
          startTime,
          args: '',
        });
      }
    }
    else if (data.startsWith('release_')) {
      const sandboxId = data.replace('release_', '');
      const result = releaseSandbox(chatId, sandboxId);
      if (result) {
        await sendMessage(chatId, `✅ تم تحرير البيئة <b>${sandboxId}</b>`, {
          reply_markup: { inline_keyboard: [[{ text: '📦 البيئات', callback_data: 'sandboxes' }]] },
        });
      } else {
        await sendMessage(chatId, `❌ لم يتم العثور على البيئة ${sandboxId}`);
      }
    }
    else if (data.startsWith('kill_proc_')) {
      const pid = parseInt(data.replace('kill_proc_', ''));
      if (isNaN(pid)) {
        await sendMessage(chatId, '❌ PID غير صالح.');
        return;
      }
      const killed = killProcess(pid);
      await sendMessage(chatId, killed ? `✅ تم إيقاف العملية PID ${pid}` : `❌ لم يتم العثور على العملية PID ${pid}`);
    }

    // ─── File Browser ────────────────────────────────────
    else if (data.startsWith('browse_')) {
      await handleFileBrowse(chatId, data);
    }
  } catch (e) {
    console.error('[Callback] Error:', e);
  }
}

// ─── Message Handler ───────────────────────────────────────

async function handleMessage(msg: TelegramMessage): Promise<void> {
  const chatId = msg.chat.id;
  if (!msg.from) return;
  if (!isAllowed(msg.from)) {
    await sendMessage(chatId, '🚫 غير مصرح لك باستخدام هذا البوت.');
    return;
  }

  const text = msg.text || '';

  // ─── Handle Commands ──────────────────────────────────

  if (text.startsWith('/')) {
    const parts = text.split(' ');
    const cmdName = parts[0].substring(1).split('@')[0].toLowerCase(); // Remove / and @botname
    const args = parts.slice(1).join(' ');

    const cmd = getCommand(cmdName);
    if (cmd) {
      try {
        await cmd.handler({
          chatId,
          from: msg.from,
          sandbox: getActiveSandbox(chatId),
          operation: getOperation(chatId),
          isRunning: isRunning(chatId),
          startTime,
          args,
        });
      } catch (e) {
        console.error(`[Command] ${cmdName} error:`, e);
        await sendMessage(chatId, `❌ خطأ في تنفيذ الأمر: ${escapeHtml((e as any)?.message?.substring(0, 200))}`);
      }
      return;
    }
  }

  // ─── Handle Images/Vision ─────────────────────────────

  if (msg.photo || msg.document) {
    const sandbox = getActiveSandbox(chatId);
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
        const visionModel = sandbox?.model?.includes('4v') || sandbox?.model?.includes('5v') ? sandbox.model : 'glm-4v-flash';
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

  // ─── Text message - run agent ─────────────────────────

  if (text && !text.startsWith('/')) {
    lastUserMessage.set(chatId, text);
    await runAgent(chatId, text);
  }
}

// ─── Polling ──────────────────────────────────────────────

let pollRetryCount = 0;
let conflictCount = 0;
const MAX_CONFLICTS = 10;

async function poll(): Promise<void> {
  if (isPolling) return;
  isPolling = true;
  try {
    const result = await getUpdates(lastUpdateId + 1, 0);
    if (!result?.ok) {
      const desc = result?.description || 'Unknown';
      if (desc.includes('Conflict')) {
        conflictCount++;
        pollRetryCount++;
        if (conflictCount > MAX_CONFLICTS) {
          console.warn(`[Poll] ${conflictCount} conflicts detected. Another runner is active. Backing off 60s...`);
          await new Promise(r => setTimeout(r, 60000));
          conflictCount = 0;
        } else if (pollRetryCount > 5) {
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
    // Successful poll resets counters
    pollRetryCount = 0;
    conflictCount = 0;
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

// ─── Health Monitoring ─────────────────────────────────────

function logHealth(): void {
  const up = Math.floor((Date.now() - startTime) / 1000);
  const mem = process.memoryUsage();
  const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
  const serverInfo = IS_GITHUB_ACTIONS ? `GH Actions #${GITHUB_RUN_NUMBER}` : 'Local';
  console.log(
    `[Health] ${new Date().toISOString()} | ` +
    `Server: ${serverInfo} | ` +
    `Up: ${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m | ` +
    `Sandboxes: ${getActiveCount()}/${getMaxSandboxes()} | ` +
    `Processes: ${getAllProcesses().length} | ` +
    `Conflicts: ${conflictCount} | ` +
    `Models: ${MODELS.length} (${getFreeModels().length} free) | ` +
    `Mem: RSS=${mb(mem.rss)}MB Heap=${mb(mem.heapUsed)}/${mb(mem.heapTotal)}MB`
  );
}

// ─── Graceful Shutdown ─────────────────────────────────────

let isShuttingDown = false;

function gracefulShutdown(signal: string): void {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[Bot] ${signal} received, shutting down gracefully...`);

  // Stop idle cleanup
  stopIdleCleanup();

  // Kill all running processes
  for (const proc of getAllProcesses()) {
    try { proc.child.kill('SIGTERM'); } catch {}
  }

  console.log('[Bot] Cleanup complete. Goodbye!');
  process.exit(0);
}

// ─── Main ──────────────────────────────────────────────────

async function main() {
  console.log(`[Bot] Z.ai Agent v19.0 (GitHub Actions Only) starting...`);
  console.log(`[Bot] Server: ${IS_GITHUB_ACTIONS ? `GitHub Actions #${GITHUB_RUN_NUMBER} (Run: ${GITHUB_RUN_ID})` : 'Local (dev only)'}`);
  console.log(`[Bot] OS: ${RUNNER_OS}`);
  console.log(`[Bot] Max sandboxes: ${getMaxSandboxes()}`);
  console.log(`[Bot] Allowed users: ${ALLOWED.length > 0 ? ALLOWED.join(', ') : 'Everyone'}`);
  console.log(`[Bot] Models: ${MODELS.length} (${getFreeModels().length} free)`);

  // Test Telegram connection
  const me = await getMe();
  if (!me?.ok) { console.error('[FATAL] Bad bot token:', me?.description); process.exit(1); }
  console.log(`[Bot] Connected: @${me.result.username} (${me.result.first_name})`);

  // Test ZhipuAI API connection
  const apiTest = await testConnection();
  if (apiTest.ok) {
    console.log(`[API] ZhipuAI: ✅ Connected! Model: ${apiTest.model}`);
  } else {
    console.warn(`[API] ZhipuAI: ⚠️ ${apiTest.error}`);
    console.warn('[API] Bot will start but ZhipuAI calls may fail');
  }

  // Test OpenCode API connection
  const opencodeTest = await testOpenCodeConnection();
  if (opencodeTest.ok) {
    console.log(`[API] OpenCode: ✅ Connected! Model: ${opencodeTest.model}`);
  } else {
    console.warn(`[API] OpenCode: ⚠️ ${opencodeTest.error}`);
    console.warn('[API] OpenCode models will not be available');
  }

  await deleteWebhook();
  console.log('[Bot] Webhook deleted, starting polling...');

  // Start idle cleanup
  startIdleCleanup();

  // Poll loop — adaptive interval based on environment
  const baseInterval = IS_GITHUB_ACTIONS ? 1500 : 2000;
  const loop = () => poll().finally(() => setTimeout(loop, conflictCount > 3 ? 3000 : baseInterval));
  loop();

  // Health monitoring every 60s
  setInterval(logHealth, 60000);

  // Initial health log
  logHealth();

  // Set up command list for Telegram (optional)
  const commands = getAllCommands();
  console.log(`[Bot] Registered ${commands.length} commands: ${commands.map(c => `/${c.name}`).join(', ')}`);

  // GitHub Actions: Send startup notification to allowed user
  if (IS_GITHUB_ACTIONS) {
    console.log(`[Bot] Running on GitHub Actions — 24/7 mode active`);
  }
}

// ─── Process Event Handlers ────────────────────────────────

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Auto-restart on uncaught exceptions (with cooldown)
let lastCrash = 0;
const CRASH_COOLDOWN = 10000; // 10 seconds

process.on('uncaughtException', (e) => {
  console.error('[Uncaught]:', e);
  const now = Date.now();
  if (now - lastCrash < CRASH_COOLDOWN) {
    console.error('[Bot] Crashing too fast, giving up.');
    process.exit(1);
  }
  lastCrash = now;
  console.log('[Bot] Recovering from uncaught exception...');
});

process.on('unhandledRejection', (r) => {
  console.error('[Unhandled Rejection]:', r);
});

// Keep process alive
setInterval(() => {}, 30000);

main();
