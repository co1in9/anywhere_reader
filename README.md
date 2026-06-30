# Anywhere Reader

纯前端的 EPUB 阅读器，使用 **Vue 3 + Bun + Tailwind CSS + epub.js** 构建。用户手动上传 `.epub` 文件即可阅读，文件全部在浏览器本地解析，**不会上传到任何服务器**。

## 功能

- 拖拽或点击上传 `.epub` 文件
- 分页式阅读，支持点击左右两侧翻页与键盘 ← / → 翻页
- 章节目录（TOC）侧边栏，点击跳转
- 四种阅读主题：明亮 / 护眼 / 夜间 / 墨水屏（E-Ink，纯黑白高对比、禁用过渡动画以避免残影）
- 字号调整（60% – 200%）
- 阅读进度条与百分比
- 自动记忆每本书的阅读位置与偏好设置（localStorage）

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
