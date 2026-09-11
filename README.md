# GeekHeron Site (Astro)

白黑洞光线追踪交互页 + 深度分析文章站，基于 **Astro** 静态站点重构。
输出为纯静态 HTML，与重构前逐字节一致（UI / 内容零改动）。

## 目录结构

```
src/
  layouts/BaseLayout.astro     # 渲染骨架：把原页面的 <head>/<body> 原样注入
  pages/**/*.astro             # 各路由（薄壳，导入片段）
  sources/**/*.{head,body}.html # 每页原始 head / body 片段（?raw 导入）
public/                        # 静态资源（图片、PDF、vendor/three、css、js、en/ 英文页、CNAME、robots.txt…）
public-extra/                  # 带空格/中文名的遗留文件，构建后拷入 dist/
scripts/
  migrate.mjs                  # 从原始 HTML 生成 Astro 页面（一次性）
  copy-extra.mjs               # 构建后拷贝 public-extra -> dist
  verify.mjs                   # 与原始 HTML 逐字节校验
.stubs/sharp/                  # sharp 桩包（见下）
.github/workflows/deploy.yml   # GitHub Pages 自动部署
```

## 本地运行

```bash
npm install     # 首次
npm run dev     # 开发服务器 http://localhost:4321
```

预览最终产物：

```bash
npm run build   # 产出 dist/
npm run preview
```

> 若 PowerShell 提示 `npm` 不是可识别的命令，说明 Node 未加入 PATH。
> 用完整路径：`& "<node安装目录>\npm.cmd" run dev`，或安装官方 Node.js 自动配置 PATH。

## 关于 sharp 桩包

`package.json` 中 `overrides.sharp` 指向 `.stubs/sharp`，用于绕开某些环境下
`sharp` 平台二进制包解析失败的问题。本站只输出静态 HTML，不使用 Astro 图片优化，
因此桩包无副作用。如果你的环境能正常安装 sharp，可删除该 override 与 `.stubs/`。

## 部署

仓库 Settings → Pages → Source 选择 **GitHub Actions**，push 到 `main` 即自动构建部署。
自定义域名由 `public/CNAME` = `geekheron.space` 控制。
