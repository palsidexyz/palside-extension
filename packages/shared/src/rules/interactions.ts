/** Devices per account; caps encrypted relay recipients; docs/product/sharing.md#页面与生命周期. */
export const RELAY_DEVICES_PER_ACCOUNT = 30;
/** UTF-16 code units of serialized messages; caps encrypted viewing relay; docs/product/sharing.md#页面与生命周期. */
export const VIEWING_MESSAGE_LENGTH = 256_000;
/** UTF-16 code units; caps encrypted reaction relay; docs/product/sharing.md#页面与生命周期. */
export const REACTION_MESSAGE_LENGTH = 64_000;
/** Milliseconds; expires shared viewing; docs/product/sharing.md#页面与生命周期. */
export const VIEWING_TTL_MS = 30_000;
/** Milliseconds; tolerates viewing sender clock skew; docs/product/sharing.md#页面与生命周期. */
export const VIEWING_CLOCK_SKEW_MS = 15_000;
/** Milliseconds; schedules shared-viewing renewal; docs/product/sharing.md#页面与生命周期. */
export const VIEWING_RENEW_MS = 10_000;
/** Milliseconds; expires account presence leases; docs/product/sharing.md#页面与生命周期. */
export const PRESENCE_LEASE_MS = 40_000;
/** Milliseconds; expires live reactions; docs/product/sharing.md#页面与生命周期. */
export const REACTION_TTL_MS = 10_000;
