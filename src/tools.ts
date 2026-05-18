/**
 * Agent Tools v18.1 - Native function calling with Linux environment support
 * Executes all commands in a real Linux bash shell environment
 * Enhanced with: apt-get install, Linux env vars, bash login shell, home directory
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { exec, execSync, spawn, type ChildProcess } from 'child_process';
import { sendDocumentBuffer, sendPhotoBuffer, sendMessage, escapeHtml } from './telegram.js';
import { webSearch, generateImage } from './zai.js';
import type { ToolDefinition } from './zai.js';
import { addStep, updateStep, updateDisplay, getAbortSignal, setStreamingOutput } from './operations.js';
import { trackProcess, killProcess, getProcesses } from './process-manager.js';
import type { Sandbox } from './sandbox.js';

const GH_TOKEN = process.env.GH_PAT || process.env.GH_TOKEN || '';
const GH_USERNAME = process.env.GH_USERNAME || '';

export interface ToolResult { success: boolean; output: string; data?: any; }

// ─── Linux Environment Setup ────────────────────────────────

const LINUX_ENV: Record<string, string> = {
  PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin',
  HOME: '/home/z',
  USER: 'z',
  SHELL: '/bin/bash',
  LANG: 'en_US.UTF-8',
  LC_ALL: 'en_US.UTF-8',
  TERM: 'xterm-256color',
  DEBIAN_FRONTEND: 'noninteractive',
  NODE_PATH: '/usr/lib/node_modules',
  NPM_CONFIG_PREFIX: '/home/z/.npm-global',
  PYTHONPATH: '/home/z/.local/lib/python3.12/site-packages',
  PIP_USER: '1',
  // Preserve important existing vars
  ...(process.env.TELEGRAM_BOT_TOKEN ? { TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN } : {}),
  ...(process.env.ZAI_API_KEY ? { ZAI_API_KEY: process.env.ZAI_API_KEY } : {}),
  ...(process.env.OPENCODE_API_KEY ? { OPENCODE_API_KEY: process.env.OPENCODE_API_KEY } : {}),
  ...(process.env.GH_PAT ? { GH_PAT: process.env.GH_PAT } : {}),
  ...(process.env.GH_TOKEN ? { GH_TOKEN: process.env.GH_TOKEN } : {}),
  ...(process.env.GH_USERNAME ? { GH_USERNAME: process.env.GH_USERNAME } : {}),
};

/**
 * Execute a command in the Linux bash shell environment.
 * Uses /bin/bash as login shell with full Linux environment.
 */
function linuxExec(
  command: string,
  options: {
    cwd: string;
    timeout?: number;
    signal?: AbortSignal | null;
    onStdout?: (data: string) => void;
    onStderr?: (data: string) => void;
  }
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const timeout = options.timeout || 120000;

    // Use bash login shell for full Linux environment
    const child = spawn('/bin/bash', ['-l', '-c', command], {
      cwd: options.cwd,
      env: { ...LINUX_ENV, PWD: options.cwd },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    // Set timeout
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch {}
      // Force kill after 3s
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 3000);
    }, timeout);

    child.stdout?.on('data', (data: Buffer) => {
      const str = data.toString();
      stdout += str;
      options.onStdout?.(str);
    });

    child.stderr?.on('data', (data: Buffer) => {
      const str = data.toString();
      stderr += str;
      options.onStderr?.(str);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: timedOut ? -1 : (code ?? 0),
        stdout,
        stderr,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: -1,
        stdout,
        stderr: err.message,
      });
    });

    // Handle abort signal
    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        try { child.kill('SIGTERM'); } catch {}
        clearTimeout(timer);
      }, { once: true });
    }
  });
}

// ─── Tool Definitions (JSON Schema for ZhipuAI native tool calling) ──────

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'run_shell',
      description: 'Execute a shell command in the Linux bash environment. Full access to: git, npm, pip, apt, curl, wget, python3, node, gcc, make, etc. Commands run in /bin/bash login shell with full Linux environment.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The bash shell command to execute' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'install_package',
      description: 'Install a package using apt-get, npm, or pip3. Use apt for system packages (ffmpeg, imagemagick, build-essential, etc.), npm for Node.js packages, pip for Python packages.',
      parameters: {
        type: 'object',
        properties: {
          package_name: { type: 'string', description: 'Package name to install' },
          package_manager: { type: 'string', enum: ['apt', 'npm', 'pip'], description: 'Package manager: apt (system), npm (Node.js), pip (Python). Default: npm' },
        },
        required: ['package_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_file',
      description: 'Create a file with the given content at the specified path in the workspace',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to workspace' },
          content: { type: 'string', description: 'Full file content' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_project',
      description: 'Create a complete project with multiple files at once',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Project name' },
          description: { type: 'string', description: 'Project description' },
          files: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'File path within project' },
                content: { type: 'string', description: 'File content' },
              },
              required: ['path', 'content'],
            },
            description: 'Array of files to create',
          },
        },
        required: ['name', 'description', 'files'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_project_zip',
      description: 'Package a project as ZIP and send it to the user via Telegram',
      parameters: {
        type: 'object',
        properties: {
          project_name: { type: 'string', description: 'Project directory name' },
          caption: { type: 'string', description: 'Caption for the ZIP file' },
        },
        required: ['project_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_file',
      description: 'Send a file to the user via Telegram',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Path of file relative to workspace' },
          caption: { type: 'string', description: 'Caption for the file' },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'push_github',
      description: 'Push a project to GitHub repository (creates repo if needed)',
      parameters: {
        type: 'object',
        properties: {
          repo_name: { type: 'string', description: 'GitHub repository name' },
          description: { type: 'string', description: 'Repository description' },
          private: { type: 'boolean', description: 'Whether repo should be private (default: false)' },
        },
        required: ['repo_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for up-to-date information',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_image',
      description: 'Generate an AI image from a text prompt',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Image description prompt' },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_code',
      description: 'Execute code in JavaScript, Python, or Bash. Code runs in a real Linux environment with full system access.',
      parameters: {
        type: 'object',
        properties: {
          language: { type: 'string', enum: ['javascript', 'python', 'bash'], description: 'Programming language' },
          code: { type: 'string', description: 'Code to execute' },
        },
        required: ['language', 'code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file from the workspace',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to workspace' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files in a project directory or workspace',
      parameters: {
        type: 'object',
        properties: {
          project_name: { type: 'string', description: 'Project name (optional, defaults to workspace root)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Edit a file by replacing old text with new text',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to workspace' },
          old_text: { type: 'string', description: 'Text to find and replace' },
          new_text: { type: 'string', description: 'Replacement text' },
        },
        required: ['path', 'old_text', 'new_text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'linux_info',
      description: 'Get information about the Linux environment (OS, kernel, packages, disk, memory)',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
];

// ─── Tool Execution ────────────────────────────────────────

export async function executeTool(
  toolName: string,
  params: Record<string, any>,
  chatId: number,
  sandbox: Sandbox
): Promise<ToolResult> {
  const workDir = sandbox.workDir;
  if (!existsSync(workDir)) mkdirSync(workDir, { recursive: true });

  const inputPreview = Object.entries(params).map(([k, v]) => `${k}=${String(v).substring(0, 50)}`).join(', ');
  const stepIdx = addStep(chatId, toolName, inputPreview);
  await updateDisplay(chatId);

  const signal = getAbortSignal(chatId);

  try {
    let result: ToolResult;

    switch (toolName) {
      case 'run_shell': result = await toolRunShell(params.command, signal, chatId, sandbox); break;
      case 'install_package': result = await toolInstall(params.package_name, params.package_manager, signal, chatId, sandbox); break;
      case 'create_file': result = toolCreateFile(params.path, params.content, workDir); break;
      case 'create_project': result = toolCreateProject(params.name, params.description, params.files, workDir); break;
      case 'push_github': result = toolPushGithub(params.repo_name, params.description, params.private, workDir); break;
      case 'send_file': result = await toolSendFile(params.file_path, params.caption, chatId, workDir); break;
      case 'send_project_zip': result = await toolSendProjectZip(params.project_name, params.caption, chatId, workDir); break;
      case 'web_search': result = await toolWebSearch(params.query); break;
      case 'generate_image': result = await toolGenerateImage(params.prompt, chatId, workDir); break;
      case 'run_code': result = await toolRunCode(params.language, params.code, signal, chatId, sandbox, workDir); break;
      case 'read_file': result = toolReadFile(params.path, workDir); break;
      case 'list_files': result = toolListFiles(params.project_name, workDir); break;
      case 'edit_file': result = toolEditFile(params.path, params.old_text, params.new_text, workDir); break;
      case 'linux_info': result = toolLinuxInfo(); break;
      default: result = { success: false, output: `Unknown tool: ${toolName}` };
    }

    updateStep(chatId, stepIdx, result.success ? 'done' : 'failed', result.output);
    await updateDisplay(chatId);
    return result;
  } catch (e: any) {
    const msg = e.name === 'AbortError' ? 'Stopped by user' : (e.message || 'Unknown error').substring(0, 300);
    updateStep(chatId, stepIdx, 'failed', msg);
    await updateDisplay(chatId);
    return { success: false, output: msg };
  }
}

// ─── Tool Implementations ───────────────────────────────────

function toolRunShell(
  command: string,
  signal: AbortSignal | null | undefined,
  chatId: number,
  sandbox: Sandbox
): Promise<ToolResult> {
  return new Promise((resolve) => {
    console.log(`[Shell] $ ${command.substring(0, 200)}`);

    // Track streaming output
    let streamBuffer = '';
    const streamInterval = setInterval(() => {
      if (streamBuffer.length > 0) {
        setStreamingOutput(chatId, streamBuffer.substring(streamBuffer.length - 500));
      }
    }, 3000);

    linuxExec(command, {
      cwd: sandbox.workDir,
      timeout: 120000,
      signal,
      onStdout: (data) => {
        streamBuffer += data;
        if (streamBuffer.length > 10000) {
          streamBuffer = streamBuffer.substring(streamBuffer.length - 5000);
        }
      },
      onStderr: (data) => {
        streamBuffer += data;
        if (streamBuffer.length > 10000) {
          streamBuffer = streamBuffer.substring(streamBuffer.length - 5000);
        }
      },
    }).then(({ exitCode, stdout, stderr }) => {
      clearInterval(streamInterval);
      const out = stdout.substring(0, 5000);
      const err = stderr.substring(0, 2000);
      if (exitCode !== 0) {
        resolve({ success: false, output: `Exit ${exitCode}:\n${out}${err}`.substring(0, 5000) });
      } else {
        resolve({ success: true, output: out || '(لا يوجد مخرجات)' });
      }
    });

    // Track the process - find the bash PID
    // We use exec just for PID tracking, actual execution is via linuxExec/spawn
    // So we use a simpler approach: track via the sandbox directly
    sandbox.lastCommand = command;
    sandbox.lastCommandAt = Date.now();
  });
}

async function toolInstall(
  pkg: string,
  mgr = 'npm',
  signal: AbortSignal | null | undefined,
  chatId: number,
  sandbox: Sandbox
): Promise<ToolResult> {
  let cmd: string;
  if (mgr === 'apt') {
    cmd = `sudo apt-get update -qq 2>/dev/null && sudo apt-get install -y -qq ${pkg} 2>&1`;
  } else if (mgr === 'pip' || mgr === 'python') {
    cmd = `pip3 install --user ${pkg} 2>&1`;
  } else {
    cmd = `npm install ${pkg} 2>&1`;
  }
  return toolRunShell(cmd, signal, chatId, sandbox);
}

function toolCreateFile(filePath: string, content: string, workDir: string): ToolResult {
  try {
    const fullPath = join(workDir, filePath);
    if (!existsSync(dirname(fullPath))) mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, 'utf-8');
    return { success: true, output: `تم إنشاء: ${filePath} (${content.length} حرف)` };
  } catch (e: any) { return { success: false, output: e.message }; }
}

function toolCreateProject(name: string, desc: string, files: any, workDir: string): ToolResult {
  try {
    const dir = join(workDir, name);
    if (existsSync(dir)) rmSync(dir, { recursive: true });
    mkdirSync(dir, { recursive: true });

    let list: Array<{ path: string; content: string }>;
    if (typeof files === 'string') {
      try { list = JSON.parse(files); } catch { return { success: false, output: 'Invalid JSON for files' }; }
    } else list = files;

    if (!Array.isArray(list)) return { success: false, output: 'files must be an array' };

    const created: string[] = [];
    for (const f of list) {
      const p = f.path || 'file.txt', fp = join(dir, p);
      if (!existsSync(dirname(fp))) mkdirSync(dirname(fp), { recursive: true });
      writeFileSync(fp, f.content || '', 'utf-8');
      created.push(p);
    }
    return { success: true, output: `مشروع "${name}" (${list.length} ملف):\n${created.map(f => `  ${f}`).join('\n')}`, data: { projectDir: dir } };
  } catch (e: any) { return { success: false, output: e.message }; }
}

function toolPushGithub(repoName: string, desc = '', priv = false, workDir: string): ToolResult {
  try {
    if (!GH_TOKEN) return { success: false, output: 'GH_PAT not configured' };

    const createCmd = `curl -s -X POST -H "Authorization: token ${GH_TOKEN}" -H "Accept: application/vnd.github.v3+json" https://api.github.com/user/repos -d '{"name":"${repoName}","description":"${(desc || '').replace(/"/g, '\\"')}","private":${priv}}'`;
    const cr = JSON.parse(execSync(createCmd, { encoding: 'utf-8', timeout: 30000, env: LINUX_ENV }));
    if (cr.message?.includes('already exists')) console.log('[GitHub] Repo exists');
    else if (!cr.full_name) return { success: false, output: `GitHub: ${cr.message}` };

    const dir = join(workDir, repoName);
    if (!existsSync(dir)) return { success: false, output: `Project dir not found: ${repoName}` };

    const url = `https://${GH_TOKEN}@github.com/${GH_USERNAME}/${repoName}.git`;
    execSync(`cd "${dir}" && git init && git add -A && git commit -m "Initial commit from Z.ai Agent" && git branch -M main && git remote add origin "${url}" 2>/dev/null; git remote set-url origin "${url}" && git push -u origin main --force`, { encoding: 'utf-8', timeout: 60000, env: LINUX_ENV });
    return { success: true, output: `تم الرفع! https://github.com/${GH_USERNAME}/${repoName}` };
  } catch (e: any) { return { success: false, output: e.message?.substring(0, 500) }; }
}

async function toolSendFile(fp: string, caption: string, chatId: number, workDir: string): Promise<ToolResult> {
  try {
    const fullPath = join(workDir, fp);
    if (!existsSync(fullPath)) return { success: false, output: `الملف غير موجود: ${fp}` };
    await sendDocumentBuffer(chatId, Buffer.from(readFileSync(fullPath)), fp.split('/').pop() || 'file', caption);
    return { success: true, output: `تم إرسال: ${fp}` };
  } catch (e: any) { return { success: false, output: e.message }; }
}

async function toolSendProjectZip(name: string, caption: string, chatId: number, workDir: string): Promise<ToolResult> {
  try {
    const dir = join(workDir, name);
    if (!existsSync(dir)) return { success: false, output: `المشروع غير موجود: ${name}` };
    const zp = join(workDir, `${name}.zip`);
    execSync(`cd "${workDir}" && zip -r "${name}.zip" "${name}/"`, { encoding: 'utf-8', timeout: 30000, env: LINUX_ENV });
    await sendDocumentBuffer(chatId, Buffer.from(readFileSync(zp)), `${name}.zip`, caption || name);
    try { rmSync(zp); } catch {}
    return { success: true, output: `تم إرسال ZIP: ${name}.zip` };
  } catch (e: any) { return { success: false, output: e.message }; }
}

async function toolWebSearch(q: string): Promise<ToolResult> {
  const r = await webSearch(q, 5);
  if (!r.length) return { success: true, output: 'لا توجد نتائج' };
  let o = `"${q}":\n\n`;
  r.forEach((x, i) => { o += `${i + 1}. ${x.name}\n   ${x.snippet}\n   ${x.url}\n\n`; });
  return { success: true, output: o, data: r };
}

async function toolGenerateImage(prompt: string, chatId: number, workDir: string): Promise<ToolResult> {
  const b64 = await generateImage(prompt);
  if (b64) {
    const buf = Buffer.from(b64, 'base64');
    const fn = `img_${Date.now()}.png`;
    await sendPhotoBuffer(chatId, buf, fn, prompt);
    writeFileSync(join(workDir, fn), buf);
    return { success: true, output: `تم إنشاء الصورة: ${fn}`, data: { filePath: join(workDir, fn) } };
  }
  return { success: false, output: 'فشل إنشاء الصورة' };
}

async function toolRunCode(
  lang: string,
  code: string,
  signal: AbortSignal | null | undefined,
  chatId: number,
  sandbox: Sandbox,
  workDir: string
): Promise<ToolResult> {
  const sp = join(workDir, `_run_${Date.now()}`);
  if (!existsSync(workDir)) mkdirSync(workDir, { recursive: true });
  const l = lang.toLowerCase();
  let cmd: string;
  if (l === 'javascript' || l === 'js') { writeFileSync(sp + '.js', code, 'utf-8'); cmd = `node "${sp}.js"`; }
  else if (l === 'python' || l === 'py') { writeFileSync(sp + '.py', code, 'utf-8'); cmd = `python3 "${sp}.py"`; }
  else if (l === 'bash' || l === 'sh') { writeFileSync(sp + '.sh', code, 'utf-8'); cmd = `bash "${sp}.sh"`; }
  else return { success: false, output: `لغة غير مدعومة: ${lang}` };
  const r = await toolRunShell(cmd, signal, chatId, sandbox);
  try { rmSync(sp + '.*'); } catch {}
  return r;
}

function toolReadFile(fp: string, workDir: string): ToolResult {
  try {
    const p = join(workDir, fp);
    if (!existsSync(p)) return { success: false, output: `الملف غير موجود: ${fp}` };
    const content = readFileSync(p, 'utf-8');
    return { success: true, output: content.substring(0, 8000), data: { content } };
  } catch (e: any) { return { success: false, output: e.message }; }
}

function toolListFiles(project?: string, workDir?: string): ToolResult {
  try {
    const d = project && workDir ? join(workDir, project) : (workDir || process.cwd());
    if (!existsSync(d)) return { success: false, output: 'الدليل غير موجود' };
    function ls(dir: string, pfx = ''): string[] {
      const r: string[] = [];
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.git' || e.name === '.next') continue;
        if (e.isDirectory()) { r.push(`${pfx}${e.name}/`); r.push(...ls(join(dir, e.name), pfx + '  ')); }
        else r.push(`${pfx}${e.name} (${(statSync(join(dir, e.name)).size / 1024).toFixed(1)}KB)`);
      }
      return r;
    }
    const f = ls(d);
    return { success: true, output: `${f.length} عنصر:\n${f.slice(0, 80).join('\n')}`, data: { files: f } };
  } catch (e: any) { return { success: false, output: e.message }; }
}

function toolEditFile(fp: string, old: string, rep: string, workDir: string): ToolResult {
  try {
    const p = join(workDir, fp);
    if (!existsSync(p)) return { success: false, output: `الملف غير موجود: ${fp}` };
    let c = readFileSync(p, 'utf-8');
    if (!c.includes(old)) return { success: false, output: `النص غير موجود في ${fp}` };
    writeFileSync(p, c.replace(old, rep), 'utf-8');
    return { success: true, output: `تم تعديل: ${fp}` };
  } catch (e: any) { return { success: false, output: e.message }; }
}

function toolLinuxInfo(): ToolResult {
  try {
    const info: string[] = [];

    // OS info
    try {
      const osRelease = readFileSync('/etc/os-release', 'utf-8');
      const nameLine = osRelease.split('\n').find(l => l.startsWith('PRETTY_NAME='));
      if (nameLine) info.push(`💻 النظام: ${nameLine.split('=')[1]?.replace(/"/g, '')}`);
    } catch {}

    // Kernel
    try {
      const kernel = execSync('uname -r', { encoding: 'utf-8', env: LINUX_ENV }).trim();
      info.push(`🔬 النواة: ${kernel}`);
    } catch {}

    // Architecture
    try {
      const arch = execSync('uname -m', { encoding: 'utf-8', env: LINUX_ENV }).trim();
      info.push(`🏗️ المعالج: ${arch}`);
    } catch {}

    // Memory
    try {
      const memInfo = readFileSync('/proc/meminfo', 'utf-8');
      const totalMatch = memInfo.match(/MemTotal:\s+(\d+)/);
      const availMatch = memInfo.match(/MemAvailable:\s+(\d+)/);
      if (totalMatch && availMatch) {
        const total = Math.round(parseInt(totalMatch[1]) / 1024 / 1024);
        const avail = Math.round(parseInt(availMatch[1]) / 1024 / 1024);
        info.push(`💾 الذاكرة: ${avail}GB / ${total}GB`);
      }
    } catch {}

    // Disk
    try {
      const df = execSync('df -h / --output=size,avail 2>/dev/null | tail -1', { encoding: 'utf-8', env: LINUX_ENV }).trim();
      info.push(`💿 القرص: ${df.replace(/\s+/g, ' متاح من ')}`);
    } catch {}

    // CPU cores
    try {
      const cpus = execSync('nproc', { encoding: 'utf-8', env: LINUX_ENV }).trim();
      info.push(`⚡ الأنوية: ${cpus}`);
    } catch {}

    // Available tools
    const tools = ['python3', 'node', 'npm', 'pip3', 'git', 'curl', 'wget', 'gcc', 'g++', 'make', 'docker', 'ffmpeg', 'convert', 'java', 'go', 'rustc', 'cargo'];
    const available: string[] = [];
    for (const tool of tools) {
      try {
        execSync(`which ${tool} 2>/dev/null`, { encoding: 'utf-8', env: LINUX_ENV, timeout: 3000 });
        available.push(tool);
      } catch {}
    }
    info.push(`🔧 الأدوات: ${available.join(', ')}`);

    // Python version
    try {
      const pyVer = execSync('python3 --version 2>&1', { encoding: 'utf-8', env: LINUX_ENV }).trim();
      info.push(`🐍 ${pyVer}`);
    } catch {}

    // Node version
    try {
      const nodeVer = execSync('node --version 2>&1', { encoding: 'utf-8', env: LINUX_ENV }).trim();
      info.push(`🟢 Node.js ${nodeVer}`);
    } catch {}

    // NPM global packages
    try {
      const npmList = execSync('npm list -g --depth=0 2>/dev/null | tail -5', { encoding: 'utf-8', env: LINUX_ENV, timeout: 5000 }).trim();
      info.push(`📦 NPM عالمي:\n${npmList}`);
    } catch {}

    return { success: true, output: info.join('\n') };
  } catch (e: any) {
    return { success: false, output: e.message };
  }
}

// ─── System Prompt ─────────────────────────────────────────

export function getAgentSystemPrompt(): string {
  return `أنت Z.ai Agent v18.1 — وكيل ذكي يعمل على بيئة لينكس حقيقية (Ubuntu/Debian). يمكنك تنفيذ أوامر Bash مباشرة، بناء تطبيقات كاملة، إنشاء مشاريع، كتابة وتنفيذ كود، بحث الويب، إنشاء صور بالذكاء الاصطناعي، وأكثر.

🖥️ بيئة لينكس المتاحة:
- النظام: Linux مع /bin/bash كـ shell افتراضي
- الأدوات: python3, node, npm, pip3, git, curl, wget, gcc, make, وغيرها
- التثبيت: يمكنك تثبيت أي حزمة عبر apt-get, npm, أو pip3
- كل أمر ينفذ في bash login shell مع بيئة لينكس كاملة

لديك 14 أداة متاحة:
1. run_shell — تنفيذ أوامر Bash في بيئة لينكس (git, npm, pip, ls, cat, mkdir, curl, python3, node, etc.)
2. install_package — تثبيت حزم (apt-get / npm / pip3)
3. create_file — إنشاء ملف
4. create_project — إنشاء مشروع كامل
5. send_project_zip — إرسال مشروع كـ ZIP
6. send_file — إرسال ملف
7. push_github — رفع على GitHub
8. web_search — بحث في الويب
9. generate_image — إنشاء صورة بالذكاء الاصطناعي
10. run_code — تنفيذ كود (JavaScript / Python / Bash)
11. read_file — قراءة ملف
12. list_files — عرض الملفات
13. edit_file — تعديل ملف
14. linux_info — معلومات بيئة لينكس

قواعد مهمة:
1. نفذ المهام خطوة بخطوة - لا تطلب تأكيد المستخدم، نفذ مباشرة
2. عند إنشاء مشروع كامل، استخدم create_project مع مصفوفة الملفات
3. بعد إنشاء المشروع، يمكنك رفعه على GitHub بـ push_github
4. أرسل الملفات عبر send_file أو send_project_zip
5. اكتب كود نظيف ومُعلّق وجاهز للإنتاج
6. أجب باللغة التي يسأل بها المستخدم
7. استخدم run_shell لأوامر النظام (git, npm, pip, ls, cat, etc.)
8. استخدم install_package مع apt لتثبيت حزم النظام (ffmpeg, build-essential, etc.)
9. ابحث في الويب عند الحاجة لمعلومات حديثة
10. عند إنشاء ملفات، اكتب المحتوى الكامل - لا تضع تعليقات مثل "..."
11. دائماً اعرض ما تفعله بالتفصيل قبل استخدام الأداة
12. كل جلسة لها مساحة عمل معزولة خاصة بها
13. يمكنك استخدام linux_info لمعرفة الأدوات المتاحة في البيئة`;
}
