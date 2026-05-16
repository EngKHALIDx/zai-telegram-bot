/**
 * Agent Tools v17.0 - Native function calling with 13 tools
 * Each tool has proper JSON Schema definition for ZhipuAI API
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { exec, execSync } from 'child_process';
import { sendDocumentBuffer, sendPhotoBuffer, sendMessage, escapeHtml } from './telegram.js';
import { webSearch, generateImage } from './zai.js';
import type { ToolDefinition } from './zai.js';
import { addStep, updateStep, updateDisplay, getAbortSignal } from './operations.js';

const WORK_DIR = join(process.cwd(), 'workspace');
const GH_TOKEN = process.env.GH_PAT || process.env.GH_TOKEN || '';
const GH_USERNAME = process.env.GH_USERNAME || '';

export interface ToolResult { success: boolean; output: string; data?: any; }

// ─── Tool Definitions (JSON Schema for ZhipuAI native tool calling) ──────

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'run_shell',
      description: 'Execute a shell command on the Linux system. Use for: git, npm, pip, ls, cat, mkdir, curl, etc.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to execute' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'install_package',
      description: 'Install a package using npm or pip',
      parameters: {
        type: 'object',
        properties: {
          package_name: { type: 'string', description: 'Package name to install' },
          package_manager: { type: 'string', enum: ['npm', 'pip'], description: 'Package manager to use (default: npm)' },
        },
        required: ['package_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_file',
      description: 'Create a file with the given content at the specified path',
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
      description: 'Execute code in JavaScript, Python, or Bash',
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
      description: 'Read the contents of a file',
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
];

// ─── Tool Execution ────────────────────────────────────────

export async function executeTool(toolName: string, params: Record<string, any>, chatId: number): Promise<ToolResult> {
  if (!existsSync(WORK_DIR)) mkdirSync(WORK_DIR, { recursive: true });

  const inputPreview = Object.entries(params).map(([k, v]) => `${k}=${String(v).substring(0, 50)}`).join(', ');
  const stepIdx = addStep(chatId, toolName, inputPreview);
  await updateDisplay(chatId);

  const signal = getAbortSignal(chatId);

  try {
    let result: ToolResult;

    switch (toolName) {
      case 'run_shell': result = await toolRunShell(params.command, signal); break;
      case 'install_package': result = await toolInstall(params.package_name, params.package_manager, signal); break;
      case 'create_file': result = toolCreateFile(params.path, params.content); break;
      case 'create_project': result = toolCreateProject(params.name, params.description, params.files); break;
      case 'push_github': result = toolPushGithub(params.repo_name, params.description, params.private); break;
      case 'send_file': result = await toolSendFile(params.file_path, params.caption, chatId); break;
      case 'send_project_zip': result = await toolSendProjectZip(params.project_name, params.caption, chatId); break;
      case 'web_search': result = await toolWebSearch(params.query); break;
      case 'generate_image': result = await toolGenerateImage(params.prompt, chatId); break;
      case 'run_code': result = await toolRunCode(params.language, params.code, signal); break;
      case 'read_file': result = toolReadFile(params.path); break;
      case 'list_files': result = toolListFiles(params.project_name); break;
      case 'edit_file': result = toolEditFile(params.path, params.old_text, params.new_text); break;
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

function toolRunShell(command: string, signal?: AbortSignal | null): Promise<ToolResult> {
  return new Promise((resolve) => {
    console.log(`[Shell] ${command.substring(0, 200)}`);
    const child = exec(command, {
      encoding: 'utf-8',
      timeout: 120000,
      cwd: WORK_DIR,
      maxBuffer: 4 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      const out = (stdout || '').substring(0, 5000);
      const err = (stderr || '').substring(0, 2000);
      if (error) {
        resolve({ success: false, output: `Exit ${error.code}:\n${out}${err}`.substring(0, 5000) });
      } else {
        resolve({ success: true, output: out || '(No output)' });
      }
    });
    if (signal) {
      signal.addEventListener('abort', () => { try { child.kill('SIGTERM'); } catch {} }, { once: true });
    }
  });
}

async function toolInstall(pkg: string, mgr = 'npm', signal?: AbortSignal | null): Promise<ToolResult> {
  const cmd = (mgr === 'pip' || mgr === 'python') ? `pip3 install ${pkg} 2>&1` : `npm install ${pkg} 2>&1`;
  return toolRunShell(cmd, signal);
}

function toolCreateFile(filePath: string, content: string): ToolResult {
  try {
    const fullPath = join(WORK_DIR, filePath);
    if (!existsSync(dirname(fullPath))) mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, 'utf-8');
    return { success: true, output: `Created: ${filePath} (${content.length} chars)` };
  } catch (e: any) { return { success: false, output: e.message }; }
}

function toolCreateProject(name: string, desc: string, files: any): ToolResult {
  try {
    const dir = join(WORK_DIR, name);
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
    return { success: true, output: `Project "${name}" (${list.length} files):\n${created.map(f => `  ${f}`).join('\n')}`, data: { projectDir: dir } };
  } catch (e: any) { return { success: false, output: e.message }; }
}

function toolPushGithub(repoName: string, desc = '', priv = false): ToolResult {
  try {
    if (!GH_TOKEN) return { success: false, output: 'GH_PAT not configured' };

    const createCmd = `curl -s -X POST -H "Authorization: token ${GH_TOKEN}" -H "Accept: application/vnd.github.v3+json" https://api.github.com/user/repos -d '{"name":"${repoName}","description":"${(desc || '').replace(/"/g, '\\"')}","private":${priv}}'`;
    const cr = JSON.parse(execSync(createCmd, { encoding: 'utf-8', timeout: 30000 }));
    if (cr.message?.includes('already exists')) console.log('[GitHub] Repo exists');
    else if (!cr.full_name) return { success: false, output: `GitHub: ${cr.message}` };

    const dir = join(WORK_DIR, repoName);
    if (!existsSync(dir)) return { success: false, output: `Project dir not found: ${repoName}` };

    const url = `https://${GH_TOKEN}@github.com/${GH_USERNAME}/${repoName}.git`;
    execSync(`cd "${dir}" && git init && git add -A && git commit -m "Initial commit from Z.ai Agent" && git branch -M main && git remote add origin "${url}" 2>/dev/null; git remote set-url origin "${url}" && git push -u origin main --force`, { encoding: 'utf-8', timeout: 60000 });
    return { success: true, output: `Pushed! https://github.com/${GH_USERNAME}/${repoName}` };
  } catch (e: any) { return { success: false, output: e.message?.substring(0, 500) }; }
}

async function toolSendFile(fp: string, caption: string, chatId: number): Promise<ToolResult> {
  try {
    const fullPath = join(WORK_DIR, fp);
    if (!existsSync(fullPath)) return { success: false, output: `Not found: ${fp}` };
    await sendDocumentBuffer(chatId, Buffer.from(readFileSync(fullPath)), fp.split('/').pop() || 'file', caption);
    return { success: true, output: `Sent: ${fp}` };
  } catch (e: any) { return { success: false, output: e.message }; }
}

async function toolSendProjectZip(name: string, caption: string, chatId: number): Promise<ToolResult> {
  try {
    const dir = join(WORK_DIR, name);
    if (!existsSync(dir)) return { success: false, output: `Not found: ${name}` };
    const zp = join(WORK_DIR, `${name}.zip`);
    execSync(`cd "${WORK_DIR}" && zip -r "${name}.zip" "${name}/"`, { encoding: 'utf-8', timeout: 30000 });
    await sendDocumentBuffer(chatId, Buffer.from(readFileSync(zp)), `${name}.zip`, caption || name);
    try { rmSync(zp); } catch {}
    return { success: true, output: `ZIP sent: ${name}.zip` };
  } catch (e: any) { return { success: false, output: e.message }; }
}

async function toolWebSearch(q: string): Promise<ToolResult> {
  const r = await webSearch(q, 5);
  if (!r.length) return { success: true, output: 'No results found' };
  let o = `"${q}":\n\n`;
  r.forEach((x, i) => { o += `${i + 1}. ${x.name}\n   ${x.snippet}\n   ${x.url}\n\n`; });
  return { success: true, output: o, data: r };
}

async function toolGenerateImage(prompt: string, chatId: number): Promise<ToolResult> {
  const b64 = await generateImage(prompt);
  if (b64) {
    const buf = Buffer.from(b64, 'base64');
    const fn = `img_${Date.now()}.png`;
    await sendPhotoBuffer(chatId, buf, fn, prompt);
    writeFileSync(join(WORK_DIR, fn), buf);
    return { success: true, output: `Image generated: ${fn}`, data: { filePath: join(WORK_DIR, fn) } };
  }
  return { success: false, output: 'Failed to generate image' };
}

async function toolRunCode(lang: string, code: string, signal?: AbortSignal | null): Promise<ToolResult> {
  const sp = join(WORK_DIR, `_run_${Date.now()}`);
  if (!existsSync(WORK_DIR)) mkdirSync(WORK_DIR, { recursive: true });
  const l = lang.toLowerCase();
  let cmd: string;
  if (l === 'javascript' || l === 'js') { writeFileSync(sp + '.js', code, 'utf-8'); cmd = `node "${sp}.js"`; }
  else if (l === 'python' || l === 'py') { writeFileSync(sp + '.py', code, 'utf-8'); cmd = `python3 "${sp}.py"`; }
  else if (l === 'bash' || l === 'sh') { writeFileSync(sp + '.sh', code, 'utf-8'); cmd = `bash "${sp}.sh"`; }
  else return { success: false, output: `Unsupported language: ${lang}` };
  const r = await toolRunShell(cmd, signal);
  try { rmSync(sp + '.*'); } catch {}
  return r;
}

function toolReadFile(fp: string): ToolResult {
  try {
    const p = join(WORK_DIR, fp);
    if (!existsSync(p)) return { success: false, output: `Not found: ${fp}` };
    const content = readFileSync(p, 'utf-8');
    return { success: true, output: content.substring(0, 8000), data: { content } };
  } catch (e: any) { return { success: false, output: e.message }; }
}

function toolListFiles(project?: string): ToolResult {
  try {
    const d = project ? join(WORK_DIR, project) : WORK_DIR;
    if (!existsSync(d)) return { success: false, output: 'Directory not found' };
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
    return { success: true, output: `${f.length} items:\n${f.slice(0, 80).join('\n')}`, data: { files: f } };
  } catch (e: any) { return { success: false, output: e.message }; }
}

function toolEditFile(fp: string, old: string, rep: string): ToolResult {
  try {
    const p = join(WORK_DIR, fp);
    if (!existsSync(p)) return { success: false, output: `Not found: ${fp}` };
    let c = readFileSync(p, 'utf-8');
    if (!c.includes(old)) return { success: false, output: `Text not found in ${fp}` };
    writeFileSync(p, c.replace(old, rep), 'utf-8');
    return { success: true, output: `Edited: ${fp}` };
  } catch (e: any) { return { success: false, output: e.message }; }
}

// ─── System Prompt ─────────────────────────────────────────

export function getAgentSystemPrompt(): string {
  return `أنت Z.ai Agent — وكيل ذكي يعمل على بيئة لينكس. يمكنك بناء تطبيقات كاملة، إنشاء مشاريع، كتابة وتنفيذ كود، بحث الويب، إنشاء صور بالذكاء الاصطناعي، وأكثر. أنت تعمل مثل وضع Agent في chat.z.ai.

لديك 13 أداة متاحة يمكنك استخدامها. استخدم الأدوات المناسبة لتنفيذ طلبات المستخدم.

قواعد مهمة:
1. نفذ المهام خطوة بخطوة - لا تطلب تأكيد المستخدم، نفذ مباشرة
2. عند إنشاء مشروع كامل، استخدم create_project مع مصفوفة الملفات
3. بعد إنشاء المشروع، يمكنك رفعه على GitHub بـ push_github
4. أرسل الملفات عبر send_file أو send_project_zip
5. اكتب كود نظيف ومُعلّق وجاهز للإنتاج
6. أجب باللغة التي يسأل بها المستخدم
7. استخدم run_shell لأوامر النظام (git, npm, pip, ls, cat, etc.)
8. ابحث في الويب عند الحاجة لمعلومات حديثة
9. عند إنشاء ملفات، اكتب المحتوى الكامل - لا تضع تعليقات مثل "..."
10. دائماً اعرض ما تفعله بالتفصيل قبل استخدام الأداة`;
}
