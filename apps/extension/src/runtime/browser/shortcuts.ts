import { browser } from 'wxt/browser';

/** Chrome's own page for extension shortcuts: Palside can read its shortcut but only the user can change it, there. */
export const SHORTCUTS_URL = 'chrome://extensions/shortcuts';

/** The 截图 shortcut as Chrome shows it ("⌥⇧S", "Alt+Shift+S"), or '' when it has none — e.g. another extension took the key first. */
export async function captureShortcut(host = browser): Promise<string> {
  const commands = await host.commands.getAll();
  return commands.find(command => command.name === 'capture')?.shortcut ?? '';
}

/** The manifest's suggested 截图 key as Chrome shows it on this computer: Alt+Shift+S reads ⌥⇧S on a Mac. */
export function suggestedCaptureShortcut(platform = typeof navigator === 'undefined' ? '' : navigator.platform) {
  return /Mac|iPhone|iPad/.test(platform) ? '⌥⇧S' : 'Alt+Shift+S';
}

export function openShortcuts(host = browser) {
  return host.tabs.create({ url: SHORTCUTS_URL });
}

/** One keycap per key: "Alt+Shift+S" splits on +, macOS symbols ("⌥⇧S") split per modifier. */
export function shortcutKeys(value: string): string[] {
  if (!value) return [];
  if (value.includes('+')) return value.split('+').filter(Boolean);
  return value.match(/[⌃⌥⇧⌘]|[^⌃⌥⇧⌘]+/g) ?? [value];
}
