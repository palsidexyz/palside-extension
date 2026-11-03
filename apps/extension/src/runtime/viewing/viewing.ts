/**
 * The tab's own icon address (`tab.favIconUrl`), which Chrome reveals with the tab's address. Drawn only in this panel, never sent:
 * an https or small image data URL, nothing else.
 */
export function tabIcon(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (value.startsWith('data:image/')) return value.length <= 8192 ? value : undefined;
  try { return new URL(value).protocol === 'https:' && value.length <= 2048 ? value : undefined; } catch { return undefined; }
}
export function pageFavicon(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  if (!value.startsWith('data:image/')) {
    return undefined;
  }
  return value.length <= 8192 ? value : undefined;
}
