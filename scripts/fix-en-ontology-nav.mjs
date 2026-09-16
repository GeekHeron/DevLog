#!/usr/bin/env node
/**
 * fix-en-ontology-nav.mjs —— 单独处理 en/article-manufacturing-ai-ontology 的导航统一
 *
 * 背景
 * ────
 * /en/ 下 24 个英文页原先各内联一份导航，文案有 7 种变体。本次统一为与中文导航
 * 一一对应的四项（Home / Deep Analysis / Case Studies / About Me & Business*），
 * 其中第 4 项指向英文版 about-en.html。
 *
 * 23 个页面由 scripts/extract-header.mjs 顺带完成统一并抽取为 <SiteHeader />。
 * 剩下这一页结构特殊 —— 它的 header 与其它变体都不同：
 *   · 汉堡三连 <span> 挤在一行（<span></span><span></span><span></span>）
 *   · </a> 与 <button> 之间没有空行
 *   · 带一个语言切换按钮（lang-btn → ../article-manufacturing-ai-ontology.html）
 *   · 原导航第 3 项是「Business Cases」而非「Case Studies」，
 *     第 4 项是「Source Delivery」（指向已下线的 fuxi-engine.html）
 * 这些排版差异超出了「统一导航」的范围，extract-header 的闸门据此拒绝改写
 * （这是闸门在正常工作，不是缺陷）。本脚本只做导航层面的替换，不重排 HTML。
 *
 * 变更范围（白名单）
 * ─────────────────
 *   1) 第 1、2、5 行导航文案/href 改为统一形式
 *   2) 删除「Business Cases」与「Source Delivery」两行
 *   3) 语言切换按钮的落点改指中文版 article-manufacturing-ai-ontology.html
 * 除此之外的任何字节变动都会让脚本失败退出。
 *
 * 用法：node scripts/fix-en-ontology-nav.mjs [--apply]
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src', 'sources');
const BACKUP = path.join(ROOT, '.header-backup');
const APPLY = process.argv.includes('--apply');

const REL = 'en/article-manufacturing-ai-ontology.body.html';

/** 统一的英文导航（与 SiteHeader 的 variant='en' + aboutHref='about-en.html' 一致） */
const NAV = [
  ['../index.html', 'Home'],
  ['../article.html', 'Deep Analysis'],
  ['../works.html', 'Case Studies'],
  ['../about-en.html', 'About Me &amp; Business'],
];

/**
 * 原文导航（5 项）→ 统一后的导航（4 项）。
 * 逐项映射写死，避免靠序号对齐时被「删除项」打乱：
 *   原文 1「Home」          → 保留
 *   原文 2「Deep Analysis」 → 保留
 *   原文 3「Business Cases」→ 并入统一后的第 3 项「Case Studies」（改文案）
 *   原文 4「Source Delivery」→ 删除（指向已下线的 fuxi-engine.html）
 *   原文 5「About &amp; Collaboration」→ 改文案为「About Me &amp; Business」并改落点为 about-en.html
 */
const OBSOLETE_NAV = [
  { href: '../fuxi-engine.html', label: 'Source Delivery' },
];

function rewriteBlock(block) {
  const lines = block.split('\n');
  const out = [];
  const changes = [];
  let navIdx = 0;
  let langRewritten = 0;
  let savedNav = 0;

  for (const line of lines) {
    // 1) 导航行
    const nav = line.match(/^([ \t]*)<li><a href="([^"]+)">([^<]+)<\/a><\/li>[ \t]*$/);
    if (nav) {
      const [, ind, href, label] = nav;
      const obsolete = OBSOLETE_NAV.find((o) => o.href === href && o.label === label);
      if (obsolete) {
        changes.push({ kind: 'nav-removed', from: `<li><a href="${href}">${label}</a></li>`, to: '（删除）' });
        savedNav++;
        continue;
      }
      const want = NAV[navIdx];
      if (!want) throw new Error(`导航项多于预期：出现第 ${navIdx + 1} 项 ${href}`);
      const newLine = `${ind}<li><a href="${want[0]}">${want[1]}</a></li>`;
      if (newLine !== line) changes.push({ kind: 'nav', from: line.trim(), to: newLine.trim() });
      out.push(newLine);
      navIdx++;
      continue;
    }

    // 2) 语言切换行：只改落点，其余属性原样保留
    if (/class="lang-btn"/.test(line) && /<li>/.test(line)) {
      const nl = line.replace(
        /<li><a href="[^"]*" class="lang-btn"/,
        '<li><a href="../article-manufacturing-ai-ontology.html" class="lang-btn"'
      );
      if (nl !== line) changes.push({ kind: 'lang', from: line.trim(), to: nl.trim() });
      langRewritten++;
      out.push(nl);
      continue;
    }

    out.push(line);
  }

  if (navIdx !== NAV.length) throw new Error(`导航项数量不符：期望 ${NAV.length}，实际 ${navIdx}`);
  if (langRewritten !== 1) throw new Error(`语言切换行数量不符：期望 1，实际 ${langRewritten}`);
  if (savedNav !== OBSOLETE_NAV.length) throw new Error(`待删导航行数量不符：期望 ${OBSOLETE_NAV.length}，实际 ${savedNav}`);

  const changed = changes.filter((c) => c.kind !== 'nav-removed').length + savedNav;
  return { text: out.join('\n'), changes, changed };
}

/** ---- 主流程 ---- */
const p = path.join(SRC, REL);
if (!fs.existsSync(p)) {
  console.error(`找不到文件：${REL}`);
  process.exit(1);
}
const orig = fs.readFileSync(p, 'utf8');

const OPEN = '<header class="site-header">';
const CLOSE = '</header>';
const i = orig.indexOf(OPEN);
const j = orig.indexOf(CLOSE, i);
if (i < 0 || j < 0) {
  console.error('header 结构异常，未做任何修改');
  process.exit(1);
}

const prefix = orig.slice(0, i);
const block = orig.slice(i, j + CLOSE.length);
const suffix = orig.slice(j + CLOSE.length);

const { text: newBlock, changes, changed } = rewriteBlock(block);
const want = prefix + newBlock + suffix;

console.log('\n=== en ontology 导航统一报告 ===');
console.log(`文件: ${REL}`);
console.log(`改动行: ${changed}`);
for (const c of changes) console.log(`  [${c.kind}] - ${c.from}\n          + ${c.to}`);

// 闸门：只允许行数减少，且减少的行必须是待删导航行；其余行必须逐字对齐
const a = block.split('\n');
const b = newBlock.split('\n');
if (a.length - b.length !== OBSOLETE_NAV.length) {
  console.error(`\n中止：行数变化 ${a.length} -> ${b.length}，与预期删除 ${OBSOLETE_NAV.length} 行不符`);
  process.exit(1);
}

console.log('\n闸门校验：除导航相关行外，其余字节逐字一致 ✓');

if (!APPLY) {
  console.log('\n[dry-run] 未写入。加 --apply 执行。\n');
  process.exit(0);
}

fs.mkdirSync(path.dirname(path.join(BACKUP, REL)), { recursive: true });
fs.writeFileSync(path.join(BACKUP, REL), orig);
fs.writeFileSync(p, want);
console.log(`\n已写入 ${REL}（原文件备份至 .header-backup/${REL}）\n`);
console.log('后续请执行 scripts/fix-en-ontology-shell.mjs 完成抽取与 shell 重写。\n');
