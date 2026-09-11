#!/usr/bin/env node
/**
 * extract-header.mjs —— 把 body 片段里硬编码的顶部区块替换为 <SiteHeader /> 组件调用
 *
 * 设计原则：不做「猜测式」模板匹配，而是：
 *   1) 用统一算法（基于真实数据）把「prefix + header 块」还原为组件参数；
 *   2) 用组件生成器回放该参数，必须与原文字节完全一致 —— 不一致就拒绝替换；
 *   3) 全部通过后才写盘；任何一例失败整体中止。
 *
 * 用法：
 *   node scripts/extract-header.mjs            # dry-run，只报告
 *   node scripts/extract-header.mjs --apply    # 实际写入（含备份）
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src', 'sources');
const BACKUP = path.join(ROOT, '.header-backup');
const APPLY = process.argv.includes('--apply');

const HEADER_OPEN = '<header class="site-header">';
const HEADER_CLOSE = '</header>';

/**
 * 统计 s 开头有多少「空行」。
 * s 形如 "\n\n    " 表示：换行结束上一行 → 1 个空行 → 到达缩进。
 * 因此空行数 = (开头的 \n 个数) - 1，且若剩余部分只有空白则再减 1。
 */
function countBlankLines(s) {
  const nl = (s.match(/^\n*/)[0] || '').length;
  if (nl === 0) return 0;
  const tail = s.slice(nl);
  // 换行之后的残余若为纯缩进（表示后面紧跟内容），则其中 (nl-1) 为空行
  if (/^[ \t]*$/.test(tail)) return Math.max(0, nl - 1);
  return nl;
}

/** ---- 组件渲染器（与 SiteHeader.astro 的输出逻辑保持一致）---- */
function renderHeader(props) {
  const {
    variant = 'zh',
    brand = 'GeekHeron',
    clock = 'T+00: 00: 00',
    tool = true,
    langHref = '',
    langLabel = '',
    langStyle = '',
    navItems = null,
    chrome = 'dark',
    leadBlank = 2,
    chromeBlank = 1,
    innerBlank = true,
    tailBlank = false,
    showClock = false,
    indent = '    ',
    indentUnit = '    ',
  } = props;

  const ZH = [['index.html', '首页'], ['article.html', '深度分析'], ['works.html', '商业案例'], ['fuxi-engine.html', '伏羲引擎'], ['about.html', '关于我 &amp; 商业合作']];
  const EN = [['index.html', 'Home'], ['article.html', 'Deep Analysis'], ['works.html', 'Case Studies'], ['fuxi-engine.html', 'Fuxi Engine'], ['about.html', 'About Me &amp; Business']];
  const items = navItems || (variant === 'en' ? EN : ZH);

  // 缩进：indent=header 前置缩进；indentUnit=每级子缩进量（默认 4 空格，index 页为 0+2）
  const u = indentUnit;
  const at = (n) => indent + u.repeat(n);
  const L = [];
  for (let i = 0; i < leadBlank; i++) L.push('');
  if (chrome === 'dark') {
    L.push(`${indent}<canvas id="galaxy-field"></canvas>`);
    L.push(`${indent}<div class="overlay-dark"></div>`);
  } else if (chrome === 'darkAria') {
    L.push(`${indent}<canvas id="galaxy-field" aria-hidden="true"></canvas>`);
    L.push(`${indent}<div class="overlay-gradient" aria-hidden="true"></div>`);
  }
  // chromeBlank 表示「chrome 之后、header 之前的空行数」（0 表示紧跟）
  for (let i = 0; i < chromeBlank; i++) L.push('');

  L.push(`${indent}${HEADER_OPEN}`);
  L.push(`${at(1)}<a href="index.html" class="logo">`);
  L.push(`${at(2)}<img src="logo.png" alt="GeekHeron Logo" width="481" height="433">`);
  L.push(`${at(2)}<span>${brand}</span>`);
  L.push(`${at(1)}</a>`);
  if (innerBlank) L.push('');
  L.push(`${at(1)}<button class="hamburger" type="button" aria-label="Toggle menu" aria-expanded="false" aria-controls="primary-nav">`);
  L.push(`${at(2)}<span></span>`);
  L.push(`${at(2)}<span></span>`);
  L.push(`${at(2)}<span></span>`);
  L.push(`${at(1)}</button>`);
  if (innerBlank) L.push('');
  L.push(`${at(1)}<nav class="nav-links" id="primary-nav">`);
  L.push(`${at(2)}<ul>`);
  for (const [h, l] of items) L.push(`${at(3)}<li><a href="${h}">${l}</a></li>`);
  if (langHref) {
    const st = langStyle ? ` style="${langStyle}"` : '';
    L.push(`${at(3)}<li><a href="${langHref}" class="lang-btn" hreflang="en" lang="en"${st}>${langLabel}</a></li>`);
  }
  L.push(`${at(2)}</ul>`);
  L.push(`${at(1)}</nav>`);
  if (tool) {
    if (innerBlank) L.push('');
    L.push(`${at(1)}<div class="header-right">`);
    L.push(`${at(2)}<span id="clock">${clock}</span>`);
    L.push(`${at(2)}<a href="image-compressor.html" class="tool-icon" title="图片压缩工具" aria-label="图片压缩工具">⚙</a>`);
    L.push(`${at(1)}</div>`);
  } else if (showClock) {
    // 有 header-right 但无齿轮图标（index 页）
    if (innerBlank) L.push('');
    L.push(`${at(1)}<div class="header-right">`);
    L.push(`${at(2)}<span id="clock">${clock}</span>`);
    L.push(`${at(1)}</div>`);
  } else if (tailBlank) {
    // 完全无 header-right，但保留收尾空行（about 页）
    L.push('');
  }
  L.push(`${indent}${HEADER_CLOSE}`);
  return L.join('\n');
}

/** 解析：从原文反推出组件参数 */
function analyze(text) {
  const i = text.indexOf(HEADER_OPEN);
  if (i < 0) return { kind: 'no-header' };
  const j = text.indexOf(HEADER_CLOSE, i);
  if (j < 0) return { kind: 'malformed' };
  const prefix = text.slice(0, i);
  const block = text.slice(i, j + HEADER_CLOSE.length);

  // 解析前缀：空行数 / chrome 类型 / chrome 后空行数 / 缩进
  // renderHeader 用 L.join('\n')，故「前导 N 个空串元素」正好产出前缀开头的 N 个 \n。
  // 因此 leadBlank 直接等于 prefix 开头的 \n 个数。
  const prefixNL = (prefix.match(/^\n*/)[0] || '').length;
  const leadBlank = prefixNL;
  const rest = prefix.slice(prefixNL);
  const indentMatch = rest.match(/^([ \t]*)/);
  const indent = indentMatch ? indentMatch[1] : '    ';
  // 推断子缩进单位：header 后第一个子元素相对 header 的缩进量
  const afterOpen = block.slice(block.indexOf(HEADER_OPEN) + HEADER_OPEN.length);
  const childAbs = (afterOpen.match(/\n([ \t]*)\S/) || [, '    '])[1];
  const indentUnit = childAbs.startsWith(indent) ? childAbs.slice(indent.length) : childAbs;

  let chrome = 'none';
  let chromeBlank = 0;
  if (rest.includes('id="galaxy-field" aria-hidden="true"')) {
    chrome = 'darkAria';
    const marker = '<div class="overlay-gradient" aria-hidden="true"></div>';
    chromeBlank = countBlankLines(rest.slice(rest.indexOf(marker) + marker.length));
  } else if (rest.includes('id="galaxy-field"')) {
    chrome = 'dark';
    const marker = '<div class="overlay-dark"></div>';
    chromeBlank = countBlankLines(rest.slice(rest.indexOf(marker) + marker.length));
  }

  // 结构例外：header 被包在 container 里（fuxiengine / tiangangame-bp）
  const wrapped = /<div class="container">\s*$/.test(rest);

  // 解析块内容
  const brand = (block.match(/<span>(GEEKHERON|GeekHeron)<\/span>/) || [, 'GeekHeron'])[1];
  const clock = (block.match(/<span id="clock">([^<]*)<\/span>/) || [, ''])[1];
  const hasHeaderRight = block.includes('class="header-right"');
  const hasGear = block.includes('tool-icon');
  const tool = hasGear;
  const showClock = hasHeaderRight && !hasGear;
  // 收尾空行：</nav> 与 </header> 之间（且无 header-right）存在空行
  const tailBlank = !hasHeaderRight && /<\/nav>\n\s*\n\s*<\/header>/.test(block);
  const innerBlank = /\n\s*\n/.test(
    block.slice(block.indexOf('</a>') + 4, block.indexOf('<button'))
  );
  const navRows = [...block.matchAll(/<li><a href="([^"]+)"([^>]*)>([^<]+)<\/a>((?:(?!<li>)[\s\S])*?)<\/li>/g)]
    .map((m) => ({ href: m[1], attrs: m[2], label: m[3], extra: m[4].trim() }));
  const langRow = navRows.find((r) => r.attrs.includes('lang-btn'));
  const navItems = navRows.filter((r) => !r.attrs.includes('lang-btn')).map((r) => [r.href, r.label]);
  const langStyle = langRow ? (langRow.attrs.match(/style="([^"]*)"/) || [, ''])[1] : '';

  return {
    kind: 'ok',
    prefix, block, leadBlank, chrome, chromeBlank, indent, wrapped,
    props: {
      brand, clock, tool, showClock, navItems,
      chrome, leadBlank, chromeBlank, innerBlank, tailBlank, indent, indentUnit,
      ...(langRow ? { langHref: langRow.href, langLabel: langRow.label, ...(langStyle ? { langStyle } : {}) } : {}),
      ...(wrapped ? { _wrapped: true } : {}),
    },
  };
}

/** 生成 Astro 组件调用源码 */
function toAstroCall(props) {
  const parts = [];
  const ZH = [['index.html', '首页'], ['article.html', '深度分析'], ['works.html', '商业案例'], ['fuxi-engine.html', '伏羲引擎'], ['about.html', '关于我 &amp; 商业合作']];
  const EN = [['index.html', 'Home'], ['article.html', 'Deep Analysis'], ['works.html', 'Case Studies'], ['fuxi-engine.html', 'Fuxi Engine'], ['about.html', 'About Me &amp; Business']];
  if (props._wrapped) return null; // 由调用方处理（container 场景单独处理）
  if (JSON.stringify(props.navItems) === JSON.stringify(EN)) parts.push('variant="en"');
  else if (JSON.stringify(props.navItems) !== JSON.stringify(ZH)) {
    const arr = props.navItems.map(([h, l]) => `['${h}','${l.replace(/'/g, "\\'")}']`).join(',');
    parts.push(`navItems={[${arr}]}`);
  }
  if (props.brand !== 'GeekHeron') parts.push(`brand="${props.brand}"`);
  if (props.clock !== 'T+00: 00: 00') parts.push(`clock="${props.clock}"`);
  if (props.tool !== true) parts.push('tool={false}');
  if (props.showClock) parts.push('showClock');
  if (props.chrome !== 'dark') parts.push(`chrome="${props.chrome}"`);
  if (props.leadBlank !== 2) parts.push(`leadBlank={${props.leadBlank}}`);
  if (props.chromeBlank !== 1) parts.push(`chromeBlank={${props.chromeBlank}}`);
  if (props.innerBlank === false) parts.push('innerBlank={false}');
  if (props.tailBlank) parts.push('tailBlank');
  if (props.indent !== '    ') parts.push(`indent="${props.indent}"`);
  if (props.indentUnit !== '    ') parts.push(`indentUnit="${props.indentUnit}"`);
  if (props.langHref) {
    parts.push(`langHref="${props.langHref}"`, `langLabel="${props.langLabel}"`);
    if (props.langStyle) parts.push(`langStyle="${props.langStyle}"`);
  }
  return parts.length ? `  <SiteHeader ${parts.join(' ')} />` : '  <SiteHeader />';
}

/** ---- 主流程 ---- */
const bodies = fs.readdirSync(SRC).filter((f) => f.endsWith('.body.html')).sort();
const results = [];
const svgFail = [];

for (const f of bodies) {
  const p = path.join(SRC, f);
  const text = fs.readFileSync(p, 'utf8');
  const info = analyze(text);
  if (info.kind === 'no-header') { results.push({ f, status: 'skip', why: '无 header（独立工具页）' }); continue; }
  if (info.kind === 'malformed') { results.push({ f, status: 'fail', why: 'header 结构异常' }); continue; }
  if (info.wrapped) { results.push({ f, status: 'skip', why: 'header 嵌套在 container 内（结构不同）' }); continue; }

  const call = toAstroCall(info.props);
  if (!call) { results.push({ f, status: 'skip', why: '无法生成调用' }); continue; }

  // 回放校验：组件输出必须与原文 prefix+block 逐字节一致
  const replay = renderHeader(info.props);
  if (replay !== info.prefix + info.block) {
    let n = 0;
    while (n < Math.min(replay.length, (info.prefix + info.block).length) && replay[n] === (info.prefix + info.block)[n]) n++;
    svgFail.push({ f, n, got: JSON.stringify(replay.slice(Math.max(0, n - 40), n + 40)), want: JSON.stringify((info.prefix + info.block).slice(Math.max(0, n - 40), n + 40)) });
    results.push({ f, status: 'fail', why: '回放不一致 @' + n });
    continue;
  }
  results.push({ f, status: 'ok', props: info.props, call, prefix: info.prefix, block: info.block });
}

const ok = results.filter((r) => r.status === 'ok');
const fails = results.filter((r) => r.status === 'fail');
const skips = results.filter((r) => r.status === 'skip');

console.log('\n=== SiteHeader 抽取报告 ===');
console.log(`总计: ${results.length}   可抽取: ${ok.length}   跳过: ${skips.length}   失败: ${fails.length}`);
const byVariant = {};
for (const r of ok) { const k = r.call.replace(/\s+/g, ' '); byVariant[k] = (byVariant[k] || 0) + 1; }
console.log('\n调用形式分布:');
Object.entries(byVariant).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  x${v}  ${k}`));
if (skips.length) { console.log('\n跳过:'); skips.forEach((r) => console.log(`  ${r.f} — ${r.why}`)); }
if (fails.length) {
  console.log('\n失败（回放不一致）:');
  fails.forEach((r) => console.log(`  ${r.f} — ${r.why}`));
  svgFail.forEach((x) => { console.log(`\n  ${x.f} @${x.n}`); console.log(`    got : ${x.got}`); console.log(`    want: ${x.want}`); });
}

if (!APPLY) { console.log('\n[dry-run] 未写入。加 --apply 执行。\n'); process.exit(fails.length ? 1 : 0); }
if (fails.length) { console.error('\n存在失败项，中止写入。\n'); process.exit(1); }

fs.mkdirSync(BACKUP, { recursive: true });
let n = 0;
for (const r of ok) {
  const p = path.join(SRC, r.f);
  const text = fs.readFileSync(p, 'utf8');
  fs.writeFileSync(path.join(BACKUP, r.f), text);
  const newText = text.replace(r.prefix + r.block, r.call);
  if (newText === text) { console.error('替换未生效:', r.f); process.exit(1); }
  fs.writeFileSync(p, newText);
  n++;
}
console.log(`\n已替换 ${n} 个文件，备份位于 .header-backup/\n`);
