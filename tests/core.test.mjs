/**
 * Unit tests for the theme core and the built browser artifact.
 *
 * Run with `node --test tests/`.
 *
 * Two things are checked here:
 *
 *  1. the parser/mapper against real tweakcn presets and adversarial input, and
 *  2. that the shipped `client.js` is the built template (so an edited
 *     `src/` never drifts from what the browser loads) and that its inlined
 *     copy of the core behaves identically to the ESM module.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  parseThemeCss, parseThemeJson, parseThemeInput, buildOverrides,
  classifySelector, isSafeValue, normalizeValue, stripComments,
  radiusTokens, parseLengthToPx, hasAlpha, softenBorder, isNearGrey,
  isSafeFontStack, COLOR_VARS,
  luminance, isLightColor, stepColor, mixWith, liftFrom, hue, hueMatches, fillFrom,
  isSingleScheme, deriveCompanion, ensureTwoSchemes, shiftScheme,
  tintOverlay, staticRamps, describeOverrides, sanitizePaste,
} from '../src/core.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const read = (path) => readFile(join(root, path), 'utf8');

/** Read one of the shipped test fixtures. */
const fixture = async (name) => read(join('tests', 'fixtures', name));

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

test('parses the two palette blocks of a tweakcn v4 export', async () => {
  const parsed = parseThemeCss(await fixture('claude.oklch.css'));
  assert.equal(parsed.light.background, 'oklch(0.9818 0.0054 95.0986)');
  assert.equal(parsed.dark.background, 'oklch(0.2679 0.0036 106.6427)');
  assert.ok(parsed.counts.light >= 40, `light count ${parsed.counts.light}`);
  assert.ok(parsed.counts.dark >= 38, `dark count ${parsed.counts.dark}`);
  assert.deepEqual(parsed.warnings.filter(w => w.includes('no dark block')), []);
});

test('reads every canonical colour variable', async () => {
  const parsed = parseThemeCss(await fixture('amethyst-haze.oklch.css'));
  for (const name of COLOR_VARS) {
    assert.equal(typeof parsed.light[name], 'string', `light --${name}`);
    assert.equal(typeof parsed.dark[name], 'string', `dark --${name}`);
  }
});

test('a bare HSL triplet becomes a usable colour', () => {
  const parsed = parseThemeCss(':root { --primary: 221 83% 53%; }\n.dark { --primary: 217 91% 60%; }');
  assert.equal(parsed.light.primary, 'hsl(221 83% 53%)');
  assert.equal(parsed.dark.primary, 'hsl(217 91% 60%)');
});

test('accepts the legacy @layer base wrapper', async () => {
  const parsed = parseThemeCss(await fixture('legacy-v3-hsl-triplets.css'));
  assert.equal(typeof parsed.light.background, 'string');
  assert.equal(typeof parsed.dark.background, 'string');
});

test('accepts hex and @theme inline without importing the aliases', async () => {
  const parsed = parseThemeCss(await fixture('legacy-v3-hex-with-theme-inline.css'));
  assert.match(parsed.light.background, /^#|^(rgb|hsl|oklch)/);
  assert.equal(parsed.light['radius-md'], undefined, '@theme alias must not be imported');
  assert.equal(parsed.light['color-background'], undefined, '@theme alias must not be imported');
  assert.deepEqual(parsed.warnings.filter(w => w.includes('derived')), [], 'silently skips @theme aliases');
});

test('accepts a tweakcn registry JSON payload', () => {
  const parsed = parseThemeJson({
    name: 'Demo',
    cssVars: {
      theme: { radius: '0.5rem', 'font-sans': 'Inter, sans-serif' },
      light: { background: 'oklch(1 0 0)', primary: 'oklch(0.6 0.2 30)' },
      dark: { background: 'oklch(0.2 0 0)', primary: 'oklch(0.7 0.2 30)' },
    },
  });
  assert.equal(parsed.source, 'json');
  assert.equal(parsed.light.background, 'oklch(1 0 0)');
  assert.equal(parsed.dark.background, 'oklch(0.2 0 0)');
  assert.equal(parsed.shared.radius, '0.5rem');
  assert.equal(parsed.shared['font-sans'], 'Inter, sans-serif');
});

test('parseThemeInput routes JSON and CSS', () => {
  assert.equal(parseThemeInput('{"cssVars":{"light":{"background":"#fff"}}}').light.background, '#fff');
  assert.equal(parseThemeInput(':root{--background:#fff}').light.background, '#fff');
  const broken = parseThemeInput('{ not json');
  assert.ok(broken.warnings.length > 0);
});

test('media-scoped :root counts as the dark palette', () => {
  const parsed = parseThemeCss(`
    :root { --background: #fff; }
    @media (prefers-color-scheme: dark) { :root { --background: #000; } }
  `);
  assert.equal(parsed.light.background, '#fff');
  assert.equal(parsed.dark.background, '#000');
});

test('a conditional block does not override an explicit one', () => {
  const parsed = parseThemeCss(`
    :root { --background: #fff; }
    @media (prefers-color-scheme: dark) { :root { --background: #111; } }
    .dark { --background: #000; }
  `);
  assert.equal(parsed.dark.background, '#000');
});

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

test('rejects values that could fetch or escape the declaration', () => {
  for (const bad of [
    'url(https://example.com/x.png)',
    'image-set("a.png" 1x)',
    'red; background: blue',
    'red } body { color: red',
    'expression(alert(1))',
    'javascript:alert(1)',
    '<svg onload=alert(1)>',
    'red\\',
  ]) {
    assert.equal(isSafeValue(bad), false, `should reject: ${bad}`);
  }
  for (const good of [
    'oklch(0.62 0.14 39.04)',
    'color-mix(in srgb, #fff 45%, transparent)',
    '1px 2px 5px hsl(0 0% 0% / 0.03)',
    '"Fira Code", "Courier New", monospace',
  ]) {
    assert.equal(isSafeValue(good), true, `should accept: ${good}`);
  }
});

test('drops unsafe declarations but keeps the rest of the block', () => {
  const parsed = parseThemeCss(`:root {
    --background: url(https://evil/x.png);
    --primary: oklch(0.6 0.2 30);
    --muted: 0 0% 96%;
  }`);
  assert.equal(parsed.light.background, undefined);
  assert.equal(parsed.light.primary, 'oklch(0.6 0.2 30)');
  assert.equal(parsed.light.muted, 'hsl(0 0% 96%)');
  assert.ok(parsed.warnings.some(w => w.includes('unsafe')));
});

test('an over-long value is dropped', () => {
  assert.equal(normalizeValue(`oklch(${'1 '.repeat(200)}0 0)`, 'primary'), null);
});

test('strips !important', () => {
  assert.equal(normalizeValue('#fff !important', 'background'), '#fff');
});

// ---------------------------------------------------------------------------
// Selectors and comments
// ---------------------------------------------------------------------------

test('classifies palette selectors', () => {
  assert.equal(classifySelector(':root'), 'light');
  assert.equal(classifySelector('.dark'), 'dark');
  assert.equal(classifySelector(':root, .dark'), 'both');
  assert.equal(classifySelector('[data-theme="dark"]'), 'dark');
  assert.equal(classifySelector('body[data-ds-dark-theme]'), 'dark');
  assert.equal(classifySelector('.dark .card'), null);
  assert.equal(classifySelector(':root .dark'), null);
  assert.equal(classifySelector('.card'), null);
  assert.equal(classifySelector('@apply text-sm'), null);
  // The compound form the original request specified.
  assert.equal(classifySelector(':root.dark'), 'dark');
  assert.equal(classifySelector('html.dark'), 'dark');
});

test('parses the exact :root / :root.dark form from the request', () => {
  const parsed = parseThemeCss(`
    :root {
      --background: #ffffff;
      --primary: #4176e6;
    }

    :root.dark {
      --background: #14161a;
      --primary: #7aaaff;
    }
  `);
  assert.deepEqual(Object.keys(parsed.light).sort(), ['background', 'primary']);
  assert.deepEqual(Object.keys(parsed.dark).sort(), ['background', 'primary']);
  assert.equal(parsed.light.background, '#ffffff');
  assert.equal(parsed.dark.background, '#14161a');

  const { tokens } = buildOverrides(parsed, {});
  assert.deepEqual(tokens['--dsw-alias-bg-base'], { light: '#ffffff', dark: '#14161a' });
  assert.deepEqual(tokens['--dsw-alias-brand-primary'], { light: '#4176e6', dark: '#7aaaff' });
});

test('a full tweakcn community export parses both schemes', async () => {
  // Real pastes from tweakcn.com/community. They open with
  //   @import "tailwindcss";
  //   @custom-variant dark (&:is(.dark *));
  // Those semicolon-terminated at-rules used to stick to `prelude`, so the
  // following `:root {` was collected with a head starting in `@` and the
  // entire light palette was silently swallowed. The observable symptom was
  // "8 tokens, nothing changes" — which made most community themes unusable.
  for (const name of ['community-hacker-matrix.css', 'community-light-blue.css']) {
    const parsed = parseThemeCss(await fixture(name));
    const single = parsed.warnings.filter(w => w.includes('single-scheme'));
    assert.equal(single.length, 1, `${name} should be flagged as a single-palette theme`);
    const other = parsed.warnings.filter(w => !w.includes('single-scheme'));
    assert.deepEqual(other, [], `${name} should have no other parser warnings`);
    assert.ok(parsed.counts.light >= 45, `${name}: light palette missing (${parsed.counts.light})`);
    assert.ok(parsed.counts.dark >= 45, `${name}: dark palette missing (${parsed.counts.dark})`);
    assert.equal(parsed.light.background, parsed.dark.background,
      `${name}: these two community themes ship identical palettes in both blocks`);

    const { tokens } = buildOverrides(parsed, {});
    assert.ok(Object.keys(tokens).length >= 140,
      `${name}: expected a full ladder, got ${Object.keys(tokens).length}`);
    // Companion derivation is on by default, so a single-palette theme gets two
    // distinct schemes rather than the same value twice.
    assert.ok(typeof tokens['--dsw-alias-bg-base'].light === 'string');
    assert.ok(typeof tokens['--dsw-alias-bg-base'].dark === 'string');
    assert.notEqual(tokens['--dsw-alias-bg-base'].light, tokens['--dsw-alias-bg-base'].dark,
      `${name}: companion derivation should separate the schemes`);
    assert.ok(tokens['--dsw-focus-ring-color'], `${name}: focus ring is mapped`);
    assert.ok(tokens['--dsw-static-neutral-00'], `${name}: static ramps rebuilt`);

    // Guard the guard: these fixtures must stay *full raw exports*. Trimming
    // them back to bare `:root`/`.dark` would make the semicolon bug invisible
    // again while this test still passed.
    const css = await fixture(name);
    for (const marker of ['@import', '@custom-variant', '@theme inline', '@layer base']) {
      assert.ok(css.includes(marker), `${name} lost the "${marker}" wrapper`);
    }
    assert.ok(Object.keys(parsed.shared).length >= 3, `${name}: shared vars missing`);
  }
});

test('a single-palette theme gains a legible companion scheme', async () => {
  // tweakcn's `mergePresetWithDefaults` spreads the light palette into dark, so
  // a huge share of community themes declare the same colours twice. Without
  // this, switching Light/Dark in Harness shows literally no difference.
  const parsed = parseThemeCss(await fixture('community-light-blue.css'));
  assert.equal(isSingleScheme(parsed.light, parsed.dark), true);

  const derived = deriveCompanion(parsed);
  const L = (x) => luminance(x);
  assert.ok(L(derived.dark.background) < 0.35, 'derived dark page is dark');
  assert.ok(L(derived.dark.foreground) > 0.7, 'derived dark ink is bright');
  assert.ok(L(derived.dark.foreground) - L(derived.dark.background) > 0.4,
    'derived dark scheme has readable contrast');
  assert.ok(L(derived.light.background) > 0.8, 'original light page is untouched');
  assert.equal(derived.dark.primary, parsed.light.primary, 'the brand colour is kept, not inverted');
  assert.equal(derived.dark.ring, parsed.light.ring, 'the ring colour is kept');

  // The ladder keeps its internal ordering instead of collapsing to one value.
  const surfaces = ['background', 'muted', 'border'].map(k => L(derived.dark[k]));
  assert.equal(surfaces.some((v, i) => i > 0 && v < surfaces[i - 1] - 0.0001), false,
    `derived dark surfaces must not invert: ${JSON.stringify(surfaces)}`);
  assert.ok(new Set(surfaces.map(v => v.toFixed(2))).size > 1,
    'derived surfaces remain distinguishable');

  // The option is opt-out and a genuine two-scheme theme is left alone.
  assert.equal(isSingleScheme(parseThemeCss(await fixture('claude.oklch.css')).light,
    parseThemeCss(await fixture('claude.oklch.css')).dark), false);
  const claude = parseThemeCss(await fixture('claude.oklch.css'));
  assert.equal(ensureTwoSchemes(claude, true), claude, 'a real two-scheme theme is not rewritten');
  assert.equal(ensureTwoSchemes(parsed, false), parsed, 'the option can be disabled');

  // buildOverrides applies it, so light and dark bg-base actually differ.
  const on = buildOverrides(parsed, { companion: true }).tokens['--dsw-alias-bg-base'];
  const off = buildOverrides(parsed, { companion: false }).tokens['--dsw-alias-bg-base'];
  assert.equal(off.light, off.dark, 'off keeps the identical palettes');
  assert.notEqual(on.light, on.dark, 'on produces two distinct schemes');
});

test('semicolon-terminated at-rules never swallow the following rule', () => {
  // Minimised version of the bug, covering each statement form tweakcn emits.
  const parsed = parseThemeCss(`
    @import "tailwindcss";
    @custom-variant dark (&:is(.dark *));
    @plugin "tailwindcss-animate";
    :root { --background:#fff; --foreground:#111; }
    .dark { --background:#000; --foreground:#eee; }
  `);
  assert.deepEqual(parsed.counts, { light: 2, dark: 2 });
  assert.equal(parsed.light.background, '#fff');
  assert.equal(parsed.dark.background, '#000');
});

test('a grouped ":root, .dark" selector fills both schemes', () => {
  // A real shadcn variant. `both` must write to *both* maps, otherwise the
  // dark map stays empty and no `{light, dark}` pair can be emitted.
  const parsed = parseThemeCss(`
    :root, .dark {
      --background: #fafafa; --foreground: #111; --primary: #3366ff;
    }
  `);
  assert.deepEqual(parsed.counts, { light: 3, dark: 3 });
  assert.equal(parsed.dark.background, '#fafafa');
  assert.equal(buildOverrides(parsed, {}).tokens['--dsw-alias-bg-base'].dark, '#fafafa');
});

test('bare HSL triplets are wrapped only when they really are triplets', () => {
  // Tailwind v3 stores colours as `<hue> <sat>% <l>%`. tweakcn's own importer
  // uses `/^\d/`, which misses a negative hue and misfires on a value whose
  // first token is a percentage (formatNumber emits 4-decimal values too).
  assert.equal(normalizeValue('0 0% 9%', 'primary'), 'hsl(0 0% 9%)');
  assert.equal(normalizeValue('221.5 83.2% 53.1%', 'primary'), 'hsl(221.5 83.2% 53.1%)');
  assert.equal(normalizeValue('-120 50% 40%', 'foreground'), 'hsl(-120 50% 40%)');
  assert.equal(normalizeValue('5.9000% 12.3456% 98.0000%', 'background'),
    '5.9000% 12.3456% 98.0000%', 'not a triplet: leave it alone');
  assert.equal(normalizeValue('oklch(1 0 0)', 'background'), 'oklch(1 0 0)');
});

test('a v0 export keeps its real font stacks from @theme inline', () => {
  // `utils/registry/v0.ts` puts literal font stacks inside `@theme inline`
  // and emits no `--font-*` in `:root`. Dropping the whole at-rule loses them.
  const parsed = parseThemeCss(`
    @import "tailwindcss";
    @import "tw-animate-css";
    @custom-variant dark (&:is(.dark *));
    @theme inline {
      --font-sans: Inter, Inter Fallback;
      --font-mono: "JetBrains Mono", monospace;
      --color-background: var(--background);
      --radius-2xl: calc(var(--radius) + 8px);
    }
    :root { --background: oklch(1 0 0); --foreground: oklch(0.2 0 0); --primary: oklch(0.6 0.15 260); --radius: 0.75rem; }
    .dark { --background: oklch(0.2 0 0); --foreground: oklch(0.9 0 0); --primary: oklch(0.7 0.15 260); --radius: 0.75rem; }
    @layer base { * { @apply border-border; } }
  `);
  assert.equal(parsed.shared['font-sans'], 'Inter, Inter Fallback');
  assert.equal(parsed.shared['font-mono'], '"JetBrains Mono", monospace');
  // Fonts are opt-in now (the "字体变厚" fix): pass fonts:true explicitly to
  // exercise the font-stack mapping itself.
  const { tokens } = buildOverrides(parsed, { fonts: true });
  assert.equal(tokens['--dsw-font-family'].light, 'Inter, Inter Fallback');

  // The editor's v4 export has only `var(--font-sans)` self-references there;
  // those must not overwrite the real stack declared in `:root`.
  const v4 = parseThemeCss(`
    :root { --background:#fff; --foreground:#111; --primary:#36f; --font-sans: Arial, sans-serif; }
    .dark { --background:#000; --foreground:#eee; --primary:#8af; --font-sans: Arial, sans-serif; }
    @theme inline { --font-sans: var(--font-sans); --color-background: var(--background); }
  `);
  assert.equal(v4.shared['font-sans'], 'Arial, sans-serif');
});

test('tweakcn registry JSON payloads are accepted in every wrapper', () => {
  const vars = {
    light: { background: '#fff', foreground: '#111', primary: '#36f' },
    dark: { background: '#000', foreground: '#eee', primary: '#8af' },
  };
  const payloads = [
    { name: 'modern-minimal', cssVars: { ...vars, theme: { 'font-sans': 'Inter' } } },
    { $schema: 'x', name: 'tweakcn-theme-registry',
      items: [{ name: 'empty', cssVars: { light: {}, dark: {} } },
        { name: 'modern-minimal', cssVars: vars }] },
    vars,
  ];
  for (const [index, payload] of payloads.entries()) {
    const parsed = parseThemeJson(payload);
    assert.equal(parsed.source, 'json');
    assert.equal(parsed.light.background, '#fff', `payload ${index} light`);
    assert.equal(parsed.dark.background, '#000', `payload ${index} dark`);
    assert.deepEqual(parsed.warnings, []);
  }
  assert.equal(parseThemeJson(payloads[1]).name, 'modern-minimal',
    'the first *usable* item is chosen, not an empty one');
});

test(':root:not(.dark) is the light palette, not the dark one', () => {
  // shadcn's light block is often written with an explicit negation. The
  // literal `.dark` inside `:not()` used to make the dark detector claim it.
  assert.equal(classifySelector(':root:not(.dark)'), 'light');
  assert.equal(classifySelector(':host'), 'light');
  assert.equal(classifySelector(':host(.dark)'), 'dark');
  assert.equal(classifySelector(':root.dark'), 'dark');
  assert.equal(classifySelector('.dark .card'), null);

  const parsed = parseThemeCss(`
    :root:not(.dark) { --background:#fff; --foreground:#111; --primary:#36f; }
    .dark { --background:#000; --foreground:#eee; --primary:#8af; }
  `);
  assert.equal(parsed.light.background, '#fff');
  assert.equal(parsed.dark.background, '#000');
});

test('markdown fences, prose, BOM and CRLF are stripped from a paste', () => {
  const css = ':root{--background:#fff;--foreground:#111;--primary:#36f;}\n.dark{--background:#000;--foreground:#eee;--primary:#8af;}';
  const variants = [
    '```css\n' + css + '\n```',
    '~~~css\n' + css + '\n~~~',
    'Here is my theme:\n' + css,
    'Note: use v4 format.\n' + css,
    '\uFEFF' + css,
    css.replace(/\n/g, '\r\n'),
  ];
  for (const paste of variants) {
    const parsed = parseThemeInput(paste);
    assert.ok(parsed.counts.light >= 2 && parsed.counts.dark >= 2,
      `paste variant failed: ${JSON.stringify(paste.slice(0, 30))}`);
    assert.equal(buildOverrides(parsed, {}).tokens['--dsw-alias-bg-base'].light, '#fff');
  }
});

test('every recorded export format produces a usable two-scheme theme', () => {
  // The full matrix lives in scripts/format-matrix.mjs; this is the load-bearing
  // subset that guards against a whole family of community themes going dead.
  const L = '--background:#fafafa;--foreground:#111;--primary:#3366ff;';
  const D = '--background:#101014;--foreground:#eee;--primary:#88aaff;';
  const cases = {
    canonical: `:root{${L}} .dark{${D}}`,
    compound: `:root{${L}} :root.dark{${D}}`,
    html: `html{${L}} html.dark{${D}}`,
    attribute: `:root{${L}} [data-theme="dark"]{${D}}`,
    media: `:root{${L}} @media (prefers-color-scheme: dark){:root{${D}}}`,
    layer: `@layer base{:root{${L}} .dark{${D}}}`,
    fullV4: `@import "tailwindcss";\n@custom-variant dark (&:is(.dark *));\n:root{${L}}\n.dark{${D}}\n@theme inline{--color-background:var(--background);}\n@layer base{*{@apply border-border;}}`,
    bareTriplets: `:root{--background:0 0% 100%;--foreground:0 0% 9%;} .dark{--background:0 0% 9%;--foreground:0 0% 98%;}`,
  };
  for (const [label, css] of Object.entries(cases)) {
    const parsed = parseThemeCss(css);
    const { tokens } = buildOverrides(parsed, {});
    assert.ok(parsed.counts.light > 0 && parsed.counts.dark > 0,
      `${label}: both schemes must resolve`);
    assert.ok(Object.keys(tokens).length >= 50, `${label}: expected a usable ladder`);
    assert.equal(tokens['--dsw-alias-bg-base'].light, parsed.light.background, label);
    assert.equal(tokens['--dsw-alias-bg-base'].dark, parsed.dark.background, label);
  }
});

test('the compound form also works with a real tweakcn palette', async () => {
  // tweakcn exports `.dark`; the request's form is `:root.dark`. Rewrite one and
  // confirm both spellings produce the same palette.
  const plain = await fixture('claude.oklch.css');
  const compound = plain.replace(/(^|\n)\.dark\s*\{/g, '$1:root.dark {');
  assert.ok(compound.includes(':root.dark'), 'fixture rewritten');

  const fromPlain = parseThemeCss(plain);
  const fromCompound = parseThemeCss(compound);
  assert.deepEqual(fromCompound.light, fromPlain.light);
  assert.deepEqual(fromCompound.dark, fromPlain.dark);
  assert.ok(Object.keys(fromCompound.dark).length >= 38, 'dark palette survived');
});

test('comments never change the parse', () => {
  const parsed = parseThemeCss(`
    /* :root { --background: #f00; } */
    :root {
      /* a brace { inside a comment */
      --background: #fff; /* trailing */
      --primary: oklch(0.5 0.1 200); /* ; } */
    }
  `);
  assert.equal(parsed.light.background, '#fff');
  assert.equal(parsed.light.primary, 'oklch(0.5 0.1 200)');
});

test('stripComments preserves string literals', () => {
  const out = stripComments(':root{--font-sans:"a/*b*/c", serif}');
  assert.ok(out.includes('"a/*b*/c"'));
});

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

test('maps a full theme onto DSH tokens for both schemes', async () => {
  const parsed = parseThemeCss(await fixture('t3-chat.oklch.css'));
  const { tokens, count } = buildOverrides(parsed, {});
  assert.ok(count >= 25, `expected a rich mapping, got ${count}`);
  for (const [name, modes] of Object.entries(tokens)) {
    assert.match(name, /^--(dsw|dsh|ds)-/, `token ${name}`);
    assert.equal(typeof modes.light, 'string', `${name}.light`);
    assert.equal(typeof modes.dark, 'string', `${name}.dark`);
    assert.notEqual(modes.light, '', `${name}.light`);
    assert.notEqual(modes.dark, '', `${name}.dark`);
  }
  assert.equal(tokens['--dsw-alias-bg-base'].light, parsed.light.background);
  assert.equal(tokens['--dsw-alias-bg-base'].dark, parsed.dark.background);
  assert.equal(tokens['--dsw-alias-brand-primary'].light, parsed.light.primary);
  assert.equal(tokens['--dsw-alias-label-primary'].light, parsed.light.foreground);
});

test('a light-only theme still produces a usable two-scheme theme', () => {
  // People constantly paste just `:root` from a blog or a chat message. It used
  // to yield ZERO tokens (overrideTokens needs a {light, dark} pair), i.e. the
  // plugin silently did nothing. Now the missing scheme is filled and derived.
  const parsed = parseThemeCss(':root { --background:#fff; --foreground:#111; --primary:#c00; --muted:#eee; --border:#ddd; }');
  const { tokens } = buildOverrides(parsed, {});
  assert.ok(Object.keys(tokens).length >= 100, 'a full ladder is still emitted');
  assert.equal(tokens['--dsw-alias-bg-base'].light, '#fff', 'the declared light value is kept');
  assert.notEqual(tokens['--dsw-alias-bg-base'].dark, '#fff', 'a real dark companion is derived');
  assert.equal(tokens['--dsw-alias-brand-primary'].light, '#c00');

  // The companion feature can still be switched off, in which case both schemes
  // receive the declared values verbatim rather than silently breaking.
  const off = buildOverrides(parsed, { companion: false }).tokens;
  assert.ok(Object.keys(off).length >= 100);
  assert.equal(off['--dsw-alias-bg-base'].light, '#fff');
  assert.equal(off['--dsw-alias-bg-base'].dark, '#fff');

  // A dark-only paste works the same way.
  const darkOnly = buildOverrides(parseThemeCss('.dark { --background:#000; --foreground:#eee; --primary:#0c0; }'), {}).tokens;
  assert.ok(Object.keys(darkOnly).length >= 100);
  assert.equal(darkOnly['--dsw-alias-bg-base'].dark, '#000');
  assert.notEqual(darkOnly['--dsw-alias-bg-base'].light, '#000');
});

test('every emitted token name exists in the DSH token sheet', async () => {
  // The authoritative source is the shipped theme bundle, not the hand-made
  // extracts: it holds the alias layer *and* the standalone tokens the
  // components read (`--dsw-focus-ring-color`, the static ramps, …).
  const bundle = await read(join('tests', 'fixtures', 'dsh-token-defs.txt'));
  const known = new Set([...bundle.matchAll(/--([a-z0-9-]+)\s*:/g)].map(m => m[1]));
  assert.ok(known.size > 300, `expected the full token sheet, saw ${known.size}`);

  const emitted = new Set();
  for (const name of ['claude.oklch.css', 'amethyst-haze.oklch.css', 't3-chat.oklch.css',
    'legacy-v3-hsl-triplets.css', 'legacy-v3-hex-with-theme-inline.css']) {
    const parsed = parseThemeCss(await fixture(name));
    for (const options of [{}, { statusTint: true }, { borders: 'solid' }, { borders: 'off' }]) {
      for (const token of Object.keys(buildOverrides(parsed, options).tokens)) emitted.add(token.slice(2));
    }
  }

  const unknown = [...emitted].filter(name => !known.has(name));
  assert.deepEqual(unknown, [], 'tokens not present in the shipped stylesheet');
});

test('borders can be softened, solid, or left alone', async () => {
  const parsed = parseThemeCss(await fixture('claude.oklch.css'));
  const soft = buildOverrides(parsed, { borders: 'soft' }).tokens;
  assert.match(soft['--dsw-alias-border-l1'].light, /^color-mix\(/);
  assert.match(soft['--dsw-alias-border-l2'].light, /80%/, 'l2 keeps more of the colour');

  const solid = buildOverrides(parsed, { borders: 'solid' }).tokens;
  assert.equal(solid['--dsw-alias-border-l1'].light, parsed.light.border);

  const off = buildOverrides(parsed, { borders: 'off' }).tokens;
  assert.equal(off['--dsw-alias-border-l1'], undefined);
});

test('an already-translucent border is not mixed down again', () => {
  assert.equal(hasAlpha('#11223380'), true);
  assert.equal(hasAlpha('rgb(1 2 3 / 0.5)'), true);
  assert.equal(hasAlpha('oklch(0.5 0.1 200)'), false);
  assert.equal(softenBorder('#11223380', 45), '#11223380');
  assert.match(softenBorder('#112233', 45), /45%/);
});

test('a near-grey destructive colour keeps the built-in error colour', () => {
  assert.equal(isNearGrey('oklch(0.1908 0.0020 106.5859)'), true);
  assert.equal(isNearGrey('oklch(0.6627 0.0978 20.0041)'), false);
  const parsed = parseThemeCss(':root{--destructive:oklch(0.19 0.002 106)}\n.dark{--destructive:oklch(0.2 0.002 106)}');
  const { tokens, warnings } = buildOverrides(parsed, {});
  assert.equal(tokens['--dsw-alias-state-error-primary'], undefined);
  assert.ok(warnings.some(w => w.includes('near-grey')), 'explains the fallback');
});

test('radius maps the theme scale onto the DSH scale', () => {
  assert.deepEqual(radiusTokens('0.625rem'), {
    '--dsw-radius-xs': '4px',
    '--dsw-radius-sm': '8px',
    '--dsw-radius-md': '12px',
    '--dsw-radius-lg': '16px',
    '--dsw-radius-xl': '20px',
    '--dsw-radius-panel': '28px',
  });
  assert.equal(parseLengthToPx('0.5rem'), 8);
  assert.equal(parseLengthToPx('10px'), 10);
  assert.equal(parseLengthToPx('0'), 0);
  assert.equal(parseLengthToPx('calc(1rem + 2px)'), null);
  // A sharp theme stays sharp.
  const sharp = radiusTokens('0rem');
  assert.equal(sharp['--dsw-radius-md'], '4px');
  assert.equal(sharp['--dsw-radius-xs'], '2px');
});

test('fonts only pass through when they are a plain font list', async () => {
  const parsed = parseThemeCss(await fixture('claude.oklch.css'));
  const { tokens } = buildOverrides(parsed, { fonts: true });
  assert.equal(tokens['--dsw-font-family'].light, parsed.shared['font-sans']);
  assert.equal(tokens['--ds-font-family-code'].light, parsed.shared['font-mono']);
  // The presenter owns the --dsh-font-family-* variables; never fight it.
  assert.equal(tokens['--dsh-font-family-text'], undefined);

  assert.equal(isSafeFontStack('Inter, sans-serif'), true);
  assert.equal(isSafeFontStack('"Fira Code", monospace'), true);
  assert.equal(isSafeFontStack('Inter; url(https://x/y.woff2)'), false);
  assert.equal(isSafeFontStack('Inter } body {'), false);

  const hostile = parseThemeCss(':root{--font-sans:"a" , monospace}');
  hostile.shared['font-sans'] = 'Inter, url(https://x/y.woff2)';
  const built = buildOverrides(hostile, { fonts: true });
  assert.equal(built.tokens['--dsw-font-family'], undefined);
  assert.ok(built.warnings.some(w => w.includes('font list')));
});

test('options can turn mapping areas off', async () => {
  const parsed = parseThemeCss(await fixture('claude.oklch.css'));
  const full = buildOverrides(parsed, {}).count;
  const lean = buildOverrides(parsed, { extras: false, radius: 'off', fonts: false, borders: 'off' }).count;
  assert.ok(lean < full, `${lean} should be fewer than ${full}`);
  const leanTokens = buildOverrides(parsed, { extras: false, radius: 'off', fonts: false, borders: 'off' }).tokens;
  assert.equal(leanTokens['--dsw-radius-md'], undefined);
  assert.equal(leanTokens['--dsw-font-family'], undefined);
  assert.equal(leanTokens['--dsw-alias-markdown-code-block'], undefined);
});

test('fonts are OFF by default so DSH keeps its CJK font stack (字体变厚 fix)', async () => {
  // The reported "字体又是厚" problem: tweakcn's --font-sans (e.g.
  // "Geist, sans-serif") has NO CJK family, yet overrideTokens writes it
  // INLINE on <body>, beating DSH's built-in "PingFang SC"/"Microsoft YaHei"
  // stack and the user's own font settings. Chinese falls back to a system
  // font and font-synthesis fakes bold for font-weight:500 UI text. The safe
  // default is to leave DSH's font stack alone.
  const parsed = parseThemeCss(await fixture('claude.oklch.css'));
  const defaultTokens = buildOverrides(parsed, {}).tokens;
  assert.equal(defaultTokens['--dsw-font-family'], undefined,
    'no sans override unless the user explicitly opts in');
  assert.equal(defaultTokens['--ds-font-family-code'], undefined,
    'no code-font override either');
  // Explicit opt-in still works (the feature is not deleted).
  const optIn = buildOverrides(parsed, { fonts: true }).tokens;
  assert.equal(optIn['--dsw-font-family'].light, parsed.shared['font-sans']);
});

test('status tint is opt-in', async () => {
  const parsed = parseThemeCss(await fixture('amethyst-haze.oklch.css'));
  // Off by default: no status token is touched.
  assert.equal(buildOverrides(parsed, {}).tokens['--dsw-alias-state-success-primary'], undefined);
  // On, a theme whose chart-3 really is green supplies the colour.
  assert.deepEqual(
    buildOverrides(parsed, { statusTint: true }).tokens['--dsw-alias-state-success-primary'],
    { light: parsed.light['chart-3'], dark: parsed.dark['chart-3'] },
  );
});

test('a chart colour of the wrong hue is refused as a status colour', async () => {
  // Claude's chart-3 is beige (hue ~93°) and its chart-4 is orange-red (~42°);
  // painting "success" beige or "warning" red would be worse than DSH's own.
  const claude = parseThemeCss(await fixture('claude.oklch.css'));
  const tinted = buildOverrides(claude, { statusTint: true }).tokens;
  assert.equal(tinted['--dsw-alias-state-success-primary'], undefined, 'beige is not green');
  assert.equal(tinted['--dsw-alias-state-warn-primary'], undefined, 'orange-red is not amber');
  assert.equal(tinted['--dsw-alias-state-success-tertiary'], undefined);
  assert.equal(tinted['--dsw-alias-state-warn-label'], undefined);

  // The hue gate itself.
  assert.equal(hueMatches('oklch(0.73 0.07 169.9)', 'green'), true);
  assert.equal(hueMatches('oklch(0.88 0.03 93.1)', 'green'), false, 'beige is rejected');
  assert.equal(hueMatches('oklch(0.85 0.09 76.8)', 'amber'), true);
  assert.equal(hueMatches('oklch(0.56 0.13 42.1)', 'amber'), false, 'orange-red is rejected');
  assert.equal(hueMatches('#808080', 'green'), true, 'unreadable hue is not second-guessed');
  assert.equal(hueMatches('hsl(140 40% 50%)', 'green'), true);
});

test('a fill candidate that is really an ink colour does not become a slab', async () => {
  // Claude's dark palette sets --secondary to near-white (luminance 0.98); using
  // it verbatim as a ghost-button fill paints a blinding white block in dark mode.
  const claude = parseThemeCss(await fixture('claude.oklch.css'));
  const { tokens } = buildOverrides(claude, {});

  const rawSecondary = claude.dark.secondary;
  assert.ok(luminance(rawSecondary) > 0.9, 'the fixture really does have a near-white secondary');

  const fillDark = tokens['--dsw-alias-button-ghost-active-fill'].dark;
  // Rejected as ink, so a page-tinted mix is emitted instead of the raw colour.
  assert.notEqual(fillDark, rawSecondary, 'the near-white slab was refused');
  assert.match(fillDark, /^color-mix\(/, 'a page-tinted fill was derived');
  // The tint is shallow: the foreground contributes a single-digit percentage.
  const percent = Number(fillDark.match(/(\d+(?:\.\d+)?)%/)?.[1] ?? '999');
  assert.ok(percent > 0 && percent <= 12, `tint strength ${percent}% should stay shallow`);

  // fillFrom itself: a shallow candidate passes through, a far one is re-derived.
  const page = '#18181b';
  assert.equal(fillFrom(page, page, '#fafafa', 6), page, 'a fill close to the page is kept');
  assert.match(fillFrom('#fafafa', page, '#fafafa', 6), /^color-mix\(/);
  assert.equal(fillFrom(null, page, '#fafafa'), null);
});

// ---------------------------------------------------------------------------
// Colour maths and the derived ladder
// ---------------------------------------------------------------------------

test('luminance reads every colour syntax a theme can use', () => {
  /** Floating-point comparison; the point is equality of perception, not bits. */
  const near = (actual, expected) => assert.ok(
    Math.abs(actual - expected) < 1e-6,
    `${actual} should be ${expected}`,
  );

  // The same white expressed four ways must agree.
  near(luminance('#ffffff'), 1);
  near(luminance('oklch(1 0 0)'), 1);
  near(luminance('rgb(255, 255, 255)'), 1);
  near(luminance('hsl(0 0% 100%)'), 1);
  near(luminance('#000000'), 0);
  near(luminance('oklch(0 0 0)'), 0);
  // Percentage-form oklch is read as a fraction, not as 98.18.
  near(luminance('oklch(98.18% 0.0054 95)'), 0.9818);
  // Ordering is what the ladder actually needs.
  assert.ok(luminance('#151517') < luminance('#2c2c2e'));
  assert.ok(luminance('#f9fafb') > luminance('#61666b'));
  assert.equal(luminance('var(--x)'), null, 'unknown syntax is not guessed');
  assert.equal(luminance(undefined), null);
});

test('isLightColor decides which way to move a colour', () => {
  assert.equal(isLightColor('#ffffff'), true);
  assert.equal(isLightColor('oklch(0.98 0.005 95)'), true);
  assert.equal(isLightColor('#151517'), false);
  assert.equal(isLightColor('oklch(0.27 0.004 106)'), false);
  assert.equal(isLightColor('nonsense'), false, 'unknown is treated as dark');
});

test('stepColor and mixWith produce real CSS', () => {
  assert.equal(stepColor('#808080', 0, 'lighter'), '#808080');
  assert.equal(stepColor('#808080', 10, 'lighter'), 'color-mix(in srgb, #808080, white 10%)');
  assert.equal(stepColor('#808080', 10, 'darker'), 'color-mix(in srgb, #808080, black 10%)');
  assert.equal(mixWith('#808080', '#ffffff', 100), '#808080');
  assert.equal(mixWith('#808080', '#ffffff', 0), '#ffffff');
  assert.equal(mixWith('#808080', '#ffffff', 82), 'color-mix(in srgb, #808080 82%, #ffffff)');
  assert.equal(mixWith('#808080', null, 50), '#808080', 'missing target keeps the colour');
  assert.equal(mixWith(null, '#fff', 50), null);
});

test('liftFrom always moves away from the page', () => {
  // A near-black page lifts raised surfaces toward white.
  assert.match(liftFrom('#1b1b1c', '#151517', 8), /white 8%/);
  // A white page cannot go lighter, so it darkens instead.
  assert.match(liftFrom('#f9fafb', '#ffffff', 8), /black 8%/);
  // A white card on a white page still has to separate itself.
  assert.match(liftFrom('#ffffff', '#ffffff', 8), /black 8%/);
  // Mid-grey pages count as light.
  assert.match(liftFrom('#eeeeee', '#808080', 5), /black 5%/);
  assert.equal(liftFrom('#808080', '#000000', 0), '#808080');
  assert.equal(liftFrom('#808080', 'nonsense', 5), '#808080', 'unknown page leaves the colour alone');
});

test('the light and dark ladders each climb in the right direction', async () => {
  const parsed = parseThemeCss(await fixture('t3-chat.oklch.css'));
  const { tokens } = buildOverrides(parsed, {});

  const ranks = (mode) => [
    '--dsw-alias-bg-base',
    '--dsw-alias-bg-layer-1',
    '--dsw-alias-bg-layer-2',
    '--dsw-alias-bg-layer-3',
  ].map(token => tokens[token]?.[mode]).filter(Boolean);

  assert.equal(ranks('light').length, 4, 'the whole ladder is present in light');
  assert.equal(ranks('dark').length, 4, 'the whole ladder is present in dark');

  // Every rung except the base is a real colour value, not a token reference.
  for (const mode of ['light', 'dark']) {
    for (const value of ranks(mode)) {
      assert.equal(typeof value, 'string');
      assert.notEqual(value, '');
      assert.doesNotMatch(value, /var\(--dsw-alias-/, 'derived rungs must not self-reference');
    }
  }
});

test('text tiers get progressively lighter against the page', async () => {
  const parsed = parseThemeCss(await fixture('claude.oklch.css'));
  const { tokens } = buildOverrides(parsed, {});
  // Primary text must be the theme's own foreground, untouched.
  assert.deepEqual(tokens['--dsw-alias-label-primary'], {
    light: parsed.light.foreground,
    dark: parsed.dark.foreground,
  });
  // The dimmer tiers are mixed toward the page, so they contain a color-mix.
  for (const token of ['--dsw-alias-label-secondary', '--dsw-alias-label-tertiary', '--dsw-alias-label-caption']) {
    assert.ok(tokens[token], token + ' is emitted');
  }
  for (const token of ['--dsw-alias-label-tertiary', '--dsw-alias-label-caption', '--dsw-alias-label-dimmed']) {
    assert.match(tokens[token].light, /^color-mix\(/, token + ' is a blend');
  }
});

test('coverage reaches the surfaces a user actually sees', async () => {
  const parsed = parseThemeCss(await fixture('amethyst-haze.oklch.css'));
  const { tokens } = buildOverrides(parsed, { statusTint: true });

  // The tokens that paint most of the window.
  const loadBearing = [
    '--dsw-alias-bg-base',
    '--dsw-alias-bg-layer-1',
    '--dsw-alias-bg-layer-2',
    '--dsw-alias-bg-layer-3',
    '--dsw-alias-bg-overlay',
    '--dsw-specific-sidebar-fill',
    '--dsw-specific-input-major',
    '--dsw-alias-label-primary',
    '--dsw-alias-label-secondary',
    '--dsw-alias-border-l1',
    '--dsw-alias-border-l2',
    '--dsw-alias-brand-primary',
    '--dsw-alias-button-primary-fill',
    '--dsw-alias-tooltip-bg',
    '--dsw-alias-toast-bg',
    '--dsw-menu-surface-fill',
    '--dsw-alias-markdown-code-block',
    '--dsw-alias-state-error-primary',
    '--dsw-alias-state-success-primary',
    '--dsw-specific-bubble',
    '--dsw-alias-scrollbar-bg-l1',
    '--dsw-alias-switch-thumb',
    '--dsw-alias-link',
  ];
  const missing = loadBearing.filter(token => tokens[token] === undefined);
  assert.deepEqual(missing, [], 'load-bearing tokens are covered');
  assert.ok(Object.keys(tokens).length >= 100, `expected wide coverage, got ${Object.keys(tokens).length}`);
});

test('hover and active overlays stay translucent', async () => {
  const parsed = parseThemeCss(await fixture('claude.oklch.css'));
  const { tokens } = buildOverrides(parsed, {});
  // A solid hover fill would erase whatever sits underneath it.
  assert.match(tokens['--dsw-alias-interactive-bg-hover'].light, /transparent\)$/);
  assert.match(tokens['--dsw-alias-interactive-bg-active'].light, /transparent\)$/);
  assert.match(tokens['--dsw-menu-surface-fill'].light, /transparent\)$/);
  assert.match(tokens['--dsw-alias-menu-group-header-fill'].light, /transparent\)$/);
});

test('a theme without chart colours still covers the basics', async () => {
  // A minimal paste: only the eight essentials, no chart-*, no input.
  const parsed = parseThemeCss(`
    :root { --background:#fff; --foreground:#111; --primary:#4176e6;
            --primary-foreground:#fff; --muted:#f4f4f5; --muted-foreground:#71717a;
            --border:#e4e4e7; --card:#fff; }
    :root.dark { --background:#18181b; --foreground:#fafafa; --primary:#7aaaff;
            --primary-foreground:#111; --muted:#27272a; --muted-foreground:#a1a1aa;
            --border:#3f3f46; --card:#18181b; }
  `);
  const { tokens, warnings } = buildOverrides(parsed, { statusTint: true });
  assert.ok(Object.keys(tokens).length >= 60, `expected a usable ladder, got ${Object.keys(tokens).length}`);
  // The chart-derived extras are absent, and that is reported, not silently wrong.
  assert.equal(tokens['--dsw-alias-state-success-primary'], undefined);
  assert.deepEqual(warnings.filter(w => w.includes('nothing')), []);
  // Everything still pairs across schemes.
  for (const [name, modes] of Object.entries(tokens)) {
    assert.equal(typeof modes.light, 'string', name);
    assert.equal(typeof modes.dark, 'string', name);
  }
});

test('the tokens the shipped components actually read are covered', async () => {
  // Measured from 61 client bundles: this is what the UI paints itself with,
  // which is the only coverage number that predicts whether the window changes.
  const usage = JSON.parse(await read(join('tests', 'fixtures', 'token-usage.json')));
  const themeBundle = await read(join('tests', 'fixtures', 'dsh-token-defs.txt'));
  const parsed = parseThemeCss(await fixture('amethyst-haze.oklch.css'));
  const { tokens } = buildOverrides(parsed, { statusTint: true });

  // Not a colour the theme owns: geometry, typography, elevation, masks.
  const outOfScope = /font|radius|elevation|shadow|blur|backdrop|width|height|gap|inset|padding|clearance|corner-shape|transition|ease|duration|display|stops|mask/;
  // Fixed brand/onboarding art keeps its own colour whatever the theme says.
  const fixedBrand = /onboarding|brand-official|illustration-deep/;

  // Tokens whose value is another token: covering the target covers these.
  const indirect = (name) => {
    const definition = themeBundle.match(new RegExp('--' + name.slice(2) + ':([^;}]+)'));
    return definition !== null && definition[1].includes('var(--dsw-alias-');
  };
  /** True when DSH never defines the token at all. */
  const undefined_ = (name) => !themeBundle.includes('--' + name.slice(2) + ':');

  const missing = [];
  for (const [name, count] of usage) {
    if (!name.startsWith('--dsw-')) continue;
    if (outOfScope.test(name) || fixedBrand.test(name)) continue;
    if (count < 2) continue;
    if (tokens[name] !== undefined) continue;
    if (indirect(name)) continue;
    // A component reading a token the theme package never defines is a DSH-side
    // gap (`fill-l1`, `label-quaternary`); there is nothing to override.
    if (undefined_(name)) continue;
    // Palette stops (`--dsw-static-green-500`, `-amber-400`, …) belong to fixed
    // semantic families, not to a user theme; recolouring them would make a
    // "success" tick change hue with the wallpaper.
    if (/--dsw-static-(?!neutral)/.test(name)) continue;
    missing.push(`${name} (x${count})`);
  }
  assert.deepEqual(missing, [], 'high-traffic colour tokens must be covered');
});

test('a component token that only forwards to a covered alias needs no direct mapping', async () => {
  // `--dsw-alias-settings-card-fill` is defined as `var(--dsw-alias-bg-layer-2)`,
  // so overriding `bg-layer-2` already moves the settings cards.
  const themeBundle = await read(join('tests', 'fixtures', 'dsh-token-defs.txt'));
  const parsed = parseThemeCss(await fixture('amethyst-haze.oklch.css'));
  const { tokens } = buildOverrides(parsed, {});

  assert.match(themeBundle, /--dsw-alias-settings-card-fill:var\(--dsw-alias-bg-layer-2\)/);
  assert.match(themeBundle, /--dsw-alias-settings-card-stroke:var\(--dsw-alias-border-l4\)/);
  assert.ok(tokens['--dsw-alias-bg-layer-2'], 'the alias it forwards to is mapped');
  assert.ok(tokens['--dsw-alias-border-l4'], 'the alias it forwards to is mapped');
});

test('the static ramps components bypass the alias layer with are rebuilt', async () => {
  // `deliverables`, `plan`, `schedule`, `sidebar-files` and `sidebar-right` paint
  // with `--dsw-static-neutral-*` directly. Without these, those panels keep the
  // stock palette no matter what the theme says.
  const parsed = parseThemeCss(await fixture('t3-chat.oklch.css'));
  const { tokens } = buildOverrides(parsed, {});

  // The specific stops those components read.
  for (const stop of ['00', '50', '100', '200', '700', '800', '850']) {
    assert.ok(tokens[`--dsw-static-neutral-${stop}`], `neutral-${stop} is rebuilt`);
  }
  for (const stop of ['00', '400', '750', '800', '950']) {
    assert.ok(tokens[`--dsw-static-neutral-bluish-${stop}`], `neutral-bluish-${stop} is rebuilt`);
  }

  // Direction sanity, read the way the shipped alias table reads the ramp:
  // low stops are the light end, high stops the dark end, in both schemes.
  const page = parsed.dark.background;
  const ink = parsed.dark.foreground;
  const at = (stop) => tokens[`--dsw-static-neutral-bluish-${stop}`].dark;

  // -00 is the lightest stop, so it starts at the dark scheme's *ink*.
  assert.equal(at('00'), ink, '-00 is the dark ink end');
  // -1000 is the darkest stop, so it is the dark scheme's *page*.
  assert.equal(at('1000'), page, '-1000 is the dark page end');
  // -950 is nearly the dark end, i.e. very close to the page — this is the stop
  // `bg-base` reads in the dark scheme. `mixWith(ink, page, 5)` renders as
  // `color-mix(in srgb, <ink> 5%, <page>)`, i.e. 95% page.
  const nearPage = at('950');
  assert.match(nearPage, /^color-mix\(/);
  const inkShare = Number(nearPage.match(/\s([\d.]+)%,/) ?.[1] ?? '100');
  assert.ok(inkShare <= 10, `-950 should be mostly the dark page, got ${nearPage}`);
  // Symmetrically, -50 is nearly the ink end: it is mostly ink, little page.
  const nearInk = at('50');
  assert.match(nearInk, /^color-mix\(/);
  const inkShare50 = Number(nearInk.match(/\s([\d.]+)%,/) ?.[1] ?? '0');
  assert.ok(inkShare50 >= 90, `-50 should be mostly the dark ink, got ${nearInk}`);

  // Turning the feature off leaves the stock ramps alone.
  const off = buildOverrides(parsed, { ramps: false }).tokens;
  assert.equal(off['--dsw-static-neutral-00'], undefined);
  assert.equal(off['--dsw-static-neutral-bluish-950'], undefined);
  assert.ok(off['--dsw-alias-bg-base'], 'the alias layer still applies');
});

// ---------------------------------------------------------------------------
// The shipped artifact
// ---------------------------------------------------------------------------

test('client.js is up to date with src/ (read-only in-memory rebuild)', async () => {
  // Reproduce scripts/build.mjs here WITHOUT writing client.js. The old test
  // executed build.mjs on every run, which mutated the working tree and made
  // the assertion trivially true under `npm run check`. Everything below is
  // read-only: read the sources, replay the inlining/placeholder logic in
  // memory, then compare with the shipped artifact byte for byte.
  const [template, core, backdrop, presets, dictionaries, shipped] = await Promise.all([
    read('src/client.template.js'),
    read('src/core.js'),
    read('src/backdrop.js'),
    read('src/presets.json'),
    read('src/dictionaries.js'),
    read('client.js'),
  ]);

  const inlineCore = (source) => source
    .replace(/^export\s+(const|let|var|function|class)\s/gm, '$1 ')
    .replace(/^export\s+\{[^}]*\}\s*;?\s*$/gm, '')
    .trim();
  const inlineDictionaries = (source) => source
    .replace(/^export\s+(const|let|var|function|class)\s/gm, '$1 ')
    .trim();

  // Guard against build.mjs gaining a placeholder this replica does not know
  // about: fail with a clear message instead of silently comparing the wrong
  // set of inlined sources.
  const known = {
    '/*__CORE__*/': () => inlineCore(core),
    '/*__BACKDROP__*/': () => inlineCore(backdrop),
    '/*__PRESETS__*/': () => `const PRESETS = ${presets.trim()};`,
    '/*__DICTIONARIES__*/': () => inlineDictionaries(dictionaries),
  };
  const present = [...new Set([...template.matchAll(/\/\*__[A-Z]+__\*\//g)].map(m => m[0]))];
  assert.deepEqual(present.slice().sort(), Object.keys(known).sort(),
    'freshness replica must handle every template placeholder');
  let rebuilt = template;
  for (const marker of present) rebuilt = rebuilt.replace(marker, known[marker]);

  for (const marker of present) {
    assert.ok(!rebuilt.includes(marker), `placeholder ${marker} was not replaced`);
  }
  assert.ok(!/^\s*export\s/m.test(rebuilt), 'the rebuilt artifact must not contain ESM exports');
  // A freshness failure must tell the user to rebuild, not silently rewrite the
  // file: this test never calls writeFile or child_process.
  assert.equal(shipped, rebuilt,
    'client.js is stale: run `node scripts/build.mjs` and commit the result');
});

test('the inlined core in client.js matches src/core.js behaviour', async () => {
  const source = await read('client.js');
  assert.ok(source.trimStart().startsWith('/**') && source.includes("window.__ModuleLoader__.load({"), 'closure-factory artifact');
  assert.ok(!/^\s*export\s/m.test(source), 'no ESM exports in the browser artifact');

  // Evaluate the artifact with a stub loader and capture the factory.
  let factory;
  const sandbox = {
    __ModuleLoader__: { load: (definition) => { factory = definition.factory; } },
  };
  // The module only needs a document at apply() time; give the factory a stub.
  const head = [];
  const document = {
    createElement: () => ({ dataset: {}, remove() {} }),
    head: { appendChild: (node) => head.push(node) },
  };
  const store = new Map();
  const localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
  };
  sandbox.document = document;
  sandbox.localStorage = localStorage;
  const vm = await import('node:vm');
  vm.runInNewContext(source, {
    window: sandbox, console, document, localStorage,
    setInterval: () => 0, clearInterval: () => {},
  });
  assert.equal(typeof factory, 'function', 'factory captured');

  const provided = factory((id) => {
    if (id === 'react') {
      return {
        createElement: () => null, useState: () => [undefined, () => {}],
        useEffect: () => {}, useMemo: () => [], useRef: () => ({ current: undefined }),
        useCallback: (fn) => fn,
      };
    }
    throw new Error(`unexpected require: ${id}`);
  });
  assert.equal(provided.name, 'dsh-custom-theme');
  assert.deepEqual([...provided.inject], ['slots', 'locale', 'theme'], 'declares exactly the services it uses');
  assert.equal(typeof provided.apply, 'function');

  // Drive apply() against a recording fake context and confirm the layer it pushes.
  const layers = [];
  const effects = [];
  const registered = [];
  const themeService = { overrideTokens: (sourceId, tokens) => { layers.push({ sourceId, tokens }); return () => {}; } };
  const ctx = {
    effect: (callback) => { effects.push(callback); return () => {}; },
    on: () => () => {},
    get: (name) => (name === 'theme' ? themeService : undefined),
    theme: themeService,
    locale: { register: () => () => {}, bind: () => (key) => key },
    slots: {
      inject: (slot, callback) => {
        registered.push(slot);
        // `inject` takes a disposer or an iterable of them.
        const effect = callback();
        const disposers = typeof effect === 'function' ? [effect] : [...effect];
        assert.ok(disposers.length > 0 && disposers.every(d => typeof d === 'function'));
        return () => {};
      },
      register: () => () => {},
    },
  };
  provided.apply(ctx);
  // Effects are deferred in the real fiber, so run them here in registration order.
  for (const effect of effects) {
    const disposer = effect();
    assert.equal(typeof disposer, 'function', 'every effect returns a cleanup');
  }
  assert.ok(registered.includes('settings.section'), 'registers a settings page');
  assert.ok(!registered.includes('shell.overlay'), 'the tail caret is pure CSS — no slot component');
  // Two stylesheets: the settings-page CSS and the Windows window-drag repair.
  assert.equal(head.length, 2, 'injects the section and window-drag stylesheets');
  assert.ok(head.some(tag => String(tag.dataset.pluginCss).includes('window-drag')),
    'the Windows drag repair has its own stylesheet');
  assert.deepEqual(layers, [], 'nothing is applied without a saved theme');

  // A saved theme is stacked on activation and removed with the plugin.
  store.set('dsh-custom-theme/v1', JSON.stringify({
    css: ':root{--background:#fff;--primary:#c00}\n.dark{--background:#000;--primary:#f66}',
    name: '', enabled: true,
    options: { borders: 'soft', radius: 'fit', fonts: true, statusTint: false, extras: true },
  }));
  layers.length = 0;
  const ctx2 = {
    effect: (callback) => { const disposer = callback(); assert.equal(typeof disposer, 'function'); return disposer; },
    on: () => () => {},
    get: (name) => (name === 'theme' ? themeService : undefined),
    theme: themeService,
    locale: { register: () => () => {}, bind: () => (key) => key },
    slots: {
      inject: (slot, callback) => {
        const effect = callback();
        return typeof effect === 'function' ? effect : [...effect][0];
      },
      register: () => () => {},
    },
  };
  provided.apply(ctx2);
  assert.equal(layers.length, 1, 'one override layer stacked');
  assert.equal(layers[0].sourceId, 'dsh-custom-theme', 'layer identity is the package id');
  assert.ok(Object.keys(layers[0].tokens).length > 10);
  assert.equal(layers[0].tokens['--dsw-alias-bg-base'].light, '#fff');
  assert.equal(layers[0].tokens['--dsw-alias-bg-base'].dark, '#000');
});

// ---------------------------------------------------------------------------
// Settings page
// ---------------------------------------------------------------------------

/**
 * Minimal hooks runtime: enough of React's contract to render the section
 * component as a plain function and drive its handlers.
 */
function makeHooks() {
  const tree = { children: [] };
  const hooks = [];
  let cursor = 0;
  let dirty = false;

  const state = (initial) => {
    const index = cursor++;
    if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial;
    const set = (next) => {
      hooks[index] = typeof next === 'function' ? next(hooks[index]) : next;
      dirty = true;
    };
    return [hooks[index], set];
  };

  const compute = (index, factory, deps) => {
    const previous = hooks[index];
    const changed = previous === undefined
      || deps === undefined
      || deps.length !== previous.deps.length
      || deps.some((dep, at) => !Object.is(dep, previous.deps[at]));
    if (changed) hooks[index] = { deps, value: factory() };
    else hooks[index] = previous;
    return hooks[index].value;
  };

  return {
    tree,
    React: {
      createElement: (type, props, ...children) => {
        const element = { type, props: props ?? {}, children: children.flat(Infinity) };
        tree.children.push(element);
        return element;
      },
      useState: state,
      useCallback: (fn, deps) => {
        const index = cursor++;
        return compute(index, () => fn, deps);
      },
      useMemo: (factory, deps) => {
        const index = cursor++;
        return compute(index, factory, deps);
      },
      useEffect: (effect, deps) => {
        const index = cursor++;
        const key = `effect:${index}`;
        const previous = hooks[index];
        const changed = previous === undefined
          || deps === undefined
          || deps.length !== previous.length
          || deps.some((dep, at) => !Object.is(dep, previous[at]));
        if (changed) {
          hooks[index] = deps ?? [Symbol('always')];
          const cleanup = effect();
          hooks[key] = cleanup;
        }
      },
    },
    /** Render once; reports whether a state update had been requested. */
    render(Component) {
      const pending = dirty;
      cursor = 0;
      dirty = false;
      tree.children.length = 0;
      const result = Component();
      return { result, dirty: pending };
    },
  };
}

test('the settings page applies a themed paste end to end', async () => {
  const source = await read('client.js');
  const modules = new Map();
  const store = new Map();
  const cssText = await fixture('amethyst-haze.oklch.css');
  const hooks = makeHooks();

  const document = {
    createElement: () => ({ dataset: {}, remove() {} }),
    head: { appendChild() {} },
  };
  const localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
  };

  let factory;
  const sandbox = {
    __ModuleLoader__: { load: (definition) => { factory = definition.factory; } },
    document, localStorage,
  };
  const vm = await import('node:vm');
  vm.runInNewContext(source, { window: sandbox, console, document, localStorage });
  assert.equal(typeof factory, 'function');

  const layers = [];
  const themeService = {
    overrideTokens: (sourceId, tokens) => {
      layers.push({ sourceId, tokens });
      return () => { layers.push({ sourceId, removed: true }); };
    },
  };

  let Section;
  const provided = factory((id) => {
    if (id === 'react') return hooks.React;
    throw new Error(`unexpected require: ${id}`);
  });

  provided.apply({
    effect: (callback) => callback(),
    on: () => () => {},
    get: (name) => (name === 'theme' ? themeService : undefined),
    theme: themeService,
    locale: { register: () => () => {}, bind: () => (key) => key },
    slots: {
      inject: (slot, callback) => {
        const original = { name: 'react', export: modules.get('react') };
        const effect = callback();
        const disposers = typeof effect === 'function' ? [effect] : [...effect];
        return () => disposers.forEach(fn => fn());
      },
      register: (options, component) => {
        if (options.name === 'settings.section') Section = component;
        return () => {};
      },
    },
  });
  assert.equal(typeof Section, 'function', 'settings section registered');

  // First render: nothing applied, empty textarea.
  const first = hooks.render(Section);
  assert.ok(first.result.children.length > 0, 'renders a tree');

  // Find the paste textarea and the Apply button by walking the element tree.
  const findAll = (node, predicate, out = []) => {
    if (node === null || typeof node !== 'object') return out;
    if (Array.isArray(node)) {
      for (const child of node) findAll(child, predicate, out);
      return out;
    }
    if (node.type !== undefined && predicate(node)) out.push(node);
    for (const child of node.children ?? []) findAll(child, predicate, out);
    return out;
  };
  const tree = first.result;
  const textarea = findAll(tree, node => node.type === 'textarea')[0];
  assert.ok(textarea !== undefined, 'has a paste box');
  assert.equal(textarea.props.value, '', 'starts empty');

  const applyButton = findAll(tree, node => node.type === 'button'
    && String(node.props.className).includes('cctButtonPrimary'))[0];
  assert.ok(applyButton !== undefined, 'has an apply button');
  assert.equal(applyButton.props.disabled, true, 'apply is disabled while empty');

  // Type the theme, then apply it.
  textarea.props.onChange({ target: { value: cssText } });
  const second = hooks.render(Section);
  assert.equal(second.dirty, true, 'typing re-renders');
  const textarea2 = findAll(second.result, node => node.type === 'textarea')[0];
  const applyButton2 = findAll(second.result, node => node.type === 'button'
    && String(node.props.className).includes('cctButtonPrimary'))[0];
  assert.equal(applyButton2.props.disabled, false, 'apply enables once there is CSS');

  applyButton2.props.onClick();
  assert.ok(layers.length >= 1, 'pushed an override layer');

  const applied = layers.filter(layer => layer.tokens !== undefined);
  assert.equal(applied.length, 1);
  const tokens = applied[0].tokens;
  assert.ok(Object.keys(tokens).length >= 25, `expected a rich mapping, got ${Object.keys(tokens).length}`);
  const amethyst = parseThemeCss(cssText);
  assert.equal(tokens['--dsw-alias-bg-base'].light, amethyst.light.background);
  assert.equal(tokens['--dsw-alias-bg-base'].dark, amethyst.dark.background);
  assert.ok(tokens['--dsw-specific-sidebar-fill'], 'sidebar mapped');
  assert.ok(tokens['--dsw-alias-border-l1'], 'borders mapped');
  for (const [name, modes] of Object.entries(tokens)) {
    assert.match(name, /^--(dsw|ds)/, name);
    assert.equal(typeof modes.light, 'string', name);
    assert.equal(typeof modes.dark, 'string', name);
  }

  // The choice is remembered.
  const saved = JSON.parse(store.get('dsh-custom-theme/v1'));
  assert.equal(saved.enabled, true);
  assert.equal(saved.css, cssText);

  // Third render reflects the applied state and shows the swatch preview.
  const third = hooks.render(Section);
  assert.ok(findAll(third.result, node => String(node.props.className ?? '').includes('cctSwatch')).length > 0,
    'preview swatches render');
  const resetButton = findAll(third.result, node => node.type === 'button'
    && String(node.props.className).includes('cctButtonDanger'))[0];
  assert.equal(resetButton.props.disabled, false, 'reset is available once applied');

  // Reset removes the layer and forgets the theme.
  resetButton.props.onClick();
  assert.ok(layers.some(layer => layer.removed === true), 'layer disposed');
  assert.equal(JSON.parse(store.get('dsh-custom-theme/v1')).enabled, false);
});

test('a preset fills the paste box without applying on its own', async () => {
  const source = await read('client.js');
  const store = new Map();
  const hooks = makeHooks();
  const document = {
    createElement: () => ({ dataset: {}, remove() {} }),
    head: { appendChild() {} },
  };
  const localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
  };
  let factory;
  const sandbox = {
    __ModuleLoader__: { load: (definition) => { factory = definition.factory; } },
    document, localStorage,
  };
  const vm = await import('node:vm');
  vm.runInNewContext(source, { window: sandbox, console, document, localStorage });

  const layers = [];
  const themeService = {
    overrideTokens: (sourceId, tokens) => { layers.push({ sourceId, tokens }); return () => {}; },
  };
  let Section;
  const provided = factory(() => hooks.React);
  provided.apply({
    effect: (callback) => callback(),
    on: () => () => {},
    get: () => themeService,
    theme: themeService,
    locale: { register: () => () => {}, bind: () => (key) => key },
    slots: {
      inject: (slot, callback) => {
        const effect = callback();
        const disposers = typeof effect === 'function' ? [effect] : [...effect];
        return () => disposers.forEach(fn => fn());
      },
      register: (options, component) => {
        if (options.name === 'settings.section') Section = component;
        return () => {};
      },
    },
  });

  const findAll = (node, predicate, out = []) => {
    if (node === null || typeof node !== 'object') return out;
    if (Array.isArray(node)) {
      for (const child of node) findAll(child, predicate, out);
      return out;
    }
    if (node.type !== undefined && predicate(node)) out.push(node);
    for (const child of node.children ?? []) findAll(child, predicate, out);
    return out;
  };

  const tree = hooks.render(Section).result;
  const select = findAll(tree, node => node.type === 'select'
    && node.props?.['data-role'] === 'preset')[0];
  assert.ok(select !== undefined, 'has a preset picker');
  // Count only the options inside the preset picker; the wallpaper card has
  // its own type/fit selects further down the tree.
  const options = findAll(select, node => node.type === 'option');
  assert.equal(options.length, 4, 'placeholder plus three presets');

  select.props.onChange({ target: { value: 'claude' } });
  const after = findAll(hooks.render(Section).result, node => node.type === 'textarea')[0];
  assert.ok(after.props.value.includes('--primary'), 'preset CSS loaded into the box');
  assert.deepEqual(layers, [], 'loading a preset does not apply it');
});

// ---------------------------------------------------------------------------
// Code-review regressions (A–O) and previously uncovered exports
// ---------------------------------------------------------------------------

test('A: fenced / BOM / prose-wrapped JSON is parsed, not treated as CSS', () => {
  const json = '{"cssVars":{"light":{"background":"#fff","primary":"#36f"}}}';
  const cases = [
    '```json\n' + json + '\n```',
    '~~~json\n' + json + '\n~~~',
    '\uFEFF' + json,
    'Here is my theme: ' + json + ' hope it helps',
    'Note: use v4 format.\n' + json + '\nDone.',
  ];
  for (const paste of cases) {
    const parsed = parseThemeInput(paste);
    assert.equal(parsed.source, 'json', JSON.stringify(paste.slice(0, 30)));
    assert.equal(parsed.light.background, '#fff', JSON.stringify(paste.slice(0, 30)));
    assert.ok(parsed.counts.light > 0, 'fenced JSON produced 0 tokens');
  }
  // sanitizePaste itself must strip a fenced JSON block unconditionally.
  assert.equal(sanitizePaste('```json\n{"cssVars":{}}\n```'), '{"cssVars":{}}');
  assert.equal(sanitizePaste('Here: {"cssVars":{}} done'), '{"cssVars":{}}');
  assert.match(sanitizePaste('```css\n:root{--background:#fff;}\n```'), /^:root/);
  // A CSS paste starting with an attribute selector is still CSS, not JSON.
  assert.equal(parseThemeInput('[data-theme="dark"]{--background:#000}').dark.background, '#000');
});

test('B: parseThemeJson accepts every payload shape and skips empty sections', () => {
  const vars = {
    light: { background: '#fff', foreground: '#111', primary: '#36f' },
    dark: { background: '#000', foreground: '#eee', primary: '#8af' },
  };
  const matrix = [
    // An all-empty items[] entry must fall back to the object's own sections.
    { items: [{ cssVars: { light: {}, dark: {} } }], theme: { light: vars.light, dark: vars.dark } },
    // A top-level array of registry items.
    [{ cssVars: vars }],
    // `??` used to pick the empty cssVars and never look at theme.
    { cssVars: {}, theme: { light: vars.light, dark: vars.dark } },
    // A theme wrapper with sibling bare light/dark.
    { theme: { radius: '0.5rem' }, light: vars.light, dark: vars.dark },
    // Plain cssVars and a bare light/dark payload still work.
    { cssVars: vars },
    vars,
  ];
  for (const [index, payload] of matrix.entries()) {
    const parsed = parseThemeJson(payload);
    assert.equal(parsed.light.background, '#fff', `payload ${index} light`);
    assert.equal(parsed.dark.background, '#000', `payload ${index} dark`);
  }
  // A genuinely empty payload gets an accurate warning, not "no cssVars".
  const empty = parseThemeJson({ items: [{ cssVars: { light: {}, dark: {} } }] });
  assert.equal(empty.counts.light, 0);
  assert.ok(empty.warnings.some(w => w.includes('no theme variables')),
    'empty section is reported accurately');
  // The name of the first *usable* item wins over an outer index name.
  assert.equal(parseThemeJson({
    name: 'index', items: [{ name: 'empty', cssVars: { light: {}, dark: {} } },
      { name: 'real', cssVars: vars }],
  }).name, 'real');
});

test('C: malformed numbers never leak NaN into the colour maths', () => {
  assert.equal(luminance('oklch(. 0 0)'), null, 'bare dot is not a number');
  assert.equal(luminance('hsl(. 0% 0%)'), null);
  assert.equal(luminance('rgb(. . .)'), null);
  assert.equal(luminance('oklch(NaN 0 0)'), null);
  // unit() must not clamp NaN into a real colour.
  assert.equal(shiftScheme('oklch(. 0 0)', true), 'oklch(. 0 0)', 'unreadable value is left alone');
  const parsed = { light: { background: 'oklch(. 0 0)', foreground: '#111', primary: '#36f' },
    dark: {}, warnings: [], counts: {}, source: 'css' };
  const derived = deriveCompanion(parsed);
  assert.ok(!/black|white/.test(String(derived.dark.primary)),
    'NaN span must not compress every derived colour to black/white');
  assert.equal(isLightColor('oklch(. 0 0)'), false, 'unknown is not a light colour');
});

test('D: luminance reads color-mix in both parameter orders', () => {
  const step = stepColor('#808080', 10, 'lighter');
  assert.equal(step, 'color-mix(in srgb, #808080, white 10%)');
  assert.ok(luminance(step) > luminance('#808080'), 'stepColor result is measurable');
  assert.ok(Number.isFinite(luminance(step)));
  // Percentage on the FIRST colour (mixWith / tintOverlay shape).
  const first = mixWith('#808080', '#ffffff', 82);
  assert.equal(first, 'color-mix(in srgb, #808080 82%, #ffffff)');
  assert.ok(luminance(first) > luminance('#808080'));
  assert.ok(luminance('color-mix(in srgb, #808080 10%, white)') > 0.9,
    '10% of the dark colour, 90% white');
  assert.ok(luminance('color-mix(in srgb, #808080, white 10%)') < 0.6,
    '90% of the dark colour, 10% white');
});

test('E: negative hue is supported end to end', () => {
  assert.equal(luminance('hsl(-120 50% 40%)') > 0, true);
  assert.ok(Number.isFinite(luminance('hsl(-120 50% 40%)')));
  assert.equal(hue('hsl(-120 50% 40%)'), 240, 'negative hue normalises into 0..360');
  assert.equal(hue('oklch(0.7 0.1 -120)'), 240);
  assert.equal(hue('hsl(120deg 50% 40%)'), 120);
  assert.equal(hue('hsl(360 50% 40%)'), 0);
  assert.equal(hue('#808080'), null, 'unreadable hue is not second-guessed');
  assert.equal(hueMatches('hsl(-120 50% 40%)', 'green'), false, 'blue is not green');
  assert.equal(normalizeValue('-120 50% 40%', 'foreground'), 'hsl(-120 50% 40%)');
});

test('F: 8-digit hex, named colours and hex/rgb near-grey', () => {
  assert.equal(hasAlpha('#ffffffcc'), true);
  assert.equal(isLightColor('#ffffffcc'), true, '8-digit hex is light, not dark');
  assert.ok(luminance('#ffffffcc') > 0.99);
  assert.ok(luminance('#00000080') < 0.01);
  assert.equal(luminance('white'), 1);
  assert.equal(luminance('black'), 0);
  // isNearGrey used to only read oklch/hsl, so #808080 bypassed the guard.
  assert.equal(isNearGrey('#808080'), true);
  assert.equal(isNearGrey('#808080cc'), true, '8-digit hex ignores the alpha nibble');
  assert.equal(isNearGrey('rgb(128 128 128)'), true);
  assert.equal(isNearGrey('#ff0000'), false);
  assert.equal(isNearGrey('rgb(255 0 0)'), false);
  // And an 8-digit-hex light theme keeps its original palette in the light slot.
  const parsed = { light: { background: '#ffffffcc', foreground: '#111', primary: '#36f' },
    dark: {}, warnings: [], counts: {}, source: 'css' };
  assert.equal(deriveCompanion(parsed).light.background, '#ffffffcc');
});

test('G: classifySelector handles attributes, pseudo-classes and descendants', () => {
  const light = [
    ':root[data-theme="light"]', 'html[data-theme="light"]', 'html:not(.dark)',
    ':root:not(:is(.dark))', ':root.light', 'body.light', '[data-theme="light"]',
    ':root:not(.dark, .night)', 'body:not(.dark)', ':root[data-mode="light"]',
  ];
  for (const selector of light) assert.equal(classifySelector(selector), 'light', selector);
  for (const selector of ['.theme-dark', '.dark-theme', ':is(.dark)', 'html.dark']) {
    assert.equal(classifySelector(selector), 'dark', selector);
  }
  // Misclassifications from the review: a descendant rule is never a palette,
  // and a mixed selector list must not emit just one scheme.
  assert.equal(classifySelector('[data-theme="dark"] body'), null);
  assert.equal(classifySelector(':root, .dark .card'), null);
  assert.equal(classifySelector('.dark .card'), null);
  assert.equal(classifySelector(':root .dark'), null);
  // A grouped both-schemes selector still resolves to 'both'.
  assert.equal(classifySelector(':root, .dark'), 'both');
  assert.equal(classifySelector(':root, :host'), 'light');
});

test('H: single-scheme detection and tri-state companion direction', () => {
  // Seven identical variables: the old `compared >= 8` gate said "two schemes".
  const seven = {};
  for (const k of ['background', 'foreground', 'card', 'primary', 'muted', 'border', 'ring']) seven[k] = '#fff';
  assert.equal(isSingleScheme(seven, { ...seven }), true);
  // Ten variables with one perceptually identical value: still one scheme.
  const ten = {};
  for (let i = 0; i < 10; i += 1) ten[`chart-${i}`] = '#fff';
  const near = { ...ten, 'chart-1': '#feffff' };
  assert.equal(isSingleScheme(ten, near), true);
  // Ten variables with one REAL difference: two schemes.
  assert.equal(isSingleScheme(ten, { ...ten, 'chart-1': '#fe0000' }), false);

  // An unreadable background (var / 8-digit hex / NaN) must not be treated as
  // dark. The original light palette stays in `light`.
  for (const background of ['var(--page)', '#ffffffcc', 'oklch(. 0 0)']) {
    const parsed = { light: { background, foreground: '#111', primary: '#36f' },
      dark: {}, warnings: [], counts: {}, source: 'css' };
    assert.equal(deriveCompanion(parsed).light.background, background,
      `${background} must not flip the theme to dark`);
  }
  // A genuinely dark readable background keeps the original in `dark`.
  const darkBase = { light: { background: '#101014', foreground: '#eee', primary: '#8af' },
    dark: {}, warnings: [], counts: {}, source: 'css' };
  assert.equal(deriveCompanion(darkBase).dark.background, '#101014');
});

test('I: self-referential var() aliases are dropped with a warning', () => {
  for (const value of ['var(--background)', 'var(--background, #fff)', 'var( --background , #fff )']) {
    const parsed = parseThemeCss(`:root{--background:${value}}`);
    assert.equal(parsed.light.background, undefined, value);
    assert.ok(parsed.warnings.some(w => w.includes('dropped')), 'the drop is reported');
  }
  // A legitimate alias to a DIFFERENT variable is kept.
  assert.equal(parseThemeCss(':root{--background:var(--page)}').light.background, 'var(--page)');
  assert.equal(normalizeValue('var(--primary)', 'background'), 'var(--primary)');
  assert.equal(normalizeValue('var(--background)', 'background'), null);
});

test('J: nested at-rule declarations do not overwrite the outer block', () => {
  const parsed = parseThemeCss(
    ':root{--background:#fff;@media (prefers-color-scheme:dark){--background:#000;--primary:#f66;}}');
  assert.equal(parsed.light.background, '#fff', 'the media query must not overwrite light');
  assert.equal(parsed.dark.background, undefined, 'a bare nested declaration is not a palette block');
  // A properly nested :root inside the media query becomes the dark palette.
  const proper = parseThemeCss(
    ':root{--background:#fff;@media (prefers-color-scheme:dark){:root{--background:#000;--primary:#f66;}}}');
  assert.equal(proper.light.background, '#fff');
  assert.equal(proper.dark.background, '#000');
  assert.equal(proper.dark.primary, '#f66');
});

test('K: a non-inline @theme block supplies real values', () => {
  const parsed = parseThemeCss('@theme{--background:#fff;--radius:0.5rem}');
  assert.equal(parsed.light.background, '#fff');
  assert.equal(parsed.shared.radius, '0.5rem');
  assert.ok(parsed.counts.light > 0, '@theme was not silently dropped');
  // @theme inline still only salvages literal font stacks, not aliases.
  const inline = parseThemeCss(
    '@theme inline{--color-background:var(--background);--font-sans:Inter, sans-serif;}');
  assert.equal(inline.light['color-background'], undefined);
  assert.equal(inline.shared['font-sans'], 'Inter, sans-serif');
});

test('L: normalizeValue wraps only well-formed triplets, stripping deg', () => {
  // A malformed number must not produce `hsl(1..2 50% 40%)`.
  assert.equal(normalizeValue('1..2 50% 40%', 'background'), '1..2 50% 40%');
  assert.equal(normalizeValue('. 50% 40%', 'background'), '. 50% 40%');
  assert.equal(normalizeValue('120deg 50% 40%', 'background'), 'hsl(120 50% 40%)');
  assert.equal(normalizeValue('-120deg 50% 40%', 'background'), 'hsl(-120 50% 40%)');
  assert.equal(normalizeValue('221.5 83.2% 53.1%', 'primary'), 'hsl(221.5 83.2% 53.1%)');
  assert.equal(normalizeValue('5.9000% 12.3456% 98.0000%', 'background'),
    '5.9000% 12.3456% 98.0000%');
});

test('M: safety blacklist, percent clamping, and the fillFrom null branch', () => {
  for (const bad of ['attr(data-x)', 'local(Fira)', '@charset "UTF-8"',
    '@font-face { }', '-webkit-image-set(url(x) 1x)', 'url (foo)', 'URL\n(foo)']) {
    assert.equal(isSafeValue(bad), false, `should reject: ${bad}`);
  }
  assert.equal(isSafeValue('color-mix(in srgb, #fff 45%, transparent)'), true);
  // NaN / undefined percentages must never reach CSS.
  assert.equal(tintOverlay('#fff', NaN), 'color-mix(in srgb, #fff 0%, transparent)');
  assert.equal(tintOverlay('#fff', undefined), 'color-mix(in srgb, #fff 0%, transparent)');
  assert.equal(softenBorder('#fff', NaN), 'color-mix(in srgb, #fff 0%, transparent)');
  assert.match(softenBorder('#fff', 45), /45%/);
  assert.equal(tintOverlay(null, 8), null);
  assert.equal(softenBorder('', 8), null);
  // fillFrom with a missing foreground falls back to the candidate instead of
  // emitting `color-mix(in srgb, null 6%, …)` (dead-code branch in the old code).
  assert.equal(fillFrom('#fafafa', '#18181b', null, 6), '#fafafa');
  assert.equal(fillFrom('#fafafa', '#18181b', undefined, 6), '#fafafa');
  assert.match(fillFrom('#fafafa', '#18181b', '#fafafa', 6), /^color-mix\(/);
  assert.equal(fillFrom(null, '#18181b', '#fafafa'), null);
});

test('O: describeOverrides and buildOverrides never leak NaN/undefined', () => {
  const rows = describeOverrides({
    '--bad-num': { light: NaN, dark: '#000' },
    '--bad-undef': { light: '#fff', dark: undefined },
    '--bad-text': { light: 'NaN%', dark: 'ok(undefined)' },
    '--bad-type': { light: 42, dark: {} },
    '--good': { light: '#fff', dark: '#000' },
  });
  assert.deepEqual(rows, [{ name: '--good', light: '#fff', dark: '#000' }]);
  assert.deepEqual(describeOverrides(null), []);
  assert.deepEqual(describeOverrides({ '--x': null }), []);
  // buildOverrides' export is a second line of defence.
  const parsed = { light: { background: '#fff', foreground: '#111', primary: '#36f' },
    dark: { background: '#000', foreground: '#eee', primary: '#8af' },
    shared: {}, warnings: [], counts: {}, source: 'css' };
  for (const modes of Object.values(buildOverrides(parsed, {}).tokens)) {
    assert.equal(typeof modes.light, 'string');
    assert.equal(typeof modes.dark, 'string');
    assert.doesNotMatch(modes.light + modes.dark, /NaN|undefined|\[object Object\]/);
  }
});

test('shiftScheme, hue, tintOverlay, describeOverrides and sanitizePaste exports', () => {
  // shiftScheme: ink and surfaces move in opposite directions.
  const surface = shiftScheme('#fafafa', true, false, { min: 0.9, max: 1 });
  assert.match(surface, /^color-mix\(/);
  assert.ok(luminance(surface) < luminance('#fafafa'), 'surface darkens toward dark');
  const ink = shiftScheme('#111', true, true, { min: 0, max: 1 });
  assert.ok(luminance(ink) > luminance('#111'), 'ink brightens toward dark');
  assert.equal(shiftScheme('var(--x)', true), 'var(--x)', 'unreadable value is left alone');
  assert.match(shiftScheme('#808080', false), /white|black/);

  // hue: covered above; here the family gate with a readable hue too.
  assert.equal(hueMatches('oklch(0.73 0.07 169.9)', 'green'), true);
  assert.ok(Math.abs(hue('oklch(0.73 0.07 169.9)') - 169.9) < 1e-6);
  assert.equal(hue(null), null);

  // tintOverlay / softenBorder share the same shape and respect alpha.
  assert.equal(tintOverlay('#fff', 40), 'color-mix(in srgb, #fff 40%, transparent)');
  assert.equal(tintOverlay('#11223380', 40), '#11223380', 'already alpha: untouched');
  assert.equal(softenBorder('#112233', 45), 'color-mix(in srgb, #112233 45%, transparent)');

  // describeOverrides output shape.
  assert.deepEqual(describeOverrides({ '--t': { light: 'a', dark: 'b' } }),
    [{ name: '--t', light: 'a', dark: 'b' }]);

  // sanitizePaste keeps real CSS intact and strips wrappers.
  const css = ':root{--background:#fff;}';
  assert.equal(sanitizePaste(css), css);
  assert.equal(sanitizePaste('\uFEFF' + css), css);
  assert.equal(sanitizePaste('```css\n' + css + '\n```'), css + '\n');
  assert.equal(sanitizePaste('Here is my theme:\n' + css), css);
  assert.equal(sanitizePaste(null), '');
  assert.equal(sanitizePaste(undefined), '');
  assert.equal(sanitizePaste(42), '');
});

test('staticRamps emits all 38 shipped stops, each as a {light, dark} pair', async () => {
  const parsed = parseThemeCss(await fixture('t3-chat.oklch.css'));
  const ramps = staticRamps(parsed);
  const names = Object.keys(ramps);
  assert.equal(names.length, 38, '16 neutral + 22 neutral-bluish stops');

  // Compare the stop names with the shipped stylesheet itself.
  const bundle = await read(join('tests', 'fixtures', 'dsh-token-defs.txt'));
  const shipped = new Set([...bundle.matchAll(/--dsw-static-(neutral(?:-bluish)?)-(\d+)\s*:/g)]
    .map(m => `--dsw-static-${m[1]}-${m[2]}`));
  assert.deepEqual(names.slice().sort(), [...shipped].sort(), 'stop names match the shipped ramp');
  for (const [name, modes] of Object.entries(ramps)) {
    assert.equal(typeof modes.light, 'string', `${name}.light`);
    assert.equal(typeof modes.dark, 'string', `${name}.dark`);
    assert.notEqual(modes.light, '');
    assert.notEqual(modes.dark, '');
  }
  // Empty input yields no ramps rather than a half-built ladder.
  assert.deepEqual(staticRamps({ light: {}, dark: {} }), {});
});
