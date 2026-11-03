import { siteImages } from './sites/index.ts';

/**
 * The extension pages' Content Security Policy for a build that talks to `apiOrigin`.
 * Scripts are bundled (plus the crypto WebAssembly); network requests reach only the business API and the extension's own
 * files, Blob and data URLs; remote images come only from the token-logo hosts the site registry exports; nothing frames,
 * submits forms or rewrites the base URL.
 */
export function extensionPagePolicy(apiOrigin: string) {
  const origin = new URL(apiOrigin).origin;
  const images = [...new Set(siteImages.map(image => `https://${image.host}`))].sort();
  return [
    "script-src 'self' 'wasm-unsafe-eval'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    `connect-src 'self' ${origin} data: blob:`,
    `img-src 'self' data: blob: ${images.join(' ')}`,
  ].join('; ');
}
