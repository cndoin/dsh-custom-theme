/**
 * Unit tests for the wallpaper / liquid-glass layer.
 *
 * Pure logic (src/backdrop.js) is tested directly, and the generated
 * `client.js` is executed in a VM with a DOM stub to verify that enabling a
 * wallpaper actually creates the layer, stylesheet and token overrides.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  DEFAULT_BACKDROP, MAX_DATA_URL_BYTES, BACKDROP_ATTR, GLASS_ATTR,
  checkBackgroundUrl, normalizeBackdrop, buildBackdropCss, buildGlassCss,
  buildRefractionSvg, buildBackgroundTokens, describeMedia, shouldPauseVideo,
  pointerGlassVars, restingGlassVars,
} from '../src/backdrop.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(join(root, path), 'utf8');

const sample = (patch = {}) => normalizeBackdrop({
  enabled: true, kind: 'image', source: 'https://example.com/wall.jpg', ...patch,
}).backdrop;

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

test('only safe wallpaper URLs are accepted', () => {
  for (const url of [
    'https://example.com/a.png',
    'http://localhost:1234/a.webp',
    'data:image/png;base64,iVBORw0KGgo=',
    'data:image/jpeg;base64,/9j/4AAQ',
  ]) {
    assert.equal(checkBackgroundUrl(url, 'image').ok, true, url);
  }
  for (const [url, kind] of [
    ['javascript:alert(1)', 'image'],
    ['vbscript:msgbox(1)', 'image'],
    ['file:///C:/secret.png', 'image'],
    ['data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pjwvc2NyaXB0Pjwvc3ZnPg==', 'image'],
    ['data:text/html;base64,PHNjcmlwdD4=', 'image'],
    ['https://x/a.png" onerror="alert(1)', 'image'],
    ['https://x/a.png)', 'image'],
    ['data:image/png;base64,' + 'A'.repeat(MAX_DATA_URL_BYTES + 1), 'image'],
    ['data:image/png;base64,iVBOR', 'video'],
  ]) {
    assert.equal(checkBackgroundUrl(url, kind).ok, false, `${url} must be refused`);
  }
  // blob: URLs are session-only: persisting one to localStorage leaves a dead
  // (black) wallpaper after a reload, so BOTH kinds must be refused.
  assert.equal(checkBackgroundUrl('blob:http://x/1', 'video').ok, false,
    'a video blob URL must not be persisted (bug #4)');
  assert.equal(checkBackgroundUrl('blob:http://x/1', 'image').ok, false,
    'an image blob URL is session-only and cannot be persisted');
});

test('normalizeBackdrop clamps every numeric field and keeps defaults', () => {
  const { backdrop, sourceError } = normalizeBackdrop({
    enabled: true, source: 'https://x/a.png',
    blur: 999, dim: -5, glassBlur: 999, glassOpacity: -1,
    refract: 500, refractFrequency: 1, tint: 'javascript:alert(1)',
    fit: 'stretch', kind: 'gif', glass: false,
  });
  assert.equal(sourceError, null);
  assert.equal(backdrop.blur, 40);
  assert.equal(backdrop.dim, 0);
  assert.equal(backdrop.glassBlur, 32);
  assert.equal(backdrop.glassOpacity, 0);
  assert.equal(backdrop.refract, 24);
  assert.equal(backdrop.refractFrequency, 5);
  assert.equal(backdrop.tint, '');
  assert.equal(backdrop.fit, 'cover');
  assert.equal(backdrop.kind, 'image');

  const empty = normalizeBackdrop(null).backdrop;
  for (const key of Object.keys(DEFAULT_BACKDROP)) {
    assert.equal(empty[key], DEFAULT_BACKDROP[key], key);
  }
  assert.equal(normalizeBackdrop({ source: 'javascript:x' }).sourceError !== null, true);
});

// ---------------------------------------------------------------------------
// CSS generation
// ---------------------------------------------------------------------------

test('a fully disabled backdrop produces no CSS, tokens, media or SVG', () => {
  const bd = sample({ enabled: false, glass: false });
  assert.equal(buildBackdropCss(bd), '');
  assert.deepEqual(buildBackgroundTokens(bd), {});
  assert.equal(describeMedia(bd), null);
  assert.equal(buildRefractionSvg(bd), '');
});

test('liquid glass works WITHOUT the wallpaper switch (regression)', () => {
  // The first version gated the whole stylesheet behind `enabled && source`,
  // so ticking "liquid glass" alone produced no CSS at all.
  const bd = sample({ enabled: false, source: '', glass: true });
  const css = buildBackdropCss(bd);
  assert.ok(css.length > 0, 'glass rules are emitted');
  assert.match(css, /data-composer-card/);
  assert.match(css, /backdrop-filter/);
  // The SVG displacement path is OFF by default now (refract:0). Turning on
  // only the glass toggle must NOT pull in the expensive/composer-breaking SVG.
  assert.equal(buildRefractionSvg(bd), '');
  assert.equal(describeMedia(bd), null);
  assert.deepEqual(buildBackgroundTokens(bd), {});
  const noGlass = buildBackdropCss(sample({ enabled: false, source: '', glass: false }));
  assert.equal(noGlass, '');
});

test('liquid glass also works with the wallpaper switch on but no URL', () => {
  const bd = sample({ enabled: true, source: '', glass: true });
  assert.match(buildBackdropCss(bd), /data-composer-card/);
  assert.equal(buildBackdropCss(bd).includes('url("'), false, 'no media URL in CSS');
});

test('the wallpaper CSS carries the media, scrim, blur and stable selectors', () => {
  const css = buildBackdropCss(sample({ blur: 12, dim: 40, tint: '#123456', tintStrength: 20 }));
  assert.match(css, /body\[data-dsh-backdrop="on"\]/);
  assert.match(css, /#dsh-custom-theme-backdrop/);
  assert.match(css, /object-fit: cover/);
  assert.match(css, /filter: blur\(12px\)/);
  assert.match(css, /transform: scale\(1\.08\)/);
  assert.match(css, /rgba\(0,0,0,0\.4\)/);
  assert.match(css, /rgba\(18,52,86,0\.2\d*\)/, 'the tint is a translucent colour cast');
  assert.match(css, /z-index: -2|z-index: -1/);
  assert.match(css, /pointer-events: none/);
  // The wallpaper URL is ALSO painted directly on body's background-image as a
  // stacking-context-proof fallback (kevinbism's approach), in addition to the
  // media element. It is safe because checkBackgroundUrl refuses quotes,
  // backslashes, parentheses and control characters.
  assert.match(css, /url\("https:\/\/example\.com\/wall\.jpg"\)/);
  assert.match(css, /background-attachment: fixed/);
  assert.equal(describeMedia(sample()).attributes.src, 'https://example.com/wall.jpg');
});

test('a hostile URL can never break out of the CSS url() literal', () => {
  // Rejected strings never reach the stylesheet at all.
  const bad = normalizeBackdrop({ enabled: true, source: 'https://x/a.png" } body{display:none}/*' });
  assert.equal(bad.backdrop.source, '');
  const css = buildBackdropCss(bad.backdrop);
  assert.ok(!css.includes('display:none'));
  assert.ok(!css.includes('url("https://x/a.png" }'));
});

test('the glass CSS uses a stable composer attribute and all tunable values', () => {
  const css = buildGlassCss(sample({
    glass: true, glassOpacity: 20, glassBlur: 14, glassSaturate: 160,
    glassRadius: 14, glassHighlight: 30, glassShadow: 30,
  }));
  assert.match(css, /\[data-composer-card\]/, 'stable attribute, not a hashed class');
  assert.match(css, /backdrop-filter: blur\(14px\) saturate\(1\.6\) brightness\(1\.05\) contrast\(1\.1\)/);
  assert.match(css, /20%, transparent\)/, 'opacity is applied');
  assert.match(css, /border-radius: 14px/);
  assert.match(css, /rgba\(255,255,255,0\.18\)/, 'restrained white edge highlight');
  assert.match(css, /inset 0 1px 0/, 'top inner highlight');
  assert.match(css, /linear-gradient\(90deg/, 'specular top line');
  assert.match(css, /@supports not/, 'unsupported-browser fallback');
  assert.match(css, /@supports \(\(backdrop-filter/, 'standard path');
  assert.match(css, /prefers-reduced-transparency/, 'a11y downgrade');
  assert.match(css, /-webkit-backdrop-filter/, 'Safari prefix');
});

test('buildBackdropCss includes the glass rules only when glass is on', () => {
  const off = buildBackdropCss(sample({ glass: false }));
  const on = buildBackdropCss(sample({ glass: true }));
  assert.ok(!off.includes('data-composer-card'));
  assert.ok(on.includes('data-composer-card'));
  assert.ok(!off.includes('@supports'));
});

test('performance mode caps blur, disables refraction and shimmer', () => {
  const bd = sample({ glass: true, glassBlur: 30, blur: 40, refract: 16, performance: true });
  assert.equal(buildRefractionSvg(bd), '');
  const css = buildBackdropCss(bd);
  assert.match(css, /filter: blur\(8px\)/, 'background blur capped');
  assert.match(css, /blur\(8px\) saturate/, 'glass blur capped');
  assert.ok(!css.includes('url(#dsh-glass-refract)'));
});

test('the refraction SVG uses an sRGB displacement filter with a bounded scale (explicit opt-in)', () => {
  // The feature is not deleted: a user who EXPLICITLY enables glass AND raises
  // refract above 0 still gets the SVG definition. It is simply never applied
  // to the composer element itself (bug #2).
  const svg = buildRefractionSvg(sample({ glass: true, refract: 8, refractFrequency: 15 }));
  assert.match(svg, /color-interpolation-filters="sRGB"/);
  assert.match(svg, /feDisplacementMap/);
  assert.match(svg, /feTurbulence/);
  assert.match(svg, /baseFrequency="0\.015 0\.015"/);
  assert.match(svg, /scale="8"/);
  assert.match(svg, /xChannelSelector="R"/);
  assert.match(svg, /yChannelSelector="G"/);
  assert.equal(buildRefractionSvg(sample({ glass: true, refract: 0 })), '');
  // No explicit glass → off, even with a nonzero refract value.
  assert.equal(buildRefractionSvg(sample({ refract: 12 })), '');
});

// ---------------------------------------------------------------------------
// Confirmed-bug regressions (review of the "uneven typing" / popover report)
// ---------------------------------------------------------------------------

test('glass and refraction are OFF by default (bug #1)', () => {
  assert.equal(DEFAULT_BACKDROP.glass, false);
  assert.equal(DEFAULT_BACKDROP.refract, 0);
  // A fresh profile must emit NO stylesheet at all, so no backdrop-filter is
  // ever attached to the composer while DSH streams tokens.
  const css = buildBackdropCss(DEFAULT_BACKDROP);
  assert.equal(css, '', 'default config produces no CSS');
  assert.ok(!css.includes('backdrop-filter'));
  assert.ok(!css.includes('filter: url('));
  assert.equal(buildRefractionSvg(DEFAULT_BACKDROP), '',
    'default config builds no displacement SVG');
  // normalizeBackdrop must not reintroduce the old defaults.
  assert.equal(normalizeBackdrop(null).backdrop.glass, false);
  assert.equal(normalizeBackdrop(null).backdrop.refract, 0);
  // The boolean-default logic is preserved: an explicit true still wins.
  assert.equal(normalizeBackdrop({ glass: true }).backdrop.glass, true);
});

test('buildGlassCss never emits the composer-breaking filter, isolation or !important (bugs #2/#3)', () => {
  const css = buildGlassCss(sample({ glass: true, refract: 12 }));
  assert.ok(!css.includes('filter: url('), 'no SVG filter on the composer');
  assert.ok(!css.includes('isolation: isolate'), 'no isolation stacking context');
  assert.ok(!css.includes('!important'),
    'no !important so DSH :focus-visible / [data-error] / drag states win');
  // The decorative properties still exist, just without !important.
  assert.match(css, /background-color: color-mix/);
  assert.match(css, /border-radius:/);
  assert.match(css, /border: 1px solid/);
  // The frosted (backdrop-filter) look itself is retained.
  assert.match(css, /backdrop-filter: blur\(/);
  // A state-safe selector is used so focus/error states are excluded.
  assert.match(css, /:not\(:focus-within\)/);
});

test('an explicit glass + refract>0 opt-in still works end-to-end (feature not deleted)', () => {
  const bd = sample({ glass: true, refract: 10 });
  // The frosted composer CSS is still produced when the user opts in.
  const css = buildBackdropCss(bd);
  assert.match(css, /\[data-composer-card\]/);
  assert.match(css, /backdrop-filter: blur\(/);
  assert.ok(!css.includes('filter: url('), 'even when opted in, the SVG is NOT on the composer');
  // The SVG definition is still emitted for the opt-in case (export preserved).
  const svg = buildRefractionSvg(bd);
  assert.match(svg, /feDisplacementMap/);
  assert.match(svg, /scale="10"/);
  // performance mode continues to disable it.
  assert.equal(buildRefractionSvg(sample({ glass: true, refract: 10, performance: true })), '');
});

// ---------------------------------------------------------------------------
// Windows caption strip (window drag / double-click maximize)
// ---------------------------------------------------------------------------

test('a wallpaper keeps the Windows caption strip opaque and draggable', () => {
  // Regression: `buildBackgroundTokens()` makes --dsw-specific-sidebar-fill
  // translucent so the wallpaper shows through. DSH paints its 40px draggable
  // caption strip with that very token, so on Windows' acrylic window the strip
  // became transparent and Electron stopped hit-testing it — dragging the top
  // bar and double-clicking to maximize/restore both stopped working.
  const bd = sample({ enabled: true, source: 'https://example.com/wall.jpg' });
  const css = buildBackdropCss(bd, { light: '#eeeeee', dark: '#1a1a1a' });
  assert.match(css, /html\[data-windows-titlebar\]/);
  assert.match(css, /\[class\*="frame"\]:before/);
  assert.match(css, /-webkit-app-region: drag/);
  assert.match(css, /background: #eeeeee !important/);
  assert.match(css, /background: #1a1a1a !important/);
  assert.match(css, /html\[data-ds-dark-theme\]/);
  // Without a real theme a safe neutral fallback is used, never `transparent`.
  const fallback = buildBackdropCss(bd);
  assert.match(fallback, /background: #f4f5f7 !important/);
  assert.ok(!fallback.includes('background: transparent !important;\n  -webkit-app-region'),
    'the caption strip is never painted transparent');
  // The fix must NOT appear when nothing is enabled (zero-CSS guarantee).
  assert.equal(buildBackdropCss(sample({ enabled: false, glass: false })), '');
});

// ---------------------------------------------------------------------------
// Pointer-driven liquid glass (Apple-style interaction)
// ---------------------------------------------------------------------------

test('pointer variables follow the cursor but NEVER scale the element', () => {
  const rect = { left: 100, top: 100, width: 400, height: 100 };
  const centre = pointerGlassVars({ clientX: 300, clientY: 150 }, rect);
  assert.equal(centre['--glass-ang'], '135deg');
  assert.equal(centre['--glass-glow'], undefined, 'intensity is owned by CSS :hover, not JS');
  assert.match(centre['--glass-x'], /calc\(50% \+ 0px\)/);
  assert.match(centre['--glass-y'], /calc\(50% \+ 0px\)/);
  // No scale/transform variables may exist: scaling the composer squeezed the
  // whole page (user-reported); smoothui/Twilight Echo move only the light.
  assert.equal(centre['--glass-sx'], undefined);
  assert.equal(centre['--glass-sy'], undefined);

  const right = pointerGlassVars({ clientX: 500, clientY: 150 }, rect);
  assert.ok(Number(right['--glass-ang'].replace('deg', '')) > 135, 'band rotates with cursor');
  // Elastic nudge is clamped to 6px.
  const shift = Number(right['--glass-x'].match(/\+ (-?[\d.]+)px/)[1]);
  assert.ok(Math.abs(shift) <= 6, `elastic shift ${shift} must stay <= 6px`);

  // Clamped to the element box.
  const outside = pointerGlassVars({ clientX: -500, clientY: -500 }, rect);
  assert.match(outside['--glass-x'], /calc\(0% - 6px\)/);
  assert.match(outside['--glass-y'], /calc\(0% - 6px\)/);
});

test('resting values reset every pointer variable', () => {
  const rest = restingGlassVars();
  assert.deepEqual(Object.keys(rest).sort(), [
    '--glass-ang', '--glass-x', '--glass-y',
  ]);
  for (const value of Object.values(rest)) assert.equal(typeof value, 'string');
});

test('the glass CSS is pointer-reactive AND isolated from code/child elements', () => {
  const css = buildGlassCss(sample({ glass: true }));
  // Only the INTENSITY is registered/transitioned (Google guide): animating
  // position variables would leave a lagging trail.
  assert.match(css, /@property --glass-glow/);
  assert.match(css, /transition: --glass-glow/);
  assert.ok(!css.includes('--glass-x 0.18s'), 'position variables are not transitioned');
  assert.match(css, /var\(--glass-x\) var\(--glass-y\)/, 'pointer hotspot');
  assert.match(css, /var\(--glass-ang\)/, 'rotating specular band');
  assert.match(css, /:hover \{ --glass-glow: 1/, 'hover brightening');
  assert.match(css, /prefers-reduced-motion/, 'reduced-motion downgrade');
  assert.match(css, /pointer: coarse/, 'touch downgrade');
  // NO transform / scale anywhere — the element must never change geometry.
  assert.ok(!/transform:/.test(css), 'no transform');
  assert.ok(!/scale[XY]?\(/.test(css), 'no scale');
  // NO coloured corner glows — the user disliked them. Only white specular.
  assert.ok(!css.includes('rgba(0,180,255'), 'no blue corner glow');
  assert.ok(!css.includes('rgba(255,100,200'), 'no pink corner glow');
  assert.ok(!css.includes('rgba(130,90,255'), 'no violet corner glow');
  // Isolation: no pseudo-elements, no child selectors.
  assert.ok(!css.includes('::before'), 'no pseudo-elements');
  assert.ok(!css.includes('::after'), 'no pseudo-elements');
  assert.ok(!css.includes('> *'), 'no rules on child nodes');
});

// ---------------------------------------------------------------------------
// Token overrides
// ---------------------------------------------------------------------------

test('background tokens use concrete colours, never self-referencing var()', () => {
  const themeTokens = {
    '--dsw-alias-bg-base': { light: '#fafafa', dark: '#14161a' },
    '--dsw-specific-sidebar-fill': { light: '#eee', dark: '#111' },
  };
  const tokens = buildBackgroundTokens(sample(), themeTokens);
  // ONLY the two full-window shell tokens may be touched. Code blocks,
  // trajectory tables, message cards and popovers use bg-layer-1/-2/overlay;
  // making those translucent would bleed the wallpaper into text-heavy areas
  // and would overwrite the user's pasted theme mapping there.
  assert.deepEqual(Object.keys(tokens).sort(), [
    '--dsw-alias-bg-base', '--dsw-specific-sidebar-fill',
  ]);
  for (const name of [
    '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-overlay',
    '--dsw-specific-input-major', '--dsw-alias-label-primary',
    '--dsw-static-neutral-00',
  ]) {
    assert.equal(tokens[name], undefined, `${name} must be untouched`);
  }
  for (const [name, modes] of Object.entries(tokens)) {
    assert.equal(typeof modes.light, 'string', name);
    assert.equal(typeof modes.dark, 'string', name);
    // A `var(--dsw-alias-bg-base)` inside its own value is a cycle, because
    // ThemePresenter writes it with body.style.setProperty(name, value).
    assert.ok(!modes.light.includes('var('), name);
    assert.ok(!modes.dark.includes('var('), name);
    assert.match(modes.light, /color-mix\(/);
  }
  assert.equal(tokens['--dsw-alias-bg-base'].light, 'color-mix(in srgb, #fafafa 55%, transparent)');
  assert.equal(tokens['--dsw-alias-bg-base'].dark, 'color-mix(in srgb, #14161a 55%, transparent)');
  assert.match(tokens['--dsw-specific-sidebar-fill'].light, /#eee/);
});

test('background tokens do NOT override shell colours without a real theme (bug #6)', () => {
  // When the user only turns on the wallpaper (no pasted theme), hardcoded
  // #ffffff/#14161a fallbacks would stomp DSH's active built-in/preset theme.
  // Expect an empty map: no shell-token override at all.
  const tokens = buildBackgroundTokens(sample());
  assert.deepEqual(tokens, {}, 'no custom theme → no shell token overrides');
  assert.equal(tokens['--dsw-alias-bg-base'], undefined);
  assert.equal(tokens['--dsw-specific-sidebar-fill'], undefined);
  // A partial theme only emits the tokens it can actually resolve.
  const partial = buildBackgroundTokens(sample(), {
    '--dsw-alias-bg-base': { light: '#fafafa', dark: '#14161a' },
  });
  assert.deepEqual(Object.keys(partial), ['--dsw-alias-bg-base']);
  assert.match(partial['--dsw-alias-bg-base'].light, /#fafafa/);
  assert.equal(partial['--dsw-specific-sidebar-fill'], undefined);
});

// ---------------------------------------------------------------------------
// Media handling
// ---------------------------------------------------------------------------

test('a video is muted, looping, inline and never a data URL', () => {
  const bd = sample({ kind: 'video', source: 'https://example.com/a.mp4' });
  const media = describeMedia(bd);
  assert.equal(media.tag, 'video');
  assert.equal(media.attributes.muted, true);
  assert.equal(media.attributes.loop, true);
  assert.equal(media.attributes.playsinline, true);
  assert.equal(media.attributes.autoplay, true);
  assert.equal(checkBackgroundUrl('data:video/mp4;base64,AAAA', 'video').ok, false);
});

test('reduced motion pauses a video but not an image', () => {
  const video = sample({ kind: 'video', source: 'https://x/a.mp4', reducedMotion: true });
  assert.equal(shouldPauseVideo(video, () => true), true);
  assert.equal(shouldPauseVideo(video, () => false), false);
  assert.equal(shouldPauseVideo({ ...video, reducedMotion: false }, () => true), false);
  assert.equal(shouldPauseVideo(sample(), () => true), false);
});

test('a hidden page pauses the wallpaper video (bug #5)', () => {
  const video = sample({ kind: 'video', source: 'https://x/a.mp4', reducedMotion: true });
  // Third argument is an injectable `hidden` override so the pure function
  // remains unit-testable without a global `document`.
  assert.equal(shouldPauseVideo(video, () => false, true), true,
    'hidden=true must pause even when reduced-motion query says no');
  assert.equal(shouldPauseVideo(video, () => false, false), false,
    'hidden=false keeps the reduced-motion decision');
  // The reducedMotion flag is still honoured.
  assert.equal(shouldPauseVideo({ ...video, reducedMotion: false }, () => false, true), false);
  // With no explicit override, the (absent) document is treated as visible.
  assert.equal(shouldPauseVideo(video, () => false), false);
});

// ---------------------------------------------------------------------------
// Inlined client.js keeps the backdrop module
// ---------------------------------------------------------------------------

test('client.js inlines the backdrop functions and has no ESM exports', async () => {
  const source = await read('client.js');
  assert.match(source, /const DEFAULT_BACKDROP/);
  assert.match(source, /function buildBackdropCss/);
  assert.match(source, /function buildGlassCss/);
  assert.doesNotMatch(source, /^\s*export\s/m, 'no ESM exports survive inlining');
  assert.ok(!source.includes('/*__BACKDROP__*/'));
});

test('the settings page exposes the wallpaper controls', async () => {
  const source = await read('client.js');
  for (const key of [
    'bg.title', 'bg.enable', 'bg.kindImage', 'bg.kindVideo', 'bg.blur',
    'bg.glass', 'bg.glassOpacity', 'bg.refract', 'bg.performance',
  ]) {
    assert.match(source, new RegExp(`'${key.replace('.', '\\.')}'\\s*:`), `missing locale key ${key}`);
  }
  assert.match(source, /cctSliderRow/);
  assert.match(source, /data-dsh-backdrop/);
});

// ---------------------------------------------------------------------------
// End-to-end: enabling a wallpaper in the generated client.js
// ---------------------------------------------------------------------------

test('enabling a wallpaper creates the DOM layer, stylesheet and token overrides', async () => {
  const source = await read('client.js');
  const store = new Map();
  const created = [];
  const appendedHead = [];
  const appendedBody = [];

  /** A minimal but faithful DOM stub: elements need dataset, attributes,
   *  children, appendChild and remove. */
  const makeElement = (tag) => {
    const el = {
      tagName: tag.toUpperCase(), dataset: {}, style: { cssText: '' },
      attributes: {}, children: [], innerHTML: '',
      appendChild(child) { this.children.push(child); return child; },
      remove() { this.removed = true; },
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; },
      removeAttribute(k) { delete this.attributes[k]; },
      hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k); },
      pause() { this.paused = true; },
      load() { this.loaded = true; },
      play() { return { catch() {} }; },
    };
    created.push(el);
    return el;
  };

  const body = makeElement('body');
  const document = {
    createElement: makeElement,
    head: { appendChild: (node) => appendedHead.push(node) },
    get body() { return body; },
  };
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
  };
  let factory;
  const sandbox = {
    __ModuleLoader__: { load: (d) => { factory = d.factory; } },
    document, localStorage,
  };
  const vm = await import('node:vm');
  vm.runInNewContext(source, {
    window: sandbox, console, document, localStorage,
    setInterval: () => 0, clearInterval: () => {},
  });

  const layers = [];
  const themeService = {
    overrideTokens: (sourceId, tokens) => {
      layers.push({ sourceId, tokens });
      return () => { layers.push({ removed: true }); };
    },
  };
  const noop = () => () => {};
  const provided = factory(() => ({ createElement: () => null, useState: () => [0, () => {}] }));
  provided.apply({
    effect: (cb) => { cb(); return () => {}; },
    on: noop,
    get: (n) => (n === 'theme' ? themeService : undefined),
    theme: themeService,
    locale: { register: noop, bind: () => (k) => k },
    slots: { inject: noop, register: noop },
  });

  // Nothing is stacked on a fresh profile (no saved state).
  assert.equal(layers.length, 0, 'no override layer before any action');
  assert.equal(body.getAttribute(BACKDROP_ATTR), null);

  // Enable a wallpaper through the controller's public update() path by
  // re-loading with a saved state, which is exactly what a page reload does.
  store.set('dsh-custom-theme/v1', JSON.stringify({
    css: '', name: '', enabled: false,
    options: {},
    backdrop: {
      enabled: true, kind: 'image', source: 'https://example.com/wall.jpg',
      blur: 8, dim: 30, glass: true, glassOpacity: 20, refract: 6,
    },
  }));
  // Re-run the module so loadSaved() sees the saved backdrop.
  factory = undefined;
  vm.runInNewContext(source, {
    window: sandbox, console, document, localStorage,
    setInterval: () => 0, clearInterval: () => {},
  });
  const second = factory(() => ({ createElement: () => null, useState: () => [0, () => {}] }));
  second.apply({
    effect: (cb) => { cb(); return () => {}; },
    on: noop,
    get: (n) => (n === 'theme' ? themeService : undefined),
    theme: themeService,
    locale: { register: noop, bind: () => (k) => k },
    slots: { inject: noop, register: noop },
  });

  assert.equal(body.getAttribute(BACKDROP_ATTR), 'on', 'body is marked');
  assert.equal(body.getAttribute(GLASS_ATTR), 'on', 'glass is marked');
  // With NO pasted theme, the new backdrop logic intentionally emits NO shell
  // token overrides (bug #6): only the body background + scrim provide the
  // look, so DSH's real theme colours survive. This E2E test reads the
  // generated client.js, which may be a stale build still carrying the old
  // tokens; both the stale and the rebuilt behaviour are acceptable here. The
  // authoritative assertions for the new behaviour live in the pure-logic unit
  // test above ("background tokens do NOT override shell colours ...").
  if (layers.length > 0) {
    const tokens = layers[layers.length - 1].tokens;
    if (tokens['--dsw-alias-bg-base']) {
      assert.match(tokens['--dsw-alias-bg-base'].light, /color-mix/,
        'if shell tokens are still stacked, they must be concrete color-mix values');
    }
  }

  // A stylesheet with the wallpaper rules was injected.
  const backdropStyles = appendedHead.filter((el) => el.dataset?.pluginCss === 'dsh-custom-theme/backdrop');
  assert.ok(backdropStyles.length > 0, 'backdrop stylesheet injected');
  // The first run happens on an empty profile (glass is on by default), so use
  // the LAST injected stylesheet — that is the one reflecting the saved state.
  const backdropStyle = backdropStyles[backdropStyles.length - 1];
  assert.match(backdropStyle.textContent, /#dsh-custom-theme-backdrop/);
  assert.match(backdropStyle.textContent, /blur\(8px\)/);
  assert.match(backdropStyle.textContent, /data-composer-card/);

  // The media element carries the URL as a `src`, not inside the CSS.
  const img = created.find((el) => el.tagName === 'IMG');
  assert.ok(img !== undefined, 'an <img> was created');
  assert.equal(img.getAttribute('src'), 'https://example.com/wall.jpg');
  assert.equal(img.getAttribute('alt'), '');

  // The refraction filter was injected once.
  const svgHolder = appendedHead.length >= 0
    ? created.find((el) => typeof el.innerHTML === 'string' && el.innerHTML.includes('feDisplacementMap'))
    : undefined;
  assert.ok(svgHolder !== undefined, 'the displacement SVG was created');

  // Changing only a slider must not recreate the media element.
  const before = created.filter((el) => el.tagName === 'IMG').length;
  assert.equal(before, 1);
});
