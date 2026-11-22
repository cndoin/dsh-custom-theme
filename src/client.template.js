/**
 * Browser half of the custom-theme plugin.
 *
 * The user pastes a theme copied from tweakcn.com (or any shadcn-style theme)
 * into the Settings page this module registers. Only CSS custom-property
 * declarations are read; the paste never reaches the DOM as a stylesheet, so no
 * selector, `@apply`, or `url()` in it can do anything. The declarations are
 * then mapped onto DSH's own `--dsw-*` tokens and handed to
 * `ctx.theme.overrideTokens()`, which keeps the base theme intact and lets this
 * layer be removed again.
 *
 * The artifact is a closure-factory bundle (`window.__ModuleLoader__.load`), the
 * only shape the client module system accepts. `react`, the theme service and
 * the locale service arrive through the injected `require`/`ctx` tables, so the
 * package ships no build step.
 */
window.__ModuleLoader__.load({
  id: 'dsh-custom-theme',
  factory: (require) => {
    const React = require('react');
    const { createElement: h, useState, useEffect, useMemo, useCallback } = React;

    const PLUGIN_ID = 'dsh-custom-theme';
    const NAMESPACE = 'custom-theme';
    const STORAGE_KEY = 'dsh-custom-theme/v1';
    const TOKEN_PREFIX = '--dsw-';
    const MOTION_ATTR = 'data-dsh-custom-theme-motion';
    const STREAM_SELECTOR = 'div[data-streaming]';
    const FADE_STEPS = [48, 65, 80, 92];
    const FADE_STEP_MS = 36;

    // ---------------------------------------------------------------------
    // Theme core (generated from src/core.js by scripts/build.mjs).
    // ---------------------------------------------------------------------
    /*__CORE__*/

    // ---------------------------------------------------------------------
    // Background + liquid-glass layer (generated from src/backdrop.js).
    // ---------------------------------------------------------------------
    /*__BACKDROP__*/


    // ---------------------------------------------------------------------
    // Built-in presets (copied from tweakcn, oklch export shape).
    // ---------------------------------------------------------------------
    /*__PRESETS__*/

    // ---------------------------------------------------------------------
    // Dictionaries
    // ---------------------------------------------------------------------
    /*__DICTIONARIES__*/

    // ---------------------------------------------------------------------
    // Text
    // ---------------------------------------------------------------------

    /**
     * Substitute `{name}` placeholders in one already-translated string.
     *
     * The locale service owns lookup and fallback; interpolation stays local so
     * this plugin does not depend on an undocumented second translate argument.
     *
     * @param text - the translated template.
     * @param values - replacement values.
     * @returns the filled-in string.
     */
    function format(text, values) {
      if (values === undefined) return text;
      return String(text).replace(/\{(\w+)\}/g, (whole, name) => (
        Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : whole
      ));
    }

    // ---------------------------------------------------------------------
    // Persistence
    // ---------------------------------------------------------------------

    /** Default mapping switches; each one is a checkbox in the settings page. */
    const DEFAULT_OPTIONS = Object.freeze({
      borders: 'soft',
      radius: 'fit',
      // OFF by default. tweakcn's --font-sans stacks are Latin-only
      // ("Geist, sans-serif"), and overrideTokens writes them INLINE on <body>,
      // which beats DSH's built-in stack containing "PingFang SC" /
      // "Microsoft YaHei". Chinese then falls back to a system font and
      // font-synthesis fakes bold for the UI's many font-weight:500 elements —
      // the reported "字体又是厚" problem. Leaving DSH's own font stack alone
      // (and respecting the user's font settings) is the safe default. Users
      // who really want a theme font can still opt in explicitly.
      fonts: false,
      statusTint: false,
      extras: true,
      ramps: true,
      companion: true,
    });

    /**
     * Read the saved theme, tolerating an unreadable or foreign value.
     *
     * @returns `{ css, name, enabled, options, backdrop }`.
     */
    function loadSaved() {
      const fallback = {
        css: '', name: '', enabled: false,
        motion: false,
        options: { ...DEFAULT_OPTIONS },
        backdrop: { ...DEFAULT_BACKDROP },
      };
      let raw;
      try {
        raw = window.localStorage.getItem(STORAGE_KEY);
      } catch {
        return fallback;
      }
      if (raw === null) return fallback;
      try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object') return fallback;
        const options = normalizeOptions(parsed.options);
        // MIGRATION (font-weight / "字体变厚" fix): older builds defaulted
        // `fonts` to true and persisted it. Re-applying that value on every
        // startup silently replaced DSH's CJK font stack with the theme's
        // Latin-only stack. Reset it once, record the migration, and persist so
        // an existing user is fixed without losing the rest of their settings.
        if (parsed.fontsMigrationV2 !== true && options.fonts === true) {
          options.fonts = false;
          try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
              ...parsed, options, fontsMigrationV2: true,
            }));
          } catch { /* settings still work for this session */ }
        }
        return {
          css: typeof parsed.css === 'string' ? parsed.css : '',
          name: typeof parsed.name === 'string' ? parsed.name : '',
          enabled: parsed.enabled === true,
          motion: parsed.motion === true,
          options,
          backdrop: normalizeBackdrop(parsed.backdrop).backdrop,
        };
      } catch {
        return fallback;
      }
    }

    /** Merge a stored options object over the defaults. */
    function normalizeOptions(raw) {
      const options = { ...DEFAULT_OPTIONS };
      if (raw === null || typeof raw !== 'object') return options;
      if (raw.borders === 'soft' || raw.borders === 'solid' || raw.borders === 'off') options.borders = raw.borders;
      if (raw.radius === 'fit' || raw.radius === 'off') options.radius = raw.radius;
      if (typeof raw.fonts === 'boolean') options.fonts = raw.fonts;
      if (typeof raw.statusTint === 'boolean') options.statusTint = raw.statusTint;
      if (typeof raw.extras === 'boolean') options.extras = raw.extras;
      if (typeof raw.companion === 'boolean') options.companion = raw.companion;
      if (typeof raw.ramps === 'boolean') options.ramps = raw.ramps;
      return options;
    }

    /**
     * Persist the theme. A failed write is reported, never thrown: the theme is
     * already live and losing the save must not roll it back.
     *
     * @returns null on success, or a message.
     */
    function save(state) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, fontsMigrationV2: true }));
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }

    // ---------------------------------------------------------------------
    // Styles
    // ---------------------------------------------------------------------

    const CSS = `
/* Keep the settings page from synthesizing fake bold (the UI uses
   font-weight:500/700 while DSH ships no font-synthesis declaration). This is
   scoped to our own card only; the app-wide fix is the fonts-default-off
   migration in loadSaved(). */
.cctRoot { display: flex; flex-direction: column; gap: 18px; font-synthesis: none; }
.cctCard {
  border: 0.5px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  border-radius: var(--dsw-radius-md);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.cctTitle { color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 500; line-height: 22px; }
.cctHint { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.cctHint a { color: var(--dsw-alias-link); }
.cctRow { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.cctGrow { flex: 1 1 auto; }
.cctInput {
  box-sizing: border-box;
  width: 100%;
  min-height: 190px;
  resize: vertical;
  font-family: var(--ds-font-family-code);
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-specific-input-major);
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm);
  padding: 10px 12px;
  outline: none;
}
.cctInput:focus-visible { border-color: var(--dsw-alias-brand-primary); }
.cctButton {
  appearance: none;
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  padding: 6px 14px;
  border-radius: var(--dsw-radius-sm);
  border: 0.5px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  transition: background 0.16s, border-color 0.16s;
}
.cctButton:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-solid); }
.cctButton:disabled { opacity: 0.45; cursor: default; }
.cctButtonPrimary {
  background: var(--dsw-alias-button-primary-fill);
  border-color: transparent;
  color: var(--dsw-alias-label-primary-foreground);
  font-weight: 500;
}
.cctButtonPrimary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-fill); filter: brightness(1.08); }
.cctButtonDanger { color: var(--dsw-alias-state-error-primary); }
.cctSelect {
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  padding: 6px 10px;
  border-radius: var(--dsw-radius-sm);
  border: 0.5px solid var(--dsw-alias-border-l2);
  background: var(--dsw-specific-input-major);
  color: var(--dsw-alias-label-primary);
}
.cctSwatches { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.cctSwatch {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm);
  padding: 6px 8px;
  background: var(--dsw-alias-bg-layer-2);
  min-width: 0;
}
.cctChip {
  width: 22px;
  height: 22px;
  border-radius: 5px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  flex: none;
  background-clip: padding-box;
}
.cctSwatchText { min-width: 0; display: flex; flex-direction: column; }
.cctSwatchName {
  font-size: 11px;
  line-height: 15px;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cctSwatchValue {
  font-family: var(--ds-font-family-code);
  font-size: 10px;
  line-height: 14px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cctCheck { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--dsw-alias-label-primary); cursor: pointer; }
.cctCheck input { accent-color: var(--dsw-alias-brand-primary); }
.cctInlineLabel { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.cctSliderRow { display: grid; grid-template-columns: minmax(110px, 1fr) 88px 2fr 48px; gap: 10px; align-items: center; }
.cctSliderLabel { font-size: 12px; color: var(--dsw-alias-label-primary); }
.cctSliderValue { font-family: var(--ds-font-family-code); font-size: 11px; color: var(--dsw-alias-label-secondary); text-align: right; }
.cctSliderRow input[type=range] { width: 100%; accent-color: var(--dsw-alias-brand-primary); }
.cctStepSelect {
  font-family: var(--ds-font-family-code);
  font-size: 11px;
  line-height: 18px;
  padding: 3px 6px;
  border-radius: var(--dsw-radius-sm);
  border: 0.5px solid var(--dsw-alias-border-l2);
  background: var(--dsw-specific-input-major);
  color: var(--dsw-alias-label-primary);
  width: 100%;
}
.cctStepSelect:focus-visible { border-color: var(--dsw-alias-brand-primary); }
.cctPresetRow { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.cctPresetHint { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.cctSliderRow input[type=color] { width: 40px; height: 28px; padding: 0; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: transparent; }
.cctInputSmall {
  box-sizing: border-box; width: 100%;
  font-family: var(--ds-font-family-code); font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-specific-input-major);
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm);
  padding: 6px 10px; outline: none;
}
.cctInputSmall:focus-visible { border-color: var(--dsw-alias-brand-primary); }
.cctDiag {
  margin: 0;
  padding: 8px 10px;
  font-family: var(--ds-font-family-code);
  font-size: 10px;
  line-height: 15px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2);
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm);
  max-height: 160px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
.cctStatus { font-size: 12px; line-height: 18px; }
.cctStatusOk { color: var(--dsw-alias-state-success-primary); }
.cctStatusErr { color: var(--dsw-alias-state-error-primary); }
.cctWarnList {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-state-warn-primary);
  max-height: 132px;
  overflow: auto;
}
.cctDivider { height: 0.5px; background: var(--dsw-alias-border-l1); }
@media (max-width: 640px) {
  .cctSliderRow { grid-template-columns: minmax(0, 1fr) 85px; }
  .cctSliderValue { text-align: center; }
}
@media (prefers-reduced-motion: reduce) {
  .cctButton { transition: none; }
}
`;

    // ---------------------------------------------------------------------
    // Pointer-driven liquid glass
    // ---------------------------------------------------------------------

    /**
     * Pointer-driven specular light for the composer glass.
     *
     * Architecture follows the highest-star, production implementations:
     *   - Px-asen/Twilight_Echo (424★, real Electron app): a low-frequency
     *     `pointerover/pointerout` pair stays resident; the high-frequency
     *     `pointermove` is attached only while the pointer is over the card.
     *     Frames are coalesced (latest-wins) and capped at ~32ms so a blurred,
     *     moving light never starves scrolling.
     *   - educlopez/smoothui (1046★): only the LIGHT moves, with a critically
     *     damped spring; the element itself never scales (scaling it squeezed
     *     the whole page — the user's exact complaint).
     *   - Google's interactive-content-reveal guide: never transition position
     *     variables, only an intensity variable, and `pointer-events: none`.
     *
     * Isolation guarantees: passive listeners, never `preventDefault` /
     * `stopPropagation`; only `[data-composer-card]` is written to; no child
     * nodes, no global variables; fully removed on disable/dispose.
     *
     * @returns `{ enable, disable }`.
     */
    function createPointerGlass() {
      const SELECTOR = '[data-composer-card]';
      let enabled = false;
      let moveAttached = false;
      let frame = 0;
      let pending = null;
      let card = null;
      let rect = null;
      let boundaryAttached = false;
      // Only the light layer moves. Custom performance mode can still cap its
      // updates, while Balanced and Fine follow the display's animation frames.
      let intervalMs = 0;
      let pressEnabled = false;
      let pressMotion = null;
      let lastFlush = 0;
      let timer = 0;
      const now = () => (typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now() : Date.now());

      const mq = (q) => (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(q) : null);
      const reduceMQ = mq('(prefers-reduced-motion: reduce), (prefers-reduced-transparency: reduce), (forced-colors: active)');
      const isStatic = () => reduceMQ?.matches === true;

      const doc = typeof document === 'undefined' ? null : document;
      const win = typeof window === 'undefined' ? null : window;
      const canListen = doc !== null && win !== null
        && typeof doc.addEventListener === 'function'
        && typeof win.addEventListener === 'function'
        && typeof doc.removeEventListener === 'function'
        && typeof win.removeEventListener === 'function';

      const write = (vars) => {
        if (card === null) return;
        const style = card.style;
        for (const [name, value] of Object.entries(vars)) {
          // Skip writes when the coalesced coordinates are unchanged.
          if (style.getPropertyValue(name) !== value) style.setProperty(name, value);
        }
      };

      const reset = () => {
        if (card !== null) write(restingGlassVars());
        card = null;
        rect = null;
        pending = null;
        if (frame !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
        frame = 0;
        if (timer !== 0 && typeof clearTimeout === 'function') clearTimeout(timer);
        timer = 0;
        detachMove();
      };

      // A `pointerover` arriving without a preceding `pointerenter` still
      // arms the card; `pointerout` with a null relatedTarget (common when
      // leaving the window / Electron chrome) is treated as a real leave.
      const canTrack = event => event.pointerType !== 'touch';

      const flush = () => {
        frame = 0;
        if (timer !== 0 && typeof clearTimeout === 'function') clearTimeout(timer);
        timer = 0;
        // B3: re-arming a frame when the pointer already left keeps an
        // unnecessary rAF alive for every drag across the window.
        const event = pending;
        pending = null;
        if (event === null || card === null) return;
        if (isStatic() || !card.isConnected) { reset(); return; }
        rect ??= card.getBoundingClientRect();
        lastFlush = now();
        write(pointerGlassVars(event, rect, { elasticShift: 6 }));
      };

      const onMove = (event) => {
        if (!enabled || card === null || !canTrack(event)) return;
        pending = { clientX: event.clientX, clientY: event.clientY };
        if (intervalMs <= 0) {
          if (frame === 0 && typeof requestAnimationFrame === 'function') {
            frame = requestAnimationFrame(flush);
          }
          return;
        }
        // Throttled path: at most one repaint per intervalMs. A trailing timer
        // guarantees the LAST pointer position is still flushed after a burst.
        const elapsed = now() - lastFlush;
        if (elapsed >= intervalMs) {
          if (frame === 0 && typeof requestAnimationFrame === 'function') {
            frame = requestAnimationFrame(flush);
          }
        } else if (timer === 0 && typeof setTimeout === 'function') {
          timer = setTimeout(() => {
            timer = 0;
            if (frame === 0 && typeof requestAnimationFrame === 'function') {
              frame = requestAnimationFrame(flush);
            }
          }, Math.max(0, intervalMs - elapsed));
        }
      };

      const resolveCard = (target) => (
        typeof Element !== 'undefined' && target instanceof Element
          ? target.closest(SELECTOR) : null
      );

      const onOver = (event) => {
        if (!enabled || !canTrack(event) || isStatic()) return;
        const next = resolveCard(event.target);
        if (next === null) return;
        if (next !== card) {
          reset();
          card = next;
          rect = next.getBoundingClientRect();      // measured ONCE on enter
        }
        attachMove();
        onMove(event);                              // no first-frame delay
      };

      const onOut = (event) => {
        if (!enabled || !canTrack(event)) return;
        const from = resolveCard(event.target);
        const to = resolveCard(event.relatedTarget);
        if (from === to) return;                    // moving between children
        if (to === null && from !== null) {
          // Synchronous cleanup — a fast pass must not leave a stale highlight.
          reset();
        }
      };

      const onPress = (event) => {
        if (!pressEnabled || isStatic() || event.button !== 0 || event.isPrimary === false) return;
        const target = event.target;
        const pressed = resolveCard(target);
        if (pressed === null || pressed.matches('[data-error], [aria-invalid="true"], [data-dragging], [class*="_cardWorkspaceTrigger"]')
          || target.closest(':disabled, [aria-disabled="true"]') || typeof pressed.animate !== 'function') return;
        pressMotion?.cancel();
        const bounds = pressed.getBoundingClientRect();
        const position = pointerGlassVars(event, bounds, { elasticShift: 0 });
        const reach = Math.round(Math.max(155, Math.min(300, bounds.width * 0.38)));
        // The animated properties are inherited by the inner light layer.
        // Neither resizing nor applying a filter to the interactive card is needed.
        const keyframe = (offset, size, alpha, scale) => ({
          offset, '--glass-ripple-size': `${size}px`, '--glass-ripple-alpha': alpha,
          '--glass-light-scale': scale, '--glass-press-x': position['--glass-x'],
          '--glass-press-y': position['--glass-y'],
        });
        const animation = pressed.animate([
          keyframe(0, 12, 0.54, 0.96),
          keyframe(0.19, 48, 1, 0.985),
          keyframe(0.42, Math.round(reach * 0.61), 0.74, 1),
          keyframe(0.63, Math.round(reach * 0.83), 0.45, 0.996),
          keyframe(1, reach, 0, 1),
        ], { duration: 460, easing: 'cubic-bezier(0.18, 0.62, 0.32, 1)' });
        pressMotion = animation;
        animation.onfinish = () => { if (pressMotion === animation) pressMotion = null; };
      };

      const invalidateRect = () => { rect = null; };
      const onWindowBlur = () => { if (card !== null) reset(); pressMotion?.cancel(); pressMotion = null; };
      const onVisibility = () => { if (doc?.visibilityState === 'hidden') onWindowBlur(); };

      function attachMove() {
        if (moveAttached || !canListen) return;
        win.addEventListener('pointermove', onMove, { capture: true, passive: true });
        moveAttached = true;
      }
      function detachMove() {
        if (!moveAttached) return;
        win.removeEventListener('pointermove', onMove, true);
        moveAttached = false;
      }

      const attachBoundary = () => {
        if (!canListen || boundaryAttached) return;
        doc.addEventListener('pointerover', onOver, { capture: true, passive: true });
        doc.addEventListener('pointerout', onOut, { capture: true, passive: true });
        doc.addEventListener('pointerdown', onPress, { capture: true, passive: true });
        win.addEventListener('blur', onWindowBlur);
        reduceMQ?.addEventListener?.('change', onWindowBlur);
        doc.addEventListener('visibilitychange', onVisibility);
        win.addEventListener('resize', invalidateRect, { passive: true });
        doc.addEventListener('scroll', invalidateRect, { capture: true, passive: true });
        boundaryAttached = true;
      };
      const detachBoundary = () => {
        if (!canListen || !boundaryAttached) return;
        doc.removeEventListener('pointerover', onOver, true);
        doc.removeEventListener('pointerout', onOut, true);
        doc.removeEventListener('pointerdown', onPress, true);
        win.removeEventListener('blur', onWindowBlur);
        reduceMQ?.removeEventListener?.('change', onWindowBlur);
        doc.removeEventListener('visibilitychange', onVisibility);
        win.removeEventListener('resize', invalidateRect);
        doc.removeEventListener('scroll', invalidateRect, { capture: true });
        boundaryAttached = false;
      };

      return {
        /** @param ms - minimum interval between light updates, or zero for rAF only. */
        enable(ms = 0, water = false) {
          intervalMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
          pressEnabled = water;
          if (!water) pressMotion?.cancel();
          if (enabled || !canListen) return;
          enabled = true;
          attachBoundary();
        },
        disable() {
          if (!enabled) return;
          enabled = false;
          pressMotion?.cancel();
          pressMotion = null;
          reset();
          detachBoundary();
        },
      };
    }
    // ---------------------------------------------------------------------
    // Optional interface motion
    // ---------------------------------------------------------------------

    const MOTION_CSS = `
@media (prefers-reduced-motion: no-preference) {
  body[${MOTION_ATTR}] :is(.cctButton, [data-composer-card] button):not(:disabled, [aria-disabled="true"]) {
    transition: translate 140ms ease-out, opacity 140ms ease-out,
      background-color 140ms ease-out, border-color 140ms ease-out, color 140ms ease-out;
  }
  body[${MOTION_ATTR}] :is(.cctButton, [data-composer-card] button):active:not(:disabled, [aria-disabled="true"]) {
    translate: 0 1px;
    opacity: 0.82;
    transition-duration: 75ms;
  }
  body[${MOTION_ATTR}] .cctStatus { animation: dsh-custom-theme-enter 160ms ease-out; }
  @keyframes dsh-custom-theme-enter { from { opacity: 0; translate: 0 3px; } }
}
@media (prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine) {
  body[${MOTION_ATTR}] [data-composer-card] button:hover:not(:active, :disabled, [aria-disabled="true"]) {
    translate: 0 -1px;
  }
}
@media (prefers-reduced-motion: no-preference) and (forced-colors: none) {
  ${FADE_STEPS.map((opacity, index) => `body[${MOTION_ATTR}] :is(${STREAM_SELECTOR}, ${STREAM_SELECTOR} *)::highlight(dsh-custom-theme-stream-${index}) {
    color: color-mix(in srgb, currentColor ${opacity}%, transparent);
  }`).join('\n')}
}
`;

    /** Fade newly committed text in place, with no extra nodes or layout reads. */
    function observeStreamReveal(doc, win) {
      const registry = win.CSS?.highlights;
      if (!registry || typeof win.Highlight !== 'function' || typeof win.StaticRange !== 'function'
        || typeof win.MutationObserver !== 'function' || typeof win.matchMedia !== 'function') return () => {};

      const preference = win.matchMedia('(prefers-reduced-motion: reduce), (forced-colors: active)');
      const names = FADE_STEPS.map((_, index) => `dsh-custom-theme-stream-${index}`);
      const streams = new Map();
      const dirty = new Set();
      const textLimit = 24_000;
      const duration = names.length * FADE_STEP_MS;
      let timer = null;

      function paint() {
        if (timer !== null) win.clearTimeout(timer);
        timer = null;
        const now = win.performance.now();
        const buckets = names.map(() => []);
        let nextPaint = Infinity;
        for (const [root, stream] of streams) {
          if (!root.isConnected || !root.matches(STREAM_SELECTOR)) {
            streams.delete(root);
            continue;
          }
          if (dirty.has(root)) {
            const text = root.textContent;
            const previous = stream.text;
            if (text.length <= textLimit && previous !== null && text.startsWith(previous)) {
              if (text.length > previous.length) stream.spans.push({
                start: previous.length, end: text.length, time: now,
              });
            } else {
              stream.spans = [];
              // A streaming paragraph can precede an existing Markdown block.
              // Highlight an insertion there while skipping true rewrites.
              if (previous !== null && text.length <= textLimit && text.length > previous.length) {
                let start = 0;
                while (start < previous.length && text[start] === previous[start]) start++;
                if (text.endsWith(previous.slice(start))) stream.spans.push({
                  start, end: start + text.length - previous.length, time: now,
                });
              }
            }
            stream.text = text.length <= textLimit ? text : null;
            stream.ranges = [];
          }
          stream.spans = stream.spans.filter(span => now - span.time < duration);
          if (stream.spans.length === 0) {
            stream.ranges = [];
            continue;
          }

          if (dirty.has(root)) {
            const walker = doc.createTreeWalker(root, win.NodeFilter.SHOW_TEXT);
            let offset = 0;
            let first = 0;
            for (let node = walker.nextNode(); node && first < stream.spans.length; node = walker.nextNode()) {
              const end = offset + node.length;
              while (first < stream.spans.length && stream.spans[first].end <= offset) first++;
              for (let index = first; index < stream.spans.length && stream.spans[index].start < end; index++) {
                const span = stream.spans[index];
                if (span.end <= offset || end === offset
                  || node.parentElement?.closest('pre, code, button, [aria-hidden="true"]')) continue;
                stream.ranges.push({ time: span.time, range: new win.StaticRange({
                  startContainer: node, endContainer: node,
                  startOffset: Math.max(0, span.start - offset), endOffset: Math.min(node.length, span.end - offset),
                }) });
              }
              offset = end;
            }
          }
          stream.ranges = stream.ranges.filter(({ time }) => now - time < duration);
          for (const { time, range } of stream.ranges) {
            const age = now - time;
            buckets[Math.floor(age / FADE_STEP_MS)].push(range);
            nextPaint = Math.min(nextPaint, FADE_STEP_MS - age % FADE_STEP_MS);
          }
        }
        dirty.clear();
        for (const [index, ranges] of buckets.entries()) {
          if (ranges.length) registry.set(names[index], new win.Highlight(...ranges));
          else registry.delete(names[index]);
        }
        if (nextPaint !== Infinity) timer = win.setTimeout(paint, nextPaint);
      }

      function track(root, animate) {
        if (!streams.has(root)) {
          const text = animate ? '' : root.textContent;
          streams.set(root, { text: text.length <= textLimit ? text : null, spans: [], ranges: [] });
        }
        if (animate) dirty.add(root);
      }

      const observer = new win.MutationObserver(records => {
        let changed = false;
        for (const record of records) {
          const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
          const root = target?.closest(STREAM_SELECTOR);
          if (root) track(root, true);
          if (record.type === 'attributes' || (streams.size && record.removedNodes.length)) changed = true;
          if (root || record.type !== 'childList') continue;
          for (const node of record.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.matches(STREAM_SELECTOR)) track(node, true);
            for (const child of node.querySelectorAll(STREAM_SELECTOR)) track(child, true);
          }
        }
        // Mutation observers run before the next paint. Register the new tone
        // now so a fresh letter cannot flash at full contrast before fading in.
        if (changed || dirty.size) paint();
      });

      function sync() {
        observer.disconnect();
        if (timer !== null) win.clearTimeout(timer);
        timer = null;
        streams.clear();
        dirty.clear();
        for (const name of names) registry.delete(name);
        if (preference.matches || doc.hidden) return;
        for (const root of doc.body.querySelectorAll(STREAM_SELECTOR)) track(root, false);
        observer.observe(doc.body, { subtree: true, childList: true, characterData: true,
          attributes: true, attributeFilter: ['data-streaming'] });
      }

      preference.addEventListener('change', sync);
      doc.addEventListener('visibilitychange', sync);
      sync();
      return () => {
        observer.disconnect();
        if (timer !== null) win.clearTimeout(timer);
        preference.removeEventListener('change', sync);
        doc.removeEventListener('visibilitychange', sync);
        for (const name of names) registry.delete(name);
      };
    }

    // ---------------------------------------------------------------------
    // Theme controller
    // ---------------------------------------------------------------------

    /**
     * Owns the one override layer this plugin stacks on the active theme.
     *
     * Exactly one layer exists at a time, under one fixed source, so re-applying
     * replaces it instead of piling layers up. Every mutation re-derives the
     * token map and re-stacks the layer; listeners re-render the settings page.
     *
     * @param resolveTheme - returns the live `ctx.theme` service.
     */
    function createController(resolveTheme) {
      const listeners = new Set();
      const pointerGlass = createPointerGlass();
      let state = loadSaved();
      let disposer = null;
      let lastCount = 0;
      let dom = { style: null, layer: null, media: null, mediaKey: '' };
      let disposed = false;
      let captionFill = null;
      let captionDrag = null;
      let stopMotion = null;

      const applyMotion = () => {
        if (!state.motion) {
          stopMotion?.();
          stopMotion = null;
          return;
        }
        if (stopMotion !== null || !document.body) return;
        const body = document.body;
        const style = document.createElement('style');
        style.dataset.plugin = PLUGIN_ID;
        style.dataset.pluginCss = `${PLUGIN_ID}/motion`;
        style.textContent = MOTION_CSS;
        document.head.appendChild(style);
        body.setAttribute(MOTION_ATTR, '');
        const stopReveal = observeStreamReveal(document, window);
        stopMotion = () => {
          stopReveal();
          body.removeAttribute(MOTION_ATTR);
          style.remove();
        };
      };

      const emit = () => {
        if (disposed) return;
        for (const listener of listeners) listener();
      };

      /** Drop the current token layer; a no-op when none is stacked. */
      const clear = () => {
        try {
          if (typeof disposer === 'function') disposer();
        } finally {
          disposer = null;
          lastCount = 0;
        }
      };

      /** Remove every DOM node this plugin created for the wallpaper. */
      const teardownDom = () => {
        if (captionDrag !== null) captionDrag.remove();
        captionDrag = null;
        if (dom.media !== null && dom.media.tagName === 'VIDEO') {
          try { dom.media.pause(); } catch { /* already gone */ }
          dom.media.removeAttribute('src');
          try { dom.media.load(); } catch { /* noop */ }
        }
        if (dom.style !== null) dom.style.remove();
        // B1: the wallpaper layer itself used to be left in the document on
        // every teardown, so repeated enable/disable accumulated duplicate
        // #dsh-custom-theme-backdrop nodes (and their media elements).
        if (dom.layer !== null) dom.layer.remove();
        const body = typeof document === 'undefined' ? null : document.body;
        if (body !== undefined && body !== null && typeof body.removeAttribute === 'function') {
          body.removeAttribute(BACKDROP_ATTR);
          body.removeAttribute(GLASS_ATTR);
        }
        dom = { style: null, layer: null, media: null, mediaKey: '' };
      };

      /**
       * Update the wallpaper layer.
       *
       * Dragging a slider must not reload a `<video>` (that restarts decoding
       * every frame), so the media element is reused whenever its source and
       * kind are unchanged; only the stylesheet is replaced. A source/kind
       * change rebuilds the element.
       */
      const applyDom = () => {
        const bd = state.backdrop;
        const css = buildBackdropCss(bd, captionFill);
        const body = typeof document === 'undefined' ? null : document.body;
        if (css === '' || body === null || body === undefined
          || typeof body.appendChild !== 'function') { teardownDom(); return; }

        const mediaInfo = describeMedia(bd);
        const mediaKey = mediaInfo === null ? '' : `${mediaInfo.tag}:${mediaInfo.attributes.src}`;

        // Full rebuild only when the media identity changes.
        if (dom.layer !== null && dom.mediaKey !== mediaKey) {
          if (dom.media !== null && dom.media.tagName === 'VIDEO') {
            try { dom.media.pause(); } catch { /* noop */ }
            dom.media.removeAttribute('src');
            try { dom.media.load(); } catch { /* noop */ }
          }
          dom.layer.remove();
          dom.layer = null;
          dom.media = null;
          dom.mediaKey = '';
        }

        if (dom.style === null) {
          const style = document.createElement('style');
          style.dataset.plugin = PLUGIN_ID;
          style.dataset.pluginCss = `${PLUGIN_ID}/backdrop`;
          style.textContent = css;
          document.head.appendChild(style);
          dom.style = style;
        } else if (dom.style.textContent !== css) {
          dom.style.textContent = css;
        }

        const needsCaptionDrag = bd.enabled === true && bd.source !== ''
          && document.documentElement.hasAttribute('data-windows-titlebar');
        if (needsCaptionDrag && captionDrag === null) {
          captionDrag = document.createElement('div');
          captionDrag.id = 'dsh-custom-theme-window-drag';
          captionDrag.setAttribute('aria-hidden', 'true');
          body.appendChild(captionDrag);
        } else if (!needsCaptionDrag && captionDrag !== null) {
          captionDrag.remove();
          captionDrag = null;
        }

        if (dom.layer === null && mediaInfo !== null) {
          const layer = document.createElement('div');
          layer.id = BACKDROP_LAYER_ID;
          // DSH >= 0.2.2-rc.2 (macOS "window-drag-regions"): Desktop no longer
          // grants a global no-drag exclusion to arbitrary content, so an
          // overlay that can cover a header must declare its own region. This
          // layer covers the whole window, so it declares itself as excluded —
          // otherwise it would contribute a draggable rectangle over the header.
          // It is also `pointer-events: none`, so this only affects the window
          // region computation, never clicks. Harmless on Web and Windows,
          // where the attribute is not read.
          layer.setAttribute('data-window-drag-exclude', '');
          const media = document.createElement(mediaInfo.tag);
          for (const [key, value] of Object.entries(mediaInfo.attributes)) {
            if (value === true) media.setAttribute(key, '');
            else if (value !== false) media.setAttribute(key, String(value));
          }
          layer.appendChild(media);
          const scrim = document.createElement('div');
          scrim.className = 'dsh-backdrop-scrim';
          layer.appendChild(scrim);
          body.appendChild(layer);
          dom.layer = layer;
          dom.media = media;
          dom.mediaKey = mediaKey;

          if (mediaInfo.tag === 'video' && shouldPauseVideo(bd)) {
            try { media.pause(); media.removeAttribute('autoplay'); } catch { /* noop */ }
          }
        } else if (dom.media !== null && dom.media.tagName === 'VIDEO') {
          // Reduced-motion may change without the media identity changing.
          if (shouldPauseVideo(bd)) {
            try { dom.media.pause(); dom.media.removeAttribute('autoplay'); } catch { /* noop */ }
          } else if (!dom.media.hasAttribute('autoplay')) {
            dom.media.setAttribute('autoplay', '');
            try { const play = dom.media.play(); if (play && play.catch) play.catch(() => {}); } catch { /* noop */ }
          }
        }

        if (bd.enabled === true && bd.source !== '') body.setAttribute(BACKDROP_ATTR, 'on');
        else body.removeAttribute(BACKDROP_ATTR);
        if (bd.glass) body.setAttribute(GLASS_ATTR, 'on');
        else body.removeAttribute(GLASS_ATTR);
      };

      /**
       * Stack the current state's tokens on top of the active theme. The theme
       * colours and the wallpaper translucency share one override layer so a
       * single teardown removes everything.
       */
      const reapply = (prepared) => {
        clear();
        const theme = resolveTheme();
        if (theme === undefined) return { count: 0, warnings: [] };

        const tokens = {};
        let warnings = [];
        if (state.enabled && state.css.trim() !== '') {
          const built = prepared ?? buildOverrides(parseThemeInput(state.css), state.options);
          Object.assign(tokens, built.tokens);
          warnings = built.warnings;
        }
        // Wallpaper translucency uses the theme's concrete surface colours.
        // Save the ORIGINAL opaque sidebar fill before it is replaced, so the
        // Windows caption strip (which shares that token) can be repainted
        // opaque and stay draggable — see buildBackdropCss().
        captionFill = (() => {
          const original = tokens['--dsw-specific-sidebar-fill'];
          if (original && typeof original.light === 'string' && typeof original.dark === 'string') {
            return { light: original.light, dark: original.dark };
          }
          return null;
        })();
        Object.assign(tokens, buildBackgroundTokens(state.backdrop, tokens));
        if (Object.keys(tokens).length === 0) return { count: 0, warnings };

        disposer = theme.overrideTokens(PLUGIN_ID, tokens);
        lastCount = Object.keys(tokens).length;
        return { count: lastCount, warnings };
      };

      /**
       * Re-render tokens and DOM. `tokensDirty` is false when only backdrop
       * sliders changed: the ~260 token writes and style-table reparse are
       * then skipped, which keeps the settings page from stalling a live
       * stream on every keystroke.
       */
      const refresh = (tokensDirty = true, prepared) => {
        let warnings = [];
        if (tokensDirty) warnings = reapply(prepared).warnings;
        applyDom();
        const bd = state.backdrop;
        if (bd.glass !== true) {
          // Glass off: no listeners, no per-frame work at all.
          pointerGlass.disable();
        } else if (isLiteGlass(bd)) {
          // "流畅 / lite": the biggest win for low-end PCs. A static specular
          // surface needs zero pointer listeners and zero CSS-variable writes
          // while the user types — only one shallow blur() remains.
          pointerGlass.disable();
        } else {
          pointerGlass.enable(bd.performance ? 32 : 0, !bd.performance && bd.refract > 0);
        }
        return { count: lastCount, warnings };
      };

      const persist = () => save({ ...state });

      return {
        /** Current state, for the settings page. */
        get() { return state; },
        /** How many tokens the live layer overrides. */
        count() { return lastCount; },
        /**
         * Live runtime facts, shown in the settings page so a broken visual
         * result can be diagnosed without devtools.
         */
        diagnose() {
          const bd = state.backdrop;
          const checked = bd.source === '' ? null : checkBackgroundUrl(bd.source, bd.kind);
          return {
            enabled: bd.enabled,
            glass: bd.glass,
            sourceLength: bd.source.length,
            sourceError: checked !== null && checked.ok === false ? checked.reason : null,
            cssLength: buildBackdropCss(bd).length,
            layerPresent: typeof document !== 'undefined'
              && typeof document.getElementById === 'function'
              && document.getElementById(BACKDROP_LAYER_ID) !== null,
            bodyMarked: typeof document !== 'undefined' && document.body !== undefined
              && document.body !== null && typeof document.body.getAttribute === 'function'
              && document.body.getAttribute(BACKDROP_ATTR) === 'on',
            glassMarked: typeof document !== 'undefined' && document.body !== undefined
              && document.body !== null && typeof document.body.getAttribute === 'function'
              && document.body.getAttribute(GLASS_ATTR) === 'on',
            tokenCount: lastCount,
            motion: state.motion,
            streamingFadeSupported: typeof window.Highlight === 'function' && !!window.CSS?.highlights,
            backdropFilterSupported: typeof window.CSS?.supports === 'function'
              ? window.CSS.supports('backdrop-filter', 'blur(1px)')
                || window.CSS.supports('-webkit-backdrop-filter', 'blur(1px)')
              : null,
          };
        },
        /**
         * Merge new state and re-stack the layer.
         *
         * @param patch - state fields to replace.
         * @returns `{ count, warnings, saveError }`.
         */
        update(patch) {
          if (disposed) return { count: 0, warnings: [], saveError: null };
          const prev = state;
          // A partial backdrop patch merges into the existing settings instead
          // of resetting every other slider back to its default.
          let backdrop = prev.backdrop;
          if (patch.backdrop !== undefined) {
            const normalized = normalizeBackdrop({ ...prev.backdrop, ...patch.backdrop });
            if (patch.backdrop.source !== undefined && normalized.sourceError !== null) {
              return { count: lastCount, warnings: [], saveError: null, sourceError: normalized.sourceError };
            }
            backdrop = normalized.backdrop;
          }
          const next = { ...prev, ...patch, backdrop };
          if (patch.options !== undefined) next.options = normalizeOptions(patch.options);
          let prepared;
          if (patch.css !== undefined && next.enabled) {
            prepared = buildOverrides(parseThemeInput(next.css), next.options);
            if (Object.keys(prepared.tokens).length === 0) {
              return { count: 0, warnings: prepared.warnings, saveError: null, rejected: true };
            }
          }
          state = next;
          const hasWallpaper = bd => bd.enabled && bd.source !== '';
          // Shell transparency depends on the presence of active wallpaper.
          // Sliders and valid-to-valid source changes need no token writes.
          const tokensDirty = patch.css !== undefined || patch.enabled !== undefined
            || patch.options !== undefined || hasWallpaper(prev.backdrop) !== hasWallpaper(backdrop);
          if (prev.motion !== next.motion) applyMotion();
          const result = refresh(tokensDirty, prepared);
          const saveError = persist();
          emit();
          return {
            count: result.count,
            warnings: result.warnings,
            saveError,
            sourceError: null,
          };
        },
        /** Remove the theme colours (the wallpaper is an independent setting). */
        reset() {
          if (disposed) return { saveError: null, count: 0 };
          state = { ...state, css: '', name: '', enabled: false };
          const result = refresh(true);
          const saveError = persist();
          emit();
          return { saveError, count: result.count };
        },
        /** Stack the saved layer as soon as the plugin runs. */
        restore() {
          if (disposed) return 0;
          applyMotion();
          const result = refresh(true);
          emit();
          return result.count;
        },
        /** Drop everything (plugin teardown). */
        dispose() {
          if (disposed) return;
          disposed = true;
          clear();
          stopMotion?.();
          pointerGlass.disable();
          teardownDom();
          listeners.clear();
        },
        /** Subscribe to state changes; returns the unsubscriber. */
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
    }

    // ---------------------------------------------------------------------
    // Settings page
    // ---------------------------------------------------------------------

    /**
     * Build the settings section component.
     *
     * @param t - the bound translate function.
     * @param controller - the theme controller.
     * @returns the React component.
     */
    function makeSection(t, controller) {
      return function CustomThemeSection() {
        const [, bump] = useState(0);
        const [draft, setDraft] = useState(() => controller.get().css);
        const [status, setStatus] = useState(null);
        const [showDetail, setShowDetail] = useState(false);
        const [backdropStatus, setBackdropStatus] = useState(null);
        const [urlDraft, setUrlDraft] = useState(null);

        // Re-render when the controller changes state anywhere else.
        useEffect(() => controller.subscribe(() => bump(value => value + 1)), [controller]);

        const state = controller.get();
        const options = state.options;
        const applied = state.enabled && state.css !== '' ? state : null;

        const appliedParsed = useMemo(
          () => (applied === null ? null : parseThemeInput(applied.css)),
          [applied === null ? '' : applied.css],
        );
        const draftParsed = useMemo(() => (draft.trim() === '' ? null : parseThemeInput(draft)), [draft]);
        const preview = draftParsed ?? appliedParsed;

        const onApply = useCallback(() => {
          if (draft.trim() === '') {
            setStatus({ kind: 'err', text: t('status.empty') });
            return;
          }
          const result = controller.update({ css: draft, name: '', enabled: true });
          if (result.rejected || result.count === 0) {
            setStatus({ kind: 'err', text: t('status.nothing') });
            return;
          }
          if (result.saveError !== null) {
            setStatus({ kind: 'err', text: `${t('status.saveFailed')}: ${result.saveError}` });
            return;
          }
          setStatus({ kind: 'ok', text: format(t('status.applied'), { count: result.count }) });
        }, [draft, controller, t]);

        const onReset = useCallback(() => {
          const result = controller.reset();
          setStatus({
            kind: result.saveError === null ? 'ok' : 'err',
            text: result.saveError === null
              ? t('status.reset')
              : `${t('status.saveFailed')}: ${result.saveError}`,
          });
        }, [controller, t]);

        const onPreset = useCallback((event) => {
          const id = event.target.value;
          if (id === '') return;
          const preset = PRESETS.find(entry => entry.id === id);
          if (preset === undefined) return;
          setDraft(preset.css);
          setStatus({ kind: 'ok', text: format(t('status.preset'), { name: preset.label }) });
        }, [t]);

        const onLoadCurrent = useCallback(() => {
          const current = controller.get();
          if (current.css !== '') setDraft(current.css);
        }, [controller]);

        /** One mapping switch re-stacks the live layer immediately. */
        const setOption = useCallback((key, value) => {
          const next = { ...controller.get().options, [key]: value };
          const result = controller.update({ options: next });
          if (result.saveError !== null) {
            setStatus({ kind: 'err', text: `${t('status.saveFailed')}: ${result.saveError}` });
          }
        }, [controller, t]);

        /** One wallpaper control; merges into current settings. */
        const GLASS_KEYS = new Set([
          'glassOpacity', 'glassBlur', 'glassSaturate', 'glassRadius',
          'glassHighlight', 'glassShadow', 'refract', 'refractFrequency',
          'performance',
        ]);

        const updateBackdrop = useCallback((patch) => {
          const result = controller.update({ backdrop: patch });
          if (result.saveError !== null) {
            setBackdropStatus({ kind: 'err', text: `${t('status.saveFailed')}: ${result.saveError}` });
          } else if (result.sourceError !== null && result.sourceError !== undefined) {
            setBackdropStatus({ kind: 'err', text: t('bg.errUrl').replace('{reason}', result.sourceError) });
          } else {
            setBackdropStatus(null);
            return true;
          }
          return false;
        }, [controller, t]);

        const setBackdrop = (key, value) => updateBackdrop(GLASS_KEYS.has(key)
          ? { [key]: value, glassPreset: 'custom' } : { [key]: value });

        /** Apply a whole named glass look in one controller update. */
        const setGlassPreset = useCallback((id) => {
          const values = GLASS_PRESETS[id];
          if (updateBackdrop({ ...values, glassPreset: id }) && values !== undefined) {
            setBackdropStatus({ kind: 'ok', text: t('bg.presetApplied') });
          }
        }, [updateBackdrop, t]);

        const bd = state.backdrop;

        /**
         * A labelled range input PLUS a discrete-stop dropdown. Both are kept
         * (the user asked for a choice instead of only dragging): picking a
         * stop sets the exact value, dragging the slider moves the dropdown to
         * "custom". The two controls read/write the same state, so they stay
         * in sync automatically.
         */
        const slider = (key, label, min, max, step, suffix) => {
          const stops = SLIDER_STEPS[key] ?? [];
          const current = bd[key];
          const selected = stops.includes(current) ? String(current) : 'custom';
          return h('div', { key: `s-${key}`, className: 'cctSliderRow' }, [
            h('label', { key: 'l', className: 'cctSliderLabel', htmlFor: `cct-${key}` }, label),
            stops.length === 0 ? null : h('select', {
              key: 'd', className: 'cctStepSelect', value: selected,
              'aria-label': `${label} · ${t('bg.stepSelect')}`,
              onChange: event => {
                if (event.target.value === 'custom') return;
                setBackdrop(key, Number(event.target.value));
              },
            }, [
              ...stops.map(value => h('option', { key: String(value), value: String(value) }, `${value}${suffix ?? ''}`)),
              h('option', { key: 'custom', value: 'custom' }, t('bg.stepCustom')),
            ]),
            h('input', {
              key: 'i', id: `cct-${key}`, type: 'range', min, max, step,
              value: current,
              onChange: event => setBackdrop(key, Number(event.target.value)),
            }),
            h('span', { key: 'v', className: 'cctSliderValue' }, `${current}${suffix ?? ''}`),
          ]);
        };

        const toggle = (key, label) => h('label', { key: `c-${key}`, className: 'cctCheck' }, [
          h('input', {
            key: 'i', type: 'checkbox', checked: bd[key] === true,
            onChange: event => setBackdrop(key, event.target.checked),
          }),
          label,
        ]);

        /**
         * Pick a local image. Real photos are several MB, far beyond a sane
         * localStorage budget, so downscale to <=1920px and re-encode as JPEG
         * before storing. Any failure is reported in the status line instead of
         * silently leaving the wallpaper empty.
         */
        const onPickFile = useCallback((event) => {
          const file = event.target.files?.[0];
          if (file === undefined) return;
          if (!/^image\/(png|jpe?g|webp|gif|avif|bmp)$/i.test(file.type)) {
            setBackdropStatus({ kind: 'err', text: t('bg.errImageOnly') });
            return;
          }
          const reader = new FileReader();
          reader.onerror = () => setBackdropStatus({ kind: 'err', text: t('bg.errRead') });
          reader.onload = () => {
            if (typeof reader.result !== 'string') return;
            const img = new Image();
            img.onerror = () => {
              setBackdropStatus({ kind: 'err', text: t('bg.errRead') });
            };
            img.onload = () => {
              try {
                const maxSide = 1920;
                const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
                canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
                const g = canvas.getContext('2d');
                if (g === null) throw new Error('no 2d context');
                g.drawImage(img, 0, 0, canvas.width, canvas.height);
                let out = canvas.toDataURL('image/jpeg', 0.82);
                if (out.length > MAX_DATA_URL_BYTES) out = canvas.toDataURL('image/jpeg', 0.6);
                if (out.length > MAX_DATA_URL_BYTES) {
                  setBackdropStatus({ kind: 'err', text: t('bg.errTooLarge') });
                  return;
                }
                if (updateBackdrop({ kind: 'image', source: out })) {
                  setUrlDraft(null);
                  setBackdropStatus({ kind: 'ok', text: t('bg.pickOk') });
                }
              } catch (error) {
                setBackdropStatus({ kind: 'err', text: `${t('bg.errRead')}: ${String(error)}` });
              }
            };
            img.src = reader.result;
          };
          reader.readAsDataURL(file);
        }, [updateBackdrop, t]);

        const detail = useMemo(() => {
          if (appliedParsed === null) return null;
          return buildOverrides(appliedParsed, options);
        }, [appliedParsed, options]);

        const swatches = useMemo(() => {
          if (preview === null) return [];
          const light = preview.light ?? {};
          const picks = [
            ['--background', light.background],
            ['--foreground', light.foreground],
            ['--primary', light.primary],
            ['--secondary', light.secondary],
            ['--muted', light.muted],
            ['--accent', light.accent],
            ['--destructive', light.destructive],
            ['--border', light.border],
            ['--sidebar', light.sidebar],
          ];
          return picks.filter(([, value]) => typeof value === 'string' && value !== '');
        }, [preview]);

        const warnings = useMemo(() => {
          const list = (preview?.warnings ?? []).map((text) => (
            text === 'single-scheme theme: light and dark palettes are identical'
              ? t('warn.singleScheme')
              : text
          ));
          return [...new Set(list)].slice(0, 24);
        }, [preview, t]);

        const overrideRows = useMemo(() => {
          if (detail === null) return [];
          return describeOverrides(detail.tokens);
        }, [detail]);

        return h('div', { className: 'cctRoot' }, [
          h('div', { className: 'cctCard', key: 'intro' }, [
            h('div', { className: 'cctTitle', key: 'title' }, t('intro.title')),
            h('div', { className: 'cctHint', key: 'hint' }, [
              t('intro.hint1') + ' ',
              h('a', {
                key: 'link',
                href: 'https://tweakcn.com/',
                target: '_blank',
                rel: 'noreferrer noopener',
              }, 'tweakcn.com'),
              ' ' + t('intro.hint2'),
            ]),
            h('div', { className: 'cctHint', key: 'rule' }, t('intro.rule')),
          ]),

          h('div', { className: 'cctCard', key: 'motion' }, [
            h('label', { key: 'toggle', className: 'cctCheck' }, [
              h('input', {
                key: 'input', type: 'checkbox', checked: state.motion,
                onChange: event => {
                  const { saveError } = controller.update({ motion: event.target.checked });
                  setStatus(saveError === null ? null
                    : { kind: 'err', text: `${t('status.saveFailed')}: ${saveError}` });
                },
              }),
              t('motion.enable'),
            ]),
            h('div', { key: 'hint', className: 'cctHint' }, t('motion.hint')),
          ]),

          // ---- Wallpaper + liquid glass ------------------------------------
          h('div', { className: 'cctCard', key: 'backdrop' }, [
            h('div', { className: 'cctTitle', key: 'title' }, t('bg.title')),
            h('div', { className: 'cctHint', key: 'hint' }, t('bg.hint')),

            toggle('enabled', t('bg.enable')),

            h('div', { className: 'cctRow', key: 'kind' }, [
              h('label', { key: 'l', className: 'cctInlineLabel' }, t('bg.kind')),
              h('select', {
                key: 's', className: 'cctSelect', value: bd.kind,
                onChange: event => setBackdrop('kind', event.target.value),
              }, [
                h('option', { key: 'img', value: 'image' }, t('bg.kindImage')),
                h('option', { key: 'vid', value: 'video' }, t('bg.kindVideo')),
              ]),
              h('select', {
                key: 'fit', className: 'cctSelect', value: bd.fit,
                onChange: event => setBackdrop('fit', event.target.value),
              }, [
                h('option', { key: 'cover', value: 'cover' }, t('bg.fitCover')),
                h('option', { key: 'contain', value: 'contain' }, t('bg.fitContain')),
              ]),
            ]),

            h('input', {
              key: 'url', className: 'cctInputSmall', type: 'text',
              value: urlDraft ?? (bd.source.startsWith('data:') ? '' : bd.source),
              placeholder: t(bd.source.startsWith('data:') ? 'bg.localImage' : 'bg.urlPlaceholder'),
              'aria-label': t('bg.urlPlaceholder'),
              spellCheck: false,
              onChange: event => setUrlDraft(event.target.value),
              onBlur: () => {
                if (urlDraft !== null && setBackdrop('source', urlDraft)) setUrlDraft(null);
              },
              onKeyDown: event => { if (event.key === 'Enter') event.currentTarget.blur(); },
            }),
            h('div', { className: 'cctRow', key: 'filerow' }, [
              h('label', { key: 'f', className: 'cctButton', htmlFor: 'cct-bg-file' }, t('bg.pickFile')),
              h('input', {
                key: 'i', id: 'cct-bg-file', type: 'file',
                accept: 'image/png,image/jpeg,image/webp,image/gif,image/avif',
                // `display:none` file inputs are unreliable in some Electron
                // renderers; keep it focusable but visually hidden instead.
                style: { position: 'absolute', width: 1, height: 1, opacity: 0 },
                onChange: onPickFile,
              }),
              h('button', {
                key: 'clear', type: 'button', className: 'cctButton',
                onClick: () => { setUrlDraft(null); setBackdrop('source', ''); },
              }, t('bg.clear')),
            ]),
            backdropStatus === null ? null : h('div', {
              key: 'bgStatus', role: 'status',
              className: `cctStatus ${backdropStatus.kind === 'ok' ? 'cctStatusOk' : 'cctStatusErr'}`,
            }, backdropStatus.text),
            h('div', { className: 'cctHint', key: 'sec' }, t('bg.security')),

            slider('blur', t('bg.blur'), 0, 40, 1, 'px'),
            slider('dim', t('bg.dim'), 0, 70, 1, '%'),
            h('div', { className: 'cctRow', key: 'tint' }, [
              h('label', { key: 'l', className: 'cctInlineLabel' }, t('bg.tint')),
              h('input', {
                key: 'c', type: 'color', value: bd.tint === '' ? '#1b2030' : bd.tint,
                onChange: event => setBackdrop('tint', event.target.value),
              }),
              h('button', {
                key: 'x', type: 'button', className: 'cctButton',
                onClick: () => { setBackdrop('tint', ''); },
              }, t('bg.tintClear')),
            ]),
            slider('tintStrength', t('bg.tintStrength'), 0, 40, 1, '%'),

            h('div', { className: 'cctDivider', key: 'div1' }),

            toggle('glass', t('bg.glass')),
            // One-click looks: the fastest way to get a usable frame rate on
            // a low-end PC. Both the dropdown AND the sliders below remain
            // available and stay in sync.
            h('div', { className: 'cctPresetRow', key: 'glassPreset' }, [
              h('label', { key: 'l', className: 'cctInlineLabel', htmlFor: 'cct-glass-preset' }, t('bg.glassPreset')),
              h('select', {
                key: 's', id: 'cct-glass-preset', className: 'cctSelect',
                value: bd.glassPreset,
                onChange: event => setGlassPreset(event.target.value),
              }, [
                h('option', { key: 'lite', value: 'lite' }, t('bg.glassPresetLite')),
                h('option', { key: 'balanced', value: 'balanced' }, t('bg.glassPresetBalanced')),
                h('option', { key: 'fine', value: 'fine' }, t('bg.glassPresetFine')),
                h('option', { key: 'custom', value: 'custom' }, t('bg.stepCustom')),
              ]),
              h('span', { key: 'h', className: 'cctPresetHint' }, t('bg.glassPresetHint')),
            ]),
            h('div', { className: 'cctHint', key: 'glassHint' }, t('bg.glassHint')),
            slider('glassOpacity', t('bg.glassOpacity'), 0, 70, 1, '%'),
            slider('glassBlur', t('bg.glassBlur'), 0, 32, 1, 'px'),
            slider('glassSaturate', t('bg.glassSaturate'), 100, 220, 5, '%'),
            slider('glassRadius', t('bg.glassRadius'), 0, 32, 1, 'px'),
            slider('glassHighlight', t('bg.glassHighlight'), 0, 80, 1, '%'),
            slider('glassShadow', t('bg.glassShadow'), 0, 60, 1, '%'),
            slider('refract', t('bg.refract'), 0, 24, 1, ''),
            slider('refractFrequency', t('bg.refractFrequency'), 5, 30, 1, ''),

            h('div', { className: 'cctRow', key: 'flags' }, [
              toggle('performance', t('bg.performance')),
              toggle('reducedMotion', t('bg.reducedMotion')),
            ]),
            h('div', { className: 'cctHint', key: 'perfHint' }, t('bg.perfHint')),

            // Live diagnostics: if anything looks wrong the user can read the
            // exact reason here without opening devtools.
            h('div', { className: 'cctDivider', key: 'div2' }),
            h('div', { className: 'cctHint', key: 'diagTitle' }, t('bg.diagTitle')),
            h('pre', { key: 'diag', className: 'cctDiag' },
              JSON.stringify(controller.diagnose(), null, 2)),
          ]),

          h('div', { className: 'cctCard', key: 'paste' }, [
            h('div', { className: 'cctTitle', key: 'title' }, t('paste.title')),
            h('textarea', {
              key: 'input',
              className: 'cctInput',
              value: draft,
              spellCheck: false,
              placeholder: t('paste.placeholder'),
              onChange: event => setDraft(event.target.value),
            }),
            h('div', { className: 'cctRow', key: 'row' }, [
              h('button', {
                key: 'apply',
                type: 'button',
                className: 'cctButton cctButtonPrimary',
                disabled: draft.trim() === '',
                onClick: onApply,
              }, t('paste.apply')),
              h('button', {
                key: 'reset',
                type: 'button',
                className: 'cctButton cctButtonDanger',
                disabled: applied === null,
                onClick: onReset,
              }, t('paste.reset')),
              h('button', {
                key: 'detail',
                type: 'button',
                className: 'cctButton',
                disabled: overrideRows.length === 0,
                onClick: () => setShowDetail(value => !value),
              }, showDetail ? t('paste.hideDetail') : format(t('paste.showDetail'), { count: overrideRows.length })),
              h('span', { key: 'spacer', className: 'cctGrow' }),
              h('select', {
                key: 'preset',
                className: 'cctSelect',
                'data-role': 'preset',
                value: '',
                onChange: onPreset,
                'aria-label': t('preset.label'),
              }, [
                h('option', { key: '', value: '' }, t('preset.placeholder')),
                ...PRESETS.map(entry => h('option', { key: entry.id, value: entry.id }, entry.label)),
              ]),
              h('button', {
                key: 'load',
                type: 'button',
                className: 'cctButton',
                disabled: (applied?.css ?? '') === '' || applied?.css === draft,
                onClick: onLoadCurrent,
              }, t('paste.loadApplied')),
            ]),
            status === null ? null : h('div', {
              key: 'status',
              className: `cctStatus ${status.kind === 'ok' ? 'cctStatusOk' : 'cctStatusErr'}`,
            }, status.text),
          ]),

          h('div', { className: 'cctCard', key: 'mapping' }, [
            h('div', { className: 'cctTitle', key: 'title' }, t('mapping.title')),
            h('div', { className: 'cctHint', key: 'hint' }, t('mapping.hint')),
            h('div', { className: 'cctRow', key: 'row' }, [
              h('label', { key: 'borders', className: 'cctCheck' }, [
                h('input', {
                  key: 'i',
                  type: 'checkbox',
                  checked: options.borders !== 'off',
                  onChange: event => setOption('borders', event.target.checked ? 'soft' : 'off'),
                }),
                t('mapping.borders'),
              ]),
              h('label', { key: 'fonts', className: 'cctCheck' }, [
                h('input', {
                  key: 'i',
                  type: 'checkbox',
                  checked: options.fonts,
                  onChange: event => setOption('fonts', event.target.checked),
                }),
                t('mapping.fonts'),
              ]),
              h('label', { key: 'radius', className: 'cctCheck' }, [
                h('input', {
                  key: 'i',
                  type: 'checkbox',
                  checked: options.radius !== 'off',
                  onChange: event => setOption('radius', event.target.checked ? 'fit' : 'off'),
                }),
                t('mapping.radius'),
              ]),
              h('label', { key: 'extras', className: 'cctCheck' }, [
                h('input', {
                  key: 'i',
                  type: 'checkbox',
                  checked: options.extras,
                  onChange: event => setOption('extras', event.target.checked),
                }),
                t('mapping.extras'),
              ]),
              h('label', { key: 'status', className: 'cctCheck' }, [
                h('input', {
                  key: 'i',
                  type: 'checkbox',
                  checked: options.statusTint,
                  onChange: event => setOption('statusTint', event.target.checked),
                }),
                t('mapping.statusTint'),
              ]),
              h('label', { key: 'companion', className: 'cctCheck' }, [
                h('input', {
                  key: 'i',
                  type: 'checkbox',
                  checked: options.companion,
                  onChange: event => setOption('companion', event.target.checked),
                }),
                t('mapping.companion'),
              ]),
            ]),
          ]),

          swatches.length === 0 ? null : h('div', { className: 'cctCard', key: 'preview' }, [
            h('div', { className: 'cctTitle', key: 'title' }, t('preview.title')),
            h('div', { className: 'cctHint', key: 'hint' }, t('preview.hint')),
            h('div', { className: 'cctSwatches', key: 'grid' }, swatches.map(([name, value]) => h('div', {
              key: name,
              className: 'cctSwatch',
              title: `${name}: ${value}`,
            }, [
              h('span', {
                key: 'chip',
                className: 'cctChip',
                style: { background: value },
              }),
              h('span', { key: 'text', className: 'cctSwatchText' }, [
                h('span', { key: 'n', className: 'cctSwatchName' }, name),
                h('span', { key: 'v', className: 'cctSwatchValue' }, value),
              ]),
            ]))),
          ]),

          warnings.length === 0 ? null : h('div', { className: 'cctCard', key: 'warn' }, [
            h('div', { className: 'cctTitle', key: 'title' }, t('warn.title')),
            h('ul', { key: 'list', className: 'cctWarnList' }, warnings.map((text, index) => h('li', {
              key: String(index),
            }, text))),
          ]),

          !showDetail || overrideRows.length === 0 ? null : h('div', { className: 'cctCard', key: 'detail' }, [
            h('div', { className: 'cctTitle', key: 'title' }, format(t('detail.title'), { count: overrideRows.length })),
            h('div', { className: 'cctHint', key: 'hint' }, t('detail.hint')),
            h('div', { className: 'cctSwatches', key: 'grid' }, overrideRows.map(row => h('div', {
              key: row.name,
              className: 'cctSwatch',
              title: `${row.name}\nlight: ${row.light}\ndark: ${row.dark}`,
            }, [
              h('span', {
                key: 'c1',
                className: 'cctChip',
                style: { background: row.light },
              }),
              h('span', {
                key: 'c2',
                className: 'cctChip',
                style: { background: row.dark },
              }),
              h('span', { key: 'text', className: 'cctSwatchText' }, [
                h('span', { key: 'n', className: 'cctSwatchName' }, row.name.replace(TOKEN_PREFIX, '')),
                h('span', { key: 'v', className: 'cctSwatchValue' }, row.dark),
              ]),
            ]))),
          ]),
        ]);
      };
    }

    // ---------------------------------------------------------------------
    // Plugin body
    // ---------------------------------------------------------------------

    /**
     * Plugin entry.
     *
     * @param ctx - client cordis context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NAMESPACE, DICTIONARIES), 'custom-theme: dictionaries');
      const t = ctx.locale.bind(NAMESPACE);

      ctx.effect(() => {
        const tag = document.createElement('style');
        tag.dataset.plugin = PLUGIN_ID;
        tag.dataset.pluginCss = `${PLUGIN_ID}/section`;
        tag.textContent = CSS;
        document.head.appendChild(tag);
        return () => tag.remove();
      }, 'custom-theme: section stylesheet');

      // Windows window-drag repair. Independent of the wallpaper/glass
      // switches: a third-party overlay covers the whole window with
      // `-webkit-app-region:none`, which cancels DSH's draggable caption strip.
      // Scoped to `html[data-windows-titlebar]`, so other platforms get an
      // inert (but harmless) stylesheet.
      ctx.effect(() => {
        const dragCss = buildWindowDragCss();
        if (dragCss === '') return () => {};
        const tag = document.createElement('style');
        tag.dataset.plugin = PLUGIN_ID;
        tag.dataset.pluginCss = `${PLUGIN_ID}/window-drag`;
        tag.textContent = dragCss;
        document.head.appendChild(tag);
        return () => tag.remove();
      }, 'custom-theme: window drag repair');

      /** The theme service is a hard dependency; `inject` guarantees it here. */
      const resolveTheme = () => {
        const found = ctx.theme ?? ctx.get('theme');
        if (found === undefined || typeof found.overrideTokens !== 'function') return undefined;
        return found;
      };

      const controller = createController(resolveTheme);

      // Stack the saved theme as soon as the plugin runs, so a reload keeps it
      // even when the user never opens Settings. `theme` is injected, so the
      // service is already mounted and no retry loop is needed.
      ctx.effect(() => {
        controller.restore();
        return () => controller.dispose();
      }, 'custom-theme: saved theme layer');


      const Section = makeSection(t, controller);
      // `inject` runs per render, so the page follows a language switch without
      // re-registering the slot.
      ctx.slots.inject('settings.section', function* registerSection() {
        yield ctx.slots.register({
          name: 'settings.section',
          id: 'custom-theme',
          order: 32,
          label: () => t('nav'),
          inject: () => ({ t }),
        }, Section);
      });

      // `settings.section.icon` is a `list` slot the settings shell declares as
      // `{ kind: 'list', scope: 'root', inline: true }` and renders next to each
      // section label with `{ size, active }`. Without an entry the shell falls
      // back to a generic gear, so this section would look like every other
      // third-party one.
      ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
        name: 'settings.section.icon',
        id: 'custom-theme',
        order: 32,
      }, function CustomThemeIcon(props) {
        const size = typeof props?.size === 'number' ? props.size : 16;
        // A palette, drawn on a 16-unit grid so it stays crisp at 16px.
        return h('svg', {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          'aria-hidden': 'true',
          focusable: 'false',
          style: { display: 'block' },
        }, [
          h('path', {
            key: 'outline',
            d: 'M8 1.75a6.25 6.25 0 1 0 0 12.5c.9 0 1.5-.55 1.5-1.3 0-.72-.55-1.2-.55-1.95 0-.7.57-1.25 1.3-1.25h.75A3.25 3.25 0 0 0 14.25 6.5C14.25 3.9 11.45 1.75 8 1.75Z',
            stroke: 'currentColor',
            'stroke-width': '1.3',
            'stroke-linejoin': 'round',
          }),
          h('circle', { key: 'dot-a', cx: '5.4', cy: '6.2', r: '0.95', fill: 'currentColor' }),
          h('circle', { key: 'dot-b', cx: '8.1', cy: '4.6', r: '0.95', fill: 'currentColor' }),
          h('circle', { key: 'dot-c', cx: '5.4', cy: '9.2', r: '0.95', fill: 'currentColor' }),
        ]);
      }));
    }

    return {
      name: PLUGIN_ID,
      inject: ['slots', 'locale', 'theme'],
      apply,
    };
  },
});
