#!/usr/bin/env node
/**
 * new-post.mjs —— 新建一篇博客文章（自动生成 3 个文件骨架）
 *
 * 用法：
 *   npm run new-post -- <slug> [--title "标题"] [--lang zh|en] [--dir en]
 *
 * 生成：
 *   src/sources/<slug>.head.html    —— <head> 内容（含 SEO/GEO 元数据模板）
 *   src/sources/<slug>.body.html    —— 正文骨架（导航由组件渲染，无需手写）
 *   src/pages/<slug>.astro          —— 页面壳（自动接好 BaseLayout + SiteHeader）
 *
 * 说明：
 *   · 顶部导航由 SiteHeader 组件统一渲染，body 里不用写 header。
 *   · head 里的 canonical / og:url 会自动按 slug 填好，其余按需修改。
 *   · 写完后运行 `npm run build` 即可，URL 为 /<slug>.html。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src', 'sources');
const PAGES = path.join(ROOT, 'src', 'pages');
const SITE = 'https://geekheron.space';

// ---- 解析参数 ----
const argv = process.argv.slice(2);
const opts = { title: '', lang: 'zh', dir: '' };
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--title') opts.title = argv[++i] || '';
  else if (a === '--lang') opts.lang = argv[++i] || 'zh';
  else if (a === '--dir') opts.dir = argv[++i] || '';
  else if (!a.startsWith('--')) positional.push(a);
}

const slug = positional[0];
if (!slug || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug)) {
  console.error('用法: npm run new-post -- <slug> [--title "标题"] [--lang zh|en] [--dir en]');
  console.error('  slug 只能包含字母、数字、点、下划线、连字符');
  process.exit(1);
}

const route = opts.dir ? `${opts.dir.replace(/\/+$/, '')}/${slug}` : slug;
const title = opts.title || slug;
const lang = opts.lang === 'en' || opts.dir === 'en' ? 'en' : 'zh';
const htmlLang = lang === 'en' ? 'en' : 'zh-CN';
const depth = route.split('/').length - 1;
const prefix = '../'.repeat(depth + 1);
const canonical = `${SITE}/${route}.html`;
const today = new Date().toISOString().slice(0, 10);

const headPath = path.join(SRC, `${route}.head.html`);
const bodyPath = path.join(SRC, `${route}.body.html`);
const pagePath = path.join(PAGES, `${route}.astro`);

for (const p of [headPath, bodyPath, pagePath]) {
  if (fs.existsSync(p)) {
    console.error(`已存在，拒绝覆盖: ${path.relative(ROOT, p)}`);
    process.exit(1);
  }
}

// ---- head 片段 ----
const head = `<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} | GeekHeron</title>
<meta name="description" content="在此填写 120~160 字的页面描述（影响搜索与 AI 摘要）。">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="article">
<meta property="og:title" content="${title} | GeekHeron">
<meta property="og:description" content="在此填写分享摘要。">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="GeekHeron">
<meta name="twitter:card" content="summary_large_image">
<meta name="author" content="GeekHeron">
<meta name="robots" content="index,follow,max-image-preview:large">

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": ${JSON.stringify(title)},
  "datePublished": "${today}",
  "dateModified": "${today}",
  "author": { "@type": "Person", "name": "GeekHeron" },
  "mainEntityOfPage": { "@type": "WebPage", "@id": "${canonical}" }
}
</script>

<link rel="stylesheet" href="css/styles.css">
`;

// ---- body 片段（导航由组件注入，正文从空行开始）----
const body = `

    <main class="container">
        <article class="article">
            <header class="article-header">
                <h1>${title}</h1>
                <p class="article-meta">${today} · GeekHeron</p>
            </header>

            <section>
                <h2>一、小节标题</h2>
                <p>在这里写正文。可以自由使用现有的样式类（article、container 等），
                新增样式请追加到 css/styles.css。</p>
            </section>

            <section>
                <h2>二、小节标题</h2>
                <p>继续写作。</p>
            </section>
        </article>
    </main>
`;

// ---- 页面壳 ----
const page = `---
import BaseLayout from '${prefix}layouts/BaseLayout.astro';
import head from '${prefix}sources/${route}.head.html?raw';
import body from '${prefix}sources/${route}.body.html?raw';

// 顶部导航由 SiteHeader 组件统一渲染（改导航只需改组件，不必动本文件）
const headerProps = {};
const htmlProps = { lang: "${htmlLang}" };
---
<BaseLayout htmlProps={htmlProps} head={head} body={body} headerProps={headerProps} />
`;

fs.mkdirSync(path.dirname(headPath), { recursive: true });
fs.mkdirSync(path.dirname(bodyPath), { recursive: true });
fs.mkdirSync(path.dirname(pagePath), { recursive: true });
fs.writeFileSync(headPath, head);
fs.writeFileSync(bodyPath, body);
fs.writeFileSync(pagePath, page);

console.log(`
✓ 已创建新文章骨架

  标题   ${title}
  路径   /${route}.html
  语言   ${htmlLang}

  文件：
    ${path.relative(ROOT, headPath)}
    ${path.relative(ROOT, bodyPath)}
    ${path.relative(ROOT, pagePath)}

下一步：
  1. 编辑 body 片段写正文（顶部导航无需手写，由组件注入）
  2. 补全 head 片段里的 description / og 描述
  3. 运行  npm run build  构建，产物在 dist/
`);
