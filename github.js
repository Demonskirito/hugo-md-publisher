'use strict';

const { fetch, ProxyAgent, Agent } = require('undici');

const API = 'https://api.github.com';
let dispatcherConfigured = false;
let currentProxy = '';

function makeDispatcher(proxyUrl) {
  const proxy = String(proxyUrl || '').trim();
  if (proxy) return new ProxyAgent(proxy);
  return new Agent({ connect: { timeout: 20000 } });
}

function ensureDispatcher(proxyUrl) {
  const proxy = String(proxyUrl || '').trim();
  if (!dispatcherConfigured || proxy !== currentProxy) {
    const { setGlobalDispatcher } = require('undici');
    setGlobalDispatcher(makeDispatcher(proxy));
    dispatcherConfigured = true;
    currentProxy = proxy;
  }
}

async function request(token, method, endpoint, body, proxyUrl) {
  ensureDispatcher(proxyUrl);
  const url = endpoint.startsWith('http') ? endpoint : `${API}${endpoint}`;
  const headers = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'MD-Publisher-Cloud',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const options = { method, headers, headersTimeout: 30000, bodyTimeout: 60000 };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_e) { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(data && data.message ? data.message : `GitHub API 返回 ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/* 验证 Token 是否有效，返回用户信息 */
async function verifyToken(token, proxyUrl) {
  const user = await request(token, 'GET', '/user', undefined, proxyUrl);
  return { login: user.login, name: user.name || user.login };
}

/* 列出当前 Token 可写的仓库（owner 或 collaborator） */
async function listRepos(token, proxyUrl) {
  const repos = await request(token, 'GET', '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member', undefined, proxyUrl);
  const seen = new Set();
  const out = [];
  for (const r of repos || []) {
    if (seen.has(r.full_name)) continue;
    seen.add(r.full_name);
    out.push({
      fullName: r.full_name,
      owner: r.owner.login,
      name: r.name,
      private: r.private,
      defaultBranch: r.default_branch || 'main',
      permissions: r.permissions || {}
    });
  }
  return out;
}

/* 读取仓库里某个文本文件，不存在返回 null */
async function getFile(token, owner, repo, filePath, branch, proxyUrl) {
  const endpoint = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${filePath.split('/').map(encodeURIComponent).join('/')}` + (branch ? `?ref=${encodeURIComponent(branch)}` : '');
  try {
    const data = await request(token, 'GET', endpoint, undefined, proxyUrl);
    if (typeof data.content !== 'string') return null;
    return {
      content: Buffer.from(data.content, 'base64').toString('utf8'),
      sha: data.sha
    };
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

/* 创建或更新文件（需要 sha 才能更新已有文件） */
async function putFile(token, owner, repo, filePath, content, message, branch, proxyUrl, sha) {
  const endpoint = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${filePath.split('/').map(encodeURIComponent).join('/')}`;
  const body = {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch: branch || 'main'
  };
  if (sha) body.sha = sha;
  const data = await request(token, 'PUT', endpoint, body, proxyUrl);
  return {
    path: data.content && data.content.path,
    htmlUrl: data.content && data.content.html_url,
    commitUrl: data.commit && data.commit.html_url
  };
}

/* 尝试读取 Hugo 配置文件（hugo.yaml / hugo.yml / hugo.toml） */
async function readHugoConfig(token, owner, repo, branch, proxyUrl) {
  const candidates = ['hugo.yaml', 'hugo.yml', 'hugo.toml'];
  for (const name of candidates) {
    const file = await getFile(token, owner, repo, name, branch, proxyUrl);
    if (file) return { name, content: file.content, sha: file.sha };
  }
  return null;
}

/* 获取仓库默认分支 */
async function getRepo(token, owner, repo, proxyUrl) {
  return request(token, 'GET', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, undefined, proxyUrl);
}

module.exports = {
  verifyToken, listRepos, getFile, putFile, readHugoConfig, getRepo, request
};
