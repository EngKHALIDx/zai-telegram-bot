/**
 * Command Registry v19.0
 * Extensible command handler system with full model catalog
 * All user-facing text is in ARABIC
 */
import { sendMessage, escapeHtml } from './telegram.js';
import type { Sandbox } from './sandbox.js';
import type { ActiveOperation } from './operations.js';
import { MODELS, getModel, getModelOrDefault, getModelsByCategory, getFreeModels, getCategoryLabel, MODEL_CATEGORIES, type ModelDefinition } from './models.js';

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
    const freeCount = getFreeModels().length;
    const totalModels = MODELS.length;
    await sendMessage(ctx.chatId, `
🤖 <b>Z.ai Agent v19.0</b> — 🐧 بيئة لينكس | ☁️ GitHub Actions

أنا وكيل ذكي يعمل في بيئة لينكس حقيقية على GitHub Actions!
أستطيع تنفيذ أوامر Bash، بناء تطبيقات، كتابة كود، بحث الويب، وأكثر.

🐧 <b>بيئة لينكس:</b>
• أوامر Bash تنفذ في /bin/bash login shell
• أدوات: python3, node, npm, pip3, git, curl, wget, gcc...
• تثبيت حزم: apt-get, npm, pip3
• كل جلسة لها مساحة عمل معزولة

☁️ <b>التشغيل:</b>
• يعمل على GitHub Actions 24/7 فقط
• إعادة تشغيل تلقائية عبر Cron كل 5 ساعات
• مساحة عمل مستقرة بين التشغيلات (Artifacts)

🤖 <b>النماذج:</b> ${totalModels} نموذج (${freeCount} مجاني)
• 🆓 OpenCode: big-pickle, deepseek-v4-flash, minimax-m2.5, nemotron-3
• 🆓 ZhipuAI: glm-4-flash, glm-4.5-flash, glm-4.7-flash
• 💎 متقدم: glm-5.1, glm-5, glm-4.7, glm-4-plus
• 🖼️ بصري: glm-4v-flash, glm-4v-plus, glm-5v-turbo
• 🧠 استدلال: glm-z1-air, glm-z1-flash, glm-4.5

🏗️ <b>ما يمكنني فعله:</b>
• بناء مواقع وتطبيقات كاملة
• إنشاء مشاريع ورفعها على GitHub
• كتابة وتنفيذ كود JavaScript/Python/Bash
• بحث في الويب وإنشاء صور بالذكاء الاصطناعي
• تنفيذ أوامر Shell في بيئة لينكس
• تثبيت أي حزمة عبر apt/npm/pip

📋 <b>الأوامر:</b>
/new — مهمة جديدة (جلسة معزولة)
/model — اختيار النموذج (${totalModels} نموذج)
/providers — عرض المزودين
/think — التفكير العميق
/stop — إيقاف العملية الحالية
/status — حالة النظام
/linux — معلومات بيئة لينكس
/servers — معلومات السيرفر
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
            { text: '🐧 لينكس', callback_data: 'linux_info' },
          ],
          [
            { text: '☁️ السيرفر', callback_data: 'server_info' },
            { text: '📂 الملفات', callback_data: 'browse_root' },
          ],
          [
            { text: '📡 المزودين', callback_data: 'providers' },
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

    const isGH = !!process.env.GITHUB_ACTIONS;
    const runNum = process.env.GITHUB_RUN_NUMBER || '-';
    const runId = process.env.GITHUB_RUN_ID || '-';
    const workflow = process.env.GITHUB_WORKFLOW || '-';

    let text = `📊 <b>حالة النظام</b>\n\n`;
    text += `🟢 البوت: يعمل\n`;
    text += `☁️ السيرفر: ${isGH ? `GitHub Actions` : 'محلي (تجريبي)'}\n`;
    if (isGH) {
      text += `📋 Workflow: <code>${escapeHtml(workflow)}</code>\n`;
      text += `🔢 Run: #${runNum} (${runId.substring(0, 8)})\n`;
    }
    text += `⏱️ مدة التشغيل: ${uptimeStr}\n`;
    text += `🤖 النموذج: <code>${sandbox?.model || 'غير محدد'}</code>\n`;

    // Show model provider
    const modelDef = getModel(sandbox?.model || '');
    if (modelDef) {
      const providerName = modelDef.provider === 'opencode' ? 'OpenCode' : 'ZhipuAI';
      text += `📡 المزود: ${providerName} ${modelDef.free ? '🆓' : '💎'}\n`;
    }

    text += `🧠 التفكير: ${sandbox?.thinking ? '✅ مفعل' : '❌ معطل'}\n`;
    text += `📦 البيئات المعزولة: ${getActiveCount()}/${getMaxSandboxes()}\n`;
    text += `🐧 بيئة لينكس: ${sandbox?.linuxReady ? '✅ جاهزة' : '❌ غير جاهزة'}\n`;
    text += `⚙️ العمليات الجارية: ${getProcessCount()}\n`;
    text += `🤖 النماذج المتاحة: ${MODELS.length} (${getFreeModels().length} مجاني)\n`;

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
  name: 'providers',
  description: 'عرض مزودي API المتاحين',
  handler: async (ctx) => {
    const { testOpenCodeConnection } = await import('./zai.js');

    const opencodeKey = process.env.OPENCODE_API_KEY ? '✅' : '❌';
    const zhipuaiKey = process.env.ZAI_API_KEY ? '✅' : '❌';

    let text = `📡 <b>مزودو API</b>\n\n`;

    text += `🆓 <b>OpenCode Zen</b>\n`;
    text += `   URL: <code>${process.env.OPENCODE_BASE_URL || 'https://opencode.ai/api/v1'}</code>\n`;
    text += `   المفتاح: ${opencodeKey}\n`;
    const opencodeModels = MODELS.filter(m => m.provider === 'opencode');
    text += `   النماذج: ${opencodeModels.map(m => m.id).join(', ')}\n`;
    text += `   مجاني: ${opencodeModels.filter(m => m.free).length}/${opencodeModels.length}\n\n`;

    text += `🇨🇳 <b>ZhipuAI (智谱AI)</b>\n`;
    text += `   URL: <code>${process.env.ZAI_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4'}</code>\n`;
    text += `   المفتاح: ${zhipuaiKey}\n`;
    const zhipuModels = MODELS.filter(m => m.provider === 'zhipuai' || m.provider === 'zhipuai-coding');
    text += `   النماذج: ${zhipuModels.length}\n`;
    text += `   مجاني: ${zhipuModels.filter(m => m.free).length}/${zhipuModels.length}\n\n`;

    text += `📊 <b>الإجمالي:</b> ${MODELS.length} نموذج (${getFreeModels().length} مجاني)\n`;

    await sendMessage(ctx.chatId, text, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🌟 اختيار النموذج', callback_data: 'models' }],
          [{ text: '📊 حالة النظام', callback_data: 'status' }],
        ],
      },
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

    // Build categorized model list
    const buttons: Array<Array<{ text: string; callback_data: string }>> = [];

    for (const category of MODEL_CATEGORIES) {
      const models = getModelsByCategory(category.key);
      if (models.length === 0) continue;

      // Category header button (non-functional, just for display)
      buttons.push([{
        text: `${category.emoji} ── ${category.label} ──`,
        callback_data: 'noop',
      }]);

      for (const m of models) {
        const isActive = m.id === currentModel;
        const freeBadge = m.free ? '🆓' : '💎';
        const providerBadge = m.provider === 'opencode' ? '📡' : '🇨🇳';
        buttons.push([{
          text: `${isActive ? '✅ ' : '   '}${freeBadge} ${providerBadge} ${m.name} — ${m.description}${isActive ? ' ◀️' : ''}`,
          callback_data: `model_${m.id}`,
        }]);
      }
    }

    await sendMessage(ctx.chatId, `🌟 <b>اختيار النموذج</b> (${MODELS.length} نموذج)\n\nالحالي: <code>${currentModel}</code>\n\n🆓 = مجاني | 💎 = مدفوع | 📡 = OpenCode | 🇨🇳 = ZhipuAI`, {
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

registerCommand({
  name: 'linux',
  description: 'معلومات بيئة لينكس المتاحة',
  handler: async (ctx) => {
    const { execSync } = await import('child_process');
    const LINUX_ENV = {
      PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin',
      HOME: '/home/z',
      DEBIAN_FRONTEND: 'noninteractive',
    };

    let text = `🐧 <b>بيئة لينكس</b>\n\n`;

    // OS info
    try {
      const os = execSync('cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d \'"\'', { encoding: 'utf-8', env: LINUX_ENV }).trim();
      text += `💻 النظام: ${escapeHtml(os)}\n`;
    } catch { text += `💻 النظام: Linux\n`; }

    // Kernel
    try {
      const kernel = execSync('uname -r', { encoding: 'utf-8', env: LINUX_ENV }).trim();
      text += `🔬 النواة: ${kernel}\n`;
    } catch {}

    // Arch
    try {
      const arch = execSync('uname -m', { encoding: 'utf-8', env: LINUX_ENV }).trim();
      text += `🏗️ المعالج: ${arch}\n`;
    } catch {}

    // Memory
    try {
      const mem = execSync('free -h --si 2>/dev/null | grep Mem | awk \'{print $2 " / " $3 " مستخدم / " $4 " متاح"}\'', { encoding: 'utf-8', env: LINUX_ENV }).trim();
      text += `💾 الذاكرة: ${mem}\n`;
    } catch {}

    // CPU
    try {
      const cpus = execSync('nproc', { encoding: 'utf-8', env: LINUX_ENV }).trim();
      text += `⚡ الأنوية: ${cpus}\n`;
    } catch {}

    // Disk
    try {
      const disk = execSync('df -h / --output=size,used,avail 2>/dev/null | tail -1 | awk \'{print $1 " (مستخدم: " $2 " / متاح: " $3 ")"}\'', { encoding: 'utf-8', env: LINUX_ENV }).trim();
      text += `💿 القرص: ${disk}\n`;
    } catch {}

    // Available tools
    text += `\n🔧 <b>الأدوات المتاحة:</b>\n`;
    const tools = [
      { cmd: 'python3', label: '🐍 Python' },
      { cmd: 'node', label: '🟢 Node.js' },
      { cmd: 'npm', label: '📦 npm' },
      { cmd: 'pip3', label: '📦 pip3' },
      { cmd: 'git', label: '🔀 Git' },
      { cmd: 'curl', label: '🌐 curl' },
      { cmd: 'wget', label: '📥 wget' },
      { cmd: 'gcc', label: '⚙️ GCC' },
      { cmd: 'g++', label: '⚙️ G++' },
      { cmd: 'make', label: '🔨 Make' },
      { cmd: 'docker', label: '🐳 Docker' },
      { cmd: 'ffmpeg', label: '🎬 FFmpeg' },
      { cmd: 'convert', label: '🖼️ ImageMagick' },
      { cmd: 'java', label: '☕ Java' },
      { cmd: 'go', label: '🔵 Go' },
      { cmd: 'rustc', label: '🦀 Rust' },
      { cmd: 'cargo', label: '📦 Cargo' },
    ];

    const available: string[] = [];
    const unavailable: string[] = [];
    for (const tool of tools) {
      try {
        execSync(`which ${tool.cmd} 2>/dev/null`, { encoding: 'utf-8', env: LINUX_ENV, timeout: 2000 });
        available.push(tool.label);
      } catch {
        unavailable.push(tool.label);
      }
    }
    text += `  ✅ ${available.join(' | ')}\n`;
    if (unavailable.length > 0) {
      text += `  ❌ ${unavailable.join(' | ')}\n`;
    }

    // Versions
    text += `\n📊 <b>الإصدارات:</b>\n`;
    try { const v = execSync('python3 --version 2>&1', { encoding: 'utf-8', env: LINUX_ENV }).trim(); text += `  ${v}\n`; } catch {}
    try { const v = execSync('node --version 2>&1', { encoding: 'utf-8', env: LINUX_ENV }).trim(); text += `  Node.js ${v}\n`; } catch {}
    try { const v = execSync('npm --version 2>&1', { encoding: 'utf-8', env: LINUX_ENV }).trim(); text += `  npm ${v}\n`; } catch {}
    try { const v = execSync('git --version 2>&1', { encoding: 'utf-8', env: LINUX_ENV }).trim(); text += `  ${v}\n`; } catch {}
    try { const v = execSync('gcc --version 2>&1 | head -1', { encoding: 'utf-8', env: LINUX_ENV }).trim(); text += `  ${v}\n`; } catch {}

    text += `\n💡 <b>تثبيت حزم جديدة:</b>\n`;
    text += `<code>apt-get install -y ffmpeg</code> — حزم النظام\n`;
    text += `<code>npm install express</code> — حزم Node.js\n`;
    text += `<code>pip3 install --user requests</code> — حزم Python\n`;

    await sendMessage(ctx.chatId, text, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔄 تحديث', callback_data: 'linux_info' }],
          [{ text: '🆕 مهمة جديدة', callback_data: 'new_agent' }],
        ],
      },
    });
  },
});

registerCommand({
  name: 'servers',
  description: 'معلومات السيرفر (GitHub Actions)',
  handler: async (ctx) => {
    const { execSync } = await import('child_process');

    const isGH = !!process.env.GITHUB_ACTIONS;
    const runNum = process.env.GITHUB_RUN_NUMBER || '-';
    const runId = process.env.GITHUB_RUN_ID || '-';
    const workflow = process.env.GITHUB_WORKFLOW || '-';
    const actor = process.env.GITHUB_ACTOR || '-';
    const repository = process.env.GITHUB_REPOSITORY || '-';
    const ref = process.env.GITHUB_REF || '-';
    const sha = process.env.GITHUB_SHA ? process.env.GITHUB_SHA.substring(0, 7) : '-';
    const runnerOS = process.env.RUNNER_OS || process.env.OS || 'Linux';
    const runnerArch = process.env.RUNNER_ARCH || 'X64';

    let text = `☁️ <b>معلومات السيرفر</b>\n\n`;

    text += `🖥️ <b>نوع التشغيل:</b> ${isGH ? 'GitHub Actions ☁️' : 'محلي (تجريبي) 🏠'}\n\n`;

    if (isGH) {
      text += `📋 <b>Workflow:</b> <code>${escapeHtml(workflow)}</code>\n`;
      text += `🔢 <b>Run:</b> #${runNum}\n`;
      text += `🆔 <b>Run ID:</b> <code>${runId}</code>\n`;
      text += `👤 <b>Actor:</b> <code>${escapeHtml(actor)}</code>\n`;
      text += `📁 <b>Repository:</b> <code>${escapeHtml(repository)}</code>\n`;
      text += `🌿 <b>Branch:</b> <code>${escapeHtml(ref.replace('refs/heads/', ''))}</code>\n`;
      text += `📝 <b>Commit:</b> <code>${sha}</code>\n`;
      text += `💻 <b>OS:</b> ${runnerOS} (${runnerArch})\n`;
    } else {
      text += `⚠️ البوت لا يعمل على GitHub Actions حالياً\n`;
      text += `يعمل في وضع تجريبي محلي\n`;
    }

    // System info
    text += `\n📊 <b>معلومات النظام:</b>\n`;
    try {
      const osInfo = execSync('cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d \'"\'', { encoding: 'utf-8' }).trim();
      text += `💻 النظام: ${escapeHtml(osInfo)}\n`;
    } catch { text += `💻 النظام: Linux\n`; }
    try {
      const kernel = execSync('uname -r', { encoding: 'utf-8' }).trim();
      text += `🔬 النواة: ${kernel}\n`;
    } catch {}
    try {
      const cpus = execSync('nproc', { encoding: 'utf-8' }).trim();
      text += `⚡ الأنوية: ${cpus}\n`;
    } catch {}
    try {
      const mem = execSync('free -h --si 2>/dev/null | grep Mem | awk \'{print $2}\'', { encoding: 'utf-8' }).trim();
      text += `💾 الذاكرة: ${mem}\n`;
    } catch {}
    try {
      const disk = execSync('df -h / --output=size,avail 2>/dev/null | tail -1', { encoding: 'utf-8' }).trim();
      text += `💿 القرص: ${disk.replace(/\s+/, ' (متاح: ')} )\n`;
    } catch {}

    // Node info
    try {
      const nodeVer = execSync('node --version', { encoding: 'utf-8' }).trim();
      text += `🟢 Node.js: ${nodeVer}\n`;
    } catch {}

    text += `\n⏱️ <b>مدة التشغيل الحالية:</b> ${Math.floor((Date.now() - ctx.startTime) / 60000)} دقيقة\n`;

    await sendMessage(ctx.chatId, text, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔄 تحديث', callback_data: 'server_info' }],
          [{ text: '📊 حالة النظام', callback_data: 'status' }],
          [{ text: '🐧 لينكس', callback_data: 'linux_info' }],
        ],
      },
    });
  },
});
