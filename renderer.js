'use strict';

const $ = id => document.getElementById(id);
const api = window.mdLocal;

let state = { filePath: '', config: null, hasToken: false, publishing: false, resultUrl: '' };

function toast(msg, ms) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), ms || 2400);
}

function splitList(v) {
  return String(v || '').split(/[,，]/).map(s => s.trim()).filter(Boolean);
}

function appendLog(level, text) {
  const box = $('logBox');
  const line = document.createElement('div');
  line.className = `line ${level}`;
  const prefix = { step: '▸ ', success: '✓ ', warn: '! ', error: '✗ ', info: '  ' }[level] || '  ';
  line.textContent = prefix + text;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}

function updateStatus() {
  const bar = $('statusBar');
  const dot = $('statusDot');
  const text = $('statusText');
  const action = $('statusAction');
  const cfg = state.config || {};
  const ready = state.hasToken && cfg.projectDir && cfg.owner && cfg.repo;
  dot.className = 'status-dot ' + (ready ? 'ok' : 'bad');
  if (!cfg.projectDir) {
    text.textContent = '尚未配置本地 Hugo 项目 — 请先设置';
    action.textContent = '去配置';
  } else if (!state.hasToken) {
    text.textContent = '尚未连接 GitHub — 请先填写 Token';
    action.textContent = '去配置';
  } else if (!cfg.owner || !cfg.repo) {
    text.textContent = '已连接 — 请选择仓库';
    action.textContent = '去选择';
  } else {
    text.textContent = `已就绪：${cfg.projectDir.split(/[\\/]/).pop()} → ${cfg.owner}/${cfg.repo}`;
    action.textContent = '修改';
  }
}

function showFileInfo(info) {
  state.filePath = info.filePath;
  $('dropLabel').textContent = '已选择文件';
  $('fileBadgeText').textContent = info.filePath;
  $('fileBadge').classList.remove('hidden');
  $('fTitle').value = info.title || '';
  $('fSlug').value = info.slug || '';
  $('fCategories').value = (info.categories || []).join(', ');
  $('fTags').value = (info.tags || []).join(', ');
  $('fDate').value = info.date || '';
  $('fDescription').value = info.description || '';
  updateSlugHint();
  const notice = $('fmNotice');
  notice.textContent = info.hasFrontmatter
    ? '已读取文件中的 frontmatter，缺失字段会自动补全。'
    : '该文件没有 frontmatter，工具会自动生成。';
  notice.className = 'notice' + (info.hasFrontmatter ? '' : ' warn');
  $('cardForm').classList.remove('locked');
}

function updateSlugHint() {
  const cfg = state.config || {};
  const base = String(cfg.baseurl || '').replace(/\/+$/, '');
  const perm = String(cfg.permalink || '/p/{slug}/');
  const slug = $('fSlug').value.trim() || 'your-slug';
  let path = perm.replace(/\{slug\}/g, encodeURIComponent(slug)).replace(/:slug/g, encodeURIComponent(slug));
  if (!path.startsWith('/')) path = '/' + path;
  $('slugHint').textContent = base ? `预计地址：${base}${path}` : '配置里读取到域名后会显示预计地址';
}

async function handleFile(filePath) {
  if (!filePath) return;
  if (!/\.(md|markdown|mdown|mkd)$/i.test(filePath)) { toast('请选择 .md 文件'); return; }
  try {
    showFileInfo(await api.analyzeFile(filePath));
    $('cardForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (err) {
    toast('读取失败：' + err.message);
  }
}

async function publish() {
  if (state.publishing) return;
  if (!state.filePath) { toast('请先选择文件'); return; }
  state.publishing = true;
  $('publishBtn').disabled = true;
  $('publishBtn').textContent = '构建发布中…';
  $('cardResult').classList.add('hidden');
  $('cardLog').classList.remove('hidden');
  $('logBox').innerHTML = '';
  $('cardLog').scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    const r = await api.publish({
      filePath: state.filePath,
      title: $('fTitle').value.trim(),
      slug: $('fSlug').value.trim(),
      description: $('fDescription').value.trim(),
      date: $('fDate').value.trim(),
      categories: splitList($('fCategories').value),
      tags: splitList($('fTags').value)
    });
    if (r.ok) {
      state.resultUrl = r.url;
      $('resultMsg').textContent = r.note;
      $('resultPath').textContent = `文章地址：${r.url}\n本次上传 ${r.uploaded}/${r.total} 个文件`;
      $('cardResult').classList.remove('hidden');
      $('cardResult').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      appendLog('error', '发布失败：' + r.error);
      toast('发布失败，请查看日志');
    }
  } catch (err) {
    appendLog('error', '异常：' + (err && err.message || err));
  } finally {
    state.publishing = false;
    $('publishBtn').disabled = false;
    $('publishBtn').textContent = '🚀 构建并发布';
  }
}

/* ------------- 设置弹窗 ------------- */
async function openSettings() {
  const s = await api.getState();
  state.config = s.config;
  state.hasToken = s.hasToken;
  updateStatus();

  $('sToken').value = '';
  $('sProjectDir').value = s.config.projectDir || '';
  $('sHugoPath').value = s.config.hugoPath || '';
  $('sGitPath').value = s.config.gitPath || '';
  $('sProxy').value = s.config.proxyUrl || '';
  $('sOwner').value = s.config.owner || '';
  $('sRepo').value = s.config.repo || '';
  $('sBranch').value = s.config.branch || 'main';
  $('sBaseurl').value = s.config.baseurl || '';
  $('sPermalink').value = s.config.permalink || '/p/{slug}/';
  $('sTemplate').value = s.config.contentTemplate || 'content/post/{year}/{mmdd}-{slug}/index.md';
  $('localResult').textContent = '';
  $('verifyResult').textContent = '';

  $('settingsModal').classList.remove('hidden');
  if (s.config.projectDir) inspectLocal();
  if (s.hasToken) loadRepos();
}

function closeSettings() { $('settingsModal').classList.add('hidden'); }

async function inspectLocal() {
  const dir = $('sProjectDir').value.trim();
  const el = $('localResult');
  if (!dir) { el.className = 'verify-result bad'; el.textContent = '请先选择项目目录'; return; }
  el.className = 'verify-result';
  el.textContent = '检测中…';
  const r = await api.inspectLocal(dir);
  if (!r.ok) { el.className = 'verify-result bad'; el.textContent = '✗ ' + r.error; return; }
  const problems = [];
  if (!r.hasContent) problems.push('缺少 content 目录');
  if (!r.hugoOk) problems.push('未找到 hugo.exe');
  if (problems.length) {
    el.className = 'verify-result bad';
    el.textContent = '✗ ' + problems.join('、') + '，请检查目录';
  } else {
    el.className = 'verify-result ok';
    el.textContent = `✓ 检测通过（${r.hugoConfigName || '未找到配置文件'}，域名：${r.baseurl || '未读取到'}，网址格式：${r.permalink || '默认'}）`;
  }
  if (r.baseurl) $('sBaseurl').value = r.baseurl;
  if (r.permalink) $('sPermalink').value = r.permalink;
  if (r.hugoPath && !$('sHugoPath').value.trim()) $('sHugoPath').value = r.hugoPath;
  updateSlugHint();
}

async function doVerify() {
  const token = $('sToken').value.trim();
  const el = $('verifyResult');
  if (!token) { el.className = 'verify-result bad'; el.textContent = '请先粘贴 Token'; return; }
  el.className = 'verify-result';
  el.textContent = '验证中…';
  const r = await api.verifyToken(token);
  if (r.ok) {
    el.className = 'verify-result ok';
    el.textContent = `✓ 验证成功：${r.user.name}`;
    state.hasToken = true;
    await api.saveToken(token);
    loadRepos();
  } else {
    el.className = 'verify-result bad';
    el.textContent = '✗ ' + r.error;
  }
}

async function loadRepos() {
  const r = await api.listRepos();
  const sel = $('repoSelect');
  if (!r.ok) { sel.innerHTML = '<option value="">拉取仓库失败：' + r.error + '</option>'; return; }
  sel.innerHTML = '<option value="">请选择仓库</option>' + r.repos.map(repo => {
    const val = `${repo.owner}|${repo.name}`;
    const selected = state.config && state.config.owner === repo.owner && state.config.repo === repo.name;
    return `<option value="${val}"${selected ? ' selected' : ''}>${repo.fullName}${repo.private ? '（私有）' : ''}</option>`;
  }).join('');
}

function applyRepoSelection() {
  const val = $('repoSelect').value;
  if (!val) return;
  const [owner, repo] = val.split('|');
  $('sOwner').value = owner;
  $('sRepo').value = repo;
}

async function doSaveSettings() {
  applyRepoSelection();
  const cfg = {
    projectDir: $('sProjectDir').value.trim(),
    hugoPath: $('sHugoPath').value.trim(),
    gitPath: $('sGitPath').value.trim(),
    contentTemplate: $('sTemplate').value.trim() || 'content/post/{year}/{mmdd}-{slug}/index.md',
    owner: $('sOwner').value.trim(),
    repo: $('sRepo').value.trim(),
    branch: $('sBranch').value.trim() || 'main',
    baseurl: $('sBaseurl').value.trim(),
    permalink: $('sPermalink').value.trim() || '/p/{slug}/',
    proxyUrl: $('sProxy').value.trim()
  };
  await api.saveSettings(cfg);
  state.config = cfg;
  closeSettings();
  updateStatus();
  updateSlugHint();
  toast('设置已保存');
}

/* ------------- 事件 ------------- */
$('chooseBtn').addEventListener('click', async () => handleFile(await api.selectFile()));
$('changeBtn').addEventListener('click', async () => handleFile(await api.selectFile()));
$('publishBtn').addEventListener('click', publish);
$('fSlug').addEventListener('input', updateSlugHint);
$('openLinkBtn').addEventListener('click', () => state.resultUrl && api.openExternal(state.resultUrl));
$('againBtn').addEventListener('click', () => {
  state.filePath = ''; state.resultUrl = '';
  $('fileBadge').classList.add('hidden');
  $('dropLabel').textContent = '拖拽 .md 文件到这里';
  $('cardForm').classList.add('locked');
  $('cardLog').classList.add('hidden');
  $('cardResult').classList.add('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

$('settingsBtn').addEventListener('click', openSettings);
$('statusAction').addEventListener('click', openSettings);
$('cancelSettings').addEventListener('click', closeSettings);
$('closeSettingsX').addEventListener('click', closeSettings);
document.querySelector('.modal-mask').addEventListener('click', closeSettings);
$('pickProjectBtn').addEventListener('click', async () => {
  const dir = await api.selectDir();
  if (dir) { $('sProjectDir').value = dir; inspectLocal(); }
});
$('inspectLocalBtn').addEventListener('click', inspectLocal);
$('pickHugoBtn').addEventListener('click', async () => {
  const p = await api.selectHugo();
  if (p) $('sHugoPath').value = p;
});
$('verifyBtn').addEventListener('click', doVerify);
$('refreshReposBtn').addEventListener('click', loadRepos);
$('repoSelect').addEventListener('change', applyRepoSelection);
$('saveSettings').addEventListener('click', doSaveSettings);

const dz = $('dropzone');
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
dz.addEventListener('drop', e => {
  e.preventDefault(); dz.classList.remove('dragover');
  const f = e.dataTransfer.files[0];
  if (f) handleFile(api.getPathForFile(f));
});
dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') $('chooseBtn').click(); });

if (api && api.onLog) api.onLog(entry => appendLog(entry.level, entry.text));

(async () => {
  const s = await api.getState();
  state.config = s.config;
  state.hasToken = s.hasToken;
  updateStatus();
  updateSlugHint();
})();
