import type { ApiResult } from '../transport/api';
/** `crypto: 'ready'` is written only once this device is cross-signed by the account's identity. */
export type RuntimeDevice = { -readonly [K in keyof ApiResult<'devices.create'>]: ApiResult<'devices.create'>[K] } & { storageKey: number[]; label?: string; crypto?: 'ready' };
