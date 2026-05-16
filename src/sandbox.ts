/**
 * Sandbox & Session Management v18.0
 * Isolated Agent sessions with concurrency limits, idle cleanup, and per-session workspaces
 */
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import type { ChatMessage } from './zai.js';
import { getAgentSystemPrompt } from './tools.js';

// ─── Configuration ────────────────────────────────────────

const MAX_SANDBOXES = parseInt(process.env.MAX_SANDBOXES || '3');
const IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
const WORKSPACE_ROOT = join(process.cwd(), 'workspace');

// ─── Types ────────────────────────────────────────────────

export interface Sandbox {
  id: string;
  chatId: number;
  workDir: string;
  messages: ChatMessage[];
  model: string;
  thinking: boolean;
  createdAt: number;
  lastActiveAt: number;
  activeProcessPids: number[];
  summary?: string;
}

// ─── Storage ──────────────────────────────────────────────

const sandboxes: Map<string, Sandbox> = new Map();
// Map chatId -> active sandbox id (each chat has one "current" sandbox)
const chatActiveSandbox: Map<number, string> = new Map();
// Session history for /history command
const sessionHistory: Map<number, Array<{ id: string; summary: string; createdAt: number; endedAt: number }>> = new Map();

let cleanupTimer: NodeJS.Timeout | null = null;

// ─── Helpers ──────────────────────────────────────────────

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

// ─── Core Functions ───────────────────────────────────────

/**
 * Create a new isolated sandbox for a chat.
 * Returns the new sandbox or null if concurrency limit exceeded.
 */
export function createSandbox(chatId: number): Sandbox | null {
  // Check concurrency limit
  const currentCount = getActiveCount();
  if (currentCount >= MAX_SANDBOXES) {
    return null; // Limit exceeded
  }

  // Archive the current sandbox if one exists
  const currentId = chatActiveSandbox.get(chatId);
  if (currentId) {
    archiveSandbox(chatId, currentId);
  }

  const id = generateId();
  const workDir = join(WORKSPACE_ROOT, id);

  // Create workspace directory
  if (!existsSync(workDir)) {
    mkdirSync(workDir, { recursive: true });
  }

  const sandbox: Sandbox = {
    id,
    chatId,
    workDir,
    messages: [{ role: 'system', content: getAgentSystemPrompt() }],
    model: process.env.DEFAULT_MODEL || 'glm-4-flash',
    thinking: false,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    activeProcessPids: [],
  };

  sandboxes.set(id, sandbox);
  chatActiveSandbox.set(chatId, id);

  console.log(`[Sandbox] Created ${id} for chat ${chatId} (workDir: ${workDir})`);
  return sandbox;
}

/**
 * Get the active sandbox for a chat, or create one if none exists.
 */
export function getOrCreateSandbox(chatId: number): Sandbox {
  const activeId = chatActiveSandbox.get(chatId);
  if (activeId) {
    const sb = sandboxes.get(activeId);
    if (sb) {
      sb.lastActiveAt = Date.now();
      return sb;
    }
  }
  // Create a new one (bypasses limit check for first sandbox per chat)
  const newSb = createSandbox(chatId);
  if (!newSb) {
    // Shouldn't happen for first sandbox, but fallback: force create
    const id = generateId();
    const workDir = join(WORKSPACE_ROOT, id);
    if (!existsSync(workDir)) mkdirSync(workDir, { recursive: true });
    const sandbox: Sandbox = {
      id, chatId, workDir,
      messages: [{ role: 'system', content: getAgentSystemPrompt() }],
      model: process.env.DEFAULT_MODEL || 'glm-4-flash',
      thinking: false,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      activeProcessPids: [],
    };
    sandboxes.set(id, sandbox);
    chatActiveSandbox.set(chatId, id);
    return sandbox;
  }
  return newSb;
}

/**
 * Get the active sandbox for a chat (returns undefined if none).
 */
export function getActiveSandbox(chatId: number): Sandbox | undefined {
  const activeId = chatActiveSandbox.get(chatId);
  if (!activeId) return undefined;
  const sb = sandboxes.get(activeId);
  if (sb) sb.lastActiveAt = Date.now();
  return sb;
}

/**
 * Get a specific sandbox by ID.
 */
export function getSandboxById(id: string): Sandbox | undefined {
  return sandboxes.get(id);
}

/**
 * Release a sandbox by ID or the active one for a chat.
 */
export function releaseSandbox(chatId: number, sandboxId?: string): boolean {
  const targetId = sandboxId || chatActiveSandbox.get(chatId);
  if (!targetId) return false;

  const sb = sandboxes.get(targetId);
  if (!sb) return false;

  // Archive before releasing
  archiveSandbox(chatId, targetId);

  // Remove workspace directory
  try {
    if (existsSync(sb.workDir)) {
      rmSync(sb.workDir, { recursive: true, force: true });
    }
  } catch (e) {
    console.error(`[Sandbox] Error removing workspace ${sb.workDir}:`, e);
  }

  sandboxes.delete(targetId);

  // Clear active mapping if this was the active one
  if (chatActiveSandbox.get(chatId) === targetId) {
    chatActiveSandbox.delete(chatId);
  }

  console.log(`[Sandbox] Released ${targetId} for chat ${chatId}`);
  return true;
}

/**
 * List all sandboxes for a chat.
 */
export function listSandboxes(chatId: number): Sandbox[] {
  const result: Sandbox[] = [];
  for (const sb of sandboxes.values()) {
    if (sb.chatId === chatId) {
      result.push(sb);
    }
  }
  return result;
}

/**
 * Get all sandboxes (for admin/status).
 */
export function getAllSandboxes(): Sandbox[] {
  return Array.from(sandboxes.values());
}

/**
 * Get number of active sandboxes.
 */
export function getActiveCount(): number {
  return sandboxes.size;
}

/**
 * Get the max sandbox limit.
 */
export function getMaxSandboxes(): number {
  return MAX_SANDBOXES;
}

/**
 * Check if a chat can create a new sandbox.
 */
export function canCreateSandbox(): boolean {
  return getActiveCount() < MAX_SANDBOXES;
}

/**
 * Switch active sandbox for a chat.
 */
export function switchSandbox(chatId: number, sandboxId: string): boolean {
  const sb = sandboxes.get(sandboxId);
  if (!sb || sb.chatId !== chatId) return false;
  chatActiveSandbox.set(chatId, sandboxId);
  sb.lastActiveAt = Date.now();
  console.log(`[Sandbox] Switched chat ${chatId} to sandbox ${sandboxId}`);
  return true;
}

/**
 * Get session history for a chat.
 */
export function getSessionHistory(chatId: number): Array<{ id: string; summary: string; createdAt: number; endedAt: number }> {
  return sessionHistory.get(chatId) || [];
}

/**
 * Archive a sandbox to history before release/reset.
 */
function archiveSandbox(chatId: number, sandboxId: string): void {
  const sb = sandboxes.get(sandboxId);
  if (!sb) return;

  // Generate a brief summary from the last assistant message
  const lastAssistant = [...sb.messages].reverse().find(m => m.role === 'assistant');
  const summary = lastAssistant?.content?.substring(0, 200) || 'جلسة بدون ملخص';

  if (!sessionHistory.has(chatId)) {
    sessionHistory.set(chatId, []);
  }
  const history = sessionHistory.get(chatId)!;
  history.push({
    id: sandboxId,
    summary: summary.substring(0, 200),
    createdAt: sb.createdAt,
    endedAt: Date.now(),
  });

  // Keep only last 10 entries
  while (history.length > 10) {
    history.shift();
  }
}

// ─── Idle Cleanup ─────────────────────────────────────────

/**
 * Start the idle sandbox cleanup timer.
 * Auto-releases sandboxes idle for > IDLE_TIMEOUT.
 */
export function startIdleCleanup(): void {
  if (cleanupTimer) return;

  cleanupTimer = setInterval(() => {
    const now = Date.now();
    const toRelease: string[] = [];

    for (const [id, sb] of sandboxes) {
      if (now - sb.lastActiveAt > IDLE_TIMEOUT && sb.activeProcessPids.length === 0) {
        toRelease.push(id);
      }
    }

    for (const id of toRelease) {
      const sb = sandboxes.get(id);
      if (sb) {
        console.log(`[Sandbox] Auto-releasing idle sandbox ${id} (idle for ${Math.floor((now - sb.lastActiveAt) / 60000)}m)`);
        releaseSandbox(sb.chatId, id);
      }
    }

    // Memory: trim session histories that are too old
    for (const [chatId, history] of sessionHistory) {
      const cutoff = now - 24 * 60 * 60 * 1000; // 24h
      const trimmed = history.filter(h => h.endedAt > cutoff);
      if (trimmed.length !== history.length) {
        sessionHistory.set(chatId, trimmed);
      }
    }
  }, 5 * 60 * 1000); // Check every 5 minutes

  console.log(`[Sandbox] Idle cleanup started (timeout: ${IDLE_TIMEOUT / 60000}m, max: ${MAX_SANDBOXES})`);
}

/**
 * Stop the idle cleanup timer.
 */
export function stopIdleCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

/**
 * Update the last active time for a sandbox.
 */
export function touchSandbox(chatId: number): void {
  const sb = getActiveSandbox(chatId);
  if (sb) sb.lastActiveAt = Date.now();
}
