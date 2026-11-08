# Contributing

Thanks for taking the time. This plugin is small on purpose: **no runtime dependencies,
no bundler, no build step at install time**. Please keep it that way.

## Ground rules

1. **`src/*.js` are pure logic.** `core.js`, `backdrop.js` and `stream`-free sources are
   inlined into `client.js` by `scripts/build.mjs`. They must not import anything, touch
   the DOM, or reference `window` / `document`. DOM work belongs in
   `src/client.template.js`.
2. **Never edit `client.js` by hand.** Regenerate with `node scripts/build.mjs`.
   `tests/core.test.mjs` rebuilds it read-only, in memory, and compares byte-for-byte —
   a hand edit fails the suite.
3. **Never insert pasted theme CSS as a stylesheet.** Only CSS custom-property
   declarations are read; `isSafeValue()` is the security boundary. Any new accepted
   syntax must come with a blacklist bypass test in `tests/core.test.mjs`.
4. **Do not widen wallpaper translucency** beyond `--dsw-alias-bg-base` and
   `--dsw-specific-sidebar-fill`. Layer-1/2, overlay, input-major and static ramps are
   used by code blocks, trajectory tables and popovers.
5. **Do not add `transform` / `scale`, SVG `filter: url()`, `isolation`, child selectors,
   pseudo-elements or `!important` to the composer glass rules.** Each of those has a
   documented regression in the README.
6. **Default-off for anything that costs per-frame work.** If a feature introduces a
   `backdrop-filter`, a large SVG filter, a `MutationObserver` or an interval, it must be
   opt-in and justified.

## Before opening a PR

```bash
npm run check     # build + node --check + 97 unit tests + 6 compatibility scripts
```

If you add a theme format, add a case to `scripts/format-matrix.mjs` **and** a regression
test in `tests/core.test.mjs`. If you add a token, update `buildOverrides()` in
`src/core.js` and inspect the generated values with `scripts/dump-mapping.mjs`.

If you change the glass or wallpaper CSS, run the headless visual checks described in the
README and state in the PR that they are **CSS-rule checks**, not a live-GUI visual pass.

## Reporting a bug

Include the **Run status** JSON from the bottom of the settings page. It reports switch
states, URL validation, CSS length, DOM-layer creation, token count and
`backdrop-filter` support — enough to locate most failures without devtools.

## License

MIT. By contributing you agree that your contribution is licensed under the same terms.
