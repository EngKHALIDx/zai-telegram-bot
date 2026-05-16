/**
 * Command Registry v18.0
 * Extensible command handler system
 * All user-facing text is in ARABIC
 */
import { sendMessage, escapeHtml } from './telegram.js';
import type { Sandbox } from './sandbox.js';
import type { ActiveOperation } from './operations.js';
import type { TrackedProcess } from './process-manager.js';

// ─── Types ────────────────────────────────────────────────

export interface BotContext {
  chatId: number;
  from?: { id?: number; first_name?: string; username?: string };
  sandbox: Sandbox | undefined;
  operation: ActiveOperation | undefined;
  isRunning: boolean;
  startTime: number;
  args: string;
}

export interface Command {
  name: string;
  description: string;
  handler: (ctx: BotContext) => Promise<void>;
  adminOnly?: boolean;
}

// ─── Registry ─────────────────────────────────────────────

const commands = new Map<string, Command>();

/**
 * Register a command.
 */
export function registerCommand(cmd: Command): void {
  commands.set(cmd.name, cmd);
}

/**
 * Get a command by name.
 */
export function getCommand(name: string): Command | undefined {
  return commands.get(name);
}

/**
 * Get all registered commands.
 */
export function getAllCommands(): Command[] {
  return Array.from(commands.values());
}

// ─── Register Built-in Commands ───────────────────────────

registerCommand({
  name: 'start',
  description: 'رسالة الترحيب والقائمة الرئيسية',
  handler: async (ctx) => {
    await sendMessage(ctx.chatId, `
🤖 <b>Z.ai Agent v18.0</b>

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
/new — مهمة جديدة (جلسة معزولة)
/model — اختيار النموذج
/think — التفكير العميق
/stop — إيقاف العملية الحالية
/status — حالة النظام
/files — تصفح ملفات المساحة
/sandboxes — عرض البيئات المعزولة
/processes — العمليات الجارية
/history — آخر الجلسات
/release — تحرير بيئة معزولة
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
          [
            { text: '📊 حالة النظام', callback_data: 'status' },
            { text: '📂 الملفات', callback_data: 'browse_root' },
          ],
          [
            { text: '📦 البيئات', callback_data: 'sandboxes' },
            { text: '📜 السجل', callback_data: 'history' },
          ],
        ],
      },
    });
  },
});

registerCommand({
  name: 'help',
  description: 'عرض المساعدة',
  handler: async (ctx) => {
    const startCmd = getCommand('start');
    if (startCmd) await startCmd.handler(ctx);
  },
});

registerCommand({
  name: 'status',
  description: 'حالة النظام',
  handler: async (ctx) => {
    const { sandbox, operation, isRunning, startTime } = ctx;
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const uptimeStr = `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`;

    // Import dynamically to avoid circular deps
    const { getActiveCount, getMaxSandboxes } = await import('./sandbox.js');
    const { getProcessCount } = await import('./process-manager.js');

    let text = `📊 <b>حالة النظام</b>\n\n`;
    text += `🟢 البوت: يعمل\n`;
    text += `⏱️ مدة التشغيل: ${uptimeStr}\n`;
    text += `🤖 النموذج: <code>${sandbox?.model || 'غير محدد'}</code>\n`;
    text += `🧠 التفكير: ${sandbox?.thinking ? '✅ مفعل' : '❌ معطل'}\n`;
    text += `📦 البيئات المعزولة: ${getActiveCount()}/${getMaxSandboxes()}\n`;
    text += `⚙️ العمليات الجارية: ${getProcessCount()}\n`;

    if (sandbox) {
      const sessionAge = Math.floor((Date.now() - sandbox.createdAt) / 60000);
      const idleTime = Math.floor((Date.now() - sandbox.lastActiveAt) / 60000);
      text += `📝 الجلسة: ${sandbox.messages.length} رسالة (${sessionAge} دقيقة)\n`;
      text += `🕐 آخر نشاط: ${idleTime}م مضت\n`;
      text += `📂 مساحة العمل: <code>${sandbox.id}</code>\n`;
    }

    text += `⏳ العمليات: ${isRunning ? '🔴 جارية' : '🟢 لا توجد'}\n`;

    if (isRunning && operation) {
      const doneCount = operation.steps.filter(s => s.status === 'done').length;
      const failCount = operation.steps.filter(s => s.status === 'failed').length;
      const elapsed = Math.floor((Date.now() - operation.startedAt) / 1000);
      text += `\n📋 <b>العملية الجارية:</b>\n`;
      text += `📝 ${escapeHtml(operation.userMessage.substring(0, 80))}\n`;
      text += `⏱️ ${elapsed}s | ✅${doneCount} ❌${failCount} / ${operation.steps.length} خطوة`;
    }

    await sendMessage(ctx.chatId, text, {
      reply_markup: isRunning ? { inline_keyboard: [[{ text: '⏹️ إيقاف', callback_data: 'stop_op' }]] } : undefined,
    });
  },
});

registerCommand({
  name: 'sandboxes',
  description: 'عرض جميع البيئات المعزولة',
  handler: async (ctx) => {
    const { listSandboxes, getActiveSandbox, getMaxSandboxes, getActiveCount } = await import('./sandbox.js');
    const sandboxList = listSandboxes(ctx.chatId);
    const active = getActiveSandbox(ctx.chatId);

    let text = `📦 <b>البيئات المعزولة</b> (${getActiveCount()}/${getMaxSandboxes()})\n\n`;

    if (sandboxList.length === 0) {
      text += `لا توجد بيئات معزولة. استخدم /new لإنشاء واحدة.\n`;
    } else {
      for (const sb of sandboxList) {
        const isActive = active?.id === sb.id;
        const age = Math.floor((Date.now() - sb.createdAt) / 60000);
        const idle = Math.floor((Date.now() - sb.lastActiveAt) / 60000);
        const msgCount = sb.messages.length;
        const procCount = sb.activeProcessPids.length;

        text += `${isActive ? '👉' : '📦'} <b>${sb.id}</b>\n`;
        text += `   ⏱️ ${age}م | 🕐 خامل: ${idle}م | 📝 ${msgCount} رسالة | ⚙️ ${procCount} عملية\n`;
        text += `   🤖 ${sb.model} | 🧠 ${sb.thinking ? 'مفعل' : 'معطل'}\n\n`;
      }
    }

    const buttons: Array<Array<{ text: string; callback_data: string }>> = [];
    for (const sb of sandboxList) {
      const isActive = active?.id === sb.id;
      buttons.push([{
        text: `${isActive ? '👉 ' : ''}${sb.id} — تحرير`,
        callback_data: `release_${sb.id}`,
      }]);
    }
    buttons.push([{ text: '🆕 بيئة جديدة', callback_data: 'new_agent' }]);

    await sendMessage(ctx.chatId, text, {
      reply_markup: { inline_keyboard: buttons },
    });
  },
});

registerCommand({
  name: 'processes',
  description: 'عرض العمليات الجارية',
  handler: async (ctx) => {
    const { getProcesses, killProcess } = await import('./process-manager.js');
    const procs = getProcesses(ctx.chatId);

    let text = `⚙️ <b>العمليات الجارية</b> (${procs.length})\n\n`;

    if (procs.length === 0) {
      text += `لا توجد عمليات جارية.\n`;
      await sendMessage(ctx.chatId, text);
      return;
    }

    const buttons: Array<Array<{ text: string; callback_data: string }>> = [];
    for (const p of procs) {
      const elapsed = Math.floor((Date.now() - p.startedAt) / 1000);
      text += `🔹 <b>PID ${p.pid}</b>\n`;
      text += `   📝 <code>${escapeHtml(p.command.substring(0, 100))}</code>\n`;
      text += `   ⏱️ ${elapsed}s\n\n`;
      buttons.push([{
        text: `⏹️ إيقاف PID ${p.pid}`,
        callback_data: `kill_proc_${p.pid}`,
      }]);
    }

    await sendMessage(ctx.chatId, text, {
      reply_markup: { inline_keyboard: buttons },
    });
  },
});

registerCommand({
  name: 'history',
  description: 'عرض آخر الجلسات',
  handler: async (ctx) => {
    const { getSessionHistory } = await import('./sandbox.js');
    const history = getSessionHistory(ctx.chatId);

    let text = `📜 <b>آخر الجلسات</b>\n\n`;

    if (history.length === 0) {
      text += `لا توجد جلسات سابقة.\n`;
    } else {
      const last5 = history.slice(-5);
      for (let i = last5.length - 1; i >= 0; i--) {
        const h = last5[i];
        const duration = Math.floor((h.endedAt - h.createdAt) / 60000);
        const timeAgo = Math.floor((Date.now() - h.endedAt) / 60000);
        text += `${i + 1}. <b>${h.id}</b> — ${duration}م (${timeAgo}م مضت)\n`;
        text += `   ${escapeHtml(h.summary.substring(0, 80))}\n\n`;
      }
    }

    await sendMessage(ctx.chatId, text, {
      reply_markup: { inline_keyboard: [[{ text: '🆕 مهمة جديدة', callback_data: 'new_agent' }]] },
    });
  },
});

registerCommand({
  name: 'files',
  description: 'تصفح ملفات المساحة',
  handler: async (ctx) => {
    const { getActiveSandbox } = await import('./sandbox.js');
    const sandbox = getActiveSandbox(ctx.chatId);
    if (!sandbox) {
      await sendMessage(ctx.chatId, '❌ لا توجد جلسة نشطة. استخدم /new أولاً.');
      return;
    }
    // Trigger the file browser callback
    await sendMessage(ctx.chatId, '📂 <b>تصفح الملفات</b>\n\nجاري التحميل...', {
      reply_markup: { inline_keyboard: [[{ text: '📂 فتح المتصفح', callback_data: 'browse_root' }]] },
    });
  },
});

registerCommand({
  name: 'release',
  description: 'تحرير بيئة معزولة',
  handler: async (ctx) => {
    const { releaseSandbox, listSandboxes, getActiveSandbox } = await import('./sandbox.js');
    const sandboxId = ctx.args.trim();

    if (sandboxId) {
      const result = releaseSandbox(ctx.chatId, sandboxId);
      if (result) {
        await sendMessage(ctx.chatId, `✅ تم تحرير البيئة <b>${sandboxId}</b>`);
      } else {
        await sendMessage(ctx.chatId, `❌ لم يتم العثور على البيئة ${sandboxId}`);
      }
    } else {
      // Show list to choose
      const sandboxList = listSandboxes(ctx.chatId);
      if (sandboxList.length === 0) {
        await sendMessage(ctx.chatId, 'ℹ️ لا توجد بيئات لتحريرها.');
        return;
      }
      const buttons = sandboxList.map(sb => [{
        text: `🗑️ تحرير ${sb.id}`,
        callback_data: `release_${sb.id}`,
      }]);
      await sendMessage(ctx.chatId, '🗑️ <b>اختر بيئة لتحريرها:</b>', {
        reply_markup: { inline_keyboard: buttons },
      });
    }
  },
});

registerCommand({
  name: 'model',
  description: 'اختيار النموذج',
  handler: async (ctx) => {
    const { getActiveSandbox } = await import('./sandbox.js');
    const sandbox = getActiveSandbox(ctx.chatId);
    const currentModel = sandbox?.model || 'glm-4-flash';

    const models = [
      { id: 'glm-4-flash', name: 'GLM-4 Flash ⚡', desc: 'سريع وفعال' },
      { id: 'glm-4-plus', name: 'GLM-4 Plus 💎', desc: 'متميز' },
      { id: 'glm-4v-flash', name: 'GLM-4V Flash 🖼️', desc: 'بصري سريع' },
      { id: 'glm-4v-plus', name: 'GLM-4V Plus 🖼️', desc: 'بصري متميز' },
      { id: 'glm-4-long', name: 'GLM-4 Long 📚', desc: 'سياق طويل' },
      { id: 'glm-4-air', name: 'GLM-4 Air 🌬️', desc: 'متوازن' },
      { id: 'glm-z1-air', name: 'GLM-Z1 Air 🧠', desc: 'تفكير' },
      { id: 'glm-z1-flash', name: 'GLM-Z1 Flash ⚡🧠', desc: 'تفكير سريع' },
    ];

    const buttons = models.map(m => [{
      text: `${m.name}${m.id === currentModel ? ' ✅' : ''} — ${m.desc}`,
      callback_data: `model_${m.id}`,
    }]);

    await sendMessage(ctx.chatId, `🌟 <b>اختيار النموذج</b>\n\nالحالي: <code>${currentModel}</code>`, {
      reply_markup: { inline_keyboard: buttons },
    });
  },
});

registerCommand({
  name: 'think',
  description: 'تفعيل/تعطيل التفكير العميق',
  handler: async (ctx) => {
    const { getActiveSandbox } = await import('./sandbox.js');
    const sandbox = getActiveSandbox(ctx.chatId);
    if (!sandbox) {
      await sendMessage(ctx.chatId, '❌ لا توجد جلسة نشطة. استخدم /new أولاً.');
      return;
    }
    sandbox.thinking = !sandbox.thinking;
    await sendMessage(ctx.chatId, `🧠 التفكير العميق: ${sandbox.thinking ? '✅ مفعل' : '❌ معطل'}`);
  },
});

registerCommand({
  name: 'stop',
  description: 'إيقاف العملية الحالية',
  handler: async (ctx) => {
    const { stopOperation } = await import('./operations.js');
    const stopped = stopOperation(ctx.chatId);
    await sendMessage(ctx.chatId, stopped ? '⏹️ تم الإيقاف' : 'ℹ️ لا توجد عملية جارية');
  },
});

registerCommand({
  name: 'reset',
  description: 'إعادة تعيين كل شيء',
  handler: async (ctx) => {
    const { releaseSandbox, listSandboxes } = await import('./sandbox.js');
    const { killAllForChat } = await import('./process-manager.js');
    const { stopOperation } = await import('./operations.js');

    // Stop any running operation
    stopOperation(ctx.chatId);

    // Kill all processes
    killAllForChat(ctx.chatId);

    // Release all sandboxes
    const sandboxes = listSandboxes(ctx.chatId);
    for (const sb of sandboxes) {
      releaseSandbox(ctx.chatId, sb.id);
    }

    await sendMessage(ctx.chatId, '🔄 تم إعادة تعيين كل شيء. استخدم /new لبدء جلسة جديدة.', {
      reply_markup: { inline_keyboard: [[{ text: '🆕 مهمة جديدة', callback_data: 'new_agent' }]] },
    });
  },
});
