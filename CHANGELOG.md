# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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

### Fixed after v1.0.0

- **Windows caption strip**: enabling a wallpaper made `--dsw-specific-sidebar-fill`
  translucent, which also made DSH's 40px draggable caption strip transparent. On an
  acrylic Electron window the top bar then became undraggable and double-click
  maximize/restore stopped working. The strip is now repainted with the theme's original
  opaque colour, only while a wallpaper is enabled. Regression test added.

### Removed before release

- The streaming "tail caret" / orb module (source, stylesheet, tests, settings, docs).
  It could not reliably sit at the text end without rewriting the conversation renderer.

---

[1.0.0]: https://github.com/cndoin/dsh-custom-theme/releases/tag/v1.0.0
