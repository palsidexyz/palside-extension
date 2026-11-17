/**
 * The product's only font stacks. tokens.css exposes each as --ui-font-<name>; the page layer's ShadowRoot gets the same
 * variables from page-layer/palette.ts. tests/design-fonts.test.mjs keeps tokens.css equal to these values and rejects font
 * names written anywhere else.
 *
 * Only Geist and Geist Mono (fonts.css) ship to every host. Chinese text uses the system 黑体 below it, in this order:
 * macOS, older macOS, Windows UI, older Windows, Linux. The website's large headings add one subset of Noto Sans SC
 * (apps/website/app/display-font.css) so they draw the same on every system.
 */
const chinese = ['"PingFang SC"', '"Hiragino Sans GB"', '"Microsoft YaHei UI"', '"Microsoft YaHei"', '"Noto Sans CJK SC"', '"Source Han Sans SC"'];
const emoji = ['"Apple Color Emoji"', '"Segoe UI Emoji"', '"Noto Color Emoji"'];
const systemLatin = ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"'];

/** The family name apps/website/app/display-font.css gives its Noto Sans SC subset. */
export const displayFamily = 'Noto Sans SC Display';

export const fontStacks = {
  /** Product text everywhere. The page layer cannot load Geist on other sites, so palette.ts points its --ui-font-sans at `system`. */
  sans: ['Geist', '"Geist Fallback"', ...chinese, 'sans-serif', ...emoji].join(', '),
  /** Addresses, hashes, codes and other character-aligned values. */
  mono: ['"Geist Mono"', '"Geist Mono Fallback"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', ...chinese, 'monospace'].join(', '),
  /** The website's large headings: Geist for Latin and digits, the shipped subset for Chinese. */
  display: ['Geist', '"Geist Fallback"', `"${displayFamily}"`, ...chinese, 'sans-serif', ...emoji].join(', '),
  /** 弹幕 on pages, in settings, the tour and the website film: the Bilibili player's default face (docs/design-system.md). */
  danmaku: ['SimHei', '"Microsoft JhengHei"', 'Arial', 'Helvetica', 'sans-serif'].join(', '),
  /** The system UI face: the page layer on other sites, and scenes that imitate the browser, the operating system or another site's chart. */
  system: ['system-ui', ...systemLatin, ...chinese, 'sans-serif'].join(', '),
} as const;

export type FontStack = keyof typeof fontStacks;
