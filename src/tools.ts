/**
 * Agent Tools - 13 tools with async execution and real-time display
 * Each tool execution updates the Telegram message in real-time
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { exec } from 'child_process';
import { sendDocumentBuffer, sendMessage, sendPhotoBuffer, escapeHtml, truncateText } from './telegram.js';
import { webSearch, generateImage } from './zai.js';
import { addStep, updateStep, updateDisplay, getAbortSignal } from './operations.js';

const WORK_DIR = join(process.cwd(), 'workspace');
const GH_TOKEN = process.env.GH_TOKEN || process.env.GH_PAT || '';
const GH_USERNAME = process.env.GH_USERNAME || '';

export interface ToolResult { success: boolean; output: string; data?: any; }

export const AGENT_TOOLS = [
  { name: 'run_shell', description: 'Execute a shell command', params: ['command'] },
  { name: 'install_package', description: 'Install npm/pip package', params: ['package_name', 'package_manager'] },
  { name: 'create_file', description: 'Create a file with content', params: ['path', 'content'] },
  { name: 'create_project', description: 'Create a complete project', params: ['name', 'description', 'files'] },
  { name: 'send_project_zip', description: 'Package & send project ZIP', params: ['project_name', 'caption'] },
  { name: 'send_file', description: 'Send a file via Telegram', params: ['file_path', 'caption'] },
  { name: 'push_github', description: 'Push project to GitHub', params: ['repo_name', 'description', 'private'] },
  { name: 'web_search', description: 'Search the web', params: ['query'] },
  { name: 'generate_image', description: 'Generate AI image', params: ['prompt'] },
  { name: 'run_code', description: 'Execute JS/Python/Bash code', params: ['language', 'code'] },
  { name: 'read_file', description: 'Read file contents', params: ['path'] },
  { name: 'list_files', description: 'List project files', params: ['project_name'] },
  { name: 'edit_file', description: 'Edit a file', params: ['path', 'old_text', 'new_text'] },
];

/**
 * Execute a tool with real-time display updates
 */
export async function executeTool(toolName: string, params: Record<string, any>, chatId: number): Promise<ToolResult> {
  if (!existsSync(WORK_DIR)) mkdirSync(WORK_DIR, { recursive: true });

  // Add step to display
  const inputPreview = JSON.stringify(params).substring(0, 200);
  const stepIdx = addStep(chatId, toolName, inputPreview);
  await updateDisplay(chatId);

  const signal = getAbortSignal(chatId);

  try {
    let result: ToolResult;

    switch (toolName) {
      case 'run_shell': result = await execShell(params.command, signal); break;
      case 'install_package': result = await execInstall(params.package_name, params.package_manager, signal); break;
      case 'create_file': result = execCreateFile(params.path, params.content); break;
      case 'create_project': result = execCreateProject(params.name, params.description, params.files); break;
      case 'push_github': result = execPushGithub(params.repo_name, params.description, params.private); break;
      case 'send_file': result = await execSendFile(params.file_path, params.caption, chatId); break;
      case 'send_project_zip': result = await execSendProjectZip(params.project_name, params.caption, chatId); break;
      case 'web_search': result = await execWebSearch(params.query); break;
      case 'generate_image': result = await execGenerateImage(params.prompt, chatId); break;
      case 'run_code': result = await execRunCode(params.language, params.code, signal); break;
      case 'read_file': result = execReadFile(params.path); break;
      case 'list_files': result = execListFiles(params.project_name); break;
      case 'edit_file': result = execEditFile(params.path, params.old_text, params.new_text); break;
      default: result = { success: false, output: `Unknown tool: ${toolName}` };
    }

    updateStep(chatId, stepIdx, result.success ? 'done' : 'failed', result.output);
    await updateDisplay(chatId);
    return result;
  } catch (e: any) {
    const msg = e.name === 'AbortError' ? 'تم الإيقاف بواسطة المستخدم' : e.message?.substring(0, 300);
    updateStep(chatId, stepIdx, 'failed', msg);
    await updateDisplay(chatId);
    return { success: false, output: `❌ ${msg}` };
  }
}

// ─── Tool Implementations ───────────────────────────────────

function execShell(command: string, signal?: AbortSignal | null): Promise<ToolResult> {
  return new Promise((resolve) => {
    console.log(`[Shell] ${command.substring(0, 200)}`);
    const child = exec(command, { encoding: 'utf-8', timeout: 30000, cwd: WORK_DIR, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, output: `Exit ${error.code}:\n${(stdout || '') + (stderr || '')}`.substring(0, 3000) });
      } else {
        resolve({ success: true, output: (stdout || '(No output)').substring(0, 5000) });
      }
    });
    if (signal) {
      signal.addEventListener('abort', () => { try { child.kill('SIGTERM'); } catch {} });
    }
  });
}

function execInstall(pkg: string, mgr = 'npm', signal?: AbortSignal | null): Promise<ToolResult> {
  const cmd = (mgr === 'pip' || mgr === 'python') ? `pip3 install ${pkg}` : `npm install ${pkg}`;
  return execShell(cmd, signal);
}

function execCreateFile(filePath: string, content: string): ToolResult {
  try {
    const fullPath = join(WORK_DIR, filePath);
    if (!existsSync(dirname(fullPath))) mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, 'utf-8');
    return { success: true, output: `✅ Created: ${filePath} (${content.length} chars)` };
  } catch (e: any) { return { success: false, output: `❌ ${e.message}` }; }
}

function execCreateProject(name: string, desc: string, files: any): ToolResult {
  try {
    const dir = join(WORK_DIR, name);
    if (existsSync(dir)) rmSync(dir, { recursive: true });
    mkdirSync(dir, { recursive: true });
    let list: Array<{ path: string; content: string }>;
    if (typeof files === 'string') { try { list = JSON.parse(files); } catch { return { success: false, output: '❌ Bad JSON' }; } } else list = files;
    if (!Array.isArray(list)) return { success: false, output: '❌ files must be array' };
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

function execPushGithub(repoName: string, desc = '', priv = false): ToolResult {
  try {
    if (!GH_TOKEN) return { success: false, output: '❌ GH_TOKEN not set' };
    const { execSync } = require('child_process');
    const createCmd = `curl -s -X POST -H "Authorization: token ${GH_TOKEN}" -H "Accept: application/vnd.github.v3+json" https://api.github.com/user/repos -d '{"name":"${repoName}","description":"${desc.replace(/"/g, '\\"')}","private":${priv}}'`;
    const cr = JSON.parse(execSync(createCmd, { encoding: 'utf-8', timeout: 30000 }));
    if (cr.message?.includes('already exists')) console.log('Repo exists');
    else if (!cr.full_name) return { success: false, output: `❌ ${cr.message}` };
    const dir = join(WORK_DIR, repoName);
    if (!existsSync(dir)) return { success: false, output: `❌ Project dir not found: ${repoName}` };
    const url = `https://${GH_TOKEN}@github.com/${GH_USERNAME}/${repoName}.git`;
    execSync(`cd "${dir}" && git init && git add -A && git commit -m "Initial commit" && git branch -M main && git remote add origin "${url}" 2>/dev/null; git remote set-url origin "${url}" && git push -u origin main --force`, { encoding: 'utf-8', timeout: 60000 });
    return { success: true, output: `✅ Pushed!\n🔗 https://github.com/${GH_USERNAME}/${repoName}`, data: { repoUrl: `https://github.com/${GH_USERNAME}/${repoName}` } };
  } catch (e: any) { return { success: false, output: `❌ ${e.message?.substring(0, 500)}` }; }
}

async function execSendFile(fp: string, caption: string, chatId: number): Promise<ToolResult> {
  try {
    const fullPath = join(WORK_DIR, fp);
    if (!existsSync(fullPath)) return { success: false, output: `❌ Not found: ${fp}` };
    await sendDocumentBuffer(chatId, Buffer.from(readFileSync(fullPath)), fp.split('/').pop() || 'file', caption);
    return { success: true, output: `✅ Sent: ${fp}` };
  } catch (e: any) { return { success: false, output: `❌ ${e.message}` }; }
}

async function execSendProjectZip(name: string, caption: string, chatId: number): Promise<ToolResult> {
  try {
    const dir = join(WORK_DIR, name);
    if (!existsSync(dir)) return { success: false, output: `❌ Not found: ${name}` };
    const { execSync } = require('child_process');
    const zp = join(WORK_DIR, `${name}.zip`);
    execSync(`cd "${WORK_DIR}" && zip -r "${name}.zip" "${name}/"`, { encoding: 'utf-8', timeout: 30000 });
    await sendDocumentBuffer(chatId, Buffer.from(readFileSync(zp)), `${name}.zip`, caption || `📦 ${name}`);
    try { rmSync(zp); } catch {}
    return { success: true, output: `✅ ZIP sent: ${name}.zip` };
  } catch (e: any) { return { success: false, output: `❌ ${e.message}` }; }
}

async function execWebSearch(q: string): Promise<ToolResult> {
  const r = await webSearch(q, 5);
  if (!r.length) return { success: true, output: 'No results' };
  let o = `🔍 "${q}":\n\n`;
  r.forEach((x, i) => { o += `${i + 1}. ${x.name}\n   ${x.snippet}\n   🔗 ${x.url}\n\n`; });
  return { success: true, output: o, data: r };
}

async function execGenerateImage(prompt: string, chatId: number): Promise<ToolResult> {
  const b64 = await generateImage(prompt);
  if (b64) {
    const buf = Buffer.from(b64, 'base64');
    const fn = `img_${Date.now()}.png`;
    await sendPhotoBuffer(chatId, buf, fn, `🎨 ${prompt}`);
    writeFileSync(join(WORK_DIR, fn), buf);
    return { success: true, output: `✅ Image: ${fn}`, data: { filePath: join(WORK_DIR, fn) } };
  }
  return { success: false, output: '❌ Failed to generate' };
}

async function execRunCode(lang: string, code: string, signal?: AbortSignal | null): Promise<ToolResult> {
  const sp = join(WORK_DIR, `_run_${Date.now()}`);
  let cmd: string;
  if (!existsSync(WORK_DIR)) mkdirSync(WORK_DIR, { recursive: true });
  const l = lang.toLowerCase();
  if (l === 'javascript' || l === 'js') { writeFileSync(sp + '.js', code, 'utf-8'); cmd = `node "${sp}.js"`; }
  else if (l === 'python' || l === 'py') { writeFileSync(sp + '.py', code, 'utf-8'); cmd = `python3 "${sp}.py"`; }
  else if (l === 'bash' || l === 'sh') { writeFileSync(sp + '.sh', code, 'utf-8'); cmd = `bash "${sp}.sh"`; }
  else if (l === 'html') { writeFileSync(sp + '.html', code, 'utf-8'); return { success: true, output: `✅ HTML created` }; }
  else return { success: false, output: `❌ Unsupported: ${lang}` };
  const r = await execShell(cmd, signal);
  try { rmSync(sp + '.*'); } catch {}
  return r;
}

function execReadFile(fp: string): ToolResult {
  try {
    const p = join(WORK_DIR, fp);
    if (!existsSync(p)) return { success: false, output: `❌ Not found: ${fp}` };
    return { success: true, output: readFileSync(p, 'utf-8').substring(0, 8000), data: { content: readFileSync(p, 'utf-8') } };
  } catch (e: any) { return { success: false, output: `❌ ${e.message}` }; }
}

function execListFiles(project?: string): ToolResult {
  try {
    const d = project ? join(WORK_DIR, project) : WORK_DIR;
    if (!existsSync(d)) return { success: false, output: `❌ Not found` };
    function ls(dir: string, pfx = ''): string[] {
      const r: string[] = [];
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        if (e.isDirectory()) { r.push(`${pfx}📂 ${e.name}/`); r.push(...ls(join(dir, e.name), pfx + '  ')); }
        else r.push(`${pfx}📄 ${e.name} (${(statSync(join(dir, e.name)).size / 1024).toFixed(1)}KB)`);
      }
      return r;
    }
    const f = ls(d);
    return { success: true, output: `📂 ${f.length} files:\n${f.slice(0, 80).join('\n')}`, data: { files: f } };
  } catch (e: any) { return { success: false, output: `❌ ${e.message}` }; }
}

function execEditFile(fp: string, old: string, rep: string): ToolResult {
  try {
    const p = join(WORK_DIR, fp);
    if (!existsSync(p)) return { success: false, output: `❌ Not found: ${fp}` };
    let c = readFileSync(p, 'utf-8');
    if (!c.includes(old)) return { success: false, output: `❌ Text not found` };
    writeFileSync(p, c.replace(old, rep), 'utf-8');
    return { success: true, output: `✅ Edited: ${fp}` };
  } catch (e: any) { return { success: false, output: `❌ ${e.message}` }; }
}

// ─── Tool Call Parser ──────────────────────────────────────────

export interface ParsedToolCall { tool: string; params: Record<string, any>; }

export function parseToolCalls(text: string): ParsedToolCall[] {
  const calls: ParsedToolCall[] = [];
  // Match various closing tag formats: </tool_call=>, </tool_call= >, </tool_call >, </tool_call=>
  const regex = /<tool_call\s+name="([^"]+)">([\s\S]*?)<\/tool_call[=\s]*>/g;
  let m;
  while ((m = regex.exec(text)) !== null) {
    const toolName = m[1], block = m[2], params: Record<string, any> = {};
    const pr = /<param\s+name="([^"]+)">([\s\S]*?)<\/param>/g;
    let pm;
    while ((pm = pr.exec(block)) !== null) params[pm[1]] = pm[2].trim();
    if (!Object.keys(params).length) { try { Object.assign(params, JSON.parse(block.trim())); } catch {} }
    calls.push({ tool: toolName, params });
  }
  // Also try alternate format without closing tag content
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

/**
 * Get the agent system prompt with all tool descriptions
 */
export function getAgentSystemPrompt(): string {
  const tools = AGENT_TOOLS.map(t => `  - ${t.name}(${t.params.join(', ')}): ${t.description}`).join('\n');
  return `أنت وكيل ذكي متعدد المهام مثل Super Z من Z.ai. يمكنك بناء تطبيقات، إنشاء مشاريع، كتابة كود، بحث الويب، إنشاء صور، وأكثر.

🔧 الأدوات المتاحة:
${tools}

📋 كيفية استخدام الأدوات:
<tool_call name="اسم_الأداة">
<param name="معامل1">قيمة1</param>
<param name="معامل2">قيمة2</param>
</tool_call=

📌 قواعد مهمة:
1. يمكنك استخدام عدة أدوات في رد واحد
2. عند إنشاء مشروع كامل، استخدم create_project مع كل الملفات
3. بعد إنشاء المشروع، استخدم push_github لرفعه
4. أرسل الملفات عبر send_file أو send_project_zip
5. اكتب كود نظيف ومُعلّق وجاهز للإنتاج
6. أجب باللغة التي يسأل بها المستخدم
7. استخدم run_shell لأوامر النظام (git, npm, pip, ls, cat, etc.)
8. استخدم run_code لتنفيذ كود JavaScript أو Python
9. ابحث في الويب عند الحاجة لمعلومات حديثة
10. نفذ المهام خطوة بخطوة وأظهر التقدم

💡 أمثلة:
- بناء موقع ويب كامل (HTML/CSS/JS)
- إنشاء تطبيق React/Next.js
- كتابة سكربت Python أو Node.js
- إنشاء بوت تيليجرام
- رفع مشاريع على GitHub`;
}
