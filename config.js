'use strict';

const path = require('path');
const fs = require('fs');
const { app, safeStorage } = require('electron');

function configPath() { return path.join(app.getPath('userData'), 'local-config.json'); }
function tokenPath() { return path.join(app.getPath('userData'), 'local-token.bin'); }

function defaultConfig() {
  return {
    projectDir: '',      // Hugo 项目根目录（含 hugo.yaml 与 content）
    hugoPath: '',        // hugo.exe 完整路径，留空则自动探测
    gitPath: '',         // git.exe 完整路径，留空则自动探测
    contentTemplate: 'content/post/{year}/{mmdd}-{slug}/index.md',
    owner: '',
    repo: '',
    branch: 'main',
    baseurl: '',
    permalink: '/p/{slug}/',
    proxyUrl: '',
    lastSync: ''
  };
}

function loadConfig() {
  const base = defaultConfig();
  try {
    const saved = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    return Object.assign(base, saved || {});
  } catch (_e) { return base; }
}

function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8');
  return { ok: true };
}

function loadToken() {
  try {
    const enc = fs.readFileSync(tokenPath());
    if (!enc.length) return '';
    if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(enc);
    return enc.toString('utf8');
  } catch (_e) { return ''; }
}

function saveToken(token) {
  fs.mkdirSync(path.dirname(tokenPath()), { recursive: true });
  const value = String(token || '');
  if (!value) {
    try { fs.unlinkSync(tokenPath()); } catch (_e) { /* 无需处理 */ }
    return { ok: true };
  }
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(tokenPath(), safeStorage.encryptString(value));
  } else {
    fs.writeFileSync(tokenPath(), value, 'utf8');
  }
  return { ok: true, encrypted: safeStorage.isEncryptionAvailable() };
}

module.exports = { loadConfig, saveConfig, loadToken, saveToken, defaultConfig };
