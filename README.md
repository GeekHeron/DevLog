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
public/                        # 静态资源（图片、PDF、vendor/three、css、js、CNAME、robots.txt…）
public-extra/                  # 带空格/中文名的遗留文件，构建后拷入 dist/
scripts/
  migrate.mjs                  # 从原始 HTML 生成 Astro 页面（一次性）
  extract-header.mjs           # 把各页硬编码的顶部区块替换为 <SiteHeader />（含回放校验 + 导航统一门禁）
  finalize-header.mjs          # 剥离标记 + 重写 page shell（注入 headerProps）
  fix-en-ontology-nav.mjs      # 单独处理 en/article-manufacturing-ai-ontology 的导航项
  fix-en-ontology-shell.mjs    # 单独处理该页 shell（冻结 header 模板）
  apply-header-extraction.mjs  # 一键跑完「还原 -> 抽取 -> 收尾 -> 构建 -> 校验」
  new-post.mjs                 # 新建文章骨架（npm run new-post）
  copy-extra.mjs               # 构建后拷贝 public-extra -> dist
  verify.mjs                   # 与原始 HTML 逐字节校验
.header-backup/                # 头部抽取前的 body 备份（可回滚）
.stubs/sharp/                  # sharp 桩包（见下）
.github/workflows/deploy.yml   # GitHub Pages 自动部署
```

## 顶部导航（SiteHeader 组件）

全站 79 个页面（中文 55 + 英文 24）的顶部导航已抽成唯一组件 `src/components/SiteHeader.astro`。
**改导航链接、品牌字、齿轮图标，只改这一个文件，重新构建后全站生效。**

页面 shell 通过 `headerProps` 传参（绝大多数页面用默认值即可）：

```astro
const headerProps = {};                                  // 中文导航（默认）
const headerProps = { variant: 'en', hrefPrefix: '../' } // 英文导航（en/ 子目录）
```

### 中英文导航

中英文两套导航条目在组件内以 `ZH_NAV` / `EN_NAV` 常量定义，**文案一一对应**：

| 中文 | 英文 |
|------|------|
| 首页 | Home |
| 深度分析 | Deep Analysis |
| 商业案例 | Case Studies |
| 关于我 &amp; 商业合作 | About Me &amp; Business |

英文页位于 `src/pages/en/` 与 `src/pages/about-en.astro`，链接需带 `hrefPrefix: '../'`；
第 4 项 About 指向同级 `about-en.html`（由 `aboutHref` 覆盖）。

### 组件参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `variant` | `'zh'` | `'zh'` 中文导航 / `'en'` 英文导航 |
| `brand` | `'GeekHeron'` | 品牌文字 |
| `hrefPrefix` | `''` | 链接前缀，`en/` 下传 `'../'` |
| `aboutHref` | `'about.html'` | 第 4 项 About 的链接 |
| `tool` | `true` | 是否渲染右侧齿轮工具图标 |
| `navItems` | `null` | 自定义导航项（传了就不看 variant） |
| `__frozen` | `''` | 冻结页逃生舱，见下 |

### 例外页面

- `fuxiengine.html`、`tiangangame-bp.html`：header 嵌在 `<div class="container">` 内，
  结构特殊，**不**经过组件（保持原样，勿手改）。
- `pricing.html`：自定义导航项，走 `navItems` 传参。
- `en/article-manufacturing-ai-ontology.html`：正文含 `<span></span><span></span><span></span>`
  单行内联结构，无法通过回放校验。以 `__frozen="en-article-manufacturing-ai-ontology"`
  在组件内输出逐字冻结模板（`FROZEN_EN_ONTOLOGY`），导航文案与其余英文页一致。

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
