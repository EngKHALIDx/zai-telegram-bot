/**
 * Real-time Operations Display System v18.0
 * Enhanced with streaming output, progress bar, per-step timer, and chat.z.ai style UX
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
  streamingOutput: string;
  totalStepsEstimate: number;
}

const activeOps: Map<number, ActiveOperation> = new Map();

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
    streamingOutput: '',
    totalStepsEstimate: 0,
  };

  activeOps.set(chatId, op);

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
  op.streamingOutput = ''; // Reset streaming for new step
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

/**
 * Set streaming output for the current step (used by run_shell to show partial output).
 */
export function setStreamingOutput(chatId: number, output: string): void {
  const op = activeOps.get(chatId);
  if (op && op.status === 'running') {
    op.streamingOutput = output;
  }
}

/**
 * Set estimated total steps for progress bar.
 */
export function setTotalStepsEstimate(chatId: number, total: number): void {
  const op = activeOps.get(chatId);
  if (op) op.totalStepsEstimate = total;
}

// ─── Progress Bar ─────────────────────────────────────────

function progressBar(done: number, total: number, width = 10): string {
  if (total <= 0) return '';
  const filled = Math.min(Math.round((done / total) * width), width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

// ─── Display ──────────────────────────────────────────────

function formatOperation(op: ActiveOperation): string {
  const elapsed = Math.floor((Date.now() - op.startedAt) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  const statusEmoji = op.status === 'running' ? '⏳' : op.status === 'stopped' ? '⏹️' : op.status === 'failed' ? '❌' : '✅';
  const statusText = op.status === 'running' ? 'جاري التنفيذ...' : op.status === 'stopped' ? 'تم الإيقاف' : op.status === 'failed' ? 'فشل' : 'تم الانتهاء';

  const doneCount = op.steps.filter(s => s.status === 'done').length;
  const failCount = op.steps.filter(s => s.status === 'failed').length;
  const runningCount = op.steps.filter(s => s.status === 'running').length;
  const totalCount = op.steps.length;

  // Progress bar
  const total = Math.max(op.totalStepsEstimate, totalCount);
  const bar = total > 0 ? progressBar(doneCount + failCount, total) : '';
  const progressStr = bar ? `${bar} ${doneCount + failCount}/${total} خطوات` : '';

  let text = `${statusEmoji} <b>Agent — ${statusText}</b>\n`;
  text += `⏱️ ${timeStr} | 📊 ${doneCount}✅ ${failCount}❌ / ${totalCount} خطوة`;
  if (progressStr) text += `\n📊 ${progressStr}`;
  text += `\n━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Show steps (last 6 for space)
  const startIdx = Math.max(0, op.steps.length - 6);
  for (let i = startIdx; i < op.steps.length; i++) {
    const step = op.steps[i];
    const icon = step.status === 'running' ? '🔄' : step.status === 'done' ? '✅' : step.status === 'failed' ? '❌' : '⏹️';

    // Per-step timer
    let durationStr = '';
    if (step.status === 'running' && step.startedAt) {
      const stepElapsed = Math.floor((Date.now() - step.startedAt) / 1000);
      durationStr = ` <code>${stepElapsed}s</code>`;
    } else if (step.duration) {
      durationStr = ` <code>${(step.duration / 1000).toFixed(1)}s</code>`;
    }

    const toolIcon = getToolIcon(step.tool);
    text += `${icon} <b>${toolIcon} ${escapeHtml(step.tool)}</b>${durationStr}\n`;

    if (step.input) {
      text += `   📥 <code>${escapeHtml(step.input.substring(0, 80))}</code>\n`;
    }

    // Show streaming output for running steps
    if (step.status === 'running' && op.streamingOutput) {
      const streamPreview = op.streamingOutput.substring(op.streamingOutput.length - 200).replace(/\n/g, ' ');
      text += `   📡 <code>${escapeHtml(streamPreview)}</code>\n`;
    } else if (step.output && (step.status === 'done' || step.status === 'failed')) {
      const preview = step.output.substring(0, 120).replace(/\n/g, ' ');
      text += `   📤 ${escapeHtml(preview)}${step.output.length > 120 ? '…' : ''}\n`;
    }
    text += '\n';
  }

  if (startIdx > 0) {
    text += `   ... و ${startIdx} خطوة سابقة\n`;
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

export async function updateDisplay(chatId: number): Promise<void> {
  const op = activeOps.get(chatId);
  if (!op) return;

  const now = Date.now();
  if (now - op.lastUpdateTime < 1500) return;
  op.lastUpdateTime = now;

  const text = formatOperation(op);
  const replyMarkup = op.status === 'running'
    ? { inline_keyboard: [[{ text: '⏹️ إيقاف', callback_data: 'stop_op' }]] }
    : { inline_keyboard: [
        [{ text: '🔄 مهمة جديدة', callback_data: 'new_agent' }, { text: '📊 النتائج', callback_data: 'show_results' }],
        [{ text: '🌟 النموذج', callback_data: 'models' }],
      ] };

  try {
    if (op.statusMessageId) {
      const result = await editMessageText(chatId, op.statusMessageId, text, { reply_markup: replyMarkup });
      if (!result?.ok) {
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

export async function finishDisplay(chatId: number, finalOutput: string): Promise<void> {
  const op = activeOps.get(chatId);
  if (!op) return;

  op.status = 'done';
  op.streamingOutput = '';
  if (op.displayTimer) { clearInterval(op.displayTimer); op.displayTimer = null; }
  op.lastUpdateTime = 0;
  await updateDisplay(chatId);

  if (finalOutput) {
    await sendMessage(chatId, `🤖 <b>النتيجة:</b>\n\n${truncateText(escapeHtml(finalOutput))}`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔄 مهمة جديدة', callback_data: 'new_agent' }, { text: '🌟 النموذج', callback_data: 'models' }],
        ],
      },
    });
  }
}

export function cleanup(chatId: number): void {
  const op = activeOps.get(chatId);
  if (op && op.status !== 'running') {
    if (op.displayTimer) { clearInterval(op.displayTimer); op.displayTimer = null; }
    setTimeout(() => {
      const current = activeOps.get(chatId);
      if (current && current.status !== 'running') {
        activeOps.delete(chatId);
      }
    }, 300000);
  }
}

export function getAbortSignal(chatId: number): AbortSignal | null {
  const op = activeOps.get(chatId);
  return op?.abortController?.signal || null;
}
