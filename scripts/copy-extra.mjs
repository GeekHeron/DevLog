// copy-extra.mjs — after `astro build`, copy the non-standard passthrough
// assets (files with spaces / '#' in their names: legacy duplicate pages and
// Chinese-named business PDFs) from public-extra/ into dist/. Astro's own
// public/ copy + empty-dir cleanup chokes on these filenames, so they are
// copied verbatim afterwards to preserve their exact URLs.
import { cpSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const extra = join(root, 'public-extra');
const dist = join(root, 'dist');

if (existsSync(extra)) {
  cpSync(extra, dist, { recursive: true });
  console.log('copy-extra: public-extra/ -> dist/');
} else {
  console.log('copy-extra: nothing to copy');
}
