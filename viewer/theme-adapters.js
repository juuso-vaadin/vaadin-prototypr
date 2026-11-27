/**
 * Light/dark adapters, one per Vaadin theme (SPEC.md §5.3).
 *
 * This is the only file in the viewer that knows how the themes differ. Each
 * adapter gets the prototype's document (same origin, so the viewer can reach it
 * through iframe.contentDocument) and sets the scheme on its root element. The
 * scheme is written as an inline style, so it wins over anything in the
 * prototype's own stylesheet.
 *
 * Mechanisms, checked against the Vaadin 25.3.7 packages, the 25.3 docs and in a
 * browser (details in scripts/build-vendor.mjs):
 *   - aura: CSS `color-scheme` on <html>. All Aura colors use light-dark().
 *   - base: the same. The built-in base styles use light-dark() too.
 *   - lumo: the same. Lumo 25 defines its colors with light-dark() on :root, so
 *           `color-scheme: dark` alone switches everything (verified: page, fields,
 *           tabs, and the registered --vaadin-* properties, also when set before
 *           first paint). Lumo's older switch, theme="dark" on <html>, is
 *           deliberately NOT used: its [theme~='dark'] block has higher specificity
 *           than a page's `html { --lumo-*: light-dark(...) }` and would override a
 *           customer's own dark colors. The Lumo docs for 25 call it legacy.
 *
 * All three happen to use the same mechanism in Vaadin 25. They stay separate
 * entries so a theme (or a future version of one) can change without touching
 * the rest of the viewer.
 */

function setColorScheme(doc, scheme) {
  doc.documentElement.style.setProperty('color-scheme', scheme);
}

const colorSchemeAdapter = { apply: setColorScheme };

export const themeAdapters = {
  aura: colorSchemeAdapter,
  base: colorSchemeAdapter,
  lumo: colorSchemeAdapter,
};

/**
 * Applies `scheme` ('light' | 'dark') to a prototype document that uses `theme`.
 * Unknown themes fall back to `color-scheme`, which any light-dark() based theme
 * follows.
 */
export function applyColorScheme(doc, theme, scheme) {
  if (!doc?.documentElement) return;
  (themeAdapters[theme] ?? colorSchemeAdapter).apply(doc, scheme);
}
