# Anywhere Reader

纯前端的 EPUB 阅读器，使用 **Vue 3 + Bun + Tailwind CSS + epub.js** 构建。用户手动上传 `.epub` 文件即可阅读，文件全部在浏览器本地解析，**不会上传到任何服务器**。

## 功能

- 拖拽或点击上传 `.epub` 文件
- 分页式阅读，支持点击左右两侧翻页与键盘 ← / → 翻页
- 章节目录（TOC）侧边栏，点击跳转
- 四种阅读主题：明亮 / 护眼 / 夜间 / 墨水屏（E-Ink，纯黑白高对比、禁用过渡动画以避免残影）
- 字号调整（60% – 200%）
- 阅读进度条与百分比
- 书架：上传的 EPUB 保存在浏览器（IndexedDB），刷新后无需重新上传
- 自动记忆每本书的阅读位置与偏好设置（localStorage）
- **WebDAV 同步**：配置自己的 WebDAV 服务器后，可在多设备间同步书籍与阅读进度（详见下文）

## WebDAV 同步

在书架右上角点击设置（齿轮）图标，填写 WebDAV 服务器地址、用户名、密码与同步目录，点击「测试连接」验证后保存。

- 配置仅保存在浏览器 localStorage，不会发送到本应用以外的任何地方
- 阅读过程中进度会自动（防抖）同步到 WebDAV
- 点击书架的「同步」按钮可手动双向同步：本地缺失的书会从云端下载，云端缺失的书会上传
- 进度按 `updatedAt` 取较新者合并，避免多设备互相覆盖

远程目录结构（`<同步目录>` 默认为 `/anywhere-reader`）：

```
<同步目录>/
├── books/<id>.epub     # 书籍文件（id 为内容 SHA-256 前 16 位）
├── meta/<id>.json      # 书名、作者、大小等元数据
└── progress.json       # 各书阅读进度 { id: { cfi, percentage, updatedAt } }
```

> 注意：因为是纯前端应用，浏览器会发起跨域请求，WebDAV 服务器需开启 CORS（允许 `PROPFIND/MKCOL/PUT/GET` 方法及 `Authorization`、`Depth` 请求头）。

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
