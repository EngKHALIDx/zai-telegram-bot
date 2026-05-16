/**
 * Real-time Operations Display System
 * Shows what the agent is doing in real-time like chat.z.ai
 * Features: Live status updates, step counter, timer, stop button
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
  messageId: number | null;
  steps: OperationStep[];
  status: 'running' | 'done' | 'stopped' | 'failed';
  startedAt: number;
  userMessage: string;
  abortController: AbortController | null;
  currentStep: number;
  lastUpdateTime: number;
}

// Track active operations per chat
const activeOps: Map<number, ActiveOperation> = new Map();

/**
 * Start a new operation session for a chat
 */
export function startOperation(chatId: number, userMessage: string): ActiveOperation {
  // Stop any existing operation
  stopOperation(chatId);

  const op: ActiveOperation = {
    chatId,
    messageId: null,
    steps: [],
    status: 'running',
    startedAt: Date.now(),
    userMessage,
    abortController: new AbortController(),
    currentStep: 0,
    lastUpdateTime: 0,
  };

  activeOps.set(chatId, op);
  return op;
}

/**
 * Get active operation for a chat
 */
export function getOperation(chatId: number): ActiveOperation | undefined {
  return activeOps.get(chatId);
}

/**
 * Check if an operation is running
 */
export function isRunning(chatId: number): boolean {
  const op = activeOps.get(chatId);
  return op?.status === 'running';
}

/**
 * Stop an operation
 */
export function stopOperation(chatId: number): boolean {
  const op = activeOps.get(chatId);
  if (!op || op.status !== 'running') return false;

  op.status = 'stopped';
  if (op.abortController) {
    try { op.abortController.abort(); } catch {}
  }

  // Mark all running steps as stopped
  for (const step of op.steps) {
    if (step.status === 'running') step.status = 'stopped';
  }

  return true;
}

/**
 * Add a new step to the operation
 */
export function addStep(chatId: number, tool: string, input: string): number {
  const op = activeOps.get(chatId);
  if (!op) return -1;

  const stepIndex = op.steps.length;
  op.steps.push({
    tool,
    status: 'running',
    input: input.substring(0, 200),
    startedAt: Date.now(),
  });
  op.currentStep = stepIndex;

  return stepIndex;
}

/**
 * Update a step's status and output
 */
export function updateStep(chatId: number, stepIndex: number, status: OperationStep['status'], output?: string): void {
  const op = activeOps.get(chatId);
  if (!op || stepIndex >= op.steps.length) return;

  const step = op.steps[stepIndex];
  step.status = status;
  if (output) step.output = output.substring(0, 500);
  if (status === 'done' || status === 'failed') {
    step.duration = Date.now() - (step.startedAt || Date.now());
  }
}

/**
 * Format the operation display like chat.z.ai agent
 */
function formatOperation(op: ActiveOperation): string {
  const elapsed = Math.floor((Date.now() - op.startedAt) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  const statusEmoji = op.status === 'running' ? '⏳' : op.status === 'stopped' ? '⏹️' : '✅';
  const statusText = op.status === 'running' ? 'جاري التنفيذ...' : op.status === 'stopped' ? 'تم الإيقاف' : 'تم الانتهاء';

  let text = `${statusEmoji} <b>Agent - ${statusText}</b>\n`;
  text += `⏱️ ${timeStr} | 📝 الخطوة ${op.currentStep + 1}/${op.steps.length}\n`;
  text += `─────────────────────\n\n`;

  for (let i = 0; i < op.steps.length; i++) {
    const step = op.steps[i];
    const stepEmoji = step.status === 'running' ? '🔄' : step.status === 'done' ? '✅' : step.status === 'failed' ? '❌' : '⏹️';
    const durationStr = step.duration ? ` (${(step.duration / 1000).toFixed(1)}s)` : '';
    const toolIcon = getToolIcon(step.tool);

    text += `${stepEmoji} <b>${toolIcon} ${escapeHtml(step.tool)}</b>${durationStr}\n`;

    if (step.input) {
      text += `   📥 <code>${escapeHtml(step.input.substring(0, 100))}</code>\n`;
    }
    if (step.output && (step.status === 'done' || step.status === 'failed')) {
      const outPreview = step.output.substring(0, 150).replace(/\n/g, ' ');
      text += `   📤 ${escapeHtml(outPreview)}${step.output.length > 150 ? '...' : ''}\n`;
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

/**
 * Get the stop button markup
 */
function getStopButton(): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
  return {
    inline_keyboard: [
      [{ text: '⏹️ إيقاف', callback_data: 'stop_op' }],
    ],
  };
}

function getDoneButton(): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
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
 * Throttled to avoid Telegram API limits (max 1 update per 1.5s)
 */
export async function updateDisplay(chatId: number): Promise<void> {
  const op = activeOps.get(chatId);
  if (!op) return;

  // Throttle updates
  const now = Date.now();
  if (now - op.lastUpdateTime < 1500) return;
  op.lastUpdateTime = now;

  const text = formatOperation(op);
  const replyMarkup = op.status === 'running' ? getStopButton() : getDoneButton();

  try {
    if (op.messageId) {
      const result = await editMessageText(chatId, op.messageId, text, { reply_markup: replyMarkup });
      if (!result?.ok) {
        // Message might be too old or deleted, send new one
        op.messageId = null;
      }
    }

    if (!op.messageId) {
      const result = await sendMessage(chatId, text, { reply_markup: replyMarkup });
      if (result?.ok) {
        op.messageId = result.result?.message_id;
      }
    }
  } catch (e) {
    console.error('[Display] Update error:', e);
  }
}

/**
 * Final update when operation completes
 */
export async function finishDisplay(chatId: number, finalOutput: string): Promise<void> {
  const op = activeOps.get(chatId);
  if (!op) return;

  op.status = 'done';
  op.lastUpdateTime = 0; // Force update
  await updateDisplay(chatId);

  // Send final output as separate message
  if (finalOutput) {
    await sendMessage(chatId, `🤖 <b>النتيجة النهائية:</b>\n\n${truncateText(finalOutput)}`, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔄 مهمة جديدة', callback_data: 'new_agent' },
            { text: '📋 سجل المهام', callback_data: 'history' },
          ],
        ],
      },
    });
  }
}

/**
 * Clean up old operations (keep last 10 per chat)
 */
export function cleanup(chatId: number): void {
  // Just remove the current operation when done
  const op = activeOps.get(chatId);
  if (op && op.status !== 'running') {
    // Keep it for a bit so user can see results, then clean
    setTimeout(() => {
      const current = activeOps.get(chatId);
      if (current && current.status !== 'running') {
        activeOps.delete(chatId);
      }
    }, 300000); // Remove after 5 minutes
  }
}

/**
 * Get the AbortSignal for the current operation
 */
export function getAbortSignal(chatId: number): AbortSignal | null {
  const op = activeOps.get(chatId);
  return op?.abortController?.signal || null;
}
