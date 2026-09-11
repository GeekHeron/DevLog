import { defineConfig } from 'astro/config';

// Static site. build.format='file' keeps the original /foo.html URLs so that
// existing inbound links, canonical tags and SEO are preserved 1:1.
export default defineConfig({
  site: 'https://geekheron.space',
  build: {
    format: 'file',
  },
  // Keep built HTML as close to the original as possible (no extra minify
  // rewrites) so structure/content stay 1:1 with the source pages.
  compressHTML: false,
});
