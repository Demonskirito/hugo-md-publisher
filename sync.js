'use strict';

/* 本地 public 目录 → GitHub 仓库的同步（用 git push）
   为什么用 git 而不是 GitHub API 逐个传文件：
   - API 传几百个文件要经代理发几百次请求，慢且代理容易中途抖动失败；
   - git push 一次传完所有差异，秒级完成，稳定可靠。
   凭据用 Token 内嵌在 remote URL 里（x-access-token:TOKEN@github.com），
   不依赖本机 git 凭据配置，这样换台电脑也能用。 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function findGit(configured) {
  const { execFileSync } = require('child_process');
  const candidates = [];
  if (configured) candidates.push(configured);
  candidates.push(
    'C:\\Program Files\\Git\\bin\\git.exe',
    'C:\\Program Files\\Git\\cmd\\git.exe',
    process.env.LOCALAPPDATA + '\\Programs\\Git\\cmd\\git.exe'
  );
  candidates.push('git');
  for (const c of candidates) {
    try {
      if (c === 'git') {
        const found = execFileSync('where', ['git'], { encoding: 'utf8' }).split(/\r?\n/)[0];
        if (found && fs.existsSync(found)) return found;
      } else if (fs.existsSync(c)) return c;
    } catch (_e) { /* 继续 */ }
  }
  return 'git'; // 最后兜底交给 PATH
}

function run(git, args, opts) {
  return new Promise(resolve => {
    const child = spawn(git, args, {
      cwd: opts.cwd,
      env: opts.env || process.env,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d.toString(); });
    child.stderr.on('data', d => { err += d.toString(); });
    child.on('error', e => resolve({ code: -1, out, err: err + '\n' + e.message }));
    child.on('close', code => resolve({ code, out, err }));
  });
}

/* 同步目录到远端仓库。
   - 若 localDir 本身已是 git 仓库且有 origin，直接用它的 origin。
   - 否则用传入的 token/owner/repo 构造带凭据的 remote。 */
async function syncDirectory(opts) {
  const {
    localDir, owner, repo, branch = 'main', token,
    proxyUrl, gitPath, message, onLog, forceRemote
  } = opts;
  const log = onLog || (() => {});
  const git = findGit(gitPath);

  // 代理环境：git 走 -c http.proxy，并清除冲突的环境变量
  const env = Object.assign({}, process.env);
  ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY'].forEach(k => delete env[k]);
  const proxyArgs = proxyUrl ? ['-c', `http.proxy=${proxyUrl}`, '-c', `https.proxy=${proxyUrl}`] : [];

  const stat = (...args) => run(git, [...proxyArgs, ...args], { cwd: localDir, env });

  // 1. 确认是 git 仓库；不是就初始化
  const isRepo = await stat('rev-parse', '--is-inside-work-tree');
  if (isRepo.code !== 0) {
    log('info', 'public 目录还不是 Git 仓库，正在初始化…');
    const init = await stat('init');
    if (init.code !== 0) return { ok: false, error: 'git init 失败：' + init.err };
  }

  // 2. 设置带凭据的 remote URL（覆盖旧的），保证换电脑也能推
  const remoteUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  let r = await stat('remote', 'get-url', 'origin');
  if (r.code === 0) {
    await stat('remote', 'set-url', 'origin', remoteUrl);
  } else {
    await stat('remote', 'add', 'origin', remoteUrl);
  }

  // 3. 暂存所有变化
  log('info', '正在暂存文件…');
  r = await stat('add', '-A');
  if (r.code !== 0) return { ok: false, error: 'git add 失败：' + r.err };

  // 4. 检查是否有变化
  r = await stat('diff', '--cached', '--quiet');
  if (r.code === 0) {
    log('success', '没有文件变化，无需提交。');
    return { ok: true, uploaded: 0, total: countFiles(localDir), commitUrl: null, message: '没有文件变化' };
  }

  // 5. 提交
  const commitMsg = message || `发布：更新博客静态页面（${new Date().toLocaleString('zh-CN')}）`;
  r = await stat('commit', '-m', commitMsg);
  if (r.code !== 0) {
    // 可能因首次无 user.email/name 失败，设置局部配置后重试
    if (/user.email|user.name|identity/i.test(r.err)) {
      await stat('config', 'user.email', 'publisher@local');
      await stat('config', 'user.name', 'MD Publisher');
      r = await stat('commit', '-m', commitMsg);
    }
    if (r.code !== 0) return { ok: false, error: 'git commit 失败：' + r.err };
  }
  log('info', '提交已创建，正在同步远端改动…');

  // 6. 推送前先 fetch + rebase，避免远端有新提交导致 fetch first 失败
  //    用 -c credential.helper= 防止 git 弹出凭据交互
  const syncArgs = [...proxyArgs, '-c', 'credential.helper=', 'fetch', 'origin', branch];
  let fr = await run(git, syncArgs, { cwd: localDir, env });
  if (fr.code === 0) {
    // 尝试把本地提交接到远端之后
    const rb = await run(git, [...proxyArgs, 'rebase', `origin/${branch}`], { cwd: localDir, env });
    if (rb.code !== 0) {
      await run(git, ['rebase', '--abort'], { cwd: localDir, env });
      return { ok: false, error: '与远端合并冲突，已回退。请手动处理 public 目录的冲突。' };
    }
  }
  // rebase 可能改变 HEAD，重新确认分支名
  const pushArgs = [...proxyArgs, '-c', 'credential.helper=', 'push', 'origin', `HEAD:${branch}`];
  const push = await run(git, pushArgs, { cwd: localDir, env });
  if (push.code !== 0) {
    return { ok: false, error: '推送失败：' + (push.err || push.out).slice(-500) };
  }

  log('success', '静态页面已推送到 GitHub。');
  const count = countFiles(localDir);
  return { ok: true, uploaded: count, total: count, commitUrl: '', message: '已推送' };
}

function countFiles(dir) {
  let n = 0;
  function walk(d) {
    for (const name of fs.readdirSync(d)) {
      if (name === '.git') continue;
      const full = path.join(d, name);
      let st;
      try { st = fs.statSync(full); } catch (_e) { continue; }
      if (st.isDirectory()) walk(full); else if (st.isFile()) n++;
    }
  }
  walk(dir);
  return n;
}

module.exports = { syncDirectory, findGit, countFiles };
