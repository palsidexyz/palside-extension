import { npubEncode,shortNpub } from '@palside/shared/identity';

/** Real account IDs are 64-hex public keys shown as a short npub; preview fixtures keep a plain short ID. */
export function accountLabel(id: string) { return /^[0-9a-f]{64}$/.test(id) ? shortNpub(npubEncode(id)) : `#${id.slice(0, 8)}`; }
