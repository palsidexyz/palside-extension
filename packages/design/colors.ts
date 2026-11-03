/**
 * Product colours for surfaces that cannot read tokens.css, such as the page layer drawing in its own ShadowRoot inside other sites.
 * Each value is the light-theme token named beside it (dark ones say so); tests/design-colors.test.mjs keeps them equal.
 */
export const productColors = {
  accent: '#CCFF00', // --ui-accent
  onAccent: '#202400', // --ui-on-accent
  canvas: '#FFFFFF', // --background
  text: '#2B2B2B', // --foreground
  border: '#E6E6E6', // --border
  controlSurface: '#F4F4F4', // --ui-control-surface
  controlRecess: '#E7E7E7', // --ui-control-recess
  solidHover: '#1A1A1A', // --ui-solid-hover
  error: '#B83B3B', // --ui-ink-error
  darkCanvas: '#141414', // --background, dark
  darkText: '#EDEDED', // --foreground, dark
  darkTextSecondary: '#9E9E9E', // --ui-text-secondary, dark
  darkInkAccent: '#D0ED78', // --ui-ink-accent, dark
  inkAccent: '#4B5900', // --ui-ink-accent
  textSecondary: '#6B6B6B', // --ui-text-secondary
  signalInk: '#E8E2CF', // --signal-ink
  signalDeep: '#0D1A19', // --signal-deep
  signalMuted: '#8F9A98', // --signal-muted
  signalFocus: '#16B8DF', // --signal-focus
} as const;
