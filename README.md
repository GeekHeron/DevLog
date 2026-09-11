# GeekHeron Site (Astro)

白黑洞光线追踪交互页 + 深度分析文章站，基于 **Astro** 静态站点重构。
输出为纯静态 HTML，与重构前逐字节一致（UI / 内容零改动）。

## 目录结构

```
src/
  components/SiteHeader.astro  # 全站公共顶部导航（唯一来源，改一次全站生效）
  layouts/BaseLayout.astro     # 渲染骨架：注入 <head>/<body> + 渲染导航组件
  pages/**/*.astro             # 各路由（薄壳，导入片段 + 传 headerProps）
  sources/**/*.{head,body}.html # 每页原始 head 片段 / 正文片段（?raw 导入）
public/                        # 静态资源（图片、PDF、vendor/three、css、js、en/ 英文页、CNAME、robots.txt…）
public-extra/                  # 带空格/中文名的遗留文件，构建后拷入 dist/
scripts/
  migrate.mjs                  # 从原始 HTML 生成 Astro 页面（一次性）
  extract-header.mjs           # 把各页硬编码的顶部区块替换为 <SiteHeader />（含回放校验）
  finalize-header.mjs          # 剥离标记 + 重写 page shell（注入 headerProps）
  apply-header-extraction.mjs  # 一键跑完「还原 -> 抽取 -> 收尾 -> 构建 -> 校验」
  new-post.mjs                 # 新建文章骨架（npm run new-post）
  copy-extra.mjs               # 构建后拷贝 public-extra -> dist
  verify.mjs                   # 与原始 HTML 逐字节校验
.header-backup/                # 头部抽取前的 body 备份（可回滚）
.stubs/sharp/                  # sharp 桩包（见下）
.github/workflows/deploy.yml   # GitHub Pages 自动部署
```

## 顶部导航（SiteHeader 组件）

全站 55 个页面的顶部导航已抽成唯一组件 `src/components/SiteHeader.astro`。
**改导航链接、品牌字、时钟、齿轮图标，只改这一个文件，重新构建后全站生效。**

页面 shell 通过 `headerProps` 传参（绝大多数页面用默认值即可）：

```astro
const headerProps = {};                 // 用默认导航
const headerProps = { variant: 'en' };  // 英文导航
```

三个页面为特殊结构，**不**经过该组件（保持原样，勿手改）：
`fuxiengine.html`、`tiangangame-bp.html`（header 嵌在 container 内）、`pricing.html`（自定义导航项）。

## 写一篇新文章

```bash
npm run new-post -- my-article --title "文章标题"
npm run new-post -- my-en-article --title "My Post" --lang en --dir en
```

会自动生成 3 个文件：

| 文件 | 用途 |
|------|------|
| `src/sources/<slug>.head.html` | `<head>` 内容（标题 / canonical / og / JSON-LD 已填好） |
| `src/sources/<slug>.body.html` | 正文骨架（**顶部导航无需手写**，由组件注入） |
| `src/pages/<slug>.astro` | 页面壳（已接好 BaseLayout + headerProps） |

然后编辑正文 → 补全 `head` 里的 description → `npm run build`。URL 为 `/<slug>.html`。

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
