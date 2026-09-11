// Stub replacement for `sharp`. The real sharp is only used by Astro's image
// optimization service (<Image>/<Picture>), which this site does not use — it
// emits raw HTML via set:html. This stub keeps `npm install` from pulling the
// @img/sharp-* platform binaries (one of whose registry manifests is invalid
// in this environment) while still satisfying Astro's import.
module.exports = function sharp() {
  throw new Error('sharp stub: image optimization is not used in this project');
};
module.exports.cache = {};
