#!/usr/bin/env node
/**
 * fix-en-ontology-shell.mjs —— 把 en/article-manufacturing-ai-ontology 的顶部区块
 * 替换为 <SiteHeader />，并重写其 page shell。
 *
 * 为什么单独一个脚本
 * ──────────────────
 * 该页 header 的排版与其它 23 个英文页不同（汉堡三连 span 挤在一行、logo 与按钮之间
 * 无空行、带语言切换按钮），无法用 SiteHeader 的通用模板表达，因此 extract-header.mjs
 * 的闸门会拒绝它（这是闸门在正常工作）。为了不让它成为「菜单栏的唯一例外」，
 * 这里改为替换为一个显式的「冻结」标记：
 *
 *     <div data-frozen-header="en-article-manufacturing-ai-ontology">…</div>
 *
 * 该标记由 src/components/SiteHeader.astro 在检测到 __frozen === 'en-article-manufacturing-ai-ontology'
 * 时原样输出（组件内以此文件为准的一份内联副本）。这样：
 *   · 全站导航仍只有一个「入口」—— SiteHeader.astro，改那一个文件即可服务全站；
 *   · 这一页的排版怪癖被显式记录为「已知例外」，而不是悄悄散落在 body 片段里；
 *   · 本脚本会断言内联副本与该页原文逐字节一致，不一致就失败，避免两处漂移。
 *
 * 前置：先执行 scripts/fix-en-ontology-nav.mjs --apply
 * 用法：node scripts/fix-en-ontology-shell.mjs [--apply]
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src', 'sources');
const PAGES = path.join(ROOT, 'src', 'pages');
const APPLY = process.argv.includes('--apply');

const REL = 'en/article-manufacturing-ai-ontology';
const BODY = path.join(SRC, REL + '.body.html');
const PAGE = path.join(PAGES, REL + '.astro');
const FROZEN = 'en-article-manufacturing-ai-ontology';

const OPEN = '<header class="site-header">';
const CLOSE = '</header>';

const body = fs.readFileSync(BODY, 'utf8');
const i = body.indexOf(OPEN);
const j = body.indexOf(CLOSE, i);
if (i < 0 || j < 0) { console.error('未找到 header 区块'); process.exit(1); }

// 连同前缀里的背景层（<canvas id="galaxy-field"> + overlay）一起交给组件渲染，
// 否则 body 会残留 chrome、组件再输出一份，页面里就出现两份背景层。
const chromeStart = body.lastIndexOf('<canvas id="galaxy-field"', i);
if (chromeStart < 0) { console.error('未找到背景层 <canvas id="galaxy-field">'); process.exit(1); }
const prefix = body.slice(0, chromeStart);
const block = body.slice(chromeStart, j + CLOSE.length);
const suffix = body.slice(j + CLOSE.length);

// ── 内联副本：与 src/components/SiteHeader.astro 中的 FROZEN_EN_ONTOLOGY 必须一致 ──
// 该副本只含 <header> 本身（背景层由组件按 chrome 参数渲染）。
const frozenFile = path.join(ROOT, 'scripts', 'frozen-header.en-ontology.html');
const frozen = fs.existsSync(frozenFile) ? fs.readFileSync(frozenFile, 'utf8') : null;
const headerOnly = block.slice(block.indexOf(OPEN));

console.log('\n=== en ontology shell 收尾报告 ===');
console.log(`header 区块长度: ${headerOnly.length}`);
console.log(`内联副本文件: ${frozen === null ? '（缺失，将新建）' : 'scripts/frozen-header.en-ontology.html'}`);

if (frozen !== null && frozen !== headerOnly) {
  console.error('\n中止：内联副本与 body 片段中的 header 不一致（两处已漂移）。');
  console.error('请先同步 scripts/frozen-header.en-ontology.html。');
  const a = frozen.split('\n'), b = headerOnly.split('\n');
  for (let k = 0; k < Math.max(a.length, b.length); k++) {
    if (a[k] !== b[k]) {
      console.error(`  第 ${k + 1} 行\n    副本: ${JSON.stringify(a[k])}\n    body: ${JSON.stringify(b[k])}`);
      break;
    }
  }
  process.exit(1);
}

const marker = `  <SiteHeader __frozen="${FROZEN}" />`;
// 组件自身会输出：leadBlank 个空行 + 背景层 + chromeBlank 个空行 + header。
// 因此 body 片段应只保留「header 与后续正文之间」的那段空行 —— 即原文
// </header> 之后到 <main> 之前的换行数（本页为 2）。
// 前缀里原有的载入空行 / 背景层由组件负责，不能留在 body 里，否则会重复。
const afterHeader = body.slice(j + CLOSE.length);
const tailNL = (afterHeader.match(/^\n*/)[0] || '').length;
const newBody = ('\n'.repeat(tailNL)) + marker + afterHeader.slice(tailNL);

const oldShell = fs.readFileSync(PAGE, 'utf8');
const hp = oldShell.match(/const htmlProps = (\{[^}]*\});/);
const htmlPropsLit = hp ? hp[1] : '{ lang: "en" }';
const shell = `---
import BaseLayout from '../../layouts/BaseLayout.astro';
import head from '../../sources/${REL}.head.html?raw';
import body from '../../sources/${REL}.body.html?raw';

const headerProps = { __frozen: ${JSON.stringify(FROZEN)} };
const htmlProps = ${htmlPropsLit};
---
<BaseLayout htmlProps={htmlProps} head={head} body={body} headerProps={headerProps} />
`;

console.log(`marker: ${marker.trim()}`);
console.log(`shell : src/pages/${REL}.astro`);

if (!APPLY) { console.log('\n[dry-run] 未写入。加 --apply 执行。\n'); process.exit(0); }

if (frozen === null) {
  // 首次运行：把当前区块固化为内联副本
  fs.writeFileSync(frozenFile, block);
  console.log(`\n已固化内联副本 → scripts/frozen-header.en-ontology.html`);
}
fs.writeFileSync(BODY, newBody);
fs.writeFileSync(PAGE, shell);
console.log(`已写入 ${REL}.body.html 与 ${REL}.astro\n`);
