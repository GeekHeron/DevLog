#!/usr/bin/env node
/**
 * apply-header-extraction.mjs —— 一键完成「公共头部组件化」全流程：
 *   1) 从 .header-backup/ 还原 body 片段（保证幂等）
 *   2) 运行 extract-header.mjs --apply  （回放校验通过后写入标记）
 *   3) 运行 finalize-header.mjs --apply （剥离标记 + 重写 page shell）
 *   4) 构建 + 逐字节校验
 *
 * 用法：node scripts/apply-header-extraction.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const NODE = process.execPath;
const SRC = path.join(ROOT, 'src', 'sources');
const BACKUP = path.join(ROOT, '.header-backup');

const run = (rel, args = []) =>
  execFileSync(NODE, [path.join(ROOT, rel), ...args], { cwd: ROOT, stdio: 'inherit' });

// 1) 还原（递归，含 en/ 子目录）
if (fs.existsSync(BACKUP)) {
  let n = 0;
  const restore = (dir, base = '') => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = base ? `${base}/${d.name}` : d.name;
      if (d.isDirectory()) { restore(path.join(dir, d.name), rel); continue; }
      const dst = path.join(SRC, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(path.join(dir, d.name), dst);
      n++;
    }
  };
  restore(BACKUP);
  console.log(`[1/4] 已还原 ${n} 个 body 片段`);
}

// 2) 抽取
console.log('[2/4] extract-header');
run('scripts/extract-header.mjs', ['--apply']);

// 3) 收尾
console.log('[3/4] finalize-header');
run('scripts/finalize-header.mjs', ['--apply']);

// 4) 构建 + 校验
console.log('[4/4] build + verify');
run('node_modules/astro/astro.js', ['build']);
run('scripts/copy-extra.mjs');
run('scripts/verify.mjs');
