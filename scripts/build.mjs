/**
 * Assemble `client.js` from the template plus the generated core, presets, and
 * dictionaries.
 *
 * The browser artifact is a single closure-factory file with no imports, so the
 * sources are concatenated here rather than bundled. Run `node
 * scripts/build.mjs` after editing anything under `src/`.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const template = await readFile(join(root, 'src', 'client.template.js'), 'utf8');
const core = await readFile(join(root, 'src', 'core.js'), 'utf8');
const backdrop = await readFile(join(root, 'src', 'backdrop.js'), 'utf8');
const presets = await readFile(join(root, 'src', 'presets.json'), 'utf8');
const dictionaries = await readFile(join(root, 'src', 'dictionaries.js'), 'utf8');

/** Turn ESM `export` statements into plain declarations for the closure. */
function inlineCore(source) {
  return source
    .replace(/^export\s+(const|let|var|function|class)\s/gm, '$1 ')
    .replace(/^export\s+\{[^}]*\}\s*;?\s*$/gm, '')
    .trim();
}

/** Same for the dictionary module, which is one `const`. */
function inlineDictionaries(source) {
  return source.replace(/^export\s+(const|let|var|function|class)\s/gm, '$1 ').trim();
}

const presetArray = `const PRESETS = ${presets.trim()};`;

let out = template
  .replace('/*__CORE__*/', () => inlineCore(core))
  .replace('/*__BACKDROP__*/', () => inlineCore(backdrop))
  .replace('/*__PRESETS__*/', () => presetArray)
  .replace('/*__DICTIONARIES__*/', () => inlineDictionaries(dictionaries));

for (const marker of ['/*__CORE__*/', '/*__BACKDROP__*/', '/*__PRESETS__*/', '/*__DICTIONARIES__*/']) {
  if (out.includes(marker)) throw new Error(`template placeholder ${marker} was not replaced`);
}
if (/^\s*export\s/m.test(out)) throw new Error('client.js must not contain ESM export statements');

await writeFile(join(root, 'client.js'), out, 'utf8');
console.log(`client.js written (${out.length} bytes)`);
