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
      fonts: true,
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
        return {
          css: typeof parsed.css === 'string' ? parsed.css : '',
          name: typeof parsed.name === 'string' ? parsed.name : '',
          enabled: parsed.enabled === true,
          options: normalizeOptions(parsed.options),
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
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }

    // ---------------------------------------------------------------------
    // Styles
    // ---------------------------------------------------------------------

    const CSS = `
.cctRoot { display: flex; flex-direction: column; gap: 18px; }
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
.cctSliderRow { display: grid; grid-template-columns: minmax(110px, 1fr) 2fr 48px; gap: 10px; align-items: center; }
.cctSliderLabel { font-size: 12px; color: var(--dsw-alias-label-primary); }
.cctSliderValue { font-family: var(--ds-font-family-code); font-size: 11px; color: var(--dsw-alias-label-secondary); text-align: right; }
.cctSliderRow input[type=range] { width: 100%; accent-color: var(--dsw-alias-brand-primary); }
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
     *     SVG-filtered surface never starves scrolling.
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

      const mq = (q) => (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(q) : null);
      const reduceMQ = mq('(prefers-reduced-motion: reduce)');
      const coarseMQ = mq('(pointer: coarse)');
      const fineMQ = mq('(hover: hover) and (pointer: fine)');
      const isStatic = () => reduceMQ?.matches === true || coarseMQ?.matches === true
        || fineMQ?.matches === false;

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
          // Twilight Echo: do not invalidate the filtered layer when the
          // coalesced position rounds to the same value as the last frame.
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
        detachMove();
      };

      // A `pointerover` arriving without a preceding `pointerenter` still
      // arms the card; `pointerout` with a null relatedTarget (common when
      // leaving the window / Electron chrome) is treated as a real leave.
      const isMouse = (event) => event.pointerType === undefined
        || event.pointerType === 'mouse' || event.pointerType === '';

      const flush = () => {
        frame = 0;
        // B3: re-arming a frame when the pointer already left keeps an
        // unnecessary rAF alive for every drag across the window.
        const event = pending;
        pending = null;
        if (event === null || card === null) return;
        if (isStatic() || rect === null) { write(restingGlassVars()); return; }
        write(pointerGlassVars(event, rect, { elasticShift: 6 }));
      };

      const onMove = (event) => {
        if (!enabled || card === null || !isMouse(event)) return;
        pending = { clientX: event.clientX, clientY: event.clientY };
        if (frame === 0 && typeof requestAnimationFrame === 'function') {
          frame = requestAnimationFrame(flush);
        }
      };

      const resolveCard = (target) => (
        typeof Element !== 'undefined' && target instanceof Element
          ? target.closest(SELECTOR) : null
      );

      const onOver = (event) => {
        if (!enabled || !isMouse(event)) return;
        const next = resolveCard(event.target);
        if (next === null) return;
        if (next !== card) {
          card = next;
          rect = next.getBoundingClientRect();      // measured ONCE on enter
        }
        attachMove();
        onMove(event);                              // no first-frame delay
      };

      const onOut = (event) => {
        if (!enabled || !isMouse(event)) return;
        const from = resolveCard(event.target);
        const to = resolveCard(event.relatedTarget);
        if (from === to) return;                    // moving between children
        if (to === null && from !== null) {
          // Synchronous cleanup — a fast pass must not leave a stale highlight.
          reset();
        }
      };

      const invalidateRect = () => { rect = null; };
      const onWindowBlur = () => { if (card !== null) reset(); };
      const onVisibility = () => { if (doc?.visibilityState === 'hidden') onWindowBlur(); };

      function attachMove() {
        if (moveAttached || !canListen) return;
        win.addEventListener('pointermove', onMove, { passive: true });
        moveAttached = true;
      }
      function detachMove() {
        if (!moveAttached) return;
        win.removeEventListener('pointermove', onMove);
        moveAttached = false;
      }

      const attachBoundary = () => {
        if (!canListen || boundaryAttached) return;
        doc.addEventListener('pointerover', onOver, { passive: true });
        doc.addEventListener('pointerout', onOut, { passive: true });
        win.addEventListener('blur', onWindowBlur);
        doc.addEventListener('visibilitychange', onVisibility);
        win.addEventListener('resize', invalidateRect, { passive: true });
        doc.addEventListener('scroll', invalidateRect, { capture: true, passive: true });
        boundaryAttached = true;
      };
      const detachBoundary = () => {
        if (!canListen || !boundaryAttached) return;
        doc.removeEventListener('pointerover', onOver);
        doc.removeEventListener('pointerout', onOut);
        win.removeEventListener('blur', onWindowBlur);
        doc.removeEventListener('visibilitychange', onVisibility);
        win.removeEventListener('resize', invalidateRect);
        doc.removeEventListener('scroll', invalidateRect, { capture: true });
        boundaryAttached = false;
      };

      return {
        enable() {
          if (enabled || !canListen) return;
          enabled = true;
          attachBoundary();
        },
        disable() {
          if (!enabled) return;
          enabled = false;
          reset();
          detachBoundary();
        },
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
      let dom = { style: null, layer: null, svg: null, svgKey: '', media: null, mediaKey: '' };
      let disposed = false;

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
        if (dom.media !== null && dom.media.tagName === 'VIDEO') {
          try { dom.media.pause(); } catch { /* already gone */ }
          dom.media.removeAttribute('src');
          try { dom.media.load(); } catch { /* noop */ }
        }
        if (dom.style !== null) dom.style.remove();
        if (dom.svg !== null) dom.svg.remove();
        // B1: the wallpaper layer itself used to be left in the document on
        // every teardown, so repeated enable/disable accumulated duplicate
        // #dsh-custom-theme-backdrop nodes (and their media elements).
        if (dom.layer !== null) dom.layer.remove();
        const body = typeof document === 'undefined' ? null : document.body;
        if (body !== undefined && body !== null && typeof body.removeAttribute === 'function') {
          body.removeAttribute(BACKDROP_ATTR);
          body.removeAttribute(GLASS_ATTR);
        }
        dom = { style: null, layer: null, svg: null, svgKey: '', media: null, mediaKey: '' };
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
        const css = buildBackdropCss(bd);
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

        // Stylesheet can be replaced cheaply on every update.
        if (dom.style !== null) dom.style.remove();
        const style = document.createElement('style');
        style.dataset.plugin = PLUGIN_ID;
        style.dataset.pluginCss = `${PLUGIN_ID}/backdrop`;
        style.textContent = css;
        document.head.appendChild(style);
        dom.style = style;

        // Only rebuild the SVG holder when its definition actually changed;
        // removing a filter that is currently referenced makes the composer
        // flash for one frame (and re-registers @property rules).
        const svg = buildRefractionSvg(bd);
        const svgKey = svg;
        if (dom.svg !== null && dom.svgKey !== svgKey) {
          dom.svg.remove();
          dom.svg = null;
        }
        dom.svgKey = svgKey;
        if (dom.svg === null && svg !== '') {
          const holder = document.createElement('div');
          holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
          holder.innerHTML = svg;
          body.appendChild(holder);
          dom.svg = holder;
        }

        if (dom.layer === null && mediaInfo !== null) {
          const layer = document.createElement('div');
          layer.id = BACKDROP_LAYER_ID;
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
      const reapply = () => {
        clear();
        const theme = resolveTheme();
        if (theme === undefined) return { count: 0, warnings: [] };

        const tokens = {};
        let warnings = [];
        if (state.enabled && state.css.trim() !== '') {
          const built = buildOverrides(parseThemeInput(state.css), state.options);
          Object.assign(tokens, built.tokens);
          warnings = built.warnings;
        }
        // Wallpaper translucency uses the theme's concrete surface colours.
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
      const refresh = (tokensDirty = true) => {
        let warnings = [];
        if (tokensDirty) warnings = reapply().warnings;
        applyDom();
        if (state.backdrop.glass === true) pointerGlass.enable();
        else pointerGlass.disable();
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
            backdropFilterSupported: typeof CSS !== 'undefined'
              && typeof CSS.supports === 'function'
              ? CSS.supports('backdrop-filter', 'blur(1px)')
                || CSS.supports('-webkit-backdrop-filter', 'blur(1px)')
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
            backdrop = normalizeBackdrop({ ...prev.backdrop, ...patch.backdrop }).backdrop;
          }
          state = { ...prev, ...patch, backdrop };
          if (patch.options !== undefined) state.options = normalizeOptions(patch.options);
          // Token writes are only needed when the theme CSS or its mapping
          // options changed. Backdrop-only changes just replace the stylesheet.
          const tokensDirty = patch.css !== undefined || patch.enabled !== undefined
            || patch.options !== undefined || patch.reset === true;
          const result = refresh(tokensDirty);
          const saveError = persist();
          emit();
          return {
            count: result.count,
            warnings: result.warnings,
            saveError,
            // Surface a rejected URL to the UI instead of silently clearing it.
            sourceError: patch.backdrop !== undefined && patch.backdrop.source !== undefined
              ? (normalizeBackdrop(patch.backdrop).sourceError ?? null) : null,
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
          const result = refresh(true);
          emit();
          return result.count;
        },
        /** Drop everything (plugin teardown). */
        dispose() {
          if (disposed) return;
          disposed = true;
          clear();
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
          if (result.count === 0) {
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
        const setBackdrop = useCallback((key, value) => {
          const result = controller.update({ backdrop: { [key]: value } });
          if (result.saveError !== null) {
            setStatus({ kind: 'err', text: `${t('status.saveFailed')}: ${result.saveError}` });
          } else if (result.sourceError !== null && result.sourceError !== undefined) {
            setStatus({ kind: 'err', text: t('bg.errUrl').replace('{reason}', result.sourceError) });
          }
        }, [controller, t]);

        const bd = state.backdrop;

        /** A labelled range input for the backdrop settings. */
        const slider = (key, label, min, max, step, suffix) => h('div', { key: `s-${key}`, className: 'cctSliderRow' }, [
          h('label', { key: 'l', className: 'cctSliderLabel', htmlFor: `cct-${key}` }, label),
          h('input', {
            key: 'i', id: `cct-${key}`, type: 'range', min, max, step,
            value: bd[key],
            onChange: event => setBackdrop(key, Number(event.target.value)),
          }),
          h('span', { key: 'v', className: 'cctSliderValue' }, `${bd[key]}${suffix ?? ''}`),
        ]);

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
            setStatus({ kind: 'err', text: t('bg.errImageOnly') });
            return;
          }
          const reader = new FileReader();
          reader.onerror = () => setStatus({ kind: 'err', text: t('bg.errRead') });
          reader.onload = () => {
            if (typeof reader.result !== 'string') return;
            const img = new Image();
            img.onerror = () => {
              // Some formats (AVIF) may not decode in every Electron build;
              // fall back to the raw data URL and let the validator decide.
              if (reader.result.length <= MAX_DATA_URL_BYTES) {
                setBackdrop('source', reader.result);
                setStatus({ kind: 'ok', text: t('bg.pickOk') });
              } else {
                setStatus({ kind: 'err', text: t('bg.errTooLarge') });
              }
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
                  setStatus({ kind: 'err', text: t('bg.errTooLarge') });
                  return;
                }
                setBackdrop('source', out);
                setStatus({ kind: 'ok', text: t('bg.pickOk') });
              } catch (error) {
                setStatus({ kind: 'err', text: `${t('bg.errRead')}: ${String(error)}` });
              }
            };
            img.src = reader.result;
          };
          reader.readAsDataURL(file);
        }, [setBackdrop, t]);

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
              value: bd.source, placeholder: t('bg.urlPlaceholder'),
              spellCheck: false,
              onChange: event => setBackdrop('source', event.target.value),
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
                onClick: () => setBackdrop('source', ''),
              }, t('bg.clear')),
            ]),
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
    }

    return {
      name: PLUGIN_ID,
      inject: ['slots', 'locale', 'theme'],
      apply,
    };
  },
});
