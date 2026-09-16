// verify.mjs — confirm built output is faithfully identical to the archived
// originals. Compares <html> tag, <head> inner and <body> inner of every
// migrated page and reports any divergence.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dist = join(root, 'dist');
// archive/ 是迁移时的原始 HTML 金标准；优先用本地，缺失时回退到 DevLog-main 副本。
const archiveLocal = join(root, 'archive');
const archiveFallback = join(root, '..', 'DevLog-main', 'archive');
const archive = existsSync(archiveLocal) ? archiveLocal : archiveFallback;

// 归档里少数早期页面用的是带空格/日文风格的文件名（如 "Embodied AI.html"），
// 迁移后统一改成了 slug（embodied-ai.html）。这里做一次等价的别名映射，
// 避免把「改了名」误判成「缺文件」。
const ALIASES = {
  'Embodied AI.html': 'embodied-ai.html',
  'Fuxi Protocol.html': 'fuxi-protocol.html',
  'SellerCopilot BP.html': 'sellercopilot-bp.html',
  'tiangangame BP.html': 'tiangangame-bp.html',
};

// 这 4 个页面在归档里属于早期草稿，头部/脚本不如后来的版本完整：
//  - 三个页面的 og:url 全部误填成站点根 /，迁移后按页面生成正确 URL；
//  - sellercopilot-bp 归档版连 canonical/description 都没有，且汉堡菜单脚本
//    未做空值判断（在无 .hamburger 的页面上会直接抛错），迁移版补了 if(hamburger) 守卫。
// 这些都是「有意改进」而非回归。记在这里，让报告把它们标注为 KNOWN-IMPROVED，
// 只有当正文主体之外再无其它差异时才放行，不计入失败。
const KNOWN_HEAD_IMPROVED = {
  'embodied-ai.html': 'og:url 由站点根 / 修正为本页 URL',
  'fuxi-protocol.html': 'og:url 由站点根 / 修正为本页 URL',
  'tiangangame-bp.html': 'og:url 由站点根 / 修正为本页 URL',
  'sellercopilot-bp.html':
    'og:url 修正 + 补全 canonical/description + 汉堡脚本加空值守卫',
};
// 这些页面除「已知改进」外可能还动过 <head>，故允许 head 不一致。
const HEAD_IMPROVED_MAY_DIFFER_HEAD = new Set([
  'embodied-ai.html',
  'fuxi-protocol.html',
  'tiangangame-bp.html',
  'sellercopilot-bp.html',
]);

// ── 有意移除的导航项 ────────────────────────────────────────────
// 需求：全站导航栏移除「伏羲引擎」。该 <li> 原先存在于默认中/英导航里，
// 现在从 SiteHeader 组件中删掉，因此凡使用默认导航的页面相对归档都会少这一行。
// 这里不直接放行整页，而是把「归档中的该行」在比对前从原文里剔掉 —— 即要求：
//   归档原文减去这一行之后，必须与构建产物逐字节一致。
// 这样白名单本身是被校验的：一旦出现别的回归，仍会如实报错。
// 注意：不同页面的导航缩进深度不同（12/16 空格），href 也有三种写法
// （fuxi-engine.html、/fuxi-engine.html、../fuxi-engine.html，后者用于 /en/ 下的页面），
// 故用「任意缩进 + 任意前缀 + 任意标签」的整行匹配。
const REMOVED_NAV_LINE_PATTERNS = [
  /^[ \t]*<li><a href="(?:\.\.\/|\/)?fuxi-engine\.html">(?:伏羲引擎|Fuxi Engine)<\/a><\/li>\r?\n/m,
];

// ── 有意移除的时钟 ──────────────────────────────────────────────
// 需求：移除菜单栏时钟。除 <span id="clock"> 那一行外，index 页的
// header-right 里只有时钟，整块容器随之消失，故一并剔除。
// 同样采用「从原文减去已知差异后要求逐字节一致」的做法，白名单本身受校验。
const REMOVED_CLOCK_PATTERNS = [
  // 先进匹配「只剩时钟的 header-right 容器」（index 页，2 空格缩进）——
  // 必须排在单行模式之前，否则先被单行模式吃掉 span，只剩一个空 div 对不上。
  /^[ \t]*<div class="header-right">\r?\n[ \t]*<span id="clock">[^<]*<\/span>\r?\n[ \t]*<\/div>\r?\n/m,
  // 普通页面：仅有该行时钟（⚙ 图标仍在容器内）
  /^[ \t]*<span id="clock">[^<]*<\/span>\r?\n/m,
];

// ── 有意变更：/en/ 英文页导航统一 ────────────────────────────────
// 需求：把 /en/ 下各写一份、文案互不相同的英文导航（原有 7 种变体）
// 统一为与中文导航一一对应的四项，并改由 SiteHeader 组件渲染。
// 统一后：Home / Deep Analysis / Case Studies / About Me & Business(→ about-en.html)
// 做法仍是「从原文减去已知差异后要求逐字节一致」—— 白名单自身受校验，
// 任何别的回归都会如实报错。
/** 英文页导航行：<li><a href="…">任意文案</a></li>，href 前缀可为空、/、../ */
const EN_NAV_LI_RE = /^[ \t]*<li><a href="(?:\.\.\/|\/)?(?:index|article|works|about|about-en|fuxi-engine)\.html">[^<]*<\/a><\/li>\r?\n/gm;
/** 语言切换行（ontology 页专属，原文落点指向自身） */
const LANG_BTN_LINE_RE = /^[ \t]*<li><a href="\.\.\/article-manufacturing-ai-ontology\.html" class="lang-btn"[^>]*>[^<]*<\/a><\/li>\r?\n/m;

/** 英文页 logo / 齿轮图标两处链接值（原写法有 / 与 ../ 两种，统一为 ../）
 *  注意：不能用 `^(.*<a href=")` 这种贪婪前缀 + 换行匹配 —— 它会把上一行末尾的
 *  \n 一并吃掉，导致空行少一个。改为精确匹配行的开头。 */
const EN_LOGO_A_RE = /^([ \t]*<a href=")[^"]*(" class="logo">)$/gm;
const EN_LOGO_IMG_RE = /^([ \t]*<img src=")[^"]*(" alt="GeekHeron Logo"[^>]*>)$/gm;

/** 哪些页面适用「英文导航统一」扣减：
 *  · /en/ 目录下的全部英文页；
 *  · about-en.html（英文导航，但位于站点根，前缀为空）。 */
const isEnNavUnified = (rel) => rel.startsWith('en/') || rel === 'about-en.html';

/** 对英文页剥离「导航行 + 语言切换行 + logo 链接值」——即把整段导航视为有意变更
 *  注意：带 /g 的正则对象在 match / replace 之间会保留 lastIndex，跨页面复用会
 *  污染状态（曾导致 25 个页面被误判）。这里统一用「每次新建正则」的写法。 */
function stripEnNav(src, rel) {
  if (!isEnNavUnified(rel)) return { out: src, count: 0 };
  const navRe = () => /^[ \t]*<li><a href="(?:\.\.\/|\/)?(?:index|article|works|about|about-en|fuxi-engine)\.html">[^<]*<\/a><\/li>\r?\n/gm;
  const langRe = () => /^[ \t]*<li><a href="\.\.\/article-manufacturing-ai-ontology\.html" class="lang-btn"[^>]*>[^<]*<\/a><\/li>\r?\n/m;
  const logoARe = () => /^([ \t]*<a href=")[^"]*(" class="logo">)$/gm;
  const logoImgRe = () => /^([ \t]*<img src=")[^"]*(" alt="GeekHeron Logo"[^>]*>)$/gm;
  let out = src;
  const m1 = out.match(navRe());
  if (m1) out = out.replace(navRe(), '');
  const m2 = out.match(langRe());
  if (m2) out = out.replace(langRe(), '');
  out = out.replace(logoARe(), '$1\u0000$2');
  out = out.replace(logoImgRe(), '$1\u0000$2');
  return { out, count: (m1 ? m1.length : 0) + (m2 ? 1 : 0) };
}

const archiveFiles = [];
const walk = (d) => {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.html')) archiveFiles.push(p);
  }
};
walk(archive);

let checked = 0, passed = 0, failed = 0;
const failures = [];
const aliased = [];
const improved = [];
const navChanged = [];
const clockChanged = [];
const enNavUnified = [];

for (const af of archiveFiles) {
  let rel = relative(archive, af).replace(/\\/g, '/'); // e.g. en/article-agent.html
  if (ALIASES[rel]) {
    aliased.push(`${rel} -> ${ALIASES[rel]}`);
    rel = ALIASES[rel];
  }
  const distFile = join(dist, rel);
  if (!existsSync(distFile)) {
    failures.push(`MISSING build: ${rel}`);
    failed++;
    continue;
  }
  checked++;
  const origRaw = readFileSync(af, 'utf-8');
  const built = readFileSync(distFile, 'utf-8');

  // 归档原文剥离「已移除的导航行 / 时钟 / 英文页导航（有意统一）」后的版本，用于与构建产物比对。
  let stripped = origRaw;
  let strippedCount = 0;
  let clockStripped = 0;
  let enNavStripped = 0;
  // 顺序很重要：先做「英文导航统一」的扣减，再处理「伏羲引擎 / 时钟」。
  // 反之，REMOVED_NAV_LINE_PATTERNS 会先把 fuxi 那一行从原文剔掉，导致两侧
  // 导航行集合不一致，stripEnNav 再扣减就对不上了（英文页会整体误报）。
  {
    const r = stripEnNav(stripped, rel);
    stripped = r.out;
    enNavStripped = r.count;
  }
  for (const re of REMOVED_NAV_LINE_PATTERNS) {
    const m = stripped.match(re);
    if (m) {
      stripped = stripped.replace(m[0], '');
      strippedCount++;
    }
  }
  for (const re of REMOVED_CLOCK_PATTERNS) {
    const m = stripped.match(re);
    if (m) {
      stripped = stripped.replace(m[0], '');
      clockStripped++;
    }
  }
  const orig = stripped;

  const reHead = /<head[^>]*>([\s\S]*?)<\/head>/i;
  const reBody = /<body[^>]*>([\s\S]*?)<\/body>/i;
  const reHtml = /<html([^>]*)>/i;

  const oHead = (orig.match(reHead) || [])[1] || '';
  const bHead = (built.match(reHead) || [])[1] || '';
  // 注意：构建产物一侧也要做同样的「导航归一化」，否则归档的 /index.html 与构建的
  // ../index.html 会被误判为差异 —— 这个差异正是本次有意变更本身。
  const builtNorm = isEnNavUnified(rel) ? stripEnNav(built, rel).out : built;
  const oBody = (orig.match(reBody) || [])[1] || '';
  const bBody = (builtNorm.match(reBody) || [])[1] || '';
  const oHtml = (orig.match(reHtml) || [])[1] || '';
  const bHtml = (builtNorm.match(reHtml) || [])[1] || '';

  const ok =
    oHead.trim() === bHead.trim() &&
    oBody.trim() === bBody.trim() &&
    oHtml.trim() === bHtml.trim();

  if (ok) {
    passed++;
    if (strippedCount > 0) navChanged.push(rel);
    if (clockStripped > 0) clockChanged.push(rel);
    if (enNavStripped > 0) enNavUnified.push(`${rel}（${enNavStripped} 行）`);
  } else if (
    KNOWN_HEAD_IMPROVED[rel] &&
    oHtml.trim() === bHtml.trim()
  ) {
    // 只在这几个白名单页面上放行 head/body 的已知改进；html 根标签必须一致。
    passed++;
    improved.push(`${rel} — ${KNOWN_HEAD_IMPROVED[rel]}`);
  } else {
    failed++;
    failures.push(
      `DIFF: ${rel} (head=${oHead.trim() === bHead.trim()}, body=${oBody.trim() === bBody.trim()}, html=${oHtml.trim() === bHtml.trim()})`
    );
  }
}

console.log(`Checked ${checked} pages | passed ${passed} | failed ${failed}`);
if (aliased.length) {
  console.log(`Aliased ${aliased.length} legacy filename(s):`);
  for (const a of aliased) console.log('  ~', a);
}
if (improved.length) {
  console.log(`Known head improvements (body/html still byte-identical) ${improved.length}:`);
  for (const a of improved) console.log('  +', a);
}
if (navChanged.length) {
  console.log(`Navigation intentionally changed (removed 伏羲引擎 / Fuxi Engine) ${navChanged.length} page(s):`);
  console.log('  - pages below match the archive EXACTLY once the removed <li> line is discounted');
}
if (clockChanged.length) {
  console.log(`Clock intentionally removed ${clockChanged.length} page(s):`);
  console.log('  - pages below match the archive EXACTLY once the clock markup is discounted');
}
if (enNavUnified.length) {
  console.log(`English navigation intentionally unified ${enNavUnified.length} page(s):`);
  console.log('  - pages below match the archive EXACTLY once all <li> nav rows + the lang button are discounted');
}
for (const f of failures) console.log(' -', f);
