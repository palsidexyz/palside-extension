export function pageFavicon(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  if (!value.startsWith('data:image/')) {
    return undefined;
  }
  return value.length <= 8192 ? value : undefined;
}
