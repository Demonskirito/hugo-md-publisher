'use strict';

/* 极简解析 hugo.yaml / hugo.toml，只提取 baseurl 与 permalinks.post。
   目标不是完整 YAML/TOML 实现，而是覆盖 Hugo 博客的常规写法。 */

function parseHugoConfig(text, fileName) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const result = { baseurl: '', permalink: '' };
  const isToml = /\.toml$/i.test(fileName || '');

  let inPermalinks = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    if (isToml) {
      const section = line.match(/^\[([^\]]+)\]/);
      if (section) {
        inPermalinks = section[1].trim() === 'permalinks';
        continue;
      }
      const kv = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
      if (!kv) continue;
      const key = kv[1].trim();
      const val = kv[2].trim().replace(/^['"]|['"]$/g, '');
      if (key === 'baseurl') result.baseurl = val;
      if (inPermalinks && key === 'post') result.permalink = val;
    } else {
      const kv = line.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
      if (!kv) continue;
      const key = kv[1].trim();
      let val = kv[2].trim();
      if (/^['"]/.test(val)) val = val.replace(/^['"]|['"]$/g, '');
      if (/^baseurl$/i.test(key) && val) result.baseurl = val;
      if (/^permalinks$/i.test(key)) { inPermalinks = true; continue; }
      if (/^\s/.test(raw) && inPermalinks && /^post$/i.test(key) && val) {
        result.permalink = val;
      }
      if (!/^\s/.test(raw) && key !== 'permalinks') inPermalinks = false;
    }
  }
  return result;
}

/* 把模板里的变量替换成实际值。同时支持 {slug} 与 Hugo 原生 :slug 两种写法。 */
function renderTemplate(template, vars) {
  let out = String(template || '');
  const map = Object.assign({}, vars);
  for (const key of Object.keys(map)) {
    const value = String(map[key] == null ? '' : map[key]);
    const re = new RegExp(`\\{${key}\\}|:${key}`, 'g');
    out = out.replace(re, value);
  }
  return out.replace(/\/+/g, '/');
}

/* 生成文章在源码仓库中的路径 */
function buildContentPath(template, vars) {
  let p = renderTemplate(template, vars);
  p = p.replace(/^\/+/, '');
  return p;
}

/* 生成文章最终网址 */
function buildArticleUrl(baseurl, permalink, vars) {
  const base = String(baseurl || '').replace(/\/+$/, '');
  let pathPart = String(permalink || '').trim();
  if (!pathPart) {
    pathPart = '/p/{slug}/';
  }
  if (!pathPart.startsWith('/')) pathPart = '/' + pathPart;
  let url = renderTemplate(pathPart, vars);
  if (!url.endsWith('/')) url += '/';
  return base + url;
}

module.exports = { parseHugoConfig, renderTemplate, buildContentPath, buildArticleUrl };
