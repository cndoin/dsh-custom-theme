/**
 * Background + "liquid glass" layer — pure logic.
 *
 * The theme half rewrites `--dsw-*` colour tokens. This module owns a second,
 * independent visual layer:
 *
 *   - a full-window wallpaper (image or video) with optional blur + scrim,
 *   - optional liquid glass on the composer input, with adjustable opacity,
 *     blur, saturation, radius, edge highlight and refraction.
 *
 * DOM-free: the functions below return CSS text, an SVG filter definition, a
 * media descriptor and token overrides. `src/client.template.js` performs the
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
  refract: 0,                 // 0..24, 0 = off. The SVG displacement path is
                              // intentionally NOT wired onto the composer (it
                              // breaks position:fixed popovers); >0 only emits
                              // a decorative-layer-only filter definition.
  refractFrequency: 15,       // 5..30 → baseFrequency 0.005..0.030
  performance: false,         // lite mode: no refraction, no shimmer, shallow blur
  reducedMotion: true,        // pause the video when the OS asks
});

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
  };
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
html[data-ds-dark-theme][data-windows-titlebar] [class*="frame"]:before {
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
 * Liquid glass on DSH's composer frame (`[data-composer-card]`, a stable
 * attribute — CSS-module class names are hashed and must not be targeted).
 *
 * Recipe: translucent tinted surface + `blur · saturate · brightness · contrast`
 * backdrop filter, a 1px specular edge, an inset top highlight, chromatic edge
 * shadows (colour dispersion without a pseudo-element, because DSH already uses
 * `::after` on one card variant), and a separate `::before` specular line.
 *
 * Deliberately does NOT use an SVG `filter: url(...)` on the composer: a filter
 * creates a new containing block, which re-anchors the card's `position:fixed`
 * popovers (@mention, attachment preview, emoji, tooltip) and clips their
 * overflow. `isolation: isolate` is likewise omitted (it adds a stacking
 * context for no benefit here). No `!important` on background/border: those
 * would override DSH's `:focus-visible`, `[data-error]` and drag-highlight
 * states. A higher-specificity selector on the decoration-only properties is
 * used where the host must be won over.
 *
 * @param backdrop - normalised backdrop.
 * @returns CSS text.
 */
export function buildGlassCss(backdrop) {
  const alpha = num(backdrop.glassOpacity / 100);
  const blur = backdrop.performance ? Math.min(backdrop.glassBlur, 8) : backdrop.glassBlur;
  const sat = num(backdrop.glassSaturate / 100);
  const hi = num(backdrop.glassHighlight / 100);
  const sh = num(backdrop.glassShadow / 100);
  const radius = backdrop.glassRadius;

  return `
/* ---- Pointer state. Only the INTENSITY is interpolated; position variables
   must never be transitioned (Google's interactive-content-reveal guide:
   animating position produces a lagging trail). ---- */
@property --glass-glow { syntax: '<number>'; inherits: false; initial-value: 0; }

@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  /* State-safe base selector: the resting decoration only applies while the
     composer is NOT focused and carries no error/highlight state, so DSH's
     :focus-visible border, [data-error] and drag highlight always win. */
  body[${GLASS_ATTR}="on"] [data-composer-card]:not(:focus-within):not([data-error]) {
    /* All decoration lives in the element's own background layers: no
       pseudo-elements, no child selectors, and — crucially — NO transform or
       scale and NO SVG filter (a filter would re-anchor position:fixed
       popovers). Scaling the composer itself squeezed the whole page
       (reported by the user); high-star implementations (smoothui, Twilight
       Echo) move only the highlight, never the element. */
    position: relative;
    --glass-x: 50%;
    --glass-y: 0%;
    --glass-ang: 135deg;
    --glass-glow: 0.35;
    background:
      /* 1. Pointer-following specular hotspot — soft, WHITE, single layer.
         smoothui: radial-gradient(closest-side, .3, .07@48%, transparent@74%). */
      radial-gradient(circle 260px at var(--glass-x) var(--glass-y),
        rgba(255,255,255,calc(0.04 + var(--glass-glow) * 0.26)) 0%,
        rgba(255,255,255,calc(0.02 + var(--glass-glow) * 0.06)) 48%,
        transparent 74%),
      /* 2. A restrained specular sweep whose angle follows the cursor
         (rdev / Twilight Echo: 135 + offsetX * 1.2 deg). */
      linear-gradient(var(--glass-ang),
        transparent 30%,
        rgba(255,255,255,calc(var(--glass-glow) * 0.10)) 50%,
        transparent 70%),
      /* 3. Static 1px top specular line (Z1Code). */
      linear-gradient(90deg, transparent 8%, rgba(255,255,255,${num(Math.min(0.7, hi + 0.15))}) 50%, transparent 92%) top / 100% 1px no-repeat,
      /* 4. Soft overhead light. */
      linear-gradient(180deg, rgba(255,255,255,${num(hi * 0.12)}) 0%, transparent 38%);
    /* The tinted surface is a colour, not an image: it goes in
       background-color AFTER the shorthand (which resets it). */
    background-color: color-mix(in srgb, var(--dsw-specific-input-major, #202024) ${Math.round(alpha * 100)}%, transparent);
    background-repeat: no-repeat;
    -webkit-backdrop-filter: blur(${blur}px) saturate(${sat}) brightness(${num(1.05)}) contrast(${num(1.1)});
    backdrop-filter: blur(${blur}px) saturate(${sat}) brightness(${num(1.05)}) contrast(${num(1.1)});
    border-radius: ${radius}px;
    border: 1px solid rgba(255,255,255,${num(hi * 0.6)});
    box-shadow:
      0 8px 32px rgba(0,0,0,${sh}),
      inset 0 1px 0 rgba(255,255,255,${num(Math.max(0.1, hi * 0.35))}),
      inset  2px  2px 1px -1px rgba(255,255,255,${num(hi * 0.6)}),
      inset -2px -2px 1px -1px rgba(255,255,255,${num(hi * 0.35)});
    transition: --glass-glow 0.28s cubic-bezier(0.22, 1, 0.36, 1),
                box-shadow 0.2s ease-out;
  }
  /* Hover only brightens the light — no size change, no layout shift. */
  body[${GLASS_ATTR}="on"] [data-composer-card]:hover { --glass-glow: 1; }
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  body[${GLASS_ATTR}="on"] [data-composer-card]:not(:focus-within):not([data-error]) {
    background: color-mix(in srgb, var(--dsw-specific-input-major, #202024) 92%, transparent);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}
/* Touch / reduced-motion: fixed light source, no tracking, no transition.
   smoothui and Twilight Echo both keep the GLASS but freeze the motion. */
@media (pointer: coarse), (prefers-reduced-motion: reduce) {
  body[${GLASS_ATTR}="on"] [data-composer-card] {
    --glass-glow: 0.35;
    transition: none;
  }
}
@media (prefers-reduced-transparency: reduce) {
  body[${GLASS_ATTR}="on"] [data-composer-card] {
    background: var(--dsw-specific-input-major, #202024);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    filter: none;
  }
}
`;
}

/**
 * Compute the pointer-driven CSS variable values for one glass element.
 *
 * Pure function — no DOM. Adapted from high-star, production implementations:
 *   - rdev/liquid-glass-react (6640★): `135 + offsetX * 1.2` degree highlight.
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

  // Specular sweep angle follows the cursor (rdev / Twilight Echo).
  const offsetX = ((event.clientX - cx) / w) * 100;
  const angle = 135 + offsetX * 1.2;

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
    '--glass-ang': `${num(angle)}deg`,
  };
}

/** Neutral values used when the pointer leaves the glass. */
export function restingGlassVars() {
  return {
    '--glass-x': '50%',
    '--glass-y': '0%',
    '--glass-ang': '135deg',
  };
}

/**
 * SVG displacement filter definition for the refraction effect.
 *
 * Kept as a public export (the client half still calls it) and still emitted
 * when a user EXPLICITLY opts in with `glass:true` and `refract>0`. However it
 * is deliberately a decoration-only definition: the composer CSS no longer
 * references `url(#dsh-glass-refract)`. Applying an SVG filter to
 * `[data-composer-card]` created a new containing block that re-anchored its
 * `position:fixed` popovers and clipped their overflow, so that path has been
 * removed. The frosted `backdrop-filter` look is retained without it.
 *
 * Returns '' whenever glass is off, refraction is 0 (the new default), or
 * performance mode is on.
 *
 * @param backdrop - normalised backdrop.
 * @returns an `<svg>` string, or '' when refraction is off.
 */
export function buildRefractionSvg(backdrop) {
  // Explicit opt-in only; default refract is now 0 so a fresh profile never
  // builds this SVG. The filter is never applied to the composer itself.
  const scale = backdrop.glass === true && !backdrop.performance ? backdrop.refract : 0;
  if (scale <= 0) return '';
  const freq = (backdrop.refractFrequency / 1000).toFixed(3);
  return `<svg width="0" height="0" aria-hidden="true" style="position:absolute" xmlns="http://www.w3.org/2000/svg"><defs>
  <filter id="dsh-glass-refract" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">
    <feGaussianBlur in="SourceGraphic" stdDeviation="0.3" result="preblur"/>
    <feTurbulence type="fractalNoise" baseFrequency="${freq} ${freq}" numOctaves="2" seed="42" result="noise"/>
    <feGaussianBlur in="noise" stdDeviation="3" result="smooth"/>
    <feDisplacementMap in="preblur" in2="smooth" scale="${scale}" xChannelSelector="R" yChannelSelector="G" result="displaced"/>
    <feColorMatrix in="displaced" type="saturate" values="1.3"/>
  </filter>
</defs></svg>`;
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
