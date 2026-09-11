#!/usr/bin/env node
/**
 * finalize-header.mjs —— 抽取收尾：
 *   1) 从 body 片段中移除 `  <SiteHeader ... />` 占位符；其余内容原样保留。
 *   2) 重写对应 page shell，导出 headerProps 并传给 BaseLayout。
 *
 * 前置：先执行 `node scripts/extract-header.mjs --apply`。
 * 用法：node scripts/finalize-header.mjs [--apply]
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src', 'sources');
const PAGES = path.join(ROOT, 'src', 'pages');
const APPLY = process.argv.includes('--apply');

// 占位符：只匹配「缩进 + 标签」本身，不吞掉行尾换行。
// 这样紧随其后的空行（header 与正文之间的分隔）会被完整保留。
const MARKER_RE = /^[ \t]*<SiteHeader\b[^\n]*\/>/m;

/** 从占位符源码中解析出 props 对象 */
function parseMarkerProps(marker) {
  // 去掉组件名与结尾的 "/>"，只留属性串
  const attrsSrc = marker
    .replace(/^[ \t]*<SiteHeader\b/, '')
    .replace(/\/>[ \t]*\r?\n?$/, '')
    .trim();
  if (!attrsSrc) return {};

  // 构造一个对象字面量再安全求值：
  //   key="str" -> key: "str"；key={expr} -> key: (expr)；裸 key -> key: true
  const pairs = [];
  const re = /([A-Za-z_$][\w$]*)(?:\s*=\s*(?:"([^"]*)"|\{((?:[^{}]|\{[^{}]*\})*)\}))?/g;
  let m;
  while ((m = re.exec(attrsSrc))) {
    if (!m[1]) break;
    const key = m[1];
    if (m[2] !== undefined) pairs.push(`${key}: ${JSON.stringify(m[2])}`);
    else if (m[3] !== undefined) pairs.push(`${key}: (${m[3]})`);
    else pairs.push(`${key}: true`);
    if (m.index === re.lastIndex) re.lastIndex++; // 防零宽死循环
  }
  if (!pairs.length) return {};
  try {
    return Function(`"use strict"; return ({ ${pairs.join(', ')} });`)();
  } catch {
    return {};
  }
}

/** 生成 props 的 Astro 字面量（保留中文，转义单引号） */
function toLiteral(props) {
  const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  const parts = [];
  for (const [k, v] of Object.entries(props)) {
    if (Array.isArray(v)) {
      parts.push(`${k}: [${v.map((p) => `[${q(p[0])}, ${q(p[1])}]`).join(', ')}]`);
    } else if (typeof v === 'string') {
      parts.push(`${k}: ${q(v)}`);
    } else {
      // number | boolean
      parts.push(`${k}: ${v}`);
    }
  }
  return `{ ${parts.join(', ')} }`;
}

const bodies = fs.readdirSync(SRC).filter((f) => f.endsWith('.body.html')).sort();
const report = { stripped: [], noMarker: [], missingShell: [] };
const plan = [];

for (const f of bodies) {
  const route = f.replace(/\.body\.html$/, '');
  const bodyPath = path.join(SRC, f);
  const text = fs.readFileSync(bodyPath, 'utf8');
  const m = MARKER_RE.exec(text);
  if (!m) continue;
  const props = parseMarkerProps(m[0]);
  const newBody = text.slice(0, m.index) + text.slice(m.index + m[0].length);
  const pagePath = path.join(PAGES, route + '.astro');
  if (!fs.existsSync(pagePath)) { report.missingShell.push(route); continue; }
  const depth = route.split('/').length - 1;
  const prefix = '../'.repeat(depth + 1);
  // 保留原有 htmlProps（如英文页的 lang="en"）
  const oldShell = fs.readFileSync(pagePath, 'utf8');
  const hp = oldShell.match(/const htmlProps = (\{[^}]*\});/);
  const htmlPropsLit = hp ? hp[1] : '{ lang: "zh-CN" }';
  const shell = `---
import BaseLayout from '${prefix}layouts/BaseLayout.astro';
import head from '${prefix}sources/${route}.head.html?raw';
import body from '${prefix}sources/${route}.body.html?raw';

const headerProps = ${toLiteral(props)};
const htmlProps = ${htmlPropsLit};
---
<BaseLayout htmlProps={htmlProps} head={head} body={body} headerProps={headerProps} />
`;
  plan.push({ f, bodyPath, newBody, oldBody: text, pagePath, shell, props });
}

console.log('\n=== SiteHeader 收尾报告 ===');
console.log(`含占位符: ${plan.length}   无占位符: ${report.noMarker.length}   缺 shell: ${report.missingShell.length}`);
if (report.missingShell.length) console.log('缺 shell:', report.missingShell.join(', '));

if (!APPLY) { console.log('\n[dry-run] 未写入。加 --apply 执行。\n'); process.exit(0); }

for (const x of plan) {
  fs.writeFileSync(x.bodyPath, x.newBody);
  fs.writeFileSync(x.pagePath, x.shell);
}
console.log(`\n已收尾 ${plan.length} 个页面。\n`);
