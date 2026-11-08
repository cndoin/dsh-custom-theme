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
export const COLOR_VARS = Object.freeze([
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
export const SHARED_VARS = Object.freeze([
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
export function isSafeValue(value) {
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
export function normalizeValue(raw, name) {
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
export function stripComments(css) {
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
export function classifySelector(prelude) {
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
export function parseThemeCss(css) {
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
export function isSingleScheme(light, dark) {
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
export function shiftScheme(value, towardDark, isInk = false, span = { min: 0, max: 1 }) {
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
export function deriveCompanion(parsed) {
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
export function ensureTwoSchemes(parsed, enabled) {
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
export function parseThemeJson(payload) {
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
export function sanitizePaste(text) {
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
export function parseThemeInput(text) {
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
export function hasAlpha(value) {
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
export function tintOverlay(value, percent) {
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
export function softenBorder(value, percent) {
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
export function isNearGrey(value) {
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
export function luminance(value) {
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
export function isLightColor(value) {
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
export function stepColor(value, strength, direction) {
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
export function mixWith(value, toward, percentage) {
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
export function hue(value) {
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
export function hueMatches(value, family) {
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
export function fillFrom(candidate, page, foreground, strength = 8) {
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
export function liftFrom(value, background, strength) {
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
export function isSafeFontStack(value) {
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
export function parseLengthToPx(value) {
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
export function radiusTokens(radius) {
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
export function staticRamps(parsed) {
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
export function buildOverrides(parsedInput, options = {}) {
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
export function describeOverrides(tokens) {
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
