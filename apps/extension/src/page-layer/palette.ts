import { productColors as product } from '@palside/design/colors';

/**
 * Every colour the page layer draws with. Product surfaces (accent, panels, menus) take the product's own values; sticky notes,
 * 弹幕 on a page and the capture tool have their own. Styles refer to these as var(--pl-*) declared on the ShadowRoot host.
 */
const colors = {
  accent: product.accent,
  onAccent: product.onAccent,
  onDark: '#FFFFFF',
  outline: '#000000',
  tip: 'rgb(0 0 0 / 75%)',
  dmHover: 'rgb(0 0 0 / 55%)',
  dmMate: product.darkInkAccent,
  dmSelf: 'rgb(255 255 255 / 85%)',
  dmSelfFill: 'rgb(0 0 0 / 22%)',
  dmSelfFillLight: 'rgb(0 0 0 / 40%)',
  darkText: product.darkText,
  darkMuted: product.darkTextSecondary,
  lightMuted: product.textSecondary,
  inkAccent: product.inkAccent,
  hairline: 'rgb(0 0 0 / 27%)',
  drop: 'rgb(0 0 0 / 13%)',
  darkSurface: product.darkCanvas,
  darkLine: 'rgb(255 255 255 / 15%)',
  lightSurface: product.canvas,
  lightText: product.text,
  lightBorder: product.border,
  lightHover: product.controlSurface,
  lightPressed: product.controlRecess,
  toolInk: '#3A3A40',
  solid: product.text,
  solidHover: product.solidHover,
  error: product.error,
  focus: '#3B82F6',
  captureBackdrop: '#000000',
  captureScrim: 'rgb(0 0 0 / 50%)',
  note: '#FFE27A',
  noteHover: '#FFDC61',
  noteEdge: '#A58A35',
  noteInk: '#3A2D00',
  notePaper: '#FFF4C2',
  noteText: '#2A2300',
  signalInk: product.signalInk,
  signalSurface: product.signalDeep,
  signalLine: product.signalMuted,
  signalFocus: product.signalFocus,
} as const;

const property = (name: string) => `--pl-${name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`;

/** The palette as custom properties on the ShadowRoot host; put it first in each page-layer stylesheet. */
export const paletteCss = `:host{${Object.entries(colors).map(([name, value]) => `${property(name)}:${value}`).join(';')};--ui-radius-xs:8px;--ui-radius-s:12px;--ui-radius-m:18px;--ui-radius-l:24px;--ui-radius-xl:32px;--ui-radius-pill:999px;--ui-corner-shape:superellipse(1.4);--ui-focus-width:1px;--ui-focus-offset:2px;--ui-text-secondary:#686773;--ui-dark-text-secondary:#9A9EA7;--ui-shadow-floating:0 4px 12px rgb(0 0 0 / 6%)}`;

/** Member colours behind initials when there is no portrait. */
export const avatarTints = [product.accent, '#9BE7FF', '#FFCF99', '#D7B8FF', '#FFB7D5'] as const;

/** A quoted passage under a sticky note, drawn by the page's own ::highlight (outside the ShadowRoot). */
export const noteHighlight = '#FFE27A66';
