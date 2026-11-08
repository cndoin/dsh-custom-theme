/**
 * Host half of the custom-theme bundle.
 *
 * Everything the feature needs happens in the browser: the theme paste is parsed
 * there and pushed into `ctx.theme.overrideTokens`, and the resulting layer dies
 * with the page. The Host therefore has nothing to register — this module exists
 * because a bundle must export a plugin entry, and keeping it empty is honest
 * about where the state lives.
 *
 * @module dsh-custom-theme
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'custom-theme'

/** @param ctx - host cordis context. */
export function apply(ctx) {
  ctx.effect(() => {
    ctx.logger?.debug?.('[custom-theme] host half loaded; the theme is applied in the browser')
    return () => {}
  }, 'custom-theme: host no-op')
}
