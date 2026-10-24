---
name: testing-anywhere-reader
description: How to run and manually test the Anywhere Reader EPUB web app (dev server, importing an EPUB, reader settings popover, CJK font testing).
---

# Testing Anywhere Reader

Pure frontend Vue 3 + Vite app, no backend and no credentials.

## Run it
```bash
export PATH=$HOME/.bun/bin:$PATH
bun install && bun dev   # http://localhost:5173
```
Node 20.18 prints a "Vite requires Node 20.19+" warning; the dev server still works.

## Get a book into the library
Books live in browser IndexedDB/localStorage, so each fresh profile needs an import:
click the “点击选择，或将 EPUB 文件拖拽到此处” tile, then type the absolute path into the
GTK file dialog and press Enter. After a reload the book appears as a cover tile in the
library — click it to reopen (progress and prefs persist via localStorage key
`anywhere-reader:prefs`).

## Reader UI paths
- Header (top-right of the reader): `title="目录"` toggles the TOC, `title="阅读设置"` opens the
  settings popover containing 主题 / 字体 / 字号, `title="关闭书籍"` returns to the library.
- Page turns: Left/Right arrow keys or the 上一页 / 下一页 buttons.

## Testing CJK fonts
- The bundled 苹方 (PingFang SC) webfont is subset to **GB2312 (Simplified only)**. Most
  Project Gutenberg Chinese books are **Traditional**, so their glyphs are NOT in the subset
  and selecting 苹方 shows no visible change. Convert a Traditional epub to Simplified first:
  ```bash
  pip install opencc-python-reimplemented fonttools brotli
  # unzip epub, run opencc t2s over the .xhtml/.opf/.ncx files, rezip with `mimetype` stored first
  ```
  Verify coverage with fontTools `TTFont(...).getBestCmap()` against the book's codepoints.
- Linux CI/desktop boxes typically only have WenQuanYi Zen Hei + DejaVu, so 系统/宋体/黑体/楷体
  all resolve to the same fallback — do not expect visible differences between them there.
  The only reliably observable change is 苹方 (bundled webfont).
- Objective proof of lazy loading: DevTools → Network → "Font" filter is empty until 苹方 is
  clicked, then two requests appear (`PingFangSC-Regular/Bold.subset.woff2`, ~807/825 kB, 200).
- epub.js renders in an iframe; an "iframe which has both allow-scripts and allow-same-origin"
  console warning is pre-existing and not a failure.

## Devin Secrets Needed
None.
