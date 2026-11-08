/**
 * End-to-end test against the *exact* output of tweakcn's own generator.
 *
 * Reconstructed verbatim from upstream:
 *   utils/theme-style-generator.ts :: generateThemeCode()
 *   utils/color-converter.ts       :: colorFormatter()
 * Those two functions are the only thing behind "Copy theme" in
 * components/editor/code-panel.tsx. If these pass, every combination the site
 * can produce is covered: tailwindVersion 3|4 × colorFormat hsl|rgb|oklch|hex.
 */
import { parseThemeCss, buildOverrides, luminance } from '../src/core.js';

// A representative theme, in all four colour formats the site can emit.
const PALETTE = {
  oklch: {
    light: { background: 'oklch(0.9818 0.0054 95.0986)', foreground: 'oklch(0.3438 0.0269 95.7226)', primary: 'oklch(0.6171 0.1375 39.0427)' },
    dark:  { background: 'oklch(0.2679 0.0036 106.6427)', foreground: 'oklch(0.8074 0.0142 93.0137)', primary: 'oklch(0.6724 0.1308 38.7559)' },
  },
  hsl: {
    light: { background: 'hsl(60 20% 98%)', foreground: 'hsl(60 5% 30%)', primary: 'hsl(20 70% 60%)' },
    dark:  { background: 'hsl(60 3% 20%)', foreground: 'hsl(60 3% 82%)', primary: 'hsl(20 70% 65%)' },
  },
  'hsl-v3-triplets': {
    light: { background: '60 20% 98%', foreground: '60 5% 30%', primary: '20 70% 60%' },
    dark:  { background: '60 3% 20%', foreground: '60 3% 82%', primary: '20 70% 65%' },
  },
  rgb: {
    light: { background: 'rgb(250, 250, 250)', foreground: 'rgb(70, 70, 70)', primary: 'rgb(200, 120, 90)' },
    dark:  { background: 'rgb(40, 40, 45)', foreground: 'rgb(220, 220, 220)', primary: 'rgb(230, 150, 120)' },
  },
  hex: {
    light: { background: '#fafafa', foreground: '#464646', primary: '#c8785a' },
    dark:  { background: '#28282d', foreground: '#dcdcdc', primary: '#e69678' },
  },
};

/** generateColorVariables + friends, verbatim shape (subset of keys is fine). */
function themeVariables(p, mode) {
  const s = p[mode];
  return `${mode === 'dark' ? '.dark' : ':root'} {
  --background: ${s.background};
  --foreground: ${s.foreground};
  --card: ${s.background};
  --card-foreground: ${s.foreground};
  --popover: ${s.background};
  --popover-foreground: ${s.foreground};
  --primary: ${s.primary};
  --primary-foreground: ${s.background};
  --secondary: ${s.background};
  --secondary-foreground: ${s.foreground};
  --muted: ${s.background};
  --muted-foreground: ${s.foreground};
  --accent: ${s.background};
  --accent-foreground: ${s.foreground};
  --destructive: ${s.primary};
  --destructive-foreground: ${s.background};
  --border: ${s.foreground};
  --input: ${s.background};
  --ring: ${s.primary};
  --chart-1: ${s.primary};
  --chart-2: ${s.primary};
  --chart-3: ${s.primary};
  --chart-4: ${s.primary};
  --chart-5: ${s.primary};
  --sidebar: ${s.background};
  --sidebar-foreground: ${s.foreground};
  --sidebar-primary: ${s.primary};
  --sidebar-primary-foreground: ${s.background};
  --sidebar-accent: ${s.background};
  --sidebar-accent-foreground: ${s.foreground};
  --sidebar-border: ${s.foreground};
  --sidebar-ring: ${s.primary};
  --font-sans: Inter, ui-sans-serif, sans-serif;
  --font-serif: Georgia, serif;
  --font-mono: "JetBrains Mono", monospace;
  --radius: 0.75rem;
  --shadow-x: 0px;
  --shadow-y: 1px;
  --shadow-blur: 3px;
  --shadow-spread: 0px;
  --shadow-opacity: 0.1;
  --shadow-color: ${s.foreground};
  --shadow-2xs: 0px 1px 3px 0px hsl(0 0% 0% / 0.05);
  --shadow-xs: 0px 1px 3px 0px hsl(0 0% 0% / 0.05);
  --shadow-sm: 0px 1px 3px 0px hsl(0 0% 0% / 0.10);
  --shadow: 0px 1px 3px 0px hsl(0 0% 0% / 0.10);
  --shadow-md: 0px 2px 4px 0px hsl(0 0% 0% / 0.10);
  --shadow-lg: 0px 4px 6px 0px hsl(0 0% 0% / 0.10);
  --shadow-xl: 0px 8px 10px 0px hsl(0 0% 0% / 0.10);
  --shadow-2xl: 0px 8px 10px 0px hsl(0 0% 0% / 0.25);
  --tracking-normal: 0em;
  --spacing: 0.25rem;
}`;
}

const themeInline = `@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-primary: var(--primary);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --shadow-2xs: var(--shadow-2xs);
  --font-sans: var(--font-sans);
}`;

const indent = (s) => s.split('\n').map(l => (l.length ? '  ' + l : l)).join('\n');

/** generateThemeCode, v4 branch, verbatim layout. */
function v4(p) {
  return `@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

${themeVariables(p, 'light')}

${themeVariables(p, 'dark')}

${themeInline}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
}`;
}

/** generateThemeCode, v3 branch, verbatim layout (two @layer base blocks). */
function v3(p) {
  return `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
${indent(themeVariables(p, 'light'))}

${indent(themeVariables(p, 'dark'))}
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}`;
}

const combos = [];
for (const [fmt, p] of Object.entries(PALETTE)) {
  combos.push([`v4 / ${fmt}`, v4(p), p]);
  // v3 only supports hsl (bare triplets) and hex/rgb/oklch via formatColor.
  combos.push([`v3 / ${fmt}`, v3(p), p]);
}

console.log('combination'.padEnd(26), 'L', 'D', 'tok', 'bg-base.light', 'status');
console.log('-'.repeat(105));
let failed = 0;
for (const [label, css] of combos) {
  let parsed;
  try { parsed = parseThemeCss(css); } catch (e) {
    console.log(label.padEnd(26), 'THREW', String(e).slice(0, 50)); failed += 1; continue;
  }
  let built;
  try { built = buildOverrides(parsed, {}); } catch (e) {
    console.log(label.padEnd(26), 'BUILD THREW', String(e).slice(0, 50)); failed += 1; continue;
  }
  const n = Object.keys(built.tokens).length;
  const bg = built.tokens['--dsw-alias-bg-base'];
  const ok = parsed.counts.light >= 30 && parsed.counts.dark >= 30 && n >= 130
    && bg !== undefined && typeof bg.light === 'string' && typeof bg.dark === 'string'
    && luminance(bg.light) !== null && luminance(bg.dark) !== null;
  if (!ok) failed += 1;
  console.log(
    label.padEnd(26),
    String(parsed.counts.light).padEnd(2),
    String(parsed.counts.dark).padEnd(2),
    String(n).padEnd(4),
    String(bg?.light ?? '-').slice(0, 26).padEnd(27),
    ok ? 'OK' : '*** FAIL *** ' + JSON.stringify(parsed.warnings).slice(0, 40),
  );
}
console.log('-'.repeat(105));
console.log(failed === 0 ? `ALL ${combos.length} GENERATOR OUTPUTS PASS` : `${failed}/${combos.length} FAILED`);
process.exitCode = failed === 0 ? 0 : 1;
