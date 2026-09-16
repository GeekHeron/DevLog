// push-via-api.mjs — push the Astro source tree to GitHub using only the REST
// API (api.github.com). The git protocol (github.com:443) is unreachable in
// this sandbox, but the API works. Mirrors `git push --force` semantics:
//   1. upload every file as a blob
//   2. build a tree from them (base_tree omitted => full replacement)
//   3. create a commit whose parent is the current main head
//   4. fast-forward/force-update refs/heads/main
//
// Files are selected by .gitignore (parsed at runtime), so local-only rollback
// data such as .header-backup/ is never published. Because the tree is replaced
// wholesale, anything present on the remote but absent locally WILL be deleted —
// run with --dry-run and diff against the remote tree first.
//
// Usage: node scripts/push-via-api.mjs <owner> <repo> <branch> <token> [--dry-run]
// Commit message: COMMIT_MESSAGE_FILE (path) > COMMIT_MESSAGE (env) > default.
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

// Commit message: read _commit-msg.txt, else COMMIT_MESSAGE env, else default.
const defaultMessage = 'chore: rebuild site (Astro, byte-identical output)';

// Commit message resolution order: explicit file > env var > default.
// Using a file avoids losing newlines to shell escaping.
function readCommitMessage() {
  if (process.env.COMMIT_MESSAGE_FILE) {
    try { return readFileSync(process.env.COMMIT_MESSAGE_FILE, 'utf8').trim(); }
    catch (e) { console.warn('could not read COMMIT_MESSAGE_FILE:', e.message); }
  }
  return process.env.COMMIT_MESSAGE || defaultMessage;
}

const API = 'https://api.github.com';
const H = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'wb-push',
  'Content-Type': 'application/json',
};

// Paths that must never be uploaded. Kept in sync with .gitignore below —
// the API push replaces the WHOLE tree, so any local-only artifact that slips
// through here gets published to the repo (and would survive a `git status`
// that reports it as ignored).
const EXCLUDE_DIRS = new Set(['.git', 'node_modules', 'dist', '.astro', '.workbuddy', '.header-backup']);
const EXCLUDE_FILES = new Set(['_push.log', '_install.log', '_build.log', '.DS_Store']);

// Parse .gitignore so the two lists can never drift apart silently.
// Supports plain names, dir names, and * / ** globs; ignores negation and comments.
function loadGitignore(base) {
  let text;
  try {
    text = readFileSync(join(base, '.gitignore'), 'utf8');
  } catch {
    return [];
  }
  const rules = [];
  for (let line of text.split('\n')) {
    line = line.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const dirOnly = line.endsWith('/');
    if (dirOnly) line = line.slice(0, -1);
    const pattern = line
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')   // escape regex chars
      .replace(/\*\*/g, '\u0000')             // protect **
      .replace(/\*/g, '[^/]*')                // * => within one segment
      .replace(/\u0000/g, '.*')               // ** => across segments
      .replace(/\?/g, '[^/]');
    rules.push({ re: new RegExp('^' + pattern + (dirOnly ? '(/|$)' : '$')), dirOnly, raw: line });
  }
  return rules;
}

const gitignoreRules = loadGitignore(root);

function isIgnored(relPath, name) {
  for (const rule of gitignoreRules) {
    if (rule.re.test(relPath) || rule.re.test(name)) return true;
  }
  return false;
}

function walk(dir, base, acc) {
  for (const name of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(name)) continue;
    if (EXCLUDE_FILES.has(name)) continue;
    const p = join(dir, name);
    const rel = relative(base, p).replace(/\\/g, '/');
    if (isIgnored(rel, name)) continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, base, acc);
    else acc.push({ path: rel, abs: p });
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
    console.log('DRY RUN — no writes performed. All paths:');
    files.forEach((f) => console.log('  ' + f.path));
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

  // 2. upload blobs — bounded concurrency. Uploading 300+ blobs serially with a
  // deliberate delay exceeds the sandbox command timeout, so run CONC in flight
  // and keep the per-request retry/backoff above for secondary rate limits.
  const tree = new Array(files.length);
  const CONC = 8;
  let done = 0;
  let next = 0;
  async function uploadOne(idx) {
    const f = files[idx];
    const buf = readFileSync(f.abs);
    const ext = f.path.slice(f.path.lastIndexOf('.')).toLowerCase();
    const body = BINARY_EXT.has(ext)
      ? { content: buf.toString('base64'), encoding: 'base64' }
      : { content: buf.toString('utf-8'), encoding: 'utf-8' };
    const blob = await api('POST', `/repos/${owner}/${repo}/git/blobs`, body);
    tree[idx] = { path: f.path, mode: '100644', type: 'blob', sha: blob.sha };
    done++;
    if (done % 32 === 0 || done === files.length) {
      console.log(`  blobs: ${done}/${files.length}`);
    }
  }
  await Promise.all(
    Array.from({ length: CONC }, async () => {
      while (next < files.length) {
        const idx = next++;
        await uploadOne(idx);
      }
    }),
  );
  console.log(`uploaded ${tree.length} blobs`);

  // 3. build tree (no base_tree => replaces the whole tree)
  const newTree = await api('POST', `/repos/${owner}/${repo}/git/trees`, { tree });
  console.log('new tree:', newTree.sha);

  // 4. commit (carry old head as parent so history is preserved/force-able)
  const commit = await api('POST', `/repos/${owner}/${repo}/git/commits`, {
    message: readCommitMessage(),
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
