// 打包后裁剪 Electron 冗余文件，减小 exe 体积。
// 由 electron-builder 的 build.afterPack 钩子调用。
const fs = require('fs');
const path = require('path');

// 界面只用中英文，其余语言包清空（保留空壳文件）
const KEEP_LOCALES = new Set(['en-US.pak', 'zh-CN.pak']);

// 仅清空纯文本文档：Chromium 许可证说明，不参与运行
const DROP_FILES = ['LICENSES.chromium.html'];

function emptyFile(full) {
  const st = fs.statSync(full);
  if (st.size === 0) return 0;
  const bytes = st.size;
  fs.writeFileSync(full, Buffer.alloc(0));
  return bytes;
}

module.exports = async function afterPack(context) {
  const dir = context.appOutDir;

  let langBytes = 0;
  let removedLangs = 0;
  const localesDir = path.join(dir, 'locales');
  if (fs.existsSync(localesDir)) {
    for (const name of fs.readdirSync(localesDir)) {
      if (!KEEP_LOCALES.has(name)) {
        try { langBytes += emptyFile(path.join(localesDir, name)); removedLangs++; }
        catch (_e) { /* 忽略 */ }
      }
    }
  }

  let fileBytes = 0;
  for (const name of DROP_FILES) {
    const full = path.join(dir, name);
    try { if (fs.existsSync(full)) { fileBytes += emptyFile(full); } }
    catch (_e) { /* 忽略 */ }
  }

  console.log(`[瘦身] 语言包清空 ${removedLangs} 个（${(langBytes / 1048576).toFixed(1)} MB），` +
    `许可证清空 ${(fileBytes / 1048576).toFixed(1)} MB；GPU 组件保留以确保稳定`);
};
