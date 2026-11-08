# Fixture inventory

Test inputs and built-in-preset candidates for the tweakcn → DSH theme plugin.
Every file here is **real tweakcn output** (fetched from `tweakcn.com/r/themes/*` or,
for the legacy pair, published as tweakcn-format fixtures by a third-party parser),
re-serialized in tweakcn's own variable order. Nothing is hand-invented.

> **Fact snapshots, not upstream source.** `dsh-token-names.json`,
> `dsh-token-defs.txt`, `token-usage.json` and `tweakcn-presets.json` are frozen
> data-only extracts (CSS variable values, property names, usage counts). They let a
> plain `git clone` run `npm test` offline with no research checkout, while keeping
> third-party source code out of this MIT-licensed repository. Regenerate them only
> when bumping the DSH or tweakcn version under test.

The `*.css` fixtures are the primary inputs. The JSON/TXT snapshots are consumed by
`tests/core.test.mjs` and `scripts/preset-sweep.mjs`.

| File | Shape | light keys | dark keys | Purpose |
|---|---|---|---|---|
| `amethyst-haze.oklch.css` | Tailwind v4, all-`oklch`, muted purple | 52 | 50 | **Primary happy-path fixture** + built-in preset |
| `claude.oklch.css` | v4, all-`oklch`, warm neutrals | 52 | 50 | `--destructive` chroma guard (§8.3): light `destructive` = `oklch(0.1908 0.0020 …)`, chroma 0.002 |
| `t3-chat.oklch.css` | v4, all-`oklch`, high-chroma pink | 52 | 50 | dark `--sidebar-border: oklch(0 0 0)` (pure black) + `--ring` chroma 0.218 |
| `tweakcn-example-shadows-tracking.css` | v4, all-`oklch`, 5 `rem` radius | 52 | 50 | raw `--shadow-x/--shadow-y` inputs present; `--tracking-normal: 0.5px` (non-zero); dark `--primary` lighter than light `--primary` |
| `legacy-v3-hsl-triplets.css` | Tailwind v3, `hsl` **triplets** | 16 | 15 | must wrap bare `0 0% 100%` → `hsl(0 0% 100%)` |
| `legacy-v3-hex-with-theme-inline.css` | Tailwind v3, **hex** + leading `@theme inline` | 44 | 40 | must strip `@theme`; hex preserved; partial variable set (no `chart-*`/`sidebar-*` in dark) |

The 52/50 split is the *correct* shape for a tweakcn v4 theme: `--spacing` and
`--tracking-normal` are emitted **only in `:root`**. A parser must not require
symmetric key sets.

Registry JSON equivalents (the alternative, no-CSS ingestion path) live in
`../reference/`:

- `tweakcn-registry-amethyst-haze.json`
- `tweakcn-registry-claude.json`
- `tweakcn-registry-t3-chat.json`

Each has `cssVars.theme` (9 keys), `cssVars.light` (53) and `cssVars.dark` (52), with
`shadow-offset-x/y` instead of `shadow-x/y` and `letter-spacing` instead of
`tracking-normal`.

## How each fixture exercises the parser

```
amethyst-haze.oklch.css
  ✓ 32 color tokens present in both modes
  ✓ quoted font stacks with commas:  "Fira Code", "Courier New", monospace
  ✓ --radius: 0.5rem  → expected md 10px
  ✓ 8 --shadow-* levels (multi-layer, containing `,` and `/`)
  ✓ no @theme block, no @layer — the plain two-block case

claude.oklch.css
  ✓ long system font stacks (~200 chars) — exercises the value-length cap
  ✓ --destructive chroma 0.002 in light, 0.208 in dark — asymmetry guard
  ✓ --popover differs from --card in dark (0.3085 vs 0.2679 L)

t3-chat.oklch.css
  ✓ --ring chroma 0.218 (a genuinely saturated focus ring)
  ✓ dark --sidebar-border: oklch(0 0 0) — must not vanish after border blending
  ✓ light --primary-foreground pure white on a mid-pink primary (contrast case)

tweakcn-example-shadows-tracking.css
  ✓ --shadow-x / --shadow-y naming (the CSS-only spelling)
  ✓ --tracking-normal: 0.5px — the only fixture where tweakcn would emit body letter-spacing
  ✓ --radius: 0.625rem → expected md 12px (exactly DSH's default)
  ✓ 0.01 shadow alpha (near-invisible) — exercises decimal parsing

legacy-v3-hsl-triplets.css
  ✓ `0 0% 100%`, `240 5.9% 10%` style bare triplets
  ✓ only 16 keys — a partial theme (fill the rest from defaults)
  ✓ .dark has NO --radius (light-only in this fixture) — asymmetry

legacy-v3-hex-with-theme-inline.css
  ✓ a leading @theme inline block that MUST be dropped
  ✓ #rrggbb and #rrggbbaa-free hex
  ✓ rgba() shadow values
  ✓ dark block misses chart-*/sidebar-* — partial dark
```

## Quick sanity script

```powershell
# counts + confirms no fixture contains a self-referential custom property
Get-ChildItem . -Filter *.css | ForEach-Object {
  $c = Get-Content $_.FullName -Raw
  $i = $c.IndexOf('.dark')
  "{0,-42} light={1} dark={2} selfref={3}" -f $_.Name,
    ([regex]::Matches($c.Substring(0,$i),'--([\w-]+)\s*:').Count),
    ([regex]::Matches($c.Substring($i),'--([\w-]+)\s*:').Count),
    ([regex]::Matches($c,'--([\w-]+):\s*var\(--\1\)').Count)
}
```
