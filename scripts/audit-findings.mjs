/**
 * Verify the edge cases flagged by the upstream source audit:
 *  - negative-hue bare HSL triplets (tweakcn's /^\d/ check misses them)
 *  - 4-decimal values from formatNumber.toFixed(4)
 *  - --shadow-color bypassing colorFormat (mixed colour syntaxes in one file)
 *  - JSON key aliases (letter-spacing / shadow-offset-*)
 *  - comment-contained declarations
 */
import { parseThemeCss, parseThemeJson, parseThemeInput, buildOverrides, normalizeValue, isSafeValue } from '../src/core.js';
import assert from 'node:assert/strict';

console.log('=== normalizeValue on bare triplets ===');
for (const v of ['60 20% 98%', '-120 50% 40%', '5.9000% 12.3456% 98.0000%', '0 0% 100%']) {
  console.log('  ' + v.padEnd(32), '->', normalizeValue(v, 'background'));
}
assert.equal(normalizeValue('-120 50% 40%', 'background'), 'hsl(-120 50% 40%)');
assert.equal(normalizeValue('5.9000% 12.3456% 98.0000%', 'background'),
  '5.9000% 12.3456% 98.0000%');

console.log('\n=== isSafeValue on real --shadow-color variants ===');
for (const v of ['hsl(0 0% 0%)', 'oklch(0 0 0)', '#000000', 'rgba(29,161,242,0.15)',
  'hsl(325.78 58.18% 56.86% / 0.5)', 'hsl(20 18% 51% / 0.4)']) {
  console.log('  ' + v.padEnd(40), isSafeValue(v) ? 'OK' : '*** REJECTED ***');
  assert.equal(isSafeValue(v), true, `--shadow-color variant must be accepted: ${v}`);
}

console.log('\n=== mixed colour syntaxes in one full export ===');
const mixed = `@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

:root {
  --background: oklch(0.9818 0.0054 95.0986);
  --foreground: oklch(0.3438 0.0269 95.7226);
  --primary: oklch(0.6171 0.1375 39.0427);
  --border: oklch(0.8847 0.0069 97.3627);
  --shadow-color: rgba(29,161,242,0.15);
  --shadow-2xs: 0px 1px 2px 0px hsl(0 0% 0% / 0.03);
  --radius: 0.5rem;
}
.dark {
  --background: oklch(0.2679 0.0036 106.6427);
  --foreground: oklch(0.8074 0.0142 93.0137);
  --primary: oklch(0.6724 0.1308 38.7559);
  --border: oklch(0.3618 0.0101 106.8928);
  --shadow-color: #000000;
  --shadow-2xs: 0px 1px 2px 0px hsl(0 0% 0% / 0.10);
  --radius: 0.5rem;
}
@theme inline { --color-background: var(--background); }
@layer base { * { @apply border-border; } body { @apply bg-background; } }
`;
const p = parseThemeCss(mixed);
console.log('  counts=' + JSON.stringify(p.counts), 'warnings=' + JSON.stringify(p.warnings));
console.log('  tokens=' + buildOverrides(p, {}).count);
assert.deepEqual(p.warnings, []);
assert.ok(buildOverrides(p, {}).count >= 100);

console.log('\n=== negative hue triplet end to end ===');
const neg = parseThemeCss(':root{--background:0 0% 100%;--foreground:-120 50% 40%;--primary:20 70% 60%;--muted:#eee;--border:#ddd;} .dark{--background:0 0% 9%;--foreground:-120 50% 80%;--primary:20 70% 65%;--muted:#222;--border:#333;}');
console.log('  foreground.light =', neg.light.foreground);
console.log('  tokens =', buildOverrides(neg, {}).count);
assert.equal(neg.light.foreground, 'hsl(-120 50% 40%)');

console.log('\n=== JSON letter-spacing alias ===');
const j = parseThemeJson({ cssVars: {
  light: { background: '#fff', foreground: '#111', primary: '#36f', 'letter-spacing': '0em', 'shadow-offset-x': '0px' },
  dark: { background: '#000', foreground: '#eee', primary: '#8af', 'letter-spacing': '0em' },
} });
console.log('  keys:', Object.keys(j.light).join(', '));
console.log('  shared:', JSON.stringify(j.shared));
assert.equal(j.shared['tracking-normal'], '0em', 'letter-spacing maps to tracking-normal');
assert.equal(j.shared['shadow-x'], '0px', 'shadow-offset-x maps to shadow-x');

console.log('\n=== comment-contained declaration is ignored ===');
const c = parseThemeCss(':root{--background:#fff;--foreground:#111;--primary:#36f;/* --primary: red; */} .dark{--background:#000;--foreground:#eee;--primary:#8af;}');
console.log('  primary.light =', c.light.primary, '(should be #36f, not red)');
assert.equal(c.light.primary, '#36f', 'a declaration inside a comment must be ignored');
console.log('\nAUDIT FINDINGS PASS');
