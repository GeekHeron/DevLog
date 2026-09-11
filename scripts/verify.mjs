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
const archive = join(root, 'archive');

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

for (const af of archiveFiles) {
  const rel = relative(archive, af).replace(/\\/g, '/'); // e.g. en/article-agent.html
  const distFile = join(dist, rel);
  if (!existsSync(distFile)) {
    failures.push(`MISSING build: ${rel}`);
    failed++;
    continue;
  }
  checked++;
  const orig = readFileSync(af, 'utf-8');
  const built = readFileSync(distFile, 'utf-8');

  const reHead = /<head[^>]*>([\s\S]*?)<\/head>/i;
  const reBody = /<body[^>]*>([\s\S]*?)<\/body>/i;
  const reHtml = /<html([^>]*)>/i;

  const oHead = (orig.match(reHead) || [])[1] || '';
  const bHead = (built.match(reHead) || [])[1] || '';
  const oBody = (orig.match(reBody) || [])[1] || '';
  const bBody = (built.match(reBody) || [])[1] || '';
  const oHtml = (orig.match(reHtml) || [])[1] || '';
  const bHtml = (built.match(reHtml) || [])[1] || '';

  const ok =
    oHead.trim() === bHead.trim() &&
    oBody.trim() === bBody.trim() &&
    oHtml.trim() === bHtml.trim();

  if (ok) passed++;
  else {
    failed++;
    failures.push(
      `DIFF: ${rel} (head=${oHead.trim() === bHead.trim()}, body=${oBody.trim() === bBody.trim()}, html=${oHtml.trim() === bHtml.trim()})`
    );
  }
}

console.log(`Checked ${checked} pages | passed ${passed} | failed ${failed}`);
for (const f of failures) console.log(' -', f);
