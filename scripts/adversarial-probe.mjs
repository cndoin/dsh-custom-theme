/**
 * Adversarial format probe: try every construct a Tailwind v4 / tweakcn export
 * can plausibly contain, and report what the parser actually does with it.
 * Failures here are real compatibility gaps, not hypothetical concerns.
 */
import { parseThemeCss, parseThemeInput, buildOverrides } from '../src/core.js';

const L = '--background:#fafafa;--foreground:#111;--primary:#3366ff;--muted:#eee;--border:#ddd;';
const D = '--background:#101014;--foreground:#eee;--primary:#88aaff;--muted:#222;--border:#333;';

const cases = [
  // --- selector spellings -------------------------------------------------
  ['baseline', `:root{${L}} .dark{${D}}`],
  [':root:not(.dark)', `:root:not(.dark){${L}} .dark{${D}}`],
  [':root[data-theme=dark]', `:root{${L}} :root[data-theme="dark"]{${D}}`],
  ['html[data-theme=dark]', `:root{${L}} html[data-theme="dark"]{${D}}`],
  ['[data-theme=dark] no quotes', `:root{${L}} [data-theme=dark]{${D}}`],
  ['body.dark', `:root{${L}} body.dark{${D}}`],
  [':host', `:host{${L}} .dark{${D}}`],
  [':root, :host', `:root, :host{${L}} .dark{${D}}`],
  ['html:root', `html:root{${L}} .dark{${D}}`],
  ['.dark-theme', `:root{${L}} .dark-theme{${D}}`],
  ['[class~="dark"]', `:root{${L}} [class~="dark"]{${D}}`],
  [':is(.dark)', `:root{${L}} :is(.dark){${D}}`],
  [':root.dark grouped', `:root{${L}} :root.dark, html.dark{${D}}`],

  // --- at-rule wrappers ---------------------------------------------------
  ['@theme (no inline)', `@theme{--color-primary:#3366ff;} :root{${L}} .dark{${D}}`],
  ['@theme inline before root', `@theme inline{--color-background:var(--background);} :root{${L}} .dark{${D}}`],
  ['@source', `@source "../node_modules"; :root{${L}} .dark{${D}}`],
  ['@utility', `@utility tab-4 { tab-size: 4; } :root{${L}} .dark{${D}}`],
  ['@plugin no quotes', `@plugin tailwindcss-animate; :root{${L}} .dark{${D}}`],
  ['@custom-variant with :is', `@custom-variant dark (&:is(.dark *)); :root{${L}} .dark{${D}}`],
  ['@supports selector', `@supports selector(:is(*)) { :root{${L}} } .dark{${D}}`],
  ['@media light then dark', `:root{${L}} @media (prefers-color-scheme: light){:root{${L}}} @media (prefers-color-scheme: dark){:root{${D}}}`],
  ['@layer theme/base', `@layer theme, base; @layer base{:root{${L}} .dark{${D}}}`],
  ['@charset', `@charset "UTF-8"; :root{${L}} .dark{${D}}`],

  // --- statement syntax that could confuse the semicolon split ------------
  ['@import with semicolon in string', `@import "foo;bar.css"; :root{${L}} .dark{${D}}`],
  ['comment between statements', `:root{${L}} /* c ; with ; semicolons */ .dark{${D}}`],
  ['declaration with !important', `:root{--background:#fafafa !important;--foreground:#111;--primary:#3366ff;} .dark{--background:#101014;--foreground:#eee;--primary:#88aaff;}`],
  ['multiline values', `:root{\n --background:\n   #fafafa;\n --foreground: #111;\n --primary: #3366ff;\n} .dark{${D}}`],
  ['no trailing semicolon', `:root{--background:#fafafa;--foreground:#111;--primary:#3366ff} .dark{${D}}`],
  ['CSS nesting :root &', `:root{${L} & .foo{color:red;}} .dark{${D}}`],

  // --- value formats ------------------------------------------------------
  ['rgb()', `:root{--background:rgb(250 250 250);--foreground:rgb(17 17 17);--primary:rgb(51 102 255);} .dark{--background:rgb(16 16 20);--foreground:rgb(238 238 238);--primary:rgb(136 170 255);}`],
  ['hsl() v4', `:root{--background:hsl(0 0% 98%);--foreground:hsl(0 0% 7%);--primary:hsl(221 83% 53%);} .dark{--background:hsl(240 10% 8%);--foreground:hsl(0 0% 93%);--primary:hsl(217 91% 60%);}`],
  ['hex 8-digit', `:root{--background:#fafafaff;--foreground:#111111ff;--primary:#3366ffff;} .dark{--background:#101014ff;--foreground:#eeeeeeff;--primary:#88aaffff;}`],
  ['oklch with %', `:root{--background:oklch(98% 0.005 95);--foreground:oklch(34% 0.02 95);--primary:oklch(62% 0.14 39);} .dark{--background:oklch(27% 0.004 106);--foreground:oklch(81% 0.014 93);--primary:oklch(67% 0.13 39);}`],
  ['named colors', `:root{--background:white;--foreground:black;--primary:rebeccapurple;} .dark{--background:black;--foreground:white;--primary:plum;}`],
  ['var() self reference', `:root{--background:#fafafa;--foreground:#111;--primary:var(--background);} .dark{--background:#101014;--foreground:#eee;--primary:var(--foreground);}`],
  ['radius rem', `:root{${L} --radius:0.75rem;} .dark{${D} --radius:0.75rem;}`],
  ['radius calc', `:root{${L} --radius:calc(0.5rem + 2px);} .dark{${D} --radius:calc(0.5rem + 2px);}`],
  ['font with quotes', `:root{${L} --font-sans:"Inter", system-ui, sans-serif; --font-mono:"JetBrains Mono", monospace;} .dark{${D}}`],

  // --- JSON ---------------------------------------------------------------
  ['JSON with theme section', JSON.stringify({ cssVars: { theme: { 'font-sans': 'Inter', radius: '0.5rem' }, light: { background: '#fff', foreground: '#111', primary: '#36f' }, dark: { background: '#000', foreground: '#eee', primary: '#8af' } } })],
  ['JSON with shadow-offset alias', JSON.stringify({ cssVars: { light: { background: '#fff', foreground: '#111', primary: '#36f', 'shadow-offset-x': '0px' }, dark: { background: '#000', foreground: '#eee', primary: '#8af' } } })],
];

let fails = 0;
console.log('case'.padEnd(40), 'L', 'D', 'tok', 'result');
console.log('-'.repeat(100));
for (const [label, text] of cases) {
  const isJson = label.startsWith('JSON');
  let parsed;
  try {
    parsed = isJson ? parseThemeInput(text) : parseThemeCss(text);
  } catch (e) {
    console.log(label.padEnd(40), 'THREW', String(e).slice(0, 50));
    fails += 1;
    continue;
  }
  let tokens = {};
  try { tokens = buildOverrides(parsed, {}).tokens; } catch (e) {
    console.log(label.padEnd(40), 'BUILD THREW', String(e).slice(0, 40));
    fails += 1;
    continue;
  }
  const n = Object.keys(tokens).length;
  // A usable theme needs both schemes and a real ladder.
  const ok = parsed.counts.light >= 2 && parsed.counts.dark >= 2 && n >= 40;
  if (!ok) fails += 1;
  console.log(label.padEnd(40), String(parsed.counts.light).padEnd(2), String(parsed.counts.dark).padEnd(2), String(n).padEnd(4), ok ? 'OK' : '*** CHECK *** ' + JSON.stringify(parsed.warnings).slice(0, 70));
}
console.log('-'.repeat(100));
console.log(`${fails} case(s) need attention`);
process.exitCode = fails === 0 ? 0 : 1;
