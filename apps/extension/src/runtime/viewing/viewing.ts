/**
 * A page or tab icon the panel may draw and a snapshot may carry: only a small image data URL. The panel's image policy blocks other
 * sites' addresses, so their icons reach it through the stored site icons instead.
 */
export function iconDataUrl(value: unknown): string | undefined {
  return typeof value === 'string' && value.startsWith('data:image/') && value.length <= 8192 ? value : undefined;
}
