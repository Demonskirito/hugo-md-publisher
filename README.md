# MD 博客发布助手（本地版）

一个把 Markdown 文件一键发布到 GitHub 博客的桌面程序：本地用 Hugo 构建静态页面，再通过 Git 推送到 GitHub Pages。适合 Hugo 源码放在本地、`public/` 作为静态站点仓库的博主。

**作者：[@demonskirito](https://github.com/demonskirito)**

## 它解决什么问题

原来的发布流程要手动跑四步：

1. 用 bat 脚本创建文章目录
2. 写正文
3. 运行 `hugo` 构建
4. 进 `public/` 执行 `git add` → `commit` → `push`

这个程序把它合成一个按钮：选 MD 文件 → 确认标题/分类/标签 → 点「发布」，剩下的自动完成。

## 功能

- 选择或拖入 `.md` 文件，自动解析并补全 frontmatter
- 按 `content/post/年/月日-slug/` 写入文章，重名自动加后缀
- 本地调用 `hugo.exe` 构建静态页面
- 通过 Git 推送 `public/`，支持多策略（默认配置 → 指定代理 → 直连兜底）
- 推送前自动 `pull --rebase`，避免远端有变动时被拒
- Token 用系统加密存储，不明文落盘
- 发布失败可「仅重试推送」，不会重复创建文章
- 成功后自动生成文章链接并打开

## 下载

到本仓库的 [Releases](../../releases) 页面下载 `MD博客发布助手-本地版-*.exe`，双击即用，无需安装。

## 从源码构建

需要 Node.js 18+：

```bash
npm install
npm run dist
```

产物在 `dist/` 目录。构建配置见 `package.json`。

## 首次使用配置

打开程序后点右上角「设置」，依次填写：

1. **Hugo 项目目录**：含 `hugo.yaml` 和 `content/` 的那一层，点「检测」自动读取域名和文章网址格式
2. **GitHub Token**：在 GitHub → Settings → Developer settings → Personal access tokens 生成，勾选 `repo` 权限
3. **仓库**：owner（用户名）、repo（仓库名）、分支（一般 `main`）
4. **代理**：国内直连 GitHub 通常不通，填代理软件的 HTTP 地址端口，如 `http://127.0.0.1:7890`；能直连就留空

hugo.exe、git.exe 留空会自动探测，探测不到再手动指定。

## 说明

- 图片请使用图床外链，程序不处理本地图片。
- 本程序要求本机有完整的 Hugo 项目源码和 `hugo.exe`（所以叫「本地版」）。如果你的博客是源码推 GitHub、Actions 云端构建的架构，不需要这个程序。
- 详细操作步骤见 [使用说明.md](使用说明.md)。

## 许可

MIT
