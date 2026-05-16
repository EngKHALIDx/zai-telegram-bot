/**
 * Agent Tools v16.0 - 13 tools with real-time display integration
 * Each tool updates the Telegram display in real-time
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { exec, execSync } from 'child_process';
import { sendDocumentBuffer, sendPhotoBuffer, sendMessage, escapeHtml } from './telegram.js';
import { webSearch, generateImage } from './zai.js';
import { addStep, updateStep, updateDisplay, getAbortSignal } from './operations.js';

const WORK_DIR = join(process.cwd(), 'workspace');
const GH_TOKEN = process.env.GH_PAT || process.env.GH_TOKEN || '';
const GH_USERNAME = process.env.GH_USERNAME || '';

export interface ToolResult { success: boolean; output: string; data?: any; }

// ─── Tool Definitions ──────────────────────────────────────

export const AGENT_TOOLS = [
  { name: 'run_shell', desc: 'Execute a shell command on the system', params: ['command'] },
  { name: 'install_package', desc: 'Install npm/pip package', params: ['package_name', 'package_manager?'] },
  { name: 'create_file', desc: 'Create a file with content', params: ['path', 'content'] },
  { name: 'create_project', desc: 'Create a complete project with multiple files', params: ['name', 'description', 'files'] },
  { name: 'send_project_zip', desc: 'Package & send project as ZIP', params: ['project_name', 'caption?'] },
  { name: 'send_file', desc: 'Send a file via Telegram', params: ['file_path', 'caption?'] },
  { name: 'push_github', desc: 'Push project to GitHub', params: ['repo_name', 'description?', 'private?'] },
  { name: 'web_search', desc: 'Search the web for information', params: ['query'] },
  { name: 'generate_image', desc: 'Generate AI image', params: ['prompt'] },
  { name: 'run_code', desc: 'Execute JS/Python/Bash code', params: ['language', 'code'] },
  { name: 'read_file', desc: 'Read file contents', params: ['path'] },
  { name: 'list_files', desc: 'List project files', params: ['project_name?'] },
  { name: 'edit_file', desc: 'Edit a file (find and replace)', params: ['path', 'old_text', 'new_text'] },
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
    const msg = e.name === 'AbortError' ? 'تم الإيقاف بواسطة المستخدم' : (e.message || 'Unknown error').substring(0, 300);
    updateStep(chatId, stepIdx, 'failed', msg);
    await updateDisplay(chatId);
    return { success: false, output: `❌ ${msg}` };
  }
}

// ─── Tool Implementations ───────────────────────────────────

function toolRunShell(command: string, signal?: AbortSignal | null): Promise<ToolResult> {
  return new Promise((resolve) => {
    console.log(`[Shell] ${command.substring(0, 200)}`);
    const child = exec(command, {
      encoding: 'utf-8',
      timeout: 60000,
      cwd: WORK_DIR,
      maxBuffer: 2 * 1024 * 1024,
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
    return { success: true, output: `✅ Created: ${filePath} (${content.length} chars)` };
  } catch (e: any) { return { success: false, output: `❌ ${e.message}` }; }
}

function toolCreateProject(name: string, desc: string, files: any): ToolResult {
  try {
    const dir = join(WORK_DIR, name);
    if (existsSync(dir)) rmSync(dir, { recursive: true });
    mkdirSync(dir, { recursive: true });

    let list: Array<{ path: string; content: string }>;
    if (typeof files === 'string') {
      try { list = JSON.parse(files); } catch { return { success: false, output: '❌ Invalid JSON for files' }; }
    } else list = files;

    if (!Array.isArray(list)) return { success: false, output: '❌ files must be an array' };

    const created: string[] = [];
    for (const f of list) {
      const p = f.path || 'file.txt', fp = join(dir, p);
      if (!existsSync(dirname(fp))) mkdirSync(dirname(fp), { recursive: true });
      writeFileSync(fp, f.content || '', 'utf-8');
      created.push(p);
    }
    return { success: true, output: `✅ Project "${name}" (${list.length} files):\n${created.map(f => `  📄 ${f}`).join('\n')}`, data: { projectDir: dir } };
  } catch (e: any) { return { success: false, output: `❌ ${e.message}` }; }
}

function toolPushGithub(repoName: string, desc = '', priv = false): ToolResult {
  try {
    if (!GH_TOKEN) return { success: false, output: '❌ GH_PAT not configured' };

    const createCmd = `curl -s -X POST -H "Authorization: token ${GH_TOKEN}" -H "Accept: application/vnd.github.v3+json" https://api.github.com/user/repos -d '{"name":"${repoName}","description":"${(desc || '').replace(/"/g, '\\"')}","private":${priv}}'`;
    const cr = JSON.parse(execSync(createCmd, { encoding: 'utf-8', timeout: 30000 }));
    if (cr.message?.includes('already exists')) console.log('[GitHub] Repo exists');
    else if (!cr.full_name) return { success: false, output: `❌ GitHub: ${cr.message}` };

    const dir = join(WORK_DIR, repoName);
    if (!existsSync(dir)) return { success: false, output: `❌ Project dir not found: ${repoName}` };

    const url = `https://${GH_TOKEN}@github.com/${GH_USERNAME}/${repoName}.git`;
    execSync(`cd "${dir}" && git init && git add -A && git commit -m "Initial commit from Z.ai Agent" && git branch -M main && git remote add origin "${url}" 2>/dev/null; git remote set-url origin "${url}" && git push -u origin main --force`, { encoding: 'utf-8', timeout: 60000 });
    return { success: true, output: `✅ Pushed!\n🔗 https://github.com/${GH_USERNAME}/${repoName}` };
  } catch (e: any) { return { success: false, output: `❌ ${e.message?.substring(0, 500)}` }; }
}

async function toolSendFile(fp: string, caption: string, chatId: number): Promise<ToolResult> {
  try {
    const fullPath = join(WORK_DIR, fp);
    if (!existsSync(fullPath)) return { success: false, output: `❌ Not found: ${fp}` };
    await sendDocumentBuffer(chatId, Buffer.from(readFileSync(fullPath)), fp.split('/').pop() || 'file', caption);
    return { success: true, output: `✅ Sent: ${fp}` };
  } catch (e: any) { return { success: false, output: `❌ ${e.message}` }; }
}

async function toolSendProjectZip(name: string, caption: string, chatId: number): Promise<ToolResult> {
  try {
    const dir = join(WORK_DIR, name);
    if (!existsSync(dir)) return { success: false, output: `❌ Not found: ${name}` };
    const zp = join(WORK_DIR, `${name}.zip`);
    execSync(`cd "${WORK_DIR}" && zip -r "${name}.zip" "${name}/"`, { encoding: 'utf-8', timeout: 30000 });
    await sendDocumentBuffer(chatId, Buffer.from(readFileSync(zp)), `${name}.zip`, caption || `📦 ${name}`);
    try { rmSync(zp); } catch {}
    return { success: true, output: `✅ ZIP sent: ${name}.zip` };
  } catch (e: any) { return { success: false, output: `❌ ${e.message}` }; }
}

async function toolWebSearch(q: string): Promise<ToolResult> {
  const r = await webSearch(q, 5);
  if (!r.length) return { success: true, output: 'No results found' };
  let o = `🔍 "${q}":\n\n`;
  r.forEach((x, i) => { o += `${i + 1}. ${x.name}\n   ${x.snippet}\n   🔗 ${x.url}\n\n`; });
  return { success: true, output: o, data: r };
}

async function toolGenerateImage(prompt: string, chatId: number): Promise<ToolResult> {
  const b64 = await generateImage(prompt);
  if (b64) {
    const buf = Buffer.from(b64, 'base64');
    const fn = `img_${Date.now()}.png`;
    await sendPhotoBuffer(chatId, buf, fn, `🎨 ${prompt}`);
    writeFileSync(join(WORK_DIR, fn), buf);
    return { success: true, output: `✅ Image generated: ${fn}`, data: { filePath: join(WORK_DIR, fn) } };
  }
  return { success: false, output: '❌ Failed to generate image' };
}

async function toolRunCode(lang: string, code: string, signal?: AbortSignal | null): Promise<ToolResult> {
  const sp = join(WORK_DIR, `_run_${Date.now()}`);
  if (!existsSync(WORK_DIR)) mkdirSync(WORK_DIR, { recursive: true });
  const l = lang.toLowerCase();
  let cmd: string;
  if (l === 'javascript' || l === 'js') { writeFileSync(sp + '.js', code, 'utf-8'); cmd = `node "${sp}.js"`; }
  else if (l === 'python' || l === 'py') { writeFileSync(sp + '.py', code, 'utf-8'); cmd = `python3 "${sp}.py"`; }
  else if (l === 'bash' || l === 'sh') { writeFileSync(sp + '.sh', code, 'utf-8'); cmd = `bash "${sp}.sh"`; }
  else if (l === 'html') { writeFileSync(sp + '.html', code, 'utf-8'); return { success: true, output: `✅ HTML created at ${sp}.html` }; }
  else return { success: false, output: `❌ Unsupported language: ${lang}` };
  const r = await toolRunShell(cmd, signal);
  try { rmSync(sp + '.*'); } catch {}
  return r;
}

function toolReadFile(fp: string): ToolResult {
  try {
    const p = join(WORK_DIR, fp);
    if (!existsSync(p)) return { success: false, output: `❌ Not found: ${fp}` };
    const content = readFileSync(p, 'utf-8');
    return { success: true, output: content.substring(0, 8000), data: { content } };
  } catch (e: any) { return { success: false, output: `❌ ${e.message}` }; }
}

function toolListFiles(project?: string): ToolResult {
  try {
    const d = project ? join(WORK_DIR, project) : WORK_DIR;
    if (!existsSync(d)) return { success: false, output: `❌ Directory not found` };
    function ls(dir: string, pfx = ''): string[] {
      const r: string[] = [];
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.git' || e.name === '.next') continue;
        if (e.isDirectory()) { r.push(`${pfx}📂 ${e.name}/`); r.push(...ls(join(dir, e.name), pfx + '  ')); }
        else r.push(`${pfx}📄 ${e.name} (${(statSync(join(dir, e.name)).size / 1024).toFixed(1)}KB)`);
      }
      return r;
    }
    const f = ls(d);
    return { success: true, output: `📂 ${f.length} items:\n${f.slice(0, 80).join('\n')}`, data: { files: f } };
  } catch (e: any) { return { success: false, output: `❌ ${e.message}` }; }
}

function toolEditFile(fp: string, old: string, rep: string): ToolResult {
  try {
    const p = join(WORK_DIR, fp);
    if (!existsSync(p)) return { success: false, output: `❌ Not found: ${fp}` };
    let c = readFileSync(p, 'utf-8');
    if (!c.includes(old)) return { success: false, output: `❌ Text not found in ${fp}` };
    writeFileSync(p, c.replace(old, rep), 'utf-8');
    return { success: true, output: `✅ Edited: ${fp}` };
  } catch (e: any) { return { success: false, output: `❌ ${e.message}` }; }
}

// ─── Tool Call Parser ──────────────────────────────────────────

export interface ParsedToolCall { tool: string; params: Record<string, any>; }

export function parseToolCalls(text: string): ParsedToolCall[] {
  const calls: ParsedToolCall[] = [];

  // Match: <tool_call name="xxx">...<param name="yyy">value</param>...</tool_call=>
  const regex = /<tool_call\s+name="([^"]+)">([\s\S]*?)<\/tool_call[=\s]*>/g;
  let m;
  while ((m = regex.exec(text)) !== null) {
    const toolName = m[1], block = m[2], params: Record<string, any> = {};
    // Parse <param name="x">value</param>
    const pr = /<param\s+name="([^"]+)">([\s\S]*?)<\/param>/g;
    let pm;
    while ((pm = pr.exec(block)) !== null) params[pm[1]] = pm[2].trim();
    // Fallback: try JSON
    if (!Object.keys(params).length) {
      try { Object.assign(params, JSON.parse(block.trim())); } catch {}
    }
    if (Object.keys(params).length > 0 || AGENT_TOOLS.some(t => t.name === toolName)) {
      calls.push({ tool: toolName, params });
    }
  }

  // Also try alternate format without proper closing tag
  if (calls.length === 0) {
    const altRegex = /<tool_call\s+name="([^"]+)">([\s\S]*?)(?:<\/tool_call[=\s]*>|$)/g;
    let am;
    while ((am = altRegex.exec(text)) !== null) {
      const toolName = am[1], block = am[2], params: Record<string, any> = {};
      const pr2 = /<param\s+name="([^"]+)">([\s\S]*?)<\/param>/g;
      let pm2;
      while ((pm2 = pr2.exec(block)) !== null) params[pm2[1]] = pm2[2].trim();
      if (!Object.keys(params).length) { try { Object.assign(params, JSON.parse(block.trim())); } catch {} }
      if (Object.keys(params).length > 0) calls.push({ tool: toolName, params });
    }
  }

  return calls;
}

// ─── System Prompt ─────────────────────────────────────────

export function getAgentSystemPrompt(): string {
  const toolsList = AGENT_TOOLS.map(t => `  - ${t.name}(${t.params.join(', ')}): ${t.desc}`).join('\n');

  return `أنت Z.ai Agent - وكيل ذكي متعدد المهام يعمل على بيئة لينكس. يمكنك بناء تطبيقات كاملة، إنشاء مشاريع، كتابة وتنفيذ كود، بحث الويب، إنشاء صور، وأكثر. أنت تعمل مثل وضع Agent في chat.z.ai.

🔧 الأدوات المتاحة:
${toolsList}

📋 كيفية استخدام الأدوات:
<tool_call name="اسم_الأداة">
<param name="معامل1">قيمة1</param>
<param name="معامل2">قيمة2</param>
</tool_call=

📌 قواعد مهمة:
1. يمكنك استخدام عدة أدوات في رد واحد
2. عند إنشاء مشروع كامل، استخدم create_project مع مصفوفة الملفات
3. بعد إنشاء المشروع، استخدم push_github لرفعه
4. أرسل الملفات عبر send_file أو send_project_zip
5. اكتب كود نظيف ومُعلّق وجاهز للإنتاج
6. أجب باللغة التي يسأل بها المستخدم
7. استخدم run_shell لأوامر النظام (git, npm, pip, ls, cat, etc.)
8. استخدم run_code لتنفيذ كود JavaScript أو Python أو Bash
9. ابحث في الويب عند الحاجة لمعلومات حديثة
10. نفذ المهام خطوة بخطوة - لا تطلب تأكيد المستخدم، نفذ مباشرة
11. عند إنشاء ملفات، اكتب المحتوى الكامل - لا تضع تعليقات مثل "..."
12. دائماً اعرض ما تفعله بالتفصيل قبل استخدام الأداة

💡 أمثلة على المهام:
- بناء موقع ويب كامل (HTML/CSS/JS/React)
- إنشاء تطبيق Next.js مع API
- كتابة سكربت Python أو Node.js
- إنشاء بوت تيليجرام
- رفع مشاريع على GitHub
- تثبيت حزم وتشغيل أوامر`;
}
