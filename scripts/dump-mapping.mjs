/**
 * Print the whole override table one theme produces, for manual inspection.
 *
 * Usage: node scripts/dump-mapping.mjs [fixture.css]
 */
import { readFileSync } from 'node:fs';
import { parseThemeInput, buildOverrides, luminance } from '../src/core.js';

const file = process.argv[2] ?? './tests/fixtures/claude.oklch.css';
const parsed = parseThemeInput(readFileSync(file, 'utf8'));
const { tokens, count, warnings } = buildOverrides(parsed, { statusTint: true });

console.log(`theme: ${file}`);
console.log(`tokens: ${count}`);
if (warnings.length > 0) console.log('warnings: ' + warnings.join('; '));
console.log();

const rows = Object.entries(tokens).sort(([a], [b]) => a.localeCompare(b));
for (const [name, modes] of rows) {
  const ll = luminance(modes.light);
  const dl = luminance(modes.dark);
  const fmt = (value, level) => (level === null ? '  ?  ' : level.toFixed(2)) + ' ' + value;
  console.log(
    name.replace('--dsw-', '').padEnd(46)
    + ' L ' + fmt(modes.light, ll).padEnd(46)
    + ' D ' + fmt(modes.dark, dl),
  );
}
