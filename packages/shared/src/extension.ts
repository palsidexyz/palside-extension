/**
 * The Chrome Web Store assigns the published ID and rejects a manifest `key`, so store builds carry none.
 * Local and unpacked builds set this public key, copied from the store item's package page, to share that ID.
 */
export const EXTENSION_PUBLIC_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmZa2WlUuYaNrZpOMTfNQ1jZqIvhzK+4hqHhrHWa+pfZjhScswkdY3uTivF9nnzq+J5jz6fg5qaFnqcnprZytfxfLaNdeKfFNQbxjwTXhFpiUC7/tXpFQ4muZf8xp5ZEbuRlLLMTSNIXx90vsh29SNpeOINQoafM6d4nzJZfAjvuUXWHz7C8noEEKUHIpvs8xpf/OeRQ7qGXA7ogLpkmRGcIVhxKH8BoW7TYqhoiMWun+06V3dq/vtAtHrwkdRNNr4+lyFAz51kGXajnuOkdQbaEsy1tTV56kEzQZPWhOLUzOlcUf8SjDlZ3prlXBFaEtk5teoO4ihCG1fIEvVOY+PwIDAQAB';
export const EXTENSION_ID = 'nobiendpnmekaneboekamigfhkkddlgm';
export const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`;

/** Store builds talk only to these public origins; both are fixed at build time. */
export const RELEASE_WEBSITE_ORIGIN = 'https://palside.xyz';
export const RELEASE_API_ORIGIN = 'https://api.palside.xyz';

/** The extension version each request to the service names: an HTTP header, and the live socket's `auth` message. */
export const EXTENSION_VERSION_HEADER = 'x-palside-version';
/** A Chrome extension version: one to four dot-separated integers. */
export const EXTENSION_VERSION = /^(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){0,3}$/;
/** Whether `version` is older than `minimum`. A missing or malformed version is older: it comes from a build before versions were sent. */
export function versionBelow(version: string | undefined, minimum: string) {
  if (!version || !EXTENSION_VERSION.test(version)) return true;
  const a = version.split('.').map(Number), b = minimum.split('.').map(Number);
  for (let i = 0; i < 4; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  return false;
}
