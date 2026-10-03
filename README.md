# Anywhere Reader

纯前端的 EPUB 阅读器，使用 **Vue 3 + Bun + Tailwind CSS + epub.js** 构建。用户手动上传 `.epub` 文件即可阅读，文件全部在浏览器本地解析，**不会上传到任何服务器**。

## 功能

- 拖拽或点击上传 `.epub` 文件，支持批量导入、进度提示与失败项重试
- 书架搜索、最近阅读/添加/书名排序、未读/在读/已读筛选与继续阅读
- 回收站支持恢复、撤销，以及永久清理本地文件释放空间
- 导出和恢复 ZIP 备份（书籍、进度、书签、阅读设置，不包含 WebDAV 凭据）
- 分页式阅读，支持点击左右两侧翻页与键盘 ← / → 翻页
- 章节目录（TOC）：桌面侧边栏，手机抽屉，选章后自动关闭
- 滑动翻页、点正文中间隐藏工具栏、书内搜索、书签、进度滑块和跳转后返回原位置
- 四种阅读主题：明亮 / 护眼 / 夜间 / 墨水屏（E-Ink，纯黑白高对比、禁用过渡动画以避免残影）
- 字体选择：系统 / 苹方（内置 webfont）/ 宋体 / 黑体 / 楷体
- 字号调整（60% – 200%）
- 阅读进度条与百分比
- 书架：上传的 EPUB 保存在浏览器（IndexedDB），刷新后无需重新上传
- 自动记忆每本书的阅读位置与偏好设置（localStorage）
- **WebDAV 同步**：配置自己的 WebDAV 服务器后，可在多设备间同步书籍与阅读进度（详见下文）
- **PWA**：可安装到桌面 / 主屏幕，离线可用（详见下文）

## 字体

阅读界面右上角「阅读设置」中可切换正文字体。除系统字体外内置了 **苹方（PingFang SC）**：

- 字体文件来自 <https://github.com/ShmilyHTT/PingFang>，版权归 Apple 所有，仅供个人学习使用
- 为控制体积，仅内置 Regular / Bold 两个字重，并按 GB2312 字符集做了子集化（每个字重 < 1 MB，woff2）
- 字体文件仅在用户选择「苹方」时才会下载，不影响首屏加载
- 重新生成子集：`python tools/subset-fonts.py /path/to/PingFang`（需要 `fonttools` + `brotli`）

## WebDAV 同步

在书架右上角点击设置（齿轮）图标，填写 WebDAV 服务器地址、用户名、密码与同步目录，点击「测试连接」验证后保存。

- 配置仅保存在浏览器 localStorage，不会发送到本应用以外的任何地方
- 阅读过程中进度会自动（防抖）同步到 WebDAV
- 点击书架的「同步」按钮可手动双向同步：本地缺失的书会从云端下载，云端缺失的书会上传
- 进度按 `updatedAt` 合并，并用 ETag 条件请求检测并发修改、重试；同步期间的本地翻页也会保留
- 同步失败会显示错误并提供重试；关闭书籍及应用切入后台时尝试同步进度（浏览器关闭时不能保证网络请求完成）
- “仅从此设备移除”会阻止云端重新下载；“同步移除”通过持久删除标记在所有设备隐藏书籍，恢复也会同步
- 回收站保留本地文件供撤销；“永久清理本地文件”释放空间并保留小型移除标记，云端原文件保留

远程目录结构（`<同步目录>` 默认为 `/anywhere-reader`）：

```
<同步目录>/
├── books/<id>.epub     # 书籍文件（id 为内容 SHA-256 前 16 位）
├── meta/<id>.json      # 书名、作者、大小等元数据
├── deletions/<id>.json  # 可恢复的同步移除标记
└── progress.json       # 各书阅读进度 { id: { cfi, percentage, updatedAt } }
```

> 条件同步要求服务器支持 ETag 和条件 PUT。若响应不提供可读取的 ETag，应用会明确报错，保留本地进度，不进行无条件覆盖。

> 注意：因为是纯前端应用，浏览器会发起跨域请求，WebDAV 服务器需开启 CORS（允许 `PROPFIND/MKCOL/PUT/GET` 方法及 `Authorization`、`Depth`、`Content-Type`、`If-Match`、`If-None-Match` 请求头，并设置 `Access-Control-Expose-Headers: ETag`）。

## PWA（安装到桌面 / 离线使用）

应用提供 Web App Manifest 与 Service Worker，可作为独立应用安装：

- Chrome / Edge：书架右上角出现「安装」按钮，或使用地址栏的安装图标
- iOS Safari：分享 → 添加到主屏幕
- 离线可用：构建生成完整离线资源清单（含阅读引擎和字体）；首次联网加载并完成 Service Worker 安装后可离线使用。书籍保存在 IndexedDB 中
- 有新版本部署时，页面底部会提示「有新版本可用」，点击刷新即可更新
- 系统「打开方式」选择本应用打开 `.epub` 时会直接进入阅读（支持 File Handling API 的浏览器）

所有图标由 `public/logo-transparent.png` 统一生成。favicon、书架 Logo 和普通 PWA 图标使用透明背景；maskable 图标和 Apple 主屏幕图标使用完整白色背景（无预设圆角）。maskable 图案留在中央安全区域内：

```bash
pip install Pillow
python tools/gen-icons.py
```

## 开发

```bash
bun install
bun dev
```

## 构建

```bash
bun run build      # 输出到 dist/
bun run preview    # 本地预览生产构建
```

## 部署

推送到 `main` 分支会通过 GitHub Actions 自动构建并发布到 GitHub Pages：

- 在线访问：<https://co1in9.github.io/anywhere_reader/>
- 工作流：`.github/workflows/deploy.yml`

## 技术栈

| 用途        | 选型              |
| ----------- | ----------------- |
| 框架        | Vue 3 (`<script setup>`) |
| 构建/包管理 | Vite + Bun        |
| 样式        | Tailwind CSS v4   |
| EPUB 解析   | epub.js + JSZip   |

## 存储与内容安全

- 旧版书库会在 IndexedDB 升级事务中自动迁移；元数据、EPUB 文件、封面缩略图和阅读索引分开存储。
- 书架读取不加载所有 EPUB；相同书籍再次打开会复用缓存的阅读索引。
- “备份与存储”显示估算容量，可请求持久存储。浏览器可能拒绝持久化，定期备份仍然必要。
- ZIP 备份会校验书籍内容哈希后恢复，合并进度和书签；恢复过程中若容量不足会显示错误，已经恢复的书籍保留。
- 默认禁用 EPUB 脚本，限制书中外部资源；外部链接需要确认后在新窗口打开。依赖脚本或远程资源的互动 EPUB 可能无法完整显示。
- WebDAV 凭据仍保存在本设备的 localStorage，建议使用专用应用密码。

## 验证

```bash
bun test
bun run build
```

`tests/reliability.test.js` 覆盖旧库迁移、写入回滚、存储错误、同步并发、移除恢复和备份校验。开发时可打开 `/tests/browser.html`，使用内置样书验证阅读操作；此测试入口不进入生产构建。
