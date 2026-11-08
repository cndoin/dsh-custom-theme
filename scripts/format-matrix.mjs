/**
 * Format coverage matrix: run every tweakcn/shadcn export spelling recorded in
 * the format matrix documented in docs/evidence.md through the real parser and
 * report the outcome.
 * A failure here means a whole family of community themes silently does nothing.
 */
import { parseThemeCss, parseThemeInput, buildOverrides } from '../src/core.js';

const L = '--background:#fafafa;--foreground:#111;--primary:#3366ff;--card:#fff;--popover:#fff;--muted:#eee;--muted-foreground:#666;--border:#ddd;--input:#fff;--ring:#3366ff;--secondary:#eee;--accent:#eee;';
const D = '--background:#101014;--foreground:#eee;--primary:#88aaff;--card:#18181b;--popover:#18181b;--muted:#222;--muted-foreground:#999;--border:#333;--input:#222;--ring:#88aaff;--secondary:#222;--accent:#222;';

const cases = [
  ['canonical :root / .dark', `:root{${L}} .dark{${D}}`],
  ['requested :root.dark', `:root{${L}} :root.dark{${D}}`],
  ['html.dark', `html{${L}} html.dark{${D}}`],
  ['.dark:root', `:root{${L}} .dark:root{${D}}`],
  ['[data-theme="dark"]', `:root{${L}} [data-theme="dark"]{${D}}`],
  ['[data-mode="dark"]', `:root{${L}} [data-mode="dark"]{${D}}`],
  ['body[data-ds-dark-theme]', `body{${L}} body[data-ds-dark-theme]{${D}}`],
  ['grouped :root, .dark', `:root, .dark{${L}}`],
  ['@media prefers-color-scheme', `:root{${L}} @media (prefers-color-scheme: dark){:root{${D}}}`],
  [':root inside @layer base', `@layer base{:root{${L}}} .dark{${D}}`],
  ['full v4 export', `@import "tailwindcss";\n@custom-variant dark (&:is(.dark *));\n:root{${L}}\n.dark{${D}}\n@theme inline{--color-background:var(--background);}\n@layer base{*{@apply border-border;}body{@apply bg-background;}}`],
  ['@plugin statement', `@import "tailwindcss";\n@plugin "tailwindcss-animate";\n@custom-variant dark (&:is(.dark *));\n:root{${L}}\n.dark{${D}}`],
  ['comments between statements', `@import "tailwindcss";\n/* hi */\n:root{${L}}\n.dark{${D}}`],
  ['v3 bare HSL triplets', `:root{--background:0 0% 100%;--foreground:0 0% 9%;--primary:221 83% 53%;} .dark{--background:0 0% 9%;--foreground:0 0% 98%;--primary:217 91% 60%;}`],
  ['oklch v4', `:root{--background:oklch(0.9818 0.0054 95.0986);--foreground:oklch(0.3438 0.0269 95.7226);--primary:oklch(0.6171 0.1375 39.0427);} .dark{--background:oklch(0.2679 0.0036 106.6427);--foreground:oklch(0.8074 0.0142 93.0137);--primary:oklch(0.6724 0.1308 38.7559);}`],
  ['@supports conditional fallback', `:root{${L}} @supports (color: oklch(0 0 0)){.dark{${D}}}`],
  ['nested @layer with both blocks', `@layer base{:root{${L}} .dark{${D}}}`],
  ['JSON registry cssVars', JSON.stringify({ name: 'x', cssVars: { light: { background: '#fafafa', foreground: '#111', primary: '#3366ff' }, dark: { background: '#101014', foreground: '#eee', primary: '#88aaff' } } })],
];

let failures = 0;
console.log('format'.padEnd(38), 'light', 'dark', 'tokens', 'status');
console.log('-'.repeat(90));
for (const [label, text] of cases) {
  const isJson = label.startsWith('JSON');
  const parsed = isJson ? parseThemeInput(text) : parseThemeCss(text);
  const { tokens } = buildOverrides(parsed, {});
  const n = Object.keys(tokens).length;
  // Every real theme needs both schemes to resolve, otherwise overrideTokens
  // cannot emit the colour tokens at all.
  const ok = parsed.counts.light > 0 && parsed.counts.dark > 0 && n >= 50;
  if (!ok) failures += 1;
  console.log(
    label.padEnd(38),
    String(parsed.counts.light).padEnd(5),
    String(parsed.counts.dark).padEnd(5),
    String(n).padEnd(6),
    ok ? 'OK' : '*** FAIL *** ' + JSON.stringify(parsed.warnings),
  );
}
console.log('-'.repeat(90));
console.log(failures === 0 ? 'ALL FORMATS PASS' : `${failures} FORMAT(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
