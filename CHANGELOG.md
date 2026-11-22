# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.2.0] - 2026-11-23

- Added opt-in reply text fade-in and composer button motion that follow the system reduced-motion preference.
- Kept the frosted effect while typing. Added a soft reflection that follows the upper edge and a brief press ripple on a separate layer.
- Made wallpaper toggles update the shell transparency immediately, preserved the saved theme when an import fails, and remembered explicit font choices across restarts.

## [1.1.0] - 2026-11-19

Track DSH **0.2.2-rc.5** (the current stable build and the `nightly` feed; rc.5 is the
latest — checked against `…/feeds/win-x64/nightly.yml`, which still reports `0.2.2-rc.5`).
Every runtime contract the plugin uses was re-verified inside the shipped `app.asar`; no
breaking change affected it. Three of DSH's own changes did need work, and one existing
bug was confirmed still present.

### Added

- **17 tokens introduced in rc.5 are now mapped**, so those surfaces follow the theme
  instead of staying stock: the card plates (`card-fill`, `card-fill-hover`,
  `card-tile-fill`), the inverted hover cards and their four labels
  (`hovercard-bg`, `hovercard-label-primary/-secondary/-tertiary`,
  `hovercard-state-done/-error`), `label-on-color`, `label-error`, `border-selected`,
  the three activity charts (`chart-messages/-system/-tools`) and `trajectory-accent`.
- **A palette icon for the Settings section.** rc.5 renders a `settings.section.icon`
  list slot (`{ size, active }`) next to each section label; without an entry the shell
  falls back to a generic gear, which made this section indistinguishable from any other
  third-party one. The icon is inline SVG on a 16-unit grid and inherits `currentColor`.
- Regression tests for the new tokens and for both window-region repairs, plus an
  allowlist test that fails if DSH ever starts declaring one of the ten tokens it
  currently reads but never defines.

### Fixed

- **macOS window dragging with a wallpaper enabled.** DSH 0.2.2-rc.2 removed the global
  `no-drag` exclusion that arbitrary content used to inherit (upgrade guide
  `window-drag-regions`), so a custom overlay covering the header must now declare its own
  region. The wallpaper layer is mounted `position: fixed; inset: 0` across the window, so
  the client half now sets `data-window-drag-exclude` on it. It is already
  `pointer-events: none`, so only the region computation changes — never click behaviour.

### Changed

- **Test fixtures regenerated from 0.2.2-rc.5.** `dsh-token-defs.txt` grew from 441 to 477
  names (`token-usage.json` from 196 to 288 rows). The usage snapshot now counts `var()`
  reads in the built `lib/` bundles only, since the shipped `src/` CSS repeats the same
  rules and would double-count.
- Token coverage is now **155–171 tokens per theme** (was 140–156).
- 108 unit tests (was 97): 75 core + 33 backdrop.

### Verified, unchanged

- `__ModuleLoader__.load({ id, factory })`, `ctx.theme.overrideTokens` (still requires a
  `{ light, dark }` pair and still rejects a bare string), `ctx.locale.register` / `bind`,
  `ctx.slots.inject('settings.section')` (still `{ kind: 'list', scope: 'root' }`, function
  `label`, `order` sorting), the generator form of `ctx.effect` that `slots.inject` relies
  on, and the stable `data-ds-dark-theme` / `data-windows-titlebar` / `data-composer-card` /
  `data-window-drag` selectors.
- **A DSH-side gap, documented rather than worked around:** ten tokens that shipped
  components read (`--dsw-alias-label-error`, `--dsw-alias-fill-l1`, `--dsw-alias-bg-l2`, …)
  are never declared by DSH itself, so those consumers inherit a colour. Since an
  undeclared custom property inherits, mapping `label-error` from the theme is correct and
  the other nine stay untouched. Full table in `docs/evidence.md`.

### Documentation

- Version references corrected from 0.2.2-rc.1 to 0.2.2-rc.5 (README ×2, README.zh-CN,
  docs/evidence, CHANGELOG).
- `docs/ai-install.md` no longer reads as if installing into `desktop` were forbidden
  outright: the `dsh` CLI cannot write that profile, but the app's plugin manager can, and
  that is how a Desktop-only machine installs the plugin.

---

## [1.0.1] - 2026-11-11

Compatibility check against the installed DSH **0.2.2-rc.1** (the same build the
plugin was written against; the apparent 2026-11-09 "update" was a same-version
re-download that failed with Windows error 32). Every runtime contract the plugin
uses — the `__ModuleLoader__` closure factory, `ctx.theme.overrideTokens`,
`ctx.locale`, `ctx.slots.inject('settings.section')`, the three injected client
packages and the stable `data-*` selectors — is unchanged. **No compatibility
changes were needed.**

### Fixed

- **Fonts no longer look bold / unusable (CJK).** `buildOverrides()` and the
  settings page both defaulted `fonts` to `true`, which wrote tweakcn's
  Latin-only `--font-sans` (e.g. `Geist, sans-serif`) INLINE on `<body>` through
  `overrideTokens`. That beat DSH's built-in stack containing `PingFang SC` /
  `Microsoft YaHei` and ignored the user's own font settings; Chinese fell back
  to a system font and `font-synthesis` faked bold for the UI's many
  `font-weight:500` elements. Font takeover is now **off by default**, an
  existing saved `fonts:true` profile is migrated to `false` on load, and the
  settings page adds `font-synthesis: none` to its own cards. Explicit opt-in
  still works.

### Added

- **Dropdown choice next to every slider, with both controls kept.** Eleven
  numeric parameters now have discrete stops in a `<select>`; picking one sets
  the exact value and dragging the slider moves the dropdown to "Custom". The
  two controls read/write the same state.
- **One-click glass quality presets** — `Smooth` (recommended for low-end PCs),
  `Balanced` (the shipped defaults) and `Fine` — plus an honest `Custom` label
  whenever the numbers are hand-edited.

### Changed (performance: the reported frame drops)

- `Smooth` uses a **single `blur()`** instead of a four-pass
  `blur · saturate · brightness · contrast` chain, no refraction SVG, no hover
  transition and **no pointer-tracking listeners at all** (a static specular
  light). `Balanced` caps pointer repaints at ~30 fps with a trailing flush so
  the last cursor position is never lost; `Fine` keeps the original path.
- `glassPreset` is a persisted, validated field; stored custom numbers are
  never mislabelled as a named look.

### Tests

- 105 unit tests (73 core + 32 backdrop) plus all six compatibility / generator
  / adversarial / preset-sweep scripts. New regressions cover the font default,
  dropdown stop ranges, preset round-trips, the cheap `Smooth` CSS and the
  custom-label migration.

---

## [1.0.0] - 2026-11-08

First public release.

### Added

- **Two-palette theme import** from [tweakcn](https://tweakcn.com) CSS. Supports v4
  `oklch()`, v3 HSL triplets, `:root` / `.dark` / `[data-theme]` / `:host` / grouped
  selectors, `@theme inline` font stacks, shadcn registry JSON, markdown fences, BOM,
  CRLF and prose-wrapped pastes.
- **Single-palette companion derivation** so a light-only or dark-only community export
  still produces a legible second scheme.
- **140–156 design tokens** mapped onto DSH's alias / specific / radius / font / static-ramp
  token surface, delivered separately for light and dark.
- **Custom wallpaper**: image or video, blur / dim / tint, local image downscaling to
  1920 px + JPEG re-encode, independent of the theme paste.
- **Liquid-glass composer**: frosted `[data-composer-card]` with a pointer-following white
  specular highlight, no element transform.
- **Paste safety**: only custom-property declarations are read; the paste is never inserted
  as a stylesheet.
- **Settings page** (`settings.section`, `order: 32`) with three presets, live status,
  run-status diagnostics, and zh / en locales.
- **97 unit tests** plus six compatibility / adversarial / generator-parity probes and a
  read-only byte-for-byte freshness check for the generated `client.js`.
- **Self-contained test fixtures** — a plain `git clone` runs `npm test` offline with no
  extra checkout. Snapshots are fact data (CSS variable values / token names), not
  bundled upstream source.

### Design decisions

- **Zero CSS by default.** With glass and wallpaper off, the plugin injects no stylesheet,
  no SVG filter and no token override, so it adds no per-frame compositing cost to a live
  stream. An earlier internal revision enabled an SVG displacement filter by default; it
  was identified as the most likely cause of janky output and removed.
- **No typing-speed feature.** DSH owns chunk arrival; a client plugin cannot change it
  without rewriting the conversation renderer. The feature was removed rather than shipped
  as a cosmetic approximation.
- **Only two shell tokens** may become translucent; layer-1/2, overlay, input-major and
  static ramps stay opaque to protect code blocks, tables and popovers.
- **No `!important`** in the glass rules, so DSH's focus and error states survive.

### Removed before release

- The streaming "tail caret" / orb module (source, stylesheet, tests, settings, docs).
  It could not reliably sit at the text end without rewriting the conversation renderer.

---

[1.0.0]: https://github.com/cndoin/dsh-custom-theme/releases/tag/v1.0.0
[1.1.0]: https://github.com/cndoin/dsh-custom-theme/releases/tag/v1.1.0
[1.2.0]: https://github.com/cndoin/dsh-custom-theme/releases/tag/v1.2.0
