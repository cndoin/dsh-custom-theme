/**
 * Bulk compatibility check against all 42 tweakcn built-in presets.
 *
 * The presets source is TypeScript (`defaultPresets: Record<string, ThemePreset>`).
 * Rather than importing it, extract each preset's `light`/`dark` object literal
 * by brace matching, then render it into the *exact* CSS export shape tweakcn
 * puts on the clipboard — including `@import`, `@custom-variant`, `@theme
 * inline` and `@layer base`. That is what a user actually pastes, and it is the
 * shape that used to break the parser.
 */
import { readFileSync } from 'node:fs';
import { parseThemeCss, buildOverrides } from '../src/core.js';

// Frozen, fact-only snapshot of tweakcn's defaultPresets CSS variable values.
// Upstream is Apache-2.0; we ship the values, not the upstream TypeScript source,
// so the suite runs from a plain checkout with no research/ directory.
const PRESETS_FILE = new URL('../tests/fixtures/tweakcn-presets.json', import.meta.url);
const { presets } = JSON.parse(readFileSync(PRESETS_FILE, 'utf8'));

/** Render one preset as tweakcn's full v4 CSS export. */
function toCss(p) {
  const decl = (o) => Object.entries(o).map(([k, v]) => `  --${k}: ${v};`).join('\n');
  const alias = (o) => Object.keys(o)
    .filter(k => !/^shadow|^spacing$|^tracking-normal$|^radius$|^font-/.test(k))
    .map(k => `  --color-${k}: var(--${k});`).join('\n');
  return `@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

:root {
${decl(p.light)}
}

.dark {
${decl(p.dark)}
}

@theme inline {
${alias(p.light)}
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
}
`;
}

console.log(`presets extracted: ${presets.length}`);
console.log('preset'.padEnd(20), 'light', 'dark', 'tokens', 'status');
console.log('-'.repeat(72));
let failed = 0;
for (const p of presets) {
  const parsed = parseThemeCss(toCss(p));
  const { tokens } = buildOverrides(parsed, {});
  const n = Object.keys(tokens).length;
  const ok = parsed.counts.light >= 25 && parsed.counts.dark >= 25 && n >= 100;
  if (!ok) failed += 1;
  console.log(
    p.id.padEnd(20),
    String(parsed.counts.light).padEnd(5),
    String(parsed.counts.dark).padEnd(5),
    String(n).padEnd(6),
    ok ? 'OK' : 'FAIL ' + JSON.stringify(parsed.warnings),
  );
}
console.log('-'.repeat(72));
console.log(failed === 0 ? `ALL ${presets.length} PRESETS PASS` : `${failed}/${presets.length} FAILED`);
process.exitCode = failed === 0 ? 0 : 1;
