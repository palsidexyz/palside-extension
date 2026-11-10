/**
 * The extension pages' Content Security Policy for a build that talks to `apiOrigin`.
 * Scripts are bundled (plus the crypto WebAssembly); network requests reach only the business API (and its live socket) and the extension's own
 * files, Blob and data URLs; remote images (token icons) come only from the business API; nothing frames,
 * submits forms or rewrites the base URL.
 */
export function extensionPagePolicy(apiOrigin: string) {
  const origin = new URL(apiOrigin).origin, socket = origin.replace(/^http/, 'ws');
  return [
    "script-src 'self' 'wasm-unsafe-eval'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    `connect-src 'self' ${origin} ${socket} data: blob:`,
    `img-src 'self' data: blob: ${origin}`,
  ].join('; ');
}
