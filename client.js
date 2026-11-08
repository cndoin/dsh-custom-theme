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
    /**
 * Pure theme logic: turn a tweakcn / shadcn CSS paste into DSH `--dsw-*` token
 * overrides.
 *
 * This module is deliberately DOM-free and side-effect-free so it can be unit
 * tested with plain Node and inlined verbatim into the browser bundle. Only two
 * things are read out of a paste:
 *
 *   - CSS custom-property declarations (`--name: value;`), and
 *   - which block each one lives in (`:root` -> light, `.dark` -> dark).
 *
 * Every other construct a Tailwind theme file carries (@theme inline, @layer,
 * @apply, plain rules) is ignored except as block structure.
 *
 * No ESM imports are allowed here: build.mjs inlines this source verbatim into
 * a closure-factory browser artifact.
 *
 * @module dsh-custom-theme/core
 */

/** Longest accepted single CSS value; anything longer is not a theme value. */
const MAX_VALUE_LENGTH = 240;

/**
 * Substrings that must never reach a CSS custom property: a theme paste is
 * untrusted text, and these are the primitives a browser would actually fetch,
 * execute, or escape the declaration with.
 */
const FORBIDDEN_FRAGMENTS = [
  'url(', 'image(', 'image-set(', '-webkit-image-set(', 'cross-fade(', 'element(',
  'paint(', 'attr(', 'local(', '@import', '@charset', '@font-face',
  'expression(', 'javascript:', '<', '>', '`', '\\',
  '{', '}', ';',
];

/** The 32 colour variables tweakcn emits. Only these receive the bare-triplet fix. */
const COLOR_VARS = Object.freeze([
  'background', 'foreground',
  'card', 'card-foreground',
  'popover', 'popover-foreground',
  'primary', 'primary-foreground',
  'secondary', 'secondary-foreground',
  'muted', 'muted-foreground',
  'accent', 'accent-foreground',
  'destructive', 'destructive-foreground',
  'border', 'input', 'ring',
  'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5',
  'sidebar', 'sidebar-foreground',
  'sidebar-primary', 'sidebar-primary-foreground',
  'sidebar-accent', 'sidebar-accent-foreground',
  'sidebar-border', 'sidebar-ring',
]);

const COLOR_SET = new Set(COLOR_VARS);

/**
 * Variables that describe the theme as a whole rather than one colour scheme.
 * tweakcn writes them into both blocks; `@tracking-normal` and `@spacing` land
 * only in `:root`.
 */
const SHARED_VARS = Object.freeze([
  'font-sans', 'font-serif', 'font-mono',
  'radius', 'tracking-normal', 'spacing',
  'shadow-color', 'shadow-opacity', 'shadow-blur', 'shadow-spread',
  'shadow-x', 'shadow-y',
]);

const SHARED_SET = new Set(SHARED_VARS);

/** Variables that only exist inside Tailwind's `@theme inline` alias block. */
const DERIVED_VARS = new Set([
  'radius-sm', 'radius-md', 'radius-lg', 'radius-xl',
  'tracking-tighter', 'tracking-tight', 'tracking-wide', 'tracking-wider', 'tracking-widest',
]);

/**
 * Report whether one CSS value is safe to hand to `style.setProperty`.
 *
 * @param value - the normalized value.
 * @returns true when the value contains no fetch/execute/escape primitive.
 */
function isSafeValue(value) {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > MAX_VALUE_LENGTH) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  const lower = value.toLowerCase();
  for (const fragment of FORBIDDEN_FRAGMENTS) {
    if (lower.includes(fragment.toLowerCase())) return false;
  }
  // `url (` with whitespace between the name and the parenthesis is still a
  // fetch primitive; the substring list above only catches the unspaced form.
  if (/\burl\s*\(/i.test(value)) return false;
  return true;
}

/**
 * Normalize one declared value.
 *
 * Tailwind v3 themes store colours as bare HSL triplets (`0 0% 9%`) because the
 * generated `tailwind.config` wraps them in `hsl(var(--primary))`. A bare
 * triplet is not a colour on its own, so it is wrapped here — exactly what
 * tweakcn's own importer does.
 *
 * A declaration whose value merely points back at itself (`--x: var(--x)` or
 * `var(--x, fallback)`) is a guaranteed-invalid value once it reaches the
 * browser, so it is dropped here too.
 *
 * @param raw - the text after the colon, before the semicolon.
 * @param name - the custom property name without leading dashes.
 * @returns the normalized value, or null when it must be dropped.
 */
function normalizeValue(raw, name) {
  let value = String(raw).trim();
  if (value === '') return null;
  value = value.replace(/!important\s*$/i, '').trim();
  value = value.replace(/\s+/g, ' ');
  if (value === '') return null;
  // A Tailwind v3 theme stores colours as bare HSL triplets: `<hue> <sat>% <l>%`
  // (e.g. `0 0% 9%`, `221.5 83.2% 53.1%`, `-120 50% 40%`, `120deg 50% 40%`).
  // Anchor on the two trailing percentages so only a genuine triplet is
  // wrapped; `\d*\.?\d+` rejects malformed numbers such as `1..2` and a bare
  // `.`. A trailing `deg` is stripped before wrapping so the result stays a
  // valid colour.
  const triplet = value.match(/^(-?\d*\.?\d+)(deg)?(\s+\d*\.?\d+%){2}$/i);
  if (COLOR_SET.has(name) && triplet !== null) {
    // `triplet[2]` is the optional `deg` suffix; drop it, keep the number.
    value = `hsl(${triplet[1]}${value.slice(triplet[1].length + (triplet[2] ? 3 : 0))})`;
  }
  if (!isSafeValue(value)) return null;
  // A custom property that refers to itself is a guaranteed-invalid value.
  if (isSelfReference(value, name)) return null;
  return value;
}

/** Whether `value` is `var(--name)` (with an optional fallback) for `name`. */
function isSelfReference(value, name) {
  if (typeof name !== 'string' || name === '') return false;
  const match = value.match(/^var\(\s*--([A-Za-z0-9_-]+)\s*(?:,[^)]*)?\)$/i);
  return match !== null && match[1] === name;
}

/**
 * Strip `/* … *``/` comments while preserving string literals.
 *
 * A brace or semicolon inside a comment is not syntax, and unterminated
 * comments are common in hand-trimmed pastes; the remainder is dropped rather
 * than guessed at.
 *
 * @param css - source text.
 * @returns source text with comments replaced by a single space.
 */
function stripComments(css) {
  let out = '';
  let index = 0;
  while (index < css.length) {
    const char = css[index];
    const next = css[index + 1];
    if (char === '/' && next === '*') {
      const end = css.indexOf('*/', index + 2);
      if (end === -1) return `${out} `;
      out += ' ';
      index = end + 2;
      continue;
    }
    if (char === '"' || char === "'") {
      const quote = char;
      out += char;
      index += 1;
      while (index < css.length) {
        const inner = css[index];
        if (inner === '\\' && index + 1 < css.length) {
          out += inner + css[index + 1];
          index += 2;
          continue;
        }
        out += inner;
        index += 1;
        if (inner === quote) break;
      }
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

/**
 * Find the index of the `}` matching the `{` at `open`.
 *
 * @param text - source text.
 * @param open - index of the opening brace.
 * @returns index of the matching close brace, or the text length when unclosed.
 */
function matchBrace(text, open) {
  let depth = 0;
  let index = open;
  while (index < text.length) {
    const char = text[index];
    if (char === '"' || char === "'") {
      const quote = char;
      index += 1;
      while (index < text.length) {
        if (text[index] === '\\') { index += 2; continue; }
        if (text[index] === quote) { index += 1; break; }
        index += 1;
      }
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
    index += 1;
  }
  return text.length;
}

/**
 * Collect every plain rule, descending through at-rules.
 *
 * `@theme inline` blocks are kept with a marker so the parser can salvage the
 * genuine font stacks v0 exports put there without importing the self-
 * referential aliases. A non-`inline` `@theme` carries real values and is
 * treated exactly like a `:root` palette block.
 *
 * A plain rule whose body contains another `{` (CSS nesting, e.g. an embedded
 * `@media`) is re-scanned with `collectRules` so the inner at-rule gets its own
 * block rather than being folded into the outer declarations.
 *
 * @param text - source text with comments removed.
 * @param state - inherited block context.
 * @param out - accumulator.
 * @returns the accumulator.
 */
function collectRules(text, state, out) {
  let index = 0;
  let prelude = '';
  while (index < text.length) {
    const char = text[index];
    if (char === '{') {
      const head = prelude.trim();
      prelude = '';
      const close = matchBrace(text, index);
      const body = text.slice(index + 1, close);
      index = close + 1;
      if (head.startsWith('@')) {
        const name = head.slice(1).split(/[\s({;]/)[0].toLowerCase();
        if (name === 'theme') {
          if (/\binline\b/i.test(head)) {
            // Tailwind v4's `@theme inline` is almost entirely self-referential
            // aliases (`--color-background: var(--background)`), which must be
            // dropped. But the v0 export puts *real* font stacks in there while
            // `:root` has no `--font-*` at all. Keep the block with a marker so
            // the parser can salvage genuine values without importing aliases.
            out.push({ prelude: '@theme', body, themeInline: true,
              conditional: state.conditional, darkMedia: state.darkMedia });
          } else {
            // A plain `@theme` is a real palette block, not an alias sheet.
            out.push({ prelude: ':root', body, themeInline: false,
              conditional: state.conditional, darkMedia: state.darkMedia });
          }
          continue;
        }
        const isConditional = name === 'media' || name === 'supports' || name === 'container';
        const darkMedia = state.darkMedia
          || (isConditional && name === 'media' && /prefers-color-scheme\s*:\s*dark/i.test(head));
        collectRules(body, {
          conditional: state.conditional || isConditional,
          darkMedia,
        }, out);
      } else if (head !== '') {
        // CSS nesting: declarations plus an inner at-rule sharing one body. Keep
        // the declarations that precede the first nested block, then recurse
        // into the remaining text so the inner rule is classified on its own.
        const nested = body.indexOf('{');
        if (nested !== -1) {
          const direct = body.slice(0, body.lastIndexOf(';', nested) + 1);
          if (direct.trim() !== '') {
            out.push({ prelude: head, body: direct, conditional: state.conditional, darkMedia: state.darkMedia });
          }
          collectRules(body.slice(body.lastIndexOf(';', nested) + 1), state, out);
        } else {
          out.push({ prelude: head, body, conditional: state.conditional, darkMedia: state.darkMedia });
        }
      }
      continue;
    }
    if (char === '}') { prelude = ''; index += 1; continue; }
    if (char === ';') {
      // A semicolon at this level terminates a *statement*, not a rule.
      // tweakcn's exports all start with
      //   @import "tailwindcss";
      //   @custom-variant dark (&:is(.dark *));
      // If those stay in `prelude`, the next `{` belongs to `:root` but its
      // head now starts with `@`, so the whole light palette gets mistaken for
      // an at-rule body and silently dropped. Clearing on `;` keeps each
      // statement separate — that was the single biggest reason community
      // themes appeared to do nothing.
      prelude = '';
      index += 1;
      continue;
    }
    prelude += char;
    index += 1;
  }
  return out;
}

/**
 * Remove a balanced `fn(...)` group (`:not`, `:is`, `:where`) from a selector,
 * including nested parentheses and comma-separated argument lists.
 *
 * @param selector - lowercased selector text.
 * @param fn - the pseudo-class name without the colon.
 * @returns the selector with every balanced `fn(...)` group removed.
 */
function stripFunctionalPseudo(selector, fn) {
  let out = selector;
  const open = `:${fn}(`;
  let at = out.indexOf(open);
  while (at !== -1) {
    let depth = 1;
    let i = at + open.length;
    while (i < out.length && depth > 0) {
      if (out[i] === '(') depth += 1;
      else if (out[i] === ')') depth -= 1;
      i += 1;
    }
    if (depth !== 0) break; // unbalanced: leave the rest alone
    out = out.slice(0, at) + out.slice(i);
    at = out.indexOf(open);
  }
  return out;
}

/**
 * Split a selector list on top-level commas only. Commas inside `:not(…)`,
 * `:is(…)` or an attribute value are arguments, not list separators.
 *
 * @param selector - one lowercased selector (may contain nested groups).
 * @returns the individual compound selectors.
 */
function splitSelectorList(selector) {
  const out = [];
  let depth = 0;
  let inAttr = false;
  let start = 0;
  for (let i = 0; i < selector.length; i += 1) {
    const ch = selector[i];
    if (ch === '[') { inAttr = true; continue; }
    if (ch === ']') { inAttr = false; continue; }
    if (inAttr) continue;
    if (ch === '(') { depth += 1; continue; }
    if (ch === ')') { depth = Math.max(0, depth - 1); continue; }
    if (ch === ',' && depth === 0) {
      out.push(selector.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(selector.slice(start).trim());
  return out.filter(Boolean);
}

/**
 * Whether a compound selector contains a descendant combinator: whitespace
 * outside attribute brackets and functional pseudo-class parentheses.
 *
 * @param selector - one lowercased compound selector.
 * @returns true when the selector targets a descendant rather than the root.
 */
function hasDescendantCombinator(selector) {
  let depth = 0;
  let inAttr = false;
  for (let i = 0; i < selector.length; i += 1) {
    const ch = selector[i];
    if (ch === '[') { inAttr = true; continue; }
    if (ch === ']') { inAttr = false; continue; }
    if (inAttr) continue;
    if (ch === '(') { depth += 1; continue; }
    if (ch === ')') { depth = Math.max(0, depth - 1); continue; }
    if (/\s/.test(ch) && depth === 0) return true;
  }
  return false;
}

/**
 * Decide which colour scheme a rule's selector list targets.
 *
 * @param prelude - the selector text.
 * @returns `'light'`, `'dark'`, `'both'`, or `null` when the rule is not a palette block.
 */
function classifySelector(prelude) {
  const parts = splitSelectorList(String(prelude ?? '').toLowerCase());
  // A selector list containing a descendant combinator is not a palette block:
  // applying its declarations to a whole scheme was the old
  // `[data-theme="dark"] body` / `:root, .dark .card` bug. Reject the whole
  // rule rather than emit one scheme from a mixed list.
  if (parts.some(hasDescendantCombinator)) return null;

  let light = false;
  let dark = false;
  for (const selector of parts) {
    // Dark markers live on the selector itself, not inside a negation. Strip
    // balanced `:not(...)` groups (including comma-separated and nested
    // arguments): `:root:not(.dark, .night)` must stay light, while a real
    // `.dark` outside the negation still wins.
    const forDark = stripFunctionalPseudo(selector, 'not');
    const isDark = /\.dark\b/.test(forDark)
      || /\[data-theme\s*=\s*['"]?dark/.test(forDark)
      || /\[data-mode\s*=\s*['"]?dark/.test(forDark)
      || /data-ds-dark-theme/.test(forDark)
      || /\.dark-theme\b/.test(forDark)
      || /\.theme-dark\b/.test(forDark)
      || (/\[class~=/.test(forDark) && /dark/.test(forDark));
    if (isDark) { dark = true; continue; }

    // `[data-theme="light"]` (and `[data-mode="light"]`) is an explicit light
    // palette; the dark equivalents were handled above.
    if (/^\[data-(?:theme|mode)\s*=\s*['"]?light['"]?\]$/.test(selector)) { light = true; continue; }

    // A compound `:root`/`html`/`:host`/`body` with attributes, classes or
    // pseudo-classes is still the light palette (`:root.light`,
    // `html[data-theme="light"]`, `body:not(.dark)`, `:root:not(:is(.dark))`).
    // A trailing `.dark` or `.theme-dark` would have been caught by `isDark`.
    const withoutAttributes = selector.replace(/\[[^\]]*\]/g, '');
    const base = /^(:root|:host|html|body)(?::root)?/.exec(withoutAttributes);
    let isLight = false;
    if (base !== null) {
      const rest = withoutAttributes.slice(base[0].length);
      // The remainder may be any chain of classes, IDs and functional
      // pseudo-classes, but must not contain a descendant or a stray token.
      isLight = stripFunctionalPseudo(stripFunctionalPseudo(stripFunctionalPseudo(rest, 'not'), 'is'), 'where')
        .replace(/\.[A-Za-z0-9_-]+/g, '')
        .replace(/#[A-Za-z0-9_-]+/g, '').trim() === '';
    }
    if (!isLight) isLight = /^(:root|html)(?:\[[^\]]*\])+$/.test(selector)
      || /^:host\([^)]*\)$/.test(selector);
    if (isLight) light = true;
  }
  if (light && dark) return 'both';
  if (dark) return 'dark';
  if (light) return 'light';
  return null;
}

/** Match one declaration inside a block body. */
const DECLARATION = /--([A-Za-z0-9_-]+)\s*:\s*([^;{}]+)/g;

/**
 * Parse a tweakcn (or shadcn) theme paste into per-scheme variable maps.
 *
 * @param css - the pasted text.
 * @returns a parsed theme.
 */
function parseThemeCss(css) {
  const warnings = [];
  const light = {};
  const dark = {};
  const lightConditional = {};
  const darkConditional = {};
  let groupedBoth = false;

  const source = sanitizePaste(css);
  if (typeof source !== 'string' || source.trim() === '') {
    return {
      light, dark, shared: {}, warnings: ['empty input'], counts: { light: 0, dark: 0 }, source: 'css',
    };
  }

  const rules = collectRules(stripComments(source), { conditional: false, darkMedia: false }, []);
  if (rules.length === 0) warnings.push('no CSS rules found');

  // `@theme inline` in a v0 export carries the real font stacks, while the
  // editor's own v4 export only puts `var(--font-sans)` self-references there.
  // Salvage the former, ignore the latter. These are shared (not per-scheme)
  // values, so they land in `shared` and never touch the colour maps.
  const themeFonts = {};
  for (const rule of rules) {
    if (rule.themeInline !== true) continue;
    DECLARATION.lastIndex = 0;
    let m = DECLARATION.exec(rule.body);
    while (m !== null) {
      const name = m[1];
      const raw = m[2].trim();
      // Keep only font stacks whose value is a literal, not `var(--font-sans)`.
      if (/^font-(sans|serif|mono)$/.test(name) && !raw.includes('var(')) {
        const value = normalizeValue(raw, name);
        if (value !== null && isSafeFontStack(value)) themeFonts[name] = value;
      }
      m = DECLARATION.exec(rule.body);
    }
  }

  for (const rule of rules) {
    if (rule.themeInline === true) continue;
    let target = classifySelector(rule.prelude);
    if (target === null) continue;
    // A `:root` block inside `@media (prefers-color-scheme: dark)` is the dark palette.
    if (rule.darkMedia && target === 'light') target = 'dark';
    if (target === 'both') {
      warnings.push(`selector "${rule.prelude}" targets both schemes; applied to both`);
      // A grouped `:root, .dark` selector explicitly declares ONE palette for
      // both schemes. That is the author's choice, not tweakcn's silent
      // light-into-dark copy, so companion derivation must leave it alone.
      groupedBoth = true;
    }

    DECLARATION.lastIndex = 0;
    let match = DECLARATION.exec(rule.body);
    while (match !== null) {
      const name = match[1];
      const value = normalizeValue(match[2], name);
      if (value !== null) {
        if (DERIVED_VARS.has(name)) {
          warnings.push(`ignored derived variable --${name} (Tailwind @theme alias)`);
        } else if (target === 'both') {
          // A grouped selector (`:root, .dark { … }`) declares one palette for
          // both schemes. Writing only to `light` leaves `dark` empty, and
          // `overrideTokens` then emits no colour pair at all — the theme
          // silently does nothing. Both schemes must receive the declaration.
          (rule.conditional ? lightConditional : light)[name] = value;
          (rule.conditional ? darkConditional : dark)[name] = value;
        } else if (target === 'light') {
          (rule.conditional ? lightConditional : light)[name] = value;
        } else if (target === 'dark') {
          (rule.conditional ? darkConditional : dark)[name] = value;
        }
      } else {
        warnings.push(`dropped unsafe or empty value for --${name}`);
      }
      match = DECLARATION.exec(rule.body);
    }
  }

  // Conditional blocks are a fallback only: an explicit block always wins.
  for (const [name, value] of Object.entries(lightConditional)) {
    if (!(name in light)) light[name] = value;
  }
  for (const [name, value] of Object.entries(darkConditional)) {
    if (!(name in dark)) dark[name] = value;
  }

  const shared = {};
  for (const name of SHARED_VARS) {
    const value = light[name] ?? dark[name];
    if (value !== undefined) shared[name] = value;
  }
  // A literal font stack salvaged from v0's `@theme inline` fills the slot only
  // when the palette blocks did not declare one themselves.
  for (const [name, value] of Object.entries(themeFonts)) {
    if (shared[name] === undefined) shared[name] = value;
  }

  const counts = { light: Object.keys(light).length, dark: Object.keys(dark).length };
  if (counts.light === 0 && counts.dark === 0) warnings.push('no theme variables found in the paste');
  if (counts.light > 0 && counts.dark === 0) warnings.push('no dark block: dark mode keeps the built-in palette');
  if (counts.dark > 0 && counts.light === 0) warnings.push('no light block: light mode keeps the built-in palette');

  // A very large share of tweakcn community themes ship one palette only: the
  // `.dark` block is a copy of `:root` with, at most, different shadow values.
  // That is tweakcn's own behaviour (`mergePresetWithDefaults` spreads `light`
  // into `dark`), so it is not a paste error — but it does mean switching
  // Light/Dark in Harness shows no difference. Flag it so the user understands
  // why, and let `deriveCompanion` fill in the missing scheme.
  if (isSingleScheme(light, dark)) warnings.push('single-scheme theme: light and dark palettes are identical');

  const result = { light, dark, shared, warnings, counts, source: 'css' };
  if (groupedBoth) {
    // Non-enumerable: does not disturb deepEqual / key comparisons of the parse
    // result, but lets ensureTwoSchemes honour the explicit grouped declaration.
    Object.defineProperty(result, 'groupedBoth', { value: true, enumerable: false });
  }
  return result;
}

/** True when a paste explicitly grouped both schemes into one palette block. */
function isExplicitlyGrouped(parsed) {
  return parsed?.groupedBoth === true;
}

/**
 * Decide whether two schemes are really the same palette.
 *
 * Only colour variables count: a theme whose `.dark` differs from `:root` just
 * in shadow geometry or letter-spacing still has one colour scheme.
 *
 * There is no `compared >= 8` gate any more: seven identical variables are as
 * single-scheme as forty. Differences are measured perceptually, so a value
 * rewritten into an indistinguishable colour (`#fff` vs `#feffff`) does not
 * count as a second scheme. A small share of genuinely different variables is
 * still tolerated (tweakcn's community exports differ in `sidebar-border` and
 * `sidebar-ring` while shipping one palette everywhere else).
 *
 * @param light - the light variable map.
 * @param dark - the dark variable map.
 * @returns true when both schemes resolve to the same colours.
 */
function isSingleScheme(light, dark) {
  const colours = COLOR_VARS.filter(name => !/^shadow|^font|^radius|^tracking|^spacing/.test(name));
  let compared = 0;
  let different = 0;
  for (const name of colours) {
    const a = light[name];
    const b = dark[name];
    if (a === undefined || b === undefined) continue;
    compared += 1;
    if (a === b) continue;
    const la = luminance(a);
    const lb = luminance(b);
    // Visually identical values in different notations are not a difference.
    if (la !== null && lb !== null && Math.abs(la - lb) < 0.004) continue;
    different += 1;
  }
  return compared > 0 && different / compared < 0.1;
}

/** Colour variables that denote ink (text), not a surface. */
const INK_VARS = /^(foreground|card-foreground|popover-foreground|primary-foreground|secondary-foreground|muted-foreground|accent-foreground|destructive-foreground|sidebar-foreground|sidebar-primary-foreground|sidebar-accent-foreground)$/;

/**
 * Shift a colour into the opposite scheme, keeping its hue and chroma.
 *
 * A full inversion (`1 - L`) sends a near-white page to near-black, which is
 * harsher than any real dark theme: shadcn dark pages sit around L≈0.20 and
 * light pages around L≈0.98. So the target is a measured band, not a mirror.
 *
 * Ink and surfaces must move in *opposite* directions: on a light page the ink
 * is dark, on a dark page the ink is bright. `isInk` carries that distinction —
 * without it a derived white-on-white or black-on-black scheme is illegible.
 *
 * `span` is the original scheme's lightness range. Mapping the whole range onto
 * a target band (rather than clamping every colour to one value) preserves the
 * ladder: card, muted and border stay distinguishable from the page.
 *
 * @param value - a CSS colour.
 * @param towardDark - true to build a dark version, false for a light version.
 * @param isInk - true when the variable is text rather than a surface.
 * @param span - `{ min, max }` lightness of the base scheme's surfaces.
 * @returns the shifted colour.
 */
function shiftScheme(value, towardDark, isInk = false, span = { min: 0, max: 1 }) {
  const lightness = luminance(value);
  if (lightness === null) return value;

  const min = Number.isFinite(span?.min) ? span.min : 0;
  const max = Number.isFinite(span?.max) ? span.max : 1;

  let target;
  if (isInk) {
    target = towardDark ? 0.88 : 0.25;
  } else {
    // Normalise within the source ladder, then place it in the target band.
    const width = Math.max(0.001, max - min);
    const position = Math.min(1, Math.max(0, (lightness - min) / width));
    // Surfaces span a narrow band around the page: raised ones are slightly
    // lighter in a dark scheme, slightly darker in a light one.
    const low = towardDark ? 0.16 : 0.9;
    const high = towardDark ? 0.32 : 1.0;
    target = towardDark ? low + (1 - position) * (high - low) : high - position * (high - low);
  }

  const other = target > lightness ? 'white' : 'black';
  const distance = other === 'white' ? 1 - lightness : lightness;
  const goal = other === 'white' ? 1 - target : target;
  if (distance <= 0) return value;
  // Keep enough of the original to land near the target band, but never less
  // than 12% so a slight tint survives instead of becoming a flat neutral.
  const keep = Math.round(Math.max(12, Math.min(100, (goal / distance) * 100)));
  return mixWith(value, other, keep);
}

/** Pick the first readable surface colour from a scheme, for direction inference. */
function readableSurface(parsed, mode, candidates) {
  for (const name of candidates) {
    const value = pick(parsed, mode, name);
    if (value === null) continue;
    const level = luminance(value);
    if (level !== null) return level > 0.55;
  }
  return null;
}

/**
 * Synthesise the missing colour scheme from a single-scheme theme.
 *
 * tweakcn community exports frequently declare the same palette under `:root`
 * and `.dark`. Harness needs two real schemes or switching Light/Dark does
 * nothing. The single palette is kept in the scheme it was *designed* for
 * (a black page is a dark theme, whatever tweakcn calls the blocks), and the
 * other scheme is derived from it. Emphasis colours the author chose —
 * primary, destructive, ring, chart — are kept in both schemes: those are brand
 * decisions, not lightness decisions.
 *
 * The direction is inferred with a THREE-state test: an unreadable background
 * (var(), 8-digit hex, NaN) is "unknown", not "dark", so a light theme is
 * never mistaken for a dark one. Other readable surfaces are consulted, and
 * only if none can be read do we default to light (the common case).
 *
 * The parsed object is never mutated; a new one is returned.
 *
 * @param parsed - the parse result.
 * @returns a parse result with both schemes populated.
 */
function deriveCompanion(parsed) {
  const surfaces = ['background', 'card', 'popover', 'muted', 'secondary', 'accent', 'sidebar'];
  const lightRead = readableSurface(parsed, 'light', surfaces);
  const darkRead = readableSurface(parsed, 'dark', surfaces);
  // `baseIsDark === true` only when a readable surface says dark. Unknown and
  // light both keep the original palette in the light slot.
  const baseIsDark = lightRead === false || (lightRead === null && darkRead === false);
  const keepAsIs = /^(primary|primary-foreground|destructive|destructive-foreground|ring|chart-[1-5])$/;

  // Build the companion from the single palette the author supplied.
  // Measure the source ladder so the derived one keeps its internal ordering.
  const surfaceVars = ['background', 'card', 'popover', 'muted', 'secondary', 'accent',
    'border', 'input', 'sidebar', 'sidebar-border', 'sidebar-accent'];
  const levels = surfaceVars
    .map(name => luminance(parsed.light[name]))
    .filter(level => level !== null);
  const span = levels.length > 0
    ? { min: Math.min(...levels), max: Math.max(...levels) }
    : { min: 0, max: 1 };

  const companion = {};
  for (const [name, value] of Object.entries(parsed.light)) {
    if (SHARED_SET.has(name)) continue;
    companion[name] = keepAsIs.test(name)
      ? value
      : shiftScheme(value, !baseIsDark, INK_VARS.test(name), span);
  }

  const light = baseIsDark ? companion : { ...parsed.light };
  const dark = baseIsDark ? { ...parsed.light } : companion;

  return {
    ...parsed,
    light,
    dark,
    counts: { light: Object.keys(light).length, dark: Object.keys(dark).length },
    warnings: parsed.warnings.filter(w => w !== 'single-scheme theme: light and dark palettes are identical'),
  };
}

/**
 * Guarantee that both colour schemes have a palette before mapping.
 *
 * `overrideTokens` insists on a `{ light, dark }` pair for every token. A paste
 * that declares only `:root` (very common — users copy one block from a blog)
 * used to produce *zero* tokens, i.e. the plugin silently did nothing. Three
 * cases are handled here:
 *
 *   - both schemes present and genuinely different — untouched;
 *   - both present but identical (tweakcn's `mergePresetWithDefaults` copies
 *     light into dark) — derive a companion scheme;
 *   - only one scheme present — use it for both, then derive the other so the
 *     Light/Dark switch still shows a difference.
 *
 * @param parsed - the parse result.
 * @param enabled - whether to synthesise a second scheme.
 * @returns the parse result to map from.
 */
function ensureTwoSchemes(parsed, enabled) {
  const hasLight = Object.keys(parsed.light ?? {}).length > 0;
  const hasDark = Object.keys(parsed.dark ?? {}).length > 0;
  if (!hasLight && !hasDark) return parsed;

  // A single declared block must be mirrored into the missing map even when
  // companion derivation is off: without it `overrideTokens` has no pair to
  // emit and the whole theme collapses to zero tokens. Filling is mandatory;
  // deriving a *different* companion is the optional part.
  if (!hasLight || !hasDark) {
    const source = hasLight ? parsed.light : parsed.dark;
    const filled = {
      ...parsed,
      light: { ...source },
      dark: { ...source },
      counts: { light: Object.keys(source).length, dark: Object.keys(source).length },
      warnings: (parsed.warnings ?? []).filter(w =>
        w !== 'no dark block: dark mode keeps the built-in palette'
        && w !== 'no light block: light mode keeps the built-in palette'),
    };
    return enabled && !isExplicitlyGrouped(parsed) ? deriveCompanion(filled) : filled;
  }

  if (!enabled) return parsed;
  if (isExplicitlyGrouped(parsed)) return parsed;
  if (!isSingleScheme(parsed.light, parsed.dark)) return parsed;
  return deriveCompanion(parsed);
}

/** True when a section is a non-empty object of declarations. */
function usableSection(section) {
  return section !== null && typeof section === 'object' && !Array.isArray(section)
    && Object.keys(section).length > 0;
}

/** Pick the first non-empty section out of a list of candidates. */
function firstUsable(...sections) {
  return sections.find(usableSection) ?? null;
}

/**
 * Map a tweakcn registry payload (`/r/themes/{id}` JSON) onto the same shape.
 *
 * Accepts: a bare `{ light, dark }`, `{ cssVars: { theme, light, dark } }`,
 * `{ theme: { light, dark } }` with sibling `light`/`dark`, a registry index
 * `{ items: [...] }`, and a top-level array of any of those. An empty
 * `cssVars`/`theme` wrapper never shadows a usable sibling section.
 *
 * @param payload - parsed JSON with a `cssVars` object.
 * @returns a parsed theme.
 */
function parseThemeJson(payload) {
  const warnings = [];
  let source = payload;
  let name = '';

  const collectName = (obj, force = false) => {
    if ((name === '' || force) && obj !== null && typeof obj === 'object' && typeof obj.name === 'string') {
      name = obj.name;
    }
  };
  collectName(payload);

  // A top-level array, or a registry index's `items[]`: take the first entry
  // that actually carries a usable section. An all-empty item must not stop the
  // search, and if none is usable we still try the outer object's own sections.
  let candidates = [];
  if (Array.isArray(source)) {
    candidates = source;
  } else if (source !== null && typeof source === 'object' && Array.isArray(source.items)) {
    candidates = source.items;
  }
  let chosen = null;
  for (const item of candidates) {
    if (item === null || typeof item !== 'object') continue;
    const vars = item.cssVars;
    const found = firstUsable(vars?.light, vars?.dark, vars?.theme,
      item.theme?.light, item.theme?.dark, item.theme, item.light, item.dark);
    if (found !== null) { chosen = item; collectName(item, true); break; }
  }
  if (chosen !== null) source = chosen;

  // Find the first non-empty section across all supported wrappers. `??` used
  // to pick an empty `{}` and then stop, discarding real values in `theme` or
  // in bare `light`/`dark`.
  const outerTheme = source?.theme;
  let cssVars = firstUsable(
    source?.cssVars?.light, source?.cssVars?.dark, source?.cssVars?.theme,
    source?.cssVars,
    outerTheme?.light, outerTheme?.dark, outerTheme,
    source?.light, source?.dark,
  );
  if (cssVars === null) {
    cssVars = firstUsable(source?.cssVars, outerTheme);
  }
  // A wrapper whose only keys are `light`/`dark`/`theme` is a cssVars object
  // itself; a bare `{ light, dark }` is used directly.
  const asSections = (obj) => {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return null;
    const hasSections = ['light', 'dark', 'theme'].some(key => key in obj);
    return hasSections ? obj : null;
  };
  let sections = asSections(cssVars);
  if (sections === null) {
    sections = firstUsable(
      asSections(source?.cssVars), asSections(outerTheme), asSections(source),
    );
  }
  if (sections === null) sections = {};

  // tweakcn's registry JSON uses the *editor* field names; the CSS export uses
  // the emitted variable names. Normalise back to the CSS spelling.
  const alias = {
    'shadow-offset-x': 'shadow-x',
    'shadow-offset-y': 'shadow-y',
    'letter-spacing': 'tracking-normal',
  };
  const read = (section) => {
    const out = {};
    if (!usableSection(section)) return out;
    for (const [rawName, rawValue] of Object.entries(section)) {
      if (typeof rawValue !== 'string') continue;
      const name = alias[rawName] ?? rawName;
      const value = normalizeValue(rawValue, name);
      if (value !== null && !DERIVED_VARS.has(name)) out[name] = value;
    }
    return out;
  };
  const themeSection = read(sections.theme);
  const light = { ...themeSection, ...read(sections.light) };
  const dark = { ...themeSection, ...read(sections.dark) };
  // A wrapper that is itself a flat declaration table (no light/dark split)
  // still carries values; treat it as both schemes.
  if (Object.keys(light).length === 0 && Object.keys(dark).length === 0
    && sections !== source?.cssVars && sections !== outerTheme) {
    const flat = read(sections);
    Object.assign(light, flat);
    Object.assign(dark, flat);
  }
  const shared = {};
  for (const name of SHARED_VARS) {
    if (light[name] !== undefined) shared[name] = light[name];
    else if (dark[name] !== undefined) shared[name] = dark[name];
  }
  const counts = { light: Object.keys(light).length, dark: Object.keys(dark).length };
  if (counts.light === 0 && counts.dark === 0) warnings.push('no theme variables found in the JSON');
  else if (counts.light === 0) warnings.push('JSON light section is empty or missing');
  else if (counts.dark === 0) warnings.push('JSON dark section is empty or missing');
  return { light, dark, shared, warnings, counts, source: 'json', name };
}

/**
 * Strip the non-CSS wrapping people routinely paste around a theme.
 *
 * Users copy from a README, a chat message or a docs site, so the clipboard
 * often contains a Markdown fence, a "Here is my theme:" sentence, or a BOM.
 * `collectRules` accumulates text into a selector prelude until it sees `{`, so
 * any leading prose becomes part of the selector and the real `:root {` is
 * misread as an at-rule — silently dropping the whole light palette.
 *
 * Bare JSON has no `--name:` declarations, so the old guard returned the whole
 * paste unchanged. Fences are now stripped unconditionally (for both CSS and
 * JSON), and prose is dropped by locating the first real construct: a JSON
 * object/array, or a CSS line. A prose line containing a JSON object is cut
 * down to that object.
 *
 * @param text - raw pasted text.
 * @returns the cleaned text.
 */
function sanitizePaste(text) {
  if (typeof text !== 'string') return '';
  let out = text.replace(/^\uFEFF/, '');

  // Markdown fences: ```css … ``` (also ~~~), with or without a language tag.
  // Applied unconditionally: a fenced JSON payload has no CSS variable
  // declarations, so the old "contains --name:" guard left it wrapped.
  const fence = out.match(/^\s*(?:```|~~~)[^\n]*\n([\s\S]*?)(?:```|~~~)\s*$/m);
  if (fence !== null) out = fence[1];

  // A JSON object/array embedded in prose: keep from the first brace/bracket
  // through the matching close. This also handles a BOM-only/whitespace prefix
  // and a trailing "hope it helps" sentence.
  const jsonStart = out.search(/[{[]/);
  if (jsonStart !== -1) {
    const openChar = out[jsonStart];
    const closeChar = openChar === '{' ? '}' : ']';
    const jsonEnd = out.lastIndexOf(closeChar);
    if (jsonEnd > jsonStart) {
      const candidate = out.slice(jsonStart, jsonEnd + 1);
      // Only treat it as JSON when it really parses; CSS also contains braces.
      try {
        JSON.parse(candidate);
        return candidate.trim();
      } catch {
        // Not JSON — fall through to CSS prose handling.
      }
    }
  }

  if (!/--[A-Za-z0-9_-]+\s*:/.test(out)) return out;

  // Drop prose lines before the first CSS construct. A line is kept when it
  // looks like CSS: an at-rule, a selector, a variable declaration, a comment
  // or a closing brace. Everything before that is discarded.
  const lines = out.split(/\r?\n/);
  const firstCss = lines.findIndex(line => {
    const t = line.trim();
    return t.startsWith('@') || t.startsWith(':root') || t.startsWith('.dark')
      || t.startsWith('html') || t.startsWith('body') || t.startsWith(':host')
      || t.startsWith('[data-') || t.startsWith('--') || t.startsWith('/*')
      || t.startsWith('}') || t.startsWith('{')
      || /^[.#:[a-z][^{]*\{/.test(t);
  });
  if (firstCss > 0) out = lines.slice(firstCss).join('\n');
  return out;
}

/**
 * Accept either a CSS paste or a tweakcn registry JSON payload.
 *
 * Fences, BOM and surrounding prose are stripped unconditionally first, then
 * the first balanced JSON object/array is parsed (a top-level JSON array is
 * accepted too). Only when no JSON object is present is the text treated as
 * CSS.
 *
 * @param text - whatever the user pasted.
 * @returns a parsed theme.
 */
function parseThemeInput(text) {
  let trimmed = typeof text === 'string' ? sanitizePaste(text).trim() : '';
  if (trimmed === '') {
    return parseThemeCss('');
  }
  // A JSON payload starts with `{` (or `[` for a top-level array). A CSS paste
  // can start with `[` too (`[data-theme="dark"]{…}`), so the array case is
  // attempted as JSON first and falls back to CSS on a parse failure.
  if (trimmed.startsWith('{')) return parseJsonInput(trimmed);
  if (trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed);
    } catch {
      return parseThemeCss(trimmed);
    }
    return parseJsonInput(trimmed);
  }
  return parseThemeCss(trimmed);
}

/** Parse a verified JSON string, reporting a friendly error on a bad payload. */
function parseJsonInput(text) {
  try {
    return parseThemeJson(JSON.parse(text));
  } catch {
    return {
      light: {}, dark: {}, shared: {},
      warnings: ['input starts like JSON but could not be parsed; paste the CSS export instead'],
      counts: { light: 0, dark: 0 },
      source: 'json',
    };
  }
}

/** True when a colour already carries alpha and must not be mixed down again. */
function hasAlpha(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (/^#[0-9a-f]{4}$/i.test(text) || /^#[0-9a-f]{8}$/i.test(text)) return true;
  if (/^(rgba|hsla)\(/i.test(text)) return true;
  if (/\/(\s*(0|1|0?\.\d+|\d+%)\s*)\)$/i.test(text)) return true;
  return false;
}

/**
 * Blend a solid theme colour down to a translucent overlay matching DSH's
 * hover/active convention.
 *
 * `percent` is clamped; a non-finite value becomes 0 so no `NaN%` or
 * `undefined%` can reach the stylesheet.
 *
 * @param value - the theme colour.
 * @param percent - how much of the colour survives.
 * @returns a CSS value, or null when there is no input.
 */
function tintOverlay(value, percent) {
  if (typeof value !== 'string' || value === '') return null;
  if (hasAlpha(value)) return value;
  return `color-mix(in srgb, ${value} ${limitPercent(percent)}%, transparent)`;
}

/**
 * Blend a solid theme colour down to the alpha level DSH's border tokens use.
 *
 * @param value - the theme colour.
 * @param percent - how much of the colour survives.
 * @returns a CSS value, or null when there is no input.
 */
function softenBorder(value, percent) {
  if (typeof value !== 'string' || value === '') return null;
  if (hasAlpha(value)) return value;
  return `color-mix(in srgb, ${value} ${limitPercent(percent)}%, transparent)`;
}

/**
 * Rough chroma of a colour, used to reject near-grey "error" colours.
 *
 * oklch/hsl expose chroma/saturation directly; hex and rgb() need max−min of
 * the RGB channels. An 8-digit hex ignores its alpha nibble.
 *
 * @param value - a CSS colour.
 * @returns true when the colour is (near) achromatic.
 */
function isNearGrey(value) {
  if (typeof value !== 'string') return false;
  const oklch = value.match(/oklch\(\s*-?\d*\.?\d+%?\s+(-?\d*\.?\d+)/i);
  if (oklch !== null) {
    const c = Number(oklch[1]);
    return Number.isFinite(c) && c < 0.03;
  }
  const hsl = value.match(/hsla?\(\s*-?\d*\.?\d+(?:deg)?\s*[, ]\s*(-?\d*\.?\d+)%/i);
  if (hsl !== null) {
    const s = Number(hsl[1]);
    return Number.isFinite(s) && s < 4;
  }
  let r;
  let g;
  let b;
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex !== null) {
    let digits = hex[1].slice(0, 6);
    if (digits.length === 3 || digits.length === 4) {
      const short = digits.slice(0, 3);
      digits = short.split('').map(c => c + c).join('');
    }
    const n = Number.parseInt(digits, 16);
    r = (n >> 16) & 255;
    g = (n >> 8) & 255;
    b = n & 255;
  } else {
    const rgb = value.match(/rgba?\(\s*(-?\d*\.?\d+)\s*[, ]\s*(-?\d*\.?\d+)\s*[, ]\s*(-?\d*\.?\d+)/i);
    if (rgb === null) return false;
    [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  if (![r, g, b].every(Number.isFinite)) return false;
  return Math.max(r, g, b) - Math.min(r, g, b) < 12;
}

/**
 * Relative luminance of a colour, on a 0 (black) to 1 (white) scale.
 *
 * Themes mix `oklch()`, `hsl()`, `rgb()` and hex, so all four are read. The
 * result only drives ordering decisions (which surface is darker than which),
 * not colour output, so an approximation is enough. Every parsed number is
 * checked with `Number.isFinite`, so a malformed value can never leak NaN into
 * the derived colours.
 *
 * @param value - a CSS colour.
 * @returns the luminance, or null when the value cannot be read.
 */
function luminance(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (/^white$/i.test(text)) return 1;
  if (/^black$/i.test(text)) return 0;
  if (/^transparent$/i.test(text)) return null;

  // A derived step is a `color-mix(in srgb, <a> <p>%, <b>)` (stepColor), or
  // `color-mix(in srgb, <a> <p>%, <b>)` / `color-mix(in srgb, <a>, <b> <p>%)`
  // (mixWith). Measuring it lets the tests and the mapping table verify that a
  // ladder really climbs instead of just trusting the first endpoint. This is
  // an approximation in sRGB, which is exactly how the browser will resolve
  // the expression.
  const mixFirst = text.match(/^color-mix\([^,]+,\s*(.+?)\s+(\d*\.?\d+)%\s*,\s*(.+)\)$/i);
  const mixSecond = text.match(/^color-mix\([^,]+,\s*(.+?)\s*,\s*(.+?)\s+(\d*\.?\d+)%\s*\)$/i);
  const mix = mixFirst ?? mixSecond;
  if (mix !== null) {
    const a = luminance(mix[1]);
    const b = luminance(mixFirst !== null ? mix[3] : mix[2]);
    const share = Number(mixFirst !== null ? mix[2] : mix[3]) / 100;
    if (a !== null && b !== null && Number.isFinite(share)) {
      // `mixFirst` gives the share of the FIRST colour. `mixSecond` gives the
      // share of the SECOND colour, so the first colour's share is `1 - share`.
      const firstShare = mixFirst !== null ? share : 1 - share;
      return unit(a * firstShare + b * (1 - firstShare));
    }
  }

  const oklch = text.match(/oklch\(\s*(-?\d*\.?\d+)(%?)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)/i);
  if (oklch !== null) {
    const raw = Number(oklch[1]);
    if (!Number.isFinite(raw)) return null;
    // `oklch(0.98 …)` and `oklch(98.18% …)` are the same colour.
    return unit(oklch[2] === '%' ? raw / 100 : (raw > 1 ? raw / 100 : raw));
  }

  const hsl = text.match(/hsla?\(\s*(-?\d*\.?\d+)(?:deg)?[\s,]+(-?\d*\.?\d+)%[\s,]+(-?\d*\.?\d+)%/i);
  if (hsl !== null) {
    // HSL lightness is a poor luminance proxy; weight it toward the actual
    // perceived value by mixing in the maximum chroma contribution.
    const lightness = Number(hsl[3]) / 100;
    const saturation = Number(hsl[2]) / 100;
    if (!Number.isFinite(lightness) || !Number.isFinite(saturation)) return null;
    return unit(lightness - saturation * 0.06 * (1 - Math.abs(lightness - 0.5) * 2));
  }

  const rgb = text.match(/rgba?\(\s*(-?\d*\.?\d+)\s*[, ]\s*(-?\d*\.?\d+)\s*[, ]\s*(-?\d*\.?\d+)/i);
  if (rgb !== null) {
    const [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    if (![r, g, b].every(Number.isFinite)) return null;
    return unit((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255);
  }

  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex !== null) {
    let digits = hex[1].slice(0, 6); // ignore the alpha nibble(s)
    if (digits.length === 3 || digits.length === 4) {
      const short = digits.slice(0, 3);
      digits = short.split('').map(c => c + c).join('');
    }
    const n = Number.parseInt(digits, 16);
    if (!Number.isFinite(n)) return null;
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return unit((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255);
  }

  return null;
}

/**
 * Whether a colour is light enough that dark text sits on it.
 *
 * @param value - a CSS colour.
 * @returns true for light colours; false when unknown. Kept for callers that
 *   need a boolean; `deriveCompanion` uses the tri-state `luminance === null`
 *   test instead so an unreadable value is never mistaken for a dark one.
 */
function isLightColor(value) {
  const level = luminance(value);
  return level === null ? false : level > 0.55;
}

/**
 * Shift a colour toward white or black by one step of a surface ladder.
 *
 * A theme gives a handful of surface colours; DSH's alias layer wants a whole
 * ladder (base, three raised layers, overlay, sidebar, input, menu). Deriving
 * the missing rungs with `color-mix` keeps them within the theme's own hue
 * instead of inventing unrelated greys.
 *
 * @param value - the base colour.
 * @param strength - how far to move, as a percentage of white/black mixed in.
 * @param direction - `'lighter'` mixes white, `'darker'` mixes black.
 * @returns the mixed value, or null when there is no input.
 */
function stepColor(value, strength, direction) {
  if (typeof value !== 'string' || value === '') return null;
  const amount = limitPercent(strength);
  if (amount === 0) return value;
  const other = direction === 'lighter' ? 'white' : 'black';
  return `color-mix(in srgb, ${value}, ${other} ${amount}%)`;
}

/**
 * Mix two theme colours, keeping `percentage` of the first.
 *
 * Used to build the steps of a hierarchy (a dimmed label, a tinted code block)
 * out of the theme's own colours, so every derived surface stays in the theme's
 * hue instead of drifting toward a neutral the author never chose.
 *
 * @param value - the colour to keep.
 * @param toward - the colour to blend in.
 * @param percentage - how much of `value` survives.
 * @returns the mixed value, or null when either input is missing.
 */
function mixWith(value, toward, percentage) {
  if (typeof value !== 'string' || value === '') return null;
  if (typeof toward !== 'string' || toward === '') return value;
  const amount = limitPercent(percentage);
  if (amount === 100) return value;
  if (amount === 0) return toward;
  return `color-mix(in srgb, ${value} ${amount}%, ${toward})`;
}

/**
 * Hue angle in degrees, for deciding whether a colour is the colour we hope it
 * is. `chart-3` is nominally green but is beige in real themes. Negative hues
 * are normalised into 0..360.
 *
 * @param value - a CSS colour.
 * @returns the hue in degrees, or null when it cannot be read.
 */
function hue(value) {
  if (typeof value !== 'string') return null;
  const ok = value.match(/oklch\(\s*-?\d*\.?\d+%?\s+-?\d*\.?\d+\s+(-?\d*\.?\d+)/i);
  const hsl = value.match(/hsla?\(\s*(-?\d*\.?\d+)(?:deg)?[\s,]+-?\d*\.?\d+%[\s,]+-?\d*\.?\d+%/i);
  const raw = ok !== null ? ok[1] : (hsl !== null ? hsl[1] : null);
  if (raw === null) return null;
  const angle = Number(raw);
  if (!Number.isFinite(angle)) return null;
  return ((angle % 360) + 360) % 360;
}

/**
 * Whether a colour plausibly is the hue family we want to use it for.
 *
 * Used to refuse a "success green" that is actually beige: a status colour the
 * user cannot decode is worse than DSH's own green.
 *
 * @param value - a CSS colour.
 * @param family - `'green'` or `'amber'`.
 * @returns true when the hue fits, or when the hue is unreadable (hex/rgb).
 */
function hueMatches(value, family) {
  const angle = hue(value);
  if (angle === null) return true;
  // Green sits roughly 110°..170° in oklch. A beige "chart-3" lands near 90°
  // and must not pass, so the window deliberately excludes the yellow border.
  if (family === 'green') return angle >= 110 && angle <= 175;
  // Amber/yellow spans the beige range; orange-red (Claude's chart-4 sits near
  // 42°, which reads as an error colour) is excluded.
  if (family === 'amber') return angle >= 55 && angle <= 105;
  return true;
}

/**
 * Turn a candidate colour into a usable fill that sits on the given surface.
 *
 * tweakcn's `secondary` and `accent` mean "the secondary/accent *plate*" in some
 * themes and "the secondary/accent *ink*" in others — Claude's dark palette sets
 * `--secondary` to near-white. Painting that as a ghost-button fill gives a
 * blinding white block in dark mode, so a candidate that is far from the page is
 * treated as ink and the fill is derived from the page instead.
 *
 * @param candidate - the theme colour proposed as a fill.
 * @param page - the background it must sit on.
 * @param foreground - the ink used to tint the derived fill.
 * @param strength - how strongly to tint the derived fill, in percent.
 * @returns the fill, or null when there is no candidate.
 */
function fillFrom(candidate, page, foreground, strength = 8) {
  if (typeof candidate !== 'string' || candidate === '') return null;
  const mine = luminance(candidate);
  const theirs = luminance(page);
  if (mine === null || theirs === null) return candidate;
  // A fill is a shallow step from the page; anything further away is ink.
  if (Math.abs(mine - theirs) <= 0.14) return candidate;
  // Use the real mixed value. The old code computed `mixWith(...)` only to
  // check for null and then built a string by hand, so a null foreground
  // produced `color-mix(in srgb, null 6%, …)` instead of a safe fallback.
  const mixed = mixWith(foreground, page, 100 - limitPercent(strength));
  return mixed === null ? candidate : `color-mix(in srgb, ${foreground} ${limitPercent(strength)}%, ${page})`;
}

/**
 * Move a colour one rung away from its background, so a derived surface stays
 * visible against the page it sits on.
 *
 * The direction is measured, not assumed: a light theme lifts raised surfaces
 * by going *slightly darker* than a pure-white page, while a dark theme lifts
 * them by going *lighter* than a near-black one. Both are "away from the page".
 * When the colour is already at the extreme (white page, white card) the only
 * way to stay distinguishable is toward the page, so it flips.
 *
 * @param value - the colour to move.
 * @param background - the surface it sits on.
 * @param strength - mix strength, in percent.
 * @returns the moved colour, or the input when the direction is unknowable.
 */
function liftFrom(value, background, strength) {
  if (typeof value !== 'string' || value === '') return null;
  const mine = luminance(value);
  const theirs = luminance(background);
  if (mine === null || theirs === null) return value;

  // Whichever end of the scale the page is at, move toward the other end.
  const pageIsLight = theirs >= 0.5;
  const direction = pageIsLight ? 'darker' : 'lighter';
  return stepColor(value, strength, direction);
}

/** Family-name stacks may only contain characters a font list needs. */
function isSafeFontStack(value) {
  if (typeof value !== 'string' || value === '') return false;
  if (value.length > MAX_VALUE_LENGTH) return false;
  return /^[A-Za-z0-9 ,'"_.\-]+$/.test(value);
}

/**
 * Parse a CSS length into pixels.
 *
 * @param value - e.g. `0.625rem`, `10px`, `0`.
 * @returns pixels, or null.
 */
function parseLengthToPx(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(-?\d*\.?\d+)\s*(px|rem|em)?$/i);
  if (match === null) return null;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return null;
  const unit = (match[2] ?? 'px').toLowerCase();
  if (unit === 'rem' || unit === 'em') return number * 16;
  return number;
}

/**
 * Derive DSH's fixed radius scale from a theme's single `--radius`.
 *
 * tweakcn's `--radius` is the `lg` step of its own scale; DSH's component radius
 * is `--dsw-radius-md`, so `lg` maps to `md` and the rest fan out from there.
 *
 * @param radius - the theme's raw `--radius` value.
 * @returns token -> value pairs, or an empty object when unparseable.
 */
function radiusTokens(radius) {
  const base = parseLengthToPx(radius);
  if (base === null) return {};
  const md = clamp(base + 2, 4, 20);
  return {
    '--dsw-radius-xs': `${clamp(md - 8, 2, 8)}px`,
    '--dsw-radius-sm': `${clamp(md - 4, 2, 16)}px`,
    '--dsw-radius-md': `${md}px`,
    '--dsw-radius-lg': `${clamp(md + 4, 6, 24)}px`,
    '--dsw-radius-xl': `${clamp(md + 8, 10, 28)}px`,
    '--dsw-radius-panel': `${clamp(md + 16, 12, 36)}px`,
  };
}

/** Clamp a percentage to 0..100, keeping fractions; non-finite becomes 0. */
function limitPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, number));
}

/** Clamp to a range and round, used by the numeric derivations. */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/**
 * Clamp a 0..1 fraction without rounding it away.
 *
 * Separate from {@link clamp} on purpose: that one rounds because it feeds
 * pixel values, and rounding here would collapse every light colour to 1 and
 * every dark one to 0, making all ordering comparisons useless. A non-finite
 * input collapses to 0 rather than leaking NaN into CSS.
 */
function unit(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * Rebuild DSH's fixed colour ramps from theme colours.
 *
 * This is the piece that makes the whole window follow a theme. The alias layer
 * is only half the story: several shipped components (`deliverables`, `plan`,
 * `schedule`, `sidebar-files`, `sidebar-right`) paint directly with
 * `var(--dsw-static-neutral-*)`, bypassing the alias layer entirely. Remapping
 * the ramps is the only way the theme reaches them.
 *
 * The two ramps are one fixed white→black scale per colour: stop `00` is the
 * lightest and stop `1000` the darkest, in **both** schemes. The stock sheets
 * keep that meaning and simply pick different ends — light reads `bluish-00`
 * for its page and `bluish-1000` for ink, dark reads `bluish-950` for its page
 * and `bluish-50` for ink. So the ramp is not re-inverted per scheme; each
 * scheme supplies its own two endpoints and every stop is interpolated between
 * them, which leaves the scale's meaning intact.
 *
 * @param parsed - the parse result.
 * @returns ramp token -> `{ light, dark }`, or an empty object when the theme
 *   lacks the colours the interpolation needs.
 */
function staticRamps(parsed) {
  // Light: page is the light end, ink the dark end.
  const lightPage = pick(parsed, 'light', 'background');
  const lightInk = pick(parsed, 'light', 'foreground');
  // Dark: ink is the light end, page the dark end.
  const darkInk = pick(parsed, 'dark', 'foreground');
  const darkPage = pick(parsed, 'dark', 'background');
  if (lightPage === null || lightInk === null || darkPage === null || darkInk === null) return {};

  /**
   * Interpolate one stop; `position` is 0 (lightest) .. 1000 (darkest).
   *
   * The ramp is one fixed white→black scale, and both schemes read it the same
   * way — low stops are the light end, high stops the dark end. What differs per
   * scheme is only the two colours that scale spans. The shipped alias table
   * confirms it: light reads `-00` for its page (white) and `-1000` for ink
   * (near black); dark reads `-950` for its page (near black) and `-50` for ink
   * (near white). Same direction, different endpoints.
   */
  const stop = (position) => {
    // How much of the *light* endpoint survives at this stop.
    const keepLight = 100 - position / 10;
    return {
      light: mixWith(lightPage, lightInk, keepLight),
      dark: mixWith(darkInk, darkPage, keepLight),
    };
  };

  const ramps = {};

  /**
   * The two ramps do not share a stop list — `neutral` has 16 stops and
   * `neutral-bluish` has 22 — so they are declared separately. These are read
   * from the shipped stylesheet; inventing stops would emit overrides that
   * silently do nothing.
   */
  const RAMP_STOPS = {
    neutral: [0, 50, 100, 150, 200, 250, 300, 400, 500, 550, 600, 700, 800, 850, 900, 1000],
    'neutral-bluish': [0, 50, 55, 60, 75, 90, 100, 150, 200, 300, 310, 400, 500, 600, 700, 750, 800, 850, 875, 900, 950, 1000],
  };

  for (const [family, stops] of Object.entries(RAMP_STOPS)) {
    for (const position of stops) {
      ramps[`--dsw-static-${family}-${position === 0 ? '00' : position}`] = stop(position);
    }
  }
  return ramps;
}

/** First defined variable among the candidates, per colour scheme. */
function pick(parsed, mode, ...names) {
  const table = parsed[mode] ?? {};
  for (const name of names) {
    if (typeof table[name] === 'string' && table[name] !== '') return table[name];
  }
  return null;
}

/**
 * One DSH token resolved from one tweakcn variable, for both colour schemes.
 *
 * @param parsed - parse result.
 * @param resolver - given the scheme, returns the value or null.
 * @returns `{ light, dark }` or null when either scheme has no value.
 */
function pair(parsed, resolver) {
  const light = resolver('light');
  const dark = resolver('dark');
  if (light === null || dark === null) return null;
  return { light, dark };
}

/**
 * Build `ctx.theme.overrideTokens` input from a parsed theme.
 *
 * Tokens are only emitted when **both** schemes resolve: `overrideTokens`
 * requires a `{light, dark}` pair, and a theme that covers one scheme must not
 * half-break the other.
 *
 * @param parsed - the parse result.
 * @param options - mapping switches.
 * @returns the override layer plus a report.
 */
function buildOverrides(parsedInput, options = {}) {
  const settings = {
    borders: options.borders ?? 'soft',
    radius: options.radius ?? 'fit',
    fonts: options.fonts ?? true,
    statusTint: options.statusTint ?? false,
    extras: options.extras ?? true,
    ramps: options.ramps ?? true,
    companion: options.companion ?? true,
  };
  // Many tweakcn community themes declare the same palette in both blocks, so
  // switching Light/Dark would show no difference. Derive the missing scheme
  // once, here, so every caller (apply, preview, detail) sees the same result.
  const parsed = ensureTwoSchemes(parsedInput, settings.companion);
  const tokens = {};
  const warnings = [...(parsed.warnings ?? [])];

  const put = (token, modes) => {
    if (modes === null) return;
    // Final safety net: a token must carry two finite string values. A value
    // containing `NaN`/`undefined` is a derivation bug, never a CSS value.
    if (typeof modes?.light !== 'string' || typeof modes?.dark !== 'string') return;
    if (/NaN|undefined|\[object Object\]/.test(modes.light) || /NaN|undefined|\[object Object\]/.test(modes.dark)) return;
    tokens[token] = { light: modes.light, dark: modes.dark };
  };

  // --- surfaces ---------------------------------------------------------
  // A theme names eight surfaces; DSH's alias layer wants a ladder of about
  // twenty. The theme's own colours are used wherever one exists, and the
  // missing rungs are derived *from the theme's page colour* so they keep its
  // hue. Measured against the real fixtures, `card` frequently equals
  // `background` and `input` sits on the opposite side of it in each scheme, so
  // nothing here is assumed from the name alone.
  const page = mode => pick(parsed, mode, 'background');
  const raised = mode => pick(parsed, mode, 'card', 'popover', 'background');
  const overlaySurface = mode => pick(parsed, mode, 'popover', 'card', 'background');
  const sunken = mode => pick(parsed, mode, 'muted', 'secondary', 'card', 'background');

  put('--dsw-alias-bg-base', pair(parsed, page));
  put('--dsw-alias-bg-layer-1', pair(parsed, raised));
  put('--dsw-alias-bg-layer-2', pair(parsed, overlaySurface));
  put('--dsw-alias-bg-layer-3',
    pair(parsed, mode => liftFrom(pick(parsed, mode, 'muted', 'card', 'background'), page(mode), 8)));
  put('--dsw-alias-bg-overlay', pair(parsed, overlaySurface));
  put('--dsw-alias-bg-module-platform', pair(parsed, sunken));
  put('--dsw-alias-bg-multi-select', pair(parsed, sunken));
  put('--dsw-alias-bg-document-preview', pair(parsed, mode => pick(parsed, mode, 'muted', 'card', 'background')));
  put('--dsw-alias-bg-document-selection',
    pair(parsed, mode => tintOverlay(pick(parsed, mode, 'ring', 'primary'), 40)));
  put('--dsw-specific-sidebar-fill', pair(parsed, mode => pick(parsed, mode, 'sidebar', 'background')));
  put('--dsw-specific-input-major',
    pair(parsed, mode => pick(parsed, mode, 'input', 'card', 'background')));
  put('--dsw-specific-login-input',
    pair(parsed, mode => liftFrom(pick(parsed, mode, 'input', 'card', 'background'), page(mode), 6)));
  put('--dsw-specific-selector', pair(parsed, mode => pick(parsed, mode, 'secondary', 'muted')));
  put('--dsw-specific-tip', pair(parsed, sunken));
  put('--dsw-menu-surface-fill',
    pair(parsed, mode => mixWith(overlaySurface(mode), 'transparent', 88)));
  put('--dsw-specific-menu', pair(parsed, mode => mixWith(overlaySurface(mode), 'transparent', 88)));
  put('--dsw-alias-menu-group-header-fill',
    pair(parsed, mode => mixWith(sunken(mode), 'transparent', 92)));

  // DSH's tooltip, toast and contrast buttons are deliberately inverted plates
  // in both schemes; the theme's foreground is the closest colour it owns.
  const invertedPlate = mode => pick(parsed, mode, 'foreground', 'primary');
  put('--dsw-alias-tooltip-bg', pair(parsed, invertedPlate));
  put('--dsw-alias-tooltip-key-bg',
    pair(parsed, mode => stepColor(invertedPlate(mode), 18, 'lighter')));
  put('--dsw-alias-toast-bg', pair(parsed, invertedPlate));
  put('--dsw-alias-toast-label', pair(parsed, page));
  put('--dsw-alias-button-contrast-fill', pair(parsed, mode => pick(parsed, mode, 'primary', 'foreground')));
  put('--dsw-alias-button-elevated-fill', pair(parsed, raised));
  put('--dsw-alias-button-floating-fill', pair(parsed, overlaySurface));
  put('--dsw-alias-button-floating-hover',
    pair(parsed, mode => fillFrom(pick(parsed, mode, 'accent', 'secondary'), page(mode), pick(parsed, mode, 'foreground'), 6)));
  put('--dsw-alias-button-ghost-active-fill',
    pair(parsed, mode => fillFrom(pick(parsed, mode, 'secondary', 'muted'), page(mode), pick(parsed, mode, 'foreground'), 5)));
  put('--dsw-alias-button-ghost-active-hover',
    pair(parsed, mode => fillFrom(pick(parsed, mode, 'secondary', 'muted'), page(mode), pick(parsed, mode, 'foreground'), 9)));
  put('--dsw-alias-button-primary-hover',
    pair(parsed, mode => stepColor(
      pick(parsed, mode, 'primary'),
      12,
      // On a light theme a button darkens on hover; on a dark theme it lifts.
      isLightColor(page(mode)) ? 'darker' : 'lighter')));
  put('--dsw-alias-button-primary-dimmed',
    pair(parsed, mode => mixWith(pick(parsed, mode, 'primary'), page(mode), 22)));
  put('--dsw-alias-button-info-hover',
    pair(parsed, mode => stepColor(pick(parsed, mode, 'primary', 'ring'), 12, 'lighter')));
  put('--dsw-alias-turn-trigger-bg', pair(parsed, sunken));
  put('--dsw-alias-turn-trigger-bg-hover',
    pair(parsed, mode => liftFrom(pick(parsed, mode, 'muted', 'secondary'), page(mode), 8)));
  put('--dsw-alias-bg-skeleton',
    pair(parsed, mode => tintOverlay(pick(parsed, mode, 'foreground'), 5)));

  // --- text -------------------------------------------------------------
  put('--dsw-alias-label-primary', pair(parsed, mode => pick(parsed, mode, 'foreground')));
  put('--dsw-alias-label-secondary',
    pair(parsed, mode => pick(parsed, mode, 'muted-foreground', 'secondary-foreground', 'foreground')));
  put('--dsw-alias-label-tertiary',
    pair(parsed, mode => mixWith(
      pick(parsed, mode, 'muted-foreground', 'foreground'),
      page(mode), 82)));
  put('--dsw-alias-label-caption',
    pair(parsed, mode => mixWith(
      pick(parsed, mode, 'muted-foreground', 'foreground'),
      page(mode), 70)));
  put('--dsw-alias-label-dimmed',
    pair(parsed, mode => mixWith(
      pick(parsed, mode, 'muted-foreground', 'foreground'),
      page(mode), 55)));
  put('--dsw-alias-label-primary-dimmed',
    pair(parsed, mode => mixWith(pick(parsed, mode, 'foreground'), page(mode), 78)));
  put('--dsw-alias-label-primary-inverted', pair(parsed, page));
  put('--dsw-alias-label-document-preview',
    pair(parsed, mode => pick(parsed, mode, 'muted-foreground', 'foreground')));
  put('--dsw-alias-menu-icon',
    pair(parsed, mode => pick(parsed, mode, 'muted-foreground', 'foreground')));
  put('--dsw-alias-link', pair(parsed, mode => pick(parsed, mode, 'primary', 'ring')));
  put('--dsw-alias-markdown-placeholder',
    pair(parsed, mode => mixWith(
      pick(parsed, mode, 'muted-foreground', 'foreground'),
      page(mode), 60)));

  // --- brand ------------------------------------------------------------
  put('--dsw-alias-brand-primary', pair(parsed, mode => pick(parsed, mode, 'primary')));
  put('--dsw-alias-brand-primary-invert', pair(parsed, mode => pick(parsed, mode, 'primary')));
  put('--dsw-alias-brand-text', pair(parsed, mode => pick(parsed, mode, 'primary')));
  // This awkwardly named token is the real accent the components reach for
  // (`var(--dsw-alias-brand-primary-new-colorprimary-new-color)`); it is used
  // more often than `--dsw-alias-brand-primary` itself.
  put('--dsw-alias-brand-primary-new-colorprimary-new-color',
    pair(parsed, mode => pick(parsed, mode, 'primary')));
  // The focus ring resolves through `state-business-primary`, so mapping that
  // moves every focus outline with the theme.
  put('--dsw-focus-ring-color', pair(parsed, mode => pick(parsed, mode, 'ring', 'primary')));
  put('--dsw-alias-button-primary-fill', pair(parsed, mode => pick(parsed, mode, 'primary')));
  put('--dsw-alias-button-info-fill', pair(parsed, mode => pick(parsed, mode, 'ring', 'primary')));
  put('--dsw-alias-label-primary-foreground',
    pair(parsed, mode => pick(parsed, mode, 'primary-foreground', 'background')));
  put('--dsw-alias-switch-thumb',
    pair(parsed, mode => pick(parsed, mode, 'primary-foreground', 'background')));
  put('--dsw-alias-label-primary-bluish', pair(parsed, mode => pick(parsed, mode, 'primary')));
  put('--dsw-alias-state-business-primary',
    pair(parsed, mode => pick(parsed, mode, 'ring', 'primary')));
  put('--dsw-alias-state-business-tertiary',
    pair(parsed, mode => mixWith(pick(parsed, mode, 'primary'), page(mode), 18)));

  // --- status -----------------------------------------------------------
  const errorPair = pair(parsed, mode => {
    const value = pick(parsed, mode, 'destructive');
    if (value === null) return null;
    return isNearGrey(value) ? null : value;
  });
  if (errorPair !== null) {
    put('--dsw-alias-state-error-primary', errorPair);
    put('--dsw-alias-state-error-secondary',
      pair(parsed, mode => stepColor(pick(parsed, mode, 'destructive'), 16, 'lighter')));
    put('--dsw-alias-interactive-bg-hover-danger',
      pair(parsed, mode => tintOverlay(pick(parsed, mode, 'destructive'), 12)));
  } else if (pick(parsed, 'light', 'destructive') !== null) {
    warnings.push('destructive colour is near-grey; keeping the built-in error colour');
  }
  put('--dsw-alias-state-idle-primary', pair(parsed, mode => pick(parsed, mode, 'muted-foreground', 'border')));

  // tweakcn has no success/warning variable; `chart-3`/`chart-4` are the only
  // siblings. They are also frequently *not* green (Claude's chart-3 is beige),
  // so a hue check decides whether they may stand in for a status colour.
  const statusCandidate = (mode, family) => {
    for (const name of family === 'green' ? ['chart-3', 'chart-2'] : ['chart-4', 'chart-5']) {
      const value = pick(parsed, mode, name);
      if (value !== null && hueMatches(value, family)) return value;
    }
    return null;
  };
  const success = mode => statusCandidate(mode, 'green');
  const warn = mode => statusCandidate(mode, 'amber');

  if (settings.statusTint) {
    // This stays opt-in rather than recolouring status by guess.
    put('--dsw-alias-state-success-primary', pair(parsed, success));
    put('--dsw-alias-state-success-secondary', pair(parsed, mode => stepColor(success(mode), 16, 'lighter')));
    put('--dsw-alias-state-success-tertiary', pair(parsed, mode => mixWith(success(mode), page(mode), 18)));
    put('--dsw-alias-state-warn-primary', pair(parsed, warn));
    put('--dsw-alias-state-warn-secondary', pair(parsed, mode => stepColor(warn(mode), 16, 'lighter')));
    put('--dsw-alias-state-warn-tertiary', pair(parsed, mode => mixWith(warn(mode), page(mode), 18)));
    put('--dsw-alias-state-warn-label', pair(parsed, mode => stepColor(warn(mode), 24, 'darker')));
    put('--dsw-alias-state-done-primary',
      pair(parsed, mode => pick(parsed, mode, 'chart-5', 'chart-4')));
  }

  // --- borders ----------------------------------------------------------
  if (settings.borders !== 'off') {
    const soften = settings.borders === 'soft';
    const borderOf = mode => pick(parsed, mode, 'border', 'input');
    if (soften) {
      put('--dsw-alias-border-l1', pair(parsed, mode => softenBorder(borderOf(mode), 45)));
      put('--dsw-alias-border-l2', pair(parsed, mode => softenBorder(borderOf(mode), 80)));
      put('--dsw-alias-border-l2-darkmode-thin', pair(parsed, mode => softenBorder(borderOf(mode), 45)));
      put('--dsw-alias-border-l3', pair(parsed, mode => softenBorder(borderOf(mode), 100)));
      put('--dsw-alias-border-l4', pair(parsed, mode => softenBorder(borderOf(mode), 100)));
    } else {
      for (const token of [
        '--dsw-alias-border-l1',
        '--dsw-alias-border-l2',
        '--dsw-alias-border-l2-darkmode-thin',
        '--dsw-alias-border-l3',
        '--dsw-alias-border-l4',
      ]) {
        put(token, pair(parsed, borderOf));
      }
    }
    put('--dsw-alias-border-inverted', pair(parsed, mode => softenBorder(page(mode), 12)));
    put('--dsw-alias-border-inverted2', pair(parsed, mode => softenBorder(page(mode), 18)));
    put('--dsw-alias-button-ghost-active-border', pair(parsed, borderOf));
    put('--dsw-alias-interactive-bg-hover',
      pair(parsed, mode => tintOverlay(pick(parsed, mode, 'accent', 'foreground'), 8)));
    put('--dsw-alias-interactive-bg-active',
      pair(parsed, mode => tintOverlay(pick(parsed, mode, 'accent', 'foreground'), 14)));
  }

  // --- optional polish --------------------------------------------------
  if (settings.extras) {
    put('--dsw-alias-markdown-code-block', pair(parsed, sunken));
    put('--dsw-alias-markdown-code-block-banner',
      pair(parsed, mode => liftFrom(sunken(mode), page(mode), 6)));
    put('--dsw-alias-markdown-inline-code',
      pair(parsed, mode => pick(parsed, mode, 'muted', 'secondary', 'card')));
    put('--dsw-alias-markdown-code-segment-selected', pair(parsed, raised));
    put('--dsw-alias-markdown-code-segment-unselected', pair(parsed, sunken));
    put('--dsw-alias-markdown-tag', pair(parsed, mode => pick(parsed, mode, 'secondary', 'muted')));
    put('--dsw-alias-markdown-citation',
      pair(parsed, mode => mixWith(pick(parsed, mode, 'muted', 'secondary'), page(mode), 55)));
    put('--dsw-alias-interactive-bg-hover-solid',
      pair(parsed, mode => pick(parsed, mode, 'accent', 'secondary')));
    put('--dsw-alias-interactive-bg-hover-accent',
      pair(parsed, mode => tintOverlay(pick(parsed, mode, 'ring', 'primary'), 22)));
    put('--dsw-specific-sidebar-nav-item-active',
      pair(parsed, mode => pick(parsed, mode, 'sidebar-accent', 'accent', 'secondary')));
    put('--dsw-specific-sidebar-nav-item-active-accent',
      pair(parsed, mode => pick(parsed, mode, 'sidebar-primary', 'primary')));
    put('--dsw-specific-bubble', pair(parsed, mode => pick(parsed, mode, 'muted', 'secondary', 'card')));
    put('--dsw-specific-bubble-highlight',
      pair(parsed, mode => pick(parsed, mode, 'accent', 'secondary', 'muted')));
    put('--dsw-alias-scrollbar-bg-l1',
      pair(parsed, mode => mixWith(pick(parsed, mode, 'muted-foreground', 'border'), page(mode), 45)));
    put('--dsw-alias-scrollbar-bg-l2',
      pair(parsed, mode => mixWith(pick(parsed, mode, 'muted-foreground', 'border'), page(mode), 60)));
    put('--dsw-alias-scrollbar-hover-l1',
      pair(parsed, mode => mixWith(pick(parsed, mode, 'muted-foreground', 'border'), page(mode), 62)));
    put('--dsw-alias-scrollbar-hover-l2',
      pair(parsed, mode => mixWith(pick(parsed, mode, 'muted-foreground', 'border'), page(mode), 78)));
    put('--dsw-alias-label-shimmer',
      pair(parsed, mode => mixWith(pick(parsed, mode, 'muted-foreground', 'foreground'), page(mode), 35)));
    put('--dsw-alias-illustration-background', pair(parsed, mode => pick(parsed, mode, 'muted', 'secondary')));
    put('--dsw-alias-illustration-surface', pair(parsed, raised));
    put('--dsw-alias-illustration-backing',
      pair(parsed, mode => liftFrom(pick(parsed, mode, 'muted', 'secondary'), page(mode), 12)));
    put('--dsw-alias-illustration-detail',
      pair(parsed, mode => mixWith(pick(parsed, mode, 'muted-foreground'), page(mode), 60)));
    put('--dsw-alias-illustration-inset', pair(parsed, raised));
    put('--dsw-alias-illustration-shadow', pair(parsed, mode => pick(parsed, mode, 'border', 'muted')));
    put('--dsw-alias-file-diff-added-bg', pair(parsed, mode => tintOverlay(success(mode), 16)));
    put('--dsw-alias-file-diff-added-gutter', pair(parsed, mode => tintOverlay(success(mode), 8)));
    put('--dsw-alias-file-diff-added-marker', pair(parsed, success));
    put('--dsw-alias-file-diff-deleted-bg', pair(parsed, mode => tintOverlay(pick(parsed, mode, 'destructive'), 14)));
    put('--dsw-alias-file-diff-deleted-gutter', pair(parsed, mode => tintOverlay(pick(parsed, mode, 'destructive'), 7)));
    put('--dsw-alias-file-diff-deleted-marker', pair(parsed, mode => pick(parsed, mode, 'destructive')));
    put('--dsw-alias-code-diff-added', pair(parsed, mode => tintOverlay(success(mode), 10)));
    put('--dsw-alias-code-diff-deleted', pair(parsed, mode => tintOverlay(pick(parsed, mode, 'destructive'), 10)));
  }

  // --- radius -----------------------------------------------------------
  if (settings.radius !== 'off' && typeof parsed.shared?.radius === 'string') {
    for (const [token, value] of Object.entries(radiusTokens(parsed.shared.radius))) {
      tokens[token] = { light: value, dark: value };
    }
  }

  // --- fonts ------------------------------------------------------------
  // `--dsh-font-family-*` belong to the theme presenter (it rewrites them from
  // the user's font settings on every publish), so the theme writes the derived
  // body variables instead — those are plain `var()` chains the presenter
  // leaves alone.
  if (settings.fonts) {
    const sans = parsed.shared?.['font-sans'];
    if (typeof sans === 'string') {
      if (isSafeFontStack(sans)) tokens['--dsw-font-family'] = { light: sans, dark: sans };
      else warnings.push('ignored --font-sans: characters outside a font list');
    }
    const mono = parsed.shared?.['font-mono'];
    if (typeof mono === 'string') {
      if (isSafeFontStack(mono)) tokens['--ds-font-family-code'] = { light: mono, dark: mono };
      else warnings.push('ignored --font-mono: characters outside a font list');
    }
  }

  // --- static ramps -----------------------------------------------------
  // Components that bypass the alias layer (`deliverables`, `plan`, `schedule`,
  // `sidebar-files`, `sidebar-right`) paint with these ramps directly, so they
  // have to move too or those panels keep their stock colours.
  if (settings.ramps) {
    for (const [token, modes] of Object.entries(staticRamps(parsed))) {
      put(token, modes);
    }
  }

  if (Object.keys(tokens).length === 0) warnings.push('nothing to apply');
  return { tokens, warnings, count: Object.keys(tokens).length };
}

/**
 * Human-readable summary of one applied layer, for the settings page.
 *
 * A mode value must be a real string with no leaked `NaN`/`undefined`; an
 * invalid entry is dropped rather than rendered into the UI.
 *
 * @param tokens - override layer.
 * @returns one row per token with valid `light`/`dark` strings.
 */
function describeOverrides(tokens) {
  if (tokens === null || typeof tokens !== 'object') return [];
  const safe = (value) => typeof value === 'string' && value !== ''
    && !/NaN|undefined|\[object Object\]/.test(value);
  return Object.entries(tokens)
    .filter(([, modes]) => modes !== null && typeof modes === 'object'
      && safe(modes.light) && safe(modes.dark))
    .map(([name, modes]) => ({
      name,
      light: modes.light,
      dark: modes.dark,
    }));
}

    // ---------------------------------------------------------------------
    // Background + liquid-glass layer (generated from src/backdrop.js).
    // ---------------------------------------------------------------------
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
const MAX_DATA_URL_BYTES = 1_500_000;

/** Stable IDs/attributes used by the client half. */
const BACKDROP_LAYER_ID = 'dsh-custom-theme-backdrop';
const BACKDROP_ATTR = 'data-dsh-backdrop';
const GLASS_ATTR = 'data-dsh-glass';

const DEFAULT_BACKDROP = Object.freeze({
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
function checkBackgroundUrl(raw, kind) {
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
function normalizeBackdrop(raw) {
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
function buildBackdropCss(backdrop, captionFill) {
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
function buildGlassCss(backdrop) {
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
function pointerGlassVars(event, rect, options = {}) {
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
function restingGlassVars() {
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
function buildRefractionSvg(backdrop) {
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
function buildBackgroundTokens(backdrop, themeTokens = {}) {
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
function describeMedia(backdrop) {
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
function shouldPauseVideo(backdrop, query, hidden) {
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


    // ---------------------------------------------------------------------
    // Built-in presets (copied from tweakcn, oklch export shape).
    // ---------------------------------------------------------------------
    const PRESETS = [
  {
    "id": "claude",
    "label": "Claude",
    "css": "/* Claude — copied from https://tweakcn.com (Tailwind v4 / oklch export shape). */\r\n/* Only CSS custom-property declarations matter; selectors are shown for realism. */\r\n\r\n:root {\r\n  --background: oklch(0.9818 0.0054 95.0986);\r\n  --foreground: oklch(0.3438 0.0269 95.7226);\r\n  --card: oklch(0.9818 0.0054 95.0986);\r\n  --card-foreground: oklch(0.1908 0.0020 106.5859);\r\n  --popover: oklch(1.0000 0 0);\r\n  --popover-foreground: oklch(0.2671 0.0196 98.9390);\r\n  --primary: oklch(0.6171 0.1375 39.0427);\r\n  --primary-foreground: oklch(1.0000 0 0);\r\n  --secondary: oklch(0.9245 0.0138 92.9892);\r\n  --secondary-foreground: oklch(0.4334 0.0177 98.6048);\r\n  --muted: oklch(0.9341 0.0153 90.2390);\r\n  --muted-foreground: oklch(0.6059 0.0075 97.4233);\r\n  --accent: oklch(0.9245 0.0138 92.9892);\r\n  --accent-foreground: oklch(0.2671 0.0196 98.9390);\r\n  --destructive: oklch(0.1908 0.0020 106.5859);\r\n  --destructive-foreground: oklch(1.0000 0 0);\r\n  --border: oklch(0.8847 0.0069 97.3627);\r\n  --input: oklch(0.7621 0.0156 98.3528);\r\n  --ring: oklch(0.6171 0.1375 39.0427);\r\n  --chart-1: oklch(0.5583 0.1276 42.9956);\r\n  --chart-2: oklch(0.6898 0.1581 290.4107);\r\n  --chart-3: oklch(0.8816 0.0276 93.1280);\r\n  --chart-4: oklch(0.8822 0.0403 298.1792);\r\n  --chart-5: oklch(0.5608 0.1348 42.0584);\r\n  --sidebar: oklch(0.9663 0.0080 98.8792);\r\n  --sidebar-foreground: oklch(0.3590 0.0051 106.6524);\r\n  --sidebar-primary: oklch(0.6171 0.1375 39.0427);\r\n  --sidebar-primary-foreground: oklch(0.9881 0 0);\r\n  --sidebar-accent: oklch(0.9245 0.0138 92.9892);\r\n  --sidebar-accent-foreground: oklch(0.3250 0 0);\r\n  --sidebar-border: oklch(0.9401 0 0);\r\n  --sidebar-ring: oklch(0.7731 0 0);\r\n  --font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji';\r\n  --font-serif: ui-serif, Georgia, Cambria, \"Times New Roman\", Times, serif;\r\n  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace;\r\n  --radius: 0.5rem;\r\n  --shadow-color: oklch(0 0 0);\r\n  --shadow-opacity: 0.1;\r\n  --shadow-blur: 3px;\r\n  --shadow-spread: 0px;\r\n  --shadow-x: 0;\r\n  --shadow-y: 1px;\r\n  --shadow-2xs: 0 1px 3px 0px hsl(0 0% 0% / 0.05);\r\n  --shadow-xs: 0 1px 3px 0px hsl(0 0% 0% / 0.05);\r\n  --shadow-sm: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 1px 2px -1px hsl(0 0% 0% / 0.10);\r\n  --shadow: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 1px 2px -1px hsl(0 0% 0% / 0.10);\r\n  --shadow-md: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 2px 4px -1px hsl(0 0% 0% / 0.10);\r\n  --shadow-lg: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 4px 6px -1px hsl(0 0% 0% / 0.10);\r\n  --shadow-xl: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 8px 10px -1px hsl(0 0% 0% / 0.10);\r\n  --shadow-2xl: 0 1px 3px 0px hsl(0 0% 0% / 0.25);\r\n  --tracking-normal: 0em;\r\n  --spacing: 0.25rem;\r\n}\r\n\r\n.dark {\r\n  --background: oklch(0.2679 0.0036 106.6427);\r\n  --foreground: oklch(0.8074 0.0142 93.0137);\r\n  --card: oklch(0.2679 0.0036 106.6427);\r\n  --card-foreground: oklch(0.9818 0.0054 95.0986);\r\n  --popover: oklch(0.3085 0.0035 106.6039);\r\n  --popover-foreground: oklch(0.9211 0.0040 106.4781);\r\n  --primary: oklch(0.6724 0.1308 38.7559);\r\n  --primary-foreground: oklch(1.0000 0 0);\r\n  --secondary: oklch(0.9818 0.0054 95.0986);\r\n  --secondary-foreground: oklch(0.3085 0.0035 106.6039);\r\n  --muted: oklch(0.2213 0.0038 106.7070);\r\n  --muted-foreground: oklch(0.7713 0.0169 99.0657);\r\n  --accent: oklch(0.2130 0.0078 95.4245);\r\n  --accent-foreground: oklch(0.9663 0.0080 98.8792);\r\n  --destructive: oklch(0.6368 0.2078 25.3313);\r\n  --destructive-foreground: oklch(1.0000 0 0);\r\n  --border: oklch(0.3618 0.0101 106.8928);\r\n  --input: oklch(0.4336 0.0113 100.2195);\r\n  --ring: oklch(0.6724 0.1308 38.7559);\r\n  --chart-1: oklch(0.5583 0.1276 42.9956);\r\n  --chart-2: oklch(0.6898 0.1581 290.4107);\r\n  --chart-3: oklch(0.2130 0.0078 95.4245);\r\n  --chart-4: oklch(0.3074 0.0516 289.3230);\r\n  --chart-5: oklch(0.5608 0.1348 42.0584);\r\n  --sidebar: oklch(0.2357 0.0024 67.7077);\r\n  --sidebar-foreground: oklch(0.8074 0.0142 93.0137);\r\n  --sidebar-primary: oklch(0.3250 0 0);\r\n  --sidebar-primary-foreground: oklch(0.9881 0 0);\r\n  --sidebar-accent: oklch(0.1680 0.0020 106.6177);\r\n  --sidebar-accent-foreground: oklch(0.8074 0.0142 93.0137);\r\n  --sidebar-border: oklch(0.9401 0 0);\r\n  --sidebar-ring: oklch(0.7731 0 0);\r\n  --font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji';\r\n  --font-serif: ui-serif, Georgia, Cambria, \"Times New Roman\", Times, serif;\r\n  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace;\r\n  --radius: 0.5rem;\r\n  --shadow-color: oklch(0 0 0);\r\n  --shadow-opacity: 0.1;\r\n  --shadow-blur: 3px;\r\n  --shadow-spread: 0px;\r\n  --shadow-x: 0;\r\n  --shadow-y: 1px;\r\n  --shadow-2xs: 0 1px 3px 0px hsl(0 0% 0% / 0.05);\r\n  --shadow-xs: 0 1px 3px 0px hsl(0 0% 0% / 0.05);\r\n  --shadow-sm: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 1px 2px -1px hsl(0 0% 0% / 0.10);\r\n  --shadow: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 1px 2px -1px hsl(0 0% 0% / 0.10);\r\n  --shadow-md: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 2px 4px -1px hsl(0 0% 0% / 0.10);\r\n  --shadow-lg: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 4px 6px -1px hsl(0 0% 0% / 0.10);\r\n  --shadow-xl: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 8px 10px -1px hsl(0 0% 0% / 0.10);\r\n  --shadow-2xl: 0 1px 3px 0px hsl(0 0% 0% / 0.25);\r\n}\r\n\r\n"
  },
  {
    "id": "amethyst-haze",
    "label": "Amethyst Haze",
    "css": "/* Amethyst Haze — copied from https://tweakcn.com (Tailwind v4 / oklch export shape). */\r\n/* Only CSS custom-property declarations matter; selectors are shown for realism. */\r\n\r\n:root {\r\n  --background: oklch(0.9777 0.0041 301.4256);\r\n  --foreground: oklch(0.3651 0.0325 287.0807);\r\n  --card: oklch(1.0000 0 0);\r\n  --card-foreground: oklch(0.3651 0.0325 287.0807);\r\n  --popover: oklch(1.0000 0 0);\r\n  --popover-foreground: oklch(0.3651 0.0325 287.0807);\r\n  --primary: oklch(0.6104 0.0767 299.7335);\r\n  --primary-foreground: oklch(0.9777 0.0041 301.4256);\r\n  --secondary: oklch(0.8957 0.0265 300.2416);\r\n  --secondary-foreground: oklch(0.3651 0.0325 287.0807);\r\n  --muted: oklch(0.8906 0.0139 299.7754);\r\n  --muted-foreground: oklch(0.5288 0.0375 290.7895);\r\n  --accent: oklch(0.7889 0.0802 359.9375);\r\n  --accent-foreground: oklch(0.3394 0.0441 1.7583);\r\n  --destructive: oklch(0.6332 0.1578 22.6734);\r\n  --destructive-foreground: oklch(0.9777 0.0041 301.4256);\r\n  --border: oklch(0.8447 0.0226 300.1421);\r\n  --input: oklch(0.9329 0.0124 301.2783);\r\n  --ring: oklch(0.6104 0.0767 299.7335);\r\n  --chart-1: oklch(0.6104 0.0767 299.7335);\r\n  --chart-2: oklch(0.7889 0.0802 359.9375);\r\n  --chart-3: oklch(0.7321 0.0749 169.8670);\r\n  --chart-4: oklch(0.8540 0.0882 76.8292);\r\n  --chart-5: oklch(0.7857 0.0645 258.0839);\r\n  --sidebar: oklch(0.9554 0.0082 301.3541);\r\n  --sidebar-foreground: oklch(0.3651 0.0325 287.0807);\r\n  --sidebar-primary: oklch(0.6104 0.0767 299.7335);\r\n  --sidebar-primary-foreground: oklch(0.9777 0.0041 301.4256);\r\n  --sidebar-accent: oklch(0.7889 0.0802 359.9375);\r\n  --sidebar-accent-foreground: oklch(0.3394 0.0441 1.7583);\r\n  --sidebar-border: oklch(0.8719 0.0198 302.1690);\r\n  --sidebar-ring: oklch(0.6104 0.0767 299.7335);\r\n  --font-sans: Geist, sans-serif;\r\n  --font-serif: \"Lora\", Georgia, serif;\r\n  --font-mono: \"Fira Code\", \"Courier New\", monospace;\r\n  --radius: 0.5rem;\r\n  --shadow-color: hsl(0 0% 0%);\r\n  --shadow-opacity: 0.06;\r\n  --shadow-blur: 5px;\r\n  --shadow-spread: 1px;\r\n  --shadow-x: 1px;\r\n  --shadow-y: 2px;\r\n  --shadow-2xs: 1px 2px 5px 1px hsl(0 0% 0% / 0.03);\r\n  --shadow-xs: 1px 2px 5px 1px hsl(0 0% 0% / 0.03);\r\n  --shadow-sm: 1px 2px 5px 1px hsl(0 0% 0% / 0.06), 1px 1px 2px 0px hsl(0 0% 0% / 0.06);\r\n  --shadow: 1px 2px 5px 1px hsl(0 0% 0% / 0.06), 1px 1px 2px 0px hsl(0 0% 0% / 0.06);\r\n  --shadow-md: 1px 2px 5px 1px hsl(0 0% 0% / 0.06), 1px 2px 4px 0px hsl(0 0% 0% / 0.06);\r\n  --shadow-lg: 1px 2px 5px 1px hsl(0 0% 0% / 0.06), 1px 4px 6px 0px hsl(0 0% 0% / 0.06);\r\n  --shadow-xl: 1px 2px 5px 1px hsl(0 0% 0% / 0.06), 1px 8px 10px 0px hsl(0 0% 0% / 0.06);\r\n  --shadow-2xl: 1px 2px 5px 1px hsl(0 0% 0% / 0.15);\r\n  --tracking-normal: 0em;\r\n  --spacing: 0.25rem;\r\n}\r\n\r\n.dark {\r\n  --background: oklch(0.2166 0.0215 292.8474);\r\n  --foreground: oklch(0.9053 0.0245 293.5570);\r\n  --card: oklch(0.2544 0.0301 292.7315);\r\n  --card-foreground: oklch(0.9053 0.0245 293.5570);\r\n  --popover: oklch(0.2544 0.0301 292.7315);\r\n  --popover-foreground: oklch(0.9053 0.0245 293.5570);\r\n  --primary: oklch(0.7058 0.0777 302.0489);\r\n  --primary-foreground: oklch(0.2166 0.0215 292.8474);\r\n  --secondary: oklch(0.4604 0.0472 295.5578);\r\n  --secondary-foreground: oklch(0.9053 0.0245 293.5570);\r\n  --muted: oklch(0.2560 0.0320 294.8380);\r\n  --muted-foreground: oklch(0.6974 0.0282 300.0614);\r\n  --accent: oklch(0.3181 0.0321 308.6149);\r\n  --accent-foreground: oklch(0.8391 0.0692 2.6681);\r\n  --destructive: oklch(0.6875 0.1420 21.4566);\r\n  --destructive-foreground: oklch(0.2166 0.0215 292.8474);\r\n  --border: oklch(0.3063 0.0359 293.3367);\r\n  --input: oklch(0.2847 0.0346 291.2726);\r\n  --ring: oklch(0.7058 0.0777 302.0489);\r\n  --chart-1: oklch(0.7058 0.0777 302.0489);\r\n  --chart-2: oklch(0.8391 0.0692 2.6681);\r\n  --chart-3: oklch(0.7321 0.0749 169.8670);\r\n  --chart-4: oklch(0.8540 0.0882 76.8292);\r\n  --chart-5: oklch(0.7857 0.0645 258.0839);\r\n  --sidebar: oklch(0.1985 0.0200 293.6639);\r\n  --sidebar-foreground: oklch(0.9053 0.0245 293.5570);\r\n  --sidebar-primary: oklch(0.7058 0.0777 302.0489);\r\n  --sidebar-primary-foreground: oklch(0.2166 0.0215 292.8474);\r\n  --sidebar-accent: oklch(0.3181 0.0321 308.6149);\r\n  --sidebar-accent-foreground: oklch(0.8391 0.0692 2.6681);\r\n  --sidebar-border: oklch(0.2847 0.0346 291.2726);\r\n  --sidebar-ring: oklch(0.7058 0.0777 302.0489);\r\n  --font-sans: Geist, sans-serif;\r\n  --font-serif: \"Lora\", Georgia, serif;\r\n  --font-mono: \"Fira Code\", \"Courier New\", monospace;\r\n  --radius: 0.5rem;\r\n  --shadow-color: hsl(0 0% 0%);\r\n  --shadow-opacity: 0.06;\r\n  --shadow-blur: 5px;\r\n  --shadow-spread: 1px;\r\n  --shadow-x: 1px;\r\n  --shadow-y: 2px;\r\n  --shadow-2xs: 1px 2px 5px 1px hsl(0 0% 0% / 0.03);\r\n  --shadow-xs: 1px 2px 5px 1px hsl(0 0% 0% / 0.03);\r\n  --shadow-sm: 1px 2px 5px 1px hsl(0 0% 0% / 0.06), 1px 1px 2px 0px hsl(0 0% 0% / 0.06);\r\n  --shadow: 1px 2px 5px 1px hsl(0 0% 0% / 0.06), 1px 1px 2px 0px hsl(0 0% 0% / 0.06);\r\n  --shadow-md: 1px 2px 5px 1px hsl(0 0% 0% / 0.06), 1px 2px 4px 0px hsl(0 0% 0% / 0.06);\r\n  --shadow-lg: 1px 2px 5px 1px hsl(0 0% 0% / 0.06), 1px 4px 6px 0px hsl(0 0% 0% / 0.06);\r\n  --shadow-xl: 1px 2px 5px 1px hsl(0 0% 0% / 0.06), 1px 8px 10px 0px hsl(0 0% 0% / 0.06);\r\n  --shadow-2xl: 1px 2px 5px 1px hsl(0 0% 0% / 0.15);\r\n}\r\n\r\n"
  },
  {
    "id": "t3-chat",
    "label": "T3 Chat",
    "css": "/* T3 Chat — copied from https://tweakcn.com (Tailwind v4 / oklch export shape). */\r\n/* Only CSS custom-property declarations matter; selectors are shown for realism. */\r\n\r\n:root {\r\n  --background: oklch(0.9754 0.0084 325.6414);\r\n  --foreground: oklch(0.3257 0.1161 325.0372);\r\n  --card: oklch(0.9754 0.0084 325.6414);\r\n  --card-foreground: oklch(0.3257 0.1161 325.0372);\r\n  --popover: oklch(1.0000 0 0);\r\n  --popover-foreground: oklch(0.3257 0.1161 325.0372);\r\n  --primary: oklch(0.5316 0.1409 355.1999);\r\n  --primary-foreground: oklch(1.0000 0 0);\r\n  --secondary: oklch(0.8696 0.0675 334.8991);\r\n  --secondary-foreground: oklch(0.4448 0.1341 324.7991);\r\n  --muted: oklch(0.9395 0.0260 331.5454);\r\n  --muted-foreground: oklch(0.4924 0.1244 324.4523);\r\n  --accent: oklch(0.8696 0.0675 334.8991);\r\n  --accent-foreground: oklch(0.4448 0.1341 324.7991);\r\n  --destructive: oklch(0.5248 0.1368 20.8317);\r\n  --destructive-foreground: oklch(1.0000 0 0);\r\n  --border: oklch(0.8568 0.0829 328.9110);\r\n  --input: oklch(0.8517 0.0558 336.6002);\r\n  --ring: oklch(0.5916 0.2180 0.5844);\r\n  --chart-1: oklch(0.6038 0.2363 344.4657);\r\n  --chart-2: oklch(0.4445 0.2251 300.6246);\r\n  --chart-3: oklch(0.3790 0.0438 226.1538);\r\n  --chart-4: oklch(0.8330 0.1185 88.3461);\r\n  --chart-5: oklch(0.7843 0.1256 58.9964);\r\n  --sidebar: oklch(0.9360 0.0288 320.5788);\r\n  --sidebar-foreground: oklch(0.4948 0.1909 354.5435);\r\n  --sidebar-primary: oklch(0.3963 0.0251 285.1962);\r\n  --sidebar-primary-foreground: oklch(0.9668 0.0124 337.5228);\r\n  --sidebar-accent: oklch(0.9789 0.0013 106.4235);\r\n  --sidebar-accent-foreground: oklch(0.3963 0.0251 285.1962);\r\n  --sidebar-border: oklch(0.9383 0.0026 48.7178);\r\n  --sidebar-ring: oklch(0.5916 0.2180 0.5844);\r\n  --font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji';\r\n  --font-serif: ui-serif, Georgia, Cambria, \"Times New Roman\", Times, serif;\r\n  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace;\r\n  --radius: 0.5rem;\r\n  --shadow-color: oklch(0 0 0);\r\n  --shadow-opacity: 0.1;\r\n  --shadow-blur: 3px;\r\n  --shadow-spread: 0px;\r\n  --shadow-x: 0;\r\n  --shadow-y: 1px;\r\n  --shadow-2xs: 0 1px 3px 0px hsl(0 0% 0% / 0.05);\r\n  --shadow-xs: 0 1px 3px 0px hsl(0 0% 0% / 0.05);\r\n  --shadow-sm: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 1px 2px -1px hsl(0 0% 0% / 0.10);\r\n  --shadow: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 1px 2px -1px hsl(0 0% 0% / 0.10);\r\n  --shadow-md: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 2px 4px -1px hsl(0 0% 0% / 0.10);\r\n  --shadow-lg: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 4px 6px -1px hsl(0 0% 0% / 0.10);\r\n  --shadow-xl: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 8px 10px -1px hsl(0 0% 0% / 0.10);\r\n  --shadow-2xl: 0 1px 3px 0px hsl(0 0% 0% / 0.25);\r\n  --tracking-normal: 0em;\r\n  --spacing: 0.25rem;\r\n}\r\n\r\n.dark {\r\n  --background: oklch(0.2409 0.0201 307.5346);\r\n  --foreground: oklch(0.8398 0.0387 309.5391);\r\n  --card: oklch(0.2803 0.0232 307.5413);\r\n  --card-foreground: oklch(0.8456 0.0302 341.4597);\r\n  --popover: oklch(0.1548 0.0132 338.9015);\r\n  --popover-foreground: oklch(0.9647 0.0091 341.8035);\r\n  --primary: oklch(0.4607 0.1853 4.0994);\r\n  --primary-foreground: oklch(0.8560 0.0618 346.3684);\r\n  --secondary: oklch(0.3137 0.0306 310.0610);\r\n  --secondary-foreground: oklch(0.8483 0.0382 307.9613);\r\n  --muted: oklch(0.2634 0.0219 309.4748);\r\n  --muted-foreground: oklch(0.7940 0.0372 307.1032);\r\n  --accent: oklch(0.3649 0.0508 308.4911);\r\n  --accent-foreground: oklch(0.9647 0.0091 341.8035);\r\n  --destructive: oklch(0.2258 0.0524 12.6119);\r\n  --destructive-foreground: oklch(1.0000 0 0);\r\n  --border: oklch(0.3286 0.0154 343.4461);\r\n  --input: oklch(0.3387 0.0195 332.8347);\r\n  --ring: oklch(0.5916 0.2180 0.5844);\r\n  --chart-1: oklch(0.5316 0.1409 355.1999);\r\n  --chart-2: oklch(0.5633 0.1912 306.8561);\r\n  --chart-3: oklch(0.7227 0.1502 60.5799);\r\n  --chart-4: oklch(0.6193 0.2029 312.7422);\r\n  --chart-5: oklch(0.6118 0.2093 6.1387);\r\n  --sidebar: oklch(0.1893 0.0163 331.0475);\r\n  --sidebar-foreground: oklch(0.8607 0.0293 343.6612);\r\n  --sidebar-primary: oklch(0.4882 0.2172 264.3763);\r\n  --sidebar-primary-foreground: oklch(1.0000 0 0);\r\n  --sidebar-accent: oklch(0.2337 0.0261 338.1961);\r\n  --sidebar-accent-foreground: oklch(0.9674 0.0013 286.3752);\r\n  --sidebar-border: oklch(0 0 0);\r\n  --sidebar-ring: oklch(0.5916 0.2180 0.5844);\r\n  --font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji';\r\n  --font-serif: ui-serif, Georgia, Cambria, \"Times New Roman\", Times, serif;\r\n  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace;\r\n  --radius: 0.5rem;\r\n  --shadow-color: oklch(0 0 0);\r\n  --shadow-opacity: 0.1;\r\n  --shadow-blur: 3px;\r\n  --shadow-spread: 0px;\r\n  --shadow-x: 0;\r\n  --shadow-y: 1px;\r\n  --shadow-2xs: 0 1px 3px 0px hsl(0 0% 0% / 0.05);\r\n  --shadow-xs: 0 1px 3px 0px hsl(0 0% 0% / 0.05);\r\n  --shadow-sm: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 1px 2px -1px hsl(0 0% 0% / 0.10);\r\n  --shadow: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 1px 2px -1px hsl(0 0% 0% / 0.10);\r\n  --shadow-md: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 2px 4px -1px hsl(0 0% 0% / 0.10);\r\n  --shadow-lg: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 4px 6px -1px hsl(0 0% 0% / 0.10);\r\n  --shadow-xl: 0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 8px 10px -1px hsl(0 0% 0% / 0.10);\r\n  --shadow-2xl: 0 1px 3px 0px hsl(0 0% 0% / 0.25);\r\n}\r\n\r\n"
  }
];

    // ---------------------------------------------------------------------
    // Dictionaries
    // ---------------------------------------------------------------------
    /**
 * Browser dictionaries. `zh` is the key-set source of truth; every other locale
 * must carry the same keys.
 *
 * Kept as a plain object literal inside `client.js` because the client module
 * system has no JSON import and the plugin ships no build step.
 */
const DICTIONARIES = {
  zh: {
    nav: '自定义主题',
    'intro.title': '从 tweakcn 导入主题',
    'intro.hint1': '在',
    'intro.hint2': '挑选或调好一套主题，点「复制主题 / Copy theme」把 CSS 粘贴到下面即可。',
    'intro.rule': '只会读取 CSS 变量声明（--primary: … 这种），并映射到 Harness 自己的设计令牌；选择器、@apply 等规则一律忽略，粘贴内容不会作为样式表插入页面。',
    'paste.title': '主题 CSS',
    'paste.placeholder': ':root {\n  --background: oklch(0.98 0.004 95);\n  --primary: oklch(0.62 0.14 39);\n  …\n}\n\n.dark {\n  --background: oklch(0.29 0 0);\n  --primary: oklch(0.76 0 0);\n  …\n}',
    'paste.apply': '应用主题',
    'paste.reset': '恢复默认',
    'paste.showDetail': '查看映射（{count}）',
    'paste.hideDetail': '收起映射',
    'paste.loadApplied': '载入已应用',
    'preset.label': '内置预设',
    'preset.placeholder': '选一个预设…',
    'mapping.title': '映射选项',
    'mapping.hint': '主题里的颜色会映射到 Harness 的界面令牌。这些开关控制额外接管哪些部分。',
    'mapping.borders': '接管边框颜色',
    'mapping.fonts': '接管字体（正文字体 + 代码字体）',
    'mapping.radius': '按主题圆角换算圆角档位',
    'mapping.extras': '接管代码块、滚动条、悬停等细节',
    'mapping.statusTint': '用主题配色给成功 / 警告状态上色',
    'mapping.companion': '单套配色时自动推导另一套（浅色 / 深色）',
    'warn.singleScheme': '这套主题的浅色和深色块是同一套配色，切换深浅色看不出区别；已开启「自动推导另一套」。',
    'bg.title': '自定义背景与液态玻璃',
    'bg.hint': '给整个窗口铺一层图片或视频背景，并可选把输入框变成毛玻璃。参数实时生效。',
    'bg.enable': '启用自定义背景',
    'bg.kind': '类型',
    'bg.kindImage': '图片',
    'bg.kindVideo': '视频',
    'bg.fitCover': '铺满裁切',
    'bg.fitContain': '完整显示',
    'bg.urlPlaceholder': 'https://…/wallpaper.jpg（或点下面的按钮选本地图片）',
    'bg.pickFile': '选择本地图片',
    'bg.clear': '清除地址',
    'bg.security': '只允许 http(s) 链接或本地图片（转成内置数据）；SVG、脚本链接、超大文件会被拒绝。视频请用链接，本地视频不入库。',
    'bg.blur': '背景模糊',
    'bg.dim': '背景暗化',
    'bg.tint': '着色',
    'bg.tintClear': '清除着色',
    'bg.tintStrength': '着色强度',
    'bg.glass': '输入框液态玻璃',
    'bg.glassHint': '作用于对话输入框（不是从 tweakcn 粘贴的主题）。配方参考 kevinbism/liquid-glass-effect、Z1Code/glass-refraction、shuding/liquid-glass。',
    'bg.glassOpacity': '玻璃实色占比（越低越透）',
    'bg.glassBlur': '玻璃模糊',
    'bg.glassSaturate': '玻璃饱和度',
    'bg.glassRadius': '玻璃圆角',
    'bg.glassHighlight': '边缘高光',
    'bg.glassShadow': '立体阴影',
    'bg.refract': '液态折射强度（0 关闭）',
    'bg.refractFrequency': '折射纹理频率',
    'bg.performance': '性能模式（关闭折射、限制模糊）',
    'bg.reducedMotion': '跟随系统「减少动态效果」暂停视频',
    'bg.perfHint': '大面积毛玻璃、视频解码与 SVG 折射都很吃性能。卡顿就开性能模式，或直接把折射设为 0。系统开启「减少透明效果」时玻璃会自动降级为不透明。',
    'bg.errImageOnly': '只能选择图片文件。',
    'bg.errTooLarge': '图片太大，无法保存。请换一张小图，或改用图片链接。',
    'bg.errRead': '读取图片失败。',
    'bg.errUrl': '背景地址不被允许（{reason}），已忽略。',
    'bg.pickOk': '图片已压缩并应用为背景。',
    'bg.diagTitle': '运行状态（如果没效果，把这段发给我）',
    'preview.title': '颜色预览（浅色）',
    'preview.hint': '下面是从主题里读到的原始变量，右侧是它的值。',
    'warn.title': '解析提示',
    'detail.title': '已映射到 Harness 的令牌（{count}）',
    'detail.hint': '每个格子两个色块：左边是浅色模式的值，右边是深色模式的值。',
    'status.applied': '已应用，共接管 {count} 个设计令牌。',
    'status.preset': '已载入预设「{name}」，点「应用主题」生效。',
    'status.reset': '已恢复默认外观。',
    'status.empty': '请先粘贴主题 CSS。',
    'status.nothing': '这份主题里没有能用的变量。请确认粘贴的是 tweakcn 的 CSS 导出。',
    'status.saveFailed': '主题已生效，但保存失败',
  },
  en: {
    nav: 'Custom theme',
    'intro.title': 'Import a theme from tweakcn',
    'intro.hint1': 'Pick or tune a theme on',
    'intro.hint2': 'then click “Copy theme” and paste the CSS below.',
    'intro.rule': 'Only CSS variable declarations (--primary: …) are read and mapped onto the Harness design tokens; selectors and @apply rules are ignored and the paste is never inserted as a stylesheet.',
    'paste.title': 'Theme CSS',
    'paste.placeholder': ':root {\n  --background: oklch(0.98 0.004 95);\n  --primary: oklch(0.62 0.14 39);\n  …\n}\n\n.dark {\n  --background: oklch(0.29 0 0);\n  --primary: oklch(0.76 0 0);\n  …\n}',
    'paste.apply': 'Apply theme',
    'paste.reset': 'Reset',
    'paste.showDetail': 'Show mapping ({count})',
    'paste.hideDetail': 'Hide mapping',
    'paste.loadApplied': 'Load applied',
    'preset.label': 'Built-in presets',
    'preset.placeholder': 'Choose a preset…',
    'mapping.title': 'Mapping options',
    'mapping.hint': 'Theme colours map onto Harness interface tokens. These switches decide what else the theme takes over.',
    'mapping.borders': 'Take over border colours',
    'mapping.fonts': 'Take over fonts (text and code)',
    'mapping.radius': 'Derive the radius scale from the theme',
    'mapping.extras': 'Take over code blocks, scrollbars, hover fills',
    'mapping.statusTint': 'Tint success and warning states with the theme',
    'mapping.companion': 'Derive the other scheme for single-palette themes',
    'warn.singleScheme': 'This theme declares the same palette for light and dark; switching modes would show no difference. Automatic companion derivation is on.',
    'bg.title': 'Custom background & liquid glass',
    'bg.hint': 'Put an image or video behind the whole window, and optionally give the composer a frosted-glass look. Changes apply live.',
    'bg.enable': 'Enable custom background',
    'bg.kind': 'Type',
    'bg.kindImage': 'Image',
    'bg.kindVideo': 'Video',
    'bg.fitCover': 'Cover',
    'bg.fitContain': 'Contain',
    'bg.urlPlaceholder': 'https://…/wallpaper.jpg (or pick a local image below)',
    'bg.pickFile': 'Choose a local image',
    'bg.clear': 'Clear URL',
    'bg.security': 'Only http(s) URLs or local images (stored as inline data) are allowed; SVG, script URLs and oversized files are refused. Use a URL for video — local video files are not stored.',
    'bg.blur': 'Background blur',
    'bg.dim': 'Background dimming',
    'bg.tint': 'Colour cast',
    'bg.tintClear': 'Clear cast',
    'bg.tintStrength': 'Cast strength',
    'bg.glass': 'Liquid glass on the composer',
    'bg.glassHint': 'Applies to the chat input, not to the pasted tweakcn theme. Recipe adapted from kevinbism/liquid-glass-effect, Z1Code/glass-refraction and shuding/liquid-glass.',
    'bg.glassOpacity': 'Glass solidity (lower = clearer)',
    'bg.glassBlur': 'Glass blur',
    'bg.glassSaturate': 'Glass saturation',
    'bg.glassRadius': 'Glass radius',
    'bg.glassHighlight': 'Edge highlight',
    'bg.glassShadow': 'Depth shadow',
    'bg.refract': 'Liquid refraction (0 = off)',
    'bg.refractFrequency': 'Refraction texture scale',
    'bg.performance': 'Performance mode (no refraction, capped blur)',
    'bg.reducedMotion': 'Pause the video when the OS asks for reduced motion',
    'bg.perfHint': 'Large frosted surfaces, video decoding and SVG refraction are all expensive. If it stutters, enable performance mode or set refraction to 0. The glass degrades to opaque when the OS asks for reduced transparency.',
    'bg.errImageOnly': 'Only image files can be chosen.',
    'bg.errTooLarge': 'The image is too large to save. Use a smaller one or an image URL.',
    'bg.errRead': 'Could not read the image.',
    'bg.errUrl': 'Background URL rejected ({reason}); ignored.',
    'bg.pickOk': 'Image downscaled and applied as the wallpaper.',
    'bg.diagTitle': 'Live status (send me this if nothing happens)',
    'preview.title': 'Colour preview (light)',
    'preview.hint': 'The theme variables read from the paste, with their values.',
    'warn.title': 'Parser notes',
    'detail.title': 'Harness tokens overridden ({count})',
    'detail.hint': 'Two chips per row: the light-mode value, then the dark-mode value.',
    'status.applied': 'Applied — {count} design tokens overridden.',
    'status.preset': 'Loaded the “{name}” preset; click “Apply theme”.',
    'status.reset': 'Restored the default appearance.',
    'status.empty': 'Paste a theme CSS first.',
    'status.nothing': 'No usable variables in this theme. Make sure it is a tweakcn CSS export.',
    'status.saveFailed': 'Theme applied, but saving failed',
  },
};

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
      let captionFill = null;

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
