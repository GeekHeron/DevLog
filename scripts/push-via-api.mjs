// push-via-api.mjs — push the Astro source tree to GitHub using only the REST
// API (api.github.com). The git protocol (github.com:443) is unreachable in
// this sandbox, but the API works. Mirrors `git push --force` semantics:
//   1. upload every file as a blob
//   2. build a tree from them (base_tree omitted => full replacement)
//   3. create a commit whose parent is the current main head
//   4. fast-forward/force-update refs/heads/main
//
// Usage: node scripts/push-via-api.mjs <owner> <repo> <branch> <token> [--dry-run]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const [owner, repo, branch, token, ...flags] = process.argv.slice(2);
const dryRun = flags.includes('--dry-run');
if (!owner || !repo || !branch || !token) {
  console.error('usage: node scripts/push-via-api.mjs <owner> <repo> <branch> <token> [--dry-run]');
  process.exit(1);
}

const API = 'https://api.github.com';
const H = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'wb-push',
  'Content-Type': 'application/json',
};

// Paths that must never be uploaded.
// 注意：这里必须与 .gitignore 保持一致 —— 本脚本走 REST API，不经过 git，
// 因此 .gitignore 不会自动生效。若只改 .gitignore 而忘了这里，被忽略的目录
// （archive/ 原始金标准、.header-backup/ 回滚快照）仍会被推上公开仓库。
const EXCLUDE_DIRS = new Set(['.git', 'node_modules', 'dist', '.astro', '.workbuddy', 'archive', '.header-backup']);
const EXCLUDE_FILES = new Set(['_push.log', '_install.log', '_build.log', '.DS_Store']);

// 「仅根目录」排除清单。
//
// 背景：真正的仓库工作副本是 Desktop/DevLog-astro（347 个文件），而当前工作区
// DevLog-main 是它的严格超集（388 个），多出的 41 个全部是**根目录下的冗余副本** ——
// 早前扁平布局的遗留，与 public/ 下同名文件逐字节相同（已用 sha256 逐一核对）。
// Astro 只把 public/ 当静态根，根目录这些副本不参与构建，推上去只会把仓库根目录弄乱。
//
// ⚠️ 必须在**根目录层级**判断，不能塞进 EXCLUDE_DIRS —— 那里的判断是任意层级，
// 加上 'js'/'css'/'vendor' 会把 public/js、public/css、public/vendor 一起干掉。
const EXCLUDE_ROOT = new Set([
  'audio', 'css', 'js', 'vendor',
  'style.css', 'script.js', 'site-nav.css', 'logo.png', 'CNAME',
  'robots.txt', 'sitemap.xml', 'feed.xml', 'llms.txt',
  '47380971981cb5db97c8a52d0d919fed.txt',
  'InfoFlow AI.pdf', 'InfoFlow-AI.pdf',
  'SellerCopilot-商业计划书.pdf', 'SellerCopilot商业计划书.pdf',
  'SellerCopilot#U5546#U4e1a#U8ba1#U5212#U4e66.pdf',
  'WhatApp.png', 'ads_inventory_card.png',
  'feishu_card_screenshot.png', 'feishu_card_screenshot1.png',
  'image_3.png', 'jijia_review_card.png', 'logistics_risk_card.png',
  'telegram.png', 'wechat.png',
]);

function walk(dir, base, acc, isRoot) {
  for (const name of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(name)) continue;
    if (EXCLUDE_FILES.has(name)) continue;
    if (isRoot && EXCLUDE_ROOT.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, base, acc, false);
    else acc.push({ path: relative(base, p).replace(/\\/g, '/'), abs: p });
  }
  return acc;
}

const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.mp3', '.ogg', '.opus', '.wasm', '.woff', '.woff2', '.ttf', '.otf']);

async function api(method, path, body, attempt = 1) {
  const r = await fetch(API + path, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }

  // Retry on secondary-rate-limit / transient errors.
  const retriable = r.status === 429 || r.status === 403 || r.status >= 500;
  if (!r.ok && retriable && attempt <= 6) {
    const ra = Number(r.headers.get('retry-after'));
    const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(2000 * attempt, 15000);
    console.log(`  [retry ${attempt}] ${r.status} on ${method} ${path} — wait ${wait}ms`);
    await sleep(wait);
    return api(method, path, body, attempt + 1);
  }
  if (!r.ok) {
    const err = new Error(`${method} ${path} -> ${r.status}: ${json.message || text.slice(0, 200)}`);
    err.status = r.status;
    err.body = json;
    throw err;
  }
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const files = walk(root, root, [], true);
  console.log(`files to push: ${files.length}`);

  if (dryRun) {
    console.log('DRY RUN — no writes performed. Sample paths:');
    files.slice(0, 10).forEach((f) => console.log('  ' + f.path));
    return;
  }

  // 1. current head (optional — repo may be empty)
  let headSha = null;
  try {
    const ref = await api('GET', `/repos/${owner}/${repo}/git/ref/heads/${branch}`);
    headSha = ref.object.sha;
    console.log('current head:', headSha);
  } catch (e) {
    console.log('no existing branch (will create):', e.status || e.message);
  }

  // 2. upload blobs
  const tree = [];
  let i = 0;
  for (const f of files) {
    const buf = readFileSync(f.abs);
    const ext = f.path.slice(f.path.lastIndexOf('.')).toLowerCase();
    let body;
    if (BINARY_EXT.has(ext)) {
      body = { content: buf.toString('base64'), encoding: 'base64' };
    } else {
      body = { content: buf.toString('utf-8'), encoding: 'utf-8' };
    }
    const blob = await api('POST', `/repos/${owner}/${repo}/git/blobs`, body);
    tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    i++;
    if (i % 20 === 0) console.log(`  blobs: ${i}/${files.length}`);
    await sleep(60); // be gentle with the proxy + secondary rate limits
  }
  console.log(`uploaded ${tree.length} blobs`);

  // 3. build tree (no base_tree => replaces the whole tree)
  const newTree = await api('POST', `/repos/${owner}/${repo}/git/trees`, { tree });
  console.log('new tree:', newTree.sha);

  // 4. commit (carry old head as parent so history is preserved/force-able)
  const commit = await api('POST', `/repos/${owner}/${repo}/git/commits`, {
    message: 'Rebuild site on Astro: byte-identical static output, componentized layout, GitHub Pages CI',
    tree: newTree.sha,
    parents: headSha ? [headSha] : [],
  });
  console.log('new commit:', commit.sha);

  // 5. update ref
  if (headSha) {
    await api('PATCH', `/repos/${owner}/${repo}/git/refs/heads/${branch}`, { sha: commit.sha, force: true });
  } else {
    await api('POST', `/repos/${owner}/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.sha });
  }
  console.log(`OK: ${owner}/${repo}@${branch} -> ${commit.sha}`);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
