// migrate.mjs — deterministic, one-shot migration of the hand-authored static
// site into an Astro project WITHOUT changing UI structure or content.
//
// Strategy: for every source .html page we split <head> / <body> / <html attrs>,
// store the raw fragments under src/sources/, and generate a thin .astro page
// that feeds them verbatim into BaseLayout (Fragment set:html). No markup is
// rewritten, so the rendered DOM and visuals are identical to the originals.
//
// Exceptions (preserved as verbatim static files in public/, keeping their exact
// URLs):
//   - SEO verification files (baidu_verify_*, googleed1d2c3ca4193674.html)
//   - Pages whose filename contains a space (Astro can't route those safely)
//   - Any route collision (kept as a static passthrough)
//
// All original .html files are archived under archive/ as the golden reference.

import {
  readFileSync, writeFileSync, mkdirSync, cpSync, rmSync,
  existsSync, readdirSync,
} from 'node:fs';
import { join, dirname, relative, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const srcDir = join(root, 'src');
const pagesDir = join(srcDir, 'pages');
const sourcesDir = join(srcDir, 'sources');
const publicDir = join(root, 'public');
const archiveDir = join(root, 'archive');

const VERIFY = new Set([
  'baidu_verify_codeva-2TA8UH5cVt.html',
  'googleed1d2c3ca4193674.html',
]);

// Root entries that must NOT be copied into public/ as assets.
const EXCLUDE = new Set([
  'node_modules', 'src', 'public', 'archive', 'scripts',
  '.git', '.github', '.workbuddy', '.astro',
  'package.json', 'package-lock.json', 'astro.config.mjs',
  'tsconfig.json', '.gitignore', 'README.md',
]);

const ensureDir = (d) => mkdirSync(d, { recursive: true });

function scanHtml(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.html'))
    .map((f) => join(dir, f));
}

// ---- attribute parser for <html ...> ----
function parseAttrs(str) {
  const obj = {};
  const re = /([a-zA-Z-:]+)\s*=\s*["']([^"']*)["']/g;
  let m;
  while ((m = re.exec(str))) obj[m[1]] = m[2];
  return obj;
}

function buildHtmlPropsLiteral(attrsObj) {
  const entries = Object.entries(attrsObj).map(
    ([k, v]) => `${k}: ${JSON.stringify(v)}`
  );
  return `{ ${entries.join(', ')} }`;
}

// ---------------------------------------------------------------------------
// Phase A — read source pages and generate Astro pages + fragments
// ---------------------------------------------------------------------------
const pages = [];

for (const f of scanHtml(root)) {
  const name = basename(f);
  if (VERIFY.has(name)) {
    pages.push({ file: f, kind: 'passthrough' });
    continue;
  }
  pages.push({
    file: f,
    route: basename(f, '.html'),
    kind: name.includes(' ') ? 'passthrough' : 'page',
  });
}

const enDir = join(root, 'en');
for (const f of scanHtml(enDir)) {
  const name = basename(f);
  if (VERIFY.has(name)) {
    pages.push({ file: f, kind: 'passthrough' });
    continue;
  }
  pages.push({
    file: f,
    route: 'en/' + basename(f, '.html'),
    kind: name.includes(' ') ? 'passthrough' : 'page',
  });
}

const routeSet = new Set();
let pageCount = 0;
let passthroughCount = 0;

for (const p of pages) {
  const html = readFileSync(p.file, 'utf-8');

  if (p.kind === 'passthrough') {
    // Verbatim static file — keep its exact URL via public/.
    ensureDir(publicDir);
    cpSync(p.file, join(publicDir, basename(p.file)), { recursive: false });
    passthroughCount++;
    continue;
  }

  // Collision guard: if route already taken, fall back to passthrough.
  if (routeSet.has(p.route)) {
    ensureDir(publicDir);
    cpSync(p.file, join(publicDir, basename(p.file)), { recursive: false });
    passthroughCount++;
    continue;
  }
  routeSet.add(p.route);

  const htmlTag = html.match(/<html([^>]*)>/i);
  const htmlProps = parseAttrs(htmlTag ? htmlTag[1] : '');
  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const head = headMatch ? headMatch[1] : '';
  const body = bodyMatch ? bodyMatch[1] : html;

  const depth = p.route.split('/').length - 1; // 'foo'->0, 'en/bar'->1
  const prefix = '../'.repeat(depth + 1); // '../' or '../../'

  // write raw fragments
  const srcHeadPath = join(sourcesDir, p.route + '.head.html');
  const srcBodyPath = join(sourcesDir, p.route + '.body.html');
  ensureDir(dirname(srcHeadPath));
  writeFileSync(srcHeadPath, head);
  writeFileSync(srcBodyPath, body);

  // write page
  const pagePath = join(pagesDir, p.route + '.astro');
  ensureDir(dirname(pagePath));
  const astro = `---
import BaseLayout from '${prefix}layouts/BaseLayout.astro';
import head from '${prefix}sources/${p.route}.head.html?raw';
import body from '${prefix}sources/${p.route}.body.html?raw';

const htmlProps = ${buildHtmlPropsLiteral(htmlProps)};
---
<BaseLayout htmlProps={htmlProps} head={head} body={body} />
`;
  writeFileSync(pagePath, astro);
  pageCount++;
}

// ---------------------------------------------------------------------------
// Phase B — copy static assets (everything that isn't a page) into public/
// ---------------------------------------------------------------------------
ensureDir(publicDir);
for (const entry of readdirSync(root)) {
  if (EXCLUDE.has(entry)) continue;
  if (entry.toLowerCase().endsWith('.html')) continue; // pages -> src/ instead
  const from = join(root, entry);
  const to = join(publicDir, entry);
  cpSync(from, to, { recursive: true });
}

// ---------------------------------------------------------------------------
// Phase C — archive originals (golden reference) and remove from project root
// ---------------------------------------------------------------------------
for (const p of pages) {
  const rel = relative(root, p.file); // 'foo.html' or 'en/foo.html'
  const dest = join(archiveDir, rel);
  ensureDir(dirname(dest));
  cpSync(p.file, dest, { recursive: false });
  rmSync(p.file);
}

// remove now-empty en/ directory if present
const enArchive = join(archiveDir, 'en');
if (existsSync(enArchive)) {
  try { rmSync(enDir, { recursive: true, force: true }); } catch {}
}

console.log(`Migrated ${pageCount} Astro pages, ${passthroughCount} static passthrough files.`);
console.log(`Originals archived under: ${relative(root, archiveDir)}/`);
