# Evidence & method

This document records *how* the plugin's claims were checked. It is deliberately short:
the raw upstream bundles, scraped tweakcn outputs and headless-Chrome fixtures used during
development are **not** shipped in this repository (they are large, machine-specific, and
mostly third-party code). Everything a contributor needs to re-verify the plugin is in
`tests/` and `scripts/`.

## DSH integration facts

Verified against the locally installed DeepSeek Harness client bundles
(`0.2.2-rc.1`, `desktop` profile), by reading the shipped JavaScript — not by guessing
selectors.

| Fact | Where |
| --- | --- |
| `ctx.theme.overrideTokens(source, tokens)` replaces one named layer | `@deepseek-ai/dsh-client-ui-theme` |
| `ThemePresenter` writes tokens with `body.style.setProperty(name, value)` | same bundle |
| `settings.section` is a generator-form slot registration | `@deepseek-ai/dsh-client-ui-settings` |
| `shell.overlay` is `list` / `root` / `replaceRisk: none` | slot manifest |
| `[data-composer-card]` is the stable `InputBar` attribute | `dsh-client-ui-conversation.js` |
| `[data-chat-running]`, `[data-streaming]`, `[data-holding]` | `dsh-client-ui-chat.js` L6405 / L8372 / L6406 |
| `assistant/live-chunk` concatenates `chunk.text` and re-renders the whole Markdown block | `dsh-client-ui-chat.js` |
| Only pacing is a triple `requestAnimationFrame` flush | `dsh-client-ui-conversation.js` L4045–4060 |
| `--dsw-alias-bg-layer-1` used 28 times by trajectory tables / cards | `dsh-client-ui-trajectory.js` |

Consequence: a client plugin has **no per-chunk event**, so it cannot change text arrival
rate. This is why the typing-speed feature was removed rather than faked.

## Theme parsing

`src/core.js` is pure logic: no DOM, no imports, no `window`/`document`. It is exercised by

- `tests/core.test.mjs` — 72 tests, including a VM end-to-end paste → tokens → DOM
  injection check and a read-only in-memory rebuild of `client.js`.
- `scripts/format-matrix.mjs` — 18 paste syntaxes.
- `scripts/adversarial-probe.mjs` — 42 hostile / malformed inputs (blacklist bypasses,
  self-referencing `var()`, nested at-rules, grouped selectors, NaN values).
- `scripts/generator-parity.mjs` — 10 real tweakcn generator outputs.
- `scripts/preset-sweep.mjs` — all 42 official tweakcn presets.
- `scripts/audit-findings.mjs` — regressions for every bug found in the upstream audit.
- `scripts/import-placeholder.mjs` — the official import-dialog placeholder format.

Security boundary: pasted text is parsed for `--name: value;` declarations only. It is
never inserted into a stylesheet. `isSafeValue()` rejects `url(` (including `url (`),
`image(`, `image-set(`, `-webkit-image-set(`, `cross-fade(`, `element(`, `paint(`,
`attr(`, `local(`, `@import`, `@charset`, `@font-face`, `expression(`, `javascript:`,
angle brackets, backticks, backslashes, braces, semicolons and `var(--same-name)`.

## Wallpaper & glass

`src/backdrop.js` is pure CSS/SVG generation. `tests/backdrop.test.mjs` (25 tests) covers
URL validation, clamping, token isolation, video attributes, reduced-motion / hidden-page
pausing, and a VM end-to-end DOM injection.

Headless-Chrome rule checks (development fixtures, not shipped) confirmed:

- `both` / `glass-only` / `wallpaper-only` scenarios render the intended background and
  frosted composer;
- `composerFilter: "none"` and `svgPresent: false` — no SVG filter on the composer;
- `geometryChanged: false` and `transform: "none"` — the composer's geometry is unchanged;
- `codeOpaque: true` — code blocks and theme mapping are unaffected;
- the specular highlight tracks the pointer from `calc(0% - 4.4px)` to `calc(96% + 2.5px)`.

These are **CSS-rule / computed-style checks**, not a visual pass over the live GUI.

## Default-off performance claim

```text
buildBackdropCss(DEFAULT_BACKDROP)      → ''   (0 bytes)
buildRefractionSvg(DEFAULT_BACKDROP)    → ''   (0 bytes)
buildBackgroundTokens(DEFAULT, {})      → {}
has backdrop-filter                    → false
has filter: url(                       → false
```

This is asserted by `tests/backdrop.test.mjs`. An earlier internal revision shipped with
`glass: true` and `refract: 10` by default, putting a `backdrop-filter` plus an SVG
`feTurbulence`/`feDisplacementMap` chain on the composer on every page load. Since the
message list repaints continuously during streaming, that filter was recomputed every
frame. It is now strictly opt-in.

## Honest gaps

- Network/SSE chunk transport lives on the Host side and was not byte-verified in the
  extracted client bundles; the conclusion above rests on the client-side renderer path.
- No full visual regression against the live authenticated GUI was performed — the GUI
  is served on a loopback port that rejects unauthenticated HTTP probes.
- Hashed CSS-module class names in DSH may change between releases; the plugin anchors on
  stable `data-*` attributes and uses `[class*="markdown"]` only as a fallback.
