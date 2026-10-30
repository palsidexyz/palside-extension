/**
 * Product colours for surfaces that cannot read tokens.css, such as the page layer drawing in its own ShadowRoot inside other sites.
 * Each value is the light-theme token named beside it (dark ones say so); tests/design-colors.test.mjs keeps them equal.
 */
export const productColors = {
  accent: '#CCFF00', // --ui-accent
  onAccent: '#202400', // --ui-on-accent
  canvas: '#FFFFFF', // --background
  text: '#303138', // --foreground
  border: '#E5E5EB', // --border
  controlSurface: '#F4F4F7', // --ui-control-surface
  controlRecess: '#E7E8ED', // --ui-control-recess
  solidHover: '#1D1E23', // --ui-solid-hover
  error: '#B83B3B', // --ui-ink-error
  darkCanvas: '#17191C', // --background, dark
  darkText: '#ECEEF0', // --foreground, dark
  darkTextSecondary: '#9A9EA7', // --ui-text-secondary, dark
  darkInkAccent: '#D0ED78', // --ui-ink-accent, dark
  inkAccent: '#4B5900', // --ui-ink-accent
  textSecondary: '#686773', // --ui-text-secondary
  signalInk: '#E8E2CF', // --signal-ink
  signalDeep: '#0D1A19', // --signal-deep
  signalMuted: '#8F9A98', // --signal-muted
  signalFocus: '#16B8DF', // --signal-focus
} as const;
