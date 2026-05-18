/**
 * Process Manager v18.0
 * Track running shell child processes with PID, command, start time
 * Supports kill by PID, kill all for a chat, and listing
 */
import { ChildProcess } from 'child_process';

// ─── Types ────────────────────────────────────────────────

export interface TrackedProcess {
  pid: number;
  chatId: number;
  sandboxId: string;
  command: string;
  startedAt: number;
  child: ChildProcess;
}

// ─── Storage ──────────────────────────────────────────────

const processes: Map<number, TrackedProcess> = new Map();

// ─── Core Functions ───────────────────────────────────────

/**
 * Track a new child process.
 */
export function trackProcess(chatId: number, sandboxId: string, command: string, child: ChildProcess): TrackedProcess {
  const pid = child.pid || -1;
  const tracked: TrackedProcess = {
    pid,
    chatId,
    sandboxId,
    command: command.substring(0, 500),
    startedAt: Date.now(),
    child,
  };

  if (pid > 0) {
    processes.set(pid, tracked);
  }

  // Auto-cleanup when process exits
  child.on('exit', () => {
    processes.delete(pid);
  });

  console.log(`[Process] Tracked PID ${pid}: ${command.substring(0, 100)}`);
  return tracked;
}

/**
 * Kill a process by PID.
 */
export function killProcess(pid: number): boolean {
  const tracked = processes.get(pid);
  if (!tracked) return false;

  try {
    tracked.child.kill('SIGTERM');
    // Force kill after 3 seconds if still running
    setTimeout(() => {
      try {
        if (!tracked.child.killed) {
          tracked.child.kill('SIGKILL');
        }
      } catch {}
    }, 3000);
    processes.delete(pid);
    console.log(`[Process] Killed PID ${pid}`);
    return true;
  } catch (e) {
    console.error(`[Process] Error killing PID ${pid}:`, e);
    processes.delete(pid);
    return false;
  }
}

/**
 * Kill all processes for a specific chat.
 */
export function killAllForChat(chatId: number): number {
  let count = 0;
  for (const [pid, tracked] of processes) {
    if (tracked.chatId === chatId) {
      try {
        tracked.child.kill('SIGTERM');
        processes.delete(pid);
        count++;
      } catch {}
    }
  }
  if (count > 0) {
    console.log(`[Process] Killed ${count} processes for chat ${chatId}`);
  }
  return count;
}

/**
 * Kill all processes for a specific sandbox.
 */
export function killAllForSandbox(sandboxId: string): number {
  let count = 0;
  for (const [pid, tracked] of processes) {
    if (tracked.sandboxId === sandboxId) {
      try {
        tracked.child.kill('SIGTERM');
        processes.delete(pid);
        count++;
      } catch {}
    }
  }
  return count;
}

/**
 * Get all tracked processes for a chat.
 */
export function getProcesses(chatId: number): TrackedProcess[] {
  const result: TrackedProcess[] = [];
  for (const tracked of processes.values()) {
    if (tracked.chatId === chatId) {
      result.push(tracked);
    }
  }
  return result;
}

/**
 * Get all tracked processes.
 */
export function getAllProcesses(): TrackedProcess[] {
  return Array.from(processes.values());
}

/**
 * Get a specific process by PID.
 */
export function getProcess(pid: number): TrackedProcess | undefined {
  return processes.get(pid);
}

/**
 * Get the count of running processes.
 */
export function getProcessCount(): number {
  return processes.size;
}

/**
 * Clean up stale process entries (where the child has exited but wasn't auto-cleaned).
 */
export function cleanupStale(): void {
  for (const [pid, tracked] of processes) {
    if (tracked.child.killed || tracked.child.exitCode !== null) {
      processes.delete(pid);
    }
  }
}
