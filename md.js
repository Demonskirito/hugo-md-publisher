'use strict';

// frontmatter 解析与生成（沿用已验证的版本）

function unquote(s) {
  const v = String(s).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function formatValue(v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) {
    return `[${v.map(x => `"${String(x).replace(/"/g, '\\"')}"`).join(', ')}]`;
  }
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  const s = String(v);
  if (s === '') return '';
  if (/^[\s"']|[\s"']$|:|#|\n/.test(s)) return `"${s.replace(/"/g, '\\"')}"`;
  return s;
}

function parseMarkdown(text) {
  const normalized = String(text == null ? '' : text).replace(/\r\n/g, '\n');
  let hasFrontmatter = false;
  let frontmatterText = '';
  let body = normalized;

  if (normalized.startsWith('---\n')) {
    const end = normalized.indexOf('\n---', 4);
    if (end !== -1) {
      frontmatterText = normalized.slice(4, end);
      body = normalized.slice(end + 4).replace(/^\n?/, '');
      hasFrontmatter = true;
    }
  }

  const fields = {};
  let listKey = null;
  for (const line of frontmatterText.split('\n')) {
    const listMatch = line.match(/^\s*-\s+(.*)$/);
    if (listMatch && listKey) {
      if (!Array.isArray(fields[listKey])) fields[listKey] = [];
      fields[listKey].push(unquote(listMatch[1]));
      continue;
    }
    listKey = null;
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const raw = kv[2].trim();
    if (raw === '') {
      fields[key] = '';
      listKey = key;
    } else if (raw.startsWith('[') && raw.endsWith(']')) {
      fields[key] = raw.slice(1, -1).split(',').map(unquote).filter(x => x !== '');
    } else {
      fields[key] = unquote(raw);
    }
  }
  return { hasFrontmatter, fields, body };
}

const CORE_KEYS = [
  'title', 'slug', 'description', 'date', 'lastmod',
  'image', 'math', 'license', 'hidden', 'draft', 'categories', 'tags'
];

function buildMarkdown(parsed, fields) {
  const merged = Object.assign({}, parsed.fields, fields || {});
  const lines = [];
  for (const key of CORE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(merged, key)) {
      lines.push(`${key}: ${formatValue(merged[key])}`);
    }
  }
  for (const key of Object.keys(parsed.fields)) {
    if (!CORE_KEYS.includes(key)) lines.push(`${key}: ${formatValue(merged[key])}`);
  }
  return `---\n${lines.join('\n')}\n---\n\n${parsed.body}`;
}

function localISO(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const oh = pad(Math.floor(Math.abs(offset) / 60));
  const om = pad(Math.abs(offset) % 60);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${oh}:${om}`;
}

function slugify(input) {
  const s = String(input == null ? '' : input).trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return s || 'post';
}

module.exports = { parseMarkdown, buildMarkdown, localISO, slugify };
