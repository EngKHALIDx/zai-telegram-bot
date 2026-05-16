/**
 * Real-time Operations Display System v16.0
 * Shows what the agent is doing in real-time like chat.z.ai
 * Features: Live status, step counter, timer, stop button, throttled updates
 */
import { sendMessage, editMessageText, escapeHtml, truncateText } from './telegram.js';

export interface OperationStep {
  tool: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'stopped';
  input: string;
  output?: string;
  startedAt?: number;
  duration?: number;
}

export interface ActiveOperation {
  chatId: number;
  statusMessageId: number | null;
  steps: OperationStep[];
  status: 'running' | 'done' | 'stopped' | 'failed';
  startedAt: number;
  userMessage: string;
  abortController: AbortController;
  currentStep: number;
  lastUpdateTime: number;
  displayTimer: NodeJS.Timeout | null;
}

// Track active operations per chat
const activeOps: Map<number, ActiveOperation> = new Map();

/**
 * Start a new operation session
 */
export function startOperation(chatId: number, userMessage: string): ActiveOperation {
  stopOperation(chatId);

  const op: ActiveOperation = {
    chatId,
    statusMessageId: null,
    steps: [],
    status: 'running',
    startedAt: Date.now(),
    userMessage,
    abortController: new AbortController(),
    currentStep: 0,
    lastUpdateTime: 0,
    displayTimer: null,
  };

  activeOps.set(chatId, op);

  // Start periodic display updates while running
  op.displayTimer = setInterval(() => {
    if (op.status === 'running') {
      updateDisplay(chatId).catch(() => {});
    } else {
      if (op.displayTimer) clearInterval(op.displayTimer);
    }
  }, 3000);

  return op;
}

export function getOperation(chatId: number): ActiveOperation | undefined {
  return activeOps.get(chatId);
}

export function isRunning(chatId: number): boolean {
  const op = activeOps.get(chatId);
  return op?.status === 'running';
}

export function stopOperation(chatId: number): boolean {
  const op = activeOps.get(chatId);
  if (!op || op.status !== 'running') return false;

  op.status = 'stopped';
  if (op.displayTimer) { clearInterval(op.displayTimer); op.displayTimer = null; }
  try { op.abortController.abort(); } catch {}

  for (const step of op.steps) {
    if (step.status === 'running') step.status = 'stopped';
  }

  return true;
}

export function addStep(chatId: number, tool: string, input: string): number {
  const op = activeOps.get(chatId);
  if (!op) return -1;

  const idx = op.steps.length;
  op.steps.push({
    tool,
    status: 'running',
    input: input.substring(0, 200),
    startedAt: Date.now(),
  });
  op.currentStep = idx;
  return idx;
}

export function updateStep(chatId: number, stepIndex: number, status: OperationStep['status'], output?: string): void {
  const op = activeOps.get(chatId);
  if (!op || stepIndex >= op.steps.length) return;

  const step = op.steps[stepIndex];
  step.status = status;
  if (output) step.output = output.substring(0, 500);
  if (status === 'done' || status === 'failed' || status === 'stopped') {
    step.duration = Date.now() - (step.startedAt || Date.now());
  }
}

// ─── Display Formatting ───────────────────────────────────

function formatOperation(op: ActiveOperation): string {
  const elapsed = Math.floor((Date.now() - op.startedAt) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  const statusEmoji = op.status === 'running' ? '⏳' : op.status === 'stopped' ? '⏹️' : op.status === 'failed' ? '❌' : '✅';
  const statusText = op.status === 'running' ? 'جاري التنفيذ...' : op.status === 'stopped' ? 'تم الإيقاف' : op.status === 'failed' ? 'فشل' : 'تم الانتهاء';

  const doneCount = op.steps.filter(s => s.status === 'done').length;
  const failCount = op.steps.filter(s => s.status === 'failed').length;
  const totalCount = op.steps.length;

  let text = `${statusEmoji} <b>Agent — ${statusText}</b>\n`;
  text += `⏱️ ${timeStr} | 📊 ${doneCount}✅ ${failCount}❌ / ${totalCount} خطوة\n`;
  text += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  for (let i = 0; i < op.steps.length; i++) {
    const step = op.steps[i];
    const icon = step.status === 'running' ? '🔄' : step.status === 'done' ? '✅' : step.status === 'failed' ? '❌' : '⏹️';
    const durationStr = step.duration ? ` <code>${(step.duration / 1000).toFixed(1)}s</code>` : '';
    const toolIcon = getToolIcon(step.tool);

    text += `${icon} <b>${toolIcon} ${escapeHtml(step.tool)}</b>${durationStr}\n`;

    if (step.input) {
      text += `   📥 <code>${escapeHtml(step.input.substring(0, 80))}</code>\n`;
    }
    if (step.output && (step.status === 'done' || step.status === 'failed')) {
      const preview = step.output.substring(0, 120).replace(/\n/g, ' ');
      text += `   📤 ${escapeHtml(preview)}${step.output.length > 120 ? '…' : ''}\n`;
    }
    text += '\n';
  }

  return truncateText(text, 3800);
}

function getToolIcon(tool: string): string {
  const icons: Record<string, string> = {
    run_shell: '🖥️', install_package: '📦', create_file: '📝', create_project: '🏗️',
    push_github: '🚀', send_file: '📨', send_project_zip: '📦', web_search: '🔍',
    generate_image: '🎨', run_code: '💻', read_file: '📖', list_files: '📂', edit_file: '✏️',
  };
  return icons[tool] || '🔧';
}

function getStopButton() {
  return {
    inline_keyboard: [[{ text: '⏹️ إيقاف', callback_data: 'stop_op' }]],
  };
}

function getDoneButton() {
  return {
    inline_keyboard: [
      [
        { text: '🔄 مهمة جديدة', callback_data: 'new_agent' },
        { text: '📊 عرض النتائج', callback_data: 'show_results' },
      ],
    ],
  };
}

/**
 * Send or update the operation status message
 * Throttled to avoid Telegram API limits
 */
export async function updateDisplay(chatId: number): Promise<void> {
  const op = activeOps.get(chatId);
  if (!op) return;

  // Throttle: min 1.5s between updates
  const now = Date.now();
  if (now - op.lastUpdateTime < 1500) return;
  op.lastUpdateTime = now;

  const text = formatOperation(op);
  const replyMarkup = op.status === 'running' ? getStopButton() : getDoneButton();

  try {
    if (op.statusMessageId) {
      const result = await editMessageText(chatId, op.statusMessageId, text, { reply_markup: replyMarkup });
      if (!result?.ok) {
        // Message might be deleted or unchanged, try sending new
        if (result?.description?.includes('message is not modified')) return;
        op.statusMessageId = null;
      }
    }

    if (!op.statusMessageId) {
      const result = await sendMessage(chatId, text, { reply_markup: replyMarkup });
      if (result?.ok) {
        op.statusMessageId = result.result?.message_id;
      }
    }
  } catch (e) {
    console.error('[Display] Update error:', e);
  }
}

/**
 * Final display update when operation completes
 */
export async function finishDisplay(chatId: number, finalOutput: string): Promise<void> {
  const op = activeOps.get(chatId);
  if (!op) return;

  op.status = 'done';
  if (op.displayTimer) { clearInterval(op.displayTimer); op.displayTimer = null; }
  op.lastUpdateTime = 0; // Force update
  await updateDisplay(chatId);

  // Send final output as separate message
  if (finalOutput) {
    await sendMessage(chatId, `🤖 <b>النتيجة:</b>\n\n${truncateText(escapeHtml(finalOutput))}`, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔄 مهمة جديدة', callback_data: 'new_agent' },
            { text: '🌟 النموذج', callback_data: 'models' },
          ],
        ],
      },
    });
  }
}

/**
 * Clean up old operations
 */
export function cleanup(chatId: number): void {
  const op = activeOps.get(chatId);
  if (op && op.status !== 'running') {
    if (op.displayTimer) { clearInterval(op.displayTimer); op.displayTimer = null; }
    setTimeout(() => {
      const current = activeOps.get(chatId);
      if (current && current.status !== 'running') {
        activeOps.delete(chatId);
      }
    }, 300000); // Remove after 5 minutes
  }
}

export function getAbortSignal(chatId: number): AbortSignal | null {
  const op = activeOps.get(chatId);
  return op?.abortController?.signal || null;
}
