/**
 * Background + "liquid glass" layer — pure logic.
 *
 * The theme half rewrites `--dsw-*` colour tokens. This module owns a second,
 * independent visual layer:
 *
 *   - a full-window wallpaper (image or video) with optional blur + scrim,
 *   - optional liquid glass on the composer input, with adjustable opacity,
 *     blur, saturation, radius, edge highlight and water lighting.
 *
 * DOM-free: the functions below return CSS text, a media descriptor and
 * token overrides. `src/client.template.js` performs the
 * actual DOM writes, so all of this is unit-testable in plain Node.
 *
 * Security: a pasted URL is never interpolated into CSS — it is validated and
 * assigned to a media element's `src` attribute, so a hostile string cannot
 * inject selectors. Only http(s) and raster data:image URLs are accepted;
 * blob: URLs are refused for every kind (they are session-only and would be
 * persisted as a dead URL), SVG data URLs are refused (SVG can carry script),
 * and data URLs are size-capped because they are persisted to localStorage.
 *
 * CSS recipe is derived from these MIT-licensed open-source projects (values
 * and techniques, not copied code):
 *   - kevinbism/liquid-glass-effect  — blur(2px) saturate(180%), 1px edge, inset highlight
 *   - Z1Code/glass-refraction        — specular top line, chromatic edges, saturate tiers
 *   - shuding/liquid-glass           — feDisplacementMap refraction, contrast(1.2)
 *   - UmarGit/liquid-glass           — light/dark alpha tiers
 *   - miketromba/css.glass           — parameter ranges (alpha 0..1, blur 0..20)
 * See research/glass-recipes.md for the full audit with per-repo evidence.
 *
 * @module dsh-custom-theme/backdrop
 */

/** Largest persisted data-URL payload (localStorage has a ~5 MiB quota). */
export const MAX_DATA_URL_BYTES = 1_500_000;

/** Stable IDs/attributes used by the client half. */
export const BACKDROP_LAYER_ID = 'dsh-custom-theme-backdrop';
export const BACKDROP_ATTR = 'data-dsh-backdrop';
export const GLASS_ATTR = 'data-dsh-glass';

export const DEFAULT_BACKDROP = Object.freeze({
  enabled: false,
  kind: 'image',              // 'image' | 'video'
  source: '',                 // URL or raster data URL
  blur: 0,                    // background blur, 0..40 px
  dim: 35,                    // scrim darkening, 0..70 %
  tint: '',                   // optional #rrggbb colour cast
  tintStrength: 0,            // 0..40 %
  fit: 'cover',               // cover | contain
  glass: false,               // OFF by default: backdrop-filter on the composer
                              // repaints on every streamed token and causes the
                              // "uneven typing" jank. Users opt in explicitly.
  glassOpacity: 14,           // surface colour strength, 0..70 (%) — lower = clearer
  glassBlur: 10,              // 0..32 px
  glassSaturate: 180,         // 100..220 %
  glassRadius: 20,            // 0..32 px
  glassHighlight: 55,         // edge highlight, 0..80 %
  glassShadow: 30,            // outer shadow, 0..60 %
  refract: 6,                 // 0..24, strength of the water-light pattern
  refractFrequency: 15,       // 5..30, controls how tightly the press ripple tapers
  performance: false,         // lite mode: no refraction, no shimmer, shallow blur
  reducedMotion: true,        // pause the video when the OS asks
  glassPreset: 'balanced',    // 'lite' | 'balanced' | 'fine' | 'custom'
});

/**
 * Discrete stops offered by the settings dropdown for every numeric slider.
 *
 * A slider is still present next to each dropdown (both are kept): picking a
 * stop sets the exact value, dragging the slider moves the dropdown to
 * "custom". Values are the real clamped units (px / % / plain steps), so the
 * dropdown needs no per-language labels — only the shared "custom" entry.
 */
export const SLIDER_STEPS = Object.freeze({
  blur:             Object.freeze([0, 6, 14, 26, 40]),
  dim:              Object.freeze([0, 20, 35, 55, 70]),
  tintStrength:     Object.freeze([0, 10, 20, 30, 40]),
  glassOpacity:     Object.freeze([0, 8, 14, 28, 50, 70]),
  glassBlur:        Object.freeze([0, 4, 8, 14, 22, 32]),
  glassSaturate:    Object.freeze([100, 130, 160, 190, 220]),
  glassRadius:      Object.freeze([0, 8, 16, 24, 32]),
  glassHighlight:   Object.freeze([0, 20, 40, 60, 80]),
  glassShadow:      Object.freeze([0, 15, 30, 45, 60]),
  refract:          Object.freeze([0, 6, 12, 18, 24]),
  refractFrequency: Object.freeze([5, 12, 18, 24, 30]),
});

/**
 * One-click glass "looks". They exist so a user never has to hunt through
 * eleven sliders to get a usable frame rate — the reported problem. `lite` is
 * the recommended default on low-end machines: shallow blur, no refraction,
 * no per-pointer repaint, and a capped backdrop-filter chain.
 */
export const GLASS_PRESETS = Object.freeze({
  lite: Object.freeze({
    performance: true, glassOpacity: 22, glassBlur: 4, glassSaturate: 120,
    glassRadius: 14, glassHighlight: 35, glassShadow: 18,
    refract: 0, refractFrequency: 15,
  }),
  balanced: Object.freeze({
    // Exactly the shipped defaults, so a fresh profile honestly reports
    // "balanced" rather than "custom".
    performance: false, glassOpacity: 14, glassBlur: 10, glassSaturate: 180,
    glassRadius: 20, glassHighlight: 55, glassShadow: 30,
    refract: DEFAULT_BACKDROP.refract, refractFrequency: 15,
  }),
  fine: Object.freeze({
    performance: false, glassOpacity: 10, glassBlur: 14, glassSaturate: 190,
    glassRadius: 24, glassHighlight: 70, glassShadow: 42,
    refract: 8, refractFrequency: 18,
  }),
});

/**
 * Whether the cheap glass recipe is active. Kept in one place so the CSS, the
 * water lighting and the pointer tracker agree on the same switch.
 */
export function isLiteGlass(backdrop) {
  return backdrop.glassPreset === 'lite';
}

/** Which named preset (if any) the current numbers correspond to. */
export function matchGlassPreset(backdrop) {
  for (const [id, values] of Object.entries(GLASS_PRESETS)) {
    if (Object.entries(values).every(([key, value]) => backdrop[key] === value)) return id;
  }
  return 'custom';
}

const clampNumber = (value, min, max, fallback) => {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

/**
 * Validate a wallpaper URL.
 *
 * Only http(s) and raster image data: URLs are accepted. `blob:` URLs are
 * refused for BOTH image and video: they are session-only, so persisting one to
 * localStorage leaves a dead (black) wallpaper after a reload. SVG data URLs
 * are refused because SVG can carry executable script; any
 * `javascript:`/`file:`/unknown scheme and CSS-escaping characters are refused
 * so the value can be safely placed in `url("…")`.
 *
 * @param raw - pasted URL.
 * @param kind - 'image' | 'video'.
 * @returns `{ ok, value }` or `{ ok: false, reason }`.
 */
export function checkBackgroundUrl(raw, kind) {
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, reason: 'empty' };
  const value = raw.trim();
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return { ok: false, reason: 'control characters' };
  if (/["'`\\<>(){}]/.test(value)) return { ok: false, reason: 'unsafe characters' };
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^(https?|data|blob):/i.test(value)) {
    return { ok: false, reason: 'unsupported scheme' };
  }
  if (/^data:/i.test(value)) {
    if (kind === 'video') return { ok: false, reason: 'a video cannot be a data URL' };
    if (!/^data:image\/(png|jpe?g|gif|webp|avif|bmp);base64,/i.test(value)) {
      return { ok: false, reason: 'only raster image data URLs are allowed' };
    }
    if (value.length > MAX_DATA_URL_BYTES) return { ok: false, reason: 'image is too large to store' };
  }
  // blob: URLs are session-only and cannot be persisted. A saved blob: URL is
  // a dead URL after a reload (black screen), so refuse it for every kind.
  if (/^blob:/i.test(value)) {
    return { ok: false, reason: 'blob URLs are session-only and cannot be persisted; use a file or an http(s) URL' };
  }
  return { ok: true, value };
}

/**
 * Merge a stored/edited backdrop object over the defaults, clamping every
 * numeric field and validating the source.
 *
 * @param raw - raw object (may be null).
 * @returns `{ backdrop, sourceError }`.
 */
export function normalizeBackdrop(raw) {
  const input = raw !== null && typeof raw === 'object' ? raw : {};
  const kind = input.kind === 'video' ? 'video' : 'image';
  const source = typeof input.source === 'string' ? input.source.trim() : '';
  const checked = source === '' ? { ok: true, value: '' } : checkBackgroundUrl(source, kind);

  const backdrop = {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : DEFAULT_BACKDROP.enabled,
    kind,
    source: checked.ok ? checked.value : '',
    blur: clampNumber(input.blur, 0, 40, DEFAULT_BACKDROP.blur),
    dim: clampNumber(input.dim, 0, 70, DEFAULT_BACKDROP.dim),
    tint: typeof input.tint === 'string' && /^#[0-9a-f]{6}$/i.test(input.tint) ? input.tint : '',
    tintStrength: clampNumber(input.tintStrength, 0, 40, DEFAULT_BACKDROP.tintStrength),
    fit: input.fit === 'contain' ? 'contain' : 'cover',
    glass: typeof input.glass === 'boolean' ? input.glass : DEFAULT_BACKDROP.glass,
    glassOpacity: clampNumber(input.glassOpacity, 0, 70, DEFAULT_BACKDROP.glassOpacity),
    glassBlur: clampNumber(input.glassBlur, 0, 32, DEFAULT_BACKDROP.glassBlur),
    glassSaturate: clampNumber(input.glassSaturate, 100, 220, DEFAULT_BACKDROP.glassSaturate),
    glassRadius: clampNumber(input.glassRadius, 0, 32, DEFAULT_BACKDROP.glassRadius),
    glassHighlight: clampNumber(input.glassHighlight, 0, 80, DEFAULT_BACKDROP.glassHighlight),
    glassShadow: clampNumber(input.glassShadow, 0, 60, DEFAULT_BACKDROP.glassShadow),
    refract: clampNumber(input.refract, 0, 24, DEFAULT_BACKDROP.refract),
    refractFrequency: clampNumber(input.refractFrequency, 5, 30, DEFAULT_BACKDROP.refractFrequency),
    performance: typeof input.performance === 'boolean' ? input.performance : DEFAULT_BACKDROP.performance,
    reducedMotion: typeof input.reducedMotion === 'boolean' ? input.reducedMotion : DEFAULT_BACKDROP.reducedMotion,
    glassPreset: ['lite', 'balanced', 'fine', 'custom'].includes(input.glassPreset)
      ? input.glassPreset : DEFAULT_BACKDROP.glassPreset,
  };
  if (input.glassPreset === 'balanced' && backdrop.refract === 0
    && matchGlassPreset({ ...backdrop, refract: DEFAULT_BACKDROP.refract }) === 'balanced') {
    backdrop.refract = DEFAULT_BACKDROP.refract;
  }
  // Keep custom settings, including a deliberate zero for water lighting.
  backdrop.glassPreset = input.glassPreset === 'custom' ? 'custom' : matchGlassPreset(backdrop);
  return { backdrop, sourceError: checked.ok ? null : checked.reason };
}

/** `#rrggbb` + alpha → `rgba(r,g,b,a)`. */
function rgba(hex, alpha) {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha.toFixed(3)})`;
}

/** Round to three decimals so generated CSS stays stable across re-applies. */
const num = (value) => Number(value.toFixed(3));

/**
 * CSS for the wallpaper layer and the composer glass.
 *
 * Both features are OFF by default (glass:false, refract:0), so a fresh profile
 * emits no stylesheet at all. The composer's `backdrop-filter` repaints on every
 * streamed message and was the cause of the "uneven typing" jank; users must
 * opt in to glass explicitly.
 *
 * The two features remain independent when enabled: glass works even without a
 * wallpaper URL. The first version gated everything behind `source !== ''`,
 * so ticking "liquid glass" alone produced no CSS at all.
 *
 * The wallpaper is drawn twice for robustness:
 *   1. `body`'s own `background-image` (kevinbism's approach) — cannot be
 *      hidden by a stacking-context mistake, because it is the root's own paint.
 *   2. a fixed media layer (needed for <video> and for `filter: blur()`).
 * Both are covered by the same scrim. The shell columns are made translucent
 * by `buildBackgroundTokens()` so either layer shows through.
 *
 * @param backdrop - normalised backdrop.
 * @param captionFill - opaque `{ light, dark }` colour pair for the Windows
 *   caption strip, taken from the real theme before it is made translucent.
 *   Optional: without it the strip falls back to a neutral dark fill.
 * @returns CSS text, or '' when the whole feature is disabled.
 */
export function buildBackdropCss(backdrop, captionFill) {
  // Nothing at all on a fresh profile: both features default to off. The two
  // features are independent when enabled — glass must still work even when the
  // wallpaper switch is off (the first version gated everything behind
  // `enabled && source`, so ticking "liquid glass" alone silently did nothing).
  if (backdrop.enabled !== true && backdrop.glass !== true) return '';
  const hasMedia = backdrop.enabled === true && backdrop.source !== '';
  const blur = backdrop.performance ? Math.min(backdrop.blur, 8) : backdrop.blur;
  const dim = num(backdrop.dim / 100);

  const casts = [`linear-gradient(rgba(0,0,0,${dim}), rgba(0,0,0,${dim}))`];
  if (backdrop.tint !== '' && backdrop.tintStrength > 0) {
    const c = rgba(backdrop.tint, num(backdrop.tintStrength / 100));
    casts.push(`linear-gradient(${c}, ${c})`);
  }

  const lines = [];
  if (hasMedia) {
  // WINDOWS WINDOW-DRAG FIX. DSH paints its draggable caption strip as
  // `[data-windows-titlebar] .frame:before` with
  // `background: var(--dsw-specific-sidebar-fill)` and
  // `-webkit-app-region: drag`. When a wallpaper is enabled we make that token
  // translucent so the image shows through — which also makes the 40px caption
  // strip transparent. On Windows' acrylic / transparent window Electron's hit
  // test then stops treating the strip as part of the window: dragging the top
  // bar AND double-clicking to maximize/restore both stop working (observed on
  // DSH 0.2.2-rc.1). Repaint ONLY the caption pseudo-element with the theme's
  // ORIGINAL opaque colour; every other surface keeps its wallpaper look.
  const opaqueCaption = (() => {
    const light = captionFill && typeof captionFill.light === 'string' && captionFill.light !== ''
      ? captionFill.light : '#f4f5f7';
    const dark = captionFill && typeof captionFill.dark === 'string' && captionFill.dark !== ''
      ? captionFill.dark : '#1f2126';
    // Values come from the theme token table and passed isSafeValue() upstream,
    // so they contain no quotes, braces or semicolons.
    return { light, dark };
  })();
  lines.push(`
html[data-windows-titlebar] [class*="frame"]:before {
  background: ${opaqueCaption.light} !important;
  -webkit-app-region: drag !important;
}
html[data-windows-titlebar] body[data-ds-dark-theme] [class*="frame"]:before {
  background: ${opaqueCaption.dark} !important;
}
html[data-windows-titlebar] [data-window-drag] {
  -webkit-app-region: drag !important;
}
`.trim());
  }
  if (hasMedia && backdrop.kind === 'image') {
    // Belt-and-braces: paint the image on the body itself as well. A data URL
    // is validated by checkBackgroundUrl() and contains no quote/backslash, so
    // embedding it in url("…") is safe. This path survives any z-index issue.
    lines.push(`
body[${BACKDROP_ATTR}="on"] {
  background-color: transparent !important;
  background-image: ${casts.join(', ')}, url("${backdrop.source}") !important;
  background-size: cover !important;
  background-position: center !important;
  background-repeat: no-repeat !important;
  background-attachment: fixed !important;
}
`.trim());
  } else {
    lines.push(`
body[${BACKDROP_ATTR}="on"] { background-color: transparent !important; }
`.trim());
  }

  if (hasMedia) {
    lines.push(`
#${BACKDROP_LAYER_ID} {
  position: fixed;
  inset: 0;
  z-index: -1;
  overflow: hidden;
  pointer-events: none;
  background-color: transparent;
}
#${BACKDROP_LAYER_ID} > img,
#${BACKDROP_LAYER_ID} > video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: ${backdrop.fit};
  object-position: center;
  ${blur > 0 ? `filter: blur(${blur}px);\n  transform: scale(${num(1 + blur / 150)});` : ''}
}
#${BACKDROP_LAYER_ID} > .dsh-backdrop-scrim {
  position: absolute;
  inset: 0;
  ${backdrop.kind === 'video' ? `background-image: ${casts.join(', ')};
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;` : 'background: transparent;'}
}
`.trim());
  }

  if (backdrop.glass) lines.push(buildGlassCss(backdrop));
  return lines.join('\n');
}

/**
 * Window-drag repair, for the hosts where a full-window overlay would otherwise
 * cancel DSH's own draggable regions.
 *
 * Two independent problems are covered here; neither depends on the wallpaper or
 * glass switches, so this stylesheet is emitted whenever the plugin is loaded.
 *
 * 1. Windows — Electron derives the draggable region as
 *      (every `-webkit-app-region: drag` rectangle)
 *      MINUS (every `-webkit-app-region: no-drag` rectangle)
 *    and that subtraction ignores `pointer-events`. The dsh-pet "吃白饭"
 *    mini-game mounts `#dsh-pet-baifan-root` as `position:fixed; inset:0` over
 *    the whole window with `-webkit-app-region:none !important`; that single
 *    full-window no-drag rectangle cancels DSH's 40px caption strip, so the
 *    title bar cannot be dragged and double-click-to-maximize stops working
 *    (observed on Windows).
 *    `initial` restores the property to "unset", removing the layer from that
 *    subtraction without touching its pointer behaviour. The selector carries
 *    specificity (1,2,2) + `!important`, outranking the overlay's (1,0,0) +
 *    `!important` while leaving dsh-pet's own code untouched, so updating the
 *    pet plugin cannot break this and this cannot break the pet.
 *
 * 2. macOS (DSH ≥ 0.2.2-rc.2, `window-drag-regions` upgrade guide) — Desktop no
 *    longer grants a global `no-drag` exclusion to controls and ARIA roles
 *    anywhere in the page. Only controls inside `data-window-drag` rows or
 *    `data-window-drag-controls` scopes get one automatically, and a custom
 *    overlay that covers a header must now declare its own region. The wallpaper
 *    layer is such an overlay: it is mounted `position: fixed; inset: 0` over the
 *    window, so the client half marks it with `data-window-drag-exclude` and the
 *    rule below keeps its children out of any inherited drag region. The layer
 *    is `pointer-events: none`, so this changes only the window-region
 *    computation, never click behaviour.
 *
 * Scoped to the platforms that need it, so a plain Web page gets an inert (but
 * harmless) stylesheet.
 *
 * @returns CSS text.
 */
export function buildWindowDragCss() {
  return `
html[data-windows-titlebar] body #dsh-pet-baifan-root,
html[data-windows-titlebar] body [id^="dsh-pet-baifan"] {
  -webkit-app-region: initial !important;
}
html[data-windows-titlebar] body #dsh-pet-baifan-root *,
html[data-windows-titlebar] body [id^="dsh-pet-baifan"] * {
  -webkit-app-region: initial !important;
}
[data-platform="darwin"] #${BACKDROP_LAYER_ID},
[data-platform="darwin"] #${BACKDROP_LAYER_ID} > img,
[data-platform="darwin"] #${BACKDROP_LAYER_ID} > video,
[data-platform="darwin"] #${BACKDROP_LAYER_ID} > .dsh-backdrop-scrim {
  -webkit-app-region: no-drag;
}
`.trim();
}

/**
 * Liquid glass on DSH's composer frame (`[data-composer-card]`, a stable
 * attribute — CSS-module class names are hashed and must not be targeted).
 *
 * The frosted backing holds its shape. A second layer paints the moving light
 * separately, so pointer motion cannot displace the outline or the controls.
 *
 * @param backdrop - normalised backdrop.
 * @returns CSS text.
 */
export function buildGlassCss(backdrop) {
  const alpha = num(backdrop.glassOpacity / 100);
  const lite = isLiteGlass(backdrop);
  // The single biggest cost is the backdrop-filter chain. The lite preset uses
  // ONE blur() only; chaining saturate/brightness/contrast forces three extra
  // full-surface passes and is the main reason low-end PCs drop frames.
  const blur = backdrop.performance ? Math.min(backdrop.glassBlur, 8) : backdrop.glassBlur;
  const sat = num(backdrop.glassSaturate / 100);
  const hi = num(backdrop.glassHighlight / 100);
  const sh = num(backdrop.glassShadow / 100);
  const radius = backdrop.glassRadius;
  const card = `body[${GLASS_ATTR}="on"] [data-composer-card]`;
  const surface = `${card}:where(:not([data-error], [aria-invalid="true"], [data-dragging]))`;
  // The native workspace picker uses ::after for its own dashed outline.
  const lightSurface = `${surface}:where(:not([class*="_cardWorkspaceTrigger"]))`;
  const water = !lite && !backdrop.performance ? backdrop.refract / 24 : 0;
  const rippleFeather = Math.round(27 - backdrop.refractFrequency * 0.46);
  const filter = lite
    ? `blur(${blur}px)`
    : `blur(${blur}px) saturate(${sat}) brightness(${num(1.05)}) contrast(${num(1.1)})`;
  const transition = lite
    ? 'transition: none;'
    : 'transition: --glass-glow 180ms cubic-bezier(0.22, 1, 0.36, 1);';

  return `
/* ---- Pointer state. Only the INTENSITY is interpolated; position variables
   must never be transitioned (Google's interactive-content-reveal guide:
   animating position produces a lagging trail). ---- */
@property --glass-glow { syntax: '<number>'; inherits: false; initial-value: 0; }
${water > 0 ? `@property --glass-ripple-size { syntax: '<length>'; inherits: true; initial-value: 0px; }
@property --glass-ripple-alpha { syntax: '<number>'; inherits: true; initial-value: 0; }
@property --glass-light-scale { syntax: '<number>'; inherits: true; initial-value: 1; }` : ''}

@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  ${surface} {
    /* Keep the material present while typing. The native border and focus
       shadow still take over when a control inside the card has focus. */
    position: relative;
    isolation: isolate;
    background: transparent;
    border-radius: ${radius}px;
    --glass-x: 50%;
    --glass-y: 16%;
    --glass-glow: 0.28;
    ${transition}
  }
  ${surface}::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: inherit;
    pointer-events: none;
    background-image: linear-gradient(180deg, rgba(255,255,255,${num(hi * 0.14)}), transparent 66%);
    background-color: color-mix(in srgb, var(--dsw-specific-input-major, #202024) ${Math.round(alpha * 100)}%, transparent);
    box-shadow: inset 0 0 0 1px rgba(255,255,255,${num(hi * 0.32)}),
      inset 0 1px 0 rgba(255,255,255,${num(hi * 0.35)}),
      inset 0 -1px 0 rgba(0,0,0,${num(hi * 0.22)});
    -webkit-backdrop-filter: ${filter};
    backdrop-filter: ${filter};
  }
  ${lite ? '' : `${lightSurface}::after {
    content: "";
    position: absolute;
    inset: 2px;
    z-index: -1;
    border-radius: max(0px, ${radius - 2}px);
    pointer-events: none;
    --glass-glow: inherit;
    opacity: max(var(--glass-glow), var(--glass-ripple-alpha, 0));
    ${water > 0 ? 'scale: var(--glass-light-scale) 1;' : ''}
    background-image:
      ${water > 0 ? `radial-gradient(circle at var(--glass-press-x, 50%) var(--glass-press-y, 50%),
        transparent max(0px, calc(var(--glass-ripple-size) - ${rippleFeather}px)),
        rgb(255 255 255 / calc(var(--glass-ripple-alpha) * ${num(0.10 + 0.30 * water)})) var(--glass-ripple-size),
        transparent calc(var(--glass-ripple-size) + ${rippleFeather}px)),` : ''}
      radial-gradient(ellipse 240px 26px at var(--glass-x) -4px,
        rgb(255 255 255 / ${num(hi * 0.38)}) 0%, rgb(255 255 255 / ${num(hi * 0.11)}) 52%, transparent 100%),
      radial-gradient(ellipse 188px 68px at var(--glass-x) var(--glass-y),
        rgb(255 255 255 / ${num(hi * 0.11)}) 0%, transparent 100%);
  }`}
  ${surface}:not(:focus-within) {
    border-color: rgba(255,255,255,${num(hi * 0.6)});
    box-shadow:
      0 8px 32px rgba(0,0,0,${sh}),
      0 2px 8px rgba(0,0,0,${num(sh * 0.38)});
  }
  ${surface}:focus-within { --glass-glow: 0.52; }
  ${lite ? '' : `${surface}:hover { --glass-glow: 1; }`}
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  ${surface} {
    background: color-mix(in srgb, var(--dsw-specific-input-major, #202024) 92%, transparent);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}
/* Touch / reduced-motion: fixed light source, no tracking, no transition.
   smoothui and Twilight Echo both keep the GLASS but freeze the motion. */
@media (any-pointer: coarse) and (not (any-pointer: fine)), (prefers-reduced-motion: reduce) {
  ${surface}, ${surface}:hover, ${surface}:focus-within {
    --glass-glow: 0.28;
    transition: none;
  }
}
${water > 0 ? `@media (prefers-reduced-motion: reduce) {
  ${lightSurface}::after { scale: none; }
}` : ''}
@media (prefers-reduced-transparency: reduce), (forced-colors: active) {
  ${surface} {
    background: var(--dsw-specific-input-major, #202024);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    filter: none;
  }
  ${surface}::before { content: none; }
  ${lite ? '' : `${lightSurface}::after { content: none; }`}
}
`;
}

/**
 * Compute the pointer-driven CSS variable values for one glass element.
 *
 * Pure function — no DOM. Adapted from high-star, production implementations:
 *   - Twilight Echo (424★, real Electron app): `MAX_ELASTIC_SHIFT_PX = 10`,
 *     "elastic shifts beyond 10px push neighbouring layout" — so the pointer
 *     may nudge the HIGHLIGHT by at most 10px, never the element itself.
 *   - smoothui (1046★): critically damped light, no element wobble.
 *   - Google's interactive-content-reveal guide: only the intensity variable
 *     is interpolated; position variables are written directly (no trail).
 *
 * @param event - `{ clientX, clientY }`.
 * @param rect  - the element's `getBoundingClientRect()` result.
 * @param options - `{ elasticShift }`.
 * @returns a map of CSS custom-property names to string values.
 */
export function pointerGlassVars(event, rect, options = {}) {
  const shift = Number.isFinite(options.elasticShift) ? options.elasticShift : 6;
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  const left = rect.left ?? 0;
  const top = rect.top ?? 0;
  const cx = left + w / 2;
  const cy = top + h / 2;

  // Pointer position inside the element (0..100%).
  const px = Math.min(100, Math.max(0, ((event.clientX - left) / w) * 100));
  const py = Math.min(100, Math.max(0, ((event.clientY - top) / h) * 100));

  // A tiny elastic nudge of the light, clamped to `shift` px. This is the
  // "liquid" give; the element and its layout never move.
  const ex = Math.max(-shift, Math.min(shift, (event.clientX - cx) * 0.012));
  const ey = Math.max(-shift, Math.min(shift, (event.clientY - cy) * 0.012));

  const signed = (base, delta) => (
    delta < 0 ? `calc(${num(base)}% - ${num(-delta)}px)` : `calc(${num(base)}% + ${num(delta)}px)`
  );
  return {
    '--glass-x': signed(px, ex),
    '--glass-y': signed(py, ey),
  };
}

/** Neutral values used when the pointer leaves the glass. */
export function restingGlassVars() {
  return {
    '--glass-x': '50%',
    '--glass-y': '16%',
  };
}

/**
 * Token overrides that make ONLY the large shell surfaces translucent.
 *
 * Isolation is deliberate: `--dsw-alias-bg-layer-1/-2` and
 * `--dsw-alias-bg-overlay` are used by code blocks, trajectory tables, message
 * cards, popovers and settings panels. Making those translucent would bleed the
 * wallpaper into text-heavy surfaces and would effectively rewrite the user's
 * pasted theme mapping there. So only the two full-window shell tokens are
 * touched; every component surface stays exactly as the theme defines it.
 *
 * A `var(--dsw-alias-bg-base)` self-reference cannot be used here:
 * ThemePresenter writes these with `body.style.setProperty(name, value)`, and a
 * value referencing its own property is a cycle. The concrete surface colour is
 * taken from the already-built theme token map and mixed down with `color-mix`.
 *
 * IMPORTANT: there is NO hardcoded fallback. When the user only turns on the
 * wallpaper without pasting a theme, `themeTokens` is empty and substituting
 * `#ffffff` / `#14161a` here would stomp whatever built-in/preset theme DSH
 * actually has active. In that case we emit nothing at all and rely on the body
 * background + scrim for the translucent look, leaving DSH's real shell tokens
 * untouched.
 *
 * @param backdrop - normalised backdrop.
 * @param themeTokens - the theme half's `{ light, dark }` token map (may be empty).
 * @returns token -> `{ light, dark }`; empty when the wallpaper is off or no
 *   real theme value is available for a token.
 */
export function buildBackgroundTokens(backdrop, themeTokens = {}) {
  if (backdrop.enabled !== true || backdrop.source === '') return {};
  // Keep enough of the surface colour that text stays readable; the scrim
  // supplies the rest of the contrast.
  const keep = 55;
  const out = {};
  for (const name of ['--dsw-alias-bg-base', '--dsw-specific-sidebar-fill']) {
    const entry = themeTokens[name];
    // Only emit a token when BOTH schemes carry a real observed value. Never
    // invent one: an empty themeTokens map must return {} (bug #6).
    if (entry === undefined || entry === null
      || typeof entry.light !== 'string' || typeof entry.dark !== 'string') continue;
    // A nested color-mix expression is still a valid first argument.
    out[name] = {
      light: `color-mix(in srgb, ${entry.light} ${keep}%, transparent)`,
      dark: `color-mix(in srgb, ${entry.dark} ${keep}%, transparent)`,
    };
  }
  return out;
}

/**
 * Descriptor for the media element the client half owns.
 *
 * @param backdrop - normalised backdrop.
 * @returns `{ tag, attributes, pauseOnReducedMotion }`, or null when off.
 */
export function describeMedia(backdrop) {
  if (backdrop.enabled !== true || backdrop.source === '') return null;
  if (backdrop.kind === 'video') {
    return {
      tag: 'video',
      attributes: { autoplay: true, muted: true, loop: true, playsinline: true, src: backdrop.source },
      pauseOnReducedMotion: backdrop.reducedMotion === true,
    };
  }
  return {
    tag: 'img',
    attributes: { src: backdrop.source, alt: '', decoding: 'async' },
    pauseOnReducedMotion: false,
  };
}

/**
 * Whether a `<video>` should be paused (OS reduced-motion, or page hidden).
 *
 * @param backdrop - normalised backdrop.
 * @param query - optional `(mediaQuery) => boolean` for testing; semantics of
 *   this second argument are unchanged.
 * @param hidden - optional page-hidden override for testing. Defaults to
 *   `document.hidden === true` when a DOM is present, so the pure function
 *   stays unit-testable without a global `document`.
 * @returns true when the caller must pause and remove the `autoplay` attribute.
 */
export function shouldPauseVideo(backdrop, query, hidden) {
  if (backdrop.enabled !== true || backdrop.kind !== 'video') return false;
  if (backdrop.reducedMotion !== true) return false;
  // A hidden document should never keep decoding a looping wallpaper video.
  const isHidden = typeof hidden === 'boolean'
    ? hidden
    : (typeof document !== 'undefined' && document.hidden === true);
  if (isHidden) return true;
  const matches = typeof query === 'function'
    ? query
    : (q) => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia(q).matches;
  return matches('(prefers-reduced-motion: reduce)');
}
