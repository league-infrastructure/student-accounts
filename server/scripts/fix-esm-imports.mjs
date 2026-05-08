// Post-build: add explicit `.js` (or `/index.js`) to relative imports in dist/.
// Compensates for tsconfig `moduleResolution: bundler` (Node ESM is stricter).
import { readFileSync, writeFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

const SKIP_EXT = /\.(js|mjs|cjs|json|node)$/;

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && p.endsWith('.js')) yield p;
  }
}

function fixSpec(spec, fileDir) {
  if (SKIP_EXT.test(spec)) return spec;
  const target = resolve(fileDir, spec);
  // Prefer `<spec>.js` if the file exists (matches TS bundler resolution).
  // Fall back to `<spec>/index.js` only when there is no sibling .js file.
  if (existsSync(`${target}.js`)) return `${spec}.js`;
  if (existsSync(target) && statSync(target).isDirectory()) return `${spec}/index.js`;
  return `${spec}.js`;
}

const RE_IMPORT = /(\b(?:from|import)\s+['"]|\bimport\s*\(\s*['"])(\.{1,2}\/[^'"]+)(['"])/g;

let changed = 0;
for (const file of walk('dist')) {
  const src = readFileSync(file, 'utf8');
  const fileDir = dirname(file);
  let dirty = false;
  const out = src.replace(RE_IMPORT, (m, pre, spec, post) => {
    const fixed = fixSpec(spec, fileDir);
    if (fixed === spec) return m;
    dirty = true;
    return `${pre}${fixed}${post}`;
  });
  if (dirty) {
    writeFileSync(file, out);
    changed++;
  }
}
console.log(`[fix-esm-imports] rewrote ${changed} file(s)`);
