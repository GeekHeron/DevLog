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
const EXCLUDE_DIRS = new Set(['.git', 'node_modules', 'dist', '.astro', '.workbuddy']);
const EXCLUDE_FILES = new Set(['_push.log', '_install.log', '_build.log', '.DS_Store']);

function walk(dir, base, acc) {
  for (const name of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(name)) continue;
    if (EXCLUDE_FILES.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, base, acc);
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
  const files = walk(root, root, []);
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
