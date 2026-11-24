'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const configStore = require('./config');
const gh = require('./github');
const hugo = require('./hugo');
const sync = require('./sync');
const { parseMarkdown, buildMarkdown, localISO, slugify } = require('./md');

let mainWindow = null;

function sendLog(level, text) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('publish-log', { level, text: String(text) });
  }
}

/* 探测 hugo.exe：配置指定 -> 项目根目录 -> PATH */
function findHugo(projectDir, configured) {
  const candidates = [];
  if (configured) candidates.push(configured);
  if (projectDir) {
    candidates.push(path.join(projectDir, 'hugo.exe'));
    candidates.push(path.join(projectDir, 'hugo'));
  }
  candidates.push('hugo');
  for (const c of candidates) {
    try {
      if (c === 'hugo') {
        // 用 where 探测 PATH
        const { execFileSync } = require('child_process');
        const found = execFileSync('where', ['hugo'], { encoding: 'utf8' }).split(/\r?\n/)[0];
        if (found && fs.existsSync(found)) return found;
      } else if (fs.existsSync(c)) {
        return c;
      }
    } catch (_e) { /* 继续尝试下一个 */ }
  }
  return '';
}

/* 运行外部命令，实时把 stdout/stderr 送进日志 */
function runCommand(cmd, args, opts) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env || process.env, windowsHide: true, shell: false });
    let out = '', err = '';
    child.stdout.on('data', d => {
      const s = d.toString(); out += s;
      s.split(/\r?\n/).filter(Boolean).forEach(l => (opts.onLine || sendLog)('info', l));
    });
    child.stderr.on('data', d => {
      const s = d.toString(); err += s;
      s.split(/\r?\n/).filter(Boolean).forEach(l => (opts.onLine || sendLog)('info', l));
    });
    child.on('error', e => resolve({ code: -1, out, err: err + '\n' + e.message }));
    child.on('close', code => resolve({ code, out, err }));
  });
}

/* 从本地项目读 hugo 配置（hugo.yaml/toml） */
function readLocalHugoConfig(projectDir) {
  for (const name of ['hugo.yaml', 'hugo.yml', 'hugo.toml']) {
    const full = path.join(projectDir, name);
    if (fs.existsSync(full)) {
      let content = fs.readFileSync(full, 'utf8');
      // 处理 hugo.yaml 里 baseurl 等可能的 BOM
      content = content.replace(/^\uFEFF/, '');
      const parsed = hugo.parseHugoConfig(content, name);
      if (parsed.baseurl || parsed.permalink) return Object.assign({ name }, parsed);
    }
  }
  return null;
}

function explainError(err) {
  const status = err && err.status;
  const msg = err && err.message ? err.message : String(err);
  if (status === 401 || status === 403) return 'Token 无效或权限不足，请确认 Token 有仓库写权限。';
  if (status === 404) return '仓库不存在，或 Token 没有访问权限。';
  if (status === 409) return '文件冲突，请稍后重试。';
  if (/fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(msg)) {
    return '无法连接 GitHub，请检查代理设置（如 http://127.0.0.1:7890）。';
  }
  return msg;
}

/* ------------- IPC ------------- */

ipcMain.handle('get-state', () => {
  const cfg = configStore.loadConfig();
  let hugoPath = '';
  try { hugoPath = findHugo(cfg.projectDir, cfg.hugoPath); } catch (_e) {}
  return { config: cfg, hasToken: !!configStore.loadToken(), hugoPath };
});

ipcMain.handle('save-settings', (_e, cfg) => configStore.saveConfig(cfg || {}));
ipcMain.handle('save-token', (_e, token) => {
  const r = configStore.saveToken(token);
  return { ok: true, encrypted: !!r.encrypted };
});

ipcMain.handle('verify-token', async (_e, token) => {
  const cfg = configStore.loadConfig();
  try { return { ok: true, user: await gh.verifyToken(token, cfg.proxyUrl) }; }
  catch (err) { return { ok: false, error: explainError(err) }; }
});

ipcMain.handle('list-repos', async () => {
  const cfg = configStore.loadConfig();
  const token = configStore.loadToken();
  try { return { ok: true, repos: await gh.listRepos(token, cfg.proxyUrl) }; }
  catch (err) { return { ok: false, error: explainError(err) }; }
});

/* 探测本地项目是否合法，并读取 hugo 配置 */
ipcMain.handle('inspect-local', async (_e, projectDir) => {
  const dir = String(projectDir || '').trim();
  if (!dir) return { ok: false, error: '请先选择 Hugo 项目目录' };
  if (!fs.existsSync(dir)) return { ok: false, error: '目录不存在：' + dir };
  const contentDir = path.join(dir, 'content');
  const hasContent = fs.existsSync(contentDir);
  const hcfg = readLocalHugoConfig(dir);
  const hugoPath = findHugo(dir, '');
  const publicDir = path.join(dir, 'public');
  return {
    ok: true,
    hasContent,
    hasPublic: fs.existsSync(publicDir),
    hugoPath,
    hugoOk: !!hugoPath,
    baseurl: hcfg ? hcfg.baseurl : '',
    permalink: hcfg ? hcfg.permalink : '',
    hugoConfigName: hcfg ? hcfg.name : ''
  };
});

/* 选择文件夹 / 文件 */
ipcMain.handle('select-dir', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '选择 Hugo 项目根目录（含 hugo.yaml 和 content 的那一层）',
    properties: ['openDirectory']
  });
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
});
ipcMain.handle('select-hugo', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '选择 hugo.exe',
    filters: [{ name: 'Hugo 可执行文件', extensions: ['exe'] }, { name: '所有文件', extensions: ['*'] }],
    properties: ['openFile']
  });
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
});

/* 选择 MD 文件 */
ipcMain.handle('select-file', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '选择一个 Markdown 文件',
    filters: [
      { name: 'Markdown 文件', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
      { name: '所有文件', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
});

/* 分析本地 MD */
ipcMain.handle('analyze-file', async (_e, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('文件不存在');
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = parseMarkdown(raw);
  const f = parsed.fields;
  const base = path.basename(filePath, path.extname(filePath));
  const now = localISO();
  const title = String(f.title || base).trim();
  const toList = v => Array.isArray(v) ? v.filter(Boolean) : (v ? [String(v)] : []);
  return {
    filePath,
    title,
    slug: String(f.slug || '').trim() || slugify(title),
    description: String(f.description || ''),
    date: String(f.date || now),
    categories: toList(f.categories),
    tags: toList(f.tags),
    hasFrontmatter: parsed.hasFrontmatter
  };
});

/* ------------- 发布主流程 ------------- */
ipcMain.handle('publish', async (_e, payload) => {
  const cfg = configStore.loadConfig();
  const token = configStore.loadToken();
  const fail = (stage, message) => ({ ok: false, stage, error: message });

  try {
    // 0. 前置校验
    if (!cfg.projectDir || !fs.existsSync(cfg.projectDir)) return fail('config', '请先在设置里选择 Hugo 项目目录。');
    if (!token) return fail('config', '请先填写并验证 GitHub Token。');
    if (!cfg.owner || !cfg.repo) return fail('config', '请先在设置里选择 GitHub 仓库。');
    if (!payload || !payload.filePath || !fs.existsSync(payload.filePath)) return fail('file', '源文件不存在，请重新选择。');

    const hugoPath = findHugo(cfg.projectDir, cfg.hugoPath);
    if (!hugoPath) return fail('hugo', '找不到 hugo.exe，请在设置里手动指定路径。');
    const contentDir = path.join(cfg.projectDir, 'content');
    const publicDir = path.join(cfg.projectDir, 'public');
    if (!fs.existsSync(contentDir)) return fail('config', '项目目录里没有 content 文件夹，可能选错了目录。');

    // 1. 读 MD，合并 frontmatter
    sendLog('step', '正在准备文章…');
    const raw = fs.readFileSync(payload.filePath, 'utf8');
    const parsed = parseMarkdown(raw);
    const now = localISO();
    const title = String(payload.title || parsed.fields.title || path.basename(payload.filePath, path.extname(payload.filePath))).trim();
    let slug = slugify(payload.slug || parsed.fields.slug || title);
    const date = String(payload.date || parsed.fields.date || now).trim();
    const d = new Date(date);
    const valid = isNaN(d.getTime()) ? new Date() : d;
    const pad = n => String(n).padStart(2, '0');
    const vars = {
      year: String(valid.getFullYear()), month: pad(valid.getMonth() + 1), day: pad(valid.getDate()),
      mmdd: pad(valid.getMonth() + 1) + pad(valid.getDate()), slug, filename: slug, title
    };
    const mergedFields = Object.assign({}, parsed.fields, {
      title, slug, date, lastmod: now,
      description: String(payload.description || ''),
      hidden: false, draft: false,
      categories: Array.isArray(payload.categories) ? payload.categories.filter(Boolean) : [],
      tags: Array.isArray(payload.tags) ? payload.tags.filter(Boolean) : []
    });
    const output = buildMarkdown(parsed, mergedFields);

    // 2. 写入 content（重名自动加 -2、-3…后缀，不覆盖旧文章）
    const baseSlug = slug;
    let contentPath = hugo.buildContentPath(cfg.contentTemplate, vars);
    let suffix = 2;
    while (fs.existsSync(path.join(cfg.projectDir, contentPath))) {
      slug = `${baseSlug}-${suffix++}`;
      vars.slug = slug; vars.filename = slug;
      contentPath = hugo.buildContentPath(cfg.contentTemplate, vars);
    }
    mergedFields.slug = slug;
    const finalOutput = buildMarkdown(parsed, mergedFields);
    const targetFile = path.join(cfg.projectDir, contentPath);
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.writeFileSync(targetFile, finalOutput, 'utf8');
    sendLog('success', `文章已写入：${contentPath}`);

    // 3. 本地 hugo 构建
    sendLog('step', '本地 Hugo 正在构建静态页面…');
    const buildResult = await runCommand(hugoPath, [], { cwd: cfg.projectDir, label: 'hugo' });
    if (buildResult.code !== 0) return fail('build', 'Hugo 构建失败，请查看上方构建日志。');
    if (!fs.existsSync(publicDir)) return fail('build', '构建后没有生成 public 目录。');
    sendLog('success', 'Hugo 构建完成。');

    // 4. 同步到 GitHub（git push，一次推完所有差异）
    sendLog('step', '正在推送静态页面到 GitHub…');
    const syncResult = await sync.syncDirectory({
      localDir: publicDir,
      owner: cfg.owner, repo: cfg.repo, branch: cfg.branch,
      token, proxyUrl: cfg.proxyUrl, gitPath: cfg.gitPath,
      message: `发布：${title}`, onLog: sendLog
    });
    if (!syncResult.ok) return fail('push', syncResult.error);

    // 5. 保存同步时间
    const newCfg = Object.assign({}, cfg, { lastSync: now });
    configStore.saveConfig(newCfg);

    // 6. 生成文章网址
    const articleUrl = hugo.buildArticleUrl(cfg.baseurl, cfg.permalink, Object.assign({}, vars, { slug }));
    sendLog('success', `文章地址：${articleUrl}`);

    return {
      ok: true,
      url: articleUrl,
      slug,
      contentPath,
      uploaded: syncResult.uploaded,
      total: syncResult.total,
      commitUrl: syncResult.commitUrl,
      note: syncResult.uploaded === 0
        ? '页面没有变化（可能已发布过），文章地址如下。'
        : 'GitHub Pages 通常几十秒内更新，稍后刷新即可看到文章。'
    };
  } catch (err) {
    return fail('api', explainError(err));
  }
});

ipcMain.handle('open-external', async (_e, url) => {
  if (/^https?:\/\//i.test(url)) await shell.openExternal(url);
});

/* ------------- 窗口 ------------- */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 940, height: 820, minWidth: 740, minHeight: 620,
    title: 'MD博客发布助手 - 本地版',
    icon: path.join(__dirname, 'app.ico'),
    backgroundColor: '#f6f7f9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
