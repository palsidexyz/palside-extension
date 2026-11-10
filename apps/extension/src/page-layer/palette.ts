import { productColors as product } from '@palside/design/colors';

/**
 * Every colour the page layer draws with. Product surfaces (accent, panels, menus) take the product's own values;
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
  signalInk: product.signalInk,
  signalSurface: product.signalDeep,
  signalLine: product.signalMuted,
  signalFocus: product.signalFocus,
  darkHover: 'rgb(255 255 255 / 8%)',
  chartTagInk: '#141414',
} as const;

const property = (name: string) => `--pl-${name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`;

/** The palette as custom properties on the ShadowRoot host; put it first in each page-layer stylesheet. */
export const paletteCss = `:host{${Object.entries(colors).map(([name, value]) => `${property(name)}:${value}`).join(';')};--ui-radius-xs:8px;--ui-radius-s:12px;--ui-radius-m:18px;--ui-radius-l:24px;--ui-radius-xl:32px;--ui-radius-pill:999px;--ui-corner-shape:superellipse(1.4);--ui-focus-width:1px;--ui-focus-offset:2px;--ui-text-secondary:#686773;--ui-dark-text-secondary:#9A9EA7;--ui-shadow-floating:0 4px 12px rgb(0 0 0 / 6%)}`;

/** Member colours behind initials when there is no portrait. */
export const avatarTints = [product.accent, '#9BE7FF', '#FFCF99', '#D7B8FF', '#FFB7D5'] as const;


/** 看盘批注 ink per author: yours first, then teammates in squad order. Canvas strokes take the values directly. */
export const chartTints = [product.accent, '#5AC8FA', '#FF9F0A', '#FF6B9A', '#A78BFA', '#34D399'] as const;
/** The laser head's thin rim, drawn on canvas. */
export const chartRim = colors.outline;

/**
 * 共享画线's toolbar entry and panel follow the chart site's own toolbar: its background and ink are read from the page, and these
 * stand in where the page gives none. `pressed` is the plate behind the entry while its panel is open or 激光笔 is armed.
 */
export const chartToolbar = {
  logoInk: '#202121',
  shadow: 'rgb(0 0 0 / 28%)',
  dark: { surface: '#131722', ink: '#D1D4DC', line: 'rgb(255 255 255 / 12%)', hover: 'rgb(255 255 255 / 8%)', pressed: 'rgb(255 255 255 / 12%)', badgeInk: '#000000' },
  light: { surface: '#FFFFFF', ink: '#131722', line: 'rgb(0 0 0 / 12%)', hover: 'rgb(0 0 0 / 5%)', pressed: 'rgb(0 0 0 / 8%)', badgeInk: '#FFFFFF' },
} as const;
