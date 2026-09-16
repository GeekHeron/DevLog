#!/usr/bin/env node
/**
 * extract-header.mjs —— 把 body 片段里硬编码的顶部区块替换为 <SiteHeader /> 组件调用
 *
 * 设计原则：不做「猜测式」模板匹配，而是：
 *   1) 用统一算法（基于真实数据）把「prefix + header 块」还原为组件参数；
 *   2) 用组件生成器回放该参数，必须与原文字节完全一致 —— 不一致就拒绝替换；
 *   3) 全部通过后才写盘；任何一例失败整体中止。
 *
 * 扫描范围：src/sources/**（递归），含 en/ 子目录。
 *   —— 早期版本只扫顶层目录，导致 24 个英文页的导航一直留在 body 片段里自己一份，
 *      改组件对它们零效果。recursive + hrefPrefix 变体修复该问题。
 *
 * 有意变更（intentional change）与闸门
 * ─────────────────────────────────────
 * /en/ 下的页面原先各写一份导航，文案有 7 种变体（In-Depth / Deep Analysis、
 * About & Contact / About Me & Collaboration / About & Collaboration，
 * 其中 1 页还是 5 项、含已下线的 fuxi-engine 入口）。本次统一为与中文导航
 * 一一对应的四项英文导航（见 EN_UNIFIED_NAV）。
 *
 * 因为是「有意变更」，回放校验不再可能对原文逐字节成立。处理办法是两步：
 *   ① unifyEnNav()：把原文 header 块内的导航行改写成统一形式；
 *      闸门 navScopeGate() 强制要求「差异只出现在 logo 的 <a>/<img> 链接值与 <li> 导航行」，
 *      任何其它字节的变动一律判失败 —— 保证这次改写被约束在导航范围内。
 *   ② 之后仍走原样的严格回放校验：组件输出必须与改写后的块逐字节一致。
 * 两段都过，才写盘。
 *
 * 已知但未修（有意留在闸门之外，避免把「统一导航」扩权成「重排 HTML」）：
 *   en/article-manufacturing-ai-ontology.body.html 的 header 与其它变体都不同 ——
 *   汉堡三连 <span> 挤在一行、logo 与 button 之间没有空行、且带语言切换按钮。
 *   它同样需要「统一导航」，但排版差异超出了导航行范围，故本脚本对其报告为失败
 *   而不擅自改写；该页的导航统一由 scripts/fix-en-ontology-nav.mjs 承担：
 *   只替换导航行、语言切换行按钮的落点，并用同一套布局白名单断言其余字节不变。
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

/** 英文子目录（src/sources/en/*）的英文页导航目标：与中文四项一一对应 */
const EN_SUB_DIR = 'en/';
const EN_UNIFIED_NAV = [
  ['index.html', 'Home'],
  ['article.html', 'Deep Analysis'],
  ['works.html', 'Case Studies'],
  ['about-en.html', 'About Me &amp; Business'],
];

/**
 * 该页 header 的排版与其它变体都不同（汉堡三连 span 挤成一行、logo 与按钮之间无空行、
 * 带语言切换按钮），超出「统一导航」的范围。由 scripts/fix-en-ontology-nav.mjs 专责处理，
 * 本脚本跳过它而不是擅自重排 HTML。
 */
const STRUCTURAL_EXCEPTIONS = new Set(['en/article-manufacturing-ai-ontology.body.html']);

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
    tool = true,
    hrefPrefix = '',
    aboutHref = 'about.html',
    langHref = '',
    langLabel = '',
    langStyle = '',
    navItems = null,
    chrome = 'dark',
    leadBlank = 2,
    chromeBlank = 1,
    innerBlank = true,
    tailBlank = false,
    indent = '    ',
    indentUnit = '    ',
  } = props;

  const ZH = [['index.html', '首页'], ['article.html', '深度分析'], ['works.html', '商业案例'], ['about.html', '关于我 &amp; 商业合作']];
  const EN = [['index.html', 'Home'], ['article.html', 'Deep Analysis'], ['works.html', 'Case Studies'], [aboutHref, 'About Me &amp; Business']];
  const items = navItems || (variant === 'en' ? EN : ZH);

  // 与组件中的 link() 完全一致
  const link = (h) =>
    hrefPrefix && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/|\.\.\/)/i.test(h) ? hrefPrefix + h : h;

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
  L.push(`${at(1)}<a href="${link('index.html')}" class="logo">`);
  L.push(`${at(2)}<img src="${link('logo.png')}" alt="GeekHeron Logo" width="481" height="433">`);
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
  for (const [h, l] of items) L.push(`${at(3)}<li><a href="${link(h)}">${l}</a></li>`);
  if (langHref) {
    const st = langStyle ? ` style="${langStyle}"` : '';
    L.push(`${at(3)}<li><a href="${link(langHref)}" class="lang-btn" hreflang="en" lang="en"${st}>${langLabel}</a></li>`);
  }
  L.push(`${at(2)}</ul>`);
  L.push(`${at(1)}</nav>`);
  if (tool) {
    if (innerBlank) L.push('');
    L.push(`${at(1)}<div class="header-right">`);
    // 齿轮链接保持归档原样，不随 hrefPrefix 改写（与组件一致）
    L.push(`${at(2)}<a href="image-compressor.html" class="tool-icon" title="图片压缩工具" aria-label="图片压缩工具">⚙</a>`);
    L.push(`${at(1)}</div>`);
  } else if (tailBlank) {
    // 完全无 header-right，但保留收尾空行（about 页）
    L.push('');
  }
  L.push(`${indent}${HEADER_CLOSE}`);
  return L.join('\n');
}

/** 导航行的形状：允许被改写的行只有导航 <li> 与 logo 的 a/img */
const RE_NAV_LI = /^[ \t]*<li>.*<\/li>[ \t]*$/;

/**
 * 闸门：断言 orig 与 want 的差异「只出现在导航 <li> 行与 logo 的 a/img 链接值」。
 * 做法是把这两类差异从两侧一并抹平后，要求剩余字节完全相等 —— 于是
 * 「有意变更」被约束在导航范围内，其它任何字节的改动都会失败。
 * 允许 <li> 行数变化（有页面原本多一项「Source Delivery」）。
 */
function navScopeGate(orig, want) {
  const canon = (s) =>
    s
      .split('\n')
      .filter((l) => !RE_NAV_LI.test(l))
      .map((l) =>
        l
          .replace(/^(.*<a href=")[^"]*(" class="logo">.*)$/, '$1\u0000$2')
          .replace(/^(.*<img src=")[^"]*(" alt="GeekHeron Logo".*)$/, '$1\u0000$2')
      )
      .join('\n');

  const a = canon(orig);
  const b = canon(want);
  if (a !== b) {
    let n = 0;
    while (n < Math.min(a.length, b.length) && a[n] === b[n]) n++;
    return {
      ok: false,
      why: `导航之外的字节出现差异 @${n}\n      orig: ${JSON.stringify(a.slice(Math.max(0, n - 50), n + 50))}\n      want: ${JSON.stringify(b.slice(Math.max(0, n - 50), n + 50))}`,
    };
  }

  const liOf = (s) => (s.match(/^[ \t]*<li>.*<\/li>[ \t]*$/gm) || []).map((l) => l.trim());
  const logoOf = (s) =>
    [
      (s.match(/<a href="[^"]*" class="logo">/) || [''])[0],
      (s.match(/<img src="[^"]*" alt="GeekHeron Logo"[^>]*>/) || [''])[0],
    ].filter(Boolean);

  const diffs = [];
  const la = liOf(orig), lb = liOf(want);
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) diffs.push({ kind: 'nav', from: la[i] ?? '（无）', to: lb[i] ?? '（删除）' });
  }
  const ga = logoOf(orig), gb = logoOf(want);
  for (let i = 0; i < ga.length; i++) if (ga[i] !== gb[i]) diffs.push({ kind: 'logo', from: ga[i], to: gb[i] });
  return { ok: true, diffs };
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
  const hasHeaderRight = block.includes('class="header-right"');
  const tool = block.includes('tool-icon');
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

  // 站内链接前缀：从 logo 链接反推（'' / '../' / '/'）
  const logoHref = (block.match(/<a href="([^"]*)" class="logo">/) || [, ''])[1];
  const prefixMatch = logoHref.match(/^(\.\.\/|\/)/);
  const hrefPrefix = prefixMatch ? prefixMatch[1] : '';

  return {
    kind: 'ok',
    prefix, block, leadBlank, chrome, chromeBlank, indent, wrapped,
    props: {
      brand, tool, navItems,
      chrome, leadBlank, chromeBlank, innerBlank, tailBlank, indent, indentUnit,
      ...(hrefPrefix ? { hrefPrefix } : {}),
      ...(langRow ? { langHref: langRow.href, langLabel: langRow.label, ...(langStyle ? { langStyle } : {}) } : {}),
      ...(wrapped ? { _wrapped: true } : {}),
    },
  };
}

/** 生成 Astro 组件调用源码 */
function toAstroCall(props) {
  const parts = [];
  const ZH = [['index.html', '首页'], ['article.html', '深度分析'], ['works.html', '商业案例'], ['about.html', '关于我 &amp; 商业合作']];
  const EN_DEFAULT = [['index.html', 'Home'], ['article.html', 'Deep Analysis'], ['works.html', 'Case Studies'], ['about.html', 'About Me &amp; Business']];
  if (props._wrapped) return null; // 由调用方处理（container 场景单独处理）

  // 去掉站内前缀后再比较，便于识别内置导航
  const pfx = props.hrefPrefix || '';
  const bare = (h) => (pfx && h.startsWith(pfx) ? h.slice(pfx.length) : h);
  const items = (props.navItems || []).map(([h, l]) => [bare(h), l]);
  const eq = (a) => JSON.stringify(items) === JSON.stringify(a);

  if (eq(EN_UNIFIED_NAV)) {
    parts.push('variant="en"');
    if (pfx) parts.push(`hrefPrefix="${pfx}"`);
    parts.push('aboutHref="about-en.html"');
  } else if (eq(EN_DEFAULT)) {
    parts.push('variant="en"');
    if (pfx) parts.push(`hrefPrefix="${pfx}"`);
  } else if (eq(ZH)) {
    if (pfx) parts.push(`hrefPrefix="${pfx}"`);
  } else {
    const arr = props.navItems.map(([h, l]) => `['${h}','${l.replace(/'/g, "\\'")}']`).join(',');
    parts.push(`navItems={[${arr}]}`);
  }

  if (props.brand !== 'GeekHeron') parts.push(`brand="${props.brand}"`);
  if (props.tool !== true) parts.push('tool={false}');
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

/**
 * 有意变更：把 /en/ 页面内联 header 里的导航统一成 EN_UNIFIED_NAV。
 * 返回 { status: 'noop' | 'changed' | 'fail', text, diffs, why }
 */
function unifyEnNav(text, f) {
  if (!f.startsWith(EN_SUB_DIR)) return { status: 'noop', text };
  if (STRUCTURAL_EXCEPTIONS.has(f)) return { status: 'noop', text };
  const i = text.indexOf(HEADER_OPEN);
  if (i < 0) return { status: 'noop', text };
  const j = text.indexOf(HEADER_CLOSE, i);
  if (j < 0) return { status: 'fail', text, why: 'header 结构异常' };

  const prefix = text.slice(0, i);
  const block = text.slice(i, j + HEADER_CLOSE.length);

  // 目标参数：沿用原文的排版参数，只把导航换成统一四项（落点 about-en.html）
  const base = analyze(text);
  if (base.kind !== 'ok') return { status: 'fail', text, why: 'header 解析失败' };
  const want = renderHeader({
    ...base.props,
    navItems: null, // 用内置英文导航
    variant: 'en',
    hrefPrefix: '../',
    aboutHref: 'about-en.html',
    langHref: '', langLabel: '', langStyle: '',
  });

  const gate = navScopeGate(prefix + block, want);
  if (!gate.ok) return { status: 'fail', text, why: gate.why };
  if (gate.diffs.length === 0) return { status: 'noop', text };

  return {
    status: 'changed',
    text: want + text.slice(j + HEADER_CLOSE.length),
    diffs: gate.diffs,
  };
}

/** 递归列出 sources 下的 body 片段（相对路径，POSIX 分隔符）——含 en/ 子目录 */
function listBodies(dir, base = '', acc = []) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${d.name}` : d.name;
    if (d.isDirectory()) listBodies(path.join(dir, d.name), rel, acc);
    else if (d.name.endsWith('.body.html')) acc.push(rel);
  }
  return acc;
}

/** ---- 主流程 ---- */
const bodies = listBodies(SRC).sort();
const results = [];
const svgFail = [];
const unified = [];

for (const f of bodies) {
  const p = path.join(SRC, f);
  const origText = fs.readFileSync(p, 'utf8');

  // ① 有意变更：/en/ 页面导航统一（只改写导航行，闸门确保不外溢）
  const uni = unifyEnNav(origText, f);
  if (uni.status === 'fail') { results.push({ f, status: 'fail', why: '导航归一化失败：' + uni.why }); continue; }
  if (uni.status === 'changed') unified.push({ f, diffs: uni.diffs });
  const text = uni.text;

  // ② 严格回放校验
  const info = analyze(text);
  if (info.kind === 'no-header') { results.push({ f, status: 'skip', why: '无 header（独立工具页）' }); continue; }
  if (info.kind === 'malformed') { results.push({ f, status: 'fail', why: 'header 结构异常' }); continue; }
  if (info.wrapped) { results.push({ f, status: 'skip', why: 'header 嵌套在 container 内（结构不同）' }); continue; }
  if (STRUCTURAL_EXCEPTIONS.has(f)) {
    results.push({ f, status: 'skip', why: 'header 排版特殊，由 fix-en-ontology-nav.mjs + fix-en-ontology-shell.mjs 处理' });
    continue;
  }

  const call = toAstroCall(info.props);
  if (!call) { results.push({ f, status: 'skip', why: '无法生成调用' }); continue; }

  const replay = renderHeader(info.props);
  if (replay !== info.prefix + info.block) {
    let n = 0;
    while (n < Math.min(replay.length, (info.prefix + info.block).length) && replay[n] === (info.prefix + info.block)[n]) n++;
    svgFail.push({ f, n, got: JSON.stringify(replay.slice(Math.max(0, n - 40), n + 40)), want: JSON.stringify((info.prefix + info.block).slice(Math.max(0, n - 40), n + 40)) });
    results.push({ f, status: 'fail', why: '回放不一致 @' + n });
    continue;
  }
  const newText = text.replace(info.prefix + info.block, call);
  if (newText === text) { results.push({ f, status: 'fail', why: '替换未生效' }); continue; }
  results.push({ f, status: 'ok', props: info.props, call, newText, origText });
}

const ok = results.filter((r) => r.status === 'ok');
const fails = results.filter((r) => r.status === 'fail');
const skips = results.filter((r) => r.status === 'skip');

console.log('\n=== SiteHeader 抽取报告 ===');
console.log(`总计: ${results.length}   可抽取: ${ok.length}   跳过: ${skips.length}   失败: ${fails.length}`);

console.log(`\n① 有意变更 · 英文页导航统一: ${unified.length} 个文件`);
if (unified.length) {
  const kinds = {};
  for (const u of unified) for (const d of u.diffs) kinds[d.kind] = (kinds[d.kind] || 0) + 1;
  console.log(`   改动行合计: ${Object.entries(kinds).map(([k, v]) => k + '=' + v).join(', ')}`);
  console.log('   目标导航: ' + EN_UNIFIED_NAV.map(([h, l]) => l.replace(/&amp;/g, '&') + '→' + h).join(' | '));
  const sample = unified.find((u) => u.diffs.some((d) => d.kind === 'nav'));
  if (sample) {
    console.log('   示例 ' + sample.f + ':');
    for (const d of sample.diffs.slice(0, 9)) console.log(`     - ${d.from}\n     + ${d.to}`);
  }
}

const byVariant = {};
for (const r of ok) { const k = r.call.replace(/\s+/g, ' '); byVariant[k] = (byVariant[k] || 0) + 1; }
console.log('\n② 抽取调用形式分布:');
Object.entries(byVariant).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  x${v}  ${k}`));
if (skips.length) { console.log('\n跳过:'); skips.forEach((r) => console.log(`  ${r.f} — ${r.why}`)); }
if (fails.length) {
  console.log('\n失败:');
  fails.forEach((r) => console.log(`  ${r.f} — ${r.why}`));
  svgFail.forEach((x) => { console.log(`\n  ${x.f} @${x.n}`); console.log(`    got : ${x.got}`); console.log(`    want: ${x.want}`); });
}

if (!APPLY) { console.log('\n[dry-run] 未写入。加 --apply 执行。\n'); process.exit(fails.length ? 1 : 0); }
if (fails.length) { console.error('\n存在失败项，中止写入。\n'); process.exit(1); }

// 写盘：备份「归一化之前的原文」，用于回滚
fs.mkdirSync(BACKUP, { recursive: true });
let n = 0;
for (const r of ok) {
  const p = path.join(SRC, r.f);
  const bak = path.join(BACKUP, r.f);
  fs.mkdirSync(path.dirname(bak), { recursive: true }); // en/ 等子目录需要先建目录
  fs.writeFileSync(bak, r.origText);
  fs.writeFileSync(p, r.newText);
  n++;
}
console.log(`\n已替换 ${n} 个文件（含 ${unified.length} 个导航统一），备份位于 .header-backup/\n`);
